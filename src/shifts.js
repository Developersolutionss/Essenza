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

// Duración exigida para pulsar End: la de su turno (guardada al iniciar) o, si no
// tiene turno, la general de SHIFT_HOURS.
// 0 minutos = horas extra: no hay mínimo, se puede terminar cuando se quiera.
function requiredOf(shift) {
  return shift.required_minutes != null ? shift.required_minutes * 60000 : SHIFT_MS;
}

// Resume un turno. El break permitido (BREAK_MINUTES) es tiempo pagado y cuenta
// como trabajado; solo el exceso se descuenta y hay que recuperarlo.
function summarize(shift, breaks, now = Date.now()) {
  const end = shift.ended_at || now;
  let breakMs = 0;
  let openBreak = null;
  for (const b of breaks) {
    breakMs += (b.ended_at || now) - b.started_at;
    if (!b.ended_at) openBreak = b;
  }
  const breakOverMs = Math.max(0, breakMs - BREAK_MS);
  const workedMs = Math.max(0, end - shift.started_at - breakOverMs);
  const requiredMs = requiredOf(shift);
  const isExtra = Boolean(shift.is_extra);
  return {
    workedMs,
    isExtra,
    extraMs: isExtra ? workedMs : 0,
    requiredMs,
    breakMs,
    breakOverMs,
    onBreak: Boolean(openBreak),
    openBreakStartedAt: openBreak ? openBreak.started_at : null,
    canEnd: !openBreak && workedMs >= requiredMs,
    remainingMs: Math.max(0, requiredMs - workedMs),
    breaks: breaks.map((b) => ({ startedAt: b.started_at, endedAt: b.ended_at })),
  };
}

function statusOf(discordId, now = Date.now()) {
  const shift = getOpenShift(discordId);
  if (!shift) return null;
  return { shift, ...summarize(shift, breaksOf(shift.id), now) };
}

// `plan` (opcional) trae el turno con el que se medirá la puntualidad y la duración
// exigida: { templateName, expectedAt, graceMin, durationMin, source }. Se guarda en
// el propio fichaje, así que cambiar un turno después no altera los ya iniciados.
function startShift(discordId, name, now = Date.now(), plan = null) {
  const open = getOpenShift(discordId);
  if (open) return { ok: false, reason: "already_open", shift: open };
  try {
    const info = db
      .prepare(
        `INSERT INTO shifts (discord_id, discord_name, started_at, template_name, expected_at, grace_minutes, plan_source, required_minutes, is_extra)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        discordId,
        name,
        now,
        plan?.templateName ?? null,
        plan?.expectedAt ?? null,
        plan?.graceMin ?? null,
        plan?.source ?? null,
        plan?.durationMin ?? null,
        plan?.isExtra ? 1 : 0
      );
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
  if (st.workedMs < st.requiredMs) return { ok: false, reason: "too_early", st };
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
