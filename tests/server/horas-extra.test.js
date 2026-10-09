// Esta prueba se ejecuta con `npm test` (ver tests/run.js).
// Roles Shift 1/2/3 y horas extra: fichar fuera del turno propio.
const PROJECT_ROOT = require("path").resolve(__dirname, "..", "..");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = PROJECT_ROOT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "essenza-extra-"));
process.env.DB_PATH = path.join(tmp, "t.db");
process.env.TIMEZONE = "America/Caracas";
process.env.ADMIN_PASSWORD = "contrasena-inicial-larga";
process.env.SESSION_SECRET = "secreto-de-prueba";
process.env.COOKIE_SECURE = "0";
delete process.env.SHIFT_HOURS;
delete process.env.BREAK_MINUTES;
delete process.env.EXEMPT_ROLES;
delete process.env.EXEMPT_HOURS;
delete process.env.ELEVENLABS_API_KEY;
delete process.env.DISCORD_TOKEN;

const express = require(path.join(ROOT, "node_modules/express"));
const db = require(path.join(ROOT, "src/db"));
const tz = require(path.join(ROOT, "src/timezone"));
const plans = require(path.join(ROOT, "src/shiftPlan"));
const s = require(path.join(ROOT, "src/shifts"));
const users = require(path.join(ROOT, "src/users"));
const { runAction } = require(path.join(ROOT, "src/fichajes"));
users.bootstrapFromEnv();

const out = [];
const ok = (n, c, e = "") => out.push(`${c ? "PASA " : "FALLA"}  ${n}${e ? "  -> " + e : ""}`);
const at = (d, h, m) => tz.zonedToUtc(2026, 10, d, h, m, "America/Caracas");
const M = 60e3;
// Plan de alguien con un rol de turno (y un apodo sin turno)
const conRol = (rol, when, id = "u") => plans.resolveForStart({ discordId: id, names: ["Ana - (Chatter)"], roleNames: [rol], startedAt: when });
const iniciar = (id, rol, when, names = ["Ana - (Chatter)"]) => s.startShift(id, id, when, plans.resolveForStart({ discordId: id, names, roleNames: rol ? [rol] : [], startedAt: when }));

