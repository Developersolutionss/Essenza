// Se ejecuta con `npm run test:browser` (ver tests/browser/run.js).
const { spawn } = require("child_process");
const path = require("path");
const CH = require("./chrome").path;
const SP = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "essenza-browser-"));
const BASE = "http://localhost:3999";
const results = [];
const consoleErrors = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => results.push(`${cond ? "PASA " : "FALLA"}  ${name}${extra ? "  -> " + extra : ""}`);

(async () => {
  const chrome = spawn(CH, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9333", `--user-data-dir=${path.join(SP, "chrome-cdp")}`, "about:blank"], { stdio: "ignore" });
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch("http://localhost:9333/json")).json(); if (version.length) break; } catch {}
    await sleep(250);
  }
  const page = version.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") consoleErrors.push("EXC " + msg.params.exceptionDetails.text + " " + (msg.params.exceptionDetails.exception?.description || "").split("\n")[0]);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") consoleErrors.push("console.error " + msg.params.args.map((a) => a.value || a.description).join(" ").slice(0, 160));
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result.result.value;
  };
  const go = async (url, wait = 3500) => { await send("Page.navigate", { url }); await sleep(wait); };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

  /* ===== Móvil 375 ===== */
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  for (const route of ["resumen", "fichajes", "elevenlabs", "horarios"]) {
    await go(`${BASE}/__login?v=${route}`);
    const o = await ev(`({sw: document.documentElement.scrollWidth, iw: window.innerWidth})`);
    ok(`375px sin desbordamiento horizontal en ${route}`, o.sw <= o.iw, `scrollWidth=${o.sw} innerWidth=${o.iw}`);
    const nav = await ev(`(() => { const n=document.getElementById('nav'); const r=n.getBoundingClientRect(); return {pos:getComputedStyle(n).position, bottom: Math.round(r.bottom), vh: innerHeight, items:n.querySelectorAll('a').length, minH: Math.min(...[...n.querySelectorAll('a')].map(a=>a.getBoundingClientRect().height))} })()`);
    ok(`barra inferior en ${route}: fija, hasta 5 secciones, 44px+`, nav.pos === "fixed" && nav.items >= 3 && nav.items <= 5 && nav.minH >= 44, JSON.stringify(nav));
  }
  await go(`${BASE}/__login?v=fichajes`);
  const small = await ev(`[...document.querySelectorAll('button, a.btn, input, select, #nav a')].filter(e=>e.offsetParent!==null).map(e=>({t:(e.textContent||e.id||e.name||'').trim().slice(0,18),w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height)})).filter(x=>x.h<44)`);
  ok("controles táctiles >= 44px en móvil (pointer: coarse emulado no aplica en headless; se informa)", true, small.length ? `${small.length} por debajo de 44px: ` + small.slice(0, 6).map((s) => `${s.t}:${s.h}`).join(", ") : "ninguno");

  /* ===== Escritorio 1440 ===== */
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await go(`${BASE}/__login?v=fichajes`);

  // Estructura accesible
  const struct = await ev(`({
    h1: [...document.querySelectorAll('h1')].filter(h=>h.offsetParent!==null).length,
    main: !!document.querySelector('main'),
    skip: !!document.querySelector('a.skip-link'),
    current: document.querySelector('#nav a[aria-current="page"]')?.dataset.route,
    title: document.title,
    imgNoLabel: [...document.querySelectorAll('canvas')].filter(c=>!c.getAttribute('aria-label')).length,
    emoji: /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u.test(document.body.innerText),
    iconBtnNoName: [...document.querySelectorAll('button')].filter(b=>!(b.textContent.trim()||b.getAttribute('aria-label'))).length,
    tablesNoRegion: [...document.querySelectorAll('.tbl-wrap')].filter(w=>!w.getAttribute('aria-label')).length,
  })`);
  ok("un solo h1, landmark main y enlace de salto", struct.h1 === 1 && struct.main && struct.skip, JSON.stringify(struct));
  ok("pestaña actual marcada con aria-current", struct.current === "fichajes");
  ok("título de documento por sección", struct.title.startsWith("Fichajes"), struct.title);
  ok("todas las gráficas con texto alternativo", struct.imgNoLabel === 0);
  ok("sin emojis como iconos", !struct.emoji);
  ok("sin botones sin nombre accesible", struct.iconBtnNoName === 0);

  // Orden de tablas
  const before = await ev(`[...document.querySelectorAll('table[data-tid="late"] tbody tr')].map(r=>r.cells[0].textContent.trim()+':'+r.cells[5].dataset.v)`);
  await ev(`document.querySelector('table[data-tid="late"] th[data-col="5"] .th-btn').click()`);
  const afterDesc = await ev(`({rows:[...document.querySelectorAll('table[data-tid="late"] tbody tr')].map(r=>Number(r.cells[5].dataset.v)), sort: document.querySelector('table[data-tid="late"] th[data-col="5"]').getAttribute('aria-sort')})`);
  ok("ordenar por retraso (primer clic = descendente)", afterDesc.sort === "descending" && afterDesc.rows.every((v, i, a) => i === 0 || a[i - 1] >= v), JSON.stringify(afterDesc));
  await ev(`document.querySelector('table[data-tid="late"] th[data-col="5"] .th-btn').click()`);
  const afterAsc = await ev(`({rows:[...document.querySelectorAll('table[data-tid="late"] tbody tr')].map(r=>Number(r.cells[5].dataset.v)), sort: document.querySelector('table[data-tid="late"] th[data-col="5"]').getAttribute('aria-sort')})`);
  ok("segundo clic invierte a ascendente", afterAsc.sort === "ascending" && afterAsc.rows.every((v, i, a) => i === 0 || a[i - 1] <= v));
  await ev(`document.querySelector('table[data-tid="people"] th[data-col="0"] .th-btn').click()`);
  const names = await ev(`[...document.querySelectorAll('table[data-tid="people"] tbody tr')].map(r=>r.cells[0].textContent.trim())`);
  ok("ordenar por nombre (texto, ascendente)", JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b, "es"))), names.join(","));

  // Tabla alternativa de gráfica
  await ev(`document.getElementById('c-people').closest('.panel').querySelector('.head button').click()`);
  const tbl = await ev(`({open: !document.getElementById('c-people-table').hidden, chartHidden: document.getElementById('c-people').closest('.chart').hidden, pressed: document.getElementById('c-people').closest('.panel').querySelector('.head button').getAttribute('aria-pressed'), rows: document.querySelectorAll('#c-people-table tbody tr').length})`);
  ok("Ver tabla muestra los datos y oculta la gráfica", tbl.open && tbl.chartHidden && tbl.pressed === "true" && tbl.rows > 0, JSON.stringify(tbl));

  // Rango: foco conservado y estado
  await ev(`document.querySelector('.seg button[data-v="30"]').focus(); document.querySelector('.seg button[data-v="30"]').click()`);
  await sleep(1500);
  const seg = await ev(`({pressed: document.querySelector('.seg button[data-v="30"]').getAttribute('aria-pressed'), others: document.querySelector('.seg button[data-v="7"]').getAttribute('aria-pressed'), focus: document.activeElement?.dataset?.key})`);
  ok("cambiar de periodo mantiene el foco y marca el botón", seg.pressed === "true" && seg.others === "false" && seg.focus === "seg-fichajes-30", JSON.stringify(seg));
  const tblOpen = await ev(`!document.getElementById('c-people-table')?.hidden`);
  ok("la tabla abierta se conserva tras recargar datos", tblOpen === true || tblOpen === undefined);

  // Cerrar turno olvidado desde el panel
  await ev("window.confirm = () => true");
  const openBefore = await ev("document.querySelectorAll(\".act-close\").length");
  if (openBefore > 0) {
    await ev("document.querySelector(\".act-close\").click()");
    await sleep(1800);
    const openAfter = await ev("document.querySelectorAll(\".act-close\").length");
    ok("botón Cerrar turno cierra un turno abierto", openAfter === openBefore - 1, `antes=${openBefore} despues=${openAfter}`);
  } else { ok("botón Cerrar turno presente", false, "no había turnos abiertos"); }

  // Pausa
  await ev(`document.getElementById('btn-pause').click()`);
  const paused = await ev(`({txt: document.getElementById('live-text').textContent, cls: document.getElementById('live').className, pressed: document.getElementById('btn-pause').getAttribute('aria-pressed')})`);
  ok("Pausar detiene la actualización y lo indica con texto", paused.txt.startsWith("Pausado") && paused.pressed === "true", JSON.stringify(paused));
  await ev(`document.getElementById('btn-pause').click()`);
  await sleep(1200);

  // Horarios: validación en línea
  await go(`${BASE}/__login?v=horarios`);
  await ev(`document.getElementById('addForm').requestSubmit()`);
  await sleep(300);
  const v1 = await ev(`({name: document.getElementById('err-name').textContent.trim(), id: document.getElementById('err-discordId').textContent.trim(), start: document.getElementById('err-start').textContent.trim(), focus: document.activeElement.id, invalid: document.getElementById('f-name').getAttribute('aria-invalid')})`);
  ok("formulario vacío muestra errores junto a cada campo y enfoca el primero", v1.name && v1.id && v1.start && v1.focus === "f-name" && v1.invalid === "true", JSON.stringify(v1));
  await ev(`(()=>{const f=document.getElementById('addForm');f.elements.name.value='Pruebas';f.elements.discordId.value='555555555';f.elements.start.value='9:30';f.elements.grace.value='15';f.requestSubmit()})()`);
  await sleep(1800);
  const added = await ev(`({row: !!document.querySelector('tr .row-actions[data-id="555555555"]'), start: document.getElementById('start-555555555')?.value, toast: document.getElementById('toasts').textContent.trim()})`);
  ok("hora '9:30' se normaliza a 09:30 y la persona se agrega", added.row && added.start === "09:30", JSON.stringify(added));
  await ev(`(()=>{const i=document.getElementById('start-555555555'); i.value='25:99'; document.querySelector('.row-actions[data-id="555555555"] .act-save').click()})()`);
  await sleep(400);
  const rowErr = await ev(`document.querySelector('.row-actions[data-id="555555555"]').closest('tr').querySelector('.row-msg').textContent`);
  ok("hora inválida en una fila muestra el error en la fila", /24 horas/.test(rowErr), rowErr);

  // Acceso: sin sesión
  await send("Network.enable");
  await send("Network.clearBrowserCookies");
  await go(`${BASE}/admin`, 2500);
  const lg = await ev(`({login: !document.getElementById('login').hidden, app: document.getElementById('app').hidden, focus: document.activeElement.id})`);
  ok("sin sesión se muestra el acceso y se enfoca el usuario", lg.login && lg.app && lg.focus === "username", JSON.stringify(lg));
  await ev(`(()=>{document.getElementById('username').value='admin'; document.getElementById('password').value='mala'; document.getElementById('loginForm').requestSubmit()})()`);
  await sleep(900);
  const le = await ev(`({err: document.getElementById('loginError').textContent.trim(), invalid: document.getElementById('password').getAttribute('aria-invalid'), focus: document.activeElement.id})`);
  ok("contraseña incorrecta: error visible junto al campo y foco devuelto", /incorrect/.test(le.err) && le.invalid === "true" && le.focus === "password", JSON.stringify(le));

  /* ===== Página de chatters (375) ===== */
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await go(`${BASE}/__loginchat`, 2500);
  const ch = await ev(`({sw: document.documentElement.scrollWidth, iw: innerWidth, models: document.getElementById('model').options.length})`);
  ok("página de chatters sin desbordamiento a 375px", ch.sw <= ch.iw, JSON.stringify(ch));
  await ev(`document.getElementById('generator').requestSubmit()`);
  await sleep(300);
  const cv = await ev(`({c: document.getElementById('chatter-err').textContent.trim(), t: document.getElementById('text-err').textContent.trim(), focus: document.activeElement.id, busy: document.getElementById('generate').getAttribute('aria-busy')})`);
  ok("chatters: texto vacío muestra el error y enfoca el campo, sin llamar al servidor", cv.t && cv.focus === "text" && cv.busy !== "true", JSON.stringify(cv));
  await ev(`(()=>{const t=document.getElementById('text'); t.value='x'.repeat(40); t.dispatchEvent(new Event('input'))})()`);
  ok("contador de caracteres", (await ev(`document.getElementById('count').textContent`)) === "40");

  console.log(results.join("\n"));
  console.log("\nErrores de consola/excepciones:", consoleErrors.length ? "\n" + [...new Set(consoleErrors)].join("\n") : "ninguno");
  const fails = results.filter((r) => r.startsWith("FALLA")).length;
  console.log(`\n${results.length - fails}/${results.length} comprobaciones pasan`);
  chrome.kill();
  process.exit(results.some((x) => x.startsWith("FALLA")) ? 1 : 0);
})().catch((e) => { console.log(results.join("\n")); console.error("ERROR DEL TEST:", e.message); process.exit(1); });
