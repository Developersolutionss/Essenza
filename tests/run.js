// Ejecuta las pruebas de servidor (tests/server/*.test.js), cada una en su propio
// proceso y con una base de datos temporal. No llama a ElevenLabs ni a Discord.
//
//   npm test                 todas
//   npm test -- turnos       solo las que contengan "turnos" en el nombre
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "server");
const filter = process.argv[2];
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.js") && (!filter || f.includes(filter)))
  .sort();

if (!files.length) {
  console.error(filter ? `Ninguna prueba coincide con "${filter}".` : "No hay pruebas.");
  process.exit(1);
}

// Una línea de resumen por prueba: "22/22 pruebas ... pasan".
const summaryOf = (text) => (text.match(/\d+\/\d+ [^\n]*pasan/g) || []).pop() || "sin resumen";

let failed = 0;
const started = Date.now();
for (const f of files) {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(dir, f)], {
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, ELEVENLABS_API_KEY: "", DISCORD_TOKEN: "" },
  });
  const text = (r.stdout || "") + (r.stderr || "");
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "✔" : "✘"} ${f.padEnd(26)} ${summaryOf(text)}`);
  if (!ok) {
    const lines = text.split("\n").filter((l) => /FALLA|ERROR|Error/.test(l));
    console.log(lines.slice(0, 12).map((l) => "    " + l.slice(0, 200)).join("\n") || "    " + text.slice(-600));
  }
}

console.log(`\n${files.length - failed}/${files.length} archivos de pruebas pasan (${((Date.now() - started) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
