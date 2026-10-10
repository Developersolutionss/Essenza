const db = require("./db");
const tzu = require("./timezone");
const shifts = require("./shifts");

// Cómo se sabe a qué turno pertenece alguien cuando pulsa Start.
//
// Orden de prioridad:
//   1. Horario personal (tabla schedules): para quien no sigue su turno.
//   2. Rol de Discord con el turno (Shift 1, Shift 2, Shift 3). Es el método
//      recomendado: además de medir la puntualidad, permite saber cuándo alguien
//      ficha FUERA de su turno (ver "horas extra" abajo).
//   3. Turno escrito en el apodo ("Alejandro - Shift 2 (Chatter)"). Misma lógica.
//   4. Cargo directivo (Team Leader, Jefe de Chat...): no se mide la puntualidad y
//      cumple 10 h (EXEMPT_HOURS) en lugar de la duración de un turno.
//   5. Por la hora de Start: se toma el inicio de turno más cercano. Funciona sin
//      tocar nada, pero con turnos separados 8 h un retraso de más de 4 h se
//      confunde con llegar antes al turno siguiente, y no puede detectar horas extra.
//
// Horas extra: si la persona tiene un turno (rol o apodo) y pulsa Start DESPUÉS de que
// ese turno terminó, todo el fichaje cuenta como horas extra. No se mide puntualidad,
// no exige una duración mínima y se suma aparte en el panel. También son horas extra
// si ya cumplió ese mismo turno y vuelve a pulsar Start (ver afterCompletedShift).
//
// La hora esperada se guarda en el propio fichaje: si luego se cambia el turno de
// la persona o la hora del turno, el historial no se reescribe.

const DEFAULT_GRACE = () => Number(process.env.LATE_GRACE_MINUTES || 10);

