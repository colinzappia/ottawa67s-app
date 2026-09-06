// Optional: run `node seed.js` once after first setup to pre-load the
// Aug 30, 2026 preseason game vs Kingston, so you have sample data to explore.
const db = require('./db');
const crypto = require('crypto');

const existing = db.prepare('SELECT COUNT(*) as c FROM games').get();
if (existing.c > 0) {
  console.log('Games already exist — skipping seed.');
  process.exit(0);
}

const id = crypto.randomUUID();

db.prepare(`
  INSERT INTO games (id, gametype, date, opponent, venue, result, gf, ga, sf, sa,
    ppg, ppo, pk_against, pk_ga, shgf, shga, engf, enga, sogf, soga, psgf, psga,
    goalie, attendance, notes)
  VALUES (@id, @gametype, @date, @opponent, @venue, @result, @gf, @ga, @sf, @sa,
    @ppg, @ppo, @pk_against, @pk_ga, @shgf, @shga, @engf, @enga, @sogf, @soga, @psgf, @psga,
    @goalie, @attendance, @notes)
`).run({
  id, gametype: 'Preseason', date: '2026-08-30', opponent: 'Kingston Frontenacs',
  venue: 'Away', result: 'W', gf: 6, ga: 2, sf: 36, sa: 31,
  ppg: 0, ppo: 2, pk_against: 4, pk_ga: 0,
  shgf: 0, shga: 0, engf: 0, enga: 0, sogf: 0, soga: 0, psgf: 0, psga: 0,
  goalie: 'Jaeden Nelson', attendance: '',
  notes: "Bowes 2G, Balanyk 2G, Eshkawkogan 1G-1A, Packalen 2A. Nelson 22/23 in 40:00, Smolcic 7/8 in relief."
});

const skaters = [
  { name: 'Campbell, Cade', pos: 'LD', number: '2', goals: 0, assists: 1, points: 1, plusMinus: 1, sog: 0, pim: 2, fow: 0, fol: 0 },
  { name: 'Dietsch, Kaleb', pos: 'RD', number: '4', goals: 0, assists: 1, points: 1, plusMinus: 2, sog: 1, pim: 0, fow: 0, fol: 0 },
  { name: 'Laurin, Andrew', pos: 'RW', number: '9', goals: 0, assists: 0, points: 0, plusMinus: 0, sog: 4, pim: 0, fow: 0, fol: 0 },
  { name: 'Hayes, Reid', pos: 'C', number: '11', goals: 0, assists: 0, points: 0, plusMinus: 0, sog: 5, pim: 0, fow: 3, fol: 9 },
  { name: 'Bowes, Spencer', pos: 'LW', number: '12', goals: 2, assists: 1, points: 3, plusMinus: 5, sog: 5, pim: 0, fow: 0, fol: 1 },
  { name: 'Yanni, Chase', pos: 'RW', number: '16', goals: 0, assists: 0, points: 0, plusMinus: 0, sog: 1, pim: 2, fow: 0, fol: 0 },
  { name: 'Chitaroni, Brock', pos: 'C', number: '17', goals: 0, assists: 0, points: 0, plusMinus: 0, sog: 2, pim: 0, fow: 3, fol: 8 },
  { name: 'Krawczyk, Brayden', pos: 'C', number: '18', goals: 0, assists: 0, points: 0, plusMinus: -1, sog: 1, pim: 0, fow: 7, fol: 6 },
  { name: 'Eshkawkogan, Kohyn', pos: 'RD', number: '19', goals: 1, assists: 1, points: 2, plusMinus: 1, sog: 3, pim: 0, fow: 0, fol: 0 },
  { name: 'Balanyk, Lucas', pos: 'RW', number: '20', goals: 2, assists: 0, points: 2, plusMinus: 4, sog: 3, pim: 0, fow: 0, fol: 0 },
  { name: 'Gauthier, Caleb', pos: 'LD', number: '21', goals: 0, assists: 0, points: 0, plusMinus: 2, sog: 1, pim: 0, fow: 0, fol: 0 },
  { name: 'Johnson, Jack', pos: 'RD', number: '22', goals: 0, assists: 1, points: 1, plusMinus: 3, sog: 0, pim: 2, fow: 0, fol: 0 },
  { name: 'Spitznagel, Teddy', pos: 'LW', number: '24', goals: 0, assists: 0, points: 0, plusMinus: -1, sog: 2, pim: 0, fow: 1, fol: 2 },
  { name: 'Packalen, Hannu', pos: 'C', number: '26', goals: 0, assists: 2, points: 2, plusMinus: 5, sog: 3, pim: 0, fow: 3, fol: 7 },
  { name: 'Jackson, Nolan', pos: 'RD', number: '27', goals: 0, assists: 0, points: 0, plusMinus: -1, sog: 1, pim: 0, fow: 0, fol: 0 },
  { name: 'Grima, Brayden', pos: 'LW', number: '28', goals: 0, assists: 0, points: 0, plusMinus: 1, sog: 2, pim: 0, fow: 1, fol: 1 },
  { name: 'Coombe, Colby', pos: 'LW', number: '37', goals: 0, assists: 0, points: 0, plusMinus: -1, sog: 0, pim: 2, fow: 0, fol: 0 },
  { name: 'Blyth, Brayden', pos: 'RW', number: '39', goals: 1, assists: 0, points: 1, plusMinus: 0, sog: 2, pim: 0, fow: 0, fol: 1 }
];
const insSkater = db.prepare(`
  INSERT INTO skater_stats (game_id, name, pos, number, goals, assists, points, plusMinus, sog, pim, fow, fol)
  VALUES (@game_id, @name, @pos, @number, @goals, @assists, @points, @plusMinus, @sog, @pim, @fow, @fol)
`);
skaters.forEach(s => insSkater.run({ game_id: id, ...s }));

