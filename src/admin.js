const express = require("express");
const db = require("./db");
const shifts = require("./shifts");
const auth = require("./auth");
const users = require("./users");
const tzu = require("./timezone");
const plans = require("./shiftPlan");

const router = express.Router();
const DAY = 86400000;

// ---------------------------------------------------------------------------
// Acceso: cuentas individuales con rol (ver src/auth.js y src/users.js)
// ---------------------------------------------------------------------------

const requireAuth = auth.requireAuth;
const requireAdmin = auth.requireAdmin;

router.post("/login", (req, res) => auth.login(req, res));
router.post("/logout", (req, res) => auth.logout(req, res));
router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

// Cambiar la propia contraseña (cualquier cuenta).
router.put("/me/password", requireAuth, (req, res) => {
  const actual = String(req.body?.current || "");
  const nueva = String(req.body?.password || "");
  if (!users.matches(req.user.id, actual)) {
    return res.status(401).json({ error: "La contraseña actual no es correcta" });
  }
  const bad = users.checkPassword(nueva);
  if (bad) return res.status(400).json({ error: bad });
  users.update(req.user.id, { password: nueva });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Cuentas (solo administradores)
// ---------------------------------------------------------------------------

router.get("/users", requireAdmin, (req, res) => res.json({ users: users.list(), roles: users.ROLES }));

router.post("/users", requireAdmin, (req, res) => {
  const username = String(req.body?.username || "").trim();
  const displayName = String(req.body?.displayName || "").trim();
  const password = String(req.body?.password || "");
  const role = String(req.body?.role || "manager");
  const bad = users.checkUsername(username) || users.checkPassword(password) || users.checkRole(role);
  if (bad) return res.status(400).json({ error: bad });
  if (!displayName) return res.status(400).json({ error: "Escribe el nombre de la persona." });
  if (users.getByUsername(username)) return res.status(409).json({ error: "Ese usuario ya existe." });
  res.status(201).json({ user: users.create({ username, displayName, password, role }) });
});

router.put("/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = users.getById(id);
  if (!target) return res.status(404).json({ error: "Cuenta no encontrada" });

  const patch = {};
  if (req.body?.displayName !== undefined) {
    const dn = String(req.body.displayName).trim();
    if (!dn) return res.status(400).json({ error: "Escribe el nombre de la persona." });
    patch.displayName = dn;
  }
  if (req.body?.role !== undefined) {
    const bad = users.checkRole(req.body.role);
    if (bad) return res.status(400).json({ error: bad });
    patch.role = req.body.role;
  }
  if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
  if (req.body?.password !== undefined) {
    const bad = users.checkPassword(req.body.password);
    if (bad) return res.status(400).json({ error: bad });
    patch.password = String(req.body.password);
  }

  // Nunca dejar el sistema sin ningún administrador que pueda entrar.
  const dejaDeSerAdmin = (patch.role && patch.role !== "admin") || patch.active === false;
  if (target.role === "admin" && dejaDeSerAdmin && users.countActiveAdmins(id) === 0) {
    return res.status(409).json({ error: "Debe quedar al menos un administrador activo." });
  }
  res.json({ user: users.update(id, patch) });
});

router.delete("/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = users.getById(id);
  if (!target) return res.status(404).json({ error: "Cuenta no encontrada" });
  if (id === req.user.id) return res.status(409).json({ error: "No puedes borrar tu propia cuenta." });
  if (target.role === "admin" && users.countActiveAdmins(id) === 0) {
    return res.status(409).json({ error: "Debe quedar al menos un administrador activo." });
  }
  users.remove(id);
  res.json({ ok: true });
});
// ---------------------------------------------------------------------------
// Utilidades de rango y datos
// ---------------------------------------------------------------------------

// range: "today" | "7" | "30" | "90"  ->  inicio (ms) y nº de días (en hora local).
function resolveRange(range) {
  const now = Date.now();
  const days = range === "today" ? 1 : Math.min(Math.max(parseInt(range, 10) || 7, 1), 365);
  const since = tzu.startOfLocalDay(now, tzu.getTz()) - (days - 1) * DAY;
  return { now, days, since, label: range === "today" ? "today" : String(days) };
}

