// Esta prueba se ejecuta con `npm test` (ver tests/run.js).
// Prueba profunda del bot de Discord. Todo entra por onInteraction, el mismo punto por
// el que llegan las pulsaciones y los comandos reales, con un reloj simulado.
//
//   1. Barrido: cada turno y cada forma de detectarlo, Start cada 5 min durante 48 h,
//      comparado con un cálculo de referencia que no usa el código del bot.
//   2. Horas extra caso a caso: break, exceso, End antes de tiempo, medianoche.
//   3. Cinco días simulados con 40 personas: cada respuesta, cada fila de la base y
//      los números del panel se comparan con un modelo de referencia.
//   4. Comandos: /voz, /frase, /uso, /vincular, /panel-fichajes y autocompletado.
//
// Base temporal, proveedor de voz falso, sin Discord ni ElevenLabs.
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = path.resolve(__dirname, "..", "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "essenza-profundo-"));
process.env.DB_PATH = path.join(tmp, "t.db");
process.env.TIMEZONE = "America/Caracas";
process.env.ADMIN_PASSWORD = "contrasena-inicial-larga";
process.env.SESSION_SECRET = "secreto-de-prueba";
process.env.COOKIE_SECURE = "0";
process.env.MAX_TEXT_CHARS = "200";
for (const k of ["SHIFT_HOURS", "BREAK_MINUTES", "EXEMPT_ROLES", "EXEMPT_HOURS", "BLOCKED_ROLES", "LATE_GRACE_MINUTES", "EARLY_MAX_HOURS", "ELEVENLABS_API_KEY", "DISCORD_TOKEN"]) {
  delete process.env[k];
}

// Reloj simulado: todo el código del bot pide la hora con Date.now().
const realNow = Date.now.bind(Date);
let CLOCK = realNow();
Date.now = () => CLOCK;

// Almacén de audio y proveedor de voz falsos (como en generador.test.js).
const audioStorePath = require.resolve(path.join(ROOT, "src/audioStore.js"));
const realStore = require(audioStorePath);
const fakeDir = path.join(tmp, "audio");
fs.mkdirSync(fakeDir, { recursive: true });
require.cache[audioStorePath].exports = {
  hashText: realStore.hashText,
  save(modelId, hash, buf) {
    const p = path.join(fakeDir, `${modelId}_${hash}.mp3`);
    fs.writeFileSync(p, buf);
    return p;
  },
  read: (p) => fs.readFileSync(p),
  audioDir: fakeDir,
};
const providersPath = require.resolve(path.join(ROOT, "src/providers/index.js"));
const prov = { calls: 0, fail: false };
require.cache[providersPath] = {
  id: providersPath,
  filename: providersPath,
  loaded: true,
  exports: {
    getProvider: () => ({
      async generate({ text }) {
        prov.calls++;
        if (prov.fail) throw new Error("fallo simulado del proveedor");
        return Buffer.from("MP3:" + text);
      },
    }),
  },
};

const express = require(path.join(ROOT, "node_modules/express"));
const { PermissionFlagsBits: P, PermissionsBitField, MessageFlags } = require(path.join(ROOT, "node_modules/discord.js"));
const db = require(path.join(ROOT, "src/db"));
const plans = require(path.join(ROOT, "src/shiftPlan"));
const users = require(path.join(ROOT, "src/users"));
const { getUsedToday } = require(path.join(ROOT, "src/generator"));
const { onInteraction, commands } = require(path.join(ROOT, "src/discord"));
users.bootstrapFromEnv();

let unhandled = 0;
process.on("unhandledRejection", () => unhandled++);
const realConsoleError = console.error;
console.error = () => {}; // los errores provocados a propósito no ensucian la salida

const out = [];
const ok = (n, c, e = "") => out.push(`${c ? "PASA " : "FALLA"}  ${n}${e ? "  -> " + e : ""}`);
const section = (t) => out.push(`\n== ${t}`);

// ---------------------------------------------------------------------------
// Tiempo: minutos desde la medianoche (hora de Venezuela, UTC-4 fijo, sin horario de
// verano) del lunes 12 de octubre de 2026. La referencia no usa el código del bot.
// ---------------------------------------------------------------------------
const BASE = Date.UTC(2026, 9, 12, 4, 0);
const msAt = (min) => BASE + min * 60000;
const T = (day, hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return day * 1440 + h * 60 + m;
};
const hhmm = (min) => {
  const d = Math.floor(min / 1440);
  const r = ((min % 1440) + 1440) % 1440;
  return `día ${d} ${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`;
};

const TPL = plans.listTemplates().map((t) => {
  const [h, m] = t.startTime.split(":").map(Number);
  return { name: t.name, S: h * 60 + m, D: t.durationMin, grace: t.graceMin };
});
const byName = Object.fromEntries(TPL.map((t) => [t.name, t]));
const BREAK = 30;
const EXEMPT_MIN = 600;

// Última entrada del turno que no esté más de 4 h en el futuro.
function occFor(t, Tm) {
  let best = -Infinity;
  const day = Math.floor(Tm / 1440);
  for (let k = day - 2; k <= day + 2; k++) {
    const o = k * 1440 + t.S;
    if (o - Tm <= 240 && o > best) best = o;
  }
  return best;
}

// Qué debería pasar al pulsar Start en el minuto Tm, según cómo se detecta el turno.
function refPlan(kind, shiftName, Tm) {
  if (kind === "dir") return { source: "exento", isExtra: false, required: EXEMPT_MIN, expected: null, late: false, lateMin: 0 };
  if (kind === "rol" || kind === "apodo") {
    const t = byName[shiftName];
    const occ = occFor(t, Tm);
    if (Tm > occ + t.D) return { source: kind, isExtra: true, required: 0, expected: null, late: false, lateMin: 0, name: t.name, endedAt: occ + t.D };
    const lateMin = Math.max(0, Tm - occ);
    return { source: kind, isExtra: false, required: t.D, expected: occ, late: lateMin > t.grace, lateMin, name: t.name };
  }
  // "hora": el turno cuya entrada queda más cerca; empate -> el primero por hora de entrada.
  const c = TPL.map((t) => ({ t, occ: occFor(t, Tm) }));
  const best = [...c].sort((a, b) => Math.abs(Tm - a.occ) - Math.abs(Tm - b.occ))[0];
  const lateMin = Math.max(0, Tm - best.occ);
  return { source: "hora", isExtra: false, required: best.t.D, expected: best.occ, late: lateMin > best.t.grace, lateMin, name: best.t.name };
}

// ---------------------------------------------------------------------------
// Interacciones falsas de Discord
// ---------------------------------------------------------------------------
const rolesCache = (names) => new Map(names.map((n, i) => [String(i), { name: n }]));

function person(id, { kind = "rol", shift = "Shift 1", name } = {}) {
  name = name || `P${id}`;
  let roles = ["💬 𝗖𝗵𝗮𝘁𝘁𝗲𝗿"];
  let nick = `${name} - (Chatter)`;
  if (kind === "rol") roles = [`⏰ ${shift}`, ...roles];
  if (kind === "apodo") nick = `${name} - ${shift} (Chatter)`;
  if (kind === "dir") {
    roles = ["Team Leader"];
    nick = `${name} - Team Leader`;
  }
  return { id: `p${id}`, name, kind, shift, roles, nick };
}

async function press(p, action) {
  const it = {
    customId: `shift:${action}`,
    user: { id: p.id, globalName: p.name, username: p.name.toLowerCase() },
    member: p.noMember ? null : { displayName: p.nick, roles: { cache: rolesCache(p.roles) } },
    replied: false,
    deferred: false,
    sent: [],
    panel: null,
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    async update(payload) {
      it.panel = payload;
      it.replied = true;
    },
    async followUp(m) {
      it.sent.push(m);
    },
    async reply(m) {
      it.replied = true;
      it.sent.push(m);
    },
  };
  await onInteraction(it);
  return it;
}
const textOf = (it) => it.sent[0]?.content || "";

function command(name, { userId = "u-cmd", perms = [], roles = [], options = {}, inGuild = true, pinFails = false } = {}) {
  const it = {
    commandName: name,
    user: { id: userId, username: userId },
    memberPermissions: new PermissionsBitField(perms),
    member: { roles: { cache: rolesCache(roles) } },
    replies: [],
    edits: [],
    followUps: [],
    deferredWith: null,
    pinned: false,
    inGuild: () => inGuild,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    isButton: () => false,
    options: {
      getString: (n) => (options[n] === undefined ? null : options[n]),
      getUser: (n) => options[n] || null,
    },
    async reply(m) {
      it.replies.push(m);
    },
    async deferReply(m) {
      it.deferredWith = m;
    },
    async editReply(m) {
      it.edits.push(m);
    },
    async followUp(m) {
      it.followUps.push(m);
    },
    async fetchReply() {
      return {
        pin: async () => {
          if (pinFails) throw new Error("Missing Permissions");
          it.pinned = true;
        },
      };
    },
  };
  return it;
}

async function autocomplete(name, value) {
  let got = null;
  await onInteraction({
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    isButton: () => false,
    options: { getFocused: () => ({ name, value }) },
    respond: async (list) => {
      got = list;
    },
  });
  return got;
}

const clearShifts = () => {
  db.prepare("DELETE FROM shift_breaks").run();
  db.prepare("DELETE FROM shifts").run();
};

// ---------------------------------------------------------------------------
// Panel web (API) con el mismo reloj simulado
// ---------------------------------------------------------------------------
let api;
async function startApi() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", require(path.join(ROOT, "src/admin")));
  const server = app.listen(0, "127.0.0.1");
  // La simulación ocupa el proceso varios segundos seguidos: con el tiempo de espera
  // normal (5 s) el servidor cierra la conexión reutilizada y fetch da ECONNRESET.
  server.keepAliveTimeout = 10 * 60000;
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // La sesión dura 12 h y el reloj simulado salta días: se entra de nuevo en cada consulta.
  const login = async () => {
    const r = await fetch(base + "/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "contrasena-inicial-larga" }),
    });
    return (r.headers.getSetCookie?.()[0] || r.headers.get("set-cookie")).split(";")[0];
  };
  api = {
    server,
    get: async (p) => (await fetch(base + p, { headers: { Cookie: await login() } })).json(),
  };
}