(async () => {
  /* --- El rol se reconoce, con letras decorativas --- */
  ok("rol 'Shift 2' -> Shift 2 por rol", conRol("Shift 2", at(9, 13, 5)).templateName === "Shift 2" && conRol("Shift 2", at(9, 13, 5)).source === "rol");
  ok("rol 'Shift 3 (Chatter)' -> Shift 3", conRol("Shift 3 (Chatter)", at(9, 21, 20)).templateName === "Shift 3");
  ok("rol con letras decorativas '⏰ 𝗦𝗵𝗶𝗳𝘁 𝟭' -> Shift 1", conRol("⏰ 𝗦𝗵𝗶𝗳𝘁 𝟭", at(9, 5, 40)).templateName === "Shift 1");
  ok("rol 'SHIFT-2' en mayúsculas -> Shift 2", conRol("SHIFT-2", at(9, 13, 5)).templateName === "Shift 2");
  ok("el rol manda sobre el apodo cuando discrepan", plans.resolveForStart({ discordId: "x", names: ["Ana - Shift 2"], roleNames: ["Shift 1"], startedAt: at(9, 5, 40) }).templateName === "Shift 1");
  ok("sin rol de turno se usa el apodo", plans.resolveForStart({ discordId: "x", names: ["Ana - Shift 2"], roleNames: ["Chatter"], startedAt: at(9, 13, 5) }).source === "apodo");
  ok("un rol que no es de turno no confunde ('Chatter')", plans.resolveForStart({ discordId: "x", names: ["Ana"], roleNames: ["Chatter"], startedAt: at(9, 13, 5) }).source === "hora");

  /* --- Dentro del turno: NO es hora extra --- */
  const normal = (rol, when) => conRol(rol, when).isExtra === false;
  ok("Shift 1 a las 05:30: normal", normal("Shift 1", at(9, 5, 30)));
  ok("Shift 1 a las 12:50, tardísimo pero dentro del turno: normal y tarde", normal("Shift 1", at(9, 12, 50)) && conRol("Shift 1", at(9, 12, 50)).expectedAt != null);
  ok("Shift 1 a las 13:00 justo cuando termina: normal", normal("Shift 1", at(9, 13, 0)));
  ok("Shift 1 a las 04:00, antes de su turno: normal y adelantado", normal("Shift 1", at(9, 4, 0)));
  ok("Shift 2 a las 21:15 justo cuando termina: normal", normal("Shift 2", at(9, 21, 15)));
  ok("Shift 3 a las 05:10, tarde pero antes de que termine: normal", normal("Shift 3", at(10, 5, 10)));
  ok("Shift 3 a las 05:15 justo cuando termina: normal", normal("Shift 3", at(10, 5, 15)));

  /* --- Fuera del turno: SÍ es hora extra --- */
  const extra = (rol, when) => conRol(rol, when).isExtra === true;
  ok("Shift 1 a las 13:01: horas extra", extra("Shift 1", at(9, 13, 1)));
  ok("Shift 1 a las 15:00: horas extra", extra("Shift 1", at(9, 15, 0)));
  ok("Shift 1 a las 23:30: horas extra", extra("Shift 1", at(9, 23, 30)));
  ok("Shift 1 a las 00:30, de madrugada y lejos de su turno: horas extra", extra("Shift 1", at(10, 0, 30)));
  ok("Shift 2 a las 21:16: horas extra", extra("Shift 2", at(9, 21, 16)));
  ok("Shift 2 a las 02:00: horas extra", extra("Shift 2", at(10, 2, 0)));
  ok("Shift 3 a las 05:16: horas extra", extra("Shift 3", at(10, 5, 16)));
  ok("Shift 3 a las 06:00 al día siguiente: horas extra", extra("Shift 3", at(10, 6, 0)));
  ok("Shift 3 a las 15:00: horas extra", extra("Shift 3", at(10, 15, 0)));
  const pe = conRol("Shift 1", at(9, 15, 0));
  ok("el plan de horas extra: sin hora esperada, sin gracia y sin mínimo", pe.expectedAt === null && pe.graceMin === null && pe.durationMin === 0 && pe.shiftEndedAt === at(9, 13, 0));
  ok("también por apodo: 'Ana - Shift 1' a las 15:00 es horas extra", plans.resolveForStart({ discordId: "x", names: ["Ana - Shift 1"], startedAt: at(9, 15, 0) }).isExtra === true);

  /* --- Lo que NO puede ser hora extra --- */
  ok("deducido por la hora no hay forma de saberlo: no es extra", plans.resolveForStart({ discordId: "x", names: ["Ana"], startedAt: at(9, 15, 0) }).isExtra === false);
  ok("un directivo a esa misma hora no es extra", plans.resolveForStart({ discordId: "x", names: ["Dio - (Jefe de Chat)"], startedAt: at(9, 15, 0) }).isExtra !== true);
  db.prepare("INSERT INTO schedules VALUES ('pp','Personal','09:00',5)").run();
  ok("un horario personal tampoco es extra", plans.resolveForStart({ discordId: "pp", names: ["Ana"], roleNames: ["Shift 1"], startedAt: at(9, 15, 0) }).isExtra !== true);

  /* --- El fichaje de horas extra --- */
  iniciar("e1", "Shift 1", at(9, 15, 0));
  const row = db.prepare("SELECT * FROM shifts WHERE discord_id='e1'").get();
  ok("se guarda como extra, sin hora esperada y con mínimo 0", row.is_extra === 1 && row.expected_at === null && row.required_minutes === 0 && row.plan_source === "rol");
  const st0 = s.statusOf("e1", at(9, 15, 0));
  ok("puede terminar de inmediato (no hay mínimo)", st0.canEnd && st0.requiredMs === 0 && st0.isExtra);
  const fin = s.endShift("e1", at(9, 17, 30));
  ok("al terminar, todo lo trabajado cuenta como horas extra", fin.ok && Math.round(fin.extraMs / M) === 150, `${Math.round(fin.extraMs / M)} min`);

  // Un turno normal acumula 0 horas extra
  iniciar("n1", "Shift 1", at(9, 5, 30));
  ok("un turno normal no acumula horas extra", s.statusOf("n1", at(9, 9, 0)).extraMs === 0 && !s.statusOf("n1", at(9, 9, 0)).isExtra);
  ok("y el turno normal sigue exigiendo su duración de 7 h 30", s.endShift("n1", at(9, 12, 59)).reason === "too_early" && s.endShift("n1", at(9, 13, 0)).ok);

  // "Después de su horario se le da Start": segundo fichaje del día
  const segundo = iniciar("n1", "Shift 1", at(9, 14, 0));
  ok("tras terminar su turno, un segundo Start a las 14:00 es horas extra", segundo.ok && db.prepare("SELECT is_extra FROM shifts WHERE discord_id='n1' ORDER BY id DESC").get().is_extra === 1);
  s.endShift("n1", at(9, 15, 0));

  // Break en horas extra: la misma regla
  iniciar("e2", "Shift 2", at(9, 22, 0));
  s.startBreak("e2", at(9, 22, 30)); s.endBreak("e2", at(9, 23, 15));
  const e2 = s.endShift("e2", at(10, 0, 0));
  ok("el exceso de break también se descuenta en horas extra", e2.ok && Math.round(e2.breakOverMs / M) === 15 && Math.round(e2.extraMs / M) === 105, `trabajado ${Math.round(e2.extraMs / M)} min`);

  /* --- Mensajes del bot (con hora fija, para no depender de cuándo se ejecuta) --- */
  db.prepare("DELETE FROM shifts").run();
  const m1 = runAction("start", "m1", "Ana", ["Ana - (Chatter)"], ["Shift 1"], at(9, 15, 0));
  ok("Start fuera de turno avisa que son horas extra y que no se mide puntualidad", /horas extra/.test(m1) && /No se mide puntualidad/.test(m1) && !/Llegaste/.test(m1), m1.split("\n")[1].slice(0, 130));
  ok("el aviso dice que puede terminar cuando termine", /cuando termines/.test(m1));
  const st = runAction("status", "m1", "Ana", [], [], at(9, 16, 30));
  ok("Mi estado marca las horas extra y cuánto lleva", /horas extra/.test(st) && /Llevas \*\*1 h 30 min\*\*/.test(st), st.split("\n").slice(0, 2).join(" | "));
  ok("Mi estado dice que puede pulsar End cuando termine", /Pulsa \*\*End\*\* cuando termines/.test(st));
  const end = runAction("end", "m1", "Ana", [], [], at(9, 17, 0));
  ok("End indica que terminaron las horas extra", /Horas extra terminadas/.test(end) && /todo cuenta como horas extra/.test(end) && /2 h/.test(end), end.slice(0, 110));
  db.prepare("DELETE FROM shifts").run();
  const m2 = runAction("start", "m2", "Luis", ["Luis - (Chatter)"], ["Shift 1"], at(9, 5, 40));
  ok("fichar dentro de su turno NO dice horas extra y mide la puntualidad", !/horas extra/.test(m2) && /Llegaste a tiempo/.test(m2) && /7 h 30 min/.test(m2), m2.split("\n").slice(-1)[0].slice(0, 120));
  const m3 = runAction("start", "m3", "Eva", ["Eva - (Chatter)"], ["Shift 2"], at(9, 21, 30));
  ok("Shift 2 que ficha a las 21:30 también es horas extra", /horas extra/.test(m3) && /Shift 2/.test(m3));

  /* --- API y panel --- */
  db.prepare("DELETE FROM shifts").run();
  const base0 = Date.now();
  iniciar("api1", "Shift 1", base0 - 3 * 3600e3, ["Ana - (Chatter)"]);          // normal (se fuerza abajo)
  db.prepare("UPDATE shifts SET is_extra = 0 WHERE discord_id = 'api1'").run();
  db.prepare("INSERT INTO shifts (discord_id,discord_name,started_at,ended_at,is_extra,required_minutes,plan_source,template_name) VALUES ('api2','Eva',?,?,1,0,'rol','Shift 1')").run(base0 - 5 * 3600e3, base0 - 3 * 3600e3); // extra de 2 h
  db.prepare("INSERT INTO shifts (discord_id,discord_name,started_at,ended_at,is_extra,required_minutes,plan_source,template_name) VALUES ('api3','Eva',?,?,1,0,'rol','Shift 1')").run(base0 - 2 * 3600e3, base0 - 1 * 3600e3); // extra de 1 h
  db.prepare("INSERT INTO shifts (discord_id,discord_name,started_at,ended_at,required_minutes) VALUES ('api4','Normal',?,?,450)").run(base0 - 30 * 3600e3, base0 - 22.5 * 3600e3); // turno de 7 h 30

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
  const f = await call("GET", "/api/admin/fichajes?range=7", { cookie: admin });
  const k = f.json.kpis;
  ok("el panel suma las horas extra: 3 h en 2 fichajes", k.extraCount === 2 && Math.round(k.extraMs / 3600e3) === 3, `${k.extraCount} fichajes, ${Math.round(k.extraMs / 60000)} min`);
  ok("las cuenta por persona (Eva, que ficha con dos cuentas distintas)", k.extraPeople === 2, `personas=${k.extraPeople}`);
  ok("el promedio por turno NO incluye las horas extra", Math.round(k.avgWorkedMs / 60000) === 450, `${Math.round(k.avgWorkedMs / 60000)} min`);
  ok("las horas extra no inflan 'sin medir'", k.unscheduled === 1, `sin medir=${k.unscheduled}`);
  ok("las horas extra no cuentan como llegadas tarde", k.lateCount === 0, `tardes=${k.lateCount}`);
  const h = f.json.history.find((x) => x.discordId === "api2");
  ok("el historial marca isExtra y extraMs", h.isExtra === true && Math.round(h.extraMs / 60000) === 120);
  const pe2 = f.json.people.find((x) => x.discordId === "api2");
  ok("la tabla por persona trae sus horas extra", pe2.extraCount === 1 && Math.round(pe2.extraMs / 60000) === 120);

  console.log(out.join("\n"));
  const fails = out.filter((x) => x.startsWith("FALLA")).length;
  console.log(`\n${out.length - fails}/${out.length} pruebas de horas extra pasan`);
  server.closeAllConnections?.();
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(fails ? 1 : 0), 300);
})().catch((e) => { console.log(out.join("\n")); console.error("ERROR:", e); process.exit(1); });
