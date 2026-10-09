// Esta prueba se ejecuta con `npm test` (ver tests/run.js).
const PROJECT_ROOT = require("path").resolve(__dirname, "..", "..");
// Turnos: prioridad (horario personal, apodo, cargo exento, hora de Start), puntualidad,
// mensajes del bot y API de turnos.
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = PROJECT_ROOT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "essensa-plan-"));
process.env.DB_PATH = path.join(tmp, "t.db");
process.env.TIMEZONE = "America/Caracas";
process.env.ADMIN_PASSWORD = "contrasena-inicial-larga";
process.env.SESSION_SECRET = "secreto-de-prueba";
process.env.COOKIE_SECURE = "0";
delete process.env.EXEMPT_ROLES;
delete process.env.ELEVENLABS_API_KEY;
delete process.env.DISCORD_TOKEN;

const express = require(path.join(ROOT, "node_modules/express"));
const db = require(path.join(ROOT, "src/db"));
const tz = require(path.join(ROOT, "src/timezone"));
const plans = require(path.join(ROOT, "src/shiftPlan"));
const shifts = require(path.join(ROOT, "src/shifts"));
const users = require(path.join(ROOT, "src/users"));
const { panelPayload, runAction } = require(path.join(ROOT, "src/fichajes"));
users.bootstrapFromEnv();

const out = [];
const ok = (n, c, e = "") => out.push(`${c ? "PASA " : "FALLA"}  ${n}${e ? "  -> " + e : ""}`);
const CCS = "America/Caracas";
const at = (d, h, m) => tz.zonedToUtc(2026, 10, d, h, m, CCS); // Venezuela es UTC-4 todo el año
const plan = (names, when, id = "u1") => plans.resolveForStart({ discordId: id, names, startedAt: when });
const lateMin = (pl, when) => (pl && pl.expectedAt != null ? Math.round((when - pl.expectedAt) / 60000) : null);

