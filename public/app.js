const modelSelect = document.getElementById("model");
const phraseSelect = document.getElementById("phrase");
const textArea = document.getElementById("text");
const chatterInput = document.getElementById("chatter");
const generateBtn = document.getElementById("generate");
const statusEl = document.getElementById("status");
const player = document.getElementById("player");
const downloadLink = document.getElementById("download");

async function loadModels() {
  const res = await fetch("/api/models");
  const models = await res.json();
  modelSelect.innerHTML = models
    .map((m) => `<option value="${m.id}">${m.name}</option>`)
    .join("");
}

async function loadPhrases() {
  const res = await fetch("/api/phrases");
  const phrases = await res.json();
  phraseSelect.innerHTML =
    `<option value="">— Escribir manualmente —</option>` +
    phrases.map((p) => `<option value="${p.text}">${p.label}</option>`).join("");
}

phraseSelect.addEventListener("change", () => {
  if (phraseSelect.value) textArea.value = phraseSelect.value;
});

generateBtn.addEventListener("click", async () => {
  const chatterId = chatterInput.value;
  const modelId = modelSelect.value;
  const text = textArea.value.trim();

  if (!chatterId) return setStatus("Ingresá tu chatter_id.");
  if (!text) return setStatus("Escribí un texto primero.");

  setStatus("Generando audio...");
  generateBtn.disabled = true;

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatter_id: Number(chatterId), model_id: Number(modelId), text }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatus(data.error || "Error generando el audio.");
      return;
    }

    const source = res.headers.get("X-Audio-Source");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    player.src = url;
    player.style.display = "block";
    player.play().catch(() => {});

    downloadLink.href = url;
    downloadLink.style.display = "inline-block";

    setStatus(source === "cache" ? "Listo (desde caché, no gastó cuota)." : "Listo (generado nuevo).");
  } catch (err) {
    setStatus("Error de conexión con el servidor.");
    console.error(err);
  } finally {
    generateBtn.disabled = false;
  }
});

function setStatus(msg) {
  statusEl.textContent = msg;
}

loadModels();
loadPhrases();
