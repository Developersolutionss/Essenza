// Se ejecuta con `npm run test:browser` (ver tests/browser/run.js).
const { spawn } = require("child_process");
const path = require("path");
const CH = require("./chrome").path;
const SP = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "essenza-browser-"));
const BASE = "http://localhost:3999";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (n, c, e = "") => out.push(`${c ? "PASA " : "FALLA"}  ${n}${e ? "  -> " + e : ""}`);

(async () => {
  const chrome = spawn(CH, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9342", `--user-data-dir=${path.join(SP, "chrome-vtz")}`, "about:blank"], { stdio: "ignore" });
  let t;
  for (let i = 0; i < 40; i++) { try { t = await (await fetch("http://localhost:9342/json")).json(); if (t.length) break; } catch {} await sleep(250); }
  const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") errs.push((msg.params.exceptionDetails.exception?.description || "").split("\n")[0]); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
  const go = async (u, w = 3500) => { await send("Page.navigate", { url: u }); await sleep(w); };
  const reload = async () => { await send("Page.reload"); await sleep(3500); };
  const pick = async (value) => { await ev(`(() => { const s = document.getElementById('viewtz'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(1500); };
  const entradas = () => ev(`JSON.stringify((() => { const ths = [...document.querySelectorAll('table[data-tid="tpl"] thead th')]; const k = ths.findIndex(t => /^En /.test(t.textContent.trim())); return [...document.querySelectorAll('table[data-tid="tpl"] tbody tr')].map(r => k < 0 ? null : r.cells[k].textContent.trim().split(' a ')[0]); })())`).then(JSON.parse);
  const hh = (s) => { const m = /(\d\d):(\d\d)/.exec(s || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await ev("localStorage.clear()").catch(() => {});

  /* --- Por defecto: hora de la agencia --- */
  await go(`${BASE}/__login?v=horarios`);
  ok("por defecto el selector está en 'Hora de la agencia'", (await ev("document.getElementById('viewtz').value")) === "agency");
  ok("la etiqueta bajo el reloj dice que es la hora de la agencia", /agencia/.test(await ev("document.getElementById('tz').textContent")), await ev("document.getElementById('tz').textContent"));
  ok("en hora de la agencia no se muestra la columna 'En ...'", (await entradas()).every((x) => x === null));

  /* --- Colombia: una hora menos --- */
  await pick("America/Bogota");
  let e = await entradas();
  ok("Colombia: Shift 1/2/3 entran 04:30, 12:00 y 20:15", JSON.stringify(e) === JSON.stringify(["04:30", "12:00", "20:15"]), JSON.stringify(e));
  ok("la columna se titula con el país", /En Bogota/.test(await ev("[...document.querySelectorAll('table[data-tid=\"tpl\"] th')].map(t=>t.textContent).join('|')")));
  ok("la etiqueta bajo el reloj indica la zona elegida", /Bogota/.test(await ev("document.getElementById('tz').textContent")), await ev("document.getElementById('tz').textContent"));

  /* --- Argentina y Paraguay: una hora más --- */
  await pick("America/Argentina/Buenos_Aires");
  e = await entradas();
  ok("Argentina: 06:30, 14:00 y 22:15", JSON.stringify(e) === JSON.stringify(["06:30", "14:00", "22:15"]), JSON.stringify(e));
  await pick("America/Asuncion");
  e = await entradas();
  ok("Paraguay: 06:30, 14:00 y 22:15", JSON.stringify(e) === JSON.stringify(["06:30", "14:00", "22:15"]), JSON.stringify(e));

  /* --- Día siguiente: una zona muy adelantada --- */
  await ev("localStorage.setItem('essensa_view_tz','Asia/Tokyo')");
  await reload();
  e = await entradas();
  ok("una zona muy adelantada (Tokio) avisa del cambio de día", e.some((x) => /día siguiente/.test(x || "")), JSON.stringify(e));

  /* --- Se recuerda al recargar --- */
  await ev("localStorage.setItem('essensa_view_tz','America/Bogota')");
  await reload();
  ok("tras recargar sigue en Colombia", (await ev("document.getElementById('viewtz').value")) === "America/Bogota");

  /* --- Las horas de Fichajes cambian una hora, la puntualidad no --- */
  await go(`${BASE}/admin#fichajes`, 3500);
  const col = JSON.parse(await ev(`JSON.stringify({ llegada: [...document.querySelectorAll('table[data-tid="late"] tbody tr')].map(r => r.cells[4]?.textContent.trim()), retraso: [...document.querySelectorAll('table[data-tid="late"] tbody tr')].map(r => r.cells[5]?.textContent.trim()) })`));
  await pick("agency");
  const age = JSON.parse(await ev(`JSON.stringify({ llegada: [...document.querySelectorAll('table[data-tid="late"] tbody tr')].map(r => r.cells[4]?.textContent.trim()), retraso: [...document.querySelectorAll('table[data-tid="late"] tbody tr')].map(r => r.cells[5]?.textContent.trim()) })`));
  const difs = col.llegada.map((x, i) => (hh(age.llegada[i]) - hh(x) + 1440) % 1440);
  ok("en Fichajes, las horas en Colombia van una hora por detrás de las de Venezuela", col.llegada.length > 0 && difs.every((d) => d === 60), `diferencias (min): ${difs.join(",")}`);
  ok("el retraso (la puntualidad) es el mismo en las dos zonas", JSON.stringify(col.retraso) === JSON.stringify(age.retraso), `${col.retraso.join(",")} = ${age.retraso.join(",")}`);

  /* --- Móvil --- */
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  for (const v of ["resumen", "horarios"]) {
    await go(`${BASE}/admin#${v}`, 3000);
    const m = JSON.parse(await ev(`JSON.stringify({ sw: document.documentElement.scrollWidth, iw: innerWidth, visible: document.getElementById('viewtz').getBoundingClientRect().width > 0 })`));
    ok(`${v} a 375px: el selector se ve y no desborda`, m.visible && m.sw <= m.iw, JSON.stringify(m));
  }

  console.log(out.join("\n"));
  console.log("\nErrores de consola:", errs.length ? [...new Set(errs)].join("\n") : "ninguno");
  const f = out.filter((x) => x.startsWith("FALLA")).length;
  console.log(`\n${out.length - f}/${out.length} comprobaciones de zona horaria pasan`);
  chrome.kill();
  process.exit(out.some((x) => x.startsWith("FALLA")) ? 1 : 0);
})().catch((e) => { console.log(out.join("\n")); console.error("ERROR:", e.message); process.exit(1); });
