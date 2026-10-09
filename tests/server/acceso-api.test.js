// Esta prueba se ejecuta con `npm test` (ver tests/run.js).
const PROJECT_ROOT = require("path").resolve(__dirname, "..", "..");
// Acceso sin sesión y cookies falsificadas, contra una instancia aislada.
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const ROOT = PROJECT_ROOT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "essensa-api-"));
process.env.DB_PATH = path.join(tmp, "t.db");
process.env.TIMEZONE = "America/Bogota";
process.env.ADMIN_PASSWORD = "contrasena-inicial-larga";
process.env.SESSION_SECRET = "secreto-de-firma-de-prueba";
process.env.COOKIE_SECURE = "0";
delete process.env.ELEVENLABS_API_KEY;
delete process.env.DISCORD_TOKEN;

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
  save: (m, h, b) => { const q = path.join(fakeDir, `${m}_${h}.mp3`); fs.writeFileSync(q, b); return q; },
  read: (q) => fs.readFileSync(q),
  audioDir: fakeDir,
};

const express = require(path.join(ROOT, "node_modules/express"));
const db = require(path.join(ROOT, "src/db"));
const users = require(path.join(ROOT, "src/users"));
db.prepare("INSERT INTO chatters (id, name) VALUES (1,'Ana')").run();
db.prepare("INSERT INTO models (id, name, voice_id) VALUES (1,'Amelia','V1')").run();
users.bootstrapFromEnv();

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
  const req = async (m, p, { body, cookie } = {}) => {
    const r = await fetch(base + p, {
      method: m,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.getSetCookie?.()[0] || r.headers.get("set-cookie");
    return { status: r.status, setCookie: sc, cookie: sc ? sc.split(";")[0] : null, json: await r.json().catch(() => null) };
  };

  // --- Barrido anónimo: nada sensible sin sesión ---
  const rutas = [
    ["POST", "/api/generate", { chatter_id: 1, model_id: 1, text: "gratis para internet" }],
    ["GET", "/api/models"], ["GET", "/api/phrases"], ["GET", "/api/chatters"],
    ["POST", "/api/phrases", { label: "x", text: "y" }],
    ["GET", "/api/usage/summary"],
    ["GET", "/api/admin/me"], ["GET", "/api/admin/summary"], ["GET", "/api/admin/fichajes"],
    ["GET", "/api/admin/elevenlabs"], ["GET", "/api/admin/schedules"], ["GET", "/api/admin/users"],
    ["POST", "/api/admin/users", { username: "colado", displayName: "C", password: "contrasena-valida", role: "admin" }],
    ["PUT", "/api/admin/users/1", { role: "manager" }],
    ["DELETE", "/api/admin/users/1"],
    ["PUT", "/api/admin/schedules/111111111", { start: "08:00", name: "X" }],
    ["DELETE", "/api/admin/schedules/111111111"],
    ["POST", "/api/admin/shifts/1/close"],
    ["PUT", "/api/admin/me/password", { current: "x", password: "contrasena-valida" }],
  ];
  const malas = [];
  for (const [m, p, b] of rutas) {
    const r = await req(m, p, { body: b });
    if (r.status !== 401) malas.push(`${m} ${p} = ${r.status}`);
  }
  ok(`sin sesión, las ${rutas.length} rutas dan 401`, malas.length === 0, malas.join(", ") || "todas 401");
  ok("nadie generó audio sin sesión", prov.calls === 0, `llamadas=${prov.calls}`);
  ok("sigue habiendo una sola cuenta", users.count() === 1);

  // --- Cookies falsificadas ---
  const idAdmin = users.getByUsername("admin").id;
  const futuro = Date.now() + 3600e3;
  const firmaReal = (p) => crypto.createHmac("sha256", "secreto-de-firma-de-prueba").update(p).digest("hex");
  const falsas = [
    ["basura", "essensa_sesion=basura"],
    ["firma inventada", `essensa_sesion=${idAdmin}.${futuro}.${"a".repeat(64)}`],
    ["sin firma", `essensa_sesion=${idAdmin}.${futuro}`],
    ["caducada pero bien firmada", `essensa_sesion=${idAdmin}.1000.${firmaReal(`${idAdmin}.1000`)}`],
    ["otro usuario con firma ajena", `essensa_sesion=999.${futuro}.${firmaReal(`${idAdmin}.${futuro}`)}`],
    ["id que no existe", `essensa_sesion=999.${futuro}.${firmaReal(`999.${futuro}`)}`],
    ["firma de otro secreto", `essensa_sesion=${idAdmin}.${futuro}.${crypto.createHmac("sha256", "otro").update(`${idAdmin}.${futuro}`).digest("hex")}`],
  ];
  const coladas = [];
  for (const [nombre, c] of falsas) {
    const r = await req("GET", "/api/admin/summary", { cookie: c });
    if (r.status !== 401) coladas.push(nombre);
  }
  ok(`${falsas.length} cookies falsificadas rechazadas`, coladas.length === 0, coladas.join(", ") || "todas 401");

  // --- Una sesión legítima sí entra ---
  const login = await req("POST", "/api/admin/login", { body: { username: "admin", password: "contrasena-inicial-larga" } });
  ok("la sesión legítima entra", login.status === 200);
  ok("la cookie es HttpOnly y SameSite=Strict", /HttpOnly/i.test(login.setCookie) && /SameSite=Strict/i.test(login.setCookie), login.setCookie);
  ok("en HTTP local la cookie NO lleva Secure (si no, nadie podría entrar)", !/Secure/i.test(login.setCookie));
  ok("con sesión, el panel responde", (await req("GET", "/api/admin/summary", { cookie: login.cookie })).status === 200);

  // --- Validaciones del generador por HTTP ---
  const big = await req("POST", "/api/generate", { cookie: login.cookie, body: { chatter_id: 1, model_id: 1, text: "z".repeat(5000) } });
  ok("texto de 5000 caracteres se rechaza en el servidor", big.status === 400);
  ok("los errores no traen el detalle del proveedor", !("detail" in (big.json || {})));

  // --- Fuerza bruta ---
  for (let i = 0; i < 11; i++) await req("POST", "/api/admin/login", { body: { username: "admin", password: "mala" } });
  ok("tras 10 fallos el login queda bloqueado (429)", (await req("POST", "/api/admin/login", { body: { username: "admin", password: "mala" } })).status === 429);

  // --- ElevenLabs sin clave: ni red ni error ---
  const el = await req("GET", "/api/admin/elevenlabs", { cookie: login.cookie });
  ok("sin ELEVENLABS_API_KEY el panel avisa y no rompe", el.status === 200 && /Falta ELEVENLABS_API_KEY/.test(el.json?.plan?.error || ""));

  console.log(out.join("\n"));
  const f = out.filter((x) => x.startsWith("FALLA")).length;
  console.log(`\n${out.length - f}/${out.length} pruebas de acceso pasan`);
  server.closeAllConnections?.();
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(f ? 1 : 0), 300);
})().catch((e) => { console.log(out.join("\n")); console.error("ERROR:", e); process.exit(1); });