// Lista de fechas locales (YYYY-MM-DD) desde `since` hasta hoy, sin huecos.
function localDays(since, now) {
  const out = [];
  for (let t = since; t <= now; t += DAY) out.push(tzu.localDate(t + 12 * 3600 * 1000));
  const today = tzu.localDate(now);
  if (out[out.length - 1] !== today) out.push(today);
  return [...new Set(out)];
}

// Se agrupa por día local en JavaScript y no en SQL: el desfase horario puede
// cambiar dentro del rango (horario de verano) y un único modificador movería
// el corte de medianoche de los días anteriores al cambio.
function dailySeries(since, now) {
  const rows = db
    .prepare("SELECT created_at, char_count, from_cache FROM usage_log WHERE created_at >= ?")
    .all(tzu.sqlTime(since));
  const byDay = new Map();
  for (const r of rows) {
    const day = tzu.localDate(Date.parse(r.created_at.replace(" ", "T") + "Z"));
    const acc = byDay.get(day) || { generated: 0, cached: 0, generations: 0 };
    if (r.from_cache) acc.cached += r.char_count;
    else {
      acc.generated += r.char_count;
      acc.generations += 1;
    }
    byDay.set(day, acc);
  }
  return localDays(since, now).map((day) => ({
    day,
    generated: byDay.get(day)?.generated || 0,
    cached: byDay.get(day)?.cached || 0,
    generations: byDay.get(day)?.generations || 0,
  }));
}


// Turnos enriquecidos con horario (llegada tarde) y breaks.
// Turnos enriquecidos con la hora esperada. Primero se usa lo guardado en el
// propio fichaje (turno por rol u horario personal vigente al fichar); en
// fichajes antiguos sin ese dato se usa el horario personal actual.
function enrichShifts(list) {
  const sched = new Map(db.prepare("SELECT * FROM schedules").all().map((s) => [s.discord_id, s]));
  const tz = tzu.getTz();
  const defaultGrace = plans.DEFAULT_GRACE();
  return list.map((o) => {
    let expectedAt = null;
    let graceMin = null;
    let templateName = null;
    let scheduleStart = null;
    const sc = sched.get(o.shift.discord_id);

    if (o.shift.expected_at != null) {
      expectedAt = o.shift.expected_at;
      graceMin = o.shift.grace_minutes ?? defaultGrace;
      templateName = o.shift.template_name;
    } else if (sc) {
      expectedAt = tzu.expectedStart(o.shift.started_at, sc.start_time, tz);
      graceMin = sc.grace_minutes;
      scheduleStart = sc.start_time;
    }

    const scheduled = expectedAt != null;
    const lateMs = scheduled ? Math.max(0, o.shift.started_at - expectedAt) : 0;
    const late = scheduled && lateMs > graceMin * 60000;

    return {
      id: o.shift.id,
      discordId: o.shift.discord_id,
      name: o.shift.discord_name,
      startedAt: o.shift.started_at,
      endedAt: o.shift.ended_at,
      workedMs: o.workedMs,
      breakMs: o.breakMs,
      breakOverMs: o.breakOverMs,
      onBreak: o.onBreak,
      openBreakStartedAt: o.openBreakStartedAt,
      breaks: o.breaks,
      scheduled,
      templateName,
      planSource: o.shift.plan_source || (scheduleStart ? "personal" : null),
      scheduleStart,
      graceMin,
      expectedAt,
      lateMs,
      late,
    };
  });
}

// ---------------------------------------------------------------------------
// ElevenLabs: plan y voces de la cuenta (con caché)
// ---------------------------------------------------------------------------

const elHeaders = () => ({ "xi-api-key": process.env.ELEVENLABS_API_KEY || "" });
const cache = { sub: { at: 0, data: null }, voices: { at: 0, data: null } };

