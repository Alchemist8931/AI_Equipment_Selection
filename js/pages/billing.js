// =====================================================================
// billing.js — баланс, FX, транзакции, история счетов
// =====================================================================
import { sb, state, toast, escapeHtml, fmtMoney, fmtDate, showModal, hideModal } from "../core.js";

export async function renderBillingPage(root) {
  if (!state.groupId) {
    root.innerHTML = `<div class="empty">Нет активной группы</div>`;
    return;
  }

  root.innerHTML = `
    <div class="card">
      <h2 class="card-title">Баланс группы</h2>
      <div class="flex" style="gap:32px">
        <div>
          <div class="muted">Текущий баланс</div>
          <div style="font-size:24px;font-weight:700">${fmtMoney(state.balance?.balance_usd, "USD")}</div>
        </div>
        <div>
          <div class="muted">Курс ₽/$</div>
          <div style="font-size:18px;font-weight:600">${state.fxRate ? state.fxRate.toFixed(2) : "—"} ₽</div>
        </div>
        <div style="flex:1;text-align:right">
          <button id="topup-btn" class="btn btn-primary">Пополнить</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">Последние транзакции</h2>
      <div id="txn-list">Загрузка…</div>
    </div>

    <div class="card">
      <h2 class="card-title">История счетов</h2>
      <div id="inv-list">Загрузка…</div>
    </div>
  `;

  document.getElementById("topup-btn").addEventListener("click", showTopupForm);
  loadTransactions();
  loadInvoices();
}

async function loadTransactions() {
  const { data: txns, error } = await sb
    .from("billing_transactions")
    .select("id, kind, amount_usd, balance_after_usd, notes, created_at")
    .eq("group_id", state.groupId)
    .order("created_at", { ascending: false })
    .limit(20);

  const el = document.getElementById("txn-list");
  if (error) { el.innerHTML = `<div class="empty">Ошибка: ${escapeHtml(error.message)}</div>`; return; }
  if (!txns || txns.length === 0) { el.innerHTML = `<div class="empty">Транзакций пока нет</div>`; return; }

  const KIND = {
    payment: "Пополнение",
    subscription: "Подписка",
    ai_request: "AI запрос",
    manual_adjustment: "Корректировка",
    refund: "Возврат",
  };

  el.innerHTML = `
    <table class="table">
      <thead><tr><th>Дата</th><th>Тип</th><th>Сумма USD</th><th>Баланс после</th><th>Комментарий</th></tr></thead>
      <tbody>
        ${txns.map(t => {
          const amt = parseFloat(t.amount_usd) || 0;
          const sign = amt > 0 ? "+" : "";
          const color = amt > 0 ? "var(--success)" : "var(--text)";
          return `<tr>
            <td>${fmtDate(t.created_at)}</td>
            <td>${escapeHtml(KIND[t.kind] || t.kind)}</td>
            <td style="color:${color};font-weight:600">${sign}${amt.toFixed(4)}</td>
            <td>${fmtMoney(t.balance_after_usd, "USD", 4)}</td>
            <td class="muted">${escapeHtml(t.notes || "")}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

async function loadInvoices() {
  const { data: invs, error } = await sb
    .from("billing_invoices")
    .select("id, number, amount_rub, amount_usd, fx_rate, status, issued_at, paid_at, created_at, pdf_url")
    .eq("group_id", state.groupId)
    .order("created_at", { ascending: false })
    .limit(20);

  const el = document.getElementById("inv-list");
  if (error) { el.innerHTML = `<div class="empty">Ошибка: ${escapeHtml(error.message)}</div>`; return; }
  if (!invs || invs.length === 0) { el.innerHTML = `<div class="empty">Счетов пока нет</div>`; return; }

  const STATUS = { draft: "черновик", issued: "выставлен", paid: "оплачен", cancelled: "отменён" };

  el.innerHTML = `
    <table class="table">
      <thead><tr><th>№</th><th>Дата</th><th>Сумма</th><th>USD</th><th>Курс</th><th>Статус</th><th>PDF</th></tr></thead>
      <tbody>
        ${invs.map(i => `<tr>
          <td>${escapeHtml(i.number || "—")}</td>
          <td>${fmtDate(i.issued_at || i.created_at)}</td>
          <td>${fmtMoney(i.amount_rub, "RUB", 0)}</td>
          <td>${fmtMoney(i.amount_usd, "USD")}</td>
          <td class="muted">${i.fx_rate ? parseFloat(i.fx_rate).toFixed(2) : "—"}</td>
          <td>${escapeHtml(STATUS[i.status] || i.status)}</td>
          <td>${i.pdf_url ? `<a href="${escapeHtml(i.pdf_url)}" target="_blank">скачать</a>` : "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  `;
}

function showTopupForm() {
  const fx = state.fxRate || 90;
  showModal(`
    <h3 style="margin-top:0">Пополнение баланса</h3>
    <div class="form-row">
      <label>Сумма (₽)</label>
      <input type="number" id="topup-rub" value="5000" step="500" min="500">
    </div>
    <div class="muted" id="topup-preview" style="margin-bottom:12px"></div>
    <div class="flex" style="justify-content:flex-end">
      <button class="btn" onclick="document.getElementById('modal-container').classList.add('hidden')">Отмена</button>
      <button class="btn btn-primary" id="topup-confirm">Создать счёт</button>
    </div>
  `);

  const rubInput = document.getElementById("topup-rub");
  const preview = document.getElementById("topup-preview");
  function updatePreview() {
    const rub = parseFloat(rubInput.value) || 0;
    const usd = rub / fx;
    preview.textContent = `≈ ${fmtMoney(usd, "USD")} по курсу ${fx.toFixed(2)} ₽/$`;
  }
  rubInput.addEventListener("input", updatePreview);
  updatePreview();

  document.getElementById("topup-confirm").addEventListener("click", async () => {
    const rub = parseFloat(rubInput.value);
    if (!rub || rub < 500) { toast("Минимальная сумма 500 ₽", "error"); return; }

    // Check if user is group_admin
    const myMembership = state.groups.find(g => g.id === state.groupId);
    if (myMembership?.role !== "admin" && myMembership?.role !== "owner") {
      toast("Счёт может создать только админ группы", "error");
      return;
    }

    const usd = rub / fx;
    const { data, error } = await sb.from("billing_invoices").insert({
      group_id: state.groupId,
      amount_rub: rub,
      amount_usd: usd,
      fx_rate: fx,
      status: "draft",
      payment_method: "invoice",
      created_by: state.user.id,
    }).select().single();

    if (error) {
      toast("Не удалось создать счёт: " + error.message, "error", 6000);
      return;
    }
    toast(`Счёт на ${rub} ₽ создан`, "success");
    hideModal();
    loadInvoices();
  });
}
