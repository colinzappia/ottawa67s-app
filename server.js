const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Increased limit so base64-encoded line-photo uploads fit in the request body
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const newId = () => crypto.randomUUID();

/* ============== GAMES ============== */

app.get('/api/games', (req, res) => {
  const rows = db.prepare('SELECT * FROM games ORDER BY date DESC').all();
  res.json(rows);
});

app.post('/api/games', (req, res) => {
  const g = req.body;
  const id = newId();
  db.prepare(`
    INSERT INTO games (id, gametype, date, opponent, venue, result, gf, ga, sf, sa,
      ppg, ppo, pk_against, pk_ga, shgf, shga, engf, enga, sogf, soga, psgf, psga,
      goalie, attendance, notes)
    VALUES (@id, @gametype, @date, @opponent, @venue, @result, @gf, @ga, @sf, @sa,
      @ppg, @ppo, @pk_against, @pk_ga, @shgf, @shga, @engf, @enga, @sogf, @soga, @psgf, @psga,
      @goalie, @attendance, @notes)
  `).run({ id, ...normalizeGame(g) });
  res.json(db.prepare('SELECT * FROM games WHERE id = ?').get(id));
});

app.put('/api/games/:id', (req, res) => {
  const g = normalizeGame(req.body);
  const info = db.prepare(`
    UPDATE games SET gametype=@gametype, date=@date, opponent=@opponent, venue=@venue,
      result=@result, gf=@gf, ga=@ga, sf=@sf, sa=@sa, ppg=@ppg, ppo=@ppo,
      pk_against=@pk_against, pk_ga=@pk_ga, shgf=@shgf, shga=@shga, engf=@engf, enga=@enga,
      sogf=@sogf, soga=@soga, psgf=@psgf, psga=@psga, goalie=@goalie, attendance=@attendance,
      notes=@notes
    WHERE id=@id
  `).run({ id: req.params.id, ...g });
  if (info.changes === 0) return res.status(404).json({ error: 'Game not found' });
  res.json(db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id));
});

app.delete('/api/games/:id', (req, res) => {
  db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function normalizeGame(g) {
  const num = (v) => Number(v) || 0;
  return {
    gametype: g.gametype || 'Regular Season',
    date: g.date || '',
    opponent: g.opponent || '',
    venue: g.venue || 'Home',
    result: g.result || 'W',
    gf: num(g.gf), ga: num(g.ga), sf: num(g.sf), sa: num(g.sa),
    ppg: num(g.ppg), ppo: num(g.ppo), pk_against: num(g.pk_against), pk_ga: num(g.pk_ga),
    shgf: num(g.shgf), shga: num(g.shga), engf: num(g.engf), enga: num(g.enga),
    sogf: num(g.sogf), soga: num(g.soga), psgf: num(g.psgf), psga: num(g.psga),
    goalie: g.goalie || '', attendance: g.attendance || '', notes: g.notes || ''
  };
}

/* ============== PLAYER STATS (skaters + goalies), keyed by game ============== */

app.get('/api/player-stats/:gameId', (req, res) => {
  const skaters = db.prepare('SELECT * FROM skater_stats WHERE game_id = ?').all(req.params.gameId);
  const goalies = db.prepare('SELECT * FROM goalie_stats WHERE game_id = ?').all(req.params.gameId);
  res.json({ skaters, goalies });
});

// Replaces all stats for a game in one call (matches "Save Stats for This Game" button)
app.put('/api/player-stats/:gameId', (req, res) => {
  const gameId = req.params.gameId;
  const { skaters = [], goalies = [] } = req.body;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM skater_stats WHERE game_id = ?').run(gameId);
    db.prepare('DELETE FROM goalie_stats WHERE game_id = ?').run(gameId);

    const insSkater = db.prepare(`
      INSERT INTO skater_stats (game_id, name, pos, number, goals, assists, points, plusMinus, sog, pim, fow, fol)
      VALUES (@game_id, @name, @pos, @number, @goals, @assists, @points, @plusMinus, @sog, @pim, @fow, @fol)
    `);
    skaters.forEach(s => {
      if (!s.name || !s.name.trim()) return;
      insSkater.run({
        game_id: gameId, name: s.name, pos: s.pos || '', number: s.number || '',
        goals: Number(s.goals) || 0, assists: Number(s.assists) || 0,
        points: Number(s.points) || (Number(s.goals) || 0) + (Number(s.assists) || 0),
        plusMinus: Number(s.plusMinus) || 0, sog: Number(s.sog) || 0,
        pim: Number(s.pim) || 0, fow: Number(s.fow) || 0, fol: Number(s.fol) || 0
      });
    });

    const insGoalie = db.prepare(`
      INSERT INTO goalie_stats (game_id, name, ga, min, shots, saves, pim, on_seconds, off_seconds)
      VALUES (@game_id, @name, @ga, @min, @shots, @saves, @pim, @on_seconds, @off_seconds)
    `);
    goalies.forEach(gk => {
      if (!gk.name || !gk.name.trim()) return;
      insGoalie.run({
        game_id: gameId, name: gk.name, ga: Number(gk.ga) || 0, min: gk.min || '',
        shots: Number(gk.shots) || 0, saves: Number(gk.saves) || 0, pim: Number(gk.pim) || 0,
        on_seconds: (gk.on_seconds === undefined || gk.on_seconds === null) ? null : Number(gk.on_seconds),
        off_seconds: (gk.off_seconds === undefined || gk.off_seconds === null) ? null : Number(gk.off_seconds)
      });
    });
  });
  tx();

  res.json({
    skaters: db.prepare('SELECT * FROM skater_stats WHERE game_id = ?').all(gameId),
    goalies: db.prepare('SELECT * FROM goalie_stats WHERE game_id = ?').all(gameId)
  });
});

