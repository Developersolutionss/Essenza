const $ = (id) => document.getElementById(id);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const nf = new Intl.NumberFormat("es");
const fmtMs = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
const fmtDate = (ms) =>
  new Date(ms).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

let timer = null;
let data = null;

function show(loggedIn) {
  $("login").classList.toggle("hidden", loggedIn);
  $("app").classList.toggle("hidden", !loggedIn);
}

async function load() {
  try {
    const r = await fetch(`/api/admin/overview?days=${$("days").value}`, { credentials: "same-origin" });
    if (!r.ok) throw new Error("auth");
    data = await r.json();
    show(true);
    render();
    clearInterval(timer);
    timer = setInterval(load, 30000);
  } catch (e) {
    clearInterval(timer);
    show(false);
  }
}

function kpi(label, value, note, pct, over) {
  const bar =
    pct == null
      ? ""
      : `<div class="bar ${over ? "over" : ""}"><i style="width:${Math.min(100, pct)}%"></i></div>`;
  return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${value}</div>
    <div class="note">${note || ""}</div>${bar}</div>`;
}

function render() {
  const d = data;
  $("updated").textContent = `Actualizado ${new Date(d.now).toLocaleTimeString("es")}`;

  const el = d.elevenlabs;
  const planKpi = el.error
    ? kpi("Plan de ElevenLabs", "—", esc(el.error))
    : kpi(
        `Créditos del plan (${esc(el.tier)})`,
        `${nf.format(el.used)} / ${nf.format(el.limit)}`,
        `Quedan ${nf.format(el.limit - el.used)}` +
          (el.resetAt && el.resetAt > Date.now() ? ` · renueva ${new Date(el.resetAt).toLocaleDateString("es")}` : ""),
        (el.used / el.limit) * 100,
        el.used / el.limit > 0.9
      );
  const onBreakNow = d.openShifts.filter((s) => s.onBreak).length;
  $("kpis").innerHTML =
    planKpi +
    kpi("Gastados hoy", nf.format(d.credits.today), "caracteres facturados por este sistema") +
    kpi("Gastados este mes", nf.format(d.credits.month), "caracteres facturados por este sistema") +
    kpi(
      `Ahorro por caché (${d.days} d)`,
      nf.format(d.credits.saved_by_cache),
      `${nf.format(d.credits.cache_hits)} audios reutilizados sin costo`
    ) +
    kpi("En turno ahora", d.openShifts.length, onBreakNow ? `${onBreakNow} en break` : "nadie en break");

  const maxChars = Math.max(1, ...d.voices.map((v) => v.chars));
  $("voices").innerHTML = d.voices.some((v) => v.generations || v.cache_hits)
    ? `<table><tr><th></th><th>Voz</th><th></th><th class="num">Audios</th><th class="num">Caracteres</th><th class="num">Caché</th></tr>` +
      d.voices
        .map(
          (v, i) => `<tr><td class="rank">${i + 1}</td>
          <td>${esc(v.name)} ${v.active ? "" : '<span class="tag">inactiva</span>'}</td>
          <td><div class="inline-bar"><i style="width:${(v.chars / maxChars) * 100}%"></i></div></td>
          <td class="num">${nf.format(v.generations)}</td><td class="num">${nf.format(v.chars)}</td>
          <td class="num">${nf.format(v.cache_hits)}</td></tr>`
        )
        .join("") +
      "</table>"
    : '<p class="empty">Aún no hay audios generados en este periodo.</p>';

  $("chatters").innerHTML = d.chatters.length
    ? `<table><tr><th>Chatter</th><th class="num">Audios</th><th class="num">Caracteres</th><th class="num">Caché</th></tr>` +
      d.chatters
        .map(
          (c) => `<tr><td>${esc(c.name)}</td><td class="num">${nf.format(c.generations)}</td>
          <td class="num">${nf.format(c.chars)}</td><td class="num">${nf.format(c.cache_hits)}</td></tr>`
        )
        .join("") +
      "</table>"
    : '<p class="empty">Sin chatters.</p>';

  const maxDay = Math.max(1, ...d.daily.map((x) => x.generated + x.cached));
  $("daily").innerHTML = d.daily.length
    ? d.daily
        .map(
          (x) => `<div class="col" title="${esc(x.day)}: ${nf.format(x.generated)} generados, ${nf.format(x.cached)} de caché">
          <b style="height:${(x.cached / maxDay) * 100}%"></b><i style="height:${(x.generated / maxDay) * 100}%"></i></div>`
        )
        .join("")
    : '<p class="empty">Sin datos.</p>';

  renderShifts();
}

function renderShifts() {
  const d = data;
  const breakMs = d.rules.breakMs;
  const shiftMs = d.rules.shiftMs;
  // Entre actualizaciones, los tiempos en vivo se recalculan en el navegador.
  const drift = Date.now() - d.now;

  $("open").innerHTML = d.openShifts.length
    ? `<table><tr><th>Persona</th><th>Inicio</th><th>Estado</th><th class="num">Trabajado</th><th class="num">Break usado</th></tr>` +
      d.openShifts
        .map((s) => {
          const brk = s.breakMs + (s.onBreak ? drift : 0);
          const worked = s.onBreak ? s.workedMs : s.workedMs + drift;
          const over = Math.max(0, brk - breakMs);
          let status = '<span class="tag good">Trabajando</span>';
          if (s.onBreak) {
            status = over
              ? `<span class="tag bad">Break excedido +${fmtMs(over)}</span>`
              : '<span class="tag warn">En break</span>';
          } else if (over) {
            status += ` <span class="tag bad">Exceso ${fmtMs(over)}</span>`;
          }
          return `<tr><td>${esc(s.name)}</td><td>${fmtDate(s.startedAt)}</td><td>${status}</td>
            <td class="num">${fmtMs(worked)} / ${fmtMs(shiftMs)}</td>
            <td class="num">${fmtMs(brk)} / ${fmtMs(breakMs)}</td></tr>`;
        })
        .join("") +
      "</table>"
    : '<p class="empty">Nadie ha iniciado turno.</p>';

  $("history").innerHTML = d.shifts.length
    ? `<table><tr><th>Persona</th><th>Inicio</th><th>Fin</th><th class="num">Trabajado</th><th class="num">Break</th><th>Marcas</th></tr>` +
      d.shifts
        .map((s) => {
          const marks = [];
          if (s.breakOverMs) marks.push(`<span class="tag bad">Break +${fmtMs(s.breakOverMs)}</span>`);
          if (!s.endedAt) marks.push('<span class="tag warn">Abierto</span>');
          return `<tr><td>${esc(s.name)}</td><td>${fmtDate(s.startedAt)}</td>
            <td>${s.endedAt ? fmtDate(s.endedAt) : "—"}</td>
            <td class="num">${fmtMs(s.workedMs)}</td><td class="num">${fmtMs(s.breakMs)}</td>
            <td>${marks.join(" ") || '<span class="tag good">OK</span>'}</td></tr>`;
        })
        .join("") +
      "</table>"
    : '<p class="empty">Sin turnos en este periodo.</p>';
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").textContent = "";
  const r = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: $("password").value }),
  });
  if (r.ok) {
    $("password").value = "";
    load();
  } else {
    $("loginError").textContent = (await r.json().catch(() => ({}))).error || "Error";
  }
});
$("logout").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  clearInterval(timer);
  show(false);
});
$("days").addEventListener("change", load);
setInterval(() => {
  if (data && !$("app").classList.contains("hidden")) renderShifts();
}, 15000);
load();
