'use strict';
// Reads the game-prep details from the league's game media kit PDF:
//   - each team's head coach            ("Team Staff" on the Pre-Game page, one column per team)
//   - each team's record                (Pre-Game page title "Brantford Bulldogs (10-4-0-1) vs. Ottawa 67's (8-3-2-0)",
//                                         plus points and division rank from the Head to Head "Match Up" table)
//   - each team's last and next games   (the "<Team> 2026-27 Regular Season Game Schedule" pages)
//
// Loaded from server.js with one line:   require('./mediakit-prep')(app, pdfParse);
// It adds   POST /api/fetch-game-prep   { url }   ->   { gameDate, teams: [ { team, coach, record, points, division, prev: [...], next: [...] }, ... ] }
// The first team is the one listed first in the kit (the left-hand column); the app decides which one is Ottawa.

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const GAMES_SHOWN = 4;   // the board has four boxes per column

/* ---------- reading the PDF page by page, keeping where each piece of text sits ---------- */
// Pieces of text at the same height become one row; within a row they're kept left to right with their x position,
// so the two teams' columns on a page can be told apart. Pieces close together also make up one table cell
// ("10-4-0-1" and "-- 21 points" are two pieces of the same cell).
function pageRows(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4], y = it.transform[5];
    let row = rows.find(r => Math.abs(r.y - y) <= 1.5);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ x, w: it.width || 0, str: it.str.trim() });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    r.text = r.items.map(i => i.str).join(' ').replace(/\s+/g, ' ');
    r.cells = [];
    let end = null;
    for (const it of r.items) {
      if (end === null || it.x - end > 6) r.cells.push({ x: it.x, str: it.str });
      else r.cells[r.cells.length - 1].str += ' ' + it.str;
      end = it.x + it.w;
    }
  }
  return rows;
}

async function readPages(pdfParse, buffer) {
  const pages = [];
  await pdfParse(buffer, {
    pagerender: pd => pd.getTextContent({ normalizeWhitespace: false }).then(tc => {
      pages.push({ width: (pd.view && pd.view[2]) || 595, rows: pageRows(tc.items) });
      return '';
    })
  });
  return pages;
}

/* ---------- small helpers ---------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (mon, day) => mon + ' ' + parseInt(day, 10);
const words = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
// Does a short label like "Brantford" (or "Ottawa") belong to a full team name like "Brantford Bulldogs"?
const sameTeam = (label, full) => { const f = words(full); return words(label).some(w => f.includes(w)); };

/* ---------- the two teams and their records (Pre-Game page title) ---------- */
const TITLE_RE = /^(.+?)\s*\((\d+-\d+-\d+-\d+)\)\s*vs\.?\s*(.+?)\s*\((\d+-\d+-\d+-\d+)\)/i;
function findTeams(pages) {
  for (const p of pages) for (const r of p.rows) {
    const m = r.text.match(TITLE_RE);
    if (m) return [{ team: m[1].trim(), record: m[2] }, { team: m[3].trim(), record: m[4] }];
  }
  return null;
}

// "Oct 30, 2026 -- TD Place" on the Pre-Game page, or "Game #146: Friday, October 30, 2026" on the cover
function findGameDate(pages) {
  for (const p of pages.slice(0, 3)) for (const r of p.rows) {
    const m = r.text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s*\d{4}/);
    if (m) return shortDate(m[1], m[2]);
  }
  return null;
}

/* ---------- head coaches ("Team Staff": a name with "Head Coach" just to its right, one block per team column) ---------- */
function findCoaches(pages) {
  const out = [null, null];
  for (const p of pages) {
    if (!p.rows.some(r => /Team Staff/i.test(r.text))) continue;
    for (const r of p.rows) {
      r.items.forEach((it, i) => {
        if (!/^Head Coach$/i.test(it.str) || i === 0) return;
        const name = r.items[i - 1];
        const side = name.x < p.width / 2 ? 0 : 1;
        if (!out[side]) out[side] = name.str;
      });
    }
    if (out[0] || out[1]) break;
  }
  return out;
}

/* ---------- points and division rank (Head to Head "Match Up" table: a label, then one cell per team) ---------- */
function findMatchUp(pages, teams) {
  const out = [{}, {}];
  for (const p of pages) {
    const idx = p.rows.findIndex(r => /^Match Up$/i.test(r.text));
    if (idx < 0) continue;
    // The row under "Match Up" names the two columns ("Brantford  Ottawa"); use it to tell which column is which team.
    const header = p.rows[idx + 1];
    let order = [0, 1];
    if (header && header.cells.length === 2 && sameTeam(header.cells[0].str, teams[1].team) && sameTeam(header.cells[1].str, teams[0].team)) order = [1, 0];
    for (const r of p.rows.slice(idx + 1)) {
      const label = r.cells[0] && r.cells[0].str;
      const cells = r.cells.slice(1).map(c => c.str);
      if (cells.length !== 2) continue;
      if (/^Team Record$/i.test(label)) {
        cells.forEach((c, i) => {
          const m = c.match(/(\d+-\d+-\d+-\d+)(?:\s*--\s*(\d+)\s*points?)?/i);
          if (m) { out[order[i]].record = m[1]; if (m[2]) out[order[i]].points = parseInt(m[2], 10); }
        });
      } else if (/^Division Ranking$/i.test(label)) {
        cells.forEach((c, i) => { out[order[i]].division = c; });
      }
    }
    break;
  }
  return out;
}

