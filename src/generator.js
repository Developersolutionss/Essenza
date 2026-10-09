const db = require("./db");
const audioStore = require("./audioStore");
const tzu = require("./timezone");
const { getProvider } = require("./providers");

const DEFAULT_DAILY_LIMIT = 20000;
// Tope de caracteres por pedido. Evita que un texto enorme queme el presupuesto
// de golpe o supere el máximo por petición del proveedor.
const MAX_TEXT_CHARS = Number(process.env.MAX_TEXT_CHARS || 1000);

class GenerationError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// Generaciones en curso, por (modelo + hash del texto). Si dos personas piden la
// misma frase nueva a la vez, la segunda espera a la primera en lugar de pagarla
// otra vez. Vale para un único proceso Node, que es como corre este sistema.
const inFlight = new Map();

// Lógica única de generación, usada por la API web y por el bot de Discord.
// Devuelve { buffer, source: "cache" | "generated" } o lanza GenerationError.
async function generateAudio({ chatterId, modelId, text }) {
  if (!chatterId || !modelId || !text || !text.trim()) {
    throw new GenerationError(400, "chatter_id, model_id y text son requeridos");
  }

  // Al proveedor se le manda el mismo texto que se cobra y se cuenta.
  const cleanText = text.trim();
  if (cleanText.length > MAX_TEXT_CHARS) {
    throw new GenerationError(
      400,
      `El texto supera el máximo de ${MAX_TEXT_CHARS} caracteres (tiene ${cleanText.length}).`
    );
  }

  const chatter = db.prepare("SELECT * FROM chatters WHERE id = ? AND active = 1").get(chatterId);
  if (!chatter) throw new GenerationError(404, "Chatter no encontrado o inactivo");

  const model = db.prepare("SELECT * FROM models WHERE id = ? AND active = 1").get(modelId);
  if (!model) throw new GenerationError(404, "Modelo no encontrado o inactivo");
  if (!model.voice_id || model.voice_id === "PENDIENTE") {
    throw new GenerationError(409, "Esta modelo todavía no tiene una voz cargada.");
  }

  const charCount = cleanText.length;
  const textHash = audioStore.hashText(cleanText);

  // 1) Caché primero: lo ya generado no cuesta nada, así que no lo frena el límite diario.
  const cached = readCached(modelId, textHash);
  if (cached) {
    db.prepare("UPDATE audio_cache SET hits = hits + 1 WHERE id = ?").run(cached.id);
    logUsage(chatterId, modelId, charCount, 1);
    return { buffer: cached.buffer, source: "cache" };
  }

  // 2) Si ya hay una generación idéntica en curso, esperarla en vez de pagar dos veces.
  const key = `${modelId}:${textHash}`;
  const running = inFlight.get(key);
  if (running) {
    const buffer = await running;
    logUsage(chatterId, modelId, charCount, 1);
    return { buffer, source: "cache" };
  }

  // 3) Reservar la cuota ANTES de llamar al proveedor. Este bloque es síncrono a
  //    propósito: sin ningún await entre la comprobación y el registro, dos
  //    pedidos simultáneos no pueden pasar los dos el límite.
  const usageId = reserveQuota(chatter, modelId, charCount);

  const work = (async () => {
    const provider = getProvider(model.provider);
    const buffer = await provider.generate({ voiceId: model.voice_id, text: cleanText });
    const filePath = audioStore.save(modelId, textHash, buffer);
    // Si otra generación ganó la carrera, no se pisa su fila: el audio es el mismo.
    db.prepare(
      `INSERT INTO audio_cache (model_id, text_hash, text, file_path, char_count)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(model_id, text_hash) DO NOTHING`
    ).run(modelId, textHash, cleanText, filePath, charCount);
    return buffer;
  })();

  inFlight.set(key, work);
  try {
    const buffer = await work;
    return { buffer, source: "generated" };
  } catch (err) {
    // No se gastó nada, o no se pudo entregar: se devuelve la cuota reservada.
    db.prepare("DELETE FROM usage_log WHERE id = ?").run(usageId);
    console.error("Error generando audio:", err.message);
    // El detalle puede traer el cuerpo de error del proveedor: se queda en el servidor.
    throw new GenerationError(502, "Error generando audio con el proveedor de voz");
  } finally {
    inFlight.delete(key);
  }
}

// Lee el audio en caché. Si el mp3 ya no está en disco, borra la fila huérfana
// para que el pedido se regenere en vez de quedar roto para siempre.
function readCached(modelId, textHash) {
  const row = db
    .prepare("SELECT * FROM audio_cache WHERE model_id = ? AND text_hash = ?")
    .get(modelId, textHash);
  if (!row) return null;
  try {
    return { id: row.id, buffer: audioStore.read(row.file_path) };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    console.warn(`Audio en caché perdido (${row.file_path}); se regenerará.`);
    db.prepare("DELETE FROM audio_cache WHERE id = ?").run(row.id);
    return null;
  }
}

function logUsage(chatterId, modelId, charCount, fromCache) {
  return Number(
    db
      .prepare("INSERT INTO usage_log (chatter_id, model_id, char_count, from_cache) VALUES (?, ?, ?, ?)")
      .run(chatterId, modelId, charCount, fromCache).lastInsertRowid
  );
}

// Comprueba el límite y registra el consumo en el mismo paso síncrono.
function reserveQuota(chatter, modelId, charCount) {
  const usedToday = getUsedToday(chatter.id);
  const limit = chatter.daily_char_limit || DEFAULT_DAILY_LIMIT;
  if (usedToday + charCount > limit) {
    throw new GenerationError(
      429,
      `Límite diario de caracteres alcanzado (${usedToday}/${limit}). Hablá con tu manager si necesitás más.`
    );
  }
  return logUsage(chatter.id, modelId, charCount, 0);
}

// "Hoy" según la zona horaria de la agencia (TIMEZONE), igual que el panel.
function getUsedToday(chatterId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(char_count), 0) AS total
       FROM usage_log
       WHERE chatter_id = ? AND from_cache = 0 AND created_at >= ?`
    )
    .get(chatterId, tzu.sqlTime(tzu.startOfLocalDay(Date.now()))).total;
}

module.exports = { generateAudio, getUsedToday, GenerationError, DEFAULT_DAILY_LIMIT, MAX_TEXT_CHARS };
