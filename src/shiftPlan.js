const db = require("./db");
const tzu = require("./timezone");

// Turnos fijos (Shift 1, Shift 2, Shift 3...) y asignación automática.
//
// El turno de cada persona se lee del nombre con el que aparece en el servidor de
// Discord (su apodo), por ejemplo "Alejandro - Shift 2 (Chatter)". También sirve el
// nombre de un rol, por si algún día se usan roles. Un horario personal (tabla
// schedules) tiene prioridad, para quien no sigue su turno.
//
// La hora esperada se guarda en el propio fichaje: si luego se cambia el turno de
// la persona o la hora del turno, el historial no se reescribe.

const DEFAULT_GRACE = () => Number(process.env.LATE_GRACE_MINUTES || 10);

function listTemplates() {
  return db.prepare("SELECT id, name, start_time AS startTime, grace_minutes AS graceMin FROM shift_templates ORDER BY start_time, name").all();
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Los apodos los escribe la gente a mano: "Shift 2", "shift2", "SHIFT-2" y
// "Shift_2" valen igual. El número debe quedar completo: "Shift 1" no coincide
// con "Shift 10". Las letras sueltas antes ("Reshift 1") tampoco cuentan.
function nameMatches(text, templateName) {
  const flexible = escapeRegex(templateName.trim().toLowerCase()).replace(/\s+/g, "[\\s_-]*");
  return new RegExp(`(?<![a-z0-9])${flexible}(?!\\d)`).test(String(text || "").toLowerCase());
}

// Etiqueta legible de la zona horaria para mostrar en mensajes y en el panel.
function tzLabel(tz = tzu.getTz()) {
  return tz === "America/Caracas" ? "hora de Venezuela" : tz;
}

// Devuelve el plan de esta persona para un fichaje que empieza en `startedAt`,
// o null si no se puede saber su turno.
//   names: textos donde buscar el turno (apodo del servidor, nombre global, roles)
//   -> { source: "personal" | "turno", templateName, startTime, graceMin, expectedAt }
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
  const matches = listTemplates().filter((t) => texts.some((n) => nameMatches(n, t.name)));
  if (!matches.length) return null;

  // Si un apodo nombrara dos turnos ("Shift 1 / Shift 2"), se elige el que más se
  // acerca a la hora real de llegada.
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

module.exports = { listTemplates, resolveForStart, nameMatches, tzLabel, DEFAULT_GRACE };
