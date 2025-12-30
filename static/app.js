let state = { tasks: [], today: null };
let activeTask = null;

const grid = document.getElementById("grid");
const dateEl = document.getElementById("date");
const reloadBtn = document.getElementById("reload");

const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const btnYes = document.getElementById("btnYes");
const btnNo = document.getElementById("btnNo");

let currentValue = null; // number_diff modal value

function closeModal() {
  activeTask = null;
  currentValue = null;
  modalTitle.innerHTML = "";
  btnYes.textContent = "Ja";
  btnNo.textContent = "Nein";
  modalBackdrop.classList.add("hidden");
}

function openConfirmModal(task) {
  activeTask = task;
  modalTitle.textContent = `Wirklich "${task.tile_text}"`;
  btnNo.textContent = "Nein";
  btnYes.textContent = "Ja";
  modalBackdrop.classList.remove("hidden");
}

function openNumberModal(task) {
  activeTask = task;

  const min = 30.0;
  const max = 200.0;
  const step = 0.01;

  const start =
    (typeof task.latest_value === "number") ? task.latest_value :
    ((typeof task.startvalue === "number") ? task.startvalue : 80.0);

  currentValue = start;

  modalTitle.innerHTML = `
    <div style="font-size:24px;margin-bottom:10px;">${task.tile_text}</div>
    <div class="modalField">
      <label>Aktueller Wert</label>
      <div class="modalRow">
        <input id="numRange" type="range" min="${min}" max="${max}" step="${step}" value="${start}">
        <input id="numInput" type="number" step="${step}" value="${start.toFixed(2)}">
      </div>
      <div style="font-size:16px;opacity:.8;">Tipp: Zahlenfeld ist präziser als der Slider.</div>
    </div>
  `;

  btnNo.textContent = "Abbrechen";
  btnYes.textContent = "Speichern";
  modalBackdrop.classList.remove("hidden");

  const range = document.getElementById("numRange");
  const input = document.getElementById("numInput");

  const syncFromRange = () => {
    currentValue = parseFloat(range.value);
    input.value = currentValue.toFixed(2);
  };

  const syncFromInput = () => {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) return;
    currentValue = v;
    const clamped = Math.min(max, Math.max(min, v));
    range.value = clamped.toFixed(2);
  };

  range.addEventListener("input", syncFromRange);
  input.addEventListener("input", syncFromInput);
}

async function apiConfirm(taskId, answer) {
  await fetch(`/api/tasks/${taskId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer })
  });
}

async function apiSetValue(taskId, value) {
  const res = await fetch(`/api/tasks/${taskId}/value`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value })
  });

  if (!res.ok) {
    const msg = await res.text();
    alert(`Speichern fehlgeschlagen: ${msg}`);
  }
}

function fmt2(x) {
  return (typeof x === "number") ? x.toFixed(2) : "—";
}

function signFmt(x) {
  if (typeof x !== "number") return "—";
  return (x >= 0 ? "+" : "") + x.toFixed(2);
}

function numberDiffTitleHTML(t) {
  // “wenn eingeloggt” => sobald es latest_value gibt, zwei Werte anzeigen
  if (typeof t.latest_value === "number") {
    const aVal = (typeof t.start_minus_current === "number") ? signFmt(t.start_minus_current) : "—";
    const aClass = t.start_minus_current_class || "neutral";

    const bVal = (typeof t.current_minus_goal === "number") ? signFmt(t.current_minus_goal) : "—";
    const bClass = t.current_minus_goal_class || "neutral";

    return `
      <div class="metrics">
        <div class="metric ${aClass}">Start − Current: ${aVal}</div>
        <div class="metric ${bClass}">Current − Ziel: ${bVal}</div>
      </div>
    `;
  }

  return `${t.tile_text}`;
}

function render() {
  dateEl.textContent = state.today ? `Heute: ${state.today}` : "…";
  grid.innerHTML = "";

  for (const t of state.tasks) {
    const tile = document.createElement("div");

    // confirm: done_today (yes today) => green/locked
    // number_diff: achieved => green/locked permanently
    const isDone = (t.task_type === "number_diff") ? !!t.achieved : !!t.done_today;
    tile.className = "tile" + (isDone ? " done" : "");

    const title = document.createElement("div");
    title.className = "title";

    if (t.task_type === "number_diff") {
      title.innerHTML = numberDiffTitleHTML(t);
    } else {
      title.textContent = t.done_today ? t.success_rendered : t.tile_text;
    }

    const meta = document.createElement("div");
    meta.className = "meta";

    if (t.task_type === "number_diff") {
      const last = t.latest_day ? `Letzter Eintrag: ${t.latest_day}` : "Noch kein Eintrag";
      meta.textContent = `${last} • Ziel: ${fmt2(t.goal)} • Deadline: ${t.deadline}`;
    } else {
      meta.textContent = `Fortschritt: ${t.current}/${Math.round(t.goal)} • Deadline: ${t.deadline}`;
    }

    const btn = document.createElement("button");

    if (t.task_type === "number_diff") {
      if (t.achieved) btn.textContent = "Ziel erreicht";
      else if (t.done_today) btn.textContent = "Eingetragen";
      else btn.textContent = "Eintragen";

      btn.disabled = !!t.achieved || !!t.done_today;
      btn.addEventListener("click", () => openNumberModal(t));
    } else {
      btn.textContent = t.done_today ? "Erledigt" : "Antippen";
      btn.disabled = !!t.done_today;
      btn.addEventListener("click", () => openConfirmModal(t));
    }

    tile.appendChild(title);
    tile.appendChild(meta);
    tile.appendChild(btn);
    grid.appendChild(tile);
  }
}

async function load() {
  const res = await fetch("/api/tasks");
  const data = await res.json();
  state.today = data.today;
  state.tasks = data.tasks;
  render();
}

reloadBtn.addEventListener("click", load);

modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});

btnNo.addEventListener("click", async () => {
  if (!activeTask) { closeModal(); return; }

  if (activeTask.task_type === "confirm") {
    // "Nein" wird gespeichert, aber bleibt klickbar (nur "yes" sperrt)
    await apiConfirm(activeTask.id, "no");
    closeModal();
    await load();
    return;
  }

  // number_diff: cancel
  closeModal();
});

btnYes.addEventListener("click", async () => {
  if (!activeTask) return;

  if (activeTask.task_type === "number_diff") {
    if (!Number.isFinite(currentValue)) return;
    await apiSetValue(activeTask.id, currentValue);
    closeModal();
    await load();
    return;
  }

  await apiConfirm(activeTask.id, "yes");
  closeModal();
  await load();
});

load();
setInterval(load, 60_000);