function listTemplates() {
  return db
    .prepare(
      `SELECT id, name, start_time AS startTime, grace_minutes AS graceMin, duration_minutes AS durationMin
       FROM shift_templates ORDER BY start_time, name`
    )
    .all();
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Texto de apodos y roles en forma comparable: sin emojis ni letras decorativas
// (\"💬 𝗖𝗛𝗔𝗧𝗧𝗜𝗡𝗚\" -> \"chatting\"), en minúsculas y con espacios simples.
function normalize(s) {
  return String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Los apodos los escribe la gente a mano: "Shift 2", "shift2", "SHIFT-2" y
// "Shift_2" valen igual. El número debe quedar completo: "Shift 1" no coincide
// con "Shift 10". Las letras sueltas antes ("Reshift 1") tampoco cuentan.
// NFKC convierte las letras y cifras decorativas de los roles ("𝗦𝗵𝗶𝗳𝘁 𝟭") en normales.
function nameMatches(text, templateName) {
  const flexible = escapeRegex(templateName.trim().toLowerCase()).replace(/\s+/g, "[\\s_-]*");
  return new RegExp(`(?<![a-z0-9])${flexible}(?!\\d)`).test(String(text || "").normalize("NFKC").toLowerCase());
}

// Cargos que no siguen un turno fijo y por tanto no se miden en puntualidad.
const EXEMPT_ROLES = () =>
  (process.env.EXEMPT_ROLES || "team leader,jefe de chat,content manager").split(",").map(normalize).filter(Boolean);

// Los cargos directivos no siguen un turno fijo, pero cumplen una jornada más larga.
const exemptMinutes = () => Math.round(Number(process.env.EXEMPT_HOURS || 10) * 60);

function isExempt(names) {
  const terms = EXEMPT_ROLES();
  return names.some((n) => {
    const text = ` ${normalize(n)} `;
    return terms.some((t) => text.includes(` ${t} `));
  });
}

// Etiqueta legible de la zona horaria para mostrar en mensajes y en el panel.
function tzLabel(tz = tzu.getTz()) {
  return tz === "America/Caracas" ? "hora de Venezuela" : tz;
}

const defaultShiftMinutes = () => Math.round(Number(process.env.SHIFT_HOURS || 8) * 60);

function planFor(template, source, startedAt) {
  const expectedAt = tzu.expectedStart(startedAt, template.startTime);
  const plan = {
    source,
    templateName: template.name,
    startTime: template.startTime,
    graceMin: template.graceMin,
    durationMin: template.durationMin || null,
    expectedAt,
    isExtra: false,
  };
  // Solo se puede saber que alguien ficha fuera de su turno si el turno es conocido
  // (rol o apodo); deducido por la hora no hay forma de saberlo.
  if (source === "rol" || source === "apodo") {
    const endsAt = expectedAt + (template.durationMin || defaultShiftMinutes()) * 60000;
    if (startedAt > endsAt) {
      return { ...plan, expectedAt: null, graceMin: null, durationMin: 0, isExtra: true, shiftEndedAt: endsAt };
    }
  }
  return plan;
}

// El turno más cercano a la llegada entre varios candidatos.
function nearest(options, startedAt) {
  const dist = (o) => Math.abs(startedAt - (o.expectedAt ?? o.shiftEndedAt));
  return [...options].sort((a, b) => dist(a) - dist(b))[0];
}

// Si la persona ya cumplió este mismo turno (mismo día y hora de entrada) y vuelve a
// pulsar Start, eso son horas extra: no se le exige otro turno completo ni se le marca
// como tarde. Solo cuenta si de verdad lo cumplió; un turno cerrado antes de tiempo
// desde el panel no la libera.
function afterCompletedShift(discordId, plan) {
  if (!plan || plan.isExtra || plan.expectedAt == null) return plan;
  const prev = db
    .prepare(
      `SELECT * FROM shifts WHERE discord_id = ? AND expected_at = ? AND ended_at IS NOT NULL AND is_extra = 0
       ORDER BY ended_at DESC LIMIT 1`
    )
    .get(discordId, plan.expectedAt);
  if (!prev) return plan;
  const breaks = db.prepare("SELECT * FROM shift_breaks WHERE shift_id = ?").all(prev.id);
  const st = shifts.summarize(prev, breaks, prev.ended_at);
  if (st.workedMs < st.requiredMs) return plan;
  return {
    ...plan,
    expectedAt: null,
    graceMin: null,
    durationMin: 0,
    isExtra: true,
    shiftEndedAt: prev.ended_at,
    alreadyDone: true,
  };
}

// Devuelve el plan de esta persona para un fichaje que empieza en `startedAt`:
//   { source: "personal" | "rol" | "apodo" | "hora" | "exento", templateName, startTime,
//     graceMin, durationMin, expectedAt, isExtra }
// durationMin null = se exige la duración general (SHIFT_HOURS); 0 = horas extra, sin mínimo.
// "exento" y las horas extra no traen hora esperada. Devuelve null si no hay forma de
// medir (menos de dos turnos definidos y sin rol ni apodo).
//   roleNames: nombres de los roles de Discord de la persona
//   names: apodo del servidor y nombre global
function resolveForStart(args) {
  return afterCompletedShift(args.discordId, resolvePlan(args));
}

function resolvePlan({ discordId, names = [], roleNames = [], startedAt }) {
  const personal = db.prepare("SELECT * FROM schedules WHERE discord_id = ?").get(discordId);
  if (personal) {
    return {
      source: "personal",
      templateName: null,
      startTime: personal.start_time,
      graceMin: personal.grace_minutes,
      expectedAt: tzu.expectedStart(startedAt, personal.start_time),
    };
  }

  const roles = roleNames.filter(Boolean);
  const nicks = names.filter(Boolean);
  const texts = [...roles, ...nicks];
  const templates = listTemplates();

  // 2) El rol manda sobre el apodo. 3) Si no hay rol de turno, el apodo.
  for (const [source, pool] of [["rol", roles], ["apodo", nicks]]) {
    const named = templates.filter((t) => pool.some((n) => nameMatches(n, t.name)));
    if (named.length) {
      // Si tuviera dos ("Shift 1 / Shift 2"), gana el más cercano a la llegada.
      return nearest(named.map((t) => planFor(t, source, startedAt)), startedAt);
    }
  }

  // 4) Cargos que no siguen turno.
  if (isExempt(texts)) {
    return { source: "exento", templateName: null, startTime: null, graceMin: null, durationMin: exemptMinutes(), expectedAt: null };
  }

  // 5) Por la hora de Start. Con un solo turno no hay forma de distinguir, así que no se mide.
  if (templates.length < 2) return null;
  return nearest(templates.map((t) => planFor(t, "hora", startedAt)), startedAt);
}

module.exports = { listTemplates, resolveForStart, nameMatches, normalize, isExempt, exemptMinutes, tzLabel, DEFAULT_GRACE };