// Season totals across every stored game, computed server-side
app.get('/api/player-stats-season', (req, res) => {
  const rows = db.prepare(`
    SELECT name,
      COUNT(*) as gp,
      SUM(goals) as goals,
      SUM(assists) as assists,
      SUM(points) as points,
      SUM(plusMinus) as plusMinus,
      SUM(sog) as sog,
      SUM(pim) as pim,
      SUM(fow) as fow,
      SUM(fol) as fol
    FROM skater_stats
    GROUP BY name
    ORDER BY points DESC, goals DESC, assists DESC, name ASC
  `).all();
  res.json(rows);
});

// Per-game skater rows joined with game date/type, ordered chronologically — used for streak calculations
app.get('/api/skater-game-log', (req, res) => {
  const rows = db.prepare(`
    SELECT s.name, s.goals, s.assists, s.points, g.id as game_id, g.date as game_date, g.gametype, g.opponent
    FROM skater_stats s
    JOIN games g ON s.game_id = g.id
    ORDER BY g.date ASC, g.id ASC
  `).all();
  res.json(rows);
});

// Per-game goalie rows joined with game date/type/result, ordered chronologically — used for start streaks and GAA
app.get('/api/goalie-game-log', (req, res) => {
  const rows = db.prepare(`
    SELECT gs.name, gs.ga, gs.min, gs.shots, gs.saves, g.id as game_id, g.date as game_date, g.gametype, g.opponent, g.result
    FROM goalie_stats gs
    JOIN games g ON gs.game_id = g.id
    ORDER BY g.date ASC, g.id ASC
  `).all();
  res.json(rows);
});

// Per-goalie ice-time windows (when known) plus the opponent goals attributed to a specific
// goalie (also only when known) — used to compute time-based scoreless streaks.
app.get('/api/goalie-ice-time-log', (req, res) => {
  const segments = db.prepare(`
    SELECT gs.name, gs.on_seconds, gs.off_seconds, g.id as game_id, g.date as game_date, g.gametype
    FROM goalie_stats gs
    JOIN games g ON gs.game_id = g.id
    WHERE gs.on_seconds IS NOT NULL AND gs.off_seconds IS NOT NULL
    ORDER BY g.date ASC, g.id ASC
  `).all();
  const attributedGoals = db.prepare(`
    SELECT go.goalie as name, go.period, go.time, g.id as game_id, g.date as game_date, g.gametype
    FROM goals go
    JOIN games g ON go.game_id = g.id
    WHERE go.team = 'OPP' AND go.goalie IS NOT NULL AND go.goalie != ''
    ORDER BY g.date ASC, g.id ASC
  `).all();
  res.json({ segments, attributedGoals });
});

/* ============== GOALS LOG ============== */

app.get('/api/goals/:gameId', (req, res) => {
  const rows = db.prepare('SELECT * FROM goals WHERE game_id = ? ORDER BY id').all(req.params.gameId);
  res.json(rows);
});

