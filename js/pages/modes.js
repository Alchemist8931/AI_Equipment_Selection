// =====================================================================
// modes.js — активные режимы селектора + drag-and-drop приоритет 
// =====================================================================
import { sb, state, toast, escapeHtml } from "../core.js";

export async function renderModesPage(root) {
  root.innerHTML = `
    <div class="card">
      <h2 class="card-title">Активные режимы подбора</h2>
      <p class="muted" style="margin:0 0 16px">Перетаскивай для изменения приоритета. Включенные режимы участвуют в подборе.</p>
      <div id="modes-list">Загрузка…</div>
    </div>
  `;
  await loadModes();
}

async function loadModes() {
  if (!state.groupId) return;

  // Load all system templates
  const { data: templates } = await sb
    .from("selector_modes")
    .select("id, code, title, category, instructions")
    .eq("is_system_template", true)
    .order("code");

  // Load user's active modes for this group
  const { data: active } = await sb
    .from("user_active_modes")
    .select("mode_id, position, enabled")
    .eq("user_id", state.user.id)
    .eq("group_id", state.groupId);

  const activeMap = new Map((active || []).map(a => [a.mode_id, a]));

  // Merge: each template knows if user activated it + its position
  const rows = (templates || []).map(t => {
    const a = activeMap.get(t.id);
    return {
      ...t,
      enabled: a?.enabled ?? false,
      position: a?.position ?? 999,
    };
  }).sort((a, b) => a.position - b.position);

  const list = document.getElementById("modes-list");
  list.innerHTML = `<div class="drag-list">${rows.map(t => `
    <div class="drag-item" draggable="true" data-mode-id="${t.id}">
      <span class="drag-handle">⋮⋮</span>
      <div style="flex:1">
        <div class="drag-item-title">${escapeHtml(t.title)} <span class="muted">(${escapeHtml(t.code)})</span></div>
        <div class="drag-item-desc">${escapeHtml((t.instructions || "").slice(0, 100))}…</div>
      </div>
      <label class="flex" style="gap:6px">
        <input type="checkbox" data-toggle="${t.id}" ${t.enabled ? "checked" : ""}>
        <span class="muted">${t.enabled ? "вкл" : "выкл"}</span>
      </label>
    </div>
  `).join("")}</div>`;

  wireDragDrop();
  wireToggles();
}

function wireToggles() {
  document.querySelectorAll('[data-toggle]').forEach(cb => {
    cb.addEventListener("change", async (e) => {
      const modeId = cb.dataset.toggle;
      const enabled = cb.checked;
      const all = [...document.querySelectorAll(".drag-item[data-mode-id]")];
      const position = all.findIndex(el => el.dataset.modeId === modeId);

      const { error } = await sb.from("user_active_modes").upsert({
        user_id: state.user.id,
        mode_id: modeId,
        group_id: state.groupId,
        position,
        enabled,
      }, { onConflict: "user_id,mode_id" });

      if (error) {
        toast("Не удалось сохранить: " + error.message, "error");
        cb.checked = !enabled;
      } else {
        toast(enabled ? "Режим включён" : "Режим выключен", "success", 1500);
        cb.nextElementSibling.textContent = enabled ? "вкл" : "выкл";
      }
    });
  });
}

function wireDragDrop() {
  const list = document.querySelector(".drag-list");
  if (!list) return;
  let draggedEl = null;

  list.querySelectorAll(".drag-item").forEach(item => {
    item.addEventListener("dragstart", (e) => {
      draggedEl = item;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      list.querySelectorAll(".drag-item").forEach(i => i.classList.remove("over"));
      saveOrder();
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (item === draggedEl) return;
      item.classList.add("over");
      const rect = item.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      list.insertBefore(draggedEl, after ? item.nextSibling : item);
    });
    item.addEventListener("dragleave", () => item.classList.remove("over"));
  });
}

async function saveOrder() {
  const all = [...document.querySelectorAll(".drag-item[data-mode-id]")];
  const updates = all.map((el, idx) => ({
    user_id: state.user.id,
    mode_id: el.dataset.modeId,
    group_id: state.groupId,
    position: idx,
    enabled: el.querySelector('[data-toggle]').checked,
  }));
  const { error } = await sb.from("user_active_modes").upsert(updates, { onConflict: "user_id,mode_id" });
  if (error) toast("Порядок не сохранён: " + error.message, "error");
}
