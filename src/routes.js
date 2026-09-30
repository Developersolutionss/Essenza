const express = require("express");
const db = require("./db");
const { generateAudio, GenerationError } = require("./generator");

const router = express.Router();

// ---- Modelos ----

router.get("/models", (req, res) => {
  const models = db
    .prepare("SELECT id, name, provider, active FROM models WHERE active = 1 ORDER BY name")
    .all();
  res.json(models);
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

// ---- Generación de audio ----

router.post("/generate", async (req, res) => {
  const { chatter_id, model_id, text } = req.body;
  try {
    const { buffer, source } = await generateAudio({
      chatterId: chatter_id,
      modelId: model_id,
      text,
    });
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Audio-Source", source);
    res.send(buffer);
  } catch (err) {
    if (err instanceof GenerationError) {
      return res.status(err.status).json({ error: err.message, detail: err.detail });
    }
    console.error(err);
    res.status(500).json({ error: "Error interno" });
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
