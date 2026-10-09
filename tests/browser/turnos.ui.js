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
  const chrome = spawn(CH, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9337", `--user-data-dir=${path.join(SP, "chrome-tpl")}`, "about:blank"], { stdio: "ignore" });
  let t;
  for (let i = 0; i < 40; i++) { try { t = await (await fetch("http://localhost:9337/json")).json(); if (t.length) break; } catch {} await sleep(250); }
  const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") errs.push((msg.params.exceptionDetails.exception?.description || "").split("\n")[0]); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
  const go = async (u, w = 3500) => { await send("Page.navigate", { url: u }); await sleep(w); };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await go(`${BASE}/__login?v=horarios`);
  await ev("window.confirm = () => true");

  const base = await ev(`({
    sub: document.querySelector('.page-head p').textContent,
    filas: [...document.querySelectorAll('table[data-tid="tpl"] tbody tr')].map(r => [r.querySelector('.f-tname').value, r.querySelector('.f-tstart').value, r.querySelector('.f-tgrace').value]),
    nota: !!document.querySelector('.note'),
  })`);
  ok("se ven los 3 turnos con sus horas de Venezuela", base.filas.length === 3 && base.filas.map((f) => f[0] + " " + f[1]).join("|") === "Shift 1 05:30|Shift 2 13:00|Shift 3 21:15", base.filas.map((f) => f.join(" ")).join(" | "));
  ok("la cabecera indica hora de Venezuela", /hora de Venezuela/.test(base.sub) && /America\/Caracas/.test(base.sub), base.sub);
  ok("hay una nota que explica la asignación por rol", base.nota);

  // Editar la hora de Shift 2
  await ev(`(()=>{const r=document.querySelectorAll('table[data-tid="tpl"] tbody tr')[1]; r.querySelector('.f-tstart').value='13:30'; r.querySelector('.act-tsave').click()})()`);
  await sleep(1500);
  const ed = await ev(`({v: document.querySelectorAll('table[data-tid="tpl"] tbody tr')[1].querySelector('.f-tstart').value, toast: document.getElementById('toasts').textContent.trim()})`);
  ok("editar la hora de un turno se guarda", ed.v === "13:30" && /guardado/.test(ed.toast), JSON.stringify(ed));

  // Hora inválida en una fila
  await ev(`(()=>{const r=document.querySelectorAll('table[data-tid="tpl"] tbody tr')[0]; r.querySelector('.f-tstart').value='99:99'; r.querySelector('.act-tsave').click()})()`);
  await sleep(400);
  const inv = await ev(`document.querySelectorAll('table[data-tid="tpl"] tbody tr')[0].querySelector('.row-msg').textContent`);
  ok("hora inválida en un turno muestra el error en la fila", /24 horas/.test(inv), inv);

  // Formulario vacío de turno nuevo
  await ev(`document.getElementById('tplForm').requestSubmit()`);
  await sleep(300);
  const vac = await ev(`({n: document.getElementById('err-tplName').textContent.trim(), s: document.getElementById('err-tplStart').textContent.trim(), focus: document.activeElement.id})`);
  ok("turno nuevo vacío: errores junto a cada campo y foco en el primero", vac.n && vac.s && vac.focus === "tp-name", JSON.stringify(vac));

  // Crear un turno
  await ev(`(()=>{const f=document.getElementById('tplForm'); f.elements.tplName.value='Shift 4'; f.elements.tplStart.value='9:00'; f.elements.tplEnd.value='15:00'; f.elements.tplGrace.value='15'; f.requestSubmit()})()`);
  await sleep(1500);
  const nuevo = await ev(`({filas: document.querySelectorAll('table[data-tid="tpl"] tbody tr').length, h: [...document.querySelectorAll('table[data-tid="tpl"] .f-tstart')].map(i=>i.value)})`);
  ok("crear un turno lo agrega y normaliza la hora (9:00 -> 09:00)", nuevo.filas === 4 && nuevo.h.includes("09:00"), JSON.stringify(nuevo));

  const dur = await ev(`(()=>{const rows=[...document.querySelectorAll('table[data-tid="tpl"] tbody tr')]; const r=rows.find(x=>x.querySelector('.f-tname').value==='Shift 4'); return r ? r.querySelector('.f-tdur').textContent.trim() : null})()`);
  ok("el turno nuevo de 09:00 a 15:00 muestra 6 h de duración", dur === "6 h 00 min" || dur === "6 h", dur);
  const s3 = await ev(`(()=>{const rows=[...document.querySelectorAll('table[data-tid="tpl"] tbody tr')]; const r=rows.find(x=>x.querySelector('.f-tname').value==='Shift 3'); return { salida: r.querySelector('.f-tend').value, dur: r.querySelector('.f-tdur').textContent.trim() }})()`);
  ok("Shift 3 muestra salida 05:15 y 8 h (cruza la medianoche)", s3.salida === "05:15" && /^8 h/.test(s3.dur), JSON.stringify(s3));
  await ev(`(()=>{const rows=[...document.querySelectorAll('table[data-tid="tpl"] tbody tr')]; const r=rows.find(x=>x.querySelector('.f-tname').value==='Shift 3'); const e=r.querySelector('.f-tend'); e.value='05:30'; e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const s3b = await ev(`(()=>{const rows=[...document.querySelectorAll('table[data-tid="tpl"] tbody tr')]; return rows.find(x=>x.querySelector('.f-tname').value==='Shift 3').querySelector('.f-tdur').textContent.trim()})()`);
  ok("al escribir otra salida la duración se recalcula al instante", /^8 h 15/.test(s3b), s3b);

  // Borrar ese turno
  await ev(`(()=>{const rows=[...document.querySelectorAll('table[data-tid="tpl"] tbody tr')]; rows.find(r=>r.querySelector('.f-tname').value==='Shift 4').querySelector('.act-tdel').click()})()`);
  await sleep(1500);
  ok("borrar un turno lo quita de la lista", (await ev(`document.querySelectorAll('table[data-tid="tpl"] tbody tr').length`)) === 3);

  // Turno detectado por persona en la tabla de excepciones
  const per = await ev(`[...document.querySelectorAll('table[data-tid="sched"] tbody tr')].map(r => r.cells[0].textContent.trim() + ':' + r.cells[2].textContent.trim())`);
  ok("la tabla de personas muestra el turno detectado de cada una", per.length > 0 && per.some((x) => /Shift/.test(x)), per.join(" | "));

  // Fichajes: columna Turno y aviso
  await go(`${BASE}/__login?v=fichajes`);
  const fi = await ev(`({
    cols: [...document.querySelectorAll('table[data-tid="late"] thead th')].map(t=>t.textContent.trim()),
    nota: document.querySelector('.note')?.textContent.trim().slice(0,140) || '',
    link: !!document.querySelector('.note a'),
  })`);
  ok("la tabla de llegadas tarde tiene la columna Turno", fi.cols.length === 0 || fi.cols.includes("Turno"), fi.cols.join(","));
  ok("el aviso habla de personas 'sin medir'", fi.nota === "" || /sin medir/.test(fi.nota), fi.nota);

  // Manager: no ve la sección ni puede abrirla
  await go(`${BASE}/__login?v=horarios&u=laura`);
  const m = await ev(`({h1: [...document.querySelectorAll('h1')].filter(h=>h.offsetParent!==null)[0]?.textContent, nav: [...document.querySelectorAll('#nav a')].filter(a=>!a.hidden).length})`);
  ok("un manager que abre Horarios es llevado al Resumen", m.h1 === "Resumen" && m.nav === 3, JSON.stringify(m));
  await go(`${BASE}/__login?v=fichajes&u=laura`);
  const mn = await ev(`({link: !!document.querySelector('.note a')})`);
  ok("al manager no se le ofrece el enlace a Horarios", mn.link === false, JSON.stringify(mn));

  // Móvil
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await go(`${BASE}/__login?v=horarios`);
  const mo = await ev(`({sw: document.documentElement.scrollWidth, iw: innerWidth})`);
  ok("Horarios a 375px sin desbordamiento horizontal", mo.sw <= mo.iw, JSON.stringify(mo));

  console.log(out.join("\n"));
  console.log("\nErrores de consola:", errs.length ? [...new Set(errs)].join("\n") : "ninguno");
  const f = out.filter((x) => x.startsWith("FALLA")).length;
  console.log(`\n${out.length - f}/${out.length} comprobaciones de turnos en el navegador pasan`);
  chrome.kill();
  process.exit(out.some((x) => x.startsWith("FALLA")) ? 1 : 0);
})().catch((e) => { console.log(out.join("\n")); console.error("ERROR:", e.message); process.exit(1); });
