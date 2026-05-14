// =====================================================================
// core.js — Supabase client,  state, auth, UI helpers
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ---------- Global state ----------
export const state = {
  session: null,
  user: null,
  profile: null,
  groupId: null,         // current default group
  groups: [],            // all groups user belongs to
  balance: null,         // billing_balance row for current group
  fxRate: null,          // current RUB → USD rate (1 USD = X RUB)
  page: "upload",
};

// ---------- Auth helpers ----------
export async function signInWithPassword(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithPassword(email, password, fullName) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  await sb.auth.signOut();
  state.session = null;
  state.user = null;
  state.profile = null;
  state.groupId = null;
}

// ---------- State refresh ----------
export async function refreshAll() {
  if (!state.user) return;

  // 1. Profile
  const { data: profile, error: pe } = await sb
    .from("profiles").select("*").eq("id", state.user.id).maybeSingle();
  if (pe) console.error("load profile:", pe);
  state.profile = profile;

  // 2. Groups (where user is a member)
  const { data: memberships } = await sb
    .from("group_members")
    .select("group_id, role, groups(id, name, slug, status)")
    .eq("user_id", state.user.id);
  state.groups = (memberships || []).map(m => ({
    id: m.group_id, role: m.role, ...m.groups,
  }));

  // 3. Default group
  state.groupId = profile?.default_group_id || state.groups[0]?.id || null;

  // 4. Balance
  if (state.groupId) {
    const { data: bal } = await sb
      .from("billing_balance").select("*").eq("group_id", state.groupId).maybeSingle();
    state.balance = bal;
  }

  // 5. FX rate (latest)
  const { data: fx } = await sb
    .from("billing_fx_rates").select("rate_to_usd").eq("ccy", "RUB")
    .order("effective_from", { ascending: false }).limit(1).maybeSingle();
  state.fxRate = fx?.rate_to_usd ? parseFloat(fx.rate_to_usd) : null;
}

// ---------- UI helpers ----------
export function toast(message, kind = "info", ms = 3500) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 200);
  }, ms);
}

export function showModal(html) {
  const c = document.getElementById("modal-container");
  c.innerHTML = `<div class="modal">${html}</div>`;
  c.classList.remove("hidden");
  c.onclick = (e) => { if (e.target === c) hideModal(); };
}
export function hideModal() {
  const c = document.getElementById("modal-container");
  c.classList.add("hidden");
  c.innerHTML = "";
}

export function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function fmtMoney(amount, currency = "USD", digits = 2) {
  if (amount == null || isNaN(amount)) return "—";
  const n = parseFloat(amount);
  const symbol = currency === "RUB" ? "₽" : currency === "USD" ? "$" : currency + " ";
  const s = n.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return currency === "RUB" ? `${s} ${symbol}` : `${symbol}${s}`;
}

export function fmtDate(d) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function statusBadge(status) {
  const map = {
    "-":           ["badge-default", "—"],
    "queued":      ["badge-progress", "в очереди"],
    "in_progress": ["badge-progress", "в работе"],
    "done":        ["badge-done", "готово"],
    "error":       ["badge-error", "ошибка"],
  };
  const [cls, label] = map[status] || ["badge-default", status || "—"];
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}
