// Миграция 004_posts_admin.sql. Хранится как .js, потому что хостинг не принимает файлы .sql.
// В таблице schema_migrations записывается под прежним именем 004_posts_admin.sql — уже обновлённые базы её не повторят.
module.exports = String.raw`
-- Этап 4: собственные статьи и гайды, администраторы, сессии, тип запуска синхронизации.
-- Только добавление — данные этапов 1–3 (матчи, история, составы, трансферы) не затрагиваются.

ALTER TABLE sync_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'full';   -- full | live

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,          -- scrypt$N$r$p$salt$hash, пароль в открытом виде не хранится
  created_at TEXT NOT NULL,
  password_changed_at TEXT,
  last_login_at TEXT
);

-- Хранится только SHA-256 от токена сессии; сам токен есть лишь в HttpOnly-cookie браузера
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT, user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,                    -- ip|username
  created_at TEXT NOT NULL,
  ok INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_key ON admin_login_attempts(key, created_at);

CREATE TABLE IF NOT EXISTS post_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'article',          -- article | guide
  title TEXT NOT NULL,
  excerpt TEXT,
  body_md TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',             -- результат безопасного рендера Markdown на сервере
  cover_url TEXT,
  game_code TEXT REFERENCES games(code),
  category_id INTEGER REFERENCES post_categories(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',           -- draft | published
  published_at TEXT,                              -- в будущем = отложенная публикация
  reading_minutes INTEGER,
  author_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_pub ON posts(status, published_at);

CREATE TABLE IF NOT EXISTS post_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS post_tag_links (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES post_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

INSERT OR IGNORE INTO post_categories (slug, name, sort) VALUES
  ('news', 'Новости', 1), ('analytics', 'Аналитика', 2), ('guides', 'Гайды', 3), ('interviews', 'Интервью', 4);

CREATE INDEX IF NOT EXISTS idx_matches_start ON matches(start_date);
`;
