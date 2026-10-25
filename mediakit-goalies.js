'use strict';
// Reads each goalie's record, GAA and SV% from the "Pre-Game" page of the league's game media kit PDF
// (the two GOALIES tables at the top of page 2: # Name Ht Wt GP W L OTL SL SO GAA SV%).
//
// Loaded from server.js with one line:   require('./mediakit-goalies')(app, pdfParse);
// It adds   POST /api/fetch-goalie-records   { url }   ->   { teams: [ { team, goalies: [ {...} ] }, ... ] }

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/* ---------- reading the PDF so table cells keep their gaps ---------- */
// pdf-parse's default text glues cells on the same row together with no gaps at all, so rebuild each line
// from the position of every piece of text instead (cells then come out separated by spaces).
function layoutText(items) {
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
function layoutRender(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then(tc => layoutText(tc.items));
}

/* ---------- turning the GOALIES tables into rows ---------- */
const HEADER_RE = /#\s*Name\s*Ht\s*Wt\s*GP\s*W\s*L\s*OTL\s*SL\s*SO\s*GAA\s*SV%/i;
// Ht Wt GP W L OTL SL SO GAA SV%  with single spaces between cells
const SPACED_TAIL = /(\d\.\d{2}) (\d{2,3}) (\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}\.\d{2}) ([01]\.\d{3})/g;
// the same cells with nothing between them: Ht, then one run of digits (Wt + the six counts + the whole-number part of GAA), then .dd and SV%
const JAMMED_TAIL = /(\d\.\d{2})(\d{10,})\.(\d{2})([01]\.\d{3})/g;

// Cut the digit run of a jammed row back into Wt, GP, W, L, OTL, SL, SO and GAA. Stats with two digits can be
// cut apart in more than one valid way (28-11-6-6 and 28-1-16-6 use the same digits), so this NEVER guesses:
// unless exactly one reading is possible it returns null and the row is skipped rather than risk a wrong number
// on air. (The position-based text, which keeps the cells apart, doesn't have this problem and is used first.)
function decodeJammedStats(ht, blob, gaaDec, sv) {
  const cands = [];
  const wtLen = 3;                                              // goalies weigh 100+ lbs, so always three digits
  if (blob.length < wtLen + 7) return null;                    // weight + six counts + at least one digit of GAA
  const wt = blob.slice(0, wtLen), rest = blob.slice(wtLen);
  for (const k of [1, 2]) {
    const gInt = rest.slice(-k), counts = rest.slice(0, -k);
    if (counts.length < 6 || counts.length > 12) continue;
    if (k === 2 && gInt[0] === '0') continue;
    const gaa = gInt + '.' + gaaDec;
    if (parseFloat(gaa) > 30) continue;
    (function split(pos, acc) {
      if (acc.length === 6) {
        if (pos !== counts.length) return;
        const [gp, w, l, otl, sl, so] = acc;
        if (gp > 70 || w > 60 || l > 60 || otl > 25 || sl > 25 || so > 20) return;   // beyond a real OHL season
        if (w + l + otl + sl > gp || so > w) return;
        if (gp === 0 && (parseFloat(gaa) !== 0 || parseFloat(sv) !== 0)) return;
        cands.push({ wt: parseInt(wt, 10), gp, w, l, otl, sl, so, gaa });
        return;
      }
      for (let len = 1; len <= 2; len++) {
        const part = counts.slice(pos, pos + len);
        if (part.length !== len || (len === 2 && part[0] === '0')) continue;
        acc.push(parseInt(part, 10)); split(pos + len, acc); acc.pop();
      }
    })(0, []);
  }
  if (!cands.length) return null;
  const same = (a, b) => a.gp === b.gp && a.w === b.w && a.l === b.l && a.otl === b.otl && a.sl === b.sl && a.so === b.so && a.gaa === b.gaa;
  return cands.every(c => same(c, cands[0])) ? cands[0] : null;                       // more than one possible reading: don't guess
}

