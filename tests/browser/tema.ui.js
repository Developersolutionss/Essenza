// Se ejecuta con `npm run test:browser` (ver tests/browser/run.js).
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const CH = require("./chrome").path;
const SP = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "essenza-browser-"));
const BASE = "http://localhost:3999";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (n, c, e = "") => out.push(`${c ? "PASA " : "FALLA"}  ${n}${e ? "  -> " + e : ""}`);

// Auditoría de contraste: cada texto visible frente a su fondo real.
const AUDIT = `(() => {
  const parse = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const root = parse(getComputedStyle(document.body).backgroundColor); if (root && root.a > 0) base = root;
    return layers.reverse().reduce((acc, l) => blend(l, acc), layers.length && layers[0].a >= 1 ? layers.shift() : base);
  };
  const bad = []; let total = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    const fg0 = parse(cs.color); if (!fg0) continue;
    const bg = bgOf(el); const fg = blend(fg0, bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700;
    const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    total++;
    if (ratio < need) bad.push((el.textContent || '').trim().slice(0, 30) + ' [' + el.tagName + '.' + (el.className || '') + '] ' + ratio.toFixed(2) + ':1 (mín ' + need + ')');
  }
  return JSON.stringify({ total, bad: bad.slice(0, 12), nbad: bad.length });
})()`;

