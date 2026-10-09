// Esta prueba se ejecuta con `npm test` (ver tests/run.js).
const PROJECT_ROOT = require("path").resolve(__dirname, "..", "..");
// Pruebas de fichajes: reglas, panel de Discord y cierre desde el panel web.
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = PROJECT_ROOT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "essensa-shift-"));
process.env.DB_PATH = path.join(tmp, "t.db");
process.env.TIMEZONE = "America/Bogota";
process.env.ADMIN_PASSWORD = "contrasena-de-prueba";
process.env.COOKIE_SECURE = "0";
delete process.env.ELEVENLABS_API_KEY;
delete process.env.DISCORD_TOKEN;

const express = require(path.join(ROOT, "node_modules/express"));
const crypto = require("crypto");
const db = require(path.join(ROOT, "src/db"));
const shifts = require(path.join(ROOT, "src/shifts"));
const { panelPayload } = require(path.join(ROOT, "src/fichajes"));

const app = express();
app.use(express.json());
app.use("/api/admin", require(path.join(ROOT, "src/admin")));
const server = app.listen(0, "127.0.0.1");

const out = [];
const ok = (n, c, e = "") => out.push(`${c ? "PASA " : "FALLA"}  ${n}${e ? "  -> " + e : ""}`);
const H = 3600e3, M = 60e3;

(async () => {
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  require(path.join(ROOT, "src/users")).bootstrapFromEnv();
  const lr = await fetch(base + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "contrasena-de-prueba" }),
  });
  const cookie = (lr.headers.getSetCookie?.()[0] || lr.headers.get("set-cookie")).split(";")[0];
  const req = async (m, p, body) => {
    const r = await fetch(base + p, { method: m, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  const t0 = Date.now() - 10 * H;

  // --- Reglas básicas ---
  ok("Start abre turno", shifts.startShift("u1", "Ana", t0).ok);
  ok("Start otra vez: avisa y no duplica", shifts.startShift("u1", "Ana", t0 + M).reason === "already_open");
  ok("solo hay un turno abierto", db.prepare("SELECT COUNT(*) n FROM shifts WHERE discord_id='u1' AND ended_at IS NULL").get().n === 1);
  ok("Resume sin break: avisa", shifts.endBreak("u1", t0 + 2 * M).reason === "not_on_break");
  ok("Break inicia", shifts.startBreak("u1", t0 + 2 * H).ok);
  ok("Break otra vez estando en break: avisa", shifts.startBreak("u1", t0 + 2 * H + M).reason === "already_on_break");
  ok("End en break: rechazado", shifts.endShift("u1", t0 + 3 * H).reason === "on_break");
  const back = shifts.endBreak("u1", t0 + 2 * H + 45 * M);
  ok("Resume marca el exceso de break", Math.round(back.st.breakOverMs / M) === 15, `${Math.round(back.st.breakOverMs / M)} min`);
  ok("segundo break: rechazado (uno por turno)", shifts.startBreak("u1", t0 + 5 * H).reason === "break_used");
  ok("End demasiado pronto: rechazado", shifts.endShift("u1", t0 + 6 * H).reason === "too_early");

  // --- Cierre desde el panel web ---
  const openShift = db.prepare("SELECT * FROM shifts WHERE discord_id='u1' AND ended_at IS NULL").get();
  ok("cerrar turno inexistente da 404", (await req("POST", "/api/admin/shifts/99999/close")).status === 404);
  ok("cerrar con hora futura da 400", (await req("POST", `/api/admin/shifts/${openShift.id}/close`, { endedAt: Date.now() + H })).status === 400);
  ok("cerrar turno abierto funciona", (await req("POST", `/api/admin/shifts/${openShift.id}/close`)).status === 200);
  const closed = db.prepare("SELECT * FROM shifts WHERE id = ?").get(openShift.id);
  ok("el turno queda cerrado en la base", Boolean(closed.ended_at));
  ok("cerrar dos veces da 409", (await req("POST", `/api/admin/shifts/${openShift.id}/close`)).status === 409);
  ok("tras cerrarlo se puede abrir uno nuevo", shifts.startShift("u1", "Ana", Date.now()).ok);

  // --- Cierre con un break abierto ---
  const s2 = db.prepare("INSERT INTO shifts (discord_id,discord_name,started_at) VALUES ('u2','Luis',?)").run(Date.now() - 5 * H).lastInsertRowid;
  db.prepare("INSERT INTO shift_breaks (shift_id,started_at) VALUES (?,?)").run(s2, Date.now() - 20 * M);
  await req("POST", `/api/admin/shifts/${s2}/close`);
  const openBreaks = db.prepare("SELECT COUNT(*) n FROM shift_breaks WHERE shift_id=? AND ended_at IS NULL").get(s2).n;
  ok("al cerrar el turno también se cierra el break abierto", openBreaks === 0);
  const st2 = shifts.listSince(0).find((x) => x.shift.id === Number(s2));
  ok("el turno cerrado cuenta el break permitido como trabajado (5 h)", Math.round(st2.workedMs / M) === 300, `${Math.round(st2.workedMs / M)} min`);

  // --- Panel de Discord con mucha gente ---
  db.prepare("DELETE FROM shifts").run();
  for (let i = 0; i < 40; i++) {
    db.prepare("INSERT INTO shifts (discord_id,discord_name,started_at) VALUES (?,?,?)").run(`9000000000000000${String(i).padStart(2,"0")}`, `Persona ${i}`, Date.now() - H);
  }
  const payload = panelPayload();
  const fields = payload.embeds[0].toJSON().fields;
  const tooLong = fields.filter((f) => f.value.length > 1024);
  ok("con 40 personas, ningún campo del panel supera 1024 caracteres", tooLong.length === 0, fields.map((f) => f.value.length).join(" / "));
  ok("el panel avisa de cuántas personas no caben", /y \d+ más/.test(fields[0].value), fields[0].value.slice(-20));
  ok("el panel sigue teniendo 5 botones en una fila", payload.components[0].toJSON().components.length === 5);
  ok("el título del campo muestra el total real", fields[0].name.includes("40"), fields[0].name);

  console.log(out.join("\n"));
  const f = out.filter((x) => x.startsWith("FALLA")).length;
  console.log(`\n${out.length - f}/${out.length} pruebas de fichajes pasan`);
  server.closeAllConnections?.();
  server.close();
  try { db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(f ? 1 : 0), 300);
})().catch((e) => { console.log(out.join("\n")); console.error("ERROR:", e); process.exit(1); });
