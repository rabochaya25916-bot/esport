// Миграция 002_match_details.sql. Хранится как .js, потому что хостинг не принимает файлы .sql.
// В таблице schema_migrations записывается под прежним именем 002_match_details.sql — уже обновлённые базы её не повторят.
module.exports = String.raw`
-- Этап 2: подробная статистика матчей. Только добавление — данные этапа 1 сохраняются.

ALTER TABLE matches ADD COLUMN end_date TEXT;
ALTER TABLE matches ADD COLUMN winner_team_source_id INTEGER;
ALTER TABLE matches ADD COLUMN parsed_status TEXT;          -- статус разбора статистики на BO3.GG (done | waiting | rejected ...)
ALTER TABLE matches ADD COLUMN stage_id INTEGER;
ALTER TABLE matches ADD COLUMN tier_rank INTEGER;
ALTER TABLE matches ADD COLUMN details_status TEXT;         -- NULL | partial | final | failed
ALTER TABLE matches ADD COLUMN details_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN details_synced_at TEXT;

ALTER TABLE tournaments ADD COLUMN start_date TEXT;
ALTER TABLE tournaments ADD COLUMN end_date TEXT;
ALTER TABLE tournaments ADD COLUMN event_type TEXT;         -- lan | online
ALTER TABLE tournaments ADD COLUMN source_status TEXT;
ALTER TABLE tournaments ADD COLUMN description TEXT;

ALTER TABLE teams ADD COLUMN country_code TEXT;
ALTER TABLE teams ADD COLUMN country_name TEXT;
ALTER TABLE teams ADD COLUMN rank INTEGER;                  -- рейтинг команды по BO3.GG на момент синхронизации

ALTER TABLE sync_runs ADD COLUMN details_ok INTEGER DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN details_failed INTEGER DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN games_upserted INTEGER DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN player_stats_upserted INTEGER DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN snapshots_created INTEGER DEFAULT 0;

-- Карты (CS2) / игры (Dota 2, LoL) внутри матча
CREATE TABLE IF NOT EXISTS match_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL,
  number INTEGER,
  map_name TEXT,                       -- только CS2
  status TEXT, state TEXT,             -- state: done | partially_done | no_stats ...
  begin_at TEXT, end_at TEXT, duration_sec INTEGER,
  winner_team_source_id INTEGER, loser_team_source_id INTEGER,
  winner_score INTEGER, loser_score INTEGER, rounds_count INTEGER,
  updated_at TEXT NOT NULL,
  UNIQUE(match_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_match_games_match ON match_games(match_id, number);

-- Половины / овертаймы CS2
CREATE TABLE IF NOT EXISTS match_game_sides (
  game_id INTEGER NOT NULL REFERENCES match_games(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL, overtime INTEGER,
  winner_team_name TEXT, winner_side TEXT, winner_score INTEGER,
  loser_team_name TEXT, loser_side TEXT, loser_score INTEGER,
  PRIMARY KEY (game_id, ord)
);

-- Раунды CS2
CREATE TABLE IF NOT EXISTS match_rounds (
  game_id INTEGER NOT NULL REFERENCES match_games(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  winner_team_name TEXT, winner_side TEXT,   -- CT | T
  end_reason TEXT, winner_score INTEGER, loser_score INTEGER, duration_sec REAL,
  PRIMARY KEY (game_id, round_number)
);

-- Составы на конкретный матч
CREATE TABLE IF NOT EXISTS match_lineups (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_source_id INTEGER NOT NULL,
  player_source_id INTEGER NOT NULL,
  nickname TEXT, country_code TEXT, image_url TEXT,
  PRIMARY KEY (match_id, player_source_id)
);

-- Индивидуальная статистика. scope_game_id = 0 — итог по матчу, иначе id из match_games.
CREATE TABLE IF NOT EXISTS match_player_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  scope_game_id INTEGER NOT NULL DEFAULT 0,
  player_source_id INTEGER NOT NULL,
  team_source_id INTEGER,
  nickname TEXT,
  role TEXT,
  hero TEXT,                       -- Dota 2: герой; LoL: чемпион
  hero_image_url TEXT,
  kills INTEGER, deaths INTEGER, assists INTEGER,
  adr REAL, rating REAL, kast REAL, headshots INTEGER, first_kills INTEGER, first_deaths INTEGER,
  gold_per_min REAL, xp_per_min REAL, last_hits INTEGER, denies INTEGER, net_worth INTEGER,
  hero_damage INTEGER, creep_score INTEGER, gold_earned INTEGER, kill_participation REAL,
  stats_json TEXT,                 -- все прочие числовые поля, как их отдаёт BO3.GG
  updated_at TEXT NOT NULL,
  UNIQUE(match_id, scope_game_id, player_source_id)
);
CREATE INDEX IF NOT EXISTS idx_mps_player ON match_player_stats(player_source_id);

-- Командная статистика (scope_game_id как выше)
CREATE TABLE IF NOT EXISTS match_team_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  scope_game_id INTEGER NOT NULL DEFAULT 0,
  team_source_id INTEGER NOT NULL,
  side TEXT,
  kills INTEGER, deaths INTEGER, assists INTEGER, gold INTEGER,
  towers INTEGER, dragons INTEGER, barons INTEGER, roshans INTEGER,
  first_blood INTEGER, first_tower INTEGER,
  stats_json TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(match_id, scope_game_id, team_source_id)
);

-- История наблюдаемых состояний матча (только при реальном изменении)
CREATE TABLE IF NOT EXISTS match_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  status TEXT, source_status TEXT,
  team1_score INTEGER, team2_score INTEGER,
  games_summary TEXT,
  state_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_match ON match_snapshots(match_id, id);

-- Подробный журнал: что получено с каждой страницы
CREATE TABLE IF NOT EXISTS sync_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  url TEXT NOT NULL, kind TEXT NOT NULL,     -- list | match
  ok INTEGER NOT NULL,
  summary_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_pages_run ON sync_pages(run_id);
`;
