// Ejecuta las pruebas de interfaz (tests/browser/*.ui.js) en un navegador real.
// Para cada una levanta un servidor de prueba nuevo (tests/browser/harness.js) con una
// base de datos temporal. Necesita Chrome, Edge o Chromium (o CHROME_PATH).
//
//   npm run test:browser              todas
//   npm run test:browser -- tema      solo las que contengan "tema" en el nombre
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const chrome = require("./chrome");

if (!chrome.path) {
  console.error("No encontré Chrome, Edge ni Chromium. Instálalo o indica la ruta en CHROME_PATH.");
  process.exit(2);
}

const filter = process.argv[2];
const files = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".ui.js") && (!filter || f.includes(filter)))
  .sort();
if (!files.length) {
  console.error(filter ? `Ninguna prueba coincide con "${filter}".` : "No hay pruebas.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Levanta el servidor de prueba y espera a que avise que está listo.
function startHarness(dbPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", path.join(__dirname, "harness.js")], {
      env: { ...process.env, HARNESS_DB: dbPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    const timer = setTimeout(() => reject(new Error("El servidor de prueba no arrancó:\n" + buf)), 20000);
    const onData = (d) => {
      buf += d;
      if (buf.includes("harness listo")) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (!buf.includes("harness listo")) {
        clearTimeout(timer);
        reject(new Error(`El servidor de prueba terminó (${code}):\n${buf}`));
      }
    });
  });
}

function runTest(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--no-warnings", path.join(__dirname, file)], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 240000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

(async () => {
  let failed = 0;
  const started = Date.now();
  for (const f of files) {
    const dbPath = path.join(os.tmpdir(), `essenza-ui-${process.pid}-${Date.now()}.db`);
    let harness;
    let result;
    try {
      harness = await startHarness(dbPath);
      result = await runTest(f);
    } catch (e) {
      result = { code: 1, out: String(e.message || e) };
    } finally {
      if (harness) harness.kill();
      await sleep(600);
      for (const ext of ["", "-wal", "-shm"]) {
        try { fs.rmSync(dbPath + ext); } catch { /* en Windows puede seguir abierto un instante */ }
      }
      // Cada prueba crea un perfil de Chrome temporal (decenas de MB): se borra al terminar.
      for (const d of fs.readdirSync(os.tmpdir())) {
        if (!d.startsWith("essenza-browser-")) continue;
        const full = path.join(os.tmpdir(), d);
        try {
          if (fs.statSync(full).mtimeMs >= started - 1000) fs.rmSync(full, { recursive: true, force: true, maxRetries: 3 });
        } catch { /* Chrome puede tardar en soltar algún archivo */ }
      }
    }
    const summary = (result.out.match(/\d+\/\d+ [^\n]*pasan/g) || []).pop() || "sin resumen";
    const ok = result.code === 0;
    if (!ok) failed++;
    console.log(`${ok ? "✔" : "✘"} ${f.padEnd(24)} ${summary}`);
    if (!ok) {
      const lines = result.out.split("\n").filter((l) => /FALLA|ERROR|Error/.test(l));
      console.log(lines.slice(0, 12).map((l) => "    " + l.slice(0, 200)).join("\n") || "    " + result.out.slice(-600));
    }
  }
  console.log(`\n${files.length - failed}/${files.length} archivos de pruebas de interfaz pasan (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  process.exit(failed ? 1 : 0);
})();
