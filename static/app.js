let state = { tasks: [], today: null };
let activeTask = null;

const grid = document.getElementById("grid");
const dateEl = document.getElementById("date");
const reloadBtn = document.getElementById("reload");

const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const btnYes = document.getElementById("btnYes");
const btnNo = document.getElementById("btnNo");

function openModal(task) {
  activeTask = task;
  modalTitle.textContent = `Wirklich "${task.tile_text}"`;
  modalBackdrop.classList.remove("hidden");
}

function closeModal() {
  activeTask = null;
  modalBackdrop.classList.add("hidden");
}

async function apiConfirm(taskId, answer) {
  await fetch(`/api/tasks/${taskId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer })
  });
}

function render() {
  dateEl.textContent = state.today ? `Heute: ${state.today}` : "…";
  grid.innerHTML = "";

  for (const t of state.tasks) {
    const tile = document.createElement("div");
    tile.className = "tile" + (t.done_today ? " done" : "");

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = t.done_today ? t.success_rendered : t.tile_text;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `Fortschritt: ${t.current}/${t.goal} • Deadline: ${t.deadline}`;

    const btn = document.createElement("button");
    btn.textContent = t.done_today ? "Erledigt" : "Antippen";
    btn.disabled = !!t.done_today;

    btn.addEventListener("click", () => openModal(t));

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
  if (!activeTask) return;
  await apiConfirm(activeTask.id, "no");
  closeModal();
  await load();
});

btnYes.addEventListener("click", async () => {
  if (!activeTask) return;
  await apiConfirm(activeTask.id, "yes");
  closeModal();
  await load();
});

load();
setInterval(load, 60_000); // optional: jede Minute refresh
