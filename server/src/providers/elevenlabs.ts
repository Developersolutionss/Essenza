import type { VoiceProvider } from "./index";

const API_URL = "https://api.elevenlabs.io/v1";

export const elevenlabs: VoiceProvider = {
  async generate({ voiceId, text }) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("Falta ELEVENLABS_API_KEY en el entorno");

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
  },
};
