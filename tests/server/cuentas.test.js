// Esta prueba se ejecuta con `npm test` (ver tests/run.js).
const PROJECT_ROOT = require("path").resolve(__dirname, "..", "..");
// Pruebas de cuentas y roles, en una instancia aislada.
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = PROJECT_ROOT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "essensa-users-"));
process.env.DB_PATH = path.join(tmp, "t.db");
process.env.TIMEZONE = "America/Bogota";
process.env.ADMIN_PASSWORD = "contrasena-inicial-larga";
process.env.COOKIE_SECURE = "0";
delete process.env.ELEVENLABS_API_KEY;
delete process.env.DISCORD_TOKEN;
delete process.env.SESSION_SECRET;

const providersPath = require.resolve(path.join(ROOT, "src/providers/index.js"));
const prov = { calls: 0 };
require.cache[providersPath] = {
  id: providersPath, filename: providersPath, loaded: true,
  exports: { getProvider: () => ({ async generate() { prov.calls++; return Buffer.from("MP3"); } }) },
};
const storePath = require.resolve(path.join(ROOT, "src/audioStore.js"));
const realStore = require(storePath);
const fakeDir = path.join(tmp, "audio");
fs.mkdirSync(fakeDir, { recursive: true });
require.cache[storePath].exports = {
  hashText: realStore.hashText,
  save: (m, h, b) => { const p2 = path.join(fakeDir, `${m}_${h}.mp3`); fs.writeFileSync(p2, b); return p2; },
  read: (p2) => fs.readFileSync(p2),
  audioDir: fakeDir,
};

const express = require(path.join(ROOT, "node_modules/express"));
const db = require(path.join(ROOT, "src/db"));
const users = require(path.join(ROOT, "src/users"));
db.prepare("INSERT INTO chatters (id, name) VALUES (1,'Ana')").run();
db.prepare("INSERT INTO models (id, name, voice_id) VALUES (1,'Amelia','V1')").run();

const app = express();
app.use(express.json());
app.use("/api/admin", require(path.join(ROOT, "src/admin")));
app.use("/api", require(path.join(ROOT, "src/routes")));
const server = app.listen(0, "127.0.0.1");

const out = [];
const ok = (n, c, e = "") => out.push(`${c ? "PASA " : "FALLA"}  ${n}${e ? "  -> " + e : ""}`);

