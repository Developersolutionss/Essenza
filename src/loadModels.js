// Carga/actualiza las modelos desde models.json.
// Uso: node src/loadModels.js
//
// Una modelo queda ACTIVA (visible en el bot y la web) si tiene voice_id.
// Sin voice_id se registra inactiva.
const fs = require("fs");
const path = require("path");
const db = require("./db");

const entries = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "models.json"), "utf8"));

const findModel = db.prepare("SELECT id FROM models WHERE name = ?");
const insertModel = db.prepare("INSERT INTO models (name, provider, voice_id, active) VALUES (?, 'elevenlabs', ?, ?)");
const updateModel = db.prepare("UPDATE models SET voice_id = ?, active = ? WHERE id = ?");

for (const e of entries) {
  const voiceId = (e.voice_id || "").trim();
  const active = voiceId ? 1 : 0;
  const model = findModel.get(e.name);
  if (!model) insertModel.run(e.name, voiceId || "PENDIENTE", active);
  else updateModel.run(voiceId || "PENDIENTE", active, model.id);
  console.log(`${active ? "ACTIVA  " : "inactiva"}  ${e.name}${active ? "" : "  (falta voice_id)"}`);
}