app.post('/api/goals/:gameId', (req, res) => {
  const g = req.body;
  const info = db.prepare(`
    INSERT INTO goals (game_id, period, time, team, strength, scorer, assists, notes, goalie)
    VALUES (@game_id, @period, @time, @team, @strength, @scorer, @assists, @notes, @goalie)
  `).run({
    game_id: req.params.gameId, period: g.period || '', time: g.time || '',
    team: g.team || 'OTT', strength: g.strength || 'EV', scorer: g.scorer || '',
    assists: g.assists || '', notes: g.notes || '', goalie: g.goalie || null
  });
  res.json(db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/goals/entry/:id', (req, res) => {
  db.prepare('DELETE FROM goals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/goals-season-breakdown', (req, res) => {
  const gametype = req.query.gametype;
  let rows;
  if (gametype && gametype !== 'All') {
    rows = db.prepare(`
      SELECT go.team, go.strength, COUNT(*) as count
      FROM goals go JOIN games g ON go.game_id = g.id
      WHERE g.gametype = ?
      GROUP BY go.team, go.strength
    `).all(gametype);
  } else {
    rows = db.prepare('SELECT team, strength, COUNT(*) as count FROM goals GROUP BY team, strength').all();
  }
  const out = { OTT: { EV: 0, PP: 0, SH: 0, EN: 0, PS: 0 }, OPP: { EV: 0, PP: 0, SH: 0, EN: 0, PS: 0 } };
  rows.forEach(r => { if (out[r.team] && out[r.team][r.strength] !== undefined) out[r.team][r.strength] = r.count; });
  res.json(out);
});

/* ============== LINE PHOTOS (away/home) ============== */

app.get('/api/photos', (req, res) => {
  const rows = db.prepare('SELECT * FROM photos').all();
  const out = {};
  rows.forEach(r => { out[r.team] = r.dataurl; });
  res.json(out);
});

app.put('/api/photos/:team', (req, res) => {
  const team = req.params.team; // 'away' | 'home'
  const { dataurl } = req.body;
  db.prepare('INSERT INTO photos (team, dataurl) VALUES (?, ?) ON CONFLICT(team) DO UPDATE SET dataurl = excluded.dataurl')
    .run(team, dataurl);
  res.json({ ok: true });
});

app.delete('/api/photos/:team', (req, res) => {
  db.prepare('DELETE FROM photos WHERE team = ?').run(req.params.team);
  res.json({ ok: true });
});

/* ============== MEDIA KIT PDF — SPECIALTY TEAMS ============== */

// ---- Parsing the "Specialty Team Records" tables ----
// PDF text extractors format tables differently. Two layouts are handled and whichever yields more rows wins:
//   (a) cells separated by whitespace/newlines (clean text)
//   (b) cells jammed together with no separators, e.g. "2Ottawa 67's25240.00" (what pdf-parse actually produces)
// Every row is: rank, team name, GP, two counts, a percentage, and a final count.

function makeSpecialtyRow(kind, rank, team, gp, c2, c3, pct, c5) {
  return kind === 'PP'
    ? { rank, team, gp, adv: c2, gf: c3, ppPct: pct, shga: c5 }
    : { rank, team, gp, tsh: c2, ppga: c3, pkPct: pct, shgf: c5 };
}

// (a) whitespace-separated
function parseSpecialtyRowsSpaced(sectionText, kind) {
  const tokens = sectionText.split(/\s+/).filter(Boolean);
  const isInt = t => /^\d+$/.test(t);
  const isPct = t => /^\d+(\.\d+)?$/.test(t);
  let i = 0;
  while (i < tokens.length && !isInt(tokens[i])) i++;
  const rows = [];
  while (i < tokens.length && isInt(tokens[i])) {
    const rank = parseInt(tokens[i]); i++;
    const nameTokens = [];
    while (i < tokens.length && !isInt(tokens[i])) { nameTokens.push(tokens[i]); i++; }
    if (nameTokens.length === 0) break;
    const t = tokens.slice(i, i + 5);
    if (t.length < 5 || !isInt(t[0]) || !isInt(t[1]) || !isInt(t[2]) || !isPct(t[3]) || !isInt(t[4])) break;
    rows.push(makeSpecialtyRow(kind, rank, nameTokens.join(' '), parseInt(t[0]), parseInt(t[1]), parseInt(t[2]), parseFloat(t[3]), parseInt(t[4])));
    i += 5;
  }
  return rows;
}

// Does (c2, c3, pct) agree with the arithmetic that defines the percentage?
function specialtyNumbersConsistent(kind, c2, c3, pct) {
  if (c3 > c2) return false;
  if (pct < 0 || pct > 100) return false;
  if (c2 === 0) return c3 === 0;
  const expected = kind === 'PP' ? (c3 / c2) * 100 : ((c2 - c3) / c2) * 100;
  return Math.abs(expected - pct) <= 0.06;
}

// Every way of cutting a digit string into [gp, c2, c3, pctInt] that is arithmetically consistent.
function splitSpecialtyDigits(kind, digits, decDigit) {
  const results = [];
  const ok = s => s.length > 0 && (s === '0' || s[0] !== '0');
  for (let a = 1; a <= 2 && a < digits.length; a++) {
    for (let b = 1; b <= 3 && a + b < digits.length; b++) {
      for (let c = 1; c <= 3 && a + b + c < digits.length; c++) {
        const gpS = digits.slice(0, a), c2S = digits.slice(a, a + b), c3S = digits.slice(a + b, a + b + c), pS = digits.slice(a + b + c);
        if (pS.length < 1 || pS.length > 3) continue;
        if (!ok(gpS) || !ok(c2S) || !ok(c3S) || !ok(pS)) continue;
        const gp = parseInt(gpS), c2 = parseInt(c2S), c3 = parseInt(c3S), pct = parseFloat(pS + '.' + decDigit);
        if (gp < 1 || gp > 99) continue;
        if (specialtyNumbersConsistent(kind, c2, c3, pct)) results.push({ gp, c2, c3, pct });
      }
    }
  }
  return results;
}

// (b) cells jammed together, one row per line
function parseSpecialtyRowsJammed(sectionText, kind) {
  const candidates = []; // per row: { rank, team, options: [{gp,c2,c3,pct}], c5 }
  for (const rawLine of sectionText.split('\n')) {
    const line = rawLine.trim();
    const m = line.match(/^(\d{1,2})(\D.*?)(\d+)\.(\d+)$/);
    if (!m) continue;
    const rank = parseInt(m[1]), team = m[2].trim();
    const digitsBefore = m[3], afterDot = m[4];
    if (afterDot.length < 2 || team.length === 0) continue; // need a 1-digit pct decimal plus at least one digit for the last column
    const decDigit = afterDot[0], c5 = parseInt(afterDot.slice(1));
    const options = splitSpecialtyDigits(kind, digitsBefore, decDigit);
    if (options.length === 0) continue;
    candidates.push({ rank, team, options, c5 });
  }
  // Rows with exactly one valid reading anchor what a typical games-played value looks like;
  // use it to settle any row that could be read more than one way.
  const anchored = candidates.filter(c => c.options.length === 1).map(c => c.options[0].gp).sort((x, y) => x - y);
  const medianGp = anchored.length ? anchored[Math.floor(anchored.length / 2)] : null;
  return candidates.map(c => {
    let pick = c.options[0];
    if (c.options.length > 1 && medianGp !== null) {
      pick = c.options.slice().sort((x, y) => Math.abs(x.gp - medianGp) - Math.abs(y.gp - medianGp))[0];
    }
    return makeSpecialtyRow(kind, c.rank, c.team, pick.gp, pick.c2, pick.c3, pick.pct, c.c5);
  });
}

function parseSpecialtyRows(sectionText, kind) {
  const spaced = parseSpecialtyRowsSpaced(sectionText, kind);
  const jammed = parseSpecialtyRowsJammed(sectionText, kind);
  return jammed.length > spaced.length ? jammed : spaced;
}

function parseSpecialtyTeamsFromText(fullText) {
  const specIdx = fullText.search(/Specialty\s*Team\s*Records/i);
  const base = specIdx >= 0 ? fullText.slice(specIdx) : fullText;
  const ppMatch = base.match(/Team\s*Power\s*Play/i);
  const pkMatch = base.match(/Team\s*Penalty\s*Kill/i);
  let pp = [], pk = [];
  if (ppMatch) {
    const ppStart = ppMatch.index + ppMatch[0].length;
    const ppEnd = (pkMatch && pkMatch.index > ppStart) ? pkMatch.index : base.length;
    pp = parseSpecialtyRows(base.slice(ppStart, ppEnd), 'PP');
  }
  if (pkMatch) {
    const pkStart = pkMatch.index + pkMatch[0].length;
    const otMatch = base.slice(pkStart).match(/Team\s*Overtime/i);
    pk = parseSpecialtyRows(base.slice(pkStart, otMatch ? pkStart + otMatch.index : undefined), 'PK');
  }
  return { pp, pk };
}

app.post('/api/fetch-specialty-teams', async (req, res) => {
  const { url } = req.body;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'A valid http(s) URL is required.' });
  try {
    const pdfRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
    });
    if (!pdfRes.ok) return res.status(502).json({ error: 'Could not download the PDF (status ' + pdfRes.status + ').' });
    const buffer = Buffer.from(await pdfRes.arrayBuffer());

    // pdf-parse bundles several PDF-reading engines. Each has quirks — one may fail outright on a file
    // another reads fine, or lay out table text differently — so try them in turn until one yields the tables.
    const engines = [undefined, 'v2.0.550', 'v1.10.88', 'v1.9.426'];
    let firstText = null, lastError = null;
    for (const version of engines) {
      try {
        const parsed = await pdfParse(buffer, version ? { version } : undefined);
        if (firstText === null) firstText = parsed.text;
        const { pp, pk } = parseSpecialtyTeamsFromText(parsed.text);
        if (pp.length > 0 || pk.length > 0) return res.json({ pp, pk });
      } catch (e) {
        lastError = e;
      }
    }

    if (firstText === null) {
      return res.status(500).json({ error: 'Downloaded the file but could not read it as a PDF: ' + (lastError ? lastError.message : 'unknown error') });
    }
    const idx = firstText.search(/specialty/i);
    const debugExcerpt = idx >= 0
      ? firstText.slice(Math.max(0, idx - 100), idx + 2000)
      : '(the word "Specialty" was not found anywhere in the extracted text — showing the first 1500 characters instead)\n\n' + firstText.slice(0, 1500);
    return res.status(422).json({
      error: 'Downloaded the PDF but could not find a "Specialty Team Records" section in it — the layout may not match what this parser expects.',
      debugExcerpt
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch or parse the PDF: ' + err.message });
  }
});

/* ============== GAME LINEUPS PDF ============== */
// The league publishes a per-game lineup PDF: both rosters, forward lines and D pairs written as jersey
// numbers only, the starting goalie, scratches, and the on-ice officials. This reads it and resolves every
// number to a full name so the spotting board can be filled in automatically.

// Rebuild text from a PDF page using each piece of text's position, so table cells stay properly
// separated. (pdf-parse's default output glues cells in the same row together with no gaps at all.)
function lineupLayoutText(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4], y = it.transform[5];
    let row = rows.find(r => Math.abs(r.y - y) <= 1.5);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ x, w: it.width || 0, str: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    let out = '', prevEnd = null;
    for (const it of r.items) {
      if (prevEnd !== null && it.x - prevEnd > 1.0) out += ' ';
      out += it.str;
      prevEnd = it.x + it.w;
    }
    return out;
  }).join('\n');
}
function lineupLayoutRender(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then(tc => lineupLayoutText(tc.items));
}

