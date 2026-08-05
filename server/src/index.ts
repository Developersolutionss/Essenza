import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { modelsRouter } from "./routes/models";
import { phrasesRouter } from "./routes/phrases";
import { consentRouter } from "./routes/consent";
import { generateRouter } from "./routes/generate";
import { usageRouter } from "./routes/usage";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/models", modelsRouter);
app.use("/api/phrases", phrasesRouter);
app.use("/api/model-consent", consentRouter);
app.use("/api/generate", generateRouter);
app.use("/api/usage", usageRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  console.log(`Essensa API escuchando en http://localhost:${port}`);
});