async function elevenLabsSubscription() {
  if (Date.now() - cache.sub.at < 60000 && cache.sub.data) return cache.sub.data;
  if (!process.env.ELEVENLABS_API_KEY) return { error: "Falta ELEVENLABS_API_KEY" };
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: elHeaders() });
    if (!r.ok) return { error: `ElevenLabs respondió ${r.status}` };
    const j = await r.json();
    const reset = j.next_character_count_reset_unix ? j.next_character_count_reset_unix * 1000 : null;
    const data = {
      tier: j.tier,
      status: j.status,
      used: j.character_count,
      limit: j.character_limit,
      // ElevenLabs a veces devuelve una fecha ya pasada; solo se usa si es futura.
      resetAt: reset && reset > Date.now() ? reset : null,
      voiceSlotsUsed: j.voice_slots_used,
      voiceLimit: j.voice_limit,
      proSlotsUsed: j.professional_voice_slots_used,
      proLimit: j.professional_voice_limit,
    };
    cache.sub = { at: Date.now(), data };
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

async function elevenLabsVoices() {
  if (Date.now() - cache.voices.at < 300000 && cache.voices.data) return cache.voices.data;
  if (!process.env.ELEVENLABS_API_KEY) return [];
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: elHeaders() });
    if (!r.ok) return cache.voices.data || [];
    const j = await r.json();
    const data = (j.voices || []).map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category,
      createdAt: v.created_at_unix ? v.created_at_unix * 1000 : null,
    }));
    cache.voices = { at: Date.now(), data };
    return data;
  } catch {
    return cache.voices.data || [];
  }
}

// ---------------------------------------------------------------------------
// GET /summary — vista general
// ---------------------------------------------------------------------------

router.get("/summary", requireAuth, async (req, res) => {
  const now = Date.now();
  const dayStart = tzu.startOfLocalDay(now);

  const todayShifts = enrichShifts(shifts.listSince(dayStart, now));
  const open = enrichShifts(shifts.listOpen(now));
  const lateToday = todayShifts.filter((s) => s.late);
  const overToday = todayShifts.filter((s) => s.breakOverMs > 0);

  const charsToday = db
    .prepare("SELECT COALESCE(SUM(char_count), 0) AS n FROM usage_log WHERE from_cache = 0 AND created_at >= ?")
    .get(tzu.sqlTime(dayStart)).n;
  const charsMonth = db
    .prepare("SELECT COALESCE(SUM(char_count), 0) AS n FROM usage_log WHERE from_cache = 0 AND created_at >= ?")
    .get(tzu.sqlTime(tzu.startOfLocalMonth(now))).n;

  const plan = await elevenLabsSubscription();

  // Alertas accionables.
  const alerts = [];
  for (const s of open) {
    if (s.onBreak && s.breakOverMs > 0) {
      alerts.push({ level: "bad", text: `${s.name} está en break y ya se pasó`, ms: s.breakOverMs });
    }
    if (now - s.startedAt > 16 * 3600 * 1000) {
      alerts.push({ level: "warn", text: `${s.name} tiene un turno abierto desde hace mucho`, since: s.startedAt });
    }
  }
  for (const s of lateToday) {
    alerts.push({ level: "warn", text: `${s.name} llegó tarde hoy`, ms: s.lateMs });
  }
  if (!plan.error && plan.limit && plan.used / plan.limit > 0.8) {
    alerts.push({ level: "bad", text: "El plan de ElevenLabs superó el 80% de sus créditos" });
  }

  res.json({
    now,
    tz: tzu.getTz(),
    user: req.user,
    rules: { shiftMs: shifts.SHIFT_MS, breakMs: shifts.BREAK_MS },
    kpis: {
      openNow: open.length,
      onBreakNow: open.filter((s) => s.onBreak).length,
      shiftsToday: todayShifts.length,
      lateToday: lateToday.length,
      overToday: overToday.length,
      charsToday,
      charsMonth,
    },
    plan,
    alerts,
    open: open.map(({ breaks, ...rest }) => rest),
    daily: dailySeries(dayStart - 13 * DAY, now),
  });
});