function lineupTitleCase(s) {
  return (s || '').replace(/\s+/g, ' ').trim().split(' ')
    .map(w => (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) ? w[0] + w.slice(1).toLowerCase() : w).join(' ');
}

// "Van Volsen, Jack A" -> "Jack Van Volsen". The trailing C / A is a captain / assistant marker, not part of the name;
// depending on the extractor it arrives either as " A" or glued straight onto the name ("JackA").
function lineupFullName(raw) {
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+[CA]$/, '').replace(/([a-z])[CA]$/, '$1');
  const m = s.match(/^(.+?),\s*(.+)$/);
  return m ? (m[2].trim() + ' ' + m[1].trim()) : s;
}

// Cut a run of digits into `count` jersey numbers that all exist on the roster (no repeats).
function lineupSplitNumbers(digits, count, valid) {
  let found = null;
  (function go(pos, k, acc) {
    if (found) return;
    if (k === count) { if (pos === digits.length) found = acc.slice(); return; }
    for (let len = 2; len >= 1; len--) {
      const part = digits.slice(pos, pos + len);
      if (part.length !== len || (len > 1 && part[0] === '0')) continue;
      const n = parseInt(part, 10);
      if (!valid.has(n) || acc.includes(n)) continue;
      acc.push(n); go(pos + len, k + 1, acc); acc.pop();
    }
  })(0, 0, []);
  return found;
}

