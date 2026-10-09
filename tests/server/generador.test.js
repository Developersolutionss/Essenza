// Esta prueba se ejecuta con `npm test` (ver tests/run.js).
const PROJECT_ROOT = require("path").resolve(__dirname, "..", "..");
// Pruebas del generador con proveedor y almacén de audio falsos, y base temporal.
// No toca la base real ni llama a ElevenLabs.
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = PROJECT_ROOT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "essensa-gen-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.TIMEZONE = "America/Bogota";
process.env.MAX_TEXT_CHARS = "1000";

// Almacén de audio falso: escribe en la carpeta temporal, nunca en data/audio.
const audioStorePath = require.resolve(path.join(ROOT, "src/audioStore.js"));
const realStore = require(audioStorePath);
const fakeDir = path.join(tmp, "audio");
fs.mkdirSync(fakeDir, { recursive: true });
require.cache[audioStorePath].exports = {
  hashText: realStore.hashText,
  save(modelId, hash, buf) {
    const p = path.join(fakeDir, `${modelId}_${hash}.mp3`);
    fs.writeFileSync(p, buf);
    return p;
  },
  read: (p) => fs.readFileSync(p),
  audioDir: fakeDir,
};

// Proveedor falso: cuenta llamadas y puede tardar o fallar a voluntad.
const providersPath = require.resolve(path.join(ROOT, "src/providers/index.js"));
const prov = { calls: 0, delay: 0, fail: false, lastText: null };
require.cache[providersPath] = {
  id: providersPath,
  filename: providersPath,
  loaded: true,
  exports: {
    getProvider: () => ({
      async generate({ text }) {
        prov.calls++;
        prov.lastText = text;
        if (prov.delay) await new Promise((r) => setTimeout(r, prov.delay));
        if (prov.fail) throw new Error("fallo simulado del proveedor");
        return Buffer.from("MP3:" + text);
      },
    }),
  },
};

const db = require(path.join(ROOT, "src/db"));
const gen = require(path.join(ROOT, "src/generator"));

db.prepare("INSERT INTO chatters (id, name, daily_char_limit) VALUES (1,'Ana',20000)").run();
db.prepare("INSERT INTO chatters (id, name, daily_char_limit) VALUES (2,'Topeado',100)").run();
db.prepare("INSERT INTO chatters (id, name, active) VALUES (3,'Inactivo',0)").run();
db.prepare("INSERT INTO models (id, name, voice_id) VALUES (1,'Amelia','V1')").run();
db.prepare("INSERT INTO models (id, name, voice_id, active) VALUES (2,'Apagada','V2',0)").run();
db.prepare("INSERT INTO models (id, name, voice_id) VALUES (3,'SinVoz','PENDIENTE')").run();

const out = [];
const ok = (name, cond, extra = "") => out.push(`${cond ? "PASA " : "FALLA"}  ${name}${extra ? "  -> " + extra : ""}`);
const usage = (c) => db.prepare("SELECT COALESCE(SUM(char_count),0) t FROM usage_log WHERE chatter_id=? AND from_cache=0").get(c).t;
const rows = (sql, ...a) => db.prepare(sql).all(...a);
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

