// Миграция 001_init.sql. Хранится как .js, потому что хостинг не принимает файлы .sql.
// В таблице schema_migrations записывается под прежним именем 001_init.sql — уже обновлённые базы её не повторят.
module.exports = String.raw`
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,          -- cs2 | dota2 | lol
  name TEXT NOT NULL,
  source_path TEXT NOT NULL           -- префикс раздела на bo3.gg
);
CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER, game_code TEXT NOT NULL REFERENCES games(code),
  slug TEXT, name TEXT NOT NULL, tier TEXT, prize INTEGER, image_url TEXT, source_url TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(game_code, source_id)
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER, game_code TEXT NOT NULL REFERENCES games(code),
  slug TEXT, name TEXT NOT NULL, image_url TEXT, source_url TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(game_code, source_id)
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER, game_code TEXT NOT NULL REFERENCES games(code),
  team_source_id INTEGER, slug TEXT, nickname TEXT NOT NULL, first_name TEXT, last_name TEXT,
  country_code TEXT, country_name TEXT, image_url TEXT, is_coach INTEGER, total_prize INTEGER,
  source_url TEXT, updated_at TEXT NOT NULL,
  UNIQUE(game_code, source_id)
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER, game_code TEXT NOT NULL REFERENCES games(code),
  slug TEXT, status TEXT NOT NULL,     -- upcoming | live | finished | other
  source_status TEXT, start_date TEXT, bo_type INTEGER, tier TEXT,
  tournament_source_id INTEGER, games_json TEXT, source_url TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(game_code, source_id)
);
CREATE TABLE IF NOT EXISTS match_teams (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,           -- 1 | 2
  team_source_id INTEGER, score INTEGER,
  PRIMARY KEY (match_id, position)
);
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER, game_code TEXT, slug TEXT, title TEXT NOT NULL, description TEXT,
  image_url TEXT, published_at TEXT, source_url TEXT, updated_at TEXT NOT NULL,
  UNIQUE(source_id)
);
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, -- running | success | partial | failed
  pages_ok INTEGER DEFAULT 0, pages_failed INTEGER DEFAULT 0,
  matches_upserted INTEGER DEFAULT 0, teams_upserted INTEGER DEFAULT 0,
  players_upserted INTEGER DEFAULT 0, tournaments_upserted INTEGER DEFAULT 0, articles_upserted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES sync_runs(id), created_at TEXT NOT NULL, url TEXT, message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_game_status ON matches(game_code, status, start_date);
INSERT OR IGNORE INTO games (id, code, name, source_path) VALUES
 (1,'cs2','Counter-Strike 2',''),(2,'dota2','Dota 2','/dota2'),(3,'lol','League of Legends','/lol');
`;
