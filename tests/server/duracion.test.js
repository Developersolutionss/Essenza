// Esta prueba se ejecuta con `npm test` (ver tests/run.js).
const PROJECT_ROOT = require("path").resolve(__dirname, "..", "..");
// Duración propia de cada turno: End, mensajes, historial y API.
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = PROJECT_ROOT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "essensa-dur-"));
process.env.DB_PATH = path.join(tmp, "t.db");
process.env.TIMEZONE = "America/Caracas";
process.env.ADMIN_PASSWORD = "contrasena-inicial-larga";
process.env.SESSION_SECRET = "secreto-de-prueba";
process.env.COOKIE_SECURE = "0";
delete process.env.SHIFT_HOURS;
delete process.env.BREAK_MINUTES;
delete process.env.ELEVENLABS_API_KEY;
delete process.env.DISCORD_TOKEN;

const express = require(path.join(ROOT, "node_modules/express"));
const db = require(path.join(ROOT, "src/db"));
const tz = require(path.join(ROOT, "src/timezone"));
const plans = require(path.join(ROOT, "src/shiftPlan"));
const s = require(path.join(ROOT, "src/shifts"));
const users = require(path.join(ROOT, "src/users"));
const { panelPayload, runAction } = require(path.join(ROOT, "src/fichajes"));
users.bootstrapFromEnv();

const out = [];
const ok = (n, c, e = "") => out.push(`${c ? "PASA " : "FALLA"}  ${n}${e ? "  -> " + e : ""}`);
const at = (d, h, m) => tz.zonedToUtc(2026, 10, d, h, m, "America/Caracas");
const M = 60e3;
const start = (id, names, when) => s.startShift(id, id, when, plans.resolveForStart({ discordId: id, names, startedAt: when }));