// ---------------------------------------------------------------------------
// GET /fichajes?range=
// ---------------------------------------------------------------------------

router.get("/fichajes", requireAuth, (req, res) => {
  const { now, days, since } = resolveRange(String(req.query.range || "7"));
  const all = enrichShifts(shifts.listSince(since, now));
  const open = enrichShifts(shifts.listOpen(now));

  const people = new Map();
  for (const s of all) {
    if (!people.has(s.discordId)) {
      people.set(s.discordId, {
        discordId: s.discordId,
        name: s.name,
        shifts: 0,
        lateCount: 0,
        lateMs: 0,
        overCount: 0,
        overMs: 0,
        workedMs: 0,
      });
    }
    const p = people.get(s.discordId);
    p.shifts += 1;
    p.workedMs += s.workedMs;
    if (s.late) {
      p.lateCount += 1;
      p.lateMs += s.lateMs;
    }
    if (s.breakOverMs > 0) {
      p.overCount += 1;
      p.overMs += s.breakOverMs;
    }
  }

  const late = all.filter((s) => s.late);
  const overruns = all.filter((s) => s.breakOverMs > 0);
  const closed = all.filter((s) => s.endedAt);

  res.json({
    now,
    days,
    tz: tzu.getTz(),
    rules: { shiftMs: shifts.SHIFT_MS, breakMs: shifts.BREAK_MS },
    kpis: {
      shifts: all.length,
      people: people.size,
      lateCount: late.length,
      lateMs: late.reduce((a, s) => a + s.lateMs, 0),
      overCount: overruns.length,
      overMs: overruns.reduce((a, s) => a + s.breakOverMs, 0),
      avgWorkedMs: closed.length ? closed.reduce((a, s) => a + s.workedMs, 0) / closed.length : 0,
      unscheduled: new Set(all.filter((s) => !s.scheduled).map((s) => s.discordId)).size,
    },
    open,
    late,
    overruns,
    people: [...people.values()].sort((a, b) => b.lateCount + b.overCount - (a.lateCount + a.overCount)),
    history: all,
  });
});

// ---------------------------------------------------------------------------
// GET /elevenlabs?range=
// ---------------------------------------------------------------------------

