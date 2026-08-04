// Carga datos de prueba: un chatter y un modelo de ejemplo.
// Uso: node src/seed.js
const db = require("./db");

const chatter = db.prepare("SELECT id FROM chatters WHERE name = ?").get("Chatter de prueba");
if (!chatter) {
  db.prepare("INSERT INTO chatters (name, role, daily_char_limit) VALUES (?, 'chatter', 20000)").run(
    "Chatter de prueba"
  );
  console.log("Chatter de prueba creado.");
}

const model = db.prepare("SELECT id FROM models WHERE name = ?").get("Modelo de prueba");
if (!model) {
  const info = db
    .prepare("INSERT INTO models (name, provider, voice_id) VALUES (?, 'elevenlabs', ?)")
    .run("Modelo de prueba", "REEMPLAZAR_CON_VOICE_ID_REAL");

  db.prepare(
    `INSERT INTO model_consent (model_id, signed_document_path, consented_at, commercial_use, notes)
     VALUES (?, ?, date('now'), 1, 'Registro de prueba — reemplazar por el documento real firmado')`
  ).run(info.lastInsertRowid, "REEMPLAZAR_CON_RUTA_AL_DOCUMENTO_FIRMADO");

  console.log("Modelo de prueba + consentimiento creados. Recordá reemplazar voice_id y el documento real.");
}

const phrases = [
  ["Saludo", "Hola amor, ¿cómo estás? Qué lindo tenerte por acá."],
  ["Agradecimiento por regalo", "Muchas gracias por el regalo, de verdad lo aprecio muchísimo."],
  ["Despedida", "Bueno amor, me voy yendo. Te mando muchos besos, hablamos pronto."],
];

const insertPhrase = db.prepare("INSERT INTO phrases (label, text) VALUES (?, ?)");
const existing = db.prepare("SELECT COUNT(*) AS n FROM phrases").get().n;
if (existing === 0) {
  for (const [label, text] of phrases) insertPhrase.run(label, text);
  console.log("Frases de ejemplo cargadas.");
}
