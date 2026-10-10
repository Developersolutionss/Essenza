// Prueba de carga de los fichajes: mucha gente pulsando botones del panel de Discord
// a la vez (unos entran, otros salen, otros van al break) mientras varias personas
// tienen el panel web abierto y se refresca sin parar.
//
//   npm run test:load                 ~100 personas
//   npm run test:load -- 300          otra cantidad
//
// Corre en un solo proceso, como en producción, pero con una base de datos temporal:
// no toca tus datos, no conecta con Discord ni con ElevenLabs. Las interacciones de
// Discord son de mentira, con latencias y fallos de red aleatorios.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { monitorEventLoopDelay } = require("perf_hooks");

const PEOPLE = Math.max(20, Number(process.argv[2]) || 100);
const VIEWERS = 20;
const PORT = 3199;

// Entorno aislado. Se fija antes de cargar el servidor, y desde una carpeta temporal
// para que dotenv no lea el .env real (con el token del bot).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "essenza-carga-"));
const ADMIN_PASSWORD = crypto.randomBytes(12).toString("hex");
Object.assign(process.env, {
  DB_PATH: path.join(tmp, "carga.db"),
  PORT: String(PORT),
  HOST: "127.0.0.1",
  DISCORD_TOKEN: "",
  DISCORD_CLIENT_ID: "",
  ELEVENLABS_API_KEY: "",
  ADMIN_PASSWORD,
  TIMEZONE: "America/Caracas",
});
process.chdir(tmp);

const src = path.join(__dirname, "..", "..", "src");
const realLog = console.log;
console.log = () => {}; // el arranque del servidor no interesa aquí
require(path.join(src, "server.js"));
const db = require(path.join(src, "db.js"));
const shifts = require(path.join(src, "shifts.js"));
const { handleShiftButton } = require(path.join(src, "fichajes.js"));
const log = realLog;
// Los fallos de red simulados se cuentan, no se imprimen uno por uno.
let simulatedFailures = 0;
const realError = console.error;
console.error = (...a) => (String(a[1] ?? a[0]).includes("simulado") ? simulatedFailures++ : realError(...a));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// ---------------------------------------------------------------------------
// Interacción falsa de Discord. Registra cuándo se respondió y qué recibió la persona.
// ---------------------------------------------------------------------------
const interactions = [];
const panelProblems = [];

function checkPanel(payload) {
  for (const f of payload.embeds[0].data.fields) {
    if (f.value.length > 1024) panelProblems.push(`campo "${f.name}" con ${f.value.length} caracteres`);
  }
}

function fakeInteraction(person, action) {
  const roles = new Map(person.roles.map((r, i) => [String(i), { name: r }]));
  const it = {
    person: person.id,
    action,
    createdAt: Date.now(),
    ackAt: null,
    messages: [],
    customId: `shift:${action}`,
    user: { id: person.id, globalName: person.name, username: person.name.toLowerCase() },
    member: { displayName: person.nick, roles: { cache: roles } },
    replied: false,
    deferred: false,
    async update(payload) {
      it.ackAt = Date.now();
      checkPanel(payload);
      await sleep(rnd(30, 300));
      // De vez en cuando la edición del panel falla (red, límite de Discord...):
      // la persona tiene que recibir su respuesta igual.
      if (Math.random() < 0.05) throw new Error("fallo de red simulado");
      it.replied = true;
    },
    async followUp(msg) {
      await sleep(rnd(20, 150));
      it.messages.push(msg.content);
    },
    async reply(msg) {
      if (!it.ackAt) it.ackAt = Date.now();
      await sleep(rnd(20, 150));
      it.replied = true;
      it.messages.push(msg.content);
    },
  };
  interactions.push(it);
  return it;
}

async function press(person, action) {
  await handleShiftButton(fakeInteraction(person, action));
}

// ---------------------------------------------------------------------------
// Gente
// ---------------------------------------------------------------------------
const H = 3600 * 1000;
const groups = { salen: [], enTurno: [], entran: [], dobleClic: [], directivos: [] };
const people = [];
for (let i = 0; i < PEOPLE; i++) {
  const n = i % 3;
  const name = `Persona${String(i).padStart(3, "0")}`;
  let roles = [`⏰ Shift ${n + 1}`, "💬 𝗖𝗵𝗮𝘁𝘁𝗲𝗿"];
  let nick = `${name} - Shift ${n + 1} (Chatter)`;
  const kind = ["salen", "enTurno", "entran", "entran", "dobleClic"][i % 5];
  const p = { id: String(900000000000000000n + BigInt(i)), name, nick, roles, kind };
  if (i % 17 === 0) {
    p.roles = ["Team Leader"];
    p.nick = `${name} - Team Leader`;
    p.kind = "directivos";
  } else if (i % 13 === 0) {
    p.roles = [];
    p.nick = name; // sin rol ni apodo: el turno sale de la hora
  }
  groups[p.kind].push(p);
  people.push(p);
}