(async () => {
  const chrome = spawn(CH, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9341", `--user-data-dir=${path.join(SP, "chrome-theme")}`, "about:blank"], { stdio: "ignore" });
  let t;
  for (let i = 0; i < 40; i++) { try { t = await (await fetch("http://localhost:9341/json")).json(); if (t.length) break; } catch {} await sleep(250); }
  const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") errs.push((msg.params.exceptionDetails.exception?.description || "").split("\n")[0]); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
  const go = async (u, w = 3500) => { await send("Page.navigate", { url: u }); await sleep(w); };
  const shot = async (name) => { const r = await send("Runtime.evaluate", { expression: "document.documentElement.scrollHeight", returnByValue: true }); const h = Math.min(r.result.result.value, 2600); await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(600); const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SP, name), Buffer.from(s.result.data, "base64")); await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); };

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  /* --- Por defecto sigue al sistema --- */
  await go(`${BASE}/__login?v=elevenlabs`);
  ok("sin elección, con el sistema en claro la app abre en claro", (await ev("document.documentElement.dataset.theme")) === "light");
  const lightAudit = JSON.parse(await ev(AUDIT));
  ok("modo claro: todos los textos cumplen contraste", lightAudit.nbad === 0, `${lightAudit.total} textos medidos; fallan ${lightAudit.nbad}${lightAudit.bad.length ? " -> " + lightAudit.bad.join(" | ") : ""}`);
  const lightCharts = await ev(`JSON.stringify({ tick: Chart.defaults.color, tip: Chart.defaults.plugins.tooltip.backgroundColor })`);

  /* --- Cambiar con el botón --- */
  const btn = await ev(`(() => { const b = document.querySelector('.side-foot [data-theme-toggle]'); return JSON.stringify({ label: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), aria: b.getAttribute('aria-label') }); })()`);
  ok("el botón indica la acción y su estado", /Modo oscuro/.test(JSON.parse(btn).label) && JSON.parse(btn).pressed === "false", btn);
  await ev(`document.querySelector('.side-foot [data-theme-toggle]').click()`);
  await sleep(1800);
  const dark = await ev(`JSON.stringify({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem('essensa_theme'), scheme: document.querySelector('meta[name=color-scheme]').content, bg: getComputedStyle(document.body).backgroundColor, label: document.querySelector('.side-foot [data-theme-toggle]').textContent.trim(), pressed: document.querySelector('.side-foot [data-theme-toggle]').getAttribute('aria-pressed') })`);
  const d = JSON.parse(dark);
  ok("al pulsar pasa a oscuro y lo recuerda", d.theme === "dark" && d.stored === "dark" && d.scheme === "dark", dark);
  ok("el fondo realmente se oscurece", Number((d.bg.match(/[0-9]+/g) || [255])[0]) < 60, d.bg);
  ok("el botón ahora ofrece volver a claro", /Modo claro/.test(d.label) && d.pressed === "true");
  const darkCharts = await ev(`JSON.stringify({ tick: Chart.defaults.color, tip: Chart.defaults.plugins.tooltip.backgroundColor })`);
  ok("las gráficas cambian de colores con el tema", darkCharts !== lightCharts, `${lightCharts} -> ${darkCharts}`);
  const canvasOk = await ev(`document.querySelectorAll('canvas').length > 0 && [...document.querySelectorAll('canvas')].every(c => c.width > 0)`);
  ok("las gráficas siguen dibujadas tras el cambio", canvasOk);
  const darkAudit = JSON.parse(await ev(AUDIT));
  ok("modo oscuro: todos los textos cumplen contraste", darkAudit.nbad === 0, `${darkAudit.total} textos medidos; fallan ${darkAudit.nbad}${darkAudit.bad.length ? " -> " + darkAudit.bad.join(" | ") : ""}`);
  await shot("d-eleven.png");

  /* --- Se recuerda al recargar y en otras secciones --- */
  await go(`${BASE}/admin#fichajes`, 3500);
  ok("tras recargar sigue oscuro", (await ev("document.documentElement.dataset.theme")) === "dark");
  const fa = JSON.parse(await ev(AUDIT));
  ok("Fichajes en oscuro: contraste correcto", fa.nbad === 0, `${fa.total} textos; fallan ${fa.nbad}${fa.bad.length ? " -> " + fa.bad.join(" | ") : ""}`);
  await shot("d-fich.png");
  for (const v of ["resumen", "cuentas", "horarios"]) {
    await go(`${BASE}/admin#${v}`, 2800);
    const a = JSON.parse(await ev(AUDIT));
    ok(`${v} en oscuro: contraste correcto`, a.nbad === 0, `${a.total} textos; fallan ${a.nbad}${a.bad.length ? " -> " + a.bad.join(" | ") : ""}`);
  }
  await shot("d-horarios.png");

  /* --- Volver a claro --- */
  await ev(`document.querySelector('.side-foot [data-theme-toggle]').click()`);
  await sleep(1200);
  ok("se puede volver a claro", (await ev("document.documentElement.dataset.theme")) === "light" && (await ev("localStorage.getItem('essensa_theme')")) === "light");

  /* --- Sin elección, sigue al sistema aunque sea oscuro --- */
  await ev("localStorage.removeItem('essensa_theme')");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "dark" }] });
  await go(`${BASE}/admin#resumen`, 3000);
  ok("sin elección y con el sistema en oscuro, abre en oscuro", (await ev("document.documentElement.dataset.theme")) === "dark");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
  await sleep(800);
  ok("al cambiar el sistema a claro, la app lo sigue en vivo", (await ev("document.documentElement.dataset.theme")) === "light");

  /* --- Móvil --- */
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await go(`${BASE}/admin#resumen`, 3000);
  const mob = await ev(`(() => { const b = document.querySelector('.mobile-top [data-theme-toggle]'); const r = b.getBoundingClientRect(); return JSON.stringify({ visible: r.width > 0, name: b.getAttribute('aria-label'), top: Math.round(r.top), sw: document.documentElement.scrollWidth, iw: innerWidth }); })()`);
  const mo = JSON.parse(mob);
  ok("en móvil el botón de tema está en la barra superior, con nombre accesible, sin desbordar", mo.visible && mo.name && mo.sw <= mo.iw, mob);
  await ev(`document.querySelector('.mobile-top [data-theme-toggle]').click()`);
  await sleep(1500);
  ok("el botón del móvil también cambia el tema", (await ev("document.documentElement.dataset.theme")) === "dark");

  /* --- Acceso y página de chatters --- */
  await send("Network.enable"); await send("Network.clearBrowserCookies");
  await go(`${BASE}/admin`, 2500);
  ok("el acceso del panel tiene el botón de tema", (await ev("!!document.querySelector('#login [data-theme-toggle]')")));
  await go(`${BASE}/index.html`, 2500);
  ok("la página de chatters tiene el botón de tema y respeta la elección", (await ev("!!document.querySelector('[data-theme-toggle]') && document.documentElement.dataset.theme === 'dark'")));

  console.log(out.join("\n"));
  console.log("\nErrores de consola:", errs.length ? [...new Set(errs)].join("\n") : "ninguno");
  const f = out.filter((x) => x.startsWith("FALLA")).length;
  console.log(`\n${out.length - f}/${out.length} comprobaciones de tema pasan`);
  chrome.kill();
  process.exit(out.some((x) => x.startsWith("FALLA")) ? 1 : 0);
})().catch((e) => { console.log(out.join("\n")); console.error("ERROR:", e.message); process.exit(1); });
