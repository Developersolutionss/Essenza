const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(process.env.DB_PATH || path.join(dataDir, "essensa.db"));
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

// Cuentas del panel. Las contraseñas se guardan cifradas con scrypt (sal por
// usuario), nunca en claro. Roles: "admin" (todo) y "manager" (ve el panel y
// cierra turnos, pero no toca cuentas ni horarios).
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'manager',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Fichajes: turnos y breaks (tiempos en milisegundos epoch).
db.exec(`
  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL,
    discord_name TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS shift_breaks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  -- Una persona no puede tener dos turnos abiertos a la vez.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_shift ON shifts(discord_id) WHERE ended_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_shifts_started ON shifts(started_at);
  CREATE INDEX IF NOT EXISTS idx_breaks_shift ON shift_breaks(shift_id);
`);

// Horarios: hora de entrada esperada por persona, para detectar llegadas tarde.
db.exec(`
  CREATE TABLE IF NOT EXISTS schedules (
    discord_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    start_time TEXT NOT NULL,           -- 'HH:MM' en la zona TIMEZONE
    grace_minutes INTEGER NOT NULL DEFAULT 10
  );
`);

// Turnos fijos (Shift 1, 2, 3...). Cada persona se asigna sola por su rol de Discord.
db.exec(`
  CREATE TABLE IF NOT EXISTS shift_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    start_time TEXT NOT NULL,           -- 'HH:MM' en la zona TIMEZONE
    grace_minutes INTEGER NOT NULL DEFAULT 10
  );
`);

// Los fichajes guardan la hora esperada y el turno con el que se midieron, para
// que cambiar un turno o el rol de alguien no reescriba el historial.
const shiftCols = db.prepare("PRAGMA table_info(shifts)").all().map((c) => c.name);
if (!shiftCols.includes("template_name")) db.exec("ALTER TABLE shifts ADD COLUMN template_name TEXT;");
if (!shiftCols.includes("expected_at")) db.exec("ALTER TABLE shifts ADD COLUMN expected_at INTEGER;");
if (!shiftCols.includes("grace_minutes")) db.exec("ALTER TABLE shifts ADD COLUMN grace_minutes INTEGER;");

// Turnos de la agencia, en hora de Venezuela: 8 horas cada uno.
if (db.prepare("SELECT COUNT(*) AS n FROM shift_templates").get().n === 0) {
  const grace = Number(process.env.LATE_GRACE_MINUTES || 10);
  const ins = db.prepare("INSERT INTO shift_templates (name, start_time, grace_minutes) VALUES (?, ?, ?)");
  ins.run("Shift 1", "05:00", grace);
  ins.run("Shift 2", "13:00", grace);
  ins.run("Shift 3", "21:00", grace);
}

// Migración: vincular cada chatter con su usuario de Discord.
const chatterCols = db.prepare("PRAGMA table_info(chatters)").all();
if (!chatterCols.some((c) => c.name === "discord_id")) {
  db.exec("ALTER TABLE chatters ADD COLUMN discord_id TEXT;");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_chatters_discord ON chatters(discord_id) WHERE discord_id IS NOT NULL;");

module.exports = db;
