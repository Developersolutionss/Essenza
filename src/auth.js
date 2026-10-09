const crypto = require("crypto");

// Sesiones por cookie firmada, sin dependencias ni estado en memoria.
// Se usa para dos accesos distintos: el panel de administración (ADMIN_PASSWORD)
// y la web de chatters (CHATTER_PASSWORD). Cada uno tiene su propia cookie.

const SESSION_MS = 12 * 3600 * 1000;
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

// La cookie lleva Secure cuando la conexión es HTTPS. Detrás del proxy del VPS
// eso lo dice req.secure (con TRUST_PROXY activo); en local por HTTP no se pone,
// porque el navegador descartaría una cookie Secure y nadie podría entrar.
// COOKIE_SECURE=1 o 0 fuerza el comportamiento si hace falta.
function useSecure(req) {
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  return Boolean(req.secure);
}

function sign(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function makeToken(secret) {
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${sign(secret, exp)}`;
}

function validToken(secret, token) {
  if (!secret || !token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(secret, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function samePassword(given, real) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(String(real));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Freno a la fuerza bruta: cuenta solo los intentos FALLIDOS por IP, y un acierto
// limpia el contador para no dejar fuera a quien sí sabe la contraseña.
function createGate() {
  const fails = new Map();
  const prune = (now) => {
    for (const [ip, list] of fails) {
      const keep = list.filter((t) => now - t < WINDOW_MS);
      if (keep.length) fails.set(ip, keep);
      else fails.delete(ip);
    }
  };
  return {
    blocked(ip) {
      const now = Date.now();
      prune(now);
      return (fails.get(ip) || []).length >= MAX_ATTEMPTS;
    },
    fail(ip) {
      const list = fails.get(ip) || [];
      list.push(Date.now());
      fails.set(ip, list);
    },
    pass(ip) {
      fails.delete(ip);
    },
  };
}

// Devuelve { login, logout, require } para un acceso con nombre de cookie y
// variable de entorno propios.
function createAuth({ cookieName, secretEnv, label }) {
  const gate = createGate();
  const secret = () => process.env[secretEnv] || "";

  function setCookie(req, res, value, maxAge) {
    const bits = [
      `${cookieName}=${value}`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/",
      `Max-Age=${maxAge}`,
    ];
    if (useSecure(req)) bits.push("Secure");
    res.setHeader("Set-Cookie", bits.join("; "));
  }

  return {
    enabled: () => Boolean(secret()),

    login(req, res) {
      if (!secret()) {
        return res.status(503).json({ error: `${label} desactivado: falta ${secretEnv} en el entorno` });
      }
      if (gate.blocked(req.ip)) {
        return res.status(429).json({ error: "Demasiados intentos. Espera unos minutos." });
      }
      if (!samePassword(req.body?.password, secret())) {
        gate.fail(req.ip);
        return res.status(401).json({ error: "Contraseña incorrecta" });
      }
      gate.pass(req.ip);
      setCookie(req, res, makeToken(secret()), SESSION_MS / 1000);
      res.json({ ok: true });
    },

    logout(req, res) {
      setCookie(req, res, "", 0);
      res.json({ ok: true });
    },

    // ¿Esta petición trae una sesión válida? (sin responder nada)
    check(req) {
      return Boolean(secret()) && validToken(secret(), readCookie(req, cookieName));
    },

    require(req, res, next) {
      if (!secret()) {
        return res.status(503).json({ error: `${label} desactivado: falta ${secretEnv} en el entorno` });
      }
      if (!validToken(secret(), readCookie(req, cookieName))) {
        return res.status(401).json({ error: "No autorizado" });
      }
      next();
    },
  };
}

module.exports = { createAuth, readCookie, validToken, SESSION_MS };
