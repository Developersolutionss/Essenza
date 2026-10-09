const express = require("express");
const db = require("./db");
const tzu = require("./timezone");
const auth = require("./auth");
const { generateAudio, GenerationError } = require("./generator");

const router = express.Router();

// La web la usan las mismas cuentas del panel. Generar audio gasta créditos de
// ElevenLabs, así que exige sesión; el canal normal de los chatters es Discord.

router.get("/session", (req, res) => {
  const user = auth.currentUser(req);
  res.json({ authenticated: Boolean(user), user: user || null });
});
// ---- Modelos ----

router.get("/models", auth.requireAuth, (req, res) => {
  const models = db
    .prepare("SELECT id, name, provider FROM models WHERE active = 1 ORDER BY name")
    .all();
  res.json(models);
});

// ---- Chatters (para elegir a quién se le anota el consumo) ----

router.get("/chatters", auth.requireAuth, (req, res) => {
  res.json(db.prepare("SELECT id, name FROM chatters WHERE active = 1 ORDER BY name").all());
});

// ---- Frases pre-armadas ----

router.get("/phrases", auth.requireAuth, (req, res) => {
  const phrases = db.prepare("SELECT id, label, text FROM phrases ORDER BY label").all();
  res.json(phrases);
});

// Crear frases es trabajo operativo: también lo hacen los managers.
router.post("/phrases", auth.requireAuth, (req, res) => {
  const label = String(req.body?.label || "").trim();
  const text = String(req.body?.text || "").trim();
  if (!label || !text) return res.status(400).json({ error: "label y text son requeridos" });
  if (label.length > 80) return res.status(400).json({ error: "El nombre de la frase es demasiado largo" });
  if (text.length > 1000) return res.status(400).json({ error: "La frase es demasiado larga" });
  const info = db.prepare("INSERT INTO phrases (label, text) VALUES (?, ?)").run(label, text);
  res.status(201).json({ id: Number(info.lastInsertRowid), label, text });
});

// ---- Generación de audio ----

router.post("/generate", auth.requireAuth, async (req, res) => {
  const { chatter_id, model_id, text } = req.body || {};
  try {
    const { buffer, source } = await generateAudio({
      chatterId: Number(chatter_id),
      modelId: Number(model_id),
      text: typeof text === "string" ? text : "",
    });
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Audio-Source", source);
    res.send(buffer);
  } catch (err) {
    if (err instanceof GenerationError) {
      // El detalle del proveedor se queda en el servidor; al cliente solo el mensaje.
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

// ---- Resumen de uso (solo managers) ----

router.get("/usage/summary", auth.requireAuth, (req, res) => {
  const dayStart = tzu.sqlTime(tzu.startOfLocalDay(Date.now()));
  const monthStart = tzu.sqlTime(tzu.startOfLocalMonth(Date.now()));

  const byChatter = db
    .prepare(
      `SELECT c.id AS chatter_id, c.name, SUM(u.char_count) AS chars_today
       FROM usage_log u
       JOIN chatters c ON c.id = u.chatter_id
       WHERE u.created_at >= ? AND u.from_cache = 0
       GROUP BY c.id
       ORDER BY chars_today DESC`
    )
    .all(dayStart);

  const byModel = db
    .prepare(
      `SELECT m.id AS model_id, m.name, SUM(u.char_count) AS chars_this_month
       FROM usage_log u
       JOIN models m ON m.id = u.model_id
       WHERE u.created_at >= ? AND u.from_cache = 0
       GROUP BY m.id
       ORDER BY chars_this_month DESC`
    )
    .all(monthStart);

  res.json({ byChatter, byModel });
});

module.exports = router;
