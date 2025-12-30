let state = { tasks: [], today: null };
let activeTask = null;

const PAGE_SIZE = 8; // 5x2 Grid
let pageIndex = parseInt(localStorage.getItem("pageIndex") || "0", 8);

const grid = document.getElementById("grid");
const dateEl = document.getElementById("date");
const pageInfoEl = document.getElementById("pageInfo");

const reloadBtn = document.getElementById("reload");
const prevBtn = document.getElementById("prevPage");
const nextBtn = document.getElementById("nextPage");

const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const btnYes = document.getElementById("btnYes");
const btnNo = document.getElementById("btnNo");

let currentValue = null;

// ---------- Helpers ----------
function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---------- Tap feedback ----------
function triggerTapFeedback(tile, clientX, clientY) {
  tile.classList.remove("tapflash");
  void tile.offsetWidth; // restart animation
  tile.classList.add("tapflash");

  const rect = tile.getBoundingClientRect();
  const x = (typeof clientX === "number") ? (clientX - rect.left) : rect.width / 2;
  const y = (typeof clientY === "number") ? (clientY - rect.top) : rect.height / 2;

  const size = Math.ceil(Math.max(rect.width, rect.height) * 1.6);
  const ripple = document.createElement("div");
  ripple.className = "ripple";
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;

  tile.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 500);
}

// ---------- Modal ----------
function closeModal() {
  activeTask = null;
  currentValue = null;
  modalTitle.innerHTML = "";
  btnYes.textContent = "Ja";
  btnNo.textContent = "Nein";
  modalBackdrop.classList.add("hidden");
}

function isModalOpen() {
  return !modalBackdrop.classList.contains("hidden");
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
    <div style="font-size:24px;margin-bottom:10px;">${escapeHTML(task.tile_text)}</div>
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

// ---------- API ----------
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

// ---------- Formatting ----------
function fmt2(x) {
  return (typeof x === "number") ? x.toFixed(2) : "—";
}

function signFmt(x) {
  if (typeof x !== "number") return "—";
  return (x >= 0 ? "+" : "") + x.toFixed(2);
}

// Title with optional "done today" checkmark
function titleRowHTML(tileText, doneToday) {
  return `
    <div class="titleRow">
      <div class="titleText">${escapeHTML(tileText)}</div>
      ${doneToday ? `<div class="check">✓</div>` : ``}
    </div>
  `;
}

// Number-diff title + 2-row grid
function numberDiffTitleHTML(t) {
  const header = titleRowHTML(t.tile_text, !!t.done_today);

  if (typeof t.latest_value !== "number") return header;

  const aVal = (typeof t.start_minus_current === "number") ? signFmt(t.start_minus_current) : "—";
  const aClass = t.start_minus_current_class || "neutral";

  const bVal = (typeof t.current_minus_goal === "number") ? signFmt(t.current_minus_goal) : "—";
  const bClass = t.current_minus_goal_class || "neutral";

  return `
    ${header}
    <div class="ndGrid">
      <div class="ndLabel">Bereits geschafft:</div>
      <div class="ndValue ${escapeHTML(aClass)}">${escapeHTML(aVal)}</div>

      <div class="ndLabel">Noch übrig:</div>
      <div class="ndValue ${escapeHTML(bClass)}">${escapeHTML(bVal)}</div>
    </div>
  `;
}

// ---------- Paging ----------
function pagingEnabled() {
  return state.tasks.length > PAGE_SIZE;
}

function totalPages() {
  return Math.max(1, Math.ceil(state.tasks.length / PAGE_SIZE));
}

function clampPageIndex() {
  const tp = totalPages();
  if (pageIndex < 0) pageIndex = 0;
  if (pageIndex > tp - 1) pageIndex = tp - 1;
  localStorage.setItem("pageIndex", String(pageIndex));
}

function goPrevPage() {
  if (!pagingEnabled()) return;
  pageIndex -= 1;
  clampPageIndex();
  render();
}

function goNextPage() {
  if (!pagingEnabled()) return;
  pageIndex += 1;
  clampPageIndex();
  render();
}

function paginate(allTasks) {
  clampPageIndex();
  const start = pageIndex * PAGE_SIZE;
  const slice = allTasks.slice(start, start + PAGE_SIZE);

  const enabled = allTasks.length > PAGE_SIZE;
  prevBtn.disabled = !enabled || pageIndex === 0;
  nextBtn.disabled = !enabled || pageIndex >= totalPages() - 1;
  pageInfoEl.textContent = enabled ? `Seite ${pageIndex + 1}/${totalPages()}` : "";

  return slice;
}

// ---------- Render ----------
function render() {
  dateEl.textContent = state.today ? `Heute: ${state.today}` : "…";
  grid.innerHTML = "";

  const visibleTasks = paginate(state.tasks);

  for (const t of visibleTasks) {
    const tile = document.createElement("div");

    const isDone = (t.task_type === "number_diff")
      ? (!!t.done_today || !!t.achieved)
      : !!t.done_today;

    const actionDisabled = (t.task_type === "number_diff")
      ? (!!t.done_today || !!t.achieved)
      : !!t.done_today;

    tile.className = "tile" + (isDone ? " done" : "") + (!actionDisabled ? " clickable" : "");

    let lastDown = null;

    tile.addEventListener("pointerdown", (e) => {
      if (actionDisabled) return;
      lastDown = { x: e.clientX, y: e.clientY };
      triggerTapFee
