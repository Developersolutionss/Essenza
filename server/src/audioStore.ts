import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const audioDir = path.join(__dirname, "..", "data", "audio");
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

export function hashText(text: string): string {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
}

export function save(modelId: number, textHash: string, buffer: Buffer): string {
  const fileName = `${modelId}_${textHash}.mp3`;
  const filePath = path.join(audioDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export function read(filePath: string): Buffer {
  return fs.readFileSync(filePath);
}

export { audioDir };
