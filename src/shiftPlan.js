const db = require("./db");
const tzu = require("./timezone");

// Cómo se sabe a qué turno pertenece alguien cuando pulsa Start.
//
// Orden de prioridad:
//   1. Horario personal (tabla schedules): para quien no sigue su turno.
//   2. Apodo del servidor con el turno escrito ("Alejandro - Shift 2 (Chatter)"),
//      o un rol con ese nombre. Detecta retrasos de cualquier tamaño.
//   3. Cargo exento (Team Leader, Jefe de Chat...): no se mide la puntualidad.
//   4. Por la hora de Start: se toma el inicio de turno más cercano. Funciona sin
//      tocar nombres, pero con turnos separados 8 h un retraso de más de 4 h se
//      confunde con llegar antes al turno siguiente.
//
// La hora esperada se guarda en el propio fichaje: si luego se cambia el turno de
// la persona o la hora del turno, el historial no se reescribe.

const DEFAULT_GRACE = () => Number(process.env.LATE_GRACE_MINUTES || 10);

function listTemplates() {
  return db.prepare("SELECT id, name, start_time AS startTime, grace_minutes AS graceMin FROM shift_templates ORDER BY start_time, name").all();
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
function nameMatches(text, templateName) {
  const flexible = escapeRegex(templateName.trim().toLowerCase()).replace(/\s+/g, "[\\s_-]*");
  return new RegExp(`(?<![a-z0-9])${flexible}(?!\\d)`).test(String(text || "").toLowerCase());
}

// Cargos que no siguen un turno fijo y por tanto no se miden en puntualidad.
const EXEMPT_ROLES = () =>
  (process.env.EXEMPT_ROLES || "team leader,jefe de chat,content manager").split(",").map(normalize).filter(Boolean);

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

function planFor(template, source, startedAt) {
  return {
    source,
    templateName: template.name,
    startTime: template.startTime,
    graceMin: template.graceMin,
    expectedAt: tzu.expectedStart(startedAt, template.startTime),
  };
}

// Devuelve el plan de esta persona para un fichaje que empieza en `startedAt`:
//   { source: "personal" | "apodo" | "hora" | "exento", templateName, startTime, graceMin, expectedAt }
// "exento" no trae hora esperada. Devuelve null si no hay forma de medir (menos de
// dos turnos definidos y sin apodo).
function resolveForStart({ discordId, names = [], startedAt }) {
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

  const texts = names.filter(Boolean);
  const templates = listTemplates();

  // 2) El turno escrito en el apodo o en un rol.
  const named = templates.filter((t) => texts.some((n) => nameMatches(n, t.name)));
  if (named.length) {
    // Si un apodo nombrara dos turnos ("Shift 1 / Shift 2"), gana el más cercano a la llegada.
    const options = named.map((t) => planFor(t, "apodo", startedAt));
    options.sort((a, b) => Math.abs(startedAt - a.expectedAt) - Math.abs(startedAt - b.expectedAt));
    return options[0];
  }

  // 3) Cargos que no siguen turno.
  if (isExempt(texts)) return { source: "exento", templateName: null, startTime: null, graceMin: null, expectedAt: null };

  // 4) Por la hora de Start. Con un solo turno no hay forma de distinguir, así que no se mide.
  if (templates.length < 2) return null;
  const options = templates.map((t) => planFor(t, "hora", startedAt));
  options.sort((a, b) => Math.abs(startedAt - a.expectedAt) - Math.abs(startedAt - b.expectedAt));
  return options[0];
}

module.exports = { listTemplates, resolveForStart, nameMatches, normalize, isExempt, tzLabel, DEFAULT_GRACE };