(async () => {
  const t = Object.fromEntries(plans.listTemplates().map((x) => [x.name, x.durationMin]));
  ok("duraciones por defecto: 7 h 30, 8 h 15 y 8 h", t["Shift 1"] === 450 && t["Shift 2"] === 495 && t["Shift 3"] === 480, JSON.stringify(t));

  // Shift 1: entra 05:30, puede salir 13:00
  start("a", ["Ana - Shift 1"], at(9, 5, 30));
  ok("Shift 1 a las 12:59: todavía no", s.endShift("a", at(9, 12, 59)).reason === "too_early");
  ok("Shift 1 a las 13:00: ya puede", s.endShift("a", at(9, 13, 0)).ok);

  // Shift 2: 13:00 a 21:15
  start("b", ["Luis - Shift 2"], at(9, 13, 0));
  ok("Shift 2 a las 21:00: todavía no", s.endShift("b", at(9, 21, 0)).reason === "too_early");
  ok("Shift 2 a las 21:15: ya puede", s.endShift("b", at(9, 21, 15)).ok);

  // Shift 3: 21:15 a 05:15 del día siguiente
  start("c", ["Marta - Shift 3"], at(9, 21, 15));
  ok("Shift 3 a las 05:14: todavía no", s.endShift("c", at(10, 5, 14)).reason === "too_early");
  ok("Shift 3 a las 05:15: ya puede", s.endShift("c", at(10, 5, 15)).ok);

  // Deducido por hora también usa la duración del turno
  start("d", ["Pepe - (Chatter)"], at(9, 5, 32));
  const dRow = db.prepare("SELECT * FROM shifts WHERE discord_id='d'").get();
  ok("turno deducido por hora: guarda la duración de Shift 1", dRow.template_name === "Shift 1" && dRow.required_minutes === 450);
  ok("y sale a las 13:02 (7 h 30 desde su Start)", !s.endShift("d", at(9, 13, 1)).ok && s.endShift("d", at(9, 13, 2)).ok);

  // Llegar tarde: se sale más tarde
  start("e", ["Eva - Shift 1"], at(9, 6, 0));
  ok("quien entra 30 min tarde a Shift 1 sale a las 13:30", s.endShift("e", at(9, 13, 29)).reason === "too_early" && s.endShift("e", at(9, 13, 30)).ok);

  // Break dentro de la duración del turno
  start("f", ["Fer - Shift 1"], at(9, 5, 30));
  s.startBreak("f", at(9, 9, 0)); s.endBreak("f", at(9, 9, 30));
  ok("Shift 1 con 30 min de break: sale igual a las 13:00", s.endShift("f", at(9, 13, 0)).ok);
  start("g", ["Gus - Shift 1"], at(9, 5, 30));
  s.startBreak("g", at(9, 9, 0)); s.endBreak("g", at(9, 9, 45));
  ok("Shift 1 con 45 min de break: debe recuperar 15, sale a las 13:15", s.endShift("g", at(9, 13, 0)).reason === "too_early" && s.endShift("g", at(9, 13, 15)).ok);

  // Sin turno: duración general (8 h)
  start("h", ["Steban - (Team Leader)"], at(9, 8, 0));
  const hRow = db.prepare("SELECT * FROM shifts WHERE discord_id='h'").get();
  ok("cargo directivo: exige 10 h", hRow.required_minutes === 600 && s.statusOf("h", at(9, 8, 0)).requiredMs === 10 * 3600e3, `guarda ${hRow.required_minutes} min`);
  ok("el directivo sale a las 18:00, a las 10 h de su Start", !s.endShift("h", at(9, 17, 59)).ok && s.endShift("h", at(9, 18, 0)).ok);
  start("j", ["Dio - (Jefe de Chat)"], at(9, 9, 0));
  s.startBreak("j", at(9, 12, 0)); s.endBreak("j", at(9, 12, 30));
  ok("directivo con 30 min de break: sale igual a las 10 h", !s.endShift("j", at(9, 18, 59)).ok && s.endShift("j", at(9, 19, 0)).ok);
  start("k", ["Felix - (Content Manager)"], at(9, 9, 0));
  s.startBreak("k", at(9, 12, 0)); s.endBreak("k", at(9, 12, 45));
  ok("directivo con 45 min de break: recupera los 15 y sale a las 19:15", !s.endShift("k", at(9, 19, 0)).ok && s.endShift("k", at(9, 19, 15)).ok);
  start("l", ["Dio - Shift 2 (Jefe de Chat)"], at(9, 13, 0));
  ok("directivo con Shift en el apodo: gana el turno (8 h 15 min)", s.statusOf("l", at(9, 13, 0)).requiredMs === 495 * M);
  db.prepare("INSERT INTO schedules VALUES ('p1','Personal','09:00',5)").run();
  start("p1", ["Personal"], at(9, 9, 0));
  ok("horario personal: duración general de 8 h (sin ser directivo)", s.statusOf("p1", at(9, 9, 0)).requiredMs === 8 * 3600e3);

  // Cambiar un turno no afecta a quien ya está dentro
  start("i", ["Iris - Shift 2"], at(9, 13, 0));
  db.prepare("UPDATE shift_templates SET duration_minutes = 600 WHERE name = 'Shift 2'").run();
  ok("cambiar la duración de Shift 2 no altera un turno ya iniciado", s.statusOf("i", at(9, 13, 0)).requiredMs === 495 * M);
  db.prepare("UPDATE shift_templates SET duration_minutes = 495 WHERE name = 'Shift 2'").run();

  // Turno sin duración guardada (instalación anterior): usa 8 h
  db.prepare("INSERT INTO shift_templates (name, start_time, grace_minutes) VALUES ('Viejo', '09:00', 10)").run();
  ok("turno sin duración: exige las 8 h generales", plans.listTemplates().find((x) => x.name === "Viejo").durationMin === null);
  db.prepare("DELETE FROM shift_templates WHERE name = 'Viejo'").run();

  // Mensajes del bot
  db.prepare("DELETE FROM shifts").run();
  const msg = runAction("start", "m1", "Ana", ["Ana - Shift 1"]);
  ok("al iniciar, el bot dice la duración de su turno", /al cumplir 7 h 30 min/.test(msg), msg.split("\n")[1]);
  const st = runAction("status", "m1", "Ana", []);
  ok("Mi estado muestra el turno y su duración", /Shift 1/.test(st) && /de 7 h 30 min/.test(st), st.split("\n").slice(0, 2).join(" | "));
  const end = runAction("end", "m1", "Ana", []);
  ok("End antes de tiempo indica la duración del turno", /de 7 h 30 min/.test(end), end.slice(0, 90));
  const desc = panelPayload().embeds[0].toJSON().description;
  ok("el panel de Discord lista los tres turnos con su salida y duración", /Shift 1: 05:30 a 13:00 \(7 h 30 min\)/.test(desc) && /Shift 3: 21:15 a 05:15 \(8 h 00 min\)|Shift 3: 21:15 a 05:15 \(8 h\)/.test(desc), desc.split("\n").slice(1, 4).join(" | "));

  // API
  const app = express();
  app.use(express.json());
  app.use("/api/admin", require(path.join(ROOT, "src/admin")));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, { body, cookie } = {}) => {
    const r = await fetch(base + p, { method: m, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie?.()[0] || r.headers.get("set-cookie");
    return { status: r.status, cookie: sc ? sc.split(";")[0] : null, json: await r.json().catch(() => null) };
  };
  const admin = (await call("POST", "/api/admin/login", { body: { username: "admin", password: "contrasena-inicial-larga" } })).cookie;
  const sch = await call("GET", "/api/admin/schedules", { cookie: admin });
  ok("la API envía la duración de cada turno y la general", sch.json.templates.every((x) => x.durationMin) && sch.json.defaultDurationMin === 480);
  const id1 = plans.listTemplates().find((x) => x.name === "Shift 1").id;
  ok("guardar Shift 1 con 8 h de duración", (await call("PUT", `/api/admin/templates/${id1}`, { cookie: admin, body: { name: "Shift 1", startTime: "05:30", graceMin: 10, durationMin: 480 } })).status === 200 && plans.listTemplates().find((x) => x.name === "Shift 1").durationMin === 480);
  ok("guardar sin enviar duración conserva la que tenía", (await call("PUT", `/api/admin/templates/${id1}`, { cookie: admin, body: { name: "Shift 1", startTime: "05:30", graceMin: 10 } })).status === 200 && plans.listTemplates().find((x) => x.name === "Shift 1").durationMin === 480);
  ok("duración de 10 min se rechaza", (await call("PUT", `/api/admin/templates/${id1}`, { cookie: admin, body: { name: "Shift 1", startTime: "05:30", graceMin: 10, durationMin: 10 } })).status === 400);
  ok("duración de 25 h se rechaza", (await call("PUT", `/api/admin/templates/${id1}`, { cookie: admin, body: { name: "Shift 1", startTime: "05:30", graceMin: 10, durationMin: 1500 } })).status === 400);
  ok("crear un turno con duración", (await call("POST", "/api/admin/templates", { cookie: admin, body: { name: "Shift 4", startTime: "09:00", graceMin: 10, durationMin: 360 } })).status === 201 && plans.listTemplates().find((x) => x.name === "Shift 4").durationMin === 360);

  const fich = await call("GET", "/api/admin/fichajes?range=7", { cookie: admin });
  ok("Fichajes envía la duración exigida de cada turno abierto", fich.json.open.every((x) => typeof x.requiredMs === "number"));

  console.log(out.join("\n"));
  const f = out.filter((x) => x.startsWith("FALLA")).length;
  console.log(`\n${out.length - f}/${out.length} pruebas de duración pasan`);
  server.closeAllConnections?.();
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(f ? 1 : 0), 300);
})().catch((e) => { console.log(out.join("\n")); console.error("ERROR:", e); process.exit(1); });