// A forward line: "14 11 55" (or jammed "141155") -> [14, 11, 55]
function lineupDecodeLine(str, valid) {
  const t = (str || '').trim();
  if (!t) return [];
  const tokens = t.split(/\s+/);
  if (tokens.every(x => /^\d{1,2}$/.test(x)) && tokens.every(x => valid.has(parseInt(x, 10)))) return tokens.map(x => parseInt(x, 10));
  const digits = t.replace(/\D/g, '');
  for (const cnt of [3, 2, 1]) {
    const sol = lineupSplitNumbers(digits, cnt, valid);
    if (sol) return sol;
  }
  return [];
}

// The defense block reads "Def 1 6 41 ... Def 2 2 18 ... Def 3 43 15 ... Def 4" with the goalie column mixed in
// ("Starting", "# 34"). Drop the goalie bits and every letter, and what's left is the labels 1..4, each followed by
// zero or two jersey numbers — which can be decoded reliably however the extractor spaced or garbled the text.
function lineupDecodeDefense(sectionText, valid) {
  const s = (sectionText || '').replace(/#\s*\d+/g, ' ').replace(/Starting|Substitute/gi, ' ');
  const digits = s.replace(/\D/g, '');
  let solution = null;
  (function go(pos, j, acc) {
    if (solution) return;
    if (j > 4) { if (pos === digits.length) solution = acc.slice(); return; }
    if (pos >= digits.length) { go(pos, j + 1, acc.concat([[null, null]])); return; }
    if (digits[pos] !== String(j)) return;
    const p = pos + 1;
    for (let l1 = 2; l1 >= 1; l1--) {
      for (let l2 = 2; l2 >= 1; l2--) {
        const a = digits.slice(p, p + l1), b = digits.slice(p + l1, p + l1 + l2);
        if (a.length !== l1 || b.length !== l2 || a[0] === '0' || b[0] === '0') continue;
        const ld = parseInt(a, 10), rd = parseInt(b, 10);
        if (valid.has(ld) && valid.has(rd) && ld !== rd) go(p + l1 + l2, j + 1, acc.concat([[ld, rd]]));
      }
    }
    go(p, j + 1, acc.concat([[null, null]]));
  })(0, 1, []);
  return solution || [[null, null], [null, null], [null, null], [null, null]];
}

function parseLineupTeamBlock(block) {
  const lines = block.split('\n').map(l => l.replace(/\t/g, ' ').trim()).filter(Boolean);
  const text = lines.join('\n');
  // team name: whatever follows the VIS / HOM marker (same line, or the next line)
  const markerLine = lines[0] || '';
  let rawName = markerLine.replace(/^(VIS|HOM)/, '').trim();
  if (!rawName) rawName = lines[1] || '';
  const name = lineupTitleCase(rawName);

  // roster: everything between the column header and the "Forwards lines" heading
  const rosterStart = text.search(/Roster\s*Status/i);
  const fwdHeading = text.search(/Forwards?\s*lines/i);
  const rosterText = text.slice(rosterStart >= 0 ? rosterStart : 0, fwdHeading >= 0 ? fwdHeading : undefined);
  const rosterLines = rosterText.split('\n').map(l => l.trim()).filter(Boolean);
  const skaters = [], goalies = [];
  let k = 1;
  for (const l of rosterLines) {
    let m = l.match(/^(GB|GK)\s*(\d{1,2})\s*([A-Za-z].*)$/);
    if (m) { goalies.push({ status: m[1], number: parseInt(m[2], 10), name: lineupFullName(m[3]) }); continue; }
    const idx = String(k);
    if (l.startsWith(idx)) {
      m = l.slice(idx.length).trim().match(/^(\d{1,2})\s*([A-Za-z].*)$/);
      if (m) { skaters.push({ number: parseInt(m[1], 10), name: lineupFullName(m[2]) }); k++; continue; }
    }
    m = l.match(/^\d{1,2}\s+(\d{1,2})\s+([A-Za-z].*)$/);
    if (m) { skaters.push({ number: parseInt(m[1], 10), name: lineupFullName(m[2]) }); k++; }
  }
  const byNumber = {};
  skaters.concat(goalies).forEach(p => { byNumber[p.number] = { number: p.number, name: p.name }; });
  const valid = new Set(Object.keys(byNumber).map(n => parseInt(n, 10)));
  const who = n => (n === null || n === undefined) ? null : (byNumber[n] || null);

  // forward lines
  const fwdEnd = text.search(/LD\s*RD\s*GK/i);
  const fwdText = text.slice(fwdHeading >= 0 ? fwdHeading : 0, fwdEnd >= 0 ? fwdEnd : undefined);
  const forwards = [];
  for (const l of fwdText.split('\n')) {
    const m = l.trim().match(/^Line\s*(\d)(.*)$/i);
    if (!m) continue;
    const nums = lineupDecodeLine(m[2], valid);
    forwards[parseInt(m[1], 10) - 1] = { lw: who(nums[0]), c: who(nums[1]), rw: who(nums[2]) };
  }
  for (let i = 0; i < 5; i++) if (!forwards[i]) forwards[i] = { lw: null, c: null, rw: null };

  // defense pairs + goalie designation
  const defStart = fwdEnd;
  let defText = '';
  if (defStart >= 0) {
    const rest = text.slice(defStart);
    const stop = rest.search(/(The\s+\d+\w*\s+player|Scratches)/i);
    defText = stop >= 0 ? rest.slice(0, stop) : rest;
  }
  const defense = lineupDecodeDefense(defText, valid).map(([ld, rd]) => ({ ld: who(ld), rd: who(rd) }));
  const goalieNums = new Set(goalies.map(g => g.number));
  const st = defText.match(/Starting[\s\S]*?#\s*(\d+)/i), sb = defText.match(/Substitute[\s\S]*?#\s*(\d+)/i);
  let starterNum = st ? parseInt(st[1], 10) : null;
  let backupNum = sb ? parseInt(sb[1], 10) : null;
  const gb = goalies.find(g => g.status === 'GB');
  if (gb && starterNum !== gb.number) starterNum = gb.number;      // roster's explicit flag wins on any disagreement
  if (starterNum === null || !goalieNums.has(starterNum)) starterNum = goalies.length ? goalies[0].number : null;
  if (backupNum === null || !goalieNums.has(backupNum) || backupNum === starterNum) {
    const other = goalies.find(g => g.number !== starterNum);
    backupNum = other ? other.number : null;
  }

  // scratches
  const scStart = text.search(/Scratches/i);
  let scratches = [];
  if (scStart >= 0) {
    const rest = text.slice(scStart);
    const stop = rest.search(/Hockey\s*Staff/i);
    const sect = stop >= 0 ? rest.slice(0, stop) : rest;
    const re = /#\s*(\d{1,2})\s*([A-Za-z][^#\n]*)/g;
    let m;
    while ((m = re.exec(sect)) !== null) scratches.push({ number: parseInt(m[1], 10), name: lineupFullName(m[2]) });
  }

  return {
    name, isOttawa: /ottawa|67/i.test(name),
    rosterCount: skaters.length + goalies.length,
    forwards, defense,
    goalies: { starter: who(starterNum), backup: who(backupNum) },
    scratches
  };
}

function parseLineupText(fullText) {
  const text = (fullText || '').replace(/\r/g, '');
  const officialsIdx = text.search(/ON-ICE\s*OFFICIALS/i);
  const markerRe = /(?:^|\n)[ \t]*(VIS|HOM)(?![a-z])/g;
  const marks = [];
  let mm;
  while ((mm = markerRe.exec(text)) !== null) marks.push({ side: mm[1], pos: mm.index + (mm[0].startsWith('\n') ? 1 : 0) });
  if (marks.length < 2) return { ok: false, reason: 'Could not find both team sections (VIS / HOM).' };
  marks.sort((a, b) => a.pos - b.pos);
  const end = officialsIdx > marks[1].pos ? officialsIdx : text.length;
  const header = text.slice(0, marks[0].pos);
  const teams = [
    { side: marks[0].side, ...parseLineupTeamBlock(text.slice(marks[0].pos, marks[1].pos)) },
    { side: marks[1].side, ...parseLineupTeamBlock(text.slice(marks[1].pos, end)) }
  ];

  const dm = header.match(/DATE\s*(\d{4}-\d{2}-\d{2})/i);
  const am = header.match(/ARENA\s*([^\n]+)/i);
  let gameType = null;
  if (/\bPlay/i.test(header)) gameType = 'Playoffs';
  else if (/\bPre\b|Pre-?season/i.test(header)) gameType = 'Preseason';
  else if (/\bReg\b/i.test(header)) gameType = 'Regular Season';
  const game = { date: dm ? dm[1] : null, arena: am ? am[1].trim() : null, gameType };

  const officials = { referees: [], linesmen: [] };
  if (officialsIdx >= 0) {
    const off = text.slice(officialsIdx);
    const lm = off.search(/LINESMEN/i);
    const refText = lm >= 0 ? off.slice(0, lm) : off;
    const linText = lm >= 0 ? off.slice(lm) : '';
    const grab = (t, arr) => {
      for (const l of t.split('\n')) {
        const m = l.replace(/\t/g, ' ').trim().match(/^(\d{1,3})\s*([A-Za-z][A-Za-z ,.'\-]*)$/);
        if (m) arr.push({ number: parseInt(m[1], 10), name: lineupFullName(m[2]) });
      }
    };
    grab(refText, officials.referees);
    grab(linText, officials.linesmen);
  }

  const usable = teams.every(t => t.rosterCount >= 10 && t.forwards.filter(f => f.lw || f.c || f.rw).length >= 2);
  if (!usable) return { ok: false, reason: 'Found the team sections but could not read enough of the rosters and lines.', teams, game, officials };
  return { ok: true, game, teams, officials };
}

// Try each combination of layout-aware / default text and PDF engine until one reads cleanly.
async function extractLineupsFromBuffer(buffer) {
  const attempts = [
    { version: undefined, layout: true }, { version: undefined, layout: false },
    { version: 'v2.0.550', layout: true }, { version: 'v2.0.550', layout: false },
    { version: 'v1.10.88', layout: true }
  ];
  let firstLayout = null, firstDefault = null, lastError = null, lastReason = null;
  for (const a of attempts) {
    try {
      const opts = {};
      if (a.version) opts.version = a.version;
      if (a.layout) opts.pagerender = lineupLayoutRender;
      const parsed = await pdfParse(buffer, opts);
      if (a.layout && firstLayout === null) firstLayout = parsed.text;
      if (!a.layout && firstDefault === null) firstDefault = parsed.text;
      const r = parseLineupText(parsed.text);
      if (r.ok) return { result: r };
      lastReason = r.reason;
    } catch (e) { lastError = e; }
  }
  if (firstLayout === null && firstDefault === null) {
    return { error: 'Could not read that file as a PDF: ' + (lastError ? lastError.message : 'unknown error'), status: 500 };
  }
  const debugExcerpt = '--- text as laid out by position ---\n' + (firstLayout || '(unavailable)').slice(0, 2600) +
    '\n\n--- text as the PDF reader normally returns it ---\n' + (firstDefault || '(unavailable)').slice(0, 1800);
  return { error: 'Read the PDF but could not make sense of the lineup layout' + (lastReason ? ' (' + lastReason + ')' : '') + '.', debugExcerpt, status: 422 };
}

app.post('/api/fetch-lineups', async (req, res) => {
  const { url } = req.body;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'A valid http(s) URL is required.' });
  try {
    const pdfRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' } });
    if (!pdfRes.ok) return res.status(502).json({ error: 'Could not download the PDF (status ' + pdfRes.status + ').' });
    const out = await extractLineupsFromBuffer(Buffer.from(await pdfRes.arrayBuffer()));
    if (out.error) return res.status(out.status).json({ error: out.error, debugExcerpt: out.debugExcerpt });
    res.json(out.result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch or read the lineup PDF: ' + err.message });
  }
});

app.post('/api/parse-lineups', async (req, res) => {
  const { dataurl } = req.body;
  const m = (dataurl || '').match(/^data:application\/pdf;base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'Expected a PDF file.' });
  try {
    const out = await extractLineupsFromBuffer(Buffer.from(m[1], 'base64'));
    if (out.error) return res.status(out.status).json({ error: out.error, debugExcerpt: out.debugExcerpt });
    res.json(out.result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read the lineup PDF: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Ottawa 67's Broadcast Toolkit running on port ${PORT}`);
});
