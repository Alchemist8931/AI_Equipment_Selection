// =====================================================================
// upload.js — drag-drop ТЗ + realtime list + auto-trigger process-spec 
// =====================================================================
import { sb, state, toast, escapeHtml, fmtDate, statusBadge } from "../core.js";

let realtimeChannel = null;

export function renderUploadPage(root) {
  root.innerHTML = `
    <div class="card">
      <h2 class="card-title">Загрузить ТЗ</h2>
      <div id="dropzone" class="dropzone">
        <div class="dropzone-icon">📤</div>
        <div><strong>Перетащи файл</strong> сюда или нажми, чтобы выбрать</div>
        <div class="muted" style="margin-top:6px;">PDF, DOCX, XLSX, TXT, CSV до 50 МБ</div>
      </div>
      <input type="file" id="file-input" accept=".pdf,.docx,.xlsx,.xls,.txt,.csv" style="display:none">
    </div>

    <div class="card">
      <h2 class="card-title">Мои загрузки</h2>
      <div id="uploads-list"></div>
    </div>
  `;

  // Cleanup previous channel
  if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }

  wireDropzone();
  loadUploads();
  subscribeRealtime();
}

function wireDropzone() {
  const dz = document.getElementById("dropzone");
  const input = document.getElementById("file-input");

  dz.addEventListener("click", () => input.click());
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); dz.classList.remove("over");
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener("change", () => {
    if (input.files.length) handleFile(input.files[0]);
  });
}

async function handleFile(file) {
  if (!state.groupId) {
    toast("Нет активной группы — обратись к администратору", "error");
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    toast("Файл больше 50 МБ", "error");
    return;
  }

  const ext = file.name.split(".").pop().toLowerCase();
  const ALLOWED = ["pdf", "docx", "xlsx", "xls", "txt", "csv"];
  if (!ALLOWED.includes(ext)) {
    toast("Поддерживаются: " + ALLOWED.join(", "), "error");
    return;
  }

  toast("Загружаю файл…", "info");

  // 1. Create spec_uploads row (we need its id for the storage path)
  const { data: spec, error: insErr } = await sb
    .from("spec_uploads")
    .insert({
      group_id: state.groupId,
      uploaded_by: state.user.id,
      file_name: file.name,
      file_ext: ext,
      file_size: file.size,
    })
    .select("id, group_id")
    .single();
  if (insErr) {
    toast("Не удалось создать запись: " + insErr.message, "error", 6000);
    return;
  }

  // 2. Upload to storage: {group_id}/{spec_id}/{filename}
  const filePath = `${spec.group_id}/${spec.id}/${file.name}`;
  const { error: upErr } = await sb.storage
    .from("uploads")
    .upload(filePath, file, { upsert: true, contentType: file.type });
  if (upErr) {
    toast("Загрузка не удалась: " + upErr.message, "error", 6000);
    await sb.from("spec_uploads").update({
      status_parser: "error", last_error: "upload failed: " + upErr.message,
    }).eq("id", spec.id);
    return;
  }

  // 3. Update spec with file_path
  await sb.from("spec_uploads").update({ file_path: filePath }).eq("id", spec.id);

  toast("Файл загружен — запускаю парсинг…", "success");
  document.getElementById("file-input").value = "";
  await loadUploads();

  // 4. Trigger process-spec Edge Function (auto-chains to selector → pricer)
  const { data: invokeResult, error: invokeErr } = await sb.functions.invoke("process-spec", {
    body: { spec_upload_id: spec.id },
  });
  if (invokeErr) {
    toast("Парсер не запустился: " + invokeErr.message, "error", 6000);
    await sb.from("spec_uploads").update({
      status_parser: "error",
      last_error: "invoke failed: " + invokeErr.message,
    }).eq("id", spec.id);
  } else if (invokeResult?.ok === false) {
    toast("Парсер отклонил запрос: " + invokeResult.error, "error", 6000);
  }
}

