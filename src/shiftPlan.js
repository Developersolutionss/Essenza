const db = require("./db");
const tzu = require("./timezone");

// Turnos fijos (Shift 1, Shift 2, Shift 3...) y asignación automática.
//
// Cada persona se asigna sola al pulsar Start: si tiene un rol de Discord cuyo
// nombre contiene el nombre de un turno (por ejemplo "Shift 2 (Chatter)" contiene
// "Shift 2"), se le aplica la hora de entrada de ese turno. Un horario personal
// (tabla schedules) tiene prioridad, para quien no sigue su turno.
//
// La hora esperada se guarda en el propio fichaje: si luego se cambia el turno de
// la persona o la hora del turno, el historial no se reescribe.

const DEFAULT_GRACE = () => Number(process.env.LATE_GRACE_MINUTES || 10);

function listTemplates() {
  return db.prepare("SELECT id, name, start_time AS startTime, grace_minutes AS graceMin FROM shift_templates ORDER BY start_time, name").all();
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// El nombre del turno debe aparecer completo: "Shift 1" no coincide con "Shift 10".
function roleMatches(roleName, templateName) {
  return new RegExp(`${escapeRegex(templateName.toLowerCase())}(?!\\d)`).test(String(roleName).toLowerCase());
}

// Etiqueta legible de la zona horaria para mostrar en mensajes y en el panel.
function tzLabel(tz = tzu.getTz()) {
  return tz === "America/Caracas" ? "hora de Venezuela" : tz;
}

// Devuelve el plan de esta persona para un fichaje que empieza en `startedAt`,
// o null si no se puede saber su turno.
//   { source: "personal" | "turno", templateName, startTime, graceMin, expectedAt }
function resolveForStart({ discordId, roleNames = [], startedAt }) {
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

  const matches = listTemplates().filter((t) => roleNames.some((r) => roleMatches(r, t.name)));
  if (!matches.length) return null;

  // Si alguien tuviera dos roles de turno, se elige el que más se acerca a su llegada.
  const options = matches.map((t) => ({
    source: "turno",
    templateName: t.name,
    startTime: t.startTime,
    graceMin: t.graceMin,
    expectedAt: tzu.expectedStart(startedAt, t.startTime),
  }));
  options.sort((a, b) => Math.abs(startedAt - a.expectedAt) - Math.abs(startedAt - b.expectedAt));
  return options[0];
}

module.exports = { listTemplates, resolveForStart, roleMatches, tzLabel, DEFAULT_GRACE };
