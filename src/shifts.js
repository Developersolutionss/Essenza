const db = require("./db");

// Reglas de turno. Se pueden ajustar por entorno (útil para pruebas).
const SHIFT_MS = Number(process.env.SHIFT_HOURS || 8) * 3600 * 1000;
const BREAK_MS = Number(process.env.BREAK_MINUTES || 30) * 60 * 1000;

function getOpenShift(discordId) {
  return db.prepare("SELECT * FROM shifts WHERE discord_id = ? AND ended_at IS NULL").get(discordId);
}

function breaksOf(shiftId) {
  return db.prepare("SELECT * FROM shift_breaks WHERE shift_id = ? ORDER BY started_at").all(shiftId);
}

// Resume un turno: el tiempo trabajado NO incluye los breaks.
function summarize(shift, breaks, now = Date.now()) {
  const end = shift.ended_at || now;
  let breakMs = 0;
  let openBreak = null;
  for (const b of breaks) {
    breakMs += (b.ended_at || now) - b.started_at;
    if (!b.ended_at) openBreak = b;
  }
  const workedMs = Math.max(0, end - shift.started_at - breakMs);
  return {
    workedMs,
    breakMs,
    breakOverMs: Math.max(0, breakMs - BREAK_MS),
    onBreak: Boolean(openBreak),
    openBreakStartedAt: openBreak ? openBreak.started_at : null,
    canEnd: !openBreak && workedMs >= SHIFT_MS,
    remainingMs: Math.max(0, SHIFT_MS - workedMs),
    breaks: breaks.map((b) => ({ startedAt: b.started_at, endedAt: b.ended_at })),
  };
}

function statusOf(discordId, now = Date.now()) {
  const shift = getOpenShift(discordId);
  if (!shift) return null;
  return { shift, ...summarize(shift, breaksOf(shift.id), now) };
}

// `plan` (opcional) trae el turno con el que se medirá la puntualidad:
// { templateName, expectedAt, graceMin }. Se guarda en el propio fichaje.
function startShift(discordId, name, now = Date.now(), plan = null) {
  const open = getOpenShift(discordId);
  if (open) return { ok: false, reason: "already_open", shift: open };
  try {
    const info = db
      .prepare(
        `INSERT INTO shifts (discord_id, discord_name, started_at, template_name, expected_at, grace_minutes)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(discordId, name, now, plan?.templateName ?? null, plan?.expectedAt ?? null, plan?.graceMin ?? null);
    return { ok: true, shift: db.prepare("SELECT * FROM shifts WHERE id = ?").get(info.lastInsertRowid) };
  } catch {
    return { ok: false, reason: "already_open" };
  }
}

function startBreak(discordId, now = Date.now()) {
  const st = statusOf(discordId, now);
  if (!st) return { ok: false, reason: "no_shift" };
  if (st.onBreak) return { ok: false, reason: "already_on_break", st };
  // Solo se permite un break por turno.
  if (breaksOf(st.shift.id).length > 0) return { ok: false, reason: "break_used", st };
  db.prepare("INSERT INTO shift_breaks (shift_id, started_at) VALUES (?, ?)").run(st.shift.id, now);
  return { ok: true, remainingBreakMs: BREAK_MS - st.breakMs, st };
}

function endBreak(discordId, now = Date.now()) {
  const st = statusOf(discordId, now);
  if (!st) return { ok: false, reason: "no_shift" };
  if (!st.onBreak) return { ok: false, reason: "not_on_break", st };
  db.prepare("UPDATE shift_breaks SET ended_at = ? WHERE shift_id = ? AND ended_at IS NULL").run(now, st.shift.id);
  return { ok: true, st: statusOf(discordId, now) };
}

function endShift(discordId, now = Date.now()) {
  const st = statusOf(discordId, now);
  if (!st) return { ok: false, reason: "no_shift" };
  if (st.onBreak) return { ok: false, reason: "on_break", st };
  if (st.workedMs < SHIFT_MS) return { ok: false, reason: "too_early", st };
  db.prepare("UPDATE shifts SET ended_at = ? WHERE id = ?").run(now, st.shift.id);
  const closed = db.prepare("SELECT * FROM shifts WHERE id = ?").get(st.shift.id);
  return { ok: true, shift: closed, ...summarize(closed, breaksOf(closed.id), now) };
}

// Turnos abiertos ahora mismo, con su estado.
function listOpen(now = Date.now()) {
  return db
    .prepare("SELECT * FROM shifts WHERE ended_at IS NULL ORDER BY started_at")
    .all()
    .map((shift) => ({ shift, ...summarize(shift, breaksOf(shift.id), now) }));
}

// Turnos iniciados desde `sinceMs`, abiertos o cerrados.
function listSince(sinceMs, now = Date.now()) {
  const shifts = db.prepare("SELECT * FROM shifts WHERE started_at >= ? ORDER BY started_at DESC").all(sinceMs);
  if (!shifts.length) return [];
  const all = db
    .prepare(`SELECT * FROM shift_breaks WHERE shift_id IN (${shifts.map(() => "?").join(",")}) ORDER BY started_at`)
    .all(...shifts.map((s) => s.id));
  const byShift = new Map();
  for (const b of all) {
    if (!byShift.has(b.shift_id)) byShift.set(b.shift_id, []);
    byShift.get(b.shift_id).push(b);
  }
  return shifts.map((shift) => ({ shift, ...summarize(shift, byShift.get(shift.id) || [], now) }));
}

module.exports = {
  SHIFT_MS,
  BREAK_MS,
  statusOf,
  startShift,
  startBreak,
  endBreak,
  endShift,
  listOpen,
  listSince,
};