// Estado previo: quienes van a salir llevan 9 h en turno; los que están en turno, 2 h.
// Los directivos llevan 11 h, así que también pueden salir.
const now0 = Date.now();
for (const p of groups.salen) shifts.startShift(p.id, p.nick, now0 - 9 * H, { durationMin: 480, source: "rol", templateName: "Shift 1" });
for (const p of groups.enTurno) shifts.startShift(p.id, p.nick, now0 - 2 * H, { durationMin: 480, source: "rol", templateName: "Shift 2" });
for (const p of groups.directivos) shifts.startShift(p.id, p.nick, now0 - 11 * H, { durationMin: 600, source: "exento" });

// Guion de cada persona: acciones seguidas con pausas cortas, todas las personas a la vez.
function script(p) {
  switch (p.kind) {
    case "salen": return [["status"], ["break"], ["resume"], ["end"], ["status"]];
    case "enTurno": return [["status"], ["break"], ["resume"], ["break"], ["end"], ["status"]];
    case "entran": return [["start"], ["status"], ["start"], ["end"]];
    case "dobleClic": return [["start", "start", "start"], ["break", "break"], ["resume", "resume"], ["end", "end"]];
    case "directivos": return [["end"], ["start"], ["status"]];
  }
}

async function runPerson(p) {
  await sleep(rnd(0, 1500)); // no todos llegan en el mismo milisegundo
  for (const step of script(p)) {
    // Varias acciones en el mismo paso = doble (o triple) clic simultáneo.
    await Promise.all(step.map((a) => press(p, a)));
    await sleep(rnd(50, 600));
  }
}

// ---------------------------------------------------------------------------
// Panel web abierto por varias personas a la vez
// ---------------------------------------------------------------------------
const http = { ok: 0, bad: 0, times: [], errors: [] };
let stopViewers = false;

async function login() {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  return r.headers.get("set-cookie").split(";")[0];
}

