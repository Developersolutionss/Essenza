const byChatterTbody = document.getElementById("by-chatter");
const byModelTbody = document.getElementById("by-model");
const statusEl = document.getElementById("status");
const modelForm = document.getElementById("model-form");
const formStatusEl = document.getElementById("form-status");

function renderTable(tbody, rows, nameKey, valueKey, emptyMsg) {
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="2">${emptyMsg}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((r) => `<tr><td>${r[nameKey]}</td><td>${r[valueKey].toLocaleString()}</td></tr>`)
    .join("");
}

async function loadSummary() {
  try {
    const res = await fetch("/api/usage/summary");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    renderTable(byChatterTbody, data.byChatter, "name", "chars_today", "Sin uso registrado hoy.");
    renderTable(byModelTbody, data.byModel, "name", "chars_this_month", "Sin uso registrado este mes.");
  } catch (err) {
    statusEl.textContent = "Error al cargar el resumen de uso.";
    console.error(err);
  }
}

loadSummary();

modelForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("name").value.trim();
  const provider = document.getElementById("provider").value;
  const voice_id = document.getElementById("voice_id").value.trim();

  formStatusEl.textContent = "Guardando modelo...";

  try {
    const res = await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, provider, voice_id }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      formStatusEl.textContent = data.error || "Error guardando la modelo.";
      return;
    }

    formStatusEl.textContent = `Modelo creada (id ${data.id}).`;
    modelForm.reset();
  } catch (err) {
    formStatusEl.textContent = "Error de conexión con el servidor.";
    console.error(err);
  }
});
