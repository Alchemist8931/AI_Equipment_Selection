// =====================================================================
// app.js — bootstrap,  router, auth wiring
// =====================================================================
import {
  sb, state, refreshAll,
  signInWithPassword, signUpWithPassword, signInWithGoogle, signOut,
  toast, fmtMoney,
} from "./core.js";

import { renderUploadPage } from "./pages/upload.js";
import { renderModesPage } from "./pages/modes.js";
import { renderBillingPage } from "./pages/billing.js";

const PAGES = {
  upload: { title: "Подбор", render: renderUploadPage },
  modes:  { title: "Режимы", render: renderModesPage },
  billing:{ title: "Биллинг", render: renderBillingPage },
};

// =====================================================================
function $(id) { return document.getElementById(id); }

function showLoginError(msg) {
  const el = $("login-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function showSignupError(msg) {
  const el = $("signup-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearErrors() {
  $("login-error").classList.add("hidden");
  $("signup-error").classList.add("hidden");
}

function translateAuthError(msg) {
  const m = (msg || "").toLowerCase();
  if (m.includes("invalid login")) return "Неверный email или пароль";
  if (m.includes("user already")) return "Пользователь с таким email уже зарегистрирован";
  if (m.includes("email not confirmed")) return "Email не подтверждён — проверь почту";
  if (m.includes("password should")) return "Пароль слишком короткий (минимум 6 символов)";
  if (m.includes("rate limit")) return "Слишком много попыток — подожди минуту";
  return msg || "Неизвестная ошибка";
}

// =====================================================================
function showSplash(on) {
  $("splash").classList.toggle("hidden", !on);
}
function showLogin() {
  $("login-screen").classList.remove("hidden");
  $("app").classList.add("hidden");
}
function showApp() {
  $("login-screen").classList.add("hidden");
  $("app").classList.remove("hidden");
}

function updateUserBox() {
  $("user-name").textContent = state.profile?.full_name || state.user?.email || "";
  $("user-email").textContent = state.user?.email || "";
}

function updateBalance() {
  const pill = $("balance-pill");
  if (!state.balance) {
    pill.textContent = "—";
    pill.className = "balance-pill";
    return;
  }
  const usd = parseFloat(state.balance.balance_usd) || 0;
  pill.textContent = fmtMoney(usd, "USD");
  pill.className = "balance-pill" +
    (usd < 0.10 ? " critical" : usd < 1.00 ? " low" : "");
}

// =====================================================================
function switchPage(page) {
  if (!PAGES[page]) page = "upload";
  state.page = page;
  document.querySelectorAll(".nav-item").forEach(n => {
    n.classList.toggle("active", n.dataset.page === page);
  });
  $("page-title").textContent = PAGES[page].title;
  $("page-content").innerHTML = "";
  PAGES[page].render($("page-content"));
  // close mobile sidebar
  $("sidebar").classList.remove("open");
}

// =====================================================================
function wireLogin() {
  // Show/hide signup
  $("show-signup-btn").addEventListener("click", () => {
    clearErrors();
    $("login-form").classList.add("hidden");
    $("signup-form").classList.remove("hidden");
  });
  $("show-login-btn").addEventListener("click", () => {
    clearErrors();
    $("signup-form").classList.add("hidden");
    $("login-form").classList.remove("hidden");
  });

  // Email login
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();
    const fd = new FormData(e.target);
    try {
      await signInWithPassword(fd.get("email"), fd.get("password"));
    } catch (err) {
      showLoginError(translateAuthError(err.message));
    }
  });

  // Signup
  $("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();
    const fd = new FormData(e.target);
    try {
      await signUpWithPassword(fd.get("email"), fd.get("password"), fd.get("full_name"));
      toast("Аккаунт создан — проверь почту для подтверждения", "success", 6000);
    } catch (err) {
      showSignupError(translateAuthError(err.message));
    }
  });

  // Google
  $("google-signin-btn").addEventListener("click", async () => {
    try { await signInWithGoogle(); }
    catch (err) { showLoginError(translateAuthError(err.message)); }
  });
}

function wireApp() {
  // Sidebar nav
  document.querySelectorAll(".nav-item").forEach(n => {
    n.addEventListener("click", () => switchPage(n.dataset.page));
  });

  // Burger menu (mobile)
  $("burger-btn").addEventListener("click", () => {
    $("sidebar").classList.toggle("open");
  });

  // Sign out
  $("signout-btn").addEventListener("click", async () => {
    await signOut();
    showLogin();
  });
}

// =====================================================================
async function bootstrap() {
  wireLogin();
  wireApp();

  // Get initial session
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    state.session = session;
    state.user = session.user;
    await refreshAll();
    updateUserBox();
    updateBalance();
    showApp();
    switchPage("upload");
  } else {
    showLogin();
  }
  showSplash(false);

  // React to auth changes
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session) {
      state.session = session;
      state.user = session.user;
      await refreshAll();
      updateUserBox();
      updateBalance();
      showApp();
      switchPage("upload");
    } else if (event === "SIGNED_OUT") {
      state.session = null;
      state.user = null;
      state.profile = null;
      showLogin();
    } else if (event === "TOKEN_REFRESHED" && session) {
      state.session = session;
    }
  });
}

document.addEventListener("DOMContentLoaded", bootstrap);