/* ---------- each team's schedule ---------- */
// A played game:   "Oct. 08 at Niagara  OTL  3-1-2-0  1-2 OT  ..."   (the score is always the team's own goals first)
// A game to come:  "Nov. 01 at Oshawa  6:05 pm"
const PLAYED_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})\s+(at\s+)?(.+?)\s+(W|L|OTL|SOL|SL|T)\s+\d+-\d+-\d+-\d+\s+(\d+-\d+)(?:\s+(OT|SO)\b)?/;
const UPCOMING_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})\s+(at\s+)?(.+?)\s+(\d{1,2}:\d{2}\s*[ap]\.?m\.?)/i;
const SCHEDULE_RE = /^(.+?)\s+\d{4}-\d{2,4}\s+Regular Season Game Schedule/i;

function findSchedules(pages) {
  const schedules = [];
  let current = null;
  for (const p of pages) {
    let found = 0;
    for (const r of p.rows) {
      const h = r.text.match(SCHEDULE_RE);
      if (h) { current = { team: h[1].trim(), played: [], upcoming: [] }; schedules.push(current); continue; }
      if (!current) continue;
      let m = r.text.match(PLAYED_RE);
      if (m) {
        found++;
        current.played.push({ date: shortDate(m[1], m[2]), away: !!m[3], opponent: m[4].trim(), result: m[5], score: m[6], extra: m[7] || '' });
        continue;
      }
      m = r.text.match(UPCOMING_RE);
      if (m) {
        found++;
        current.upcoming.push({ date: shortDate(m[1], m[2]), away: !!m[3], opponent: m[4].trim(), time: m[5].replace(/\s+/g, ' ') });
      }
    }
    // A schedule carries over onto the next page; a page with no games on it means the schedule has ended.
    if (!found && !p.rows.some(r => SCHEDULE_RE.test(r.text))) current = null;
  }
  return schedules;
}

// "Oct 28 W 5-2 vs Brampton", "Oct 8 OTL 1-2 OT at Niagara"
const prevText = g => [g.date, g.result, g.score + (g.extra ? ' ' + g.extra : ''), (g.away ? 'at ' : 'vs ') + g.opponent].join(' ');
// "Nov 1 at Oshawa, 6:05 pm"
const nextText = g => g.date + ' ' + (g.away ? 'at ' : 'vs ') + g.opponent + ', ' + g.time;

function parseGamePrep(pages) {
  const teams = findTeams(pages);
  if (!teams) return { ok: false, reason: 'could not find the "Team (record) vs. Team (record)" title on the Pre-Game page' };
  const gameDate = findGameDate(pages);
  const coaches = findCoaches(pages);
  const matchUp = findMatchUp(pages, teams);
  const schedules = findSchedules(pages);
  const out = teams.map((t, i) => {
    const sched = schedules.find(s => sameTeam(s.team, t.team) || sameTeam(t.team, s.team));
    // Leave out today's game itself: it's the one being called, not an upcoming one.
    const upcoming = sched ? sched.upcoming.filter(g => g.date !== gameDate) : [];
    return {
      team: t.team,
      coach: coaches[i],
      record: matchUp[i].record || t.record,
      points: matchUp[i].points != null ? matchUp[i].points : null,
      division: matchUp[i].division || null,
      prev: sched ? sched.played.slice(-GAMES_SHOWN).reverse().map(prevText) : [],   // most recent first
      next: upcoming.slice(0, GAMES_SHOWN).map(nextText),
      scheduleFound: !!sched
    };
  });
  return { ok: true, gameDate, teams: out };
}

/* ---------- download + read ---------- */
async function extractGamePrep(pdfParse, buffer) {
  let pages;
  try { pages = await readPages(pdfParse, buffer); }
  catch (e) { return { error: 'Could not read that file as a PDF: ' + e.message, status: 500 }; }
  const r = parseGamePrep(pages);
  if (r.ok) return { gameDate: r.gameDate, teams: r.teams };
  const excerpt = pages.slice(0, 2).map((p, i) => '--- page ' + (i + 1) + ' ---\n' + p.rows.map(x => x.text).join('\n')).join('\n\n');
  return { error: 'Read the media kit but ' + r.reason + '.', debugExcerpt: excerpt.slice(0, 3000), status: 422 };
}

function register(app, pdfParse) {
  app.post('/api/fetch-game-prep', async (req, res) => {
    const url = req.body && req.body.url;
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'A valid http(s) URL is required.' });
    try {
      const pdfRes = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
      if (!pdfRes.ok) return res.status(502).json({ error: 'Could not download the PDF (status ' + pdfRes.status + ').' });
      const out = await extractGamePrep(pdfParse, Buffer.from(await pdfRes.arrayBuffer()));
      if (out.error) return res.status(out.status).json({ error: out.error, debugExcerpt: out.debugExcerpt });
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch or read the media kit: ' + err.message });
    }
  });
}

module.exports = register;
module.exports.parseGamePrep = parseGamePrep;
module.exports.extractGamePrep = extractGamePrep;