router.get("/elevenlabs", requireAuth, async (req, res) => {
  const { now, days, since } = resolveRange(String(req.query.range || "30"));
  const sinceStr = tzu.sqlTime(since);

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN from_cache = 0 THEN char_count END), 0) AS generated,
         COALESCE(SUM(CASE WHEN from_cache = 1 THEN char_count END), 0) AS saved,
         COALESCE(SUM(CASE WHEN from_cache = 0 THEN 1 END), 0) AS generations,
         COALESCE(SUM(CASE WHEN from_cache = 1 THEN 1 END), 0) AS cacheHits
       FROM usage_log WHERE created_at >= ?`
    )
    .get(sinceStr);

  const voices = db
    .prepare(
      `SELECT m.id, m.name, m.voice_id AS voiceId, m.active,
              COALESCE(SUM(CASE WHEN u.from_cache = 0 THEN 1 END), 0) AS generations,
              COALESCE(SUM(CASE WHEN u.from_cache = 0 THEN u.char_count END), 0) AS chars,
              COALESCE(SUM(CASE WHEN u.from_cache = 1 THEN 1 END), 0) AS cacheHits,
              COALESCE(SUM(CASE WHEN u.from_cache = 1 THEN u.char_count END), 0) AS saved,
              MAX(u.created_at) AS lastUsed
       FROM models m
       LEFT JOIN usage_log u ON u.model_id = m.id AND u.created_at >= ?
       GROUP BY m.id
       ORDER BY chars DESC, m.name`
    )
    .all(sinceStr);

  const chatters = db
    .prepare(
      `SELECT c.id, c.name,
              COALESCE(SUM(CASE WHEN u.from_cache = 0 THEN u.char_count END), 0) AS chars,
              COALESCE(SUM(CASE WHEN u.from_cache = 0 THEN 1 END), 0) AS generations,
              COALESCE(SUM(CASE WHEN u.from_cache = 1 THEN 1 END), 0) AS cacheHits
       FROM chatters c
       LEFT JOIN usage_log u ON u.chatter_id = c.id AND u.created_at >= ?
       WHERE c.active = 1
       GROUP BY c.id
       ORDER BY chars DESC`
    )
    .all(sinceStr);

  const topPhrases = db
    .prepare(
      `SELECT c.text, m.name AS model, c.hits, c.char_count AS chars, c.hits * c.char_count AS saved
       FROM audio_cache c JOIN models m ON m.id = c.model_id
       WHERE c.hits > 0 ORDER BY saved DESC LIMIT 10`
    )
    .all();

  // Acumulado del mes en curso y proyección a fin de mes.
  const mStart = tzu.startOfLocalMonth(now);
  const monthDaily = dailySeries(mStart, now);
  let acc = 0;
  const cumulative = monthDaily.map((d) => ({ day: d.day, total: (acc += d.generated) }));
  const p = tzu.parts(now);
  const daysInMonth = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
  const monthChars = acc;
  const projected = Math.round((monthChars / Math.max(1, p.d)) * daysInMonth);

  const plan = await elevenLabsSubscription();
  const accountVoices = await elevenLabsVoices();
  const assigned = new Map(db.prepare("SELECT voice_id, name FROM models").all().map((m) => [m.voice_id, m.name]));

  res.json({
    now,
    days,
    tz: tzu.getTz(),
    plan,
    totals,
    month: { chars: monthChars, projected, daysInMonth, day: p.d },
    daily: dailySeries(since, now),
    cumulative,
    voices,
    chatters,
    topPhrases,
    accountVoices: accountVoices
      .map((v) => ({ ...v, assignedTo: assigned.get(v.voiceId) || null }))
      .sort((a, b) => Number(Boolean(b.assignedTo)) - Number(Boolean(a.assignedTo)) || (a.category === "premade") - (b.category === "premade")),
  });
});

// ---------------------------------------------------------------------------
// Horarios (para detectar llegadas tarde)
// ---------------------------------------------------------------------------

router.get("/schedules", requireAuth, (req, res) => {
  const known = db
    .prepare(
      `SELECT discord_id, discord_name, template_name FROM shifts WHERE id IN (SELECT MAX(id) FROM shifts GROUP BY discord_id)`
    )
    .all();
  const sched = new Map(db.prepare("SELECT * FROM schedules").all().map((s) => [s.discord_id, s]));
  const ids = new Set([...known.map((k) => k.discord_id), ...sched.keys()]);
  const byId = new Map(known.map((k) => [k.discord_id, k]));

  const people = [...ids]
    .map((id) => ({
      discordId: id,
      name: sched.get(id)?.display_name || byId.get(id)?.discord_name || id,
      start: sched.get(id)?.start_time || null,
      graceMin: sched.get(id)?.grace_minutes ?? null,
      lastTemplate: byId.get(id)?.template_name || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({
    tz: tzu.getTz(),
    tzLabel: plans.tzLabel(),
    defaultGrace: plans.DEFAULT_GRACE(),
    templates: plans.listTemplates(),
    people,
  });
});

router.put("/schedules/:discordId", requireAdmin, (req, res) => {
  const id = String(req.params.discordId);
  const start = String(req.body?.start || "");
  const grace = Number(req.body?.graceMin ?? process.env.LATE_GRACE_MINUTES ?? 10);
  const name = String(req.body?.name || "").trim().slice(0, 80);

  if (!/^\d{5,25}$/.test(id)) return res.status(400).json({ error: "ID de Discord inválido" });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return res.status(400).json({ error: "La hora debe ser HH:MM" });
  if (!Number.isInteger(grace) || grace < 0 || grace > 240) {
    return res.status(400).json({ error: "La gracia debe ser un número entre 0 y 240 minutos" });
  }

  const known = db.prepare("SELECT discord_name FROM shifts WHERE discord_id = ? ORDER BY id DESC LIMIT 1").get(id);
  const displayName = name || known?.discord_name;
  if (!displayName) return res.status(400).json({ error: "Falta el nombre de la persona" });

  db.prepare(
    `INSERT INTO schedules (discord_id, display_name, start_time, grace_minutes) VALUES (?, ?, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET display_name = excluded.display_name,
       start_time = excluded.start_time, grace_minutes = excluded.grace_minutes`
  ).run(id, displayName, start, grace);
  res.json({ ok: true });
});

router.delete("/schedules/:discordId", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM schedules WHERE discord_id = ?").run(String(req.params.discordId));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Turnos fijos (Shift 1, 2, 3...): solo administradores
// ---------------------------------------------------------------------------

function checkTemplate({ name, startTime, graceMin }) {
  if (!String(name || "").trim()) return "Escribe el nombre del turno.";
  if (String(name).trim().length > 40) return "El nombre del turno es demasiado largo.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(startTime || ""))) return "La hora debe ser HH:MM, en 24 horas.";
  const g = Number(graceMin);
  if (!Number.isInteger(g) || g < 0 || g > 240) return "La gracia debe ser un número entre 0 y 240 minutos.";
  return "";
}

router.post("/templates", requireAdmin, (req, res) => {
  const bad = checkTemplate(req.body || {});
  if (bad) return res.status(400).json({ error: bad });
  const name = String(req.body.name).trim();
  if (db.prepare("SELECT 1 FROM shift_templates WHERE name = ?").get(name)) {
    return res.status(409).json({ error: "Ya existe un turno con ese nombre." });
  }
  db.prepare("INSERT INTO shift_templates (name, start_time, grace_minutes) VALUES (?, ?, ?)")
    .run(name, req.body.startTime, Number(req.body.graceMin));
  res.status(201).json({ ok: true });
});

router.put("/templates/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM shift_templates WHERE id = ?").get(id)) {
    return res.status(404).json({ error: "Turno no encontrado" });
  }
  const bad = checkTemplate(req.body || {});
  if (bad) return res.status(400).json({ error: bad });
  const name = String(req.body.name).trim();
  const clash = db.prepare("SELECT id FROM shift_templates WHERE name = ? AND id != ?").get(name, id);
  if (clash) return res.status(409).json({ error: "Ya existe un turno con ese nombre." });
  db.prepare("UPDATE shift_templates SET name = ?, start_time = ?, grace_minutes = ? WHERE id = ?")
    .run(name, req.body.startTime, Number(req.body.graceMin), id);
  res.json({ ok: true });
});

router.delete("/templates/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM shift_templates WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Cerrar un turno que quedó abierto (alguien se fue sin pulsar End)
// ---------------------------------------------------------------------------

router.post("/shifts/:id/close", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const shift = db.prepare("SELECT * FROM shifts WHERE id = ?").get(id);
  if (!shift) return res.status(404).json({ error: "Turno no encontrado" });
  if (shift.ended_at) return res.status(409).json({ error: "Ese turno ya está cerrado" });

  const now = Date.now();
  // Si se puede, se cierra en la hora indicada por el manager; si no, ahora.
  let endAt = now;
  if (req.body?.endedAt != null) {
    endAt = Number(req.body.endedAt);
    if (!Number.isFinite(endAt) || endAt <= shift.started_at || endAt > now) {
      return res.status(400).json({ error: "La hora de cierre debe estar entre el inicio del turno y ahora" });
    }
  }
  // Un break sin cerrar se cierra también, para que el tiempo trabajado cuadre.
  db.prepare("UPDATE shift_breaks SET ended_at = ? WHERE shift_id = ? AND ended_at IS NULL AND started_at <= ?")
    .run(endAt, id, endAt);
  db.prepare("UPDATE shift_breaks SET ended_at = started_at WHERE shift_id = ? AND ended_at IS NULL").run(id);
  db.prepare("UPDATE shifts SET ended_at = ? WHERE id = ?").run(endAt, id);
  res.json({ ok: true });
});

module.exports = router;
