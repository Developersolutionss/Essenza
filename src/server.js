require("dotenv").config();
const path = require("path");
const express = require("express");
const routes = require("./routes");
const adminRoutes = require("./admin");
const { startDiscordBot } = require("./discord");
const users = require("./users");

const app = express();

// Detrás de un proxy inverso (nginx/Caddy en el VPS) req.ip debe ser la IP real
// del visitante: de eso depende el bloqueo por intentos fallidos de contraseña.
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/vendor", express.static(path.join(__dirname, "..", "node_modules", "chart.js", "dist")));
app.use("/api/admin", adminRoutes);
app.use("/api", routes);
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "admin.html")));

const PORT = process.env.PORT || 3000;
// Por defecto solo escucha en la máquina local: en el VPS se publica a través
// del proxy inverso con HTTPS. HOST=0.0.0.0 lo abre a la red, bajo tu riesgo.
const HOST = process.env.HOST || "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`Essenza voice notes corriendo en http://${HOST}:${PORT}`);
  if (HOST === "0.0.0.0") {
    console.warn("AVISO: el servidor escucha en todas las interfaces. Usa un proxy con HTTPS delante.");
  }
  users.bootstrapFromEnv();
  if (users.count() === 0) {
    console.warn("AVISO: no hay ninguna cuenta. Pon ADMIN_PASSWORD en el entorno y reinicia para crear la cuenta 'admin'.");
  }
});

startDiscordBot().catch((err) => console.error("No se pudo iniciar el bot de Discord:", err.message));
