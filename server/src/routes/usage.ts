import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const usageRouter = Router();
usageRouter.use(requireAuth, requireRole("admin", "manager"));

const startOfDay = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

usageRouter.get("/summary", async (_req, res) => {
  const [byChatter, byModel] = await Promise.all([
    prisma.generation.groupBy({
      by: ["chatterId"],
      where: { fromCache: false, createdAt: { gte: startOfDay() } },
      _sum: { charCount: true },
    }),
    prisma.generation.groupBy({
      by: ["modelId"],
      where: { fromCache: false, createdAt: { gte: startOfMonth() } },
      _sum: { charCount: true },
    }),
  ]);

  const chatters = await prisma.chatter.findMany({ where: { id: { in: byChatter.map((r) => r.chatterId) } } });
  const models = await prisma.model.findMany({ where: { id: { in: byModel.map((r) => r.modelId) } } });

  const chatterName = new Map(chatters.map((c) => [c.id, c.name]));
  const modelName = new Map(models.map((m) => [m.id, m.name]));

  const byChatterRows = byChatter
    .map((r) => ({ chatter_id: r.chatterId, name: chatterName.get(r.chatterId), chars_today: r._sum.charCount }))
    .sort((a, b) => (b.chars_today ?? 0) - (a.chars_today ?? 0));

  const byModelRows = byModel
    .map((r) => ({ model_id: r.modelId, name: modelName.get(r.modelId), chars_this_month: r._sum.charCount }))
    .sort((a, b) => (b.chars_this_month ?? 0) - (a.chars_this_month ?? 0));

  res.json({ byChatter: byChatterRows, byModel: byModelRows });
});
