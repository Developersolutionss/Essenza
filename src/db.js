const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "essensa.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL DEFAULT 'elevenlabs',
    voice_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS model_consent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    signed_document_path TEXT NOT NULL,
    verification_audio_path TEXT,
    consented_at TEXT NOT NULL,
    commercial_use INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chatters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'chatter', -- 'chatter' | 'manager'
    daily_char_limit INTEGER NOT NULL DEFAULT 20000,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS phrases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Cachea audios ya generados por (modelo + texto exacto) para no pagarle
  -- dos veces al proveedor por la misma frase.
  CREATE TABLE IF NOT EXISTS audio_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    text_hash TEXT NOT NULL,
    text TEXT NOT NULL,
    file_path TEXT NOT NULL,
    char_count INTEGER NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(model_id, text_hash)
  );

  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chatter_id INTEGER NOT NULL REFERENCES chatters(id),
    model_id INTEGER NOT NULL REFERENCES models(id),
    char_count INTEGER NOT NULL,
    from_cache INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_usage_chatter_date ON usage_log(chatter_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_cache_lookup ON audio_cache(model_id, text_hash);
`);

// Migración: vincular cada chatter con su usuario de Discord.
const chatterCols = db.prepare("PRAGMA table_info(chatters)").all();
if (!chatterCols.some((c) => c.name === "discord_id")) {
  db.exec("ALTER TABLE chatters ADD COLUMN discord_id TEXT;");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_chatters_discord ON chatters(discord_id) WHERE discord_id IS NOT NULL;");

module.exports = db;
