// Servidor de prueba para las pruebas de navegador: base temporal y datos ficticios.
// NO inicia el bot de Discord ni llama a ElevenLabs.
process.env.DB_PATH = process.env.HARNESS_DB; // lo fija tests/browser/run.js
process.env.ADMIN_PASSWORD = "contrasena-de-prueba";
process.env.SESSION_SECRET = "secreto-de-prueba-del-harness";
process.env.COOKIE_SECURE = "0";
process.env.TIMEZONE = "America/Caracas";
delete process.env.ELEVENLABS_API_KEY;
delete process.env.DISCORD_TOKEN;
const path = require("path");
const root = path.resolve(__dirname, "..", "..");
const crypto = require("crypto");
const express = require(path.join(root, "node_modules/express"));
const db = require(path.join(root, "src/db"));
const shifts = require(path.join(root, "src/shifts"));

const H = 3600e3, M = 60e3, now = Date.now();
const ins = (sql, ...a) => db.prepare(sql).run(...a);

for (const [i, n] of ["Chatter A", "Chatter B", "Chatter C"].entries()) ins("INSERT INTO chatters (name, discord_id) VALUES (?, ?)", n, String(900000 + i));
const models = ["Amelia", "Ana", "Laura", "Sofia", "Triana"];
models.forEach((n, i) => ins("INSERT INTO models (name, voice_id, active) VALUES (?, ?, 1)", n, "VOICE" + i));

// uso de los últimos 20 días
for (let d = 19; d >= 0; d--) {
  for (let k = 0; k < 6; k++) {
    const m = 1 + ((d + k) % 5), c = 1 + (k % 3), len = 40 + ((d * 13 + k * 29) % 160), cached = (d + k) % 3 === 0 ? 1 : 0;
    const t = new Date(now - d * 86400e3 - k * H).toISOString().slice(0, 19).replace("T", " ");
    ins("INSERT INTO usage_log (chatter_id, model_id, char_count, from_cache, created_at) VALUES (?,?,?,?,?)", c, m, len, cached, t);
  }
}
for (let i = 1; i <= 5; i++) ins("INSERT INTO audio_cache (model_id,text_hash,text,file_path,char_count,hits) VALUES (?,?,?,?,?,?)", i, "h" + i, "Hola amor, ¿cómo estás? Qué lindo tenerte por acá " + i, "x", 60 + i * 5, 10 - i);

// horarios (Bogotá): Ana 08:00, Luis 14:00 (gracia 5), Marta 22:00
ins("INSERT INTO schedules VALUES ('111111111','Ana','08:00',10)");
ins("INSERT INTO schedules VALUES ('222222222','Luis','14:00',5)");
ins("INSERT INTO schedules VALUES ('333333333','Marta','22:00',10)");
const base = new Date(); const day0 = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()) + 5 * H; // 00:00 Bogotá (UTC-5) del día UTC actual
const at = (dayOff, hh, mm) => day0 + dayOff * 86400e3 + hh * H + mm * M;
function shift(id, name, start, brkStart, brkMin, endMin) {
  const s = ins("INSERT INTO shifts (discord_id,discord_name,started_at,ended_at) VALUES (?,?,?,?)", id, name, start, endMin == null ? null : start + endMin * M).lastInsertRowid;
  if (brkStart != null) ins("INSERT INTO shift_breaks (shift_id,started_at,ended_at) VALUES (?,?,?)", s, start + brkStart * M, brkMin == null ? null : start + (brkStart + brkMin) * M);
}
shift("111111111", "Ana", at(-2, 8, 3), 240, 28, 510);      // puntual, break ok
shift("111111111", "Ana", at(-1, 8, 27), 240, 41, 540);     // 27 min tarde, break +11
shift("222222222", "Luis", at(-1, 14, 2), 200, 30, 510);    // puntual
shift("222222222", "Luis", at(-3, 14, 19), 200, 52, 530);   // tarde, break +22
shift("333333333", "Marta", at(-1, 22, 8), 180, 25, 500);   // puntual (gracia 10)
shift("999999999", "Sin horario", at(-1, 9, 0), 200, 55, 520); // sin horario, break +25
shift("111111111", "Ana", at(0, 0, 0) + 8 * H + 35 * M, null);  // hoy, tarde, abierto (se corrige abajo)
db.prepare("DELETE FROM shifts WHERE id = (SELECT MAX(id) FROM shifts)").run();
// abiertos ahora: Ana trabajando desde hace 3h (tarde), Luis en break excedido
ins("INSERT INTO shifts (discord_id,discord_name,started_at) VALUES ('111111111','Ana',?)", now - 3 * H);
const sid = ins("INSERT INTO shifts (discord_id,discord_name,started_at) VALUES ('222222222','Luis',?)", now - 4 * H).lastInsertRowid;
ins("INSERT INTO shift_breaks (shift_id,started_at) VALUES (?,?)", sid, now - 38 * M);

try {
  db.prepare("UPDATE shifts SET template_name = ? WHERE discord_id = ?").run("Shift 2", "222222222");
  db.prepare("UPDATE shifts SET template_name = ? WHERE discord_id = ?").run("Shift 1", "111111111");
} catch (e) { console.error("seed turnos:", e.message); }
const app = express();
app.use(express.json());
app.use(express.static(path.join(root, "public")));
app.use("/vendor", express.static(path.join(root, "node_modules/chart.js/dist")));
app.use("/api/admin", require(path.join(root, "src/admin")));
app.use("/api", require(path.join(root, "src/routes")));
app.get("/admin", (q, r) => r.sendFile(path.join(root, "public/admin.html")));
// solo pruebas: inicia sesión sin pasar por el formulario
const users = require(path.join(root, "src/users"));
const auth = require(path.join(root, "src/auth"));
users.bootstrapFromEnv();
if (!users.getByUsername("laura")) {
  users.create({ username: "laura", displayName: "Laura Manager", password: "contrasena-de-laura", role: "manager" });
}
function sessionCookie(username) {
  const u = users.getByUsername(username);
  const exp = Date.now() + 3600e3;
  const payload = u.id + "." + exp;
  const secret = process.env.SESSION_SECRET;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return "essensa_sesion=" + payload + "." + sig;
}
app.get("/__loginchat", (q, r) => {
  r.setHeader("Set-Cookie", sessionCookie("admin") + "; Path=/");
  r.redirect("/index.html");
});
app.get("/__login", (q, r) => {
  r.setHeader("Set-Cookie", sessionCookie(q.query.u || "admin") + "; Path=/");
  r.redirect("/admin#" + (q.query.v || "resumen"));
});
app.listen(3999, () => console.log("harness listo"));