const goalies = [
  { name: 'Smolcic, Marcus', ga: 1, min: '20:00', shots: 8, saves: 7, pim: 0 },
  { name: 'Nelson, Jaeden', ga: 1, min: '40:00', shots: 23, saves: 22, pim: 0 }
];
const insGoalie = db.prepare(`
  INSERT INTO goalie_stats (game_id, name, ga, min, shots, saves, pim)
  VALUES (@game_id, @name, @ga, @min, @shots, @saves, @pim)
`);
goalies.forEach(g => insGoalie.run({ game_id: id, ...g }));

const goals = [
  { period: '1st', time: '3:51', team: 'OPP', strength: 'EV', scorer: 'Aleks Kulemin', assists: 'Nolan Buttar, Landon Wright', notes: '' },
  { period: '1st', time: '19:26', team: 'OTT', strength: 'EV', scorer: 'Kohyn Eshkawkogan', assists: 'Kaleb Dietsch', notes: '' },
  { period: '2nd', time: '3:10', team: 'OPP', strength: 'EV', scorer: 'Brayden Blyth', assists: '', notes: '' },
  { period: '2nd', time: '4:27', team: 'OTT', strength: 'EV', scorer: 'Spencer Bowes', assists: 'Kohyn Eshkawkogan', notes: 'Game winning goal' },
  { period: '2nd', time: '7:20', team: 'OTT', strength: 'EV', scorer: 'Lucas Balanyk', assists: 'Spencer Bowes, Hannu Packalen', notes: 'Insurance goal' },
  { period: '2nd', time: '16:49', team: 'OTT', strength: 'EV', scorer: 'Spencer Bowes', assists: 'Jack Johnson', notes: '' },
  { period: '3rd', time: '2:49', team: 'OPP', strength: 'EV', scorer: 'Landon Wright', assists: 'Robin Kuzma, Gavin Christie', notes: '' },
  { period: '3rd', time: '8:16', team: 'OTT', strength: 'EV', scorer: 'Lucas Balanyk', assists: 'Cade Campbell, Hannu Packalen', notes: '' }
];
const insGoal = db.prepare(`
  INSERT INTO goals (game_id, period, time, team, strength, scorer, assists, notes)
  VALUES (@game_id, @period, @time, @team, @strength, @scorer, @assists, @notes)
`);
goals.forEach(g => insGoal.run({ game_id: id, ...g }));

console.log('Seeded 1 game with skater, goalie, and goal-log data.');
