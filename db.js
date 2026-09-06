const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// On Railway, mount a persistent Volume and set DB_PATH to a file inside it
// (e.g. /data/toolkit.db) so the database survives redeploys. Locally it
// falls back to ./data/toolkit.db.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'toolkit.db');

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  gametype TEXT DEFAULT 'Regular Season',
  date TEXT,
  opponent TEXT,
  venue TEXT,
  result TEXT,
  gf INTEGER DEFAULT 0,
  ga INTEGER DEFAULT 0,
  sf INTEGER DEFAULT 0,
  sa INTEGER DEFAULT 0,
  ppg INTEGER DEFAULT 0,
  ppo INTEGER DEFAULT 0,
  pk_against INTEGER DEFAULT 0,
  pk_ga INTEGER DEFAULT 0,
  shgf INTEGER DEFAULT 0,
  shga INTEGER DEFAULT 0,
  engf INTEGER DEFAULT 0,
  enga INTEGER DEFAULT 0,
  sogf INTEGER DEFAULT 0,
  soga INTEGER DEFAULT 0,
  psgf INTEGER DEFAULT 0,
  psga INTEGER DEFAULT 0,
  goalie TEXT,
  attendance TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skater_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT,
  pos TEXT,
  number TEXT,
  goals INTEGER DEFAULT 0,
  assists INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  plusMinus INTEGER DEFAULT 0,
  sog INTEGER DEFAULT 0,
  pim INTEGER DEFAULT 0,
  fow INTEGER DEFAULT 0,
  fol INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS goalie_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT,
  ga INTEGER DEFAULT 0,
  min TEXT,
  shots INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  pim INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  period TEXT,
  time TEXT,
  team TEXT,
  strength TEXT,
  scorer TEXT,
  assists TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  team TEXT PRIMARY KEY,
  dataurl TEXT
);
`);

module.exports = db;