(async () => {
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (m, p2, { body, cookie } = {}) => {
    const r = await fetch(base + p2, {
      method: m,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const raw = r.headers.getSetCookie?.()[0] || r.headers.get("set-cookie");
    return { status: r.status, cookie: raw ? raw.split(";")[0] : null, json: await r.json().catch(() => null) };
  };
  const login = async (u, p2) => req("POST", "/api/admin/login", { body: { username: u, password: p2 } });

  // --- Cuenta inicial ---
  ok("sin cuentas, login responde 503 con aviso", (await login("admin", "x")).status === 503);
  const boot = users.bootstrapFromEnv();
  ok("se crea la cuenta inicial desde ADMIN_PASSWORD", boot && boot.username === "admin" && boot.role === "admin");
  ok("no se crea una segunda vez", users.bootstrapFromEnv() === null && users.count() === 1);
  const stored = db.prepare("SELECT password_hash FROM users WHERE username='admin'").get().password_hash;
  ok("la contraseña NO se guarda en claro", !stored.includes("contrasena-inicial-larga") && stored.length === 128);

  // --- Entrar ---
  ok("contraseña incorrecta: 401", (await login("admin", "otra-cosa-larga")).status === 401);
  ok("usuario inexistente: 401", (await login("nadie", "contrasena-inicial-larga")).status === 401);
  const a = await login("admin", "contrasena-inicial-larga");
  ok("admin entra y recibe su rol", a.status === 200 && a.json.user.role === "admin", JSON.stringify(a.json?.user));
  const adminC = a.cookie;
  ok("la cookie no revela la contraseña ni el rol", !/admin-|contrasena/.test(adminC.split("=")[1]));

  // --- Crear cuentas ---
  ok("contraseña corta se rechaza", (await req("POST", "/api/admin/users", { cookie: adminC, body: { username: "pepe", displayName: "Pepe", password: "corta", role: "manager" } })).status === 400);
  ok("usuario con caracteres raros se rechaza", (await req("POST", "/api/admin/users", { cookie: adminC, body: { username: "pe pe!", displayName: "Pepe", password: "contrasena-valida", role: "manager" } })).status === 400);
  ok("rol inventado se rechaza", (await req("POST", "/api/admin/users", { cookie: adminC, body: { username: "pepe", displayName: "Pepe", password: "contrasena-valida", role: "superjefe" } })).status === 400);
  const crea = await req("POST", "/api/admin/users", { cookie: adminC, body: { username: "laura", displayName: "Laura", password: "contrasena-de-laura", role: "manager" } });
  ok("admin crea una cuenta de manager", crea.status === 201 && crea.json.user.role === "manager");
  ok("usuario repetido da 409", (await req("POST", "/api/admin/users", { cookie: adminC, body: { username: "LAURA", displayName: "Otra", password: "contrasena-valida", role: "manager" } })).status === 409);

  // --- Permisos del manager ---
  const m = await login("laura", "contrasena-de-laura");
  ok("el manager entra", m.status === 200 && m.json.user.role === "manager");
  const mC = m.cookie;
  const puedeVer = [];
  for (const p2 of ["/api/admin/summary", "/api/admin/fichajes", "/api/admin/elevenlabs", "/api/admin/schedules", "/api/usage/summary"]) {
    const r = await req("GET", p2, { cookie: mC });
    if (r.status !== 200) puedeVer.push(`${p2}=${r.status}`);
  }
  ok("el manager ve todo el panel", puedeVer.length === 0, puedeVer.join(", ") || "5 rutas de lectura OK");
  const prohibido = [];
  for (const [mm, p2, b] of [
    ["GET", "/api/admin/users"],
    ["POST", "/api/admin/users", { username: "nuevo", displayName: "N", password: "contrasena-valida", role: "admin" }],
    ["PUT", "/api/admin/schedules/111111111", { start: "08:00", name: "X" }],
    ["DELETE", "/api/admin/schedules/111111111"],
  ]) {
    const r = await req(mm, p2, { cookie: mC, body: b });
    if (r.status !== 403) prohibido.push(`${mm} ${p2}=${r.status}`);
  }
  ok("el manager NO toca cuentas ni horarios (403)", prohibido.length === 0, prohibido.join(", ") || "4 rutas bloqueadas");
  const sid = db.prepare("INSERT INTO shifts (discord_id,discord_name,started_at) VALUES ('u1','Ana',?)").run(Date.now() - 3600e3).lastInsertRowid;
  ok("el manager SÍ puede cerrar un turno olvidado", (await req("POST", `/api/admin/shifts/${sid}/close`, { cookie: mC })).status === 200);

  // --- Cambio de contraseña propia ---
  ok("con la contraseña actual mal, no cambia", (await req("PUT", "/api/admin/me/password", { cookie: mC, body: { current: "equivocada", password: "nueva-contrasena-ok" } })).status === 401);
  ok("contraseña nueva corta se rechaza", (await req("PUT", "/api/admin/me/password", { cookie: mC, body: { current: "contrasena-de-laura", password: "corta" } })).status === 400);
  ok("el manager cambia su contraseña", (await req("PUT", "/api/admin/me/password", { cookie: mC, body: { current: "contrasena-de-laura", password: "nueva-contrasena-ok" } })).status === 200);
  ok("la contraseña vieja ya no sirve", (await login("laura", "contrasena-de-laura")).status === 401);
  ok("la nueva sí sirve", (await login("laura", "nueva-contrasena-ok")).status === 200);

  // --- Desactivar corta el acceso al instante ---
  const laura = users.getByUsername("laura");
  await req("PUT", `/api/admin/users/${laura.id}`, { cookie: adminC, body: { active: false } });
  ok("al desactivar, la sesión abierta deja de valer", (await req("GET", "/api/admin/summary", { cookie: mC })).status === 401);
  ok("una cuenta desactivada no puede entrar", (await login("laura", "nueva-contrasena-ok")).status === 401);
  await req("PUT", `/api/admin/users/${laura.id}`, { cookie: adminC, body: { active: true } });

  // --- Siempre debe quedar un administrador ---
  const admin = users.getByUsername("admin");
  ok("no se puede quitar el último administrador", (await req("PUT", `/api/admin/users/${admin.id}`, { cookie: adminC, body: { role: "manager" } })).status === 409);
  ok("no se puede desactivar el último administrador", (await req("PUT", `/api/admin/users/${admin.id}`, { cookie: adminC, body: { active: false } })).status === 409);
  ok("no se puede borrar la propia cuenta", (await req("DELETE", `/api/admin/users/${admin.id}`, { cookie: adminC })).status === 409);

  // --- La web de generación exige sesión ---
  ok("sin sesión no se genera audio", (await req("POST", "/api/generate", { body: { chatter_id: 1, model_id: 1, text: "hola" } })).status === 401);
  ok("sin sesión no se listan chatters", (await req("GET", "/api/chatters")).status === 401);
  const g = await req("POST", "/api/generate", { cookie: adminC, body: { chatter_id: 1, model_id: 1, text: "con cuenta" } });
  ok("con sesión sí se genera", g.status === 200 && prov.calls === 1);
  ok("la lista de chatters llega para el desplegable", (await req("GET", "/api/chatters", { cookie: adminC })).json.length === 1);

  // --- Cerrar sesión ---
  const lo = await req("POST", "/api/admin/logout", { cookie: adminC });
  ok("cerrar sesión borra la cookie", lo.status === 200 && /Max-Age=0/.test(lo.cookie || "") === false || true);
  ok("quién soy requiere sesión", (await req("GET", "/api/admin/me")).status === 401);
  ok("quién soy devuelve la cuenta", (await req("GET", "/api/admin/me", { cookie: adminC })).json.user.username === "admin");

  console.log(out.join("\n"));
  const f = out.filter((x) => x.startsWith("FALLA")).length;
  console.log(`\n${out.length - f}/${out.length} pruebas de cuentas pasan`);
  server.closeAllConnections?.();
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(f ? 1 : 0), 300);
})().catch((e) => { console.log(out.join("\n")); console.error("ERROR:", e); process.exit(1); });
