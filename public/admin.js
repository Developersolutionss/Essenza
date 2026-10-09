"use strict";
/* Panel de administración Essensa.
   Sin dependencias salvo Chart.js (servido localmente). Estilos en ds.css y admin.css. */

const $ = (sel, el = document) => el.querySelector(sel);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const nf = new Intl.NumberFormat("es");
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Colores de gráficas (RGB para poder derivar tramas y transparencias). */
const RGB = { cost: "245,158,11", saved: "34,197,94", danger: "239,68,68", info: "96,165,250" };
const COL = { cost: "#f59e0b", saved: "#22c55e", danger: "#ef4444", info: "#60a5fa", fg: "#f8fafc", muted: "#94a3b8", grid: "rgba(148,163,184,.16)", surface: "#1b2336" };

const TITLES = { resumen: "Resumen", fichajes: "Fichajes", elevenlabs: "ElevenLabs", cuentas: "Cuentas", horarios: "Horarios" };
const RANGES = [["today", "Hoy"], ["7", "7 días"], ["30", "30 días"], ["90", "90 días"]];
const REFRESH_MS = 30000;
const STALE_MS = 95000;

const state = {
  route: "resumen",
  range: { fichajes: "7", elevenlabs: "30" },
  tz: "UTC",
  animate: true,
  charts: [],
  tableOpen: new Set(),
  sort: {},
  loadedAt: Date.now(),
  lastOk: 0,
  loading: false,
  paused: false,
  stale: false,
  timer: null,
  token: 0,
  user: null,
};

/* ---------- Iconos (Lucide, trazo 2, decorativos) ---------- */

