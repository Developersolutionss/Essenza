import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { generate, TtsError } from "../services/ttsService";

export const generateRouter = Router();
generateRouter.use(requireAuth);

const generateSchema = z.object({
  model_id: z.number().int().positive(),
  text: z.string().min(1),
});

generateRouter.post("/", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
  }

  try {
    const result = await generate({
      chatterId: req.user!.userId,
      modelId: parsed.data.model_id,
      text: parsed.data.text,
    });

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Audio-Source", result.fromCache ? "cache" : "generated");
    res.send(result.buffer);
  } catch (err) {
    if (err instanceof TtsError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  }
});
