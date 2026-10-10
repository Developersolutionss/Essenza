// Utilidades de zona horaria sin dependencias.
// La zona se toma de TIMEZONE (ej. America/Bogota) o, si no existe, de la del sistema.

function getTz() {
  return process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Crear un Intl.DateTimeFormat es caro y aquí se pide muchas veces: uno por zona.
const formatters = new Map();
function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

function parts(ms, tz = getTz()) {
  const f = formatterFor(tz);
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
}

// Diferencia (ms) entre la hora local de la zona y UTC en ese instante.
function offsetMs(ms, tz = getTz()) {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

// Convierte una hora local de la zona (y/m/d h:mi) a epoch UTC. Admite desbordes de día/mes.
function zonedToUtc(y, m, d, h, mi, tz = getTz()) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(guess, tz);
  return guess - offsetMs(first, tz);
}

function startOfLocalDay(ms, tz = getTz()) {
  const p = parts(ms, tz);
  return zonedToUtc(p.y, p.m, p.d, 0, 0, tz);
}

function startOfLocalMonth(ms, tz = getTz()) {
  const p = parts(ms, tz);
  return zonedToUtc(p.y, p.m, 1, 0, 0, tz);
}

// "YYYY-MM-DD" en la zona local.
function localDate(ms, tz = getTz()) {
  const p = parts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// Hora de entrada esperada para un fichaje concreto.
// Se elige la última hora prevista que no esté más de EARLY_MAX_HOURS en el
// futuro: así "llegó 13 h tarde" no se confunde con "llegó 11 h antes de mañana",
// y los turnos que cruzan medianoche siguen saliendo bien.
const EARLY_MAX_MS = Number(process.env.EARLY_MAX_HOURS || 4) * 3600 * 1000;

function expectedStart(startedAt, hhmm, tz = getTz()) {
  const p = parts(startedAt, tz);
  const [h, mi] = hhmm.split(":").map(Number);
  const candidates = [-1, 0, 1].map((dd) => zonedToUtc(p.y, p.m, p.d + dd, h, mi, tz)).sort((x, y) => x - y);
  const usable = candidates.filter((c) => c - startedAt <= EARLY_MAX_MS);
  // La más tardía que ya empezó o está por empezar dentro del margen.
  if (usable.length) return usable[usable.length - 1];
  return candidates[0];
}

// Modificador de SQLite para agrupar por día local, p. ej. "-300 minutes".
function sqlDayModifier(tz = getTz()) {
  const min = Math.round(offsetMs(Date.now(), tz) / 60000);
  return `${min >= 0 ? "+" : ""}${min} minutes`;
}

// Fecha/hora UTC en el formato de SQLite ("YYYY-MM-DD HH:MM:SS").
function sqlTime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

module.exports = { getTz, parts, startOfLocalDay, startOfLocalMonth, localDate, expectedStart, zonedToUtc, sqlDayModifier, sqlTime };
