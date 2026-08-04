require("dotenv").config();
const path = require("path");
const express = require("express");
const routes = require("./routes");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api", routes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Essensa voice notes corriendo en http://localhost:${PORT}`);
});