async function loadUploads() {
  const list = document.getElementById("uploads-list");
  if (!list) return;

  const { data: uploads, error } = await sb
    .from("spec_uploads")
    .select("id, file_name, file_size, status_parser, status_selector, status_pricer, last_error, created_at, processed_at, total_cost_usd_billed")
    .eq("group_id", state.groupId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    list.innerHTML = `<div class="empty">Ошибка: ${escapeHtml(error.message)}</div>`;
    return;
  }
  if (!uploads || uploads.length === 0) {
    list.innerHTML = `<div class="empty">Пока ничего не загружено</div>`;
    return;
  }

  list.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Файл</th>
          <th>Парсер</th>
          <th>Селектор</th>
          <th>Прайсер</th>
          <th>Стоимость</th>
          <th>Загружено</th>
        </tr>
      </thead>
      <tbody>
        ${uploads.map(u => `
          <tr data-spec-id="${u.id}" style="cursor:pointer">
            <td>
              <div style="font-weight:600">${escapeHtml(u.file_name || "—")}</div>
              ${u.last_error ? `<div class="muted" style="color:var(--danger)">${escapeHtml(u.last_error)}</div>` : ""}
            </td>
            <td>${statusBadge(u.status_parser)}</td>
            <td>${statusBadge(u.status_selector)}</td>
            <td>${statusBadge(u.status_pricer)}</td>
            <td>${u.total_cost_usd_billed ? "$" + parseFloat(u.total_cost_usd_billed).toFixed(4) : "—"}</td>
            <td>${fmtDate(u.created_at)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  list.querySelectorAll("tr[data-spec-id]").forEach(tr => {
    tr.addEventListener("click", () => openSpecDetails(parseInt(tr.dataset.specId)));
  });
}

async function openSpecDetails(specId) {
  const { data: positions } = await sb
    .from("spec_positions")
    .select("id, pos_number, name, category, qty, qty_unit")
    .eq("spec_id", specId).order("pos_number_int");
  const { data: picks } = await sb
    .from("spec_position_picks")
    .select("id, pos_id, article, model_name, qty, unit, price, sum, pricer_status, price1_store, price1_url, price2_store, price2_url, price3_store, price3_url")
    .eq("spec_id", specId);

  const picksByPos = new Map();
  (picks || []).forEach(p => {
    if (!picksByPos.has(p.pos_id)) picksByPos.set(p.pos_id, []);
    picksByPos.get(p.pos_id).push(p);
  });

  const rows = (positions || []).map(p => {
    const ps = picksByPos.get(p.id) || [];
    if (ps.length === 0) {
      return `<tr><td>${escapeHtml(p.pos_number)}</td><td>${escapeHtml(p.name)}</td><td>—</td><td>—</td><td>—</td></tr>`;
    }
    return ps.map((pk, i) => `
      <tr>
        <td>${i === 0 ? escapeHtml(p.pos_number) : ""}</td>
        <td>${i === 0 ? escapeHtml(p.name) : `<span class="muted">↳</span>`}</td>
        <td>${escapeHtml(pk.model_name || pk.article || "—")}</td>
        <td>${pk.price ? parseFloat(pk.price).toLocaleString("ru-RU") + " ₽" : statusBadge(pk.pricer_status)}</td>
        <td>${pk.sum ? parseFloat(pk.sum).toLocaleString("ru-RU") + " ₽" : "—"}</td>
      </tr>
    `).join("");
  }).join("");

  const total = (picks || []).reduce((s, p) => s + (parseFloat(p.sum) || 0), 0);

  const html = `
    <h3 style="margin-top:0">ТЗ #${specId}</h3>
    <table class="table" style="margin:12px 0">
      <thead><tr><th>№</th><th>Позиция</th><th>Подобрано</th><th>Цена</th><th>Сумма</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="empty" style="padding:20px">Позиции ещё не обработаны</td></tr>`}</tbody>
    </table>
    <div style="text-align:right;font-weight:600;margin-top:12px">
      Итого: ${total.toLocaleString("ru-RU")} ₽
    </div>
    <div style="text-align:right;margin-top:16px">
      <button class="btn" onclick="document.getElementById('modal-container').classList.add('hidden')">Закрыть</button>
    </div>
  `;

  const c = document.getElementById("modal-container");
  c.innerHTML = `<div class="modal">${html}</div>`;
  c.classList.remove("hidden");
  c.onclick = (e) => { if (e.target === c) c.classList.add("hidden"); };
}

function subscribeRealtime() {
  realtimeChannel = sb.channel("uploads_changes")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "spec_uploads", filter: `group_id=eq.${state.groupId}` },
      () => loadUploads()
    )
    .subscribe();
}