(async () => {
  // 1) Primera generación
  prov.calls = 0;
  let r = await gen.generateAudio({ chatterId: 1, modelId: 1, text: "Hola amor" });
  ok("primera llamada genera y llama al proveedor una vez", r.source === "generated" && prov.calls === 1 && r.buffer.toString() === "MP3:Hola amor");
  ok("queda un registro de consumo pagado", rows("SELECT * FROM usage_log WHERE from_cache=0").length === 1);

  // 2) Caché (con mayúsculas y espacios distintos)
  prov.calls = 0;
  r = await gen.generateAudio({ chatterId: 1, modelId: 1, text: "  HOLA AMOR  " });
  ok("segunda llamada sale del caché sin pagar", r.source === "cache" && prov.calls === 0);
  ok("el contador de reutilizaciones sube", db.prepare("SELECT hits FROM audio_cache").get().hits === 1);

  // 3) Dos pedidos simultáneos de la MISMA frase nueva
  prov.calls = 0;
  prov.delay = 120;
  const [a, b] = await Promise.all([
    gen.generateAudio({ chatterId: 1, modelId: 1, text: "frase nueva simultanea" }),
    gen.generateAudio({ chatterId: 1, modelId: 1, text: "frase nueva simultanea" }),
  ]);
  prov.delay = 0;
  ok("misma frase nueva a la vez: se paga UNA sola vez", prov.calls === 1, `llamadas=${prov.calls}`);
  ok("las dos reciben el audio y ninguna da error", a.buffer.length > 0 && b.buffer.length > 0 && a.buffer.equals(b.buffer));
  ok("solo queda una fila en el caché", rows("SELECT * FROM audio_cache WHERE text='frase nueva simultanea'").length === 1);

  // 4) Límite con pedidos simultáneos: chatter 2 tiene 100
  prov.calls = 0;
  prov.delay = 60;
  const sixty = "x".repeat(60);
  const res = await Promise.allSettled([
    gen.generateAudio({ chatterId: 2, modelId: 1, text: sixty + "a" }),
    gen.generateAudio({ chatterId: 2, modelId: 1, text: sixty + "b" }),
    gen.generateAudio({ chatterId: 2, modelId: 1, text: sixty + "c" }),
  ]);
  prov.delay = 0;
  const okCount = res.filter((x) => x.status === "fulfilled").length;
  const rejected = res.filter((x) => x.status === "rejected");
  ok("límite 100 con 3 pedidos de 61 a la vez: solo pasa uno", okCount === 1, `aceptados=${okCount} usado=${usage(2)}`);
  ok("el consumo no supera el límite", usage(2) <= 100, `usado=${usage(2)}`);
  ok("los rechazados dan 429", rejected.every((x) => x.reason.status === 429));

  // 5) Fallo del proveedor: se devuelve la cuota
  const before = usage(1);
  prov.fail = true;
  const e5 = await err(() => gen.generateAudio({ chatterId: 1, modelId: 1, text: "esto va a fallar" }));
  prov.fail = false;
  ok("fallo del proveedor da 502", e5 && e5.status === 502);
  ok("tras el fallo NO se descuenta cuota", usage(1) === before, `antes=${before} ahora=${usage(1)}`);
  ok("el 502 no filtra el detalle del proveedor", !e5.detail);

  // 6) mp3 borrado: se regenera en vez de quedar roto
  const row = db.prepare("SELECT * FROM audio_cache WHERE text='Hola amor'").get();
  fs.unlinkSync(row.file_path);
  prov.calls = 0;
  r = await gen.generateAudio({ chatterId: 1, modelId: 1, text: "Hola amor" });
  ok("si falta el mp3 se regenera y se entrega", r.source === "generated" && prov.calls === 1 && r.buffer.length > 0);
  ok("no quedan filas duplicadas en el caché", rows("SELECT * FROM audio_cache WHERE text='Hola amor'").length === 1);

  // 7) Caché disponible aunque el chatter esté en el límite
  prov.calls = 0;
  r = await gen.generateAudio({ chatterId: 2, modelId: 1, text: sixty + "a" });
  ok("topeado puede usar audios ya cacheados (no cuestan)", r.source === "cache" && prov.calls === 0);

  // 8) Validaciones
  const e8a = await err(() => gen.generateAudio({ chatterId: 1, modelId: 1, text: "y".repeat(1001) }));
  ok("texto demasiado largo da 400 y no llama al proveedor", e8a.status === 400 && prov.calls === 0);
  const e8b = await err(() => gen.generateAudio({ chatterId: 1, modelId: 3, text: "hola" }));
  ok("modelo sin voz cargada da 409", e8b.status === 409);
  const e8c = await err(() => gen.generateAudio({ chatterId: 3, modelId: 1, text: "hola" }));
  ok("chatter inactivo da 404", e8c.status === 404);
  const e8d = await err(() => gen.generateAudio({ chatterId: 1, modelId: 2, text: "hola" }));
  ok("modelo inactivo da 404", e8d.status === 404);
  const e8e = await err(() => gen.generateAudio({ chatterId: 1, modelId: 1, text: "   " }));
  ok("texto vacío da 400", e8e.status === 400);

  // 9) Se cobra lo que se cuenta
  prov.calls = 0;
  const padded = "   texto con espacios   ";
  await gen.generateAudio({ chatterId: 1, modelId: 1, text: padded });
  ok("al proveedor se le manda el texto recortado que se cuenta", prov.lastText === padded.trim(), `enviado="${prov.lastText}"`);

  console.log(out.join("\n"));
  const fails = out.filter((x) => x.startsWith("FALLA")).length;
  console.log(`\n${out.length - fails}/${out.length} pruebas del generador pasan`);
  try { db.close(); } catch {}; try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(out.join("\n")); console.error("ERROR:", e); try { db.close(); } catch {}; try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} process.exit(1); });