async function viewer(cookie) {
  const urls = ["/api/admin/fichajes?range=7", "/api/admin/summary", "/api/admin/fichajes?range=30"];
  while (!stopViewers) {
    const u = urls[Math.floor(Math.random() * urls.length)];
    const t = Date.now();
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${u}`, { headers: { cookie } });
      await r.json();
      http.times.push(Date.now() - t);
      if (r.ok) http.ok++;
      else {
        http.bad++;
        http.errors.push(`${u} -> ${r.status}`);
      }
    } catch (e) {
      http.bad++;
      http.errors.push(`${u} -> ${e.message}`);
    }
    await sleep(rnd(200, 600));
  }
}

// ---------------------------------------------------------------------------
// Comprobaciones
// ---------------------------------------------------------------------------
let pass = 0;
const fails = [];
function check(cond, label) {
  if (cond) pass++;
  else fails.push(label);
  log(`${cond ? "  ok   " : "  FALLA"} ${label}`);
}

(async () => {
  await sleep(300); // a que el servidor escuche
  const cookie = await login();

  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const t0 = Date.now();

  const viewers = Array.from({ length: VIEWERS }, () => viewer(cookie));
  await Promise.all(people.map(runPerson));
  stopViewers = true;
  await Promise.all(viewers);
  lag.disable();
  const elapsed = Date.now() - t0;

  // La misma vista que tendría el panel web al terminar.
  const finalView = await (await fetch(`http://127.0.0.1:${PORT}/api/admin/fichajes?range=7`, { headers: { cookie } })).json();

  const acks = interactions.map((i) => (i.ackAt ?? Infinity) - i.createdAt);
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const openOf = (p) => q("SELECT * FROM shifts WHERE discord_id = ? AND ended_at IS NULL", p.id);
  const allOf = (p) => q("SELECT * FROM shifts WHERE discord_id = ?", p.id);

  log(`\n${PEOPLE} personas, ${interactions.length} pulsaciones, ${VIEWERS} paneles web abiertos, ${(elapsed / 1000).toFixed(1)} s\n`);

  log("Discord");
  check(acks.every((a) => a < 3000), `todas las pulsaciones se atienden antes de los 3 s que da Discord (peor: ${Math.max(...acks)} ms, p95: ${pct(acks, 95)} ms)`);
  check(
    interactions.every((i) => i.messages.length === 1 && i.messages[0]),
    `cada pulsación recibe exactamente una respuesta, también las ${simulatedFailures} en que falló la red`
  );
  check(!panelProblems.length, `el panel del canal nunca pasa del límite de Discord${panelProblems.length ? ": " + panelProblems[0] : ""}`);
  const maxLag = lag.max / 1e6;
  check(maxLag < 500, `el proceso nunca se bloquea más de 0,5 s (peor: ${maxLag.toFixed(0)} ms, p99: ${(lag.percentile(99) / 1e6).toFixed(0)} ms)`);

  log("\nDatos");
  const multiOpen = q("SELECT discord_id, COUNT(*) n FROM shifts WHERE ended_at IS NULL GROUP BY discord_id HAVING n > 1");
  check(!multiOpen.length, `nadie queda con dos turnos abiertos (${multiOpen.length} casos)`);
  const multiBreak = q("SELECT shift_id, COUNT(*) n FROM shift_breaks GROUP BY shift_id HAVING n > 1");
  check(!multiBreak.length, `ningún turno tiene más de un break, ni con doble clic (${multiBreak.length} casos)`);
  const openBreaks = q("SELECT COUNT(*) n FROM shift_breaks b JOIN shifts s ON s.id = b.shift_id WHERE b.ended_at IS NULL")[0].n;
  check(openBreaks === 0, `todos los breaks quedan cerrados (${openBreaks} abiertos)`);
  const badTimes = q("SELECT COUNT(*) n FROM shifts WHERE ended_at IS NOT NULL AND ended_at < started_at")[0].n;
  check(badTimes === 0, "ningún turno termina antes de empezar");

  check(groups.salen.every((p) => !openOf(p).length && allOf(p).length === 1), `los ${groups.salen.length} que cumplieron su turno salen`);
  check(groups.enTurno.every((p) => openOf(p).length === 1), `a los ${groups.enTurno.length} que llevan 2 h no se les deja salir antes`);
  const enTurnoMsgs = interactions.filter((i) => groups.enTurno.some((p) => p.id === i.person));
  check(
    enTurnoMsgs.filter((i) => i.action === "break").some((i) => /Ya usaste tu break/.test(i.messages[0])),
    "quien pide un segundo break recibe el aviso de que ya lo usó"
  );
  const entran = [...groups.entran, ...groups.dobleClic];
  check(entran.every((p) => allOf(p).length === 1), `los ${entran.length} que entran tienen un solo fichaje, aunque pulsen Start dos o tres veces a la vez`);
  check(
    groups.dobleClic.every((p) => {
      const msgs = interactions.filter((i) => i.person === p.id && i.action === "start").map((i) => i.messages[0]);
      return msgs.filter((m) => /Turno iniciado/.test(m)).length === 1 && msgs.filter((m) => /Ya tienes un turno abierto/.test(m)).length === msgs.length - 1;
    }),
    "en un doble clic, uno inicia el turno y los demás reciben 'Ya tienes un turno abierto'"
  );
  check(groups.directivos.every((p) => allOf(p).length === 2 && openOf(p).length === 1), `los ${groups.directivos.length} directivos cierran su jornada de 10 h y empiezan otra`);

  log("\nPanel web");
  const httpTotal = http.ok + http.bad;
  check(http.bad === 0, `${httpTotal} consultas al panel sin errores${http.errors.length ? ": " + http.errors.slice(0, 3).join(", ") : ""}`);
  check(pct(http.times, 95) < 1000, `el panel responde rápido mientras todos fichan (p95: ${pct(http.times, 95)} ms, peor: ${Math.max(...http.times)} ms)`);
  const openDb = q("SELECT COUNT(*) n FROM shifts WHERE ended_at IS NULL")[0].n;
  check(finalView.open.length === openDb, `el panel muestra a las ${openDb} personas que siguen en turno`);
  const totalDb = q("SELECT COUNT(*) n FROM shifts")[0].n;
  check(finalView.kpis.shifts === totalDb, `el historial del panel cuenta los ${totalDb} fichajes`);

  log(`\n${pass}/${pass + fails.length} comprobaciones de carga pasan`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(fails.length ? 1 : 0), 100);
})().catch((e) => {
  log("ERROR", e);
  process.exit(1);
});