(async () => {
  // =========================================================================
  section("1. Barrido de horas de Start (cada 5 min durante 48 h)");
  // =========================================================================
  {
    let cases = 0;
    const bad = [];
    const kinds = [
      ...TPL.map((t) => ["rol", t.name]),
      ...TPL.map((t) => ["apodo", t.name]),
      ["hora", null],
      ["dir", null],
    ];
    for (const [kind, shift] of kinds) {
      const p = person(`sw-${kind}`, { kind, shift: shift || "Shift 1" });
      for (let Tm = T(1, "00:00"); Tm < T(3, "00:00"); Tm += 5) {
        clearShifts();
        CLOCK = msAt(Tm);
        const it = await press(p, "start");
        const msg = textOf(it);
        const row = db.prepare("SELECT * FROM shifts WHERE discord_id = ?").get(p.id);
        const r = refPlan(kind, shift, Tm);
        cases++;
        const problems = [];
        if (!/Turno iniciado/.test(msg)) problems.push("no inició");
        if (!row) {
          problems.push("sin fila");
        } else {
          if (Boolean(row.is_extra) !== r.isExtra) problems.push(`extra=${row.is_extra} (esperado ${r.isExtra})`);
          if (row.required_minutes !== r.required) problems.push(`exige ${row.required_minutes} min (esperado ${r.required})`);
          if ((row.expected_at ?? null) !== (r.expected == null ? null : msAt(r.expected))) problems.push(`entrada esperada ${row.expected_at ? hhmm((row.expected_at - BASE) / 60000) : "ninguna"} (esperada ${r.expected == null ? "ninguna" : hhmm(r.expected)})`);
          if (row.plan_source !== r.source) problems.push(`fuente ${row.plan_source} (esperada ${r.source})`);
          if (r.name && kind === "hora" && row.template_name !== r.name) problems.push(`turno ${row.template_name} (esperado ${r.name})`);
        }
        if (/horas extra/.test(msg) !== r.isExtra) problems.push("el mensaje no coincide con horas extra");
        if (/tarde\./.test(msg) !== r.late) problems.push(`mensaje de tardanza ${/tarde\./.test(msg)} (esperado ${r.late}, ${r.lateMin} min)`);
        if (!it.sent[0] || it.sent[0].flags !== MessageFlags.Ephemeral) problems.push("respuesta no efímera");
        if (problems.length) bad.push(`${kind} ${shift || ""} ${hhmm(Tm)}: ${problems.join(", ")}`);
      }
    }
    ok(`${cases} Start en todas las horas coinciden con la referencia (turno, extra, duración, entrada, tardanza)`, !bad.length, bad.slice(0, 4).join(" | "));
  }

  // Fronteras escritas a mano: la regla tal como la entiende la agencia.
  {
    const cases = [
      ["Shift 1", "05:30", "a tiempo"], ["Shift 1", "05:40", "a tiempo"], ["Shift 1", "05:41", "tarde"],
      ["Shift 1", "12:59", "tarde"], ["Shift 1", "13:00", "tarde"], ["Shift 1", "13:01", "extra"],
      ["Shift 1", "20:00", "extra"], ["Shift 1", "01:29", "extra"], ["Shift 1", "01:30", "a tiempo"],
      ["Shift 2", "13:00", "a tiempo"], ["Shift 2", "13:11", "tarde"], ["Shift 2", "21:15", "tarde"],
      ["Shift 2", "21:16", "extra"], ["Shift 2", "03:00", "extra"], ["Shift 2", "08:59", "extra"], ["Shift 2", "09:00", "a tiempo"],
      ["Shift 3", "21:15", "a tiempo"], ["Shift 3", "23:59", "tarde"], ["Shift 3", "00:30", "tarde"],
      ["Shift 3", "05:15", "tarde"], ["Shift 3", "05:16", "extra"], ["Shift 3", "12:00", "extra"],
      ["Shift 3", "17:14", "extra"], ["Shift 3", "17:15", "a tiempo"],
    ];
    const bad = [];
    for (const [shift, at, want] of cases) {
      clearShifts();
      CLOCK = msAt(T(1, at));
      const msg = textOf(await press(person("f", { shift }), "start"));
      const got = /horas extra/.test(msg) ? "extra" : /tarde\./.test(msg) ? "tarde" : "a tiempo";
      if (got !== want) bad.push(`${shift} ${at}: ${got} (esperado ${want})`);
    }
    ok(`${cases.length} fronteras de cada turno (gracia de 10 min, fin del turno, 4 h antes)`, !bad.length, bad.join(" | "));
    clearShifts();
    CLOCK = msAt(T(1, "00:30"));
    const s3 = textOf(await press(person("mn", { shift: "Shift 3" }), "start"));
    ok("Shift 3 a las 00:30 llegó 3 h 15 min tarde (cruza la medianoche)", /Llegaste \*\*3 h 15 min\*\* tarde/.test(s3), s3.split("\n").pop());
    clearShifts();
    CLOCK = msAt(T(1, "14:00"));
    const both = await press({ ...person("rd", { kind: "rol", shift: "Shift 2" }), roles: ["Shift 2", "Team Leader"] }, "start");
    ok("con rol Shift 2 y Team Leader manda el turno (se mide)", /Shift 2/.test(textOf(both)) && /tarde/.test(textOf(both)));
    clearShifts();
    const rolNick = await press({ ...person("rn", { kind: "rol", shift: "Shift 1" }), nick: "X - Shift 2" }, "start");
    ok("con rol Shift 1 y apodo Shift 2 manda el rol (a las 14:00 es hora extra del Shift 1)", /Shift 1/.test(textOf(rolNick)) && /horas extra/.test(textOf(rolNick)));
  }

  // =========================================================================
  section("2. Horas extra caso a caso");
  // =========================================================================
  await startApi();
  clearShifts();
  {
    const at = (day, h) => (CLOCK = msAt(T(day, h)));
    const ana = person("ana", { shift: "Shift 1", name: "Ana" });
    at(0, "14:00");
    let m = textOf(await press(ana, "start"));
    ok("Ana (Shift 1) ficha a las 14:00: horas extra, dice que su turno terminó", /horas extra/.test(m) && /Shift 1/.test(m) && /terminó/.test(m) && /End\*\* cuando termines/.test(m), m.slice(0, 140));
    at(0, "14:30");
    m = textOf(await press(ana, "status"));
    ok("Mi estado: 'Llevas 30 min de horas extra'", /Llevas \*\*30 min\*\* de horas extra/.test(m), m.split("\n")[1]);
    at(0, "14:31");
    ok("Break en horas extra se permite", /Break iniciado/.test(textOf(await press(ana, "break"))));
    at(0, "15:11");
    m = textOf(await press(ana, "resume"));
    ok("vuelve tras 40 min: 10 min de exceso", /\*\*10 min\*\* de exceso/.test(m), m);
    at(0, "15:12");
    ok("un segundo break en horas extra se niega", /Ya usaste tu break/.test(textOf(await press(ana, "break"))));
    at(0, "15:20");
    m = textOf(await press(ana, "end"));
    // 14:00 a 15:20 = 80 min, menos 10 de exceso = 70 min
    ok("End sin mínimo: 'Horas extra terminadas', 1 h 10 min (80 - 10 de exceso)", /Horas extra terminadas/.test(m) && /\*\*1 h 10 min\*\*/.test(m) && /exceso 10 min/.test(m), m);
    at(0, "16:00");
    await press(ana, "start");
    m = textOf(await press(ana, "end"));
    ok("segundas horas extra del día, terminadas al instante: se registran con 0 min", /Horas extra terminadas/.test(m) && /\*\*0 min\*\*/.test(m), m);

    const luis = person("luis", { shift: "Shift 1", name: "Luis" });
    at(1, "05:45");
    m = textOf(await press(luis, "start"));
    ok("Luis (Shift 1) entra a las 05:45: 15 min tarde, 7 h 30 min", /\*\*15 min\*\* tarde/.test(m) && /7 h 30 min/.test(m));
    at(1, "09:00");
    await press(luis, "break");
    at(1, "09:30");
    m = textOf(await press(luis, "resume"));
    ok("break de 30 min justos: sin exceso", /De vuelta/.test(m), m);
    at(1, "13:14");
    m = textOf(await press(luis, "end"));
    ok("End a las 13:14 se niega: le falta 1 min (el break cuenta)", /Aún no puedes terminar/.test(m) && /\*\*1 min\*\*/.test(m), m);
    at(1, "13:15");
    m = textOf(await press(luis, "end"));
    ok("End a las 13:15 (7 h 30 desde que entró): turno terminado, no extra", /Turno terminado/.test(m) && !/extra/.test(m), m);
    at(1, "13:20");
    m = textOf(await press(luis, "start"));
    ok("Luis vuelve a fichar a las 13:20: horas extra", /horas extra/.test(m));
    at(1, "14:20");
    await press(luis, "end");

    const eva = person("eva", { shift: "Shift 3", name: "Eva" });
    at(1, "21:10");
    m = textOf(await press(eva, "start"));
    ok("Eva (Shift 3) entra 21:10, 5 min antes: a tiempo", /Llegaste a tiempo/.test(m));
    at(2, "05:10");
    m = textOf(await press(eva, "end"));
    ok("Eva sale a las 05:10 del día siguiente tras 8 h", /Turno terminado/.test(m) && /\*\*8 h\*\*/.test(m), m);
    at(2, "05:20");
    m = textOf(await press(eva, "start"));
    ok("Eva vuelve a las 05:20: horas extra (su turno acabó a las 05:15)", /horas extra/.test(m));
    at(2, "21:15");
    m = textOf(await press(eva, "start"));
    ok("si no cierra las horas extra, al llegar su turno le dice que ya tiene uno abierto", /Ya tienes un turno abierto/.test(m));
    m = textOf(await press(eva, "end"));
    ok("al cerrarlas se cuentan las 15 h 55 min como horas extra", /Horas extra terminadas/.test(m) && /15 h 55 min/.test(m), m);
    m = textOf(await press(eva, "start"));
    ok("y entonces su Shift 3 empieza normal, a tiempo", /Llegaste a tiempo/.test(m) && !/horas extra/.test(m), m.split("\n").pop());

    const leo = person("leo", { kind: "apodo", shift: "Shift 2", name: "Leo" });
    at(3, "13:00");
    await press(leo, "start");
    at(3, "15:00");
    await press(leo, "break");
    at(3, "16:00");
    m = textOf(await press(leo, "resume"));
    ok("Leo (Shift 2 por apodo) se pasa 30 min de break", /\*\*30 min\*\* de exceso/.test(m), m);
    at(3, "21:15");
    m = textOf(await press(leo, "end"));
    ok("a la hora de salida no puede irse: tiene que recuperar los 30 min", /Aún no puedes terminar/.test(m) && /\*\*30 min\*\*/.test(m), m);
    at(3, "21:45");
    m = textOf(await press(leo, "end"));
    ok("a las 21:45 sí; trabajado 8 h 15 min y no es hora extra", /Turno terminado/.test(m) && /\*\*8 h 15 min\*\*/.test(m), m);

    const mia = person("mia", { shift: "Shift 2", name: "Mia" });
    at(3, "22:00");
    await press(mia, "start");
    at(3, "22:30");
    await press(mia, "break");
    m = textOf(await press(mia, "end"));
    ok("horas extra: End durante el break se niega", /Estás en break/.test(m));
    await press(mia, "resume");
    m = textOf(await press(mia, "end"));
    ok("tras Resume sí puede terminar", /Horas extra terminadas/.test(m));

    // Ya cumplió su turno y vuelve a fichar dentro de la misma ventana.
    const sol = person("sol", { shift: "Shift 1", name: "Sol" });
    at(4, "04:00");
    m = textOf(await press(sol, "start"));
    ok("Sol (Shift 1) llega a las 04:00, 1 h 30 min antes: a tiempo", /Llegaste a tiempo/.test(m));
    at(4, "11:30");
    ok("cumple 7 h 30 min y sale a las 11:30", /Turno terminado/.test(textOf(await press(sol, "end"))));
    at(4, "12:00");
    m = textOf(await press(sol, "start"));
    ok("vuelve a las 12:00, aún dentro de su Shift 1: son horas extra, no otro turno tarde",
      /Ya cumpliste tu \*\*Shift 1\*\*/.test(m) && /horas extra/.test(m) && !/tarde/.test(m), m.split("\n")[1]);
    at(4, "12:20");
    ok("y puede terminar cuando quiera", /Horas extra terminadas/.test(textOf(await press(sol, "end"))));

    const noRol = person("nr", { kind: "hora", name: "Nico" });
    at(4, "13:00");
    await press(noRol, "start");
    at(4, "21:15");
    await press(noRol, "end");
    at(4, "21:30");
    m = textOf(await press(noRol, "start"));
    // Límite conocido: sin rol ni apodo, a las 21:30 la entrada más cercana es la del Shift 3.
    ok("sin rol, quien se queda tras su Shift 2 y ficha a las 21:30 se lee como Shift 3 (límite del método por hora)",
      /Shift 3/.test(m) && /deducido por tu hora/.test(m) && !/horas extra/.test(m), m.split("\n").pop());
    await press(noRol, "end");

    db.prepare("INSERT INTO schedules (discord_id, display_name, start_time, grace_minutes) VALUES ('ppers', 'Pía', '08:00', 10)").run();
    const pers = person("pers", { kind: "hora", name: "Pía" });
    at(4, "08:00");
    await press(pers, "start");
    at(4, "16:00");
    await press(pers, "end");
    at(4, "16:30");
    m = textOf(await press(pers, "start"));
    ok("con horario personal también (sin nombre de turno en el mensaje)", /Ya cumpliste tu turno/.test(m) && /horas extra/.test(m), m.split("\n")[1]);
    await press(pers, "end");

    // Un turno cerrado antes de tiempo desde el panel no cuenta como cumplido.
    const tom = person("tom", { shift: "Shift 2", name: "Tom" });
    at(4, "13:00");
    await press(tom, "start");
    at(4, "14:00");
    db.prepare("UPDATE shifts SET ended_at = ? WHERE discord_id = 'ptom' AND ended_at IS NULL").run(CLOCK);
    at(4, "14:05");
    m = textOf(await press(tom, "start"));
    ok("si un manager le cerró el turno a la hora, al volver sigue en su Shift 2 (no es extra)", !/horas extra/.test(m) && /Shift 2/.test(m), m.split("\n").pop());
    db.prepare("DELETE FROM shift_breaks WHERE shift_id IN (SELECT id FROM shifts WHERE discord_id = 'ptom')").run();
    db.prepare("DELETE FROM shifts WHERE discord_id = 'ptom'").run();

    const dm = { ...person("dm", { shift: "Shift 1", name: "Sin Miembro" }), noMember: true };
    at(4, "06:00");
    m = textOf(await press(dm, "start"));
    ok("sin datos de miembro (sin roles ni apodo) el botón responde igual", /Turno iniciado/.test(m));
    await press(dm, "end");

    // Lo que ve el panel web de todo esto.
    at(5, "12:00");
    const f = await api.get("/api/admin/fichajes?range=7");
    const k = f.kpis;
    const extraRows = db.prepare("SELECT * FROM shifts WHERE is_extra = 1").all();
    ok(`el panel cuenta las ${extraRows.length} horas extra`, k.extraCount === extraRows.length, `${k.extraCount}`);
    const anaRow = f.people.find((x) => x.discordId === "pana");
    ok("Ana: 2 fichajes de horas extra, 1 h 10 min en total", anaRow.extraCount === 2 && Math.round(anaRow.extraMs / 60000) === 70, `${anaRow.extraCount}, ${Math.round(anaRow.extraMs / 60000)} min`);
    const evaRow = f.people.find((x) => x.discordId === "peva");
    ok("Eva: horas extra 15 h 55 min (la que dejó abierta)", Math.round(evaRow.extraMs / 60000) === 15 * 60 + 55, `${Math.round(evaRow.extraMs / 60000)} min`);
    ok("las horas extra nunca salen como llegadas tarde", !f.late.some((s) => s.isExtra));
    ok("Luis sale como llegada tarde de 15 min", f.late.some((s) => s.discordId === "pluis" && Math.round(s.lateMs / 60000) === 15));
    ok("los excesos de break incluyen el de Ana (horas extra) y el de Leo", f.overruns.some((s) => s.discordId === "pana") && f.overruns.some((s) => s.discordId === "pleo"));
  }

  // =========================================================================
  section("3. Cinco días con 40 personas, comparados con un modelo de referencia");
  // =========================================================================
  clearShifts();
  {
    // Aleatorio pero repetible: la misma semilla da siempre el mismo recorrido.
    let seed = 20261012;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const chance = (p) => rand() < p;

    const people = [];
    for (let i = 0; i < 40; i++) {
      const kind = i < 28 ? "rol" : i < 33 ? "apodo" : i < 36 ? "dir" : "hora";
      people.push(person(`sim${i}`, { kind, shift: TPL[i % 3].name, name: `Sim${i}` }));
    }

    // Modelo de referencia: las reglas escritas de nuevo, sin el código del bot.
    const ref = new Map(people.map((p) => [p.id, { open: null, done: [] }]));
    const workedOf = (s, now) => {
      let br = 0;
      for (const b of s.breaks) br += (b.e ?? now) - b.s;
      return Math.max(0, (s.end ?? now) - s.start - Math.max(0, br - BREAK));
    };
    const breakOf = (s, now) => s.breaks.reduce((a, b) => a + ((b.e ?? now) - b.s), 0);
    const onBreak = (s) => s.breaks.some((b) => b.e == null);

    function expect(p, action, Tm) {
      const st = ref.get(p.id);
      const o = st.open;
      switch (action) {
        case "start": {
          if (o) return "ya-abierto";
          let plan = refPlan(p.kind, p.shift, Tm);
          // Ya cumplió ese mismo turno: vuelve a fichar = horas extra.
          if (!plan.isExtra && plan.expected != null && st.done.some((d) => !d.isExtra && d.expected === plan.expected)) {
            plan = { ...plan, isExtra: true, required: 0, expected: null, late: false };
          }
          st.open = { ...plan, start: Tm, end: null, breaks: [] };
          return plan.isExtra ? "inicio-extra" : plan.late ? "inicio-tarde" : "inicio";
        }
        case "break":
          if (!o) return "sin-turno";
          if (onBreak(o)) return "ya-en-break";
          if (o.breaks.length) return "break-usado";
          o.breaks.push({ s: Tm, e: null });
          return "break";
        case "resume":
          if (!o) return "sin-turno";
          if (!onBreak(o)) return "no-en-break";
          o.breaks.find((b) => b.e == null).e = Tm;
          return breakOf(o, Tm) > BREAK ? "vuelta-exceso" : "vuelta";
        case "end":
          if (!o) return "sin-turno";
          if (onBreak(o)) return "en-break";
          if (workedOf(o, Tm) < o.required) return "temprano";
          o.end = Tm;
          st.done.push(o);
          st.open = null;
          return o.isExtra ? "fin-extra" : "fin";
        case "status":
          if (!o) return "estado-sin-turno";
          return o.isExtra ? "estado-extra" : workedOf(o, Tm) >= o.required && !onBreak(o) ? "estado-puede-salir" : "estado";
      }
    }

    function category(action, msg) {
      const rules = {
        start: [[/Ya tienes un turno abierto/, "ya-abierto"], [/horas extra/, "inicio-extra"], [/tarde\./, "inicio-tarde"], [/Turno iniciado/, "inicio"]],
        break: [[/No tienes un turno abierto/, "sin-turno"], [/Ya estás en break/, "ya-en-break"], [/Ya usaste tu break/, "break-usado"], [/Break iniciado/, "break"]],
        resume: [[/No tienes un turno abierto/, "sin-turno"], [/No estás en break/, "no-en-break"], [/de exceso/, "vuelta-exceso"], [/De vuelta/, "vuelta"]],
        end: [[/No tienes un turno abierto/, "sin-turno"], [/Estás en break/, "en-break"], [/Aún no puedes terminar/, "temprano"], [/Horas extra terminadas/, "fin-extra"], [/Turno terminado/, "fin"]],
        status: [[/No tienes un turno abierto/, "estado-sin-turno"], [/horas extra/, "estado-extra"], [/Ya puedes pulsar/, "estado-puede-salir"], [/Trabajado:/, "estado"]],
      };
      for (const [re, c] of rules[action]) if (re.test(msg)) return c;
      return "desconocido: " + msg.slice(0, 60);
    }

    // Agenda de eventos; algunos generan otros (reintentar End, olvidar cerrar...).
    const queue = [];
    const add = (Tm, p, action, extra = {}) => queue.push({ Tm, p, action, seq: queue.length + Math.random(), ...extra });

    const DAYS = 5;
    for (const p of people) {
      for (let d = 0; d < DAYS; d++) {
        if (!chance(0.85)) continue; // día libre o falta
        const t = byName[p.shift];
        const entry = p.kind === "dir" ? T(d, "09:00") : d * 1440 + t.S;
        const r = rand();
        const offset = r < 0.15 ? -ri(1, 90) : r < 0.65 ? ri(0, 10) : ri(11, 200);
        const start = entry + offset;
        add(start, p, "start", { plannedLen: p.kind === "dir" ? EXEMPT_MIN : t.D, day: d });
        if (chance(0.1)) add(start, p, "start", { dup: true }); // doble clic
        if (chance(0.3)) add(start + ri(30, 200), p, "status");
        if (chance(0.3)) add(start + ri(60, 300), p, "end"); // intenta irse antes
        if (chance(0.6)) {
          const b = start + ri(60, 300);
          add(b, p, "break");
          add(b + ri(10, 55), p, "resume");
          if (chance(0.1)) add(b + ri(60, 120), p, "break"); // segundo break
        }
      }
    }

    const mismatches = [];
    const debugLog = [];
    let events = 0;
    let panelChecks = 0;
    const panelBad = [];
    while (queue.length) {
      queue.sort((a, b) => a.Tm - b.Tm || a.seq - b.seq);
      const ev = queue.shift();
      CLOCK = msAt(ev.Tm);
      const want = expect(ev.p, ev.action, ev.Tm);
      const it = await press(ev.p, ev.action);
      const got = category(ev.action, textOf(it));
      events++;
      if (process.env.DEBUG_SIM) debugLog.push(`${ev.p.name} ${ev.action} ${want}`);
      if (got !== want) mismatches.push(`${ev.p.name} ${ev.action} ${hhmm(ev.Tm)}: bot "${got}", esperado "${want}"`);

      // El panel del canal se redibuja en cada pulsación: sus contadores deben cuadrar.
      if (it.panel) {
        panelChecks++;
        const opens = [...ref.values()].map((s) => s.open).filter(Boolean);
        const working = opens.filter((o) => !onBreak(o)).length;
        const brk = opens.length - working;
        const fields = it.panel.embeds[0].data.fields;
        if (fields[0].name !== `En turno (${working})` || fields[1].name !== `En break (${brk})`) {
          panelBad.push(`${hhmm(ev.Tm)}: ${fields[0].name} / ${fields[1].name}, esperado ${working} / ${brk}`);
        }
      }

      // Lo que hace cada persona según la respuesta. Cada persona tiene como mucho una
      // "intención de salir" viva (token): las de turnos anteriores se descartan.
      if (ev.action === "start" && !ev.dup) {
        if (want === "ya-abierto") {
          // Se le olvidó cerrar el anterior: lo cierra y vuelve a fichar.
          ev.p.token = (ev.p.token || 0) + 1;
          add(ev.Tm, ev.p, "resume");
          add(ev.Tm, ev.p, "end", { final: true, token: ev.p.token });
          add(ev.Tm + 1, ev.p, "start", { plannedLen: ev.plannedLen });
        } else {
          ev.p.token = (ev.p.token || 0) + 1;
          const isExtra = want === "inicio-extra";
          const len = isExtra ? ri(15, 180) : ev.plannedLen || byName[ev.p.shift].D;
          if (isExtra && len > 60 && chance(0.5)) {
            add(ev.Tm + 10, ev.p, "break");
            add(ev.Tm + 10 + ri(10, 45), ev.p, "resume");
          }
          // Un 5 % se olvida de pulsar End.
          if (isExtra || chance(0.95)) add(ev.Tm + len + ri(0, 40), ev.p, "end", { final: true, token: ev.p.token });
        }
      }
      if (ev.action === "end" && ev.final && ev.token === ev.p.token) {
        if (want === "temprano") add(ev.Tm + 15, ev.p, "end", { final: true, token: ev.token });
        else if (want === "en-break") {
          // Se le olvidó volver del break: pulsa Resume y luego End.
          add(ev.Tm, ev.p, "resume");
          add(ev.Tm + 1, ev.p, "end", { final: true, token: ev.token });
        }
        // Al terminar su turno, uno de cada cuatro se queda a hacer horas extra.
        else if (want === "fin" && chance(0.25)) add(ev.Tm + ri(5, 120), ev.p, "start", { plannedLen: 0 });
      }
      if (events > 50000) {
        mismatches.push("la simulación no termina");
        break;
      }
    }

    if (process.env.DEBUG_SIM) {
      const byKey = {};
      for (const m of debugLog) byKey[m] = (byKey[m] || 0) + 1;
      process.stdout.write(JSON.stringify(Object.entries(byKey).sort((a, b) => b[1] - a[1]).slice(0, 12)) + "\n");
    }
    ok(`${events} pulsaciones en 5 días: cada respuesta del bot coincide con la referencia`, !mismatches.length, `${mismatches.length} distintas: ${mismatches.slice(0, 3).join(" | ")}`);
    ok(`${panelChecks} redibujos del panel del canal con los contadores correctos`, !panelBad.length, panelBad.slice(0, 2).join(" | "));
    const cats = {};
    for (const s of ref.values()) for (const x of [...s.done, ...(s.open ? [s.open] : [])]) cats[x.isExtra ? "extra" : x.late ? "tarde" : "normal"] = (cats[x.isExtra ? "extra" : x.late ? "tarde" : "normal"] || 0) + 1;
    ok(`el recorrido cubre turnos normales, tardanzas y horas extra (${JSON.stringify(cats)})`, cats.extra > 10 && cats.tarde > 10 && cats.normal > 10);

    // Base de datos fila a fila.
    const now = queue.length ? 0 : Math.max(...[...ref.values()].flatMap((s) => [...s.done.map((x) => x.end), ...(s.open ? [s.open.start] : [])])) + 60;
    CLOCK = msAt(now);
    const dbBad = [];
    for (const p of people) {
      const st = ref.get(p.id);
      const want = [...st.done, ...(st.open ? [st.open] : [])].sort((a, b) => a.start - b.start);
      const rows = db.prepare("SELECT * FROM shifts WHERE discord_id = ? ORDER BY started_at").all(p.id);
      if (rows.length !== want.length) {
        dbBad.push(`${p.name}: ${rows.length} fichajes, esperados ${want.length}`);
        continue;
      }
      rows.forEach((row, i) => {
        const w = want[i];
        const brs = db.prepare("SELECT * FROM shift_breaks WHERE shift_id = ? ORDER BY started_at").all(row.id);
        const diffs = [];
        if (row.started_at !== msAt(w.start)) diffs.push("inicio");
        if ((row.ended_at ?? null) !== (w.end == null ? null : msAt(w.end))) diffs.push("fin");
        if (Boolean(row.is_extra) !== w.isExtra) diffs.push("extra");
        if (row.required_minutes !== w.required) diffs.push("duración");
        if ((row.expected_at ?? null) !== (w.expected == null ? null : msAt(w.expected))) diffs.push("entrada esperada");
        if (brs.length !== w.breaks.length) diffs.push("breaks");
        if (diffs.length) dbBad.push(`${p.name} ${hhmm(w.start)}: ${diffs.join(", ")}`);
      });
    }
    ok("cada fichaje y cada break en la base coincide con la referencia", !dbBad.length, dbBad.slice(0, 3).join(" | "));
    const twoOpen = db.prepare("SELECT discord_id FROM shifts WHERE ended_at IS NULL GROUP BY discord_id HAVING COUNT(*) > 1").all();
    ok("nadie tiene dos turnos abiertos", !twoOpen.length);

    // Panel web.
    const f = await api.get("/api/admin/fichajes?range=7");
    const all = [...ref.values()].flatMap((s) => [...s.done, ...(s.open ? [s.open] : [])]);
    const extra = all.filter((x) => x.isExtra);
    const closedNormal = all.filter((x) => x.end != null && !x.isExtra);
    const minutes = (ms) => Math.round(ms / 60000);
    const k = f.kpis;
    ok(`panel: ${all.length} fichajes`, k.shifts === all.length, `${k.shifts}`);
    ok(`panel: ${all.filter((x) => x.late).length} llegadas tarde`, k.lateCount === all.filter((x) => x.late).length, `${k.lateCount}`);
    ok(`panel: ${extra.length} fichajes de horas extra, ${minutes(extra.reduce((a, x) => a + workedOf(x, now), 0) * 60000)} min`,
      k.extraCount === extra.length && minutes(k.extraMs) === extra.reduce((a, x) => a + workedOf(x, now), 0),
      `${k.extraCount}, ${minutes(k.extraMs)} min`);
    ok(`panel: ${all.filter((x) => breakOf(x, now) > BREAK).length} excesos de break`, k.overCount === all.filter((x) => breakOf(x, now) > BREAK).length, `${k.overCount}`);
    const avg = closedNormal.reduce((a, x) => a + workedOf(x, now), 0) / closedNormal.length;
    ok("panel: promedio por turno sin contar horas extra", Math.abs(minutes(k.avgWorkedMs) - avg) < 1, `${minutes(k.avgWorkedMs)} vs ${avg.toFixed(1)} min`);
    const histBad = f.history.filter((h) => {
      const st = ref.get(h.discordId);
      const w = st && [...st.done, ...(st.open ? [st.open] : [])].find((x) => msAt(x.start) === h.startedAt);
      return !w || minutes(h.workedMs) !== workedOf(w, now) || h.late !== w.late || h.isExtra !== w.isExtra;
    });
    ok("panel: horas trabajadas, tardanza y horas extra de cada fichaje del historial", !histBad.length, `${histBad.length} distintos`);
  }

  // =========================================================================
  section("4. Comandos");
  // =========================================================================
  CLOCK = realNow(); // el consumo de caracteres se fecha con el reloj de SQLite
  {
    db.prepare("INSERT INTO models (name, provider, voice_id, active) VALUES ('Modelo Uno', 'elevenlabs', 'v1', 1)").run();
    db.prepare("INSERT INTO models (name, provider, voice_id, active) VALUES ('Modelo Sin Voz', 'elevenlabs', 'PENDIENTE', 0)").run();
    const m1 = db.prepare("SELECT id FROM models WHERE name = 'Modelo Uno'").get().id;
    const m0 = db.prepare("SELECT id FROM models WHERE name = 'Modelo Sin Voz'").get().id;
    db.prepare("INSERT INTO chatters (name, daily_char_limit) VALUES ('Ana', 60), ('Luis', 20000)").run();
    const ana = db.prepare("SELECT id FROM chatters WHERE name = 'Ana'").get().id;
    const luis = db.prepare("SELECT id FROM chatters WHERE name = 'Luis'").get().id;
    db.prepare("INSERT INTO phrases (label, text) VALUES ('Saludo', 'hola amor')").run();
    const ph = db.prepare("SELECT id FROM phrases WHERE label = 'Saludo'").get().id;
    const MANAGER = [P.ManageGuild];
    const CHATTER = ["💬 𝗖𝗵𝗮𝘁𝘁𝗲𝗿"];
    const user = (id) => ({ id, toString: () => `<@${id}>` });
    const first = (it) => (it.replies[0] || it.edits[0] || {}).content || "";

    let it = command("uso", { inGuild: false });
    await onInteraction(it);
    ok("fuera del servidor (mensaje directo) los comandos se niegan", /dentro del servidor/.test(first(it)));

    it = command("panel-fichajes", { perms: MANAGER, roles: CHATTER });
    await onInteraction(it);
    ok("un Chatter con Gestionar servidor no puede publicar el panel", /solo para managers/.test(first(it)) && !it.pinned);
    it = command("panel-fichajes", { perms: MANAGER, roles: ["Team Leader"] });
    await onInteraction(it);
    const panel = it.replies[0];
    const ids = panel?.components?.[0]?.components?.map((c) => c.data.custom_id) || [];
    ok("un manager publica el panel con Start, Break, Resume, End y Mi estado, y queda fijado",
      ids.join() === "shift:start,shift:break,shift:resume,shift:end,shift:status" && it.pinned, ids.join());
    const desc = panel.embeds[0].data.description;
    ok("el panel lista los turnos con su salida: 05:30 a 13:00, 13:00 a 21:15, 21:15 a 05:15",
      /Shift 1: 05:30 a 13:00 \(7 h 30 min\)/.test(desc) && /Shift 2: 13:00 a 21:15 \(8 h 15 min\)/.test(desc) && /Shift 3: 21:15 a 05:15 \(8 h\)/.test(desc), desc);
    it = command("panel-fichajes", { perms: MANAGER, pinFails: true });
    await onInteraction(it);
    ok("si no puede fijarlo, publica igual y avisa en privado", it.replies.length === 1 && /no pude fijarlo/.test(it.followUps[0]?.content || "") && it.followUps[0].flags === MessageFlags.Ephemeral);

    it = command("vincular", { perms: MANAGER, roles: CHATTER, options: { usuario: user("d1"), chatter: String(ana) } });
    await onInteraction(it);
    ok("un Chatter no puede usar /vincular", /solo para managers/.test(first(it)) && !db.prepare("SELECT 1 FROM chatters WHERE discord_id = 'd1'").get());
    it = command("vincular", { perms: MANAGER, options: { usuario: user("d1"), chatter: String(ana) } });
    await onInteraction(it);
    ok("un manager vincula a d1 con Ana", /vinculado con el chatter \*\*Ana\*\*/.test(first(it)) && db.prepare("SELECT discord_id FROM chatters WHERE id = ?").get(ana).discord_id === "d1");
    it = command("vincular", { perms: MANAGER, options: { usuario: user("d1"), chatter: String(luis) } });
    await onInteraction(it);
    ok("volver a vincular a d1 lo mueve a Luis y desvincula a Ana",
      db.prepare("SELECT discord_id FROM chatters WHERE id = ?").get(luis).discord_id === "d1" && db.prepare("SELECT discord_id FROM chatters WHERE id = ?").get(ana).discord_id === null);
    it = command("vincular", { perms: MANAGER, options: { usuario: user("d2"), chatter: "Ana" } });
    await onInteraction(it);
    ok("/vincular con un texto escrito a mano en vez de elegir de la lista", /Chatter no encontrado/.test(first(it)));
    it = command("vincular", { perms: [P.Administrator, P.ManageGuild], roles: CHATTER, options: { usuario: user("d2"), chatter: String(ana) } });
    await onInteraction(it);
    ok("un administrador del servidor puede aunque tenga el rol Chatter", /vinculado/.test(first(it)));

    it = command("uso", { userId: "nadie" });
    await onInteraction(it);
    ok("/uso sin estar vinculado explica que pida /vincular", /no está vinculado/.test(first(it)) && it.replies[0].flags === MessageFlags.Ephemeral);
    it = command("uso", { userId: "d2" });
    await onInteraction(it);
    ok("/uso de Ana: 0/60", /\*\*0\/60\*\*/.test(first(it)), first(it));

    const calls0 = prov.calls;
    it = command("voz", { userId: "d2", options: { modelo: String(m1), texto: "hola, cómo estás" } });
    await onInteraction(it);
    const file = it.edits[0]?.files?.[0];
    ok("/voz genera el audio, en privado, con el mp3 adjunto", it.deferredWith?.flags === MessageFlags.Ephemeral && /generado/.test(it.edits[0]?.content || "") && file?.name === "Modelo_Uno.mp3" && prov.calls === calls0 + 1, it.edits[0]?.content);
    it = command("voz", { userId: "d2", options: { modelo: String(m1), texto: "hola, cómo estás" } });
    await onInteraction(it);
    ok("la misma frase otra vez sale de la caché y no llama al proveedor", /desde caché/.test(it.edits[0]?.content || "") && prov.calls === calls0 + 1);
    it = command("uso", { userId: "d2" });
    await onInteraction(it);
    ok("la caché no gasta cuota: /uso sigue en 16/60", /\*\*16\/60\*\*/.test(first(it)), first(it));
    it = command("voz", { userId: "d2", options: { modelo: String(m1), texto: "x".repeat(50) } });
    await onInteraction(it);
    ok("pasarse del límite diario se niega con un mensaje claro", /Límite diario/.test(it.edits[0]?.content || ""), it.edits[0]?.content);
    it = command("voz", { userId: "d2", options: { modelo: String(m0), texto: "hola" } });
    await onInteraction(it);
    ok("una modelo sin voz no se puede usar", /inactivo|voz cargada/.test(it.edits[0]?.content || ""), it.edits[0]?.content);
    it = command("voz", { userId: "d2", options: { modelo: "Modelo Uno", texto: "hola" } });
    await onInteraction(it);
    ok("modelo escrita a mano en vez de elegida: pide elegirla de la lista", /Elige la modelo de la lista/.test(first(it)) && it.replies[0].flags === MessageFlags.Ephemeral, first(it));
    it = command("voz", { userId: "d1", options: { modelo: String(m1), texto: "y".repeat(201) } });
    await onInteraction(it);
    ok("texto más largo que MAX_TEXT_CHARS se niega", /supera el máximo de 200/.test(it.edits[0]?.content || ""), it.edits[0]?.content);
    const used0 = getUsedToday(luis);
    prov.fail = true;
    it = command("voz", { userId: "d1", options: { modelo: String(m1), texto: "falla esto" } });
    await onInteraction(it);
    prov.fail = false;
    ok("si ElevenLabs falla: mensaje de error y no se descuenta la cuota", /Error generando audio/.test(it.edits[0]?.content || "") && getUsedToday(luis) === used0, it.edits[0]?.content);
    it = command("frase", { userId: "d1", options: { modelo: String(m1), frase: String(ph) } });
    await onInteraction(it);
    ok("/frase genera la frase guardada", /generado|caché/.test(it.edits[0]?.content || "") && it.edits[0]?.files?.length === 1);
    it = command("frase", { userId: "d1", options: { modelo: String(m1), frase: "999" } });
    await onInteraction(it);
    ok("/frase con una frase inexistente", /Frase no encontrada/.test(first(it)));

    for (let i = 0; i < 30; i++) db.prepare("INSERT INTO models (name, provider, voice_id, active) VALUES (?, 'elevenlabs', ?, 1)").run(`Extra ${i}`, `v${i}`);
    const am = await autocomplete("modelo", "");
    ok("autocompletar modelo: máximo 25 opciones y nunca las modelos sin voz", am.length === 25 && !am.some((o) => o.name === "Modelo Sin Voz"));
    const am2 = await autocomplete("modelo", "uno");
    ok("autocompletar filtra por texto", am2.length === 1 && am2[0].value === String(m1));
    const af = await autocomplete("frase", "sal");
    ok("autocompletar frase", af.length === 1 && af[0].name === "Saludo");
    const ac = await autocomplete("chatter", "");
    ok("autocompletar chatter", ac.length === 2);

    let threw = false;
    try {
      await onInteraction({ isAutocomplete: () => false, isChatInputCommand: () => false, isButton: () => true, customId: "otra:cosa" });
      await onInteraction({
        ...command("uso", { userId: "d1" }),
        reply: async () => {
          throw new Error("Discord caído");
        },
      });
    } catch {
      threw = true;
    }
    ok("botones ajenos y fallos de Discord no tumban el bot", !threw);

    const byCmd = Object.fromEntries(commands.map((c) => [c.name, c]));
    ok("comandos de manager ocultos por defecto a quien no gestiona el servidor y fuera de mensajes directos",
      ["vincular", "panel-fichajes"].every((n) => byCmd[n].default_member_permissions === String(P.ManageGuild) && byCmd[n].dm_permission === false));
    ok("/voz limita el texto a 1000 caracteres desde Discord", byCmd.voz.options.find((o) => o.name === "texto").max_length === 1000);
  }

  await new Promise((r) => setTimeout(r, 50));
  ok("ninguna promesa quedó sin atender", unhandled === 0, `${unhandled}`);

  api.server.close();
  console.error = realConsoleError;
  console.log(out.join("\n"));
  const fails = out.filter((x) => x.startsWith("FALLA")).length;
  const total = out.filter((x) => /^(PASA|FALLA)/.test(x)).length;
  console.log(`\n${total - fails}/${total} pruebas profundas del bot pasan`);
  db.close?.();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(fails ? 1 : 0), 50);
})().catch((e) => {
  console.error = realConsoleError;
  console.log(out.join("\n"));
  console.error("ERROR", e);
  process.exit(1);
});
