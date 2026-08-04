const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const audioDir = path.join(__dirname, "..", "data", "audio");
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

function hashText(text) {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
}

function save(modelId, textHash, buffer) {
  const fileName = `${modelId}_${textHash}.mp3`;
  const filePath = path.join(audioDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function read(filePath) {
  return fs.readFileSync(filePath);
}

module.exports = { hashText, save, read, audioDir };
