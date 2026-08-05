const express = require("express");
const db = require("./db");
const audioStore = require("./audioStore");
const { getProvider } = require("./providers");

const router = express.Router();

// ---- Modelos ----

router.get("/models", (req, res) => {
  const models = db
    .prepare("SELECT id, name, provider, active FROM models WHERE active = 1 ORDER BY name")
    .all();
  res.json(models);
});

router.post("/models", (req, res) => {
  const { name, provider = "elevenlabs", voice_id } = req.body;
  if (!name || !voice_id) return res.status(400).json({ error: "name y voice_id son requeridos" });

  try {
    const info = db
      .prepare("INSERT INTO models (name, provider, voice_id) VALUES (?, ?, ?)")
      .run(name, provider, voice_id);
    res.status(201).json({ id: info.lastInsertRowid, name, provider, voice_id });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Ya existe un modelo con ese nombre" });
    }
    console.error(err);
    res.status(500).json({ error: "Error guardando el modelo" });
  }
});

// ---- Frases pre-armadas ----

router.get("/phrases", (req, res) => {
  const phrases = db.prepare("SELECT id, label, text FROM phrases ORDER BY label").all();
  res.json(phrases);
});

router.post("/phrases", (req, res) => {
  const { label, text } = req.body;
  if (!label || !text) return res.status(400).json({ error: "label y text son requeridos" });
  const info = db
    .prepare("INSERT INTO phrases (label, text) VALUES (?, ?)")
    .run(label, text);
  res.status(201).json({ id: info.lastInsertRowid, label, text });
});

// ---- Consentimiento de la modelo ----

router.post("/model-consent", (req, res) => {
  const {
    model_id,
    signed_document_path,
    verification_audio_path,
    consented_at,
    commercial_use,
    notes,
  } = req.body;

  if (!model_id || !signed_document_path || !consented_at) {
    return res.status(400).json({ error: "model_id, signed_document_path y consented_at son requeridos" });
  }

  const model = db.prepare("SELECT id FROM models WHERE id = ?").get(model_id);
  if (!model) return res.status(404).json({ error: "Modelo no encontrado" });

  const info = db
    .prepare(
      `INSERT INTO model_consent
         (model_id, signed_document_path, verification_audio_path, consented_at, commercial_use, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      model_id,
      signed_document_path,
      verification_audio_path || null,
      consented_at,
      commercial_use ? 1 : 0,
      notes || null
    );

  res.status(201).json({ id: info.lastInsertRowid, model_id });
});

// ---- Generación de audio ----

const DEFAULT_DAILY_LIMIT = 20000;

router.post("/generate", async (req, res) => {
  const { chatter_id, model_id, text } = req.body;

  if (!chatter_id || !model_id || !text || !text.trim()) {
    return res.status(400).json({ error: "chatter_id, model_id y text son requeridos" });
  }

  const chatter = db.prepare("SELECT * FROM chatters WHERE id = ? AND active = 1").get(chatter_id);
  if (!chatter) return res.status(404).json({ error: "Chatter no encontrado o inactivo" });

  const model = db.prepare("SELECT * FROM models WHERE id = ? AND active = 1").get(model_id);
  if (!model) return res.status(404).json({ error: "Modelo no encontrado o inactivo" });

  const consent = db
    .prepare("SELECT id FROM model_consent WHERE model_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(model_id);
  if (!consent) {
    return res.status(403).json({
      error: "Esta modelo no tiene un registro de consentimiento cargado. No se puede generar audio.",
    });
  }

  const charCount = text.trim().length;

  const usedToday = db
    .prepare(
      `SELECT COALESCE(SUM(char_count), 0) AS total
       FROM usage_log
       WHERE chatter_id = ? AND from_cache = 0 AND date(created_at) = date('now')`
    )
    .get(chatter_id).total;

  const limit = chatter.daily_char_limit || DEFAULT_DAILY_LIMIT;
  if (usedToday + charCount > limit) {
    return res.status(429).json({
      error: `Límite diario de caracteres alcanzado (${usedToday}/${limit}). Hablá con tu manager si necesitás más.`,
    });
  }

  const textHash = audioStore.hashText(text);

  // 1) Buscar en caché primero — no le pagamos al proveedor dos veces la misma frase.
  const cached = db
    .prepare("SELECT * FROM audio_cache WHERE model_id = ? AND text_hash = ?")
    .get(model_id, textHash);

  if (cached) {
    db.prepare("UPDATE audio_cache SET hits = hits + 1 WHERE id = ?").run(cached.id);
    db.prepare(
      "INSERT INTO usage_log (chatter_id, model_id, char_count, from_cache) VALUES (?, ?, ?, 1)"
    ).run(chatter_id, model_id, charCount);

    const buffer = audioStore.read(cached.file_path);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Audio-Source", "cache");
    return res.send(buffer);
  }

  // 2) No está en caché: generar con el proveedor configurado para este modelo.
  try {
    const provider = getProvider(model.provider);
    const buffer = await provider.generate({ voiceId: model.voice_id, text });

    const filePath = audioStore.save(model_id, textHash, buffer);

    db.prepare(
      `INSERT INTO audio_cache (model_id, text_hash, text, file_path, char_count)
       VALUES (?, ?, ?, ?, ?)`
    ).run(model_id, textHash, text, filePath, charCount);

    db.prepare(
      "INSERT INTO usage_log (chatter_id, model_id, char_count, from_cache) VALUES (?, ?, ?, 0)"
    ).run(chatter_id, model_id, charCount);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Audio-Source", "generated");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Error generando audio con el proveedor de voz", detail: err.message });
  }
});

// ---- Dashboard de uso (para managers) ----

router.get("/usage/summary", (req, res) => {
  const byChatter = db
    .prepare(
      `SELECT c.id AS chatter_id, c.name, SUM(u.char_count) AS chars_today
       FROM usage_log u
       JOIN chatters c ON c.id = u.chatter_id
       WHERE date(u.created_at) = date('now') AND u.from_cache = 0
       GROUP BY c.id
       ORDER BY chars_today DESC`
    )
    .all();

  const byModel = db
    .prepare(
      `SELECT m.id AS model_id, m.name, SUM(u.char_count) AS chars_this_month
       FROM usage_log u
       JOIN models m ON m.id = u.model_id
       WHERE strftime('%Y-%m', u.created_at) = strftime('%Y-%m', 'now') AND u.from_cache = 0
       GROUP BY m.id
       ORDER BY chars_this_month DESC`
    )
    .all();

  res.json({ byChatter, byModel });
});

module.exports = router;
