const db = require("./db");
const audioStore = require("./audioStore");
const { getProvider } = require("./providers");

const DEFAULT_DAILY_LIMIT = 20000;

class GenerationError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// Lógica única de generación, usada por la API web y por el bot de Discord.
// Devuelve { buffer, source: "cache" | "generated" } o lanza GenerationError.
async function generateAudio({ chatterId, modelId, text }) {
  if (!chatterId || !modelId || !text || !text.trim()) {
    throw new GenerationError(400, "chatter_id, model_id y text son requeridos");
  }

  const chatter = db.prepare("SELECT * FROM chatters WHERE id = ? AND active = 1").get(chatterId);
  if (!chatter) throw new GenerationError(404, "Chatter no encontrado o inactivo");

  const model = db.prepare("SELECT * FROM models WHERE id = ? AND active = 1").get(modelId);
  if (!model) throw new GenerationError(404, "Modelo no encontrado o inactivo");

  const charCount = text.trim().length;
  const usedToday = getUsedToday(chatterId);
  const limit = chatter.daily_char_limit || DEFAULT_DAILY_LIMIT;
  if (usedToday + charCount > limit) {
    throw new GenerationError(
      429,
      `Límite diario de caracteres alcanzado (${usedToday}/${limit}). Hablá con tu manager si necesitás más.`
    );
  }

  const textHash = audioStore.hashText(text);

  // 1) Caché primero: no se le paga al proveedor dos veces la misma frase.
  const cached = db
    .prepare("SELECT * FROM audio_cache WHERE model_id = ? AND text_hash = ?")
    .get(modelId, textHash);

  if (cached) {
    db.prepare("UPDATE audio_cache SET hits = hits + 1 WHERE id = ?").run(cached.id);
    db.prepare(
      "INSERT INTO usage_log (chatter_id, model_id, char_count, from_cache) VALUES (?, ?, ?, 1)"
    ).run(chatterId, modelId, charCount);
    return { buffer: audioStore.read(cached.file_path), source: "cache" };
  }

  // 2) Generar con el proveedor configurado para este modelo.
  let buffer;
  try {
    const provider = getProvider(model.provider);
    buffer = await provider.generate({ voiceId: model.voice_id, text });
  } catch (err) {
    console.error(err);
    throw new GenerationError(502, "Error generando audio con el proveedor de voz", err.message);
  }

  const filePath = audioStore.save(modelId, textHash, buffer);
  db.prepare(
    `INSERT INTO audio_cache (model_id, text_hash, text, file_path, char_count)
     VALUES (?, ?, ?, ?, ?)`
  ).run(modelId, textHash, text, filePath, charCount);
  db.prepare(
    "INSERT INTO usage_log (chatter_id, model_id, char_count, from_cache) VALUES (?, ?, ?, 0)"
  ).run(chatterId, modelId, charCount);

  return { buffer, source: "generated" };
}

function getUsedToday(chatterId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(char_count), 0) AS total
       FROM usage_log
       WHERE chatter_id = ? AND from_cache = 0 AND date(created_at) = date('now')`
    )
    .get(chatterId).total;
}

module.exports = { generateAudio, getUsedToday, GenerationError, DEFAULT_DAILY_LIMIT };