(async () => {
  const ts = plans.listTemplates();
  ok("hay 3 turnos con las horas de Venezuela", ts.map((t) => t.startTime).join() === "05:30,13:00,21:15");

  /* --- 2) Apodo con el turno --- */
  const nick = (n, when) => plan([n], when);
  ok("'Alejandro - Shift 2 (Chatter)' -> Shift 2 por apodo", nick("Alejandro - Shift 2 (Chatter)", at(9, 13, 5)).templateName === "Shift 2" && nick("Alejandro - Shift 2 (Chatter)", at(9, 13, 5)).source === "apodo");
  ok("variantes: shift2, SHIFT-2, shift_3", nick("ana shift2", at(9, 13, 0)).templateName === "Shift 2" && nick("ANA SHIFT-2", at(9, 13, 0)).templateName === "Shift 2" && nick("ana_shift_3", at(9, 21, 0)).templateName === "Shift 3");
  ok("el apodo detecta un retraso de más de 4 h (la hora sola no lo vería)", lateMin(nick("Ana - Shift 2", at(9, 19, 0)), at(9, 19, 0)) === 360, `${lateMin(nick("Ana - Shift 2", at(9, 19, 0)), at(9, 19, 0))} min`);
  ok("'Shift 10' no se confunde con 'Shift 1'", nick("Pepe Shift 10", at(9, 5, 0)).source !== "apodo");

  /* --- 4) Deducción por la hora de Start (sin nada en el nombre) --- */
  const inf = (when, names = ["Ana - (Chatter)"]) => plan(names, when);
  const casos = [
    ["Start 05:30 -> Shift 1 a tiempo", at(9, 5, 30), "Shift 1", 0],
    ["Start 05:55 -> Shift 1, 25 min tarde", at(9, 5, 55), "Shift 1", 25],
    ["Start 05:20 -> Shift 1, 10 min antes", at(9, 5, 20), "Shift 1", -10],
    ["CASO REAL: Start 05:35 (4:35 en Colombia) -> Shift 1, 5 min, dentro de la gracia", at(9, 5, 35), "Shift 1", 5],
    ["Start 13:07 -> Shift 2, 7 min", at(9, 13, 7), "Shift 2", 7],
    ["Start 13:40 -> Shift 2, 40 min tarde", at(9, 13, 40), "Shift 2", 40],
    ["Start 12:50 -> Shift 2, 10 min antes", at(9, 12, 50), "Shift 2", -10],
    ["Start 21:15 -> Shift 3 a tiempo", at(9, 21, 15), "Shift 3", 0],
    ["Start 00:30 -> Shift 3, 3 h 15 tarde (cruza medianoche)", at(10, 0, 30), "Shift 3", 195],
    ["Start 21:05 -> Shift 3, 10 min antes", at(9, 21, 5), "Shift 3", -10],
    ["Start 17:14 -> Shift 2, 254 min tarde (último momento antes del cambio)", at(9, 17, 14), "Shift 2", 254],
    ["Start 17:16 -> se lee como Shift 3 adelantado (límite de 4 h antes del turno)", at(9, 17, 16), "Shift 3", -239],
  ];
  for (const [n, when, esperado, tarde] of casos) {
    const pl = inf(when);
    ok(n, pl && pl.templateName === esperado && pl.source === "hora" && lateMin(pl, when) === tarde, pl ? `${pl.templateName} ${lateMin(pl, when)} min (${pl.source})` : "sin plan");
  }

  /* --- Zona horaria de quien ficha: no importa --- */
  const instante = Date.UTC(2026, 9, 9, 17, 5); // 17:05 UTC
  ok("12:05 en Colombia (UTC-5) = 13:05 en Venezuela: Shift 2, 5 min", lateMin(inf(instante), instante) === 5 && inf(instante).templateName === "Shift 2");
  ok("14:05 en Argentina (UTC-3) = el mismo instante: Shift 2, 5 min", lateMin(inf(instante), instante) === 5);

  /* --- 3) Cargos exentos --- */
  const ex = (names, when = at(9, 8, 0)) => plan(names, when);
  ok("'Steban - (Team Leader)' queda exento", ex(["Steban - (Team Leader)"]).source === "exento");
  ok("'Dio - (Jefe de Chat)' queda exento", ex(["Dio - (Jefe de Chat)"]).source === "exento");
  ok("'Felix - (Content Manager)' queda exento", ex(["Felix - (Content Manager)"]).source === "exento");
  ok("un exento a las 08:00 NO sale 3 h tarde", ex(["Steban - (Team Leader)"]).expectedAt === null);
  ok("rol con letras decorativas también cuenta", ex(["💬 𝗧𝗲𝗮𝗺 𝗟𝗲𝗮𝗱𝗲𝗿"]).source === "exento");
  ok("'Sebastian - (Trial Chatter)' SÍ se mide (por hora)", ex(["Sebastian - (Trial Chatter)"], at(9, 13, 10)).source === "hora");
  ok("exento pero con Shift en el apodo: gana el turno escrito", ex(["Dio - Shift 2 (Jefe de Chat)"], at(9, 13, 10)).source === "apodo");
  ok("'Team Leaderboard' no se confunde con Team Leader", ex(["Team Leaderboard"]).source === "hora");
  db.prepare("INSERT INTO schedules VALUES ('p1','Personal','09:00',5)").run();
  ok("un horario personal manda sobre todo", plan(["Steban - (Team Leader)", "Shift 1"], at(9, 9, 20), "p1").source === "personal");

  /* --- Con un solo turno no se puede deducir --- */
  db.prepare("DELETE FROM shift_templates WHERE name != 'Shift 1'").run();
  ok("con un solo turno definido, sin apodo no se mide", plan(["Ana"], at(9, 6, 0)) === null);
  ok("con un solo turno definido, el apodo sigue funcionando", plan(["Ana Shift 1"], at(9, 6, 0)).source === "apodo");
  const ins = db.prepare("INSERT INTO shift_templates (name, start_time, grace_minutes) VALUES (?, ?, ?)");
  ins.run("Shift 2", "13:00", 10); ins.run("Shift 3", "21:00", 10);
  ok("al volver a tener 3 turnos se deduce otra vez", plan(["Ana"], at(9, 13, 0)).templateName === "Shift 2");

  /* --- El fichaje guarda cómo se decidió --- */
  const when = at(9, 13, 40);
  const pl = plan(["Carla - (Chatter)"], when, "u3");
  const r = shifts.startShift("u3", "Carla", when, pl);
  ok("el fichaje guarda turno, hora esperada y origen", r.shift.template_name === "Shift 2" && r.shift.expected_at === pl.expectedAt && r.shift.plan_source === "hora");
  db.prepare("UPDATE shift_templates SET start_time = '14:00' WHERE name = 'Shift 2'").run();
  ok("cambiar un turno NO reescribe fichajes pasados", db.prepare("SELECT expected_at FROM shifts WHERE discord_id='u3'").get().expected_at === pl.expectedAt);
  db.prepare("UPDATE shift_templates SET start_time = '13:00' WHERE name = 'Shift 2'").run();
  const ex1 = shifts.startShift("u4", "Steban", at(9, 8, 0), plan(["Steban - (Team Leader)"], at(9, 8, 0), "u4"));
  ok("un directivo se guarda sin hora esperada, con su origen y 10 h", ex1.shift.expected_at === null && ex1.shift.plan_source === "exento" && ex1.shift.required_minutes === 600);

  /* --- Mensajes del bot --- */
  db.prepare("DELETE FROM shifts").run();
  const mA = runAction("start", "m1", "Ana", ["Ana - (Chatter)"]);
  ok("mensaje por hora: dice que se dedujo y trae la hora en el reloj de cada uno", /deducido por tu hora de entrada/.test(mA) && /<t:\d+:t>/.test(mA), mA.split("\n").slice(-1)[0].slice(0, 160));
  ok("el mensaje conserva la referencia en hora de Venezuela", /\(\d\d:\d\d, hora de Venezuela\)/.test(mA));
  const mB = runAction("start", "m2", "Steban", ["Steban - (Team Leader)"]);
  ok("mensaje de directivo: no se mide la puntualidad y dice la jornada de 10 h", /no se mide tu puntualidad/.test(mB) && /10 h/.test(mB) && !/Llegaste/.test(mB), mB.split("\n").slice(-1)[0].slice(0, 100));
  const mC = runAction("start", "m3", "Alejandro", ["Alejandro - Shift 2 (Chatter)"]);
  ok("mensaje por apodo: no dice 'deducido'", /Shift 2/.test(mC) && !/deducido/.test(mC));
  ok("Start dos veces avisa y no duplica", /Ya tienes un turno abierto/.test(runAction("start", "m3", "Alejandro", ["Alejandro - Shift 2 (Chatter)"])));
  ok("el panel de Discord sigue generándose", panelPayload().embeds.length === 1);

  /* --- API --- */
  const app = express();
  app.use(express.json());
  app.use("/api/admin", require(path.join(ROOT, "src/admin")));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((rr) => server.once("listening", rr));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, { body, cookie } = {}) => {
    const rs = await fetch(base + p, { method: m, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = rs.headers.getSetCookie?.()[0] || rs.headers.get("set-cookie");
    return { status: rs.status, cookie: sc ? sc.split(";")[0] : null, json: await rs.json().catch(() => null) };
  };
  const admin = (await call("POST", "/api/admin/login", { body: { username: "admin", password: "contrasena-inicial-larga" } })).cookie;
  users.create({ username: "laura", displayName: "Laura", password: "contrasena-de-laura", role: "manager" });
  const man = (await call("POST", "/api/admin/login", { body: { username: "laura", password: "contrasena-de-laura" } })).cookie;

  const fich = await call("GET", "/api/admin/fichajes?range=7", { cookie: admin });
  const ana = fich.json.history.find((s) => s.discordId === "m1");
  ok("fichajes: Ana aparece con su turno y el origen 'hora'", ana && ana.templateName && ana.planSource === "hora");
  const ste = fich.json.history.find((s) => s.discordId === "m2");
  ok("fichajes: el exento no se marca tarde y no cuenta como medido", ste && !ste.late && !ste.scheduled && ste.planSource === "exento");
  ok("el aviso cuenta a los exentos como 'sin medir'", fich.json.kpis.unscheduled === 1, `sin medir=${fich.json.kpis.unscheduled}`);

  const sch = await call("GET", "/api/admin/schedules", { cookie: admin });
  ok("el panel recibe los turnos y la zona de la agencia", sch.json.templates.length === 3 && sch.json.tz === "America/Caracas");
  ok("el admin crea un turno", (await call("POST", "/api/admin/templates", { cookie: admin, body: { name: "Shift 4", startTime: "09:30", graceMin: 15 } })).status === 201);
  const id4 = plans.listTemplates().find((t) => t.name === "Shift 4").id;
  ok("el admin edita y borra un turno", (await call("PUT", `/api/admin/templates/${id4}`, { cookie: admin, body: { name: "Shift 4", startTime: "10:00", graceMin: 15 } })).status === 200 && (await call("DELETE", `/api/admin/templates/${id4}`, { cookie: admin })).status === 200);
  const prohibido = [];
  for (const [m, p, b] of [["POST", "/api/admin/templates", { name: "H", startTime: "10:00", graceMin: 10 }], ["DELETE", "/api/admin/templates/1"]]) {
    if ((await call(m, p, { cookie: man, body: b })).status !== 403) prohibido.push(`${m} ${p}`);
  }
  ok("el manager no puede tocar turnos (403)", prohibido.length === 0);
  ok("sin sesión no se tocan los turnos", (await call("POST", "/api/admin/templates", { body: { name: "H", startTime: "10:00", graceMin: 10 } })).status === 401);

  console.log(out.join("\n"));
  const f = out.filter((x) => x.startsWith("FALLA")).length;
  console.log(`\n${out.length - f}/${out.length} pruebas de turnos pasan`);
  server.closeAllConnections?.();
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(f ? 1 : 0), 300);
})().catch((e) => { console.log(out.join("\n")); console.error("ERROR:", e); process.exit(1); });