const ICONS = {
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>',
  table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  sort: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  stop: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 9h6v6H9z"/>',
};
const ic = (n) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[n] || ""}</svg>`;

/* ---------- Formato ---------- */

function fmtDur(ms) {
  ms = Math.max(0, ms);
  if (ms > 0 && ms < 60000) return `${Math.round(ms / 1000)} s`;
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
const fmtTime = (ms) => new Date(ms).toLocaleTimeString("es", { timeZone: state.tz, hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDay = (ms) => new Date(ms).toLocaleDateString("es", { timeZone: state.tz, day: "numeric", month: "short" });
const fmtDT = (ms) => `${fmtDay(ms)} · ${fmtTime(ms)}`;
const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("es", { day: "numeric", month: "short" });
const addDays = (iso, n) => {
  const t = new Date(`${iso}T12:00:00`);
  t.setDate(t.getDate() + n);
  return t.toISOString().slice(0, 10);
};
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const pctLabel = (a, b) => (a > 0 && b && (a / b) * 100 < 1 ? "<1" : String(pct(a, b)));

/* ---------- Red ---------- */

async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: "same-origin", ...opts });
  if (r.status === 401 && !path.includes("/login")) {
    showLogin();
    throw new Error("auth");
  }
  return r;
}
async function getJSON(path) {
  const r = await api(path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
  return r.json();
}

function toast(msg, isErr) {
  const el = document.createElement("div");
  el.className = `toast ${isErr ? "err" : "ok"}`;
  el.innerHTML = `${ic(isErr ? "alert" : "check")}<span>${esc(msg)}</span>`;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), isErr ? 6000 : 3500);
}
const announce = (msg) => {
  $("#announce").textContent = "";
  setTimeout(() => ($("#announce").textContent = msg), 50);
};

/* ---------- Gráficas ---------- */

if (window.Chart) {
  Chart.defaults.color = COL.muted;
  Chart.defaults.font.family = "'Fira Code', ui-monospace, Consolas, monospace";
  Chart.defaults.font.size = 12;
  Chart.defaults.borderColor = COL.grid;
  const tt = Chart.defaults.plugins.tooltip;
  tt.backgroundColor = "#0f172a";
  tt.borderColor = "#64748b";
  tt.borderWidth = 1;
  tt.padding = 10;
  tt.titleColor = COL.fg;
  tt.bodyColor = "#cbd5e1";
}

/* Trama rayada: distingue una serie sin depender solo del color. */
function hatch(rgb) {
  const c = document.createElement("canvas");
  c.width = c.height = 10;
  const x = c.getContext("2d");
  x.fillStyle = `rgba(${rgb},0.3)`;
  x.fillRect(0, 0, 10, 10);
  x.strokeStyle = `rgb(${rgb})`;
  x.lineWidth = 2.2;
  x.beginPath();
  x.moveTo(-2, 2); x.lineTo(2, -2);
  x.moveTo(0, 10); x.lineTo(10, 0);
  x.moveTo(8, 12); x.lineTo(12, 8);
  x.stroke();
  return x.createPattern(c, "repeat");
}

/* Etiquetas de valor al final de cada barra horizontal. */
const valueLabels = {
  id: "valueLabels",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.display) return;
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = COL.fg;
    ctx.font = "12px 'Fira Code', monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      meta.data.forEach((bar, j) => {
        const v = ds.data[j];
        if (v) ctx.fillText(nf.format(v), bar.x + 6, bar.y);
      });
    });
    ctx.restore();
  },
};

function baseOpts(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: state.animate && !reducedMotion() ? { duration: 400 } : false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { position: "bottom", labels: { boxWidth: 14, boxHeight: 12, padding: 14 } } },
    ...extra,
  };
}

function dataTableHtml(data) {
  const ds = data.datasets;
  return `<table><thead><tr><th scope="col">&nbsp;</th>${ds
    .map((d) => `<th scope="col" class="num">${esc(d.label || "Valor")}</th>`)
    .join("")}</tr></thead><tbody>${data.labels
    .map(
      (l, i) =>
        `<tr><th scope="row">${esc(l)}</th>${ds
          .map((d) => `<td class="num">${d.data[i] == null ? "—" : nf.format(d.data[i])}</td>`)
          .join("")}</tr>`
    )
    .join("")}</tbody></table>`;
}

/* Crea la gráfica y añade el botón "Ver tabla" (alternativa accesible a la gráfica). */
function mk(id, config, label) {
  const el = document.getElementById(id);
  if (!el || !window.Chart) return;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `${label}. Los mismos datos están disponibles como tabla con el botón Ver tabla.`);
  state.charts.push(new Chart(el, config));

  const panel = el.closest(".panel");
  const holder = el.closest(".chart, .donut");
  const head = panel && panel.querySelector(".head");
  if (!holder || !head) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn ghost sm";
  btn.dataset.key = `tbl-${id}`;
  btn.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-controls", `${id}-table`);
  btn.innerHTML = `${ic("table")}<span>Ver tabla</span>`;

  const box = document.createElement("div");
  box.id = `${id}-table`;
  box.className = "chart-table tbl-wrap";
  box.hidden = true;
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", `Datos de: ${label}`);
  box.tabIndex = 0;
  box.innerHTML = dataTableHtml(config.data);

  holder.after(box);
  head.appendChild(btn);

  const setOpen = (open) => {
    holder.hidden = open;
    box.hidden = !open;
    btn.setAttribute("aria-pressed", String(open));
    btn.querySelector("span").textContent = open ? "Ver gráfica" : "Ver tabla";
    btn.firstElementChild.outerHTML = ic(open ? "chart" : "table");
    if (open) state.tableOpen.add(id);
    else state.tableOpen.delete(id);
  };
  btn.addEventListener("click", () => setOpen(box.hidden));
  if (state.tableOpen.has(id)) setOpen(true);
}

function dailyChart(id, daily) {
  mk(
    id,
    {
      type: "bar",
      data: {
        labels: daily.map((d) => shortDay(d.day)),
        datasets: [
          { label: "Generado (consume créditos)", data: daily.map((d) => d.generated), backgroundColor: COL.cost, borderRadius: 3, stack: "a" },
          { label: "Desde caché (gratis)", data: daily.map((d) => d.cached), backgroundColor: hatch(RGB.saved), borderColor: COL.saved, borderWidth: 1, borderRadius: 3, stack: "a" },
        ],
      },
      options: baseOpts({
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14 } },
          y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => nf.format(v) } },
        },
      }),
    },
    "Caracteres por día, generados frente a reutilizados desde caché"
  );
}

function hbar(id, label, labels, datasets, legend = false) {
  mk(
    id,
    {
      type: "bar",
      data: { labels, datasets: datasets.map((d) => ({ borderRadius: 4, ...d })) },
      plugins: [valueLabels],
      options: baseOpts({
        indexAxis: "y",
        layout: { padding: { left: 8, right: 44 } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0, callback: (v) => nf.format(v) } }, y: { grid: { display: false }, ticks: { callback(v) { const l = String(this.getLabelForValue(v)); return l.length > 14 ? `${l.slice(0, 13)}…` : l; } } } },
        plugins: { legend: { display: legend, position: "bottom", labels: { boxWidth: 14, boxHeight: 12, padding: 14 } }, valueLabels: { display: true } },
      }),
    },
    label
  );
}

function doughnut(id, label, labels, data, fills) {
  mk(
    id,
    {
      type: "doughnut",
      data: { labels, datasets: [{ label: "Cantidad", data, backgroundColor: fills, borderColor: COL.surface, borderWidth: 3 }] },
      options: baseOpts({ cutout: "70%", plugins: { legend: { display: false } }, interaction: { mode: "nearest" } }),
    },
    label
  );
}

/* ---------- Piezas de interfaz ---------- */

const pill = (kind, icon, text) => `<span class="pill ${kind}">${icon ? ic(icon) : ""}${esc(text)}</span>`;
const empty = (txt, { ok = false, action = "" } = {}) =>
  `<div class="empty ${ok ? "ok" : ""}">${ic(ok ? "check" : "info")}<span>${esc(txt)}</span>${action}</div>`;

function kpi(icon, label, value, sub, { alert = false, meter = "" } = {}) {
  return `<div class="kpi ${alert ? "attn" : ""}"><div class="k">${ic(icon)}${esc(label)}</div>
    <div class="v">${value}</div><div class="s">${sub || ""}</div>${meter}</div>`;
}
const meter = (p, bad) => `<div class="meter ${bad ? "bad" : ""}" role="img" aria-label="${Math.min(100, p)}% usado"><i style="width:${Math.min(100, p)}%"></i></div>`;

function head(title, sub, right = "") {
  return `<div class="page-head"><div><h1 tabindex="-1">${esc(title)}</h1><p>${sub}</p></div>${right}</div>`;
}

function rangeSeg(route) {
  return `<div class="seg" role="group" aria-label="Periodo">${RANGES.map(
    ([v, l]) => `<button type="button" data-range="${route}" data-v="${v}" data-key="seg-${route}-${v}" aria-pressed="${state.range[route] === v}">${l}</button>`
  ).join("")}</div>`;
}

/* Tabla con encabezado fijo y columnas ordenables.
   cols: [{h, num?, sort?: "num"|"text"}]  filas: celdas como texto HTML o {h, v} (v = valor de orden). */
function table(id, label, cols, rows, { scroll = false } = {}) {
  const th = cols
    .map((c, i) => {
      const inner = c.sort
        ? `<button type="button" class="th-btn" data-key="sort-${id}-${i}">${c.h}${ic("sort")}</button>`
        : c.h;
      return `<th scope="col" class="${c.num ? "num" : ""}" ${c.sort ? `aria-sort="none" data-col="${i}" data-type="${c.sort}"` : ""}>${inner}</th>`;
    })
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${r
          .map((cell, i) => {
            const o = cell !== null && typeof cell === "object" ? cell : { h: cell };
            const cls = [cols[i].num ? "num" : "", cols[i].cls || ""].join(" ").trim();
            return `<td class="${cls}" ${o.v != null ? `data-v="${esc(o.v)}"` : ""}>${o.h}</td>`;
          })
          .join("")}</tr>`
    )
    .join("");
  return `<div class="tbl-wrap ${scroll ? "scroll" : ""}" role="region" aria-label="${esc(label)}" tabindex="0">
    <table data-tid="${id}"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function sortTable(tbl, i, dir) {
  const ths = tbl.tHead.rows[0].cells;
  const type = ths[i].dataset.type;
  const rows = [...tbl.tBodies[0].rows];
  const val = (r) => {
    const c = r.cells[i];
    const raw = c.dataset.v ?? c.textContent.trim();
    return type === "num" ? Number(raw) || 0 : raw;
  };
  rows.sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const cmp = type === "num" ? x - y : String(x).localeCompare(String(y), "es");
    return dir === "ascending" ? cmp : -cmp;
  });
  rows.forEach((r) => tbl.tBodies[0].appendChild(r));
  [...ths].forEach((t, k) => t.hasAttribute("aria-sort") && t.setAttribute("aria-sort", k === i ? dir : "none"));
}

function applySorts() {
  document.querySelectorAll("table[data-tid]").forEach((t) => {
    const s = state.sort[t.dataset.tid];
    if (s) sortTable(t, s.i, s.dir);
  });
}

function tick(base, running, limit) {
  return `<span class="tick" data-base="${base}" data-run="${running ? 1 : 0}" ${limit ? `data-limit="${limit}"` : ""}>${fmtDur(base)}</span>`;
}

function statusPills(s) {
  const out = [];
  if (s.onBreak) out.push(s.breakOverMs > 0 ? pill("bad", "alert", "Break excedido") : pill("warn", "coffee", "En break"));
  else out.push(pill("good", "check", "Trabajando"));
  if (s.late) out.push(pill("bad", "clock", `Tarde +${fmtDur(s.lateMs)}`));
  return out.join(" ");
}

function openTable(id, open, rules, compact = false) {
  if (!open.length) return empty("Nadie ha iniciado turno todavía.");
  const cols = [{ h: "Persona", sort: "text" }];
  if (!compact) cols.push({ h: "Inicio", sort: "num" });
  cols.push({ h: "Estado" }, { h: "Trabajado", num: true, sort: "num" }, { h: "Break", num: true, sort: "num" });
  if (!compact) cols.push({ h: "" });
  const rows = open.map((s) => {
    const r = [{ h: `<span class="who">${esc(s.name)}</span>`, v: s.name }];
    if (!compact) r.push({ h: `<span class="mono">${fmtTime(s.startedAt)}</span>`, v: s.startedAt });
    r.push(statusPills(s));
    r.push({ h: tick(s.workedMs, !s.onBreak) + (compact ? "" : ` <span class="dim">/ ${fmtDur(rules.shiftMs)}</span>`), v: s.workedMs });
    r.push({ h: tick(s.breakMs, s.onBreak, rules.breakMs) + (compact ? "" : ` <span class="dim">/ ${fmtDur(rules.breakMs)}</span>`), v: s.breakMs });
    if (!compact) {
      r.push(
        `<div class="row-actions" data-shift="${s.id}" data-name="${esc(s.name)}">` +
          `<button type="button" class="btn sm ghost act-close" data-key="close-${s.id}">${ic("stop")}Cerrar turno</button>` +
          `</div><span class="row-msg" role="alert"></span>`
      );
    }
    return r;
  });
  return table(id, "Turnos abiertos ahora", cols, rows);
}

/* ---------- Vistas ---------- */

const views = {};

/* Resumen */
views.resumen = {
  url: () => "/api/admin/summary",
  render(d) {
    const k = d.kpis;
    const planPct = d.plan.error ? null : pct(d.plan.used, d.plan.limit);
    const html = `
      ${head("Resumen", new Date(d.now).toLocaleDateString("es", { timeZone: d.tz, weekday: "long", day: "numeric", month: "long" }))}
      <div class="kpis">
        ${kpi("users", "En turno ahora", k.openNow, k.onBreakNow ? `${k.onBreakNow} en break` : "nadie en break")}
        ${kpi("clock", "Llegadas tarde hoy", k.lateToday, `de ${k.shiftsToday} turnos hoy`, { alert: k.lateToday > 0 })}
        ${kpi("coffee", "Excesos de break hoy", k.overToday, "turnos que se pasaron", { alert: k.overToday > 0 })}
        ${kpi("coins", "Créditos este mes", nf.format(k.charsMonth), `${nf.format(k.charsToday)} hoy` + (planPct != null ? ` · plan al ${pctLabel(d.plan.used, d.plan.limit)}%` : ""), { meter: planPct != null ? meter(planPct, planPct > 80) : "" })}
      </div>
      <div class="grid">
        <section class="panel col-4" aria-labelledby="h-att"><div class="head"><h2 id="h-att">Atención</h2></div><p class="sub">Lo que requiere revisión ahora</p>
          ${
            d.alerts.length
              ? `<ul class="alerts" style="list-style:none;margin:0;padding:0">${d.alerts
                  .map((a) => `<li class="alert ${a.level}">${ic("alert")}<span class="t">${esc(a.text)}</span>${a.ms ? `<span class="m">+${fmtDur(a.ms)}</span>` : ""}</li>`)
                  .join("")}</ul>`
              : empty("Todo en orden.", { ok: true })
          }
        </section>
        <section class="panel col-8" aria-labelledby="h-now"><div class="head"><h2 id="h-now">En turno ahora</h2></div><p class="sub">Los tiempos corren en vivo</p>
          ${openTable("open-r", d.open, d.rules, true)}
        </section>
      </div>
      <section class="panel" aria-labelledby="h-14"><div class="head"><h2 id="h-14">Caracteres, últimos 14 días</h2></div>
        <p class="sub">Lo generado consume créditos; lo de caché es gratis</p>
        <div class="chart"><canvas id="c-daily"></canvas></div></section>`;
    return { html, after: () => dailyChart("c-daily", d.daily) };
  },
};

/* Fichajes */
views.fichajes = {
  url: () => `/api/admin/fichajes?range=${state.range.fichajes}`,
  render(d) {
    const k = d.kpis;
    const noSched = k.unscheduled
      ? `<div class="note section">${ic("info")}<span>${k.unscheduled} persona(s) sin turno detectado: no tienen un rol Shift ni un horario personal, así que no se mide su puntualidad.</span>${state.user?.role === "admin" ? '<a href="#horarios">Ver turnos</a>' : ""}</div>`
      : "";

    const lateTbl = d.late.length
      ? table("late", "Llegadas tarde", [{ h: "Persona", sort: "text" }, { h: "Turno", sort: "text" }, { h: "Día", sort: "num" }, { h: "Esperado" }, { h: "Llegó" }, { h: "Retraso", num: true, sort: "num" }],
          d.late.map((s) => [
            `<span class="who">${esc(s.name)}</span>`,
            { h: s.templateName ? esc(s.templateName) : `<span class="dim">${s.scheduleStart ? "Personal" : "—"}</span>`, v: s.templateName || "" },
            { h: `<span class="dim">${fmtDay(s.startedAt)}</span>`, v: s.startedAt },
            `<span class="mono">${fmtTime(s.expectedAt)}</span>`,
            `<span class="mono">${fmtTime(s.startedAt)}</span>`,
            { h: pill("bad", "clock", `+${fmtDur(s.lateMs)}`), v: s.lateMs },
          ]), { scroll: true })
      : empty(k.shifts ? "Nadie llegó tarde en este periodo." : "Sin turnos en este periodo.", { ok: k.shifts > 0 });

    const overTbl = d.overruns.length
      ? table("over", "Excesos de break", [{ h: "Persona", sort: "text" }, { h: "Día", sort: "num" }, { h: "Break" }, { h: "Duración", num: true, sort: "num" }, { h: "Exceso", num: true, sort: "num" }],
          d.overruns.map((s) => {
            const b = s.breaks[0];
            return [
              `<span class="who">${esc(s.name)}</span>`,
              { h: `<span class="dim">${fmtDay(s.startedAt)}</span>`, v: s.startedAt },
              `<span class="mono">${b ? `${fmtTime(b.startedAt)}–${b.endedAt ? fmtTime(b.endedAt) : "…"}` : "—"}</span>`,
              { h: fmtDur(s.breakMs), v: s.breakMs },
              { h: pill("bad", "coffee", `+${fmtDur(s.breakOverMs)}`), v: s.breakOverMs },
            ];
          }), { scroll: true })
      : empty(k.shifts ? "Nadie se pasó del break." : "Sin turnos en este periodo.", { ok: k.shifts > 0 });

    const peopleTbl = d.people.length
      ? table("people", "Resumen por persona", [{ h: "Persona", sort: "text" }, { h: "Turnos", num: true, sort: "num" }, { h: "Tardes", num: true, sort: "num" }, { h: "Min. tarde", num: true, sort: "num" }, { h: "Excesos", num: true, sort: "num" }, { h: "Min. exceso", num: true, sort: "num" }, { h: "Trabajado", num: true, sort: "num" }],
          d.people.map((p) => [
            { h: `<span class="who">${esc(p.name)}</span>`, v: p.name },
            p.shifts,
            { h: p.lateCount ? pill("bad", null, String(p.lateCount)) : '<span class="dim">0</span>', v: p.lateCount },
            { h: p.lateCount ? fmtDur(p.lateMs) : "—", v: p.lateMs },
            { h: p.overCount ? pill("bad", null, String(p.overCount)) : '<span class="dim">0</span>', v: p.overCount },
            { h: p.overCount ? fmtDur(p.overMs) : "—", v: p.overMs },
            { h: fmtDur(p.workedMs), v: p.workedMs },
          ]))
      : empty("Sin datos.");

    const histTbl = d.history.length
      ? table("hist", "Historial de turnos", [{ h: "Persona", sort: "text" }, { h: "Inicio", sort: "num" }, { h: "Fin", sort: "num" }, { h: "Trabajado", num: true, sort: "num" }, { h: "Break", num: true, sort: "num" }, { h: "Marcas" }],
          d.history.slice(0, 150).map((s) => {
            const marks = [];
            if (s.late) marks.push(pill("bad", "clock", `Tarde +${fmtDur(s.lateMs)}`));
            if (s.breakOverMs) marks.push(pill("bad", "coffee", `Break +${fmtDur(s.breakOverMs)}`));
            if (!s.endedAt) marks.push(pill("warn", "clock", "Abierto"));
            return [
              `<span class="who">${esc(s.name)}</span>`,
              { h: `<span class="mono">${fmtDT(s.startedAt)}</span>`, v: s.startedAt },
              { h: `<span class="mono">${s.endedAt ? fmtDT(s.endedAt) : "—"}</span>`, v: s.endedAt || 0 },
              { h: fmtDur(s.workedMs), v: s.workedMs },
              { h: fmtDur(s.breakMs), v: s.breakMs },
              marks.join(" ") || pill("good", "check", "OK"),
            ];
          }), { scroll: true })
      : empty("Sin turnos en este periodo.");

    const html = `
      ${head("Fichajes", "Puntualidad, breaks y horas trabajadas", rangeSeg("fichajes"))}
      ${noSched}
      <div class="kpis">
        ${kpi("users", "Turnos", nf.format(k.shifts), `${k.people} personas`)}
        ${kpi("clock", "Llegadas tarde", nf.format(k.lateCount), k.lateCount ? `${fmtDur(k.lateMs)} acumulados` : "puntualidad perfecta", { alert: k.lateCount > 0 })}
        ${kpi("coffee", "Excesos de break", nf.format(k.overCount), k.overCount ? `${fmtDur(k.overMs)} acumulados` : "ninguno", { alert: k.overCount > 0 })}
        ${kpi("check", "Trabajo promedio", k.avgWorkedMs ? fmtDur(k.avgWorkedMs) : "—", "por turno cerrado")}
      </div>
      <section class="panel section" aria-labelledby="h-live"><div class="head"><h2 id="h-live">En vivo</h2></div><p class="sub">Turnos abiertos ahora mismo</p>${openTable("open-f", d.open, d.rules)}</section>
      <div class="grid">
        <section class="panel col-6" aria-labelledby="h-late"><div class="head"><h2 id="h-late">Llegaron tarde</h2></div><p class="sub">Frente al horario configurado, tras los minutos de gracia</p>${lateTbl}</section>
        <section class="panel col-6" aria-labelledby="h-over"><div class="head"><h2 id="h-over">Se pasaron del break</h2></div><p class="sub">Límite: ${fmtDur(d.rules.breakMs)} por turno</p>${overTbl}</section>
      </div>
      <div class="grid">
        <section class="panel col-8" aria-labelledby="h-ppl"><div class="head"><h2 id="h-ppl">Por persona</h2></div><p class="sub">Ordena por cualquier columna</p>${peopleTbl}</section>
        <section class="panel col-4" aria-labelledby="h-inc"><div class="head"><h2 id="h-inc">Incidencias</h2></div><p class="sub">Tardes y excesos por persona</p>
          <div class="chart tall"><canvas id="c-people"></canvas></div></section>
      </div>
      <section class="panel" aria-labelledby="h-hist"><div class="head"><h2 id="h-hist">Historial de turnos</h2></div><p class="sub">Más recientes primero${d.history.length > 150 ? " (se muestran 150)" : ""}</p>${histTbl}</section>`;

    return {
      html,
      after() {
        const top = d.people.filter((p) => p.lateCount || p.overCount).slice(0, 10);
        if (!top.length) return;
        hbar("c-people", "Incidencias por persona: llegadas tarde y excesos de break", top.map((p) => p.name), [
          { label: "Llegadas tarde", data: top.map((p) => p.lateCount), backgroundColor: COL.danger },
          { label: "Excesos de break", data: top.map((p) => p.overCount), backgroundColor: hatch(RGB.cost), borderColor: COL.cost, borderWidth: 1 },
        ], true);
      },
    };
  },
};

/* ElevenLabs */
views.elevenlabs = {
  url: () => `/api/admin/elevenlabs?range=${state.range.elevenlabs}`,
  render(d) {
    const t = d.totals;
    const plan = d.plan;
    const hitRate = pct(t.cacheHits, t.cacheHits + t.generations);
    const totalChars = d.voices.reduce((a, v) => a + v.chars, 0);
    const proj = d.month;
    const projPct = plan.error ? null : pct(proj.projected, plan.limit);

    const planCard = plan.error
      ? `<section class="panel col-4" aria-labelledby="h-plan"><div class="head"><h2 id="h-plan">Créditos del plan</h2></div><p class="sub">No se pudo leer ElevenLabs</p>${empty(plan.error)}</section>`
      : `<section class="panel col-4" aria-labelledby="h-plan"><div class="head"><h2 id="h-plan">Créditos del plan</h2></div>
          <p class="sub">Plan ${esc(plan.tier)} · ${plan.resetAt ? `Se renuevan el ${new Date(plan.resetAt).toLocaleDateString("es", { day: "numeric", month: "long" })}` : "Saldo reportado por ElevenLabs"}</p>
          <div class="donut"><canvas id="c-plan"></canvas><div class="center"><b>${pctLabel(plan.used, plan.limit)}%</b><span>usado</span></div></div>
          <div class="legend"><span><i style="background:var(--cost)"></i>Usado ${nf.format(plan.used)}</span><span><i style="background:var(--surface-2);border:1px solid var(--border-control)"></i>Disponible ${nf.format(plan.limit - plan.used)}</span></div></section>`;

    const projCard = `<section class="panel col-4" aria-labelledby="h-proj"><div class="head"><h2 id="h-proj">Proyección del mes</h2></div>
        <p class="sub">Al ritmo actual de este sistema</p>
        <div class="mono" style="font-size:2.25rem;letter-spacing:-.04em;line-height:1.1">${nf.format(proj.projected)}</div>
        <p class="dim" style="margin-top:4px">caracteres a fin de mes${projPct != null ? ` · ${pctLabel(proj.projected, plan.limit)}% del plan` : ""}</p>
        ${projPct != null ? meter(projPct, projPct > 90) : ""}
        <p class="dim" style="margin-top:var(--sp-3);font-size:var(--fs-sm)">Llevas <b class="mono">${nf.format(proj.chars)}</b> en ${proj.day} de ${proj.daysInMonth} días.</p>
        ${plan.error ? "" : `<p class="dim" style="margin-top:var(--sp-2);font-size:var(--fs-sm)">Voces clonadas en la cuenta: <b class="mono">${plan.voiceSlotsUsed}</b> de ${plan.voiceLimit} · profesionales: <b class="mono">${plan.proSlotsUsed}</b> de ${plan.proLimit}</p>`}</section>`;

    const cacheCard = `<section class="panel col-4" aria-labelledby="h-cache"><div class="head"><h2 id="h-cache">Caché</h2></div><p class="sub">Audios reutilizados sin pagar</p>
        <div class="donut"><canvas id="c-cache"></canvas><div class="center"><b>${hitRate}%</b><span>desde caché</span></div></div>
        <div class="legend"><span><i style="background:var(--cost)"></i>Generados ${nf.format(t.generations)}</span><span><i class="hatch"></i>De caché ${nf.format(t.cacheHits)}</span></div>
        <p class="dim" style="text-align:center;margin-top:var(--sp-2);font-size:var(--fs-sm)"><b class="mono">${nf.format(t.saved)}</b> créditos ahorrados</p></section>`;

    const voiceTbl = d.voices.some((v) => v.generations || v.cacheHits)
      ? table("voices", "Detalle por voz", [{ h: "#" }, { h: "Voz", sort: "text" }, { h: "" }, { h: "Audios", num: true, sort: "num" }, { h: "Créditos", num: true, sort: "num" }, { h: "% del gasto", num: true, sort: "num" }, { h: "Caché", num: true, sort: "num" }, { h: "Ahorro", num: true, sort: "num" }, { h: "Último uso", sort: "num" }],
          d.voices.map((v, i) => {
            const share = pct(v.chars, totalChars);
            const last = v.lastUsed ? new Date(v.lastUsed.replace(" ", "T") + "Z").getTime() : 0;
            return [
              `<span class="dim mono">${i + 1}</span>`,
              { h: `<span class="who">${esc(v.name)}</span> ${v.active ? "" : pill("", null, "inactiva")}`, v: v.name },
              `<div class="bar-cell"><i style="width:${share}%"></i></div>`,
              { h: nf.format(v.generations), v: v.generations },
              { h: nf.format(v.chars), v: v.chars },
              { h: `${share}%`, v: share },
              { h: nf.format(v.cacheHits), v: v.cacheHits },
              { h: nf.format(v.saved), v: v.saved },
              { h: `<span class="dim mono">${last ? fmtDT(last) : "—"}</span>`, v: last },
            ];
          }))
      : empty("Aún no hay audios generados en este periodo. Aparecerán aquí cuando los chatters usen /voz o /frase.");

    const phraseTbl = d.topPhrases.length
      ? table("phrases", "Frases más reutilizadas", [{ h: "Frase", cls: "wrap" }, { h: "Voz", sort: "text" }, { h: "Veces", num: true, sort: "num" }, { h: "Ahorro", num: true, sort: "num" }],
          d.topPhrases.map((p) => [
            { h: esc(p.text.length > 70 ? p.text.slice(0, 70) + "…" : p.text), v: p.text },
            `<span class="dim">${esc(p.model)}</span>`,
            { h: nf.format(p.hits), v: p.hits },
            { h: nf.format(p.saved), v: p.saved },
          ]), { scroll: true })
      : empty("Aún no hay frases reutilizadas.");

    const own = d.accountVoices.filter((v) => v.category !== "premade" || v.assignedTo);
    const hiddenLib = d.accountVoices.length - own.length;
    const acctTbl = d.accountVoices.length
      ? (own.length
          ? table("acct", "Voces de la cuenta de ElevenLabs", [{ h: "Voz en ElevenLabs", sort: "text" }, { h: "Tipo", sort: "text" }, { h: "Asignada a", sort: "text" }, { h: "Creada", sort: "num" }],
              own.map((v) => [
                { h: `<span class="who">${esc(v.name)}</span>`, v: v.name },
                { h: pill(v.category === "premade" ? "" : "good", null, v.category), v: v.category },
                { h: v.assignedTo ? esc(v.assignedTo) : '<span class="dim">sin asignar</span>', v: v.assignedTo || "" },
                { h: `<span class="dim mono">${v.createdAt ? fmtDay(v.createdAt) : "—"}</span>`, v: v.createdAt || 0 },
              ]))
          : empty("Aún no hay voces clonadas en la cuenta. Clona la de cada modelo en ElevenLabs y asígnala en models.json.")) +
        (hiddenLib ? `<p class="dim" style="margin-top:var(--sp-3);font-size:var(--fs-sm)">${hiddenLib} voces genéricas de la biblioteca de ElevenLabs no se listan.</p>` : "")
      : empty("No se pudo leer la lista de voces de la cuenta.");

    const html = `
      ${head("ElevenLabs", "Créditos, voces y ahorro por caché", rangeSeg("elevenlabs"))}
      <div class="kpis">
        ${kpi("coins", "Créditos gastados", nf.format(t.generated), `en el periodo · ${nf.format(t.generations)} audios`)}
        ${kpi("check", "Ahorro por caché", nf.format(t.saved), `${nf.format(t.cacheHits)} audios reutilizados`)}
        ${kpi("chart", "Tasa de caché", `${hitRate}<small>%</small>`, "audios que salieron gratis")}
        ${kpi("mic", "Voces activas", d.voices.filter((v) => v.active).length, `${d.voices.filter((v) => v.generations).length} usadas en el periodo`)}
      </div>
      <div class="grid">${planCard}${projCard}${cacheCard}</div>
      <section class="panel section" aria-labelledby="h-daily"><div class="head"><h2 id="h-daily">Consumo diario</h2></div><p class="sub">Caracteres por día, en hora local</p>
        <div class="chart"><canvas id="c-daily"></canvas></div></section>
      <div class="grid">
        <section class="panel col-6" aria-labelledby="h-cum"><div class="head"><h2 id="h-cum">Acumulado del mes</h2></div><p class="sub">Créditos gastados desde el día 1, con proyección</p>
          <div class="chart"><canvas id="c-cum"></canvas></div></section>
        <section class="panel col-6" aria-labelledby="h-vc"><div class="head"><h2 id="h-vc">Voces más usadas</h2></div><p class="sub">Créditos gastados por voz</p>
          <div class="chart"><canvas id="c-voices"></canvas></div></section>
      </div>
      <section class="panel section" aria-labelledby="h-vd"><div class="head"><h2 id="h-vd">Detalle por voz</h2></div><p class="sub">Ordena por cualquier columna</p>${voiceTbl}</section>
      <div class="grid">
        <section class="panel col-6" aria-labelledby="h-ch"><div class="head"><h2 id="h-ch">Consumo por chatter</h2></div><p class="sub">Créditos gastados por persona</p>
          <div class="chart"><canvas id="c-chat"></canvas></div></section>
        <section class="panel col-6" aria-labelledby="h-ph"><div class="head"><h2 id="h-ph">Frases más reutilizadas</h2></div><p class="sub">Histórico: donde la caché más ahorra</p>${phraseTbl}</section>
      </div>
      <section class="panel" aria-labelledby="h-ac"><div class="head"><h2 id="h-ac">Voces de la cuenta</h2></div><p class="sub">Clonadas y profesionales, y a qué modelo están asignadas</p>${acctTbl}</section>`;

    return {
      html,
      after() {
        dailyChart("c-daily", d.daily);
        if (!plan.error) doughnut("c-plan", "Créditos del plan: usados frente a disponibles", ["Usado", "Disponible"], [plan.used, Math.max(0, plan.limit - plan.used)], [COL.cost, "#272f42"]);
        doughnut("c-cache", "Audios generados frente a reutilizados desde caché", ["Generados", "De caché"], [t.generations, t.cacheHits], [COL.cost, hatch(RGB.saved)]);

        // Acumulado + proyección punteada hasta fin de mes.
        const labels = d.cumulative.map((x) => shortDay(x.day));
        const lastIso = d.cumulative[d.cumulative.length - 1].day;
        for (let n = 1; labels.length < proj.daysInMonth; n++) labels.push(shortDay(addDays(lastIso, n)));
        const today = d.cumulative.length - 1;
        const projected = labels.map(() => null);
        projected[today] = d.cumulative[today].total;
        projected[labels.length - 1] = proj.projected;
        mk("c-cum", {
          type: "line",
          data: {
            labels,
            datasets: [
              { label: "Acumulado", data: d.cumulative.map((x) => x.total), borderColor: COL.cost, backgroundColor: `rgba(${RGB.cost},.18)`, fill: true, tension: 0.25, pointRadius: 0, pointHoverRadius: 4 },
              { label: "Proyección", data: projected, borderColor: COL.info, borderDash: [6, 5], pointRadius: 0, pointHoverRadius: 4, spanGaps: true },
            ],
          },
          options: baseOpts({
            scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } }, y: { beginAtZero: true, ticks: { callback: (v) => nf.format(v) } } },
          }),
        }, "Créditos acumulados del mes con proyección a fin de mes");

        const used = d.voices.filter((v) => v.chars > 0).slice(0, 10);
        if (used.length) hbar("c-voices", "Créditos gastados por voz", used.map((v) => v.name), [{ label: "Créditos", data: used.map((v) => v.chars), backgroundColor: COL.cost }]);
        const ch = d.chatters.filter((c) => c.chars > 0).slice(0, 10);
        if (ch.length) hbar("c-chat", "Créditos gastados por chatter", ch.map((c) => c.name), [{ label: "Créditos", data: ch.map((c) => c.chars), backgroundColor: COL.info }]);
      },
    };
  },
};

/* Cuentas (solo administradores) */
views.cuentas = {
  url: () => "/api/admin/users",
  render(d) {
    const rows = d.users.map((u) => [
      { h: `<span class="who">${esc(u.displayName)}</span>`, v: u.displayName },
      { h: `<span class="dim mono">${esc(u.username)}</span>`, v: u.username },
      {
        h:
          u.role === "admin"
            ? pill("good", "shield", "Administrador")
            : pill("", null, "Manager"),
        v: u.role,
      },
      { h: u.active ? pill("good", "check", "Activa") : pill("warn", "alert", "Desactivada"), v: u.active },
      { h: `<span class="dim mono">${u.lastLoginAt ? esc(u.lastLoginAt.slice(0, 16)) : "nunca"}</span>`, v: u.lastLoginAt || "" },
      `<div class="row-actions" data-user="${u.id}" data-name="${esc(u.displayName)}" data-role="${u.role}" data-active="${u.active}" data-self="${u.id === state.user?.id}">` +
        `<button type="button" class="btn sm ghost act-pass" data-key="pass-${u.id}">${ic("key")}Contraseña</button>` +
        `<button type="button" class="btn sm ghost act-role" data-key="role-${u.id}">${u.role === "admin" ? "Hacer manager" : "Hacer admin"}</button>` +
        `<button type="button" class="btn sm ghost act-active" data-key="act-${u.id}">${u.active ? "Desactivar" : "Activar"}</button>` +
        `<button type="button" class="btn sm danger act-del" data-key="del-${u.id}">${ic("trash")}Borrar</button>` +
        `</div><span class="row-msg" role="alert"></span>`,
    ]);

    const html = `
      ${head("Cuentas", "Quién puede entrar al panel y con qué permisos")}
      <div class="note section">${ic("info")}<span><b>Administrador</b>: todo, incluidas cuentas y horarios. <b>Manager</b>: ve el panel y cierra turnos abiertos, pero no cambia cuentas ni horarios.</span></div>
      <section class="panel section" aria-labelledby="h-us"><div class="head"><h2 id="h-us">Personas con acceso</h2></div>
        <p class="sub">Siempre debe quedar al menos un administrador activo.</p>
        ${table("users", "Cuentas del panel", [{ h: "Nombre", sort: "text" }, { h: "Usuario", sort: "text" }, { h: "Rol", sort: "text" }, { h: "Estado", sort: "text" }, { h: "Última entrada", sort: "text" }, { h: "" }], rows)}</section>
      <section class="panel section" aria-labelledby="h-new"><div class="head"><h2 id="h-new">Crear cuenta</h2></div>
        <p class="sub">Dale la contraseña a la persona por un canal privado. Puede cambiarla desde Mi cuenta.</p>
        <form id="userForm" class="row-form" novalidate>
          <div class="field"><label for="u-name">Nombre</label><input id="u-name" name="displayName" maxlength="80" autocomplete="off" aria-describedby="err-displayName" /><p class="field-error" id="err-displayName" role="alert"></p></div>
          <div class="field"><label for="u-user">Usuario</label><input id="u-user" name="username" class="mono" autocomplete="off" aria-describedby="err-username" /><p class="field-error" id="err-username" role="alert"></p></div>
          <div class="field"><label for="u-pass">Contraseña</label><input id="u-pass" name="password" type="text" class="mono" autocomplete="off" aria-describedby="err-password" /><p class="field-error" id="err-password" role="alert"></p></div>
          <div class="field"><label for="u-role">Rol</label><select id="u-role" name="role"><option value="manager">Manager</option><option value="admin">Administrador</option></select></div>
          <button class="btn primary" type="submit">${ic("plus")}Crear</button>
        </form></section>
      <section class="panel" aria-labelledby="h-mine"><div class="head"><h2 id="h-mine">Mi cuenta</h2></div>
        <p class="sub">Cambia tu propia contraseña.</p>
        <form id="passForm" class="row-form" novalidate>
          <div class="field"><label for="p-cur">Contraseña actual</label><input id="p-cur" name="current" type="password" autocomplete="current-password" aria-describedby="err-current" /><p class="field-error" id="err-current" role="alert"></p></div>
          <div class="field"><label for="p-new">Contraseña nueva</label><input id="p-new" name="newPassword" type="password" autocomplete="new-password" aria-describedby="err-newPassword" /><p class="field-error" id="err-newPassword" role="alert"></p></div>
          <button class="btn primary" type="submit">Cambiar</button>
        </form></section>`;
    return { html, after() {} };
  },
};

/* Cuentas (solo administradores) */
views.cuentas = {
  url: () => "/api/admin/users",
  render(d) {
    const rows = d.users.map((u) => [
      { h: `<span class="who">${esc(u.displayName)}</span>`, v: u.displayName },
      { h: `<span class="dim mono">${esc(u.username)}</span>`, v: u.username },
      {
        h:
          u.role === "admin"
            ? pill("good", "shield", "Administrador")
            : pill("", null, "Manager"),
        v: u.role,
      },
      { h: u.active ? pill("good", "check", "Activa") : pill("warn", "alert", "Desactivada"), v: u.active },
      { h: `<span class="dim mono">${u.lastLoginAt ? esc(u.lastLoginAt.slice(0, 16)) : "nunca"}</span>`, v: u.lastLoginAt || "" },
      `<div class="row-actions" data-user="${u.id}" data-name="${esc(u.displayName)}" data-role="${u.role}" data-active="${u.active}" data-self="${u.id === state.user?.id}">` +
        `<button type="button" class="btn sm ghost act-pass" data-key="pass-${u.id}">${ic("key")}Contraseña</button>` +
        `<button type="button" class="btn sm ghost act-role" data-key="role-${u.id}">${u.role === "admin" ? "Hacer manager" : "Hacer admin"}</button>` +
        `<button type="button" class="btn sm ghost act-active" data-key="act-${u.id}">${u.active ? "Desactivar" : "Activar"}</button>` +
        `<button type="button" class="btn sm danger act-del" data-key="del-${u.id}">${ic("trash")}Borrar</button>` +
        `</div><span class="row-msg" role="alert"></span>`,
    ]);

    const html = `
      ${head("Cuentas", "Quién puede entrar al panel y con qué permisos")}
      <div class="note section">${ic("info")}<span><b>Administrador</b>: todo, incluidas cuentas y horarios. <b>Manager</b>: ve el panel y cierra turnos abiertos, pero no cambia cuentas ni horarios.</span></div>
      <section class="panel section" aria-labelledby="h-us"><div class="head"><h2 id="h-us">Personas con acceso</h2></div>
        <p class="sub">Siempre debe quedar al menos un administrador activo.</p>
        ${table("users", "Cuentas del panel", [{ h: "Nombre", sort: "text" }, { h: "Usuario", sort: "text" }, { h: "Rol", sort: "text" }, { h: "Estado", sort: "text" }, { h: "Última entrada", sort: "text" }, { h: "" }], rows)}</section>
      <section class="panel section" aria-labelledby="h-new"><div class="head"><h2 id="h-new">Crear cuenta</h2></div>
        <p class="sub">Dale la contraseña a la persona por un canal privado. Puede cambiarla desde Mi cuenta.</p>
        <form id="userForm" class="row-form" novalidate>
          <div class="field"><label for="u-name">Nombre</label><input id="u-name" name="displayName" maxlength="80" autocomplete="off" aria-describedby="err-displayName" /><p class="field-error" id="err-displayName" role="alert"></p></div>
          <div class="field"><label for="u-user">Usuario</label><input id="u-user" name="username" class="mono" autocomplete="off" aria-describedby="err-username" /><p class="field-error" id="err-username" role="alert"></p></div>
          <div class="field"><label for="u-pass">Contraseña</label><input id="u-pass" name="password" type="text" class="mono" autocomplete="off" aria-describedby="err-password" /><p class="field-error" id="err-password" role="alert"></p></div>
          <div class="field"><label for="u-role">Rol</label><select id="u-role" name="role"><option value="manager">Manager</option><option value="admin">Administrador</option></select></div>
          <button class="btn primary" type="submit">${ic("plus")}Crear</button>
        </form></section>
      <section class="panel" aria-labelledby="h-mine"><div class="head"><h2 id="h-mine">Mi cuenta</h2></div>
        <p class="sub">Cambia tu propia contraseña.</p>
        <form id="passForm" class="row-form" novalidate>
          <div class="field"><label for="p-cur">Contraseña actual</label><input id="p-cur" name="current" type="password" autocomplete="current-password" aria-describedby="err-current" /><p class="field-error" id="err-current" role="alert"></p></div>
          <div class="field"><label for="p-new">Contraseña nueva</label><input id="p-new" name="newPassword" type="password" autocomplete="new-password" aria-describedby="err-newPassword" /><p class="field-error" id="err-newPassword" role="alert"></p></div>
          <button class="btn primary" type="submit">Cambiar</button>
        </form></section>`;
    return { html, after() {} };
  },
};

/* Horarios: turnos fijos por rol de Discord + excepciones por persona */
views.horarios = {
  url: () => "/api/admin/schedules",
  render(d) {
    const tplRows = d.templates.map((t) => {
      const tid = esc(t.id);
      return [
        `<label class="sr-only" for="tn-${tid}">Nombre del turno</label>
         <input id="tn-${tid}" class="f-tname" value="${esc(t.name)}" maxlength="40" style="width:160px" autocomplete="off" />`,
        `<label class="sr-only" for="ts-${tid}">Hora de entrada de ${esc(t.name)} (24 horas)</label>
         <input id="ts-${tid}" class="mono f-tstart" type="text" inputmode="numeric" maxlength="5" placeholder="HH:MM" value="${esc(t.startTime)}" style="width:96px" autocomplete="off" />`,
        `<label class="sr-only" for="tg-${tid}">Minutos de gracia de ${esc(t.name)}</label>
         <input id="tg-${tid}" class="mono narrow f-tgrace" type="number" min="0" max="240" value="${esc(t.graceMin)}" />`,
        `<div class="row-actions" data-tpl="${tid}" data-name="${esc(t.name)}">
           <button type="button" class="btn sm primary act-tsave" data-key="tsave-${tid}">Guardar</button>
           <button type="button" class="btn sm danger act-tdel" data-key="tdel-${tid}">${ic("trash")}Borrar</button>
         </div><span class="row-msg" role="alert"></span>`,
      ];
    });
    const tplTbl = d.templates.length
      ? table("tpl", "Turnos fijos", [{ h: "Turno" }, { h: "Entrada (24 h)" }, { h: "Gracia (min)" }, { h: "" }], tplRows)
      : empty("No hay turnos. Crea el primero con el formulario de abajo.");

    const rows = d.people.map((p) => {
      const sid = esc(p.discordId);
      return [
        { h: `<span class="who">${esc(p.name)}</span>`, v: p.name },
        `<span class="dim mono">${sid}</span>`,
        { h: p.lastTemplate ? pill("", null, p.lastTemplate) : '<span class="dim">sin detectar</span>', v: p.lastTemplate || "" },
        `<label class="sr-only" for="start-${sid}">Horario personal de ${esc(p.name)} (24 horas)</label>
         <input id="start-${sid}" class="mono f-start" type="text" inputmode="numeric" maxlength="5" placeholder="HH:MM" value="${esc(p.start || "")}" style="width:96px" autocomplete="off" />`,
        `<label class="sr-only" for="grace-${sid}">Minutos de gracia de ${esc(p.name)}</label>
         <input id="grace-${sid}" class="mono narrow f-grace" type="number" min="0" max="240" value="${p.graceMin ?? d.defaultGrace}" />`,
        `<div class="row-actions" data-id="${sid}" data-name="${esc(p.name)}">
           <button type="button" class="btn sm primary act-save" data-key="save-${sid}">Guardar</button>
           ${p.start ? `<button type="button" class="btn sm danger act-clear" data-key="clear-${sid}">Quitar</button>` : ""}
         </div><span class="row-msg" role="alert"></span>`,
      ];
    });
    const tbl = d.people.length
      ? table("sched", "Excepciones por persona", [{ h: "Persona", sort: "text" }, { h: "Discord ID" }, { h: "Turno detectado", sort: "text" }, { h: "Horario personal" }, { h: "Gracia (min)" }, { h: "" }], rows)
      : empty("Todavía nadie ha fichado.");

    const html = `
      ${head("Horarios", `Hora de entrada esperada · ${esc(d.tzLabel)} (<b class="mono">${esc(d.tz)}</b>)`)}

      <div class="note section">${ic("info")}<span>Cada persona se asigna sola al pulsar <b>Start</b>, según su rol de Discord: el rol debe <b>contener el nombre del turno</b>. Por ejemplo, el rol <b>Shift 2 (Chatter)</b> pertenece al turno <b>Shift 2</b>. No hay que configurar a nadie uno por uno.</span></div>

      <section class="panel section" aria-labelledby="h-tpl"><div class="head"><h2 id="h-tpl">Turnos</h2></div>
        <p class="sub">Hora de entrada de cada turno. Se mide la puntualidad frente a esta hora, más los minutos de gracia. Cambiar un turno no modifica los fichajes ya hechos.</p>
        ${tplTbl}</section>

      <section class="panel section" aria-labelledby="h-newtpl"><div class="head"><h2 id="h-newtpl">Agregar turno</h2></div>
        <form id="tplForm" class="row-form" novalidate>
          <div class="field"><label for="tp-name">Nombre</label><input id="tp-name" name="tplName" maxlength="40" autocomplete="off" aria-describedby="err-tplName" /><p class="field-error" id="err-tplName" role="alert"></p></div>
          <div class="field"><label for="tp-start">Entrada (24 h)</label><input id="tp-start" name="tplStart" class="mono" style="width:120px" inputmode="numeric" maxlength="5" placeholder="HH:MM" autocomplete="off" aria-describedby="err-tplStart" /><p class="field-error" id="err-tplStart" role="alert"></p></div>
          <div class="field"><label for="tp-grace">Gracia (min)</label><input id="tp-grace" name="tplGrace" class="mono narrow" type="number" min="0" max="240" value="${d.defaultGrace}" aria-describedby="err-tplGrace" /><p class="field-error" id="err-tplGrace" role="alert"></p></div>
          <button class="btn primary" type="submit">${ic("plus")}Agregar turno</button>
        </form></section>

      <section class="panel section" aria-labelledby="h-sch"><div class="head"><h2 id="h-sch">Excepciones por persona</h2></div>
        <p class="sub">Solo para quien no sigue su turno. Un horario personal tiene prioridad sobre el turno del rol. Aparecen quienes ya han usado Start.</p>
        ${tbl}</section>

      <section class="panel" aria-labelledby="h-add"><div class="head"><h2 id="h-add">Agregar excepción</h2></div>
        <p class="sub">Para alguien que aún no ha fichado. En Discord, con el modo desarrollador activo: clic derecho sobre el usuario y Copiar ID.</p>
        <form id="addForm" class="row-form" novalidate>
          <div class="field"><label for="f-name">Nombre</label><input id="f-name" name="name" maxlength="80" autocomplete="off" aria-describedby="err-name" /><p class="field-error" id="err-name" role="alert"></p></div>
          <div class="field"><label for="f-id">Discord ID</label><input id="f-id" name="discordId" class="mono" inputmode="numeric" autocomplete="off" aria-describedby="err-discordId" /><p class="field-error" id="err-discordId" role="alert"></p></div>
          <div class="field"><label for="f-start">Entrada (24 h)</label><input id="f-start" name="start" class="mono" style="width:120px" inputmode="numeric" maxlength="5" placeholder="HH:MM" autocomplete="off" aria-describedby="err-start" /><p class="field-error" id="err-start" role="alert"></p></div>
          <div class="field"><label for="f-grace">Gracia (min)</label><input id="f-grace" name="grace" class="mono narrow" type="number" min="0" max="240" value="${d.defaultGrace}" aria-describedby="err-grace" /><p class="field-error" id="err-grace" role="alert"></p></div>
          <button class="btn primary" type="submit">${ic("plus")}Agregar</button>
        </form></section>`;
    return { html, after() {} };
  },
};

/* ---------- Validación de formularios (en línea) ---------- */

function normalizeTime(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : v.trim();
}
const RULES = {
  tplName: (v) => (v.trim() ? (v.trim().length <= 40 ? "" : "Máximo 40 caracteres.") : "Escribe el nombre del turno."),
  tplStart: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(normalizeTime(v)) ? "" : "Usa el formato de 24 horas, por ejemplo 05:00."),
  tplGrace: (v) => (Number.isInteger(Number(v)) && v !== "" && Number(v) >= 0 && Number(v) <= 240 ? "" : "Un número entre 0 y 240."),
  displayName: (v) => (v.trim() ? "" : "Escribe el nombre de la persona."),
  username: (v) => (/^[a-zA-Z0-9._-]{3,32}$/.test(v.trim()) ? "" : "Entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo."),
  password: (v) => (v.length >= 10 ? "" : "Al menos 10 caracteres."),
  current: (v) => (v ? "" : "Escribe tu contraseña actual."),
  newPassword: (v) => (v.length >= 10 ? "" : "Al menos 10 caracteres."),
  displayName: (v) => (v.trim() ? "" : "Escribe el nombre de la persona."),
  username: (v) => (/^[a-zA-Z0-9._-]{3,32}$/.test(v.trim()) ? "" : "Entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo."),
  password: (v) => (v.length >= 10 ? "" : "Al menos 10 caracteres."),
  current: (v) => (v ? "" : "Escribe tu contraseña actual."),
  newPassword: (v) => (v.length >= 10 ? "" : "Al menos 10 caracteres."),
  name: (v) => (v.trim() ? "" : "Escribe el nombre de la persona."),
  discordId: (v) => (/^\d{5,25}$/.test(v.trim()) ? "" : "El ID de Discord tiene entre 5 y 25 dígitos."),
  start: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(normalizeTime(v)) ? "" : "Usa el formato de 24 horas, por ejemplo 14:30."),
  grace: (v) => (Number.isInteger(Number(v)) && v !== "" && Number(v) >= 0 && Number(v) <= 240 ? "" : "Un número entre 0 y 240."),
};
function setError(input, msg) {
  const out = document.getElementById(`err-${input.name}`);
  input.setAttribute("aria-invalid", msg ? "true" : "false");
  if (out) out.innerHTML = msg ? `${ic("alert")}<span>${esc(msg)}</span>` : "";
  return msg;
}

/* ---------- Orquestación ---------- */

const focusKey = (el) => (el && (el.id || (el.dataset && el.dataset.key))) || null;

function renderStatusbar() {
  const bar = $("#statusbar");
  if (state.route === "horarios") {
    bar.innerHTML = "";
    return;
  }
  bar.innerHTML = `<span class="live on" id="live"><span class="dot" aria-hidden="true"></span><span id="live-text">Cargando…</span></span>
    <button type="button" class="btn ghost sm" id="btn-pause" aria-pressed="${state.paused}" data-key="btn-pause">${ic(state.paused ? "play" : "pause")}<span>${state.paused ? "Reanudar" : "Pausar"}</span></button>
    <button type="button" class="btn ghost sm" id="btn-refresh" data-key="btn-refresh">${ic("refresh")}Actualizar</button>`;
  updateLive();
}

function updateLive() {
  const el = $("#live");
  if (!el) return;
  const age = Date.now() - state.lastOk;
  const stale = !state.paused && state.lastOk > 0 && age > STALE_MS;
  const when = state.lastOk ? fmtTime(state.lastOk) : "—";
  let text = `En vivo · actualizado ${when}`;
  let cls = "live on";
  if (state.loading) text = "Actualizando…";
  else if (state.paused) { text = `Pausado · actualizado ${when}`; cls = "live paused"; }
  else if (stale) { text = `Sin actualizar desde ${when}`; cls = "live stale"; }
  if (el.className !== cls) el.className = cls;
  const t = $("#live-text");
  if (t.textContent !== text) t.textContent = text;
  if (stale !== state.stale) {
    state.stale = stale;
    if (stale) announce("No se pudieron actualizar los datos. Se muestran los últimos recibidos.");
  }
}

function scheduleNext() {
  clearTimeout(state.timer);
  if (state.paused || document.hidden || state.route === "horarios") return;
  state.timer = setTimeout(() => load({ silent: true }), REFRESH_MS);
}

async function load({ silent = false, routeChange = false } = {}) {
  const route = state.route;
  const view = views[route];
  if (!view) return;
  const mine = ++state.token;
  const fk = routeChange ? null : focusKey(document.activeElement);
  state.loading = true;
  updateLive();
  if (!silent) {
    $("#view").setAttribute("aria-busy", "true");
    $("#view").innerHTML = '<div class="skeleton" style="height:96px;margin-bottom:12px" aria-hidden="true"></div><div class="skeleton" style="height:260px" aria-hidden="true"></div>';
  }
  try {
    const data = await getJSON(view.url());
    if (mine !== state.token || route !== state.route) return;
    if (data.tz) {
      state.tz = data.tz;
      $("#tz").textContent = data.tz;
    }
    state.charts.forEach((c) => c.destroy());
    state.charts = [];
    state.loadedAt = Date.now();
    state.lastOk = Date.now();
    const out = view.render(data);
    const scroll = window.scrollY;
    const viewEl = $("#view");
    viewEl.innerHTML = out.html;
    viewEl.setAttribute("aria-busy", "false");
    out.after();
    applySorts();
    if (routeChange) {
      viewEl.classList.remove("enter");
      void viewEl.offsetWidth;
      if (!reducedMotion()) viewEl.classList.add("enter");
      const h1 = $("h1", viewEl);
      if (h1) h1.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, scroll);
      if (fk) {
        const target = document.getElementById(fk) || document.querySelector(`[data-key="${CSS.escape(fk)}"]`);
        if (target) target.focus({ preventScroll: true });
      }
    }
    state.animate = false;
  } catch (err) {
    if (err.message === "auth") return;
    if (!silent) {
      $("#view").setAttribute("aria-busy", "false");
      $("#view").innerHTML = `<section class="panel">${empty(`No se pudo cargar: ${err.message}`, { action: '<button type="button" class="btn sm" id="btn-retry">Reintentar</button>' })}</section>`;
    }
  } finally {
    state.loading = false;
    updateLive();
    scheduleNext();
  }
}

function go() {
  const r = (location.hash || "#resumen").slice(1);
  const soloAdmin = new Set(["cuentas", "horarios"]);
  state.route = views[r] ? r : "resumen";
  if (soloAdmin.has(state.route) && state.user?.role !== "admin") state.route = "resumen";
  state.animate = true;
  state.sort = {};
  document.title = `${TITLES[state.route]} · Essensa`;
  document.querySelectorAll("#nav a").forEach((a) => {
    if (a.dataset.route === state.route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  renderStatusbar();
  load({ routeChange: true });
}

function showLogin() {
  clearTimeout(state.timer);
  state.user = null;
  state.user = null;
  $("#login").hidden = false;
  $("#app").hidden = true;
  document.title = "Acceso · Essensa";
  setTimeout(() => $("#username").focus(), 0);
}

function paintUser() {
  const u = state.user;
  if (!u) return;
  $("#whoami").innerHTML = `<b>${esc(u.displayName)}</b><span>${u.role === "admin" ? "Administrador" : "Manager"}</span>`;
  // Un manager no ve las secciones de configuración.
  document.querySelectorAll("#nav a[data-admin]").forEach((a) => {
    a.hidden = u.role !== "admin";
  });
}

async function boot() {
  try {
    const me = await getJSON("/api/admin/me");
    state.user = me.user;
    $("#login").hidden = true;
    $("#app").hidden = false;
    paintUser();
    go();
  } catch (e) {
    if (e.message !== "auth") showLogin();
  }
}

/* ---------- Eventos ---------- */

window.addEventListener("hashchange", go);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return clearTimeout(state.timer);
  if (!$("#app").hidden && state.route !== "horarios" && !state.paused && Date.now() - state.lastOk > REFRESH_MS) load({ silent: true });
  else scheduleNext();
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = $("#loginError");
  out.textContent = "";
  $("#password").setAttribute("aria-invalid", "false");
  const r = await api("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: $("#username").value, password: $("#password").value }),
  });
  if (r.ok) {
    $("#password").value = "";
    boot();
  } else {
    const msg = (await r.json().catch(() => ({}))).error || "No se pudo iniciar sesión.";
    $("#password").setAttribute("aria-invalid", "true");
    out.innerHTML = `${ic("alert")}<span>${esc(msg)}</span>`;
    $("#password").focus();
  }
});

document.querySelectorAll(".js-logout").forEach((b) =>
  b.addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" });
    showLogin();
  })
);

$("#statusbar").addEventListener("click", (e) => {
  if (e.target.closest("#btn-pause")) {
    state.paused = !state.paused;
    renderStatusbar();
    if (state.paused) clearTimeout(state.timer);
    else load({ silent: true });
    $("#btn-pause").focus();
  } else if (e.target.closest("#btn-refresh")) {
    load({ silent: true });
  }
});

$("#view").addEventListener("click", async (e) => {
  if (e.target.closest("#btn-retry")) return load();

  const seg = e.target.closest(".seg button");
  if (seg) {
    state.range[seg.dataset.range] = seg.dataset.v;
    state.animate = true;
    return load();
  }

  const sortBtn = e.target.closest(".th-btn");
  if (sortBtn) {
    const th = sortBtn.closest("th");
    const tbl = th.closest("table");
    const i = Number(th.dataset.col);
    const cur = state.sort[tbl.dataset.tid];
    const first = th.dataset.type === "num" ? "descending" : "ascending";
    const dir = cur && cur.i === i ? (cur.dir === "ascending" ? "descending" : "ascending") : first;
    state.sort[tbl.dataset.tid] = { i, dir };
    sortTable(tbl, i, dir);
    return;
  }

  const actions = e.target.closest(".row-actions");
  if (!actions) return;

  // Turnos fijos (Shift 1, 2, 3...).
  if (actions.dataset.tpl) {
    const tid = actions.dataset.tpl;
    const tname = actions.dataset.name;
    const row = actions.closest("tr");
    const msg = $(".row-msg", row);
    msg.textContent = "";
    try {
      if (e.target.closest(".act-tsave")) {
        const nameIn = $(".f-tname", row);
        const startIn = $(".f-tstart", row);
        const graceIn = $(".f-tgrace", row);
        startIn.value = normalizeTime(startIn.value);
        const err = RULES.tplName(nameIn.value) || RULES.tplStart(startIn.value) || RULES.tplGrace(graceIn.value);
        if (err) {
          msg.textContent = err;
          return (RULES.tplName(nameIn.value) ? nameIn : RULES.tplStart(startIn.value) ? startIn : graceIn).focus();
        }
        const res = await api(`/api/admin/templates/${tid}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nameIn.value.trim(), startTime: startIn.value, graceMin: Number(graceIn.value) }),
        });
        if (!res.ok) return (msg.textContent = (await res.json().catch(() => ({}))).error || "No se pudo guardar.");
        toast(`Turno ${nameIn.value.trim()} guardado`);
        load({ silent: true });
      } else if (e.target.closest(".act-tdel")) {
        if (!window.confirm(`¿Borrar el turno ${tname}? Quien tenga ese rol dejará de medirse en puntualidad. Los fichajes ya hechos no cambian.`)) return;
        await api(`/api/admin/templates/${tid}`, { method: "DELETE" });
        toast(`Turno ${tname} borrado`);
        load({ silent: true });
      }
    } catch (err) {
      if (err.message !== "auth") toast(err.message, true);
    }
    return;
  }


  // Cuentas del panel.
  if (actions.dataset.user) {
    const id = actions.dataset.user;
    const who = actions.dataset.name;
    const msg = $(".row-msg", actions.closest("tr"));
    msg.textContent = "";
    const send = async (method, body) => {
      const res = await api(`/api/admin/users/${id}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        msg.textContent = (await res.json().catch(() => ({}))).error || "No se pudo guardar.";
        return false;
      }
      return true;
    };
    try {
      if (e.target.closest(".act-pass")) {
        const nueva = window.prompt(`Contraseña nueva para ${who} (mínimo 10 caracteres):`);
        if (nueva === null) return;
        if (nueva.length < 10) return (msg.textContent = "Al menos 10 caracteres.");
        if (await send("PUT", { password: nueva })) toast(`Contraseña de ${who} cambiada`);
      } else if (e.target.closest(".act-role")) {
        const nuevo = actions.dataset.role === "admin" ? "manager" : "admin";
        if (!window.confirm(`¿Cambiar a ${who} al rol ${nuevo}?`)) return;
        if (await send("PUT", { role: nuevo })) { toast(`${who} ahora es ${nuevo}`); load({ silent: true }); }
      } else if (e.target.closest(".act-active")) {
        const activar = actions.dataset.active !== "1";
        if (!activar && !window.confirm(`¿Desactivar a ${who}? Perderá el acceso al instante.`)) return;
        if (await send("PUT", { active: activar })) { toast(`${who} ${activar ? "activada" : "desactivada"}`); load({ silent: true }); }
      } else if (e.target.closest(".act-del")) {
        if (!window.confirm(`¿Borrar la cuenta de ${who}? No se puede deshacer.`)) return;
        if (await send("DELETE")) { toast(`Cuenta de ${who} borrada`); load({ silent: true }); }
      } else return;
    } catch (err) {
      if (err.message !== "auth") toast(err.message, true);
    }
    return;
  }

  // Cuentas del panel.
  if (actions.dataset.user) {
    const id = actions.dataset.user;
    const who = actions.dataset.name;
    const msg = $(".row-msg", actions.closest("tr"));
    msg.textContent = "";
    const send = async (method, body) => {
      const res = await api(`/api/admin/users/${id}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        msg.textContent = (await res.json().catch(() => ({}))).error || "No se pudo guardar.";
        return false;
      }
      return true;
    };
    try {
      if (e.target.closest(".act-pass")) {
        const nueva = window.prompt(`Contraseña nueva para ${who} (mínimo 10 caracteres):`);
        if (nueva === null) return;
        if (nueva.length < 10) return (msg.textContent = "Al menos 10 caracteres.");
        if (await send("PUT", { password: nueva })) toast(`Contraseña de ${who} cambiada`);
      } else if (e.target.closest(".act-role")) {
        const nuevo = actions.dataset.role === "admin" ? "manager" : "admin";
        if (!window.confirm(`¿Cambiar a ${who} al rol ${nuevo}?`)) return;
        if (await send("PUT", { role: nuevo })) { toast(`${who} ahora es ${nuevo}`); load({ silent: true }); }
      } else if (e.target.closest(".act-active")) {
        const activar = actions.dataset.active !== "1";
        if (!activar && !window.confirm(`¿Desactivar a ${who}? Perderá el acceso al instante.`)) return;
        if (await send("PUT", { active: activar })) { toast(`${who} ${activar ? "activada" : "desactivada"}`); load({ silent: true }); }
      } else if (e.target.closest(".act-del")) {
        if (!window.confirm(`¿Borrar la cuenta de ${who}? No se puede deshacer.`)) return;
        if (await send("DELETE")) { toast(`Cuenta de ${who} borrada`); load({ silent: true }); }
      } else return;
    } catch (err) {
      if (err.message !== "auth") toast(err.message, true);
    }
    return;
  }

  // Cerrar un turno que quedó abierto (alguien se fue sin pulsar End).
  if (actions.dataset.shift) {
    const who = actions.dataset.name;
    if (!e.target.closest(".act-close")) return;
    if (!window.confirm(`¿Cerrar ahora el turno de ${who}? Se registrará como terminado en este momento.`)) return;
    try {
      const r = await api(`/api/admin/shifts/${actions.dataset.shift}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) return toast((await r.json().catch(() => ({}))).error || "No se pudo cerrar el turno.", true);
      toast(`Turno de ${who} cerrado`);
      load({ silent: true });
    } catch (err) {
      if (err.message !== "auth") toast(err.message, true);
    }
    return;
  }
  const id = actions.dataset.id;
  const name = actions.dataset.name;
  const row = actions.closest("tr");
  const msg = $(".row-msg", row);
  msg.textContent = "";
  try {
    if (e.target.closest(".act-save")) {
      const startIn = $(".f-start", row);
      const graceIn = $(".f-grace", row);
      startIn.value = normalizeTime(startIn.value);
      const startErr = RULES.start(startIn.value);
      const graceErr = RULES.grace(graceIn.value);
      startIn.setAttribute("aria-invalid", startErr ? "true" : "false");
      graceIn.setAttribute("aria-invalid", graceErr ? "true" : "false");
      if (startErr || graceErr) {
        msg.textContent = startErr || `Minutos de gracia: ${graceErr}`;
        return (startErr ? startIn : graceIn).focus();
      }
      const r = await api(`/api/admin/schedules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: startIn.value, graceMin: Number(graceIn.value), name }),
      });
      if (!r.ok) return (msg.textContent = (await r.json()).error || "No se pudo guardar.");
      toast(`Horario de ${name} guardado`);
      load({ silent: true });
    } else if (e.target.closest(".act-clear")) {
      if (!window.confirm(`¿Quitar el horario de ${name}? Dejará de marcarse su puntualidad.`)) return;
      await api(`/api/admin/schedules/${id}`, { method: "DELETE" });
      toast(`Horario de ${name} quitado`);
      load({ silent: true });
    }
  } catch (err) {
    if (err.message !== "auth") toast(err.message, true);
  }
});

