-- CreateEnum
CREATE TYPE "ChatterRole" AS ENUM ('admin', 'manager', 'chatter');

-- CreateEnum
CREATE TYPE "VoiceStatus" AS ENUM ('en_preparacion', 'lista', 'fallida');

-- CreateTable
CREATE TABLE "agencies" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" SERIAL NOT NULL,
    "agency_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voices" (
    "id" SERIAL NOT NULL,
    "model_id" INTEGER NOT NULL,
    "elevenlabs_voice_id" TEXT NOT NULL,
    "status" "VoiceStatus" NOT NULL DEFAULT 'en_preparacion',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatters" (
    "id" SERIAL NOT NULL,
    "agency_id" INTEGER,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "ChatterRole" NOT NULL DEFAULT 'chatter',
    "daily_char_limit" INTEGER NOT NULL DEFAULT 20000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chatters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_chatter_access" (
    "id" SERIAL NOT NULL,
    "model_id" INTEGER NOT NULL,
    "chatter_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_chatter_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generations" (
    "id" SERIAL NOT NULL,
    "chatter_id" INTEGER NOT NULL,
    "model_id" INTEGER NOT NULL,
    "voice_id" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "audio_url" TEXT NOT NULL,
    "char_count" INTEGER NOT NULL,
    "from_cache" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phrases" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phrases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_cache" (
    "id" SERIAL NOT NULL,
    "model_id" INTEGER NOT NULL,
    "text_hash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "char_count" INTEGER NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_consent" (
    "id" SERIAL NOT NULL,
    "model_id" INTEGER NOT NULL,
    "signed_document_path" TEXT NOT NULL,
    "verification_audio_path" TEXT,
    "consented_at" TIMESTAMP(3) NOT NULL,
    "commercial_use" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "models_name_key" ON "models"("name");

-- CreateIndex
CREATE UNIQUE INDEX "chatters_email_key" ON "chatters"("email");

-- CreateIndex
CREATE UNIQUE INDEX "model_chatter_access_model_id_chatter_id_key" ON "model_chatter_access"("model_id", "chatter_id");

-- CreateIndex
CREATE UNIQUE INDEX "audio_cache_model_id_text_hash_key" ON "audio_cache"("model_id", "text_hash");

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voices" ADD CONSTRAINT "voices_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatters" ADD CONSTRAINT "chatters_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_chatter_access" ADD CONSTRAINT "model_chatter_access_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_chatter_access" ADD CONSTRAINT "model_chatter_access_chatter_id_fkey" FOREIGN KEY ("chatter_id") REFERENCES "chatters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_chatter_id_fkey" FOREIGN KEY ("chatter_id") REFERENCES "chatters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_voice_id_fkey" FOREIGN KEY ("voice_id") REFERENCES "voices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_cache" ADD CONSTRAINT "audio_cache_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_consent" ADD CONSTRAINT "model_consent_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
