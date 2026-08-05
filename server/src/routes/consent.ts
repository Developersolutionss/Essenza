import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const consentRouter = Router();
consentRouter.use(requireAuth, requireRole("admin", "manager"));

const createConsentSchema = z.object({
  model_id: z.number().int().positive(),
  signed_document_path: z.string().min(1),
  verification_audio_path: z.string().optional(),
  consented_at: z.string().min(1),
  commercial_use: z.boolean().optional().default(true),
  notes: z.string().optional(),
});

consentRouter.post("/", async (req, res) => {
  const parsed = createConsentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
  }

  const model = await prisma.model.findUnique({ where: { id: parsed.data.model_id } });
  if (!model) return res.status(404).json({ error: "Modelo no encontrado" });

  const consent = await prisma.modelConsent.create({
    data: {
      modelId: parsed.data.model_id,
      signedDocumentPath: parsed.data.signed_document_path,
      verificationAudioPath: parsed.data.verification_audio_path,
      consentedAt: new Date(parsed.data.consented_at),
      commercialUse: parsed.data.commercial_use,
      notes: parsed.data.notes,
    },
  });

  res.status(201).json({ id: consent.id, model_id: consent.modelId });
});
