// Миграция 003_profiles.sql. Хранится как .js, потому что хостинг не принимает файлы .sql.
// В таблице schema_migrations записывается под прежним именем 003_profiles.sql — уже обновлённые базы её не повторят.
module.exports = String.raw`
-- Этап 3: профили команд, игроков, турниров, составы, трансферы, рейтинги. Только добавление — данные этапов 1–2 сохраняются.

ALTER TABLE teams ADD COLUMN acronym TEXT;
ALTER TABLE teams ADD COLUMN est_date TEXT;
ALTER TABLE teams ADD COLUMN icon_url TEXT;
ALTER TABLE teams ADD COLUMN region_name TEXT;
ALTER TABLE teams ADD COLUMN socials_json TEXT;
ALTER TABLE teams ADD COLUMN six_month_earned INTEGER;
ALTER TABLE teams ADD COLUMN rank_diff INTEGER;
ALTER TABLE teams ADD COLUMN staff_json TEXT;
ALTER TABLE teams ADD COLUMN general_stats_json TEXT;       -- как отдаёт BO3.GG (generalStats)
ALTER TABLE teams ADD COLUMN map_pool_json TEXT;            -- CS2: пул карт BO3.GG
ALTER TABLE teams ADD COLUMN profile_status TEXT;           -- NULL | ok | missing | failed
ALTER TABLE teams ADD COLUMN profile_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teams ADD COLUMN profile_synced_at TEXT;

ALTER TABLE players ADD COLUMN birthday TEXT;
ALTER TABLE players ADD COLUMN role TEXT;
ALTER TABLE players ADD COLUMN six_month_avg_rating REAL;   -- показатель BO3.GG
ALTER TABLE players ADD COLUMN joined_team_at TEXT;
ALTER TABLE players ADD COLUMN source_player_status INTEGER;
ALTER TABLE players ADD COLUMN socials_json TEXT;
ALTER TABLE players ADD COLUMN general_stats_json TEXT;
ALTER TABLE players ADD COLUMN profile_status TEXT;
ALTER TABLE players ADD COLUMN profile_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN profile_synced_at TEXT;

ALTER TABLE tournaments ADD COLUMN tier_rank INTEGER;
ALTER TABLE tournaments ADD COLUMN players_prize INTEGER;
ALTER TABLE tournaments ADD COLUMN teams_prize INTEGER;
ALTER TABLE tournaments ADD COLUMN banner_url TEXT;
ALTER TABLE tournaments ADD COLUMN region_name TEXT;
ALTER TABLE tournaments ADD COLUMN country_name TEXT;
ALTER TABLE tournaments ADD COLUMN profile_status TEXT;
ALTER TABLE tournaments ADD COLUMN profile_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournaments ADD COLUMN profile_synced_at TEXT;

ALTER TABLE sync_runs ADD COLUMN profiles_ok INTEGER DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN profiles_failed INTEGER DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN roster_changes_detected INTEGER DEFAULT 0;

-- Снимки состава команды (сохраняются только при изменении)
CREATE TABLE IF NOT EXISTS team_roster_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_code TEXT NOT NULL, team_source_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL, roster_hash TEXT NOT NULL,
  players_json TEXT NOT NULL                -- [{player_source_id, nickname, is_coach}]
);
CREATE INDEX IF NOT EXISTS idx_roster_snap ON team_roster_snapshots(game_code, team_source_id, id);

-- Изменения составов: опубликованные источником трансферы (source_kind='source')
-- и обнаруженные системой по разнице снимков (source_kind='detected').
-- event_date — дата события по источнику (может отсутствовать); detected_at — когда система впервые увидела запись.
CREATE TABLE IF NOT EXISTS roster_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_code TEXT NOT NULL,
  source_kind TEXT NOT NULL,                -- source | detected
  source_ref TEXT NOT NULL,                 -- id трансфера BO3.GG или ключ снимков
  player_source_id INTEGER NOT NULL, player_name TEXT,
  from_team_source_id INTEGER, from_team_name TEXT,
  to_team_source_id INTEGER, to_team_name TEXT,
  change_type TEXT NOT NULL,                -- join | leave | move | status_change | joined_detected | left_detected | other
  source_action_type INTEGER, is_coach INTEGER,
  event_date TEXT, source_url TEXT, source_created_at TEXT,
  detected_at TEXT NOT NULL,
  UNIQUE(game_code, source_kind, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_rc_player ON roster_changes(game_code, player_source_id);
CREATE INDEX IF NOT EXISTS idx_rc_from ON roster_changes(game_code, from_team_source_id);
CREATE INDEX IF NOT EXISTS idx_rc_to ON roster_changes(game_code, to_team_source_id);

-- Достижения команд (места на турнирах по BO3.GG)
CREATE TABLE IF NOT EXISTS team_achievements (
  game_code TEXT NOT NULL, team_source_id INTEGER NOT NULL, tournament_source_id INTEGER NOT NULL,
  title TEXT, date TEXT,
  PRIMARY KEY (game_code, team_source_id, tournament_source_id)
);

-- Снимки статистики (история по времени): entity = team | player
CREATE TABLE IF NOT EXISTS stat_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_code TEXT NOT NULL, entity TEXT NOT NULL, source_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL, stats_json TEXT NOT NULL, state_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stat_snap ON stat_snapshots(game_code, entity, source_id, id);

-- Участники турниров и места
CREATE TABLE IF NOT EXISTS tournament_teams (
  game_code TEXT NOT NULL, tournament_source_id INTEGER NOT NULL, team_source_id INTEGER NOT NULL,
  place TEXT, money INTEGER, points INTEGER,
  players_json TEXT,                        -- заявка на турнир, если опубликована
  updated_at TEXT NOT NULL,
  PRIMARY KEY (game_code, tournament_source_id, team_source_id)
);
CREATE INDEX IF NOT EXISTS idx_tt_team ON tournament_teams(game_code, team_source_id);

-- Стадии и раунды турнира, матчи сетки
CREATE TABLE IF NOT EXISTS tournament_stages (
  game_code TEXT NOT NULL, source_id INTEGER NOT NULL, tournament_source_id INTEGER NOT NULL,
  title TEXT, format_type TEXT, status TEXT, start_date TEXT, end_date TEXT, seq INTEGER,
  PRIMARY KEY (game_code, source_id)
);
CREATE TABLE IF NOT EXISTS tournament_rounds (
  game_code TEXT NOT NULL, source_id INTEGER NOT NULL, stage_source_id INTEGER NOT NULL,
  name TEXT, round_index INTEGER, bracket_type TEXT, start_at TEXT,
  PRIMARY KEY (game_code, source_id)
);
CREATE TABLE IF NOT EXISTS tournament_round_matches (
  game_code TEXT NOT NULL, round_source_id INTEGER NOT NULL, match_source_id INTEGER NOT NULL,
  position INTEGER, prev_match1_source_id INTEGER, prev_match2_source_id INTEGER,
  PRIMARY KEY (game_code, round_source_id, match_source_id)
);

-- Статистика игроков на турнире (средние показатели BO3.GG)
CREATE TABLE IF NOT EXISTS tournament_player_stats (
  game_code TEXT NOT NULL, tournament_source_id INTEGER NOT NULL, player_source_id INTEGER NOT NULL,
  games_count INTEGER, rounds_count INTEGER, rating REAL, kills REAL, deaths REAL, assists REAL, damage REAL, kd REAL,
  stats_json TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (game_code, tournament_source_id, player_source_id)
);

-- Рейтинги. kind: valve (рейтинг Valve, опубликованный на BO3.GG) | bo3_rank (поле rank команды BO3.GG, снимок на дату синхронизации)
CREATE TABLE IF NOT EXISTS rankings (
  game_code TEXT NOT NULL, kind TEXT NOT NULL, ranking_date TEXT NOT NULL,
  team_source_id INTEGER NOT NULL, position INTEGER, score REAL, region TEXT,
  roster_json TEXT, captured_at TEXT NOT NULL,
  PRIMARY KEY (game_code, kind, ranking_date, team_source_id)
);
CREATE INDEX IF NOT EXISTS idx_rankings_team ON rankings(game_code, team_source_id, kind, ranking_date);
CREATE INDEX IF NOT EXISTS idx_players_team ON players(game_code, team_source_id);
`;
