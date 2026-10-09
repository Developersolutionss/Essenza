// Se ejecuta con `npm run test:browser` (ver tests/browser/run.js).
// Comprueba en el navegador que el rol cambia lo que se ve.
const { spawn } = require("child_process");
const path = require("path");
const CH = require("./chrome").path;
const SP = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "essenza-browser-"));
const BASE = "http://localhost:3999";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (n, c, e = "") => out.push(`${c ? "PASA " : "FALLA"}  ${n}${e ? "  -> " + e : ""}`);

(async () => {
  const chrome = spawn(CH, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9336", `--user-data-dir=${path.join(SP, "chrome-roles")}`, "about:blank"], { stdio: "ignore" });
  let t;
  for (let i = 0; i < 40; i++) { try { t = await (await fetch("http://localhost:9336/json")).json(); if (t.length) break; } catch {} await sleep(250); }
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

  /* ---- Administrador ---- */
  await go(`${BASE}/__login?v=resumen`);
  const adm = await ev(`({
    nav: [...document.querySelectorAll('#nav a')].filter(a=>!a.hidden).map(a=>a.dataset.route),
    who: document.getElementById('whoami').textContent,
  })`);
  ok("el admin ve las 5 secciones", adm.nav.length === 5 && adm.nav.includes("cuentas") && adm.nav.includes("horarios"), adm.nav.join(","));
  ok("se muestra quién tiene la sesión y su rol", /Administrador/.test(adm.who), adm.who);

  await go(`${BASE}/__login?v=cuentas`);
  const cu = await ev(`({
    rows: document.querySelectorAll('table[data-tid="users"] tbody tr').length,
    formulario: !!document.getElementById('userForm'),
    pass: !!document.getElementById('passForm'),
    title: document.title,
  })`);
  ok("la sección Cuentas lista las personas y trae los formularios", cu.rows >= 2 && cu.formulario && cu.pass, JSON.stringify(cu));

  // Crear una cuenta desde la interfaz
  await ev(`(()=>{const f=document.getElementById('userForm');
    f.elements.displayName.value='Nueva Persona';
    f.elements.username.value='nueva.persona';
    f.elements.password.value='contrasena-muy-larga';
    f.elements.role.value='manager';
    f.requestSubmit();})()`);
  await sleep(1800);
  const after = await ev(`({rows: document.querySelectorAll('table[data-tid="users"] tbody tr').length, toast: document.getElementById('toasts').textContent.trim()})`);
  ok("crear una cuenta desde la interfaz funciona", after.rows === cu.rows + 1 && /creada/.test(after.toast), JSON.stringify(after));

  // Validación: contraseña corta
  await ev(`(()=>{const f=document.getElementById('userForm');
    f.elements.displayName.value='X'; f.elements.username.value='xx'; f.elements.password.value='corta'; f.requestSubmit();})()`);
  await sleep(400);
  const val = await ev(`({u: document.getElementById('err-username').textContent.trim(), p: document.getElementById('err-password').textContent.trim(), focus: document.activeElement.id})`);
  ok("usuario y contraseña inválidos se avisan junto al campo", val.u && val.p && val.focus === "u-user", JSON.stringify(val));

  /* ---- Manager ---- */
  await go(`${BASE}/__login?v=resumen&u=laura`);
  const man = await ev(`({
    nav: [...document.querySelectorAll('#nav a')].filter(a=>!a.hidden).map(a=>a.dataset.route),
    who: document.getElementById('whoami').textContent,
  })`);
  ok("el manager NO ve Cuentas ni Horarios", man.nav.length === 3 && !man.nav.includes("cuentas") && !man.nav.includes("horarios"), man.nav.join(","));
  ok("el manager se identifica como tal", /Manager/.test(man.who), man.who);

  await go(`${BASE}/__login?v=cuentas&u=laura`);
  const redir = await ev(`({hash: location.hash, h1: [...document.querySelectorAll('h1')].filter(h=>h.offsetParent!==null)[0]?.textContent, nav: [...document.querySelectorAll('#nav a')].filter(a=>!a.hidden).length})`);
  ok("si un manager escribe la dirección de Cuentas, se le lleva al Resumen", redir.h1 === "Resumen", JSON.stringify(redir));

  await go(`${BASE}/__login?v=fichajes&u=laura`);
  const mf = await ev(`({cerrar: document.querySelectorAll('.act-close').length, tablas: document.querySelectorAll('table').length})`);
  ok("el manager sí ve los fichajes y puede cerrar turnos", mf.tablas > 0, JSON.stringify(mf));

  /* ---- Barra inferior en móvil con los dos roles ---- */
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  for (const [u, esperado] of [["admin", 5], ["laura", 3]]) {
    await go(`${BASE}/__login?v=resumen&u=${u}`);
    const nav = await ev(`(()=>{const items=[...document.querySelectorAll('#nav a')].filter(a=>!a.hidden);
      const tops=new Set(items.map(a=>Math.round(a.getBoundingClientRect().top)));
      return {n: items.length, filas: tops.size, overflow: document.documentElement.scrollWidth > innerWidth};})()`);
    ok(`barra inferior en móvil con ${esperado} secciones: una sola fila`, nav.n === esperado && nav.filas === 1 && !nav.overflow, JSON.stringify(nav));
  }

  console.log(out.join("\n"));
  console.log("\nErrores de consola:", errs.length ? [...new Set(errs)].join("\n") : "ninguno");
  const f = out.filter((x) => x.startsWith("FALLA")).length;
  console.log(`\n${out.length - f}/${out.length} comprobaciones de roles pasan`);
  chrome.kill();
  process.exit(out.some((x) => x.startsWith("FALLA")) ? 1 : 0);
})().catch((e) => { console.log(out.join("\n")); console.error("ERROR:", e.message); process.exit(1); });