const HEAD_RE = /^(\D*?)\s*(\d{1,2})\s*(\D*)$/;
function joinFragments(a, b) {
  if (!a) return b || ''; if (!b) return a;
  return /-$/.test(a) ? a + b : a + ' ' + b;
}
const cleanName = s => (s || '').replace(/\s+/g, ' ').replace(/[^A-Za-z\u00C0-\u024F'’.\- ]/g, '').trim();

// `heads` are the bits of text sitting between one row's stats and the next; they carry the jersey number
// and the name (which can wrap, leaving a piece above or below the row). rows[i].head belongs with rows[i].
function assignNumbersAndNames(rows, trailing) {
  rows.forEach((r, i) => {
    let m = r.head.match(HEAD_RE), before = '', after = '';
    if (m) { before = cleanName(m[1]); r.number = parseInt(m[2], 10); after = cleanName(m[3]); }
    else { const any = r.head.match(/\d{1,2}/); r.number = any ? parseInt(any[0], 10) : null; before = cleanName(r.head.replace(/\d+/g, ' ')); }
    if (after) {                                   // number is followed by the name; anything before it is the previous row's wrapped tail
      if (before && i > 0) rows[i - 1].name = joinFragments(rows[i - 1].name, before);
      r.name = after;
    } else if (before && i > 0 && !rows[i - 1].name) {
      // the name is written AFTER a row's numbers, so a name sitting before this row's number belongs to the row above
      rows[i - 1].name = before;
    } else r.name = before;
  });
  if (rows.length && trailing) rows[rows.length - 1].name = joinFragments(rows[rows.length - 1].name, cleanName(trailing));
  rows.forEach(r => { delete r.head; });
  return rows;
}

function rowFromCells(ht, wt, gp, w, l, otl, sl, so, gaa, sv) {
  return { ht, wt: Number(wt), gp: Number(gp), w: Number(w), l: Number(l), otl: Number(otl), sl: Number(sl), so: Number(so), gaa, svPct: sv };
}

function scanSpaced(text) {
  const flat = text.replace(HEADER_RE, ' ').replace(/\s+/g, ' ').trim();
  const rows = []; let prevEnd = 0, m;
  const re = new RegExp(SPACED_TAIL.source, 'g');
  while ((m = re.exec(flat)) !== null) {
    rows.push({ head: flat.slice(prevEnd, m.index).trim(), ...rowFromCells(m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10]) });
    prevEnd = m.index + m[0].length;
  }
  return assignNumbersAndNames(rows, flat.slice(prevEnd));
}

function scanJammed(text) {
  const z = text.replace(HEADER_RE, ' ').replace(/[ \t]*\n[ \t]*/g, '').trim();
  const rows = []; let prevEnd = 0, m;
  const re = new RegExp(JAMMED_TAIL.source, 'g');
  while ((m = re.exec(z)) !== null) {
    const d = decodeJammedStats(m[1], m[2], m[3], m[4]);
    const head = z.slice(prevEnd, m.index).trim();
    rows.push(d ? { head, ...rowFromCells(m[1], d.wt, d.gp, d.w, d.l, d.otl, d.sl, d.so, d.gaa, m[4]) } : { head, skipped: true });
    prevEnd = m.index + m[0].length;                  // consumed either way, so its text can't leak into the next row
  }
  assignNumbersAndNames(rows, z.slice(prevEnd));
  return { rows: rows.filter(r => !r.skipped), skipped: rows.filter(r => r.skipped).length };
}

function plausible(g) {
  return Number.isInteger(g.number) && g.number >= 0 && g.gp >= 0 && g.gp <= 99 && parseFloat(g.gaa) < 30 &&
    parseFloat(g.svPct) >= 0 && parseFloat(g.svPct) <= 1;
}

// Both GOALIES tables, in the order they appear, labelled with the team names from the "A (rec) vs. B (rec)" heading
function parseMediaKitGoalies(text) {
  const t = (text || '').replace(/\r/g, '');
  const blocks = [];
  const re = /GOALIES/g;
  let m;
  while ((m = re.exec(t)) !== null && blocks.length < 2) {
    const after = t.slice(m.index + m[0].length);
    const stop = after.search(/SKATERS/);
    blocks.push({ at: m.index, body: stop >= 0 ? after.slice(0, stop) : after.slice(0, 1500) });
  }
  if (!blocks.length) return { ok: false, reason: 'No GOALIES table found.' };

  let names = null;
  const near = t.slice(Math.max(0, blocks[0].at - 900), blocks[0].at);
  const hm = near.match(/([^\n(]*?)\s*\(\d+-\d+-\d+-\d+\)\s*vs\.?\s*([^\n(]*?)\s*\(\d+-\d+-\d+-\d+\)/i);
  if (hm) names = [hm[1].trim(), hm[2].trim()];

  const teams = blocks.map((b, i) => {
    let goalies = scanSpaced(b.body).filter(plausible), skipped = 0;
    if (!goalies.length) { const j = scanJammed(b.body); goalies = j.rows.filter(plausible); skipped = j.skipped; }
    return { team: names ? names[i] || null : null, goalies, skipped };
  });
  if (!teams.some(x => x.goalies.length)) return { ok: false, reason: 'Found the GOALIES heading but could not read any goalie rows.', teams };
  return { ok: true, teams };
}

/* ---------- download + read ---------- */
async function extractGoalieRecords(pdfParse, buffer) {
  const attempts = [
    { version: undefined, layout: true }, { version: undefined, layout: false },
    { version: 'v2.0.550', layout: true }, { version: 'v2.0.550', layout: false }
  ];
  let firstLayout = null, firstDefault = null, lastError = null, lastReason = null;
  for (const a of attempts) {
    try {
      const opts = { max: 4 };                                   // the goalie tables are at the top; no need to read the whole kit
      if (a.version) opts.version = a.version;
      if (a.layout) opts.pagerender = layoutRender;
      const parsed = await pdfParse(buffer, opts);
      if (a.layout && firstLayout === null) firstLayout = parsed.text;
      if (!a.layout && firstDefault === null) firstDefault = parsed.text;
      const r = parseMediaKitGoalies(parsed.text);
      if (r.ok) return { teams: r.teams };
      lastReason = r.reason;
    } catch (e) { lastError = e; }
  }
  if (firstLayout === null && firstDefault === null) {
    return { error: 'Could not read that file as a PDF: ' + (lastError ? lastError.message : 'unknown error'), status: 500 };
  }
  const around = txt => {
    if (!txt) return '(unavailable)';
    const i = txt.search(/GOALIES/);
    return i >= 0 ? txt.slice(Math.max(0, i - 200), i + 1800) : '(no GOALIES heading found; start of file follows)\n' + txt.slice(0, 1500);
  };
  return {
    error: 'Read the media kit but could not find the goalie records' + (lastReason ? ' (' + lastReason + ')' : '') + '.',
    debugExcerpt: '--- text as laid out by position ---\n' + around(firstLayout) + '\n\n--- text as the PDF reader normally returns it ---\n' + around(firstDefault),
    status: 422
  };
}

function register(app, pdfParse) {
  app.post('/api/fetch-goalie-records', async (req, res) => {
    const url = req.body && req.body.url;
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'A valid http(s) URL is required.' });
    try {
      const pdfRes = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
      if (!pdfRes.ok) return res.status(502).json({ error: 'Could not download the PDF (status ' + pdfRes.status + ').' });
      const out = await extractGoalieRecords(pdfParse, Buffer.from(await pdfRes.arrayBuffer()));
      if (out.error) return res.status(out.status).json({ error: out.error, debugExcerpt: out.debugExcerpt });
      res.json({ teams: out.teams });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch or read the media kit: ' + err.message });
    }
  });
}

module.exports = register;
module.exports.parseMediaKitGoalies = parseMediaKitGoalies;
module.exports.extractGoalieRecords = extractGoalieRecords;
module.exports.decodeJammedStats = decodeJammedStats;