/* Validación al salir del campo y al enviar. */
$("#view").addEventListener("focusout", (e) => {
  const input = e.target;
  if (!input.form || !input.form.matches("#addForm, #userForm, #passForm, #tplForm") || !RULES[input.name]) return;
  if (input.name === "start" || input.name === "tplStart") input.value = normalizeTime(input.value);
  if (input.value !== "" || input.getAttribute("aria-invalid") === "true") setError(input, RULES[input.name](input.value));
});

$("#view").addEventListener("submit", async (e) => {
  // Agregar un turno fijo.
  if (e.target.matches("#tplForm")) {
    e.preventDefault();
    const f = e.target;
    f.elements.tplStart.value = normalizeTime(f.elements.tplStart.value);
    let bad = null;
    for (const n of ["tplName", "tplStart", "tplGrace"]) {
      if (setError(f.elements[n], RULES[n](f.elements[n].value)) && !bad) bad = f.elements[n];
    }
    if (bad) return bad.focus();
    const res = await api("/api/admin/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.elements.tplName.value.trim(),
        startTime: f.elements.tplStart.value,
        graceMin: Number(f.elements.tplGrace.value),
      }),
    });
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error || "No se pudo agregar el turno.", true);
    toast(`Turno ${f.elements.tplName.value.trim()} agregado`);
    load({ silent: true });
    return;
  }

  // Crear una cuenta nueva del panel.
  if (e.target.matches("#userForm")) {
    e.preventDefault();
    const f = e.target;
    let bad = null;
    for (const n of ["displayName", "username", "password"]) {
      if (setError(f.elements[n], RULES[n](f.elements[n].value)) && !bad) bad = f.elements[n];
    }
    if (bad) return bad.focus();
    const res = await api("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: f.elements.displayName.value.trim(),
        username: f.elements.username.value.trim(),
        password: f.elements.password.value,
        role: f.elements.role.value,
      }),
    });
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error || "No se pudo crear la cuenta.", true);
    toast(`Cuenta de ${f.elements.displayName.value.trim()} creada`);
    load({ silent: true });
    return;
  }

  // Cambiar la propia contraseña.
  if (e.target.matches("#passForm")) {
    e.preventDefault();
    const f = e.target;
    let bad = null;
    for (const n of ["current", "newPassword"]) {
      if (setError(f.elements[n], RULES[n](f.elements[n].value)) && !bad) bad = f.elements[n];
    }
    if (bad) return bad.focus();
    const res = await api("/api/admin/me/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current: f.elements.current.value, password: f.elements.newPassword.value }),
    });
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error || "No se pudo cambiar.", true);
    f.reset();
    toast("Tu contraseña se cambió");
    return;
  }

  if (!e.target.matches("#addForm")) return;
  e.preventDefault();
  const form = e.target;
  let firstBad = null;
  for (const name of ["name", "discordId", "start", "grace"]) {
    const input = form.elements[name];
    if (name === "start") input.value = normalizeTime(input.value);
    if (setError(input, RULES[name](input.value)) && !firstBad) firstBad = input;
  }
  if (firstBad) return firstBad.focus();

  const r = await api(`/api/admin/schedules/${encodeURIComponent(form.elements.discordId.value.trim())}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start: form.elements.start.value, graceMin: Number(form.elements.grace.value), name: form.elements.name.value.trim() }),
  });
  if (!r.ok) {
    toast((await r.json().catch(() => ({}))).error || "No se pudo agregar.", true);
    return;
  }
  toast(`${form.elements.name.value.trim()} agregado`);
  load({ silent: true });
});

/* Reloj lateral y contadores en vivo (cada segundo, sin tocar el árbol de accesibilidad). */
setInterval(() => {
  $("#clock").textContent = new Date().toLocaleTimeString("es", { timeZone: state.tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const elapsed = Date.now() - state.loadedAt;
  document.querySelectorAll(".tick").forEach((el) => {
    const v = Number(el.dataset.base) + (el.dataset.run === "1" ? elapsed : 0);
    el.textContent = fmtDur(v);
    if (el.dataset.limit) el.style.color = v > Number(el.dataset.limit) ? "var(--danger-text)" : "";
  });
  updateLive();
}, 1000);

boot();
