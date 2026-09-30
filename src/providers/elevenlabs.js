const API_URL = "https://api.elevenlabs.io/v1";

// Interfaz común de proveedor de voz: generate({ voiceId, text }) => Buffer de audio.
// Mantener esta forma estable es lo que permite swapear ElevenLabs por otro
// proveedor (ej. Fish Audio) sin tocar el resto del backend.
const MAX_ATTEMPTS = 3;

async function generate({ voiceId, text }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Falta ELEVENLABS_API_KEY en el entorno");

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${API_URL}/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`ElevenLabs error ${res.status}: ${detail}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      lastError = err;
      const isNetworkError = err.cause?.code?.startsWith("UND_ERR") || err.message === "fetch failed";
      if (!isNetworkError || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastError;
}

module.exports = { generate };
