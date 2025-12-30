/* ProcessTracker Kiosk UI
 * - 2-row grid (auto columns from PAGE_SIZE)
 * - swipe paging
 * - whole-tile clickable
 * - ripple feedback
 * - achieved (laurel/trophy) when permanently completed
 */

(() => {
  // -------- Config --------
  const PAGE_SIZE = Number(window.PAGE_SIZE || 8); // 8 => 4x2, 10 => 5x2
  const ROWS = 2;
  const COLS = Math.max(1, Math.ceil(PAGE_SIZE / ROWS));
  const REFRESH_MS = 4000;

  // If your backend endpoints differ, change these:
  const API = {
    list: "/api/tasks",
    confirm: "/api/confirm",          // POST { technical_name, value: true|false }
    numberDiff: "/api/number-diff",   // POST { technical_name, value: number }
  };

  // -------- DOM --------
  const gridEl = document.getElementById("grid");
  const pageIndicatorEl = document.getElementById("page-indicator");
  const toastEl = document.getElementById("toast");
  const modalEl = document.getElementById("modal");
  const modalBackdropEl = document.getElementById("modal-backdrop");
  const modalTitleEl = document.getElementById("modal-title");
  const modalBodyEl = document.getElementById("modal-body");
  const modalActionsEl = document.getElementById("modal-actions");

  // set grid columns via CSS var
  document.documentElement.style.setProperty("--grid-cols", String(COLS));

  // -------- State --------
  let tasks = [];
  let page = 0;

  // -------- Helpers --------
  const escapeHTML = (s) => String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const fmtNum = (n, digits = 2) => {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "--";
    return Number(n).toFixed(digits);
  };

  const fmtSigned = (n, digits = 2) => {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "--";
    const v = Number(n);
    const sign = v > 0 ? "+" : ""; // keep "-" automatically
    return `${sign}${v.toFixed(digits)}`;
  };

  const todayISO = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  };

  const showToast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1800);
  };

  const isDoneToday = (t) => Boolean(t.done_today ?? t.completed_today ?? t.doneToday ?? false);

  // "Permanent achieved"
  const isAchieved = (t) => {
    // backend-provided override
    if (typeof t.achieved === "boolean") return t.achieved;

    const type = String(t.task_type || t.type || "").toLowerCase();

    // count/confirm tasks
    if (!type || type === "confirm" || type === "boolean" || type === "count") {
      const cur = Number(t.current ?? t.current_count ?? t.progress ?? 0);
      const goal = Number(t.goal ?? 0);
      return goal > 0 && cur >= goal;
    }

    // number_diff: goal is a target weight (<=)
    if (type === "number_diff" || type === "numberdiff") {
      const cur = Number(t.current_value ?? t.current ?? t.last_value);
      const goal = Number(t.goal);
      if (Number.isNaN(cur) || Number.isNaN(goal)) return false;
      return cur <= goal;
    }

    return false;
  };

  const addRipple = (tileEl, clientX, clientY) => {
    const r = document.createElement("span");
    r.className = "ripple";
    const rect = tileEl.getBoundingClientRect();
    const x = (clientX ?? (rect.left + rect.width / 2)) - rect.left;
    const y = (clientY ?? (rect.top + rect.height / 2)) - rect.top;
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    tileEl.appendChild(r);
    r.addEventListener("animationend", () => r.remove());
  };

  // -------- Modal --------
  const closeModal = () => {
    if (!modalEl) return;
    modalEl.classList.remove("open");
    modalBackdropEl?.classList.remove("open");
    modalTitleEl.textContent = "";
    modalBodyEl.innerHTML = "";
    modalActionsEl.innerHTML = "";
  };

  const openModal = ({ title, bodyHTML, actions }) => {
    if (!modalEl) return;
    modalTitleEl.textContent = title || "";
    modalBodyEl.innerHTML = bodyHTML || "";
    modalActionsEl.innerHTML = "";

    (actions || []).forEach((a) => {
      const btn = document.createElement("button");
      btn.className = `modal-btn ${a.variant || ""}`.trim();
      btn.textContent = a.label;
      btn.addEventListener("click", a.onClick);
      modalActionsEl.appendChild(btn);
    });

    modalBackdropEl?.classList.add("open");
    modalEl.classList.add("open");
  };

  modalBackdropEl?.addEventListener("click", closeModal);

  // -------- API --------
  const fetchTasks = async () => {
    const res = await fetch(API.list, { cache: "no-store" });
    if (!res.ok) throw new Error(`GET ${API.list} failed: ${res.status}`);
    const data = await res.json();
    // accept {tasks:[...]} or [...]
    return Array.isArray(data) ? data : (data.tasks || []);
  };

  const postJSON = async (url, payload) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`${url} failed: ${res.status} ${txt}`.trim());
    }
    return res.json().catch(() => ({}));
  };

  // -------- Render --------
  const render = () => {
    if (!gridEl) return;

    const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
    page = Math.min(page, totalPages - 1);

    const start = page * PAGE_SIZE;
    const slice = tasks.slice(start, start + PAGE_SIZE);

    gridEl.innerHTML = "";

    slice.forEach((t) => {
      const type = String(t.task_type || t.type || "").toLowerCase();
      const doneToday = isDoneToday(t);
      const achieved = isAchieved(t);
      const locked = achieved || doneToday;

      const tile = document.createElement("div");
      tile.className = "tile";
      if (doneToday) tile.classList.add("tile--done");
      if (achieved) tile.classList.add("tile--achieved");
      if (locked) tile.classList.add("tile--locked");

      tile.setAttribute("role", "button");
      tile.setAttribute("tabindex", "0");

      const title = escapeHTML(t.tile_text ?? t.title_text ?? t.title ?? t.technical_name ?? "Task");
      const successText = escapeHTML(t.success_text ?? t.sucess_text ?? "");

      // header: title + checkmark if done today
      const header = document.createElement("div");
      header.className = "tile__header";
      header.innerHTML = `
        <div class="tile__title">
          <span class="tile__titleText">${title}</span>
          ${doneToday ? `<span class="tile__tick" aria-label="heute erledigt">✓</span>` : ``}
        </div>
      `;

      // body
      const body = document.createElement("div");
      body.className = "tile__body";

      // Always show success_text (as requested)
      const successLine = document.createElement("div");
      successLine.className = "tile__success";
      successLine.innerHTML = successText || "&nbsp;";

      // common footer line: deadline only
      const deadline = escapeHTML(t.deadline ?? "");
      const footer = document.createElement("div");
      footer.className = "tile__meta";
      footer.innerHTML = deadline ? `Deadline: <span class="mono">${deadline}</span>` : "&nbsp;";

      body.appendChild(successLine);

      // type-specific content
      if (!type || type === "confirm" || type === "boolean" || type === "count") {
        const cur = Number(t.current ?? t.current_count ?? t.progress ?? 0);
        const goal = Number(t.goal ?? 0);

        const progress = document.createElement("div");
        progress.className = "tile__progress";
        progress.innerHTML = `
          <div class="tile__progressMain">
            <span class="mono">${escapeHTML(String(cur))}</span>
            <span class="sep">/</span>
            <span class="mono">${escapeHTML(String(goal))}</span>
          </div>
          ${achieved ? `<div class="tile__badge">Ziel erreicht</div>` : ``}
        `;
        body.appendChild(progress);
        body.appendChild(footer);
      } else if (type === "number_diff" || type === "numberdiff") {
        const startVal = Number(t.startvalue ?? t.start_value ?? t.start ?? NaN);
        const curVal = Number(t.current_value ?? t.current ?? t.last_value ?? NaN);
        const goalVal = Number(t.goal ?? NaN);

        const a = (!Number.isNaN(startVal) && !Number.isNaN(curVal)) ? (startVal - curVal) : null; // start - current
        const b = (!Number.isNaN(curVal) && !Number.isNaN(goalVal)) ? (curVal - goalVal) : null;   // current - goal

        const aClass = (a === null) ? "" : (a >= 0 ? "val--good" : "val--bad"); // weight loss => good
        const bClass = (b === null) ? "" : (b <= 0 ? "val--good" : "val--bad"); // <=0 means reached/under goal

        const kv = document.createElement("div");
        kv.className = "kv";
        kv.innerHTML = `
          <div class="k">Bereits geschafft:</div>
          <div class="v ${aClass} mono">${escapeHTML(fmtSigned(a))}</div>

          <div class="k">Noch übrig:</div>
          <div class="v ${bClass} mono">${escapeHTML(fmtSigned(b))}</div>
        `;
        body.appendChild(kv);
        body.appendChild(footer);
      } else {
        const unknown = document.createElement("div");
        unknown.className = "tile__meta";
        unknown.textContent = `Unbekannter task_type: ${type}`;
        body.appendChild(unknown);
      }

      tile.appendChild(header);
      tile.appendChild(body);

      // interactions
      const onActivate = (ev) => {
        if (locked) {
          addRipple(tile, ev?.clientX, ev?.clientY);
          return;
        }

        addRipple(tile, ev?.clientX, ev?.clientY);

        const tType = String(t.task_type || t.type || "").toLowerCase();
        if (!tType || tType === "confirm" || tType === "boolean" || tType === "count") {
          openModal({
            title: title,
            bodyHTML: `<div class="modal-text">Wirklich erledigt?</div>`,
            actions: [
              {
                label: "Nein",
                variant: "secondary",
                onClick: () => closeModal(),
              },
              {
                label: "Ja",
                variant: "primary",
                onClick: async () => {
                  try {
                    await postJSON(API.confirm, {
                      technical_name: t.technical_name || t.id || t.ID,
                      value: true,
                      date: todayISO(),
                    });
                    closeModal();
                    showToast("Gespeichert ✓");
                    await refreshNow();
                  } catch (e) {
                    closeModal();
                    showToast("Fehler beim Speichern");
                    console.error(e);
                  }
                },
              },
            ],
          });
        } else if (tType === "number_diff" || tType === "numberdiff") {
          const startVal = Number(t.startvalue ?? t.start_value ?? t.start ?? 0);
          const curVal = Number(t.current_value ?? t.current ?? t.last_value ?? startVal);

          // slider UI
          const id = "nd-slider";
          openModal({
            title: title,
            bodyHTML: `
              <div class="modal-text">Aktuellen Wert eintragen</div>
              <div class="slider-wrap">
                <input id="${id}" type="range" min="0" max="300" step="0.01" value="${escapeHTML(String(curVal))}">
                <div class="slider-value mono" id="${id}-val">${escapeHTML(fmtNum(curVal))}</div>
                <div class="slider-hint">Start: <span class="mono">${escapeHTML(fmtNum(startVal))}</span></div>
              </div>
            `,
            actions: [
              { label: "Abbrechen", variant: "secondary", onClick: () => closeModal() },
              {
                label: "Speichern",
                variant: "primary",
                onClick: async () => {
                  try {
                    const slider = document.getElementById(id);
                    const value = Number(slider?.value);
                    await postJSON(API.numberDiff, {
                      technical_name: t.technical_name || t.id || t.ID,
                      value,
                      date: todayISO(),
                    });
                    closeModal();
                    showToast("Gespeichert ✓");
                    await refreshNow();
                  } catch (e) {
                    closeModal();
                    showToast("Fehler beim Speichern");
                    console.error(e);
                  }
                },
              },
            ],
          });

          // live update
          setTimeout(() => {
            const slider = document.getElementById(id);
            const out = document.getElementById(`${id}-val`);
            if (slider && out) {
              slider.addEventListener("input", () => {
                out.textContent = fmtNum(slider.value);
              });
            }
          }, 0);
        } else {
          showToast("Unbekannter Task-Typ");
        }
      };

      tile.addEventListener("pointerdown", (ev) => {
        // slight highlight immediately
        tile.classList.add("tile--press");
        setTimeout(() => tile.classList.remove("tile--press"), 160);
      });

      tile.addEventListener("click", onActivate);
      tile.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(e);
        }
      });

      gridEl.appendChild(tile);
    });

    // page indicator
    if (pageIndicatorEl) {
      pageIndicatorEl.textContent = `${page + 1} / ${totalPages}`;
    }
  };

  // -------- Paging (swipe) --------
  let swipe = { active: false, x0: 0, y0: 0, dx: 0, dy: 0 };

  const goPage = (dir) => {
    const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
    const next = Math.min(totalPages - 1, Math.max(0, page + dir));
    if (next === page) return;

    // animate
    gridEl?.classList.remove("slide-left", "slide-right");
    gridEl?.classList.add(dir > 0 ? "slide-left" : "slide-right");
    setTimeout(() => gridEl?.classList.remove("slide-left", "slide-right"), 220);

    page = next;
    render();
  };

  const bindSwipe = () => {
    if (!gridEl) return;

    gridEl.addEventListener("pointerdown", (e) => {
      swipe.active = true;
      swipe.x0 = e.clientX;
      swipe.y0 = e.clientY;
      swipe.dx = 0;
      swipe.dy = 0;
      gridEl.setPointerCapture?.(e.pointerId);
    });

    gridEl.addEventListener("pointermove", (e) => {
      if (!swipe.active) return;
      swipe.dx = e.clientX - swipe.x0;
      swipe.dy = e.clientY - swipe.y0;
    });

    const end = () => {
      if (!swipe.active) return;
      swipe.active = false;

      const ax = Math.abs(swipe.dx);
      const ay = Math.abs(swipe.dy);

      // horizontal swipe threshold
      if (ax > 60 && ax > ay * 1.2) {
        goPage(swipe.dx < 0 ? +1 : -1);
      }
    };

    gridEl.addEventListener("pointerup", end);
    gridEl.addEventListener("pointercancel", end);
  };

  // -------- Refresh loop --------
  const refreshNow = async () => {
    try {
      tasks = await fetchTasks();
      render();
    } catch (e) {
      console.error(e);
      showToast("Fehler: Tasks laden");
    }
  };

  // -------- Init --------
  bindSwipe();
  refreshNow();
  setInterval(refreshNow, REFRESH_MS);
})();
