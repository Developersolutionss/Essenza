import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  let agency = await prisma.agency.findFirst({ where: { name: "Agencia de prueba" } });
  if (!agency) {
    agency = await prisma.agency.create({ data: { name: "Agencia de prueba" } });
  }

  await prisma.chatter.createMany({
    data: [
      { name: "Admin", email: "admin@essenza.com", passwordHash, role: "admin", agencyId: agency.id },
      { name: "Manager", email: "manager@essenza.com", passwordHash, role: "manager", agencyId: agency.id },
      { name: "Chatter de prueba", email: "chatter@essenza.com", passwordHash, role: "chatter", agencyId: agency.id },
    ],
    skipDuplicates: true,
  });

  const chatter = await prisma.chatter.findFirst({ where: { email: "chatter@essenza.com" } });

  let model = await prisma.model.findFirst({
    where: { name: "Modelo de prueba", agencyId: agency.id },
    include: { voices: true },
  });
  if (!model) {
    model = await prisma.model.create({
      data: {
        name: "Modelo de prueba",
        agencyId: agency.id,
        voices: {
          create: [
            {
              elevenlabsVoiceId: "REEMPLAZAR_CON_VOICE_ID_REAL",
              status: "lista",
            },
          ],
        },
      },
      include: { voices: true },
    });
  }

  if (model) {
    const existingConsent = await prisma.modelConsent.count({ where: { modelId: model.id } });
    if (existingConsent === 0) {
      await prisma.modelConsent.create({
        data: {
          modelId: model.id,
          signedDocumentPath: "REEMPLAZAR_CON_RUTA_AL_DOCUMENTO_FIRMADO",
          consentedAt: new Date(),
          commercialUse: true,
          notes: "Registro de prueba — reemplazar por el documento real firmado",
        },
      });
    }
  }

  if (chatter && model) {
    const existingAccess = await prisma.modelChatterAccess.count({
      where: { chatterId: chatter.id, modelId: model.id },
    });
    if (existingAccess === 0) {
      await prisma.modelChatterAccess.create({
        data: { chatterId: chatter.id, modelId: model.id },
      });
    }
  }

  const phrases = [
    { label: "Saludo", text: "Hola amor, ¿cómo estás? Qué lindo tenerte por acá." },
    { label: "Agradecimiento por regalo", text: "Muchas gracias por el regalo, de verdad lo aprecio muchísimo." },
    { label: "Despedida", text: "Bueno amor, me voy yendo. Te mando muchos besos, hablamos pronto." },
  ];

  const existingPhrases = await prisma.phrase.count();
  if (existingPhrases === 0) {
    await prisma.phrase.createMany({ data: phrases });
  }

  console.log(
    "Seed completado. Usuarios: admin@essenza.com / manager@essenza.com / chatter@essenza.com (password123)"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
