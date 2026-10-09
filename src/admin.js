const crypto = require("crypto");
const express = require("express");
const db = require("./db");
const shifts = require("./shifts");

const router = express.Router();
const SESSION_MS = 12 * 3600 * 1000;
const COOKIE = "essensa_admin";

// ---- Autenticación (contraseña única en ADMIN_PASSWORD) ----

function secret() {
  return process.env.ADMIN_PASSWORD || "";
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

function makeToken() {
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${sign(exp)}`;
}

function validToken(token) {
  if (!secret() || !token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// Freno básico a fuerza bruta: 10 intentos fallidos por IP cada 15 min.
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
}

router.post("/login", (req, res) => {
  if (!secret()) return res.status(503).json({ error: "Panel desactivado: falta ADMIN_PASSWORD en .env" });
  if (tooManyAttempts(req.ip)) return res.status(429).json({ error: "Demasiados intentos. Espera unos minutos." });

  const given = Buffer.from(String(req.body?.password || ""));
  const real = Buffer.from(secret());
  const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
  if (!ok) {
    attempts.get(req.ip).push(Date.now());
    return res.status(401).json({ error: "Contraseña incorrecta" });
  }
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`
  );
  res.json({ ok: true });
});

router.post("/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

function requireAdmin(req, res, next) {
  if (!validToken(readCookie(req, COOKIE))) return res.status(401).json({ error: "No autorizado" });
  next();
}

// ---- Créditos de ElevenLabs (saldo real de la cuenta, con caché de 60 s) ----

let subCache = { at: 0, data: null };
async function elevenLabsSubscription() {
  if (Date.now() - subCache.at < 60000 && subCache.data) return subCache.data;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { error: "Falta ELEVENLABS_API_KEY" };
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key } });
    if (!r.ok) return { error: `ElevenLabs respondió ${r.status}` };
    const j = await r.json();
    const data = {
      tier: j.tier,
      used: j.character_count,
      limit: j.character_limit,
      resetAt: j.next_character_count_reset_unix ? j.next_character_count_reset_unix * 1000 : null,
    };
    subCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

// ---- Datos del panel ----

router.get("/overview", requireAdmin, async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const since = `-${days} days`;

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN from_cache = 0 THEN char_count END), 0) AS generated,
         COALESCE(SUM(CASE WHEN from_cache = 1 THEN char_count END), 0) AS saved_by_cache,
         COALESCE(SUM(CASE WHEN from_cache = 0 THEN 1 END), 0) AS generations,
         COALESCE(SUM(CASE WHEN from_cache = 1 THEN 1 END), 0) AS cache_hits
       FROM usage_log WHERE created_at >= datetime('now', ?)`
    )
    .get(since);

  const month = db
    .prepare(
      `SELECT COALESCE(SUM(char_count), 0) AS chars FROM usage_log
       WHERE from_cache = 0 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
    )
    .get().chars;

  const today = db
    .prepare(
      `SELECT COALESCE(SUM(char_count), 0) AS chars FROM usage_log
       WHERE from_cache = 0 AND date(created_at) = date('now')`
    )
    .get().chars;

  const daily = db
    .prepare(
      `SELECT date(created_at) AS day,
              COALESCE(SUM(CASE WHEN from_cache = 0 THEN char_count END), 0) AS generated,
              COALESCE(SUM(CASE WHEN from_cache = 1 THEN char_count END), 0) AS cached
       FROM usage_log WHERE created_at >= datetime('now', ?)
       GROUP BY day ORDER BY day`
    )
    .all(since);

  const voices = db
    .prepare(
      `SELECT m.id, m.name, m.voice_id, m.active,
              COALESCE(SUM(CASE WHEN u.from_cache = 0 THEN 1 END), 0) AS generations,
              COALESCE(SUM(CASE WHEN u.from_cache = 0 THEN u.char_count END), 0) AS chars,
              COALESCE(SUM(CASE WHEN u.from_cache = 1 THEN 1 END), 0) AS cache_hits,
              MAX(u.created_at) AS last_used
       FROM models m
       LEFT JOIN usage_log u ON u.model_id = m.id AND u.created_at >= datetime('now', ?)
       GROUP BY m.id
       ORDER BY chars DESC, m.name`
    )
    .all(since);

  const chatters = db
    .prepare(
      `SELECT c.id, c.name, c.daily_char_limit,
              COALESCE(SUM(CASE WHEN u.from_cache = 0 THEN u.char_count END), 0) AS chars,
              COALESCE(SUM(CASE WHEN u.from_cache = 0 THEN 1 END), 0) AS generations,
              COALESCE(SUM(CASE WHEN u.from_cache = 1 THEN 1 END), 0) AS cache_hits
       FROM chatters c
       LEFT JOIN usage_log u ON u.chatter_id = c.id AND u.created_at >= datetime('now', ?)
       WHERE c.active = 1
       GROUP BY c.id
       ORDER BY chars DESC`
    )
    .all(since);

  const now = Date.now();
  const mapShift = (o) => ({
    id: o.shift.id,
    discordId: o.shift.discord_id,
    name: o.shift.discord_name,
    startedAt: o.shift.started_at,
    endedAt: o.shift.ended_at,
    workedMs: o.workedMs,
    breakMs: o.breakMs,
    breakOverMs: o.breakOverMs,
    onBreak: o.onBreak,
    openBreakStartedAt: o.openBreakStartedAt,
  });

  res.json({
    now,
    days,
    rules: { shiftMs: shifts.SHIFT_MS, breakMs: shifts.BREAK_MS },
    elevenlabs: await elevenLabsSubscription(),
    credits: { today, month, ...totals },
    daily,
    voices,
    chatters,
    openShifts: shifts.listOpen(now).map(mapShift),
    shifts: shifts.listSince(now - days * 86400000, now).map(mapShift),
  });
});

module.exports = router;
