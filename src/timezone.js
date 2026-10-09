// Utilidades de zona horaria sin dependencias.
// La zona se toma de TIMEZONE (ej. America/Bogota) o, si no existe, de la del sistema.

function getTz() {
  return process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function parts(ms, tz = getTz()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
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

// "YYYY-MM-DD" en la zona local.
function localDate(ms, tz = getTz()) {
  const p = parts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// Hora esperada de inicio más cercana al inicio real (cubre turnos que cruzan medianoche).
function expectedStart(startedAt, hhmm, tz = getTz()) {
  const p = parts(startedAt, tz);
  const [h, mi] = hhmm.split(":").map(Number);
  const candidates = [-1, 0, 1].map((dd) => zonedToUtc(p.y, p.m, p.d + dd, h, mi, tz));
  return candidates.reduce((best, c) => (Math.abs(c - startedAt) < Math.abs(best - startedAt) ? c : best));
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

module.exports = { getTz, parts, startOfLocalDay, localDate, expectedStart, zonedToUtc, sqlDayModifier, sqlTime };
