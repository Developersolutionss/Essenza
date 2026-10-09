const express = require("express");
const db = require("./db");
const tzu = require("./timezone");
const { createAuth } = require("./auth");
const { generateAudio, GenerationError } = require("./generator");

const router = express.Router();

// La web de chatters también pide contraseña: expuesta en un VPS, /generate
// gasta créditos de ElevenLabs con solo escribir un chatter_id.
// Sin CHATTER_PASSWORD en el entorno, la web queda desactivada y solo funciona
// el bot de Discord.
const chatterAuth = createAuth({
  cookieName: "essensa_chatter",
  secretEnv: "CHATTER_PASSWORD",
  label: "Acceso de chatters",
});
const adminAuth = createAuth({
  cookieName: "essensa_admin",
  secretEnv: "ADMIN_PASSWORD",
  label: "Panel",
});

router.post("/login", (req, res) => chatterAuth.login(req, res));
router.post("/logout", (req, res) => chatterAuth.logout(req, res));
router.get("/session", (req, res) =>
  res.json({ enabled: chatterAuth.enabled(), authenticated: chatterAuth.check(req) })
);

// ---- Modelos ----

router.get("/models", chatterAuth.require, (req, res) => {
  const models = db
    .prepare("SELECT id, name, provider FROM models WHERE active = 1 ORDER BY name")
    .all();
  res.json(models);
});

// ---- Frases pre-armadas ----

router.get("/phrases", chatterAuth.require, (req, res) => {
  const phrases = db.prepare("SELECT id, label, text FROM phrases ORDER BY label").all();
  res.json(phrases);
});

// Crear frases es cosa de managers: las frases las disparan luego los chatters.
router.post("/phrases", adminAuth.require, (req, res) => {
  const label = String(req.body?.label || "").trim();
  const text = String(req.body?.text || "").trim();
  if (!label || !text) return res.status(400).json({ error: "label y text son requeridos" });
  if (label.length > 80) return res.status(400).json({ error: "El nombre de la frase es demasiado largo" });
  if (text.length > 1000) return res.status(400).json({ error: "La frase es demasiado larga" });
  const info = db.prepare("INSERT INTO phrases (label, text) VALUES (?, ?)").run(label, text);
  res.status(201).json({ id: Number(info.lastInsertRowid), label, text });
});

// ---- Generación de audio ----

router.post("/generate", chatterAuth.require, async (req, res) => {
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

router.get("/usage/summary", adminAuth.require, (req, res) => {
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
