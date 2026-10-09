const crypto = require("crypto");
const db = require("./db");
const users = require("./users");

// Sesiones por cookie firmada, sin dependencias ni estado en memoria.
// La cookie solo lleva el id de la cuenta y su caducidad; el rol y si la cuenta
// sigue activa se leen de la base en cada petición, así que desactivar a alguien
// o cambiarle el rol surte efecto al instante.

const COOKIE = "essensa_sesion";
const SESSION_MS = 12 * 3600 * 1000;
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

// Secreto de firma: se guarda en la base la primera vez, para que las sesiones
// sobrevivan a un reinicio sin tener que configurar nada.
let cachedSecret = null;
function sessionSecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.SESSION_SECRET) return (cachedSecret = process.env.SESSION_SECRET);
  const row = db.prepare("SELECT value FROM settings WHERE key = 'session_secret'").get();
  if (row) return (cachedSecret = row.value);
  const value = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO settings (key, value) VALUES ('session_secret', ?)").run(value);
  return (cachedSecret = value);
}

const sign = (payload) => crypto.createHmac("sha256", sessionSecret()).update(payload).digest("hex");

function makeToken(userId) {
  const payload = `${userId}.${Date.now() + SESSION_MS}`;
  return `${payload}.${sign(payload)}`;
}

// Devuelve el id de la cuenta si la cookie es válida y no ha caducado.
function readToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  const expected = Buffer.from(sign(`${id}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return Number(id);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// La cookie lleva Secure cuando la conexión es HTTPS. Detrás del proxy del VPS
// eso lo dice req.secure (con TRUST_PROXY activo); en local por HTTP no se pone,
// porque el navegador descartaría una cookie Secure y nadie podría entrar.
function useSecure(req) {
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  return Boolean(req.secure);
}

function setCookie(req, res, value, maxAge) {
  const bits = [`${COOKIE}=${value}`, "HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${maxAge}`];
  if (useSecure(req)) bits.push("Secure");
  res.setHeader("Set-Cookie", bits.join("; "));
}

// Freno a la fuerza bruta: cuenta solo los intentos FALLIDOS por IP, y un acierto
// limpia el contador para no dejar fuera a quien sí sabe su contraseña.
const fails = new Map();
function blocked(ip) {
  const now = Date.now();
  for (const [k, list] of fails) {
    const keep = list.filter((t) => now - t < WINDOW_MS);
    if (keep.length) fails.set(k, keep);
    else fails.delete(k);
  }
  return (fails.get(ip) || []).length >= MAX_ATTEMPTS;
}

// La cuenta de la petición, o null.
function currentUser(req) {
  const id = readToken(readCookie(req, COOKIE));
  if (!id) return null;
  const user = users.getById(id);
  return user && user.active ? user : null;
}

function login(req, res) {
  if (users.count() === 0) {
    return res.status(503).json({ error: "Todavía no hay cuentas creadas. Revisa ADMIN_PASSWORD en el servidor." });
  }
  if (blocked(req.ip)) {
    return res.status(429).json({ error: "Demasiados intentos fallidos. Espera unos minutos." });
  }
  const user = users.verify(req.body?.username, req.body?.password);
  if (!user) {
    fails.set(req.ip, [...(fails.get(req.ip) || []), Date.now()]);
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
  fails.delete(req.ip);
  setCookie(req, res, makeToken(user.id), SESSION_MS / 1000);
  res.json({ user });
}

function logout(req, res) {
  setCookie(req, res, "", 0);
  res.json({ ok: true });
}

// Cualquier cuenta activa (admin o manager).
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "No autorizado" });
  req.user = user;
  next();
}

// Solo administradores: cuentas, horarios y demás configuración.
function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "No autorizado" });
  if (user.role !== "admin") {
    return res.status(403).json({ error: "Esta acción es solo para administradores." });
  }
  req.user = user;
  next();
}

module.exports = { login, logout, requireAuth, requireAdmin, currentUser, COOKIE, SESSION_MS };
