import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const modelsRouter = Router();
modelsRouter.use(requireAuth);

modelsRouter.get("/", async (req, res) => {
  const role = req.user!.role;
  const userId = req.user!.userId;

  const user = await prisma.chatter.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  const where =
    role === "admin"
      ? { active: true }
      : role === "manager"
        ? { active: true, agencyId: user.agencyId ?? -1 }
        : { active: true, accesses: { some: { chatterId: userId } } };

  const models = await prisma.model.findMany({
    where,
    orderBy: { name: "asc" },
    include: { voices: { select: { id: true, elevenlabsVoiceId: true, status: true } } },
  });

  res.json(models);
});

const createModelSchema = z.object({
  name: z.string().min(1),
  provider: z.string().min(1).default("elevenlabs"),
  voice_id: z.string().min(1),
});

modelsRouter.post("/", requireRole("admin", "manager"), async (req, res) => {
  const parsed = createModelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
  }

  const user = await prisma.chatter.findUnique({ where: { id: req.user!.userId } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  if (!user.agencyId) return res.status(403).json({ error: "El usuario no pertenece a una agencia" });

  const { name, provider, voice_id } = parsed.data;

  try {
    const model = await prisma.model.create({
      data: {
        name,
        agencyId: user.agencyId,
        voices: {
          create: [{ elevenlabsVoiceId: voice_id, status: "lista" }],
        },
      },
    });
    res.status(201).json({ id: model.id, name, provider, voice_id });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as any).code === "P2002") {
      return res.status(409).json({ error: "Ya existe un modelo con ese nombre" });
    }
    throw err;
  }
});
