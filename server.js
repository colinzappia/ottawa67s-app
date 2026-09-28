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

app.listen(PORT, () => {
  console.log(`Ottawa 67's Broadcast Toolkit running on port ${PORT}`);
});
