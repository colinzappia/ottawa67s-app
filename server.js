const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
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
      INSERT INTO goalie_stats (game_id, name, ga, min, shots, saves, pim)
      VALUES (@game_id, @name, @ga, @min, @shots, @saves, @pim)
    `);
    goalies.forEach(gk => {
      if (!gk.name || !gk.name.trim()) return;
      insGoalie.run({
        game_id: gameId, name: gk.name, ga: Number(gk.ga) || 0, min: gk.min || '',
        shots: Number(gk.shots) || 0, saves: Number(gk.saves) || 0, pim: Number(gk.pim) || 0
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
    ORDER BY points DESC, goals DESC
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

/* ============== GOALS LOG ============== */

app.get('/api/goals/:gameId', (req, res) => {
  const rows = db.prepare('SELECT * FROM goals WHERE game_id = ? ORDER BY id').all(req.params.gameId);
  res.json(rows);
});

app.post('/api/goals/:gameId', (req, res) => {
  const g = req.body;
  const info = db.prepare(`
    INSERT INTO goals (game_id, period, time, team, strength, scorer, assists, notes)
    VALUES (@game_id, @period, @time, @team, @strength, @scorer, @assists, @notes)
  `).run({
    game_id: req.params.gameId, period: g.period || '', time: g.time || '',
    team: g.team || 'OTT', strength: g.strength || 'EV', scorer: g.scorer || '',
    assists: g.assists || '', notes: g.notes || ''
  });
  res.json(db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/goals/entry/:id', (req, res) => {
  db.prepare('DELETE FROM goals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/goals-season-breakdown', (req, res) => {
  const rows = db.prepare('SELECT team, strength, COUNT(*) as count FROM goals GROUP BY team, strength').all();
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

app.listen(PORT, () => {
  console.log(`Ottawa 67's Broadcast Toolkit running on port ${PORT}`);
});
