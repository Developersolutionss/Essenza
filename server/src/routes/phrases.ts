import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const phrasesRouter = Router();
phrasesRouter.use(requireAuth);

phrasesRouter.get("/", async (_req, res) => {
  const phrases = await prisma.phrase.findMany({ orderBy: { label: "asc" } });
  res.json(phrases);
});

const createPhraseSchema = z.object({
  label: z.string().min(1),
  text: z.string().min(1),
});

phrasesRouter.post("/", async (req, res) => {
  const parsed = createPhraseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
  }

  const phrase = await prisma.phrase.create({ data: parsed.data });
  res.status(201).json(phrase);
});
