"use strict";

const form = document.getElementById("generator");
const chatterInput = document.getElementById("chatter");
const modelSelect = document.getElementById("model");
const phraseSelect = document.getElementById("phrase");
const textArea = document.getElementById("text");
const countEl = document.getElementById("count");
const generateBtn = document.getElementById("generate");
const generateLabel = document.getElementById("generate-label");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const player = document.getElementById("player");
const downloadLink = document.getElementById("download");
const sourcePill = document.getElementById("source");

const MAX_CHARS = 1000;
const ICON_CHECK =
  '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
const ICON_BOLT =
  '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>';
const ICON_ALERT =
  '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

/* ---------- Utilidades ---------- */

// Todas las opciones se crean con el DOM (nunca con innerHTML) para no inyectar texto de la base de datos.
function option(value, label) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}

function fieldError(inputId, errId, message) {
  const input = document.getElementById(inputId);
  const out = document.getElementById(errId);
  input.setAttribute("aria-invalid", message ? "true" : "false");
  out.replaceChildren();
  if (message) {
    out.insertAdjacentHTML("afterbegin", ICON_ALERT);
    const span = document.createElement("span");
    span.textContent = message;
    out.appendChild(span);
  }
  return Boolean(message);
}

function setStatus(message, isError = false) {
  statusEl.className = `status${isError ? " error" : ""}`;
  statusEl.replaceChildren();
  if (message) statusEl.append(message);
}

function updateCount() {
  const n = textArea.value.length;
  countEl.textContent = String(n);
  countEl.parentElement.classList.toggle("over", n > MAX_CHARS);
}

function setBusy(busy) {
  generateBtn.disabled = busy;
  generateBtn.setAttribute("aria-busy", String(busy));
  generateBtn.querySelector(".ic").hidden = busy;
  document.getElementById("spinner").hidden = !busy;
  generateLabel.textContent = busy ? "Generando…" : "Generar audio";
}

/* ---------- Carga de datos ---------- */

async function loadModels() {
  try {
    const res = await fetch("/api/models", { credentials: "same-origin" });
    if (res.status === 401) return showLogin();
    if (!res.ok) throw new Error();
    const models = await res.json();
    modelSelect.replaceChildren();
    if (!models.length) {
      modelSelect.appendChild(option("", "No hay modelos activas"));
      modelSelect.disabled = true;
      generateBtn.disabled = true;
      fieldError("model", "model-err", "Aún no hay voces cargadas. Pídele a un administrador que las active.");
      return;
    }
    models.forEach((m) => modelSelect.appendChild(option(String(m.id), m.name)));
  } catch {
    setStatus("No se pudieron cargar las modelos. Recarga la página.", true);
  }
}

async function loadPhrases() {
  try {
    const res = await fetch("/api/phrases", { credentials: "same-origin" });
    if (!res.ok) throw new Error();
    const phrases = await res.json();
    phrases.forEach((p) => phraseSelect.appendChild(option(p.text, p.label)));
  } catch {
    /* Las frases rápidas son opcionales: si fallan, se puede escribir a mano. */
  }
}

/* ---------- Eventos ---------- */

phraseSelect.addEventListener("change", () => {
  if (phraseSelect.value) {
    textArea.value = phraseSelect.value;
    fieldError("text", "text-err", "");
    updateCount();
  }
});

textArea.addEventListener("input", updateCount);
chatterInput.addEventListener("blur", () => {
  if (chatterInput.value) fieldError("chatter", "chatter-err", "");
});

// El ID de chatter solo se recuerda en este navegador, como comodidad.
try {
  chatterInput.value = localStorage.getItem("essensa_chatter_id") || "";
} catch {
  /* sin almacenamiento disponible */
}

let currentUrl = null;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("");

  const chatterId = chatterInput.value.trim();
  const modelId = modelSelect.value;
  const text = textArea.value.trim();

  let firstInvalid = null;
  if (!chatterId) {
    fieldError("chatter", "chatter-err", "Escribe tu ID de chatter.");
    firstInvalid = chatterInput;
  } else {
    fieldError("chatter", "chatter-err", "");
  }
  if (!text) {
    fieldError("text", "text-err", "Escribe el texto del audio.");
    firstInvalid = firstInvalid || textArea;
  } else if (text.length > MAX_CHARS) {
    fieldError("text", "text-err", `El texto supera los ${MAX_CHARS} caracteres.`);
    firstInvalid = firstInvalid || textArea;
  } else {
    fieldError("text", "text-err", "");
  }
  if (firstInvalid) return firstInvalid.focus();
  if (!modelId) return;

  try {
    localStorage.setItem("essensa_chatter_id", chatterId);
  } catch {
    /* sin almacenamiento disponible */
  }

  setBusy(true);
  setStatus("Generando audio. Puede tardar unos segundos.");

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatter_id: Number(chatterId), model_id: Number(modelId), text }),
    });

    if (res.status === 401) {
      setBusy(false);
      return showLogin();
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatus(data.error || "No se pudo generar el audio.", true);
      return;
    }

    const source = res.headers.get("X-Audio-Source");
    const blob = await res.blob();
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);

    player.src = currentUrl;
    downloadLink.href = currentUrl;
    resultEl.hidden = false;

    sourcePill.className = `pill ${source === "cache" ? "good" : "warn"}`;
    sourcePill.replaceChildren();
    sourcePill.insertAdjacentHTML("afterbegin", source === "cache" ? ICON_CHECK : ICON_BOLT);
    sourcePill.append(source === "cache" ? "Desde caché · sin costo" : "Generado nuevo");

    setStatus("Audio listo.");
    resultEl.focus({ preventScroll: false });
  } catch (err) {
    console.error(err);
    setStatus("No hay conexión con el servidor. Inténtalo de nuevo.", true);
  } finally {
    setBusy(false);
  }
});

/* ---------- Acceso ---------- */

const loginSection = document.getElementById("login");
const disabledSection = document.getElementById("disabled");
const appSection = document.getElementById("app");

function showLogin() {
  loginSection.hidden = false;
  appSection.hidden = true;
  disabledSection.hidden = true;
  setTimeout(() => document.getElementById("password").focus(), 0);
}

function showApp() {
  loginSection.hidden = true;
  disabledSection.hidden = true;
  appSection.hidden = false;
  loadModels();
  loadPhrases();
  updateCount();
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = document.getElementById("password");
  const out = document.getElementById("loginError");
  out.replaceChildren();
  pass.setAttribute("aria-invalid", "false");
  const r = await fetch("/api/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pass.value }),
  });
  if (r.ok) {
    pass.value = "";
    showApp();
    return;
  }
  const msg = (await r.json().catch(() => ({}))).error || "No se pudo entrar.";
  pass.setAttribute("aria-invalid", "true");
  out.insertAdjacentHTML("afterbegin", ICON_ALERT);
  out.appendChild(Object.assign(document.createElement("span"), { textContent: msg }));
  pass.focus();
});

document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  showLogin();
});

(async () => {
  try {
    const s = await (await fetch("/api/session", { credentials: "same-origin" })).json();
    if (!s.enabled) return (disabledSection.hidden = false);
    if (s.authenticated) showApp();
    else showLogin();
  } catch {
    showLogin();
  }
})();
