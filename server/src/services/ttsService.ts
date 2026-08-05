import { prisma } from "../prisma";
import { hashText, save, read } from "../audioStore";
import { elevenlabs } from "../providers/elevenlabs";

const DEFAULT_DAILY_LIMIT = 20000;

export interface GenerateResult {
  buffer: Buffer;
  fromCache: boolean;
}

export interface GenerateParams {
  chatterId: number;
  modelId: number;
  text: string;
}

export class TtsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function generate(params: GenerateParams): Promise<GenerateResult> {
  const { chatterId, modelId, text } = params;

  const chatter = await prisma.chatter.findFirst({ where: { id: chatterId, active: true } });
  if (!chatter) throw new TtsError(404, "Chatter no encontrado o inactivo");

  const model = await prisma.model.findFirst({ where: { id: modelId, active: true } });
  if (!model) throw new TtsError(404, "Modelo no encontrado o inactivo");

  if (chatter.role === "chatter") {
    const access = await prisma.modelChatterAccess.findUnique({
      where: { modelId_chatterId: { modelId, chatterId } },
    });
    if (!access) {
      throw new TtsError(403, "No tenés acceso a esta modelo. Pedí la asignación a tu manager.");
    }
  }

  const consent = await prisma.modelConsent.findFirst({ where: { modelId }, orderBy: { consentedAt: "desc" } });
  if (!consent) {
    throw new TtsError(
      403,
      "Esta modelo no tiene un registro de consentimiento cargado. No se puede generar audio."
    );
  }

  const charCount = text.trim().length;

  const usedToday = await prisma.generation.aggregate({
    where: { chatterId, fromCache: false, createdAt: { gte: startOfDay() } },
    _sum: { charCount: true },
  });

  const limit = chatter.dailyCharLimit || DEFAULT_DAILY_LIMIT;
  const used = usedToday._sum.charCount || 0;
  if (used + charCount > limit) {
    throw new TtsError(
      429,
      `Límite diario de caracteres alcanzado (${used}/${limit}). Hablá con tu manager si necesitás más.`
    );
  }

  const voice = await prisma.voice.findFirst({ where: { modelId, status: "lista" } });
  if (!voice) throw new TtsError(422, "La modelo no tiene una voz lista para generar");

  const textHash = hashText(text);

  const cached = await prisma.audioCache.findUnique({ where: { modelId_textHash: { modelId, textHash } } });
  if (cached) {
    await prisma.audioCache.update({ where: { id: cached.id }, data: { hits: { increment: 1 } } });
    await prisma.generation.create({
      data: { chatterId, modelId, voiceId: voice.id, charCount, text, audioUrl: cached.filePath, fromCache: true },
    });
    return { buffer: read(cached.filePath), fromCache: true };
  }

  try {
    const buffer = await elevenlabs.generate({ voiceId: voice.elevenlabsVoiceId, text });
    const filePath = save(modelId, textHash, buffer);

    const cache = await prisma.audioCache.upsert({
      where: { modelId_textHash: { modelId, textHash } },
      update: { hits: { increment: 1 } },
      create: { modelId, textHash, text, filePath, charCount },
    });

    await prisma.generation.create({
      data: { chatterId, modelId, voiceId: voice.id, charCount, text, audioUrl: cache.filePath, fromCache: false },
    });

    return { buffer, fromCache: false };
  } catch (err) {
    if (err instanceof TtsError) throw err;
    throw new TtsError(502, (err as Error).message);
  }
}

function startOfDay(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
