import "./style.css";
import type { User } from "firebase/auth";
import {
  claimUsername,
  ensureUserRole,
  findUsername,
  getAccountRole,
  getBalanceCents,
  getUsernameForUser,
  isFirebaseConfigured,
  isUsernameAvailable,
  signInWithGoogle,
  signOutUser,
  watchAuth,
} from "./firebase";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("The application root element is missing.");
const appRoot: HTMLDivElement = app;

const logoUrl = "/triplex-logo.png";
const whatsappUrl = "https://wa.me/447950484434";
const route = window.location.pathname.split("/").pop()?.toLowerCase() ?? "";
const page = route === "signup.html"
  ? "signup"
  : route === "login.html"
    ? "login"
    : route === "loading.html"
      ? "loading"
      : route === "contact.html"
        ? "contact"
        : route === "admin.html"
          ? "admin"
        : "dashboard";

let currentUser: User | null = null;
let currentUsername: string | null = null;
let currentRole: "user" | "admin" = "user";
let balanceCents = 0;
let balanceVisible = true;
let lookupTimer = 0;
let lookupVersion = 0;

const themeKey = "triplex-theme";
const installDismissedKey = "triplex-install-dismissed";
document.documentElement.dataset.theme = localStorage.getItem(themeKey) === "dark" ? "dark" : "light";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredInstallPrompt: InstallPromptEvent | null = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event as InstallPromptEvent;
  renderInstallPrompt();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.querySelector("#install-prompt")?.remove();
  localStorage.removeItem(installDismissedKey);
});

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
    console.error("Could not register the Triplex service worker.", error);
  });
}

function showBoot(message = "Triplex is loading") {
  appRoot.innerHTML = `
    <main class="boot-screen" aria-live="polite">
      <img src="${logoUrl}" alt="Triplex" class="boot-logo">
      <span class="loader-orbit" aria-hidden="true"></span>
      <p>${message}</p>
      <span class="boot-caption">SECURE ACCOUNT ACCESS</span>
    </main>`;
}

function frame(content: string, activePage: string, username: string | null) {
  const signedInName = username ? `Hi, ${escapeHtml(username)}` : "Welcome";
  appRoot.innerHTML = `
    <div class="app-shell">
      <div class="mobile-scrim" id="mobile-scrim"></div>
      <header class="mobile-header">
        <a class="brand brand-mobile" href="index.html" aria-label="Triplex dashboard">
          <img src="${logoUrl}" alt="Triplex">
        </a>
        <div class="mobile-controls">
          ${themeButton()}
          <button class="menu-toggle" id="menu-toggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">
            <span></span><span></span><span></span>
          </button>
        </div>
      </header>
      <aside class="sidebar" id="sidebar" aria-label="Main navigation">
        <a class="brand brand-desktop" href="index.html" aria-label="Triplex dashboard">
          <img src="${logoUrl}" alt="Triplex">
        </a>
        <div class="side-account">
          <span class="side-avatar">${username ? escapeHtml(username.slice(0, 2).toUpperCase()) : "TP"}</span>
          <span><strong>${signedInName}</strong><small>${currentUser ? "Triplex account" : "Guest account"}</small></span>
        </div>
        <p class="nav-label">Workspace</p>
        <nav class="nav">
          <a href="index.html" ${activePage === "dashboard" ? 'aria-current="page"' : ""}><span class="nav-icon" aria-hidden="true">▦</span>Overview</a>
          <a href="index.html#activity"><span class="nav-icon" aria-hidden="true">◷</span>Activity</a>
          <a href="contact.html" ${activePage === "contact" ? 'aria-current="page"' : ""}><span class="nav-icon" aria-hidden="true">✉</span>Contact</a>
          ${currentRole === "admin" ? `<a href="admin.html" ${activePage === "admin" ? 'aria-current="page"' : ""}><span class="nav-icon" aria-hidden="true">◆</span>Admin</a>` : ""}
        </nav>
        <div class="sidebar-bottom">
          ${currentUser
            ? '<button class="side-link" id="signout-button" type="button"><span class="nav-icon" aria-hidden="true">↪</span>Sign out</button>'
            : '<a class="side-link" href="login.html"><span class="nav-icon" aria-hidden="true">↪</span>Log in</a>'}
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="breadcrumb">Workspace <span aria-hidden="true">/</span> <strong>${activePage === "contact" ? "Contact" : activePage === "admin" ? "Admin" : "Overview"}</strong></div>
          <div class="profile">
            ${themeButton()}
            <span class="avatar" aria-hidden="true">${username ? escapeHtml(username.slice(0, 2).toUpperCase()) : "TP"}</span>
            <span class="profile-name">${signedInName}</span>
          </div>
        </header>
        <div class="content">${content}</div>
      </main>
    </div>
    <a class="whatsapp-float" href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" aria-label="Chat with Triplex on WhatsApp">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5A11.8 11.8 0 0 0 12.1 0C5.6 0 .3 5.3.3 11.8c0 2.1.5 4.1 1.6 5.9L.2 24l6.5-1.7a11.8 11.8 0 0 0 5.4 1.4h.1c6.5 0 11.8-5.3 11.8-11.8 0-3.1-1.2-6.1-3.5-8.4ZM12.1 21.7a9.9 9.9 0 0 1-5-1.4l-.4-.2-3.9 1 1-3.8-.3-.4a9.9 9.9 0 1 1 8.6 4.8Zm5.4-7.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.2-.4-2.3-1.4-.9-.8-1.5-1.7-1.7-2-.2-.3 0-.5.1-.6l.5-.6.3-.5c.1-.2 0-.4 0-.6-.1-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.6s1.2 3 1.4 3.2c.2.2 2.3 3.5 5.6 4.9.8.4 1.5.6 2 .7.8.3 1.6.2 2.2.1.7-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4Z"/></svg>
    </a>`;
  bindShellEvents();
}

function themeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  return `<button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to ${dark ? "light" : "dark"} mode" title="Switch to ${dark ? "light" : "dark"} mode"><span aria-hidden="true">${dark ? "☀" : "◐"}</span><span class="theme-label">${dark ? "Light" : "Dark"}</span></button>`;
}

function bindShellEvents() {
  bindThemeEvents();

  const menuToggle = document.querySelector<HTMLButtonElement>("#menu-toggle");
  const scrim = document.querySelector<HTMLDivElement>("#mobile-scrim");
  const sidebar = document.querySelector<HTMLElement>("#sidebar");
  const setMenuOpen = (open: boolean) => {
    sidebar?.classList.toggle("is-open", open);
    scrim?.classList.toggle("is-visible", open);
    menuToggle?.classList.toggle("is-open", open);
    menuToggle?.setAttribute("aria-expanded", String(open));
    menuToggle?.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  };
  menuToggle?.addEventListener("click", () => setMenuOpen(!sidebar?.classList.contains("is-open")));
  scrim?.addEventListener("click", () => setMenuOpen(false));
  sidebar?.querySelectorAll<HTMLAnchorElement>(".nav a").forEach((link) => {
    link.addEventListener("click", () => setMenuOpen(false));
  });
  document.querySelector<HTMLButtonElement>("#signout-button")?.addEventListener("click", async () => {
    try {
      await signOutUser();
      window.location.assign("index.html");
    } catch (error) {
      showNotice("Could not sign out", errorMessage(error));
    }
  });
}

function bindThemeEvents() {
  document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem(themeKey, next);
      document.querySelectorAll<HTMLElement>("[data-theme-toggle]").forEach((control) => {
        control.outerHTML = themeButton();
      });
      bindThemeEvents();
    });
  });
}

function renderDashboard() {
  const balance = formatCurrency(currentUser ? balanceCents : 0);
  const authActions = currentUser
    ? ""
    : `<div class="guest-actions"><a class="button button-primary" href="signup.html">Create account</a><a class="button button-secondary" href="login.html">Log in</a></div>`;
  frame(`
    <p class="eyebrow">Your dashboard</p>
    <h1>${currentUsername ? `Hi, ${escapeHtml(currentUsername)}` : "Account overview"}</h1>
    <p class="intro">${currentUser ? "Here is an overview of your Triplex account." : "Sign in to access your Triplex account."}</p>
    <section class="balance-card" aria-labelledby="balance-heading">
      <div class="balance-top">
        <div><p class="balance-label" id="balance-heading">Total balance</p><span class="balance-caption">${currentUser ? "Available balance" : "Sign in to view your account"}</span></div>
        <button class="visibility-button" id="visibility-toggle" type="button" aria-label="${balanceVisible ? "Hide" : "Show"} balance"><svg class="visibility-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.7 4.1 9.5 6-.3.8-1 1.8-2 2.8M6.2 6.2C3.9 7.6 2.8 9.8 2.5 11c.8 1.9 4.3 6 9.5 6 1.1 0 2.1-.2 3-.5"/></svg><span>${balanceVisible ? "Hide" : "Show"}</span></button>
      </div>
      <div class="balance-value-row"><p class="balance-value" id="balance-value">${balanceVisible ? balance : "••••••"}</p><span class="currency">USD</span></div>
      <div class="balance-footer"><span class="balance-foot">${currentUser ? "Account balance" : "No account connected"}</span><span class="balance-period">USD · US Dollar</span></div>
    </section>
    ${authActions}
    <div class="actions" aria-label="Account actions">
      <button class="action-button primary" type="button" data-action="deposit"><span class="action-symbol" aria-hidden="true">＋</span>Deposit</button>
      <button class="action-button" type="button" data-action="withdraw"><span class="action-symbol" aria-hidden="true">↓</span>Withdraw</button>
      <button class="action-button" type="button" data-action="transfer"><span class="action-symbol" aria-hidden="true">↗</span>Transfer</button>
    </div>
    <section id="activity" aria-labelledby="activity-heading">
      <div class="section-heading"><div><p class="eyebrow">Your account</p><h2 id="activity-heading">Recent activity</h2></div><span class="section-tag">Activity</span></div>
      <div class="activity-card"><div class="empty-state"><span class="empty-state-icon" aria-hidden="true">↗</span><p>No activity to show yet. Your account activity will appear here.</p></div></div>
    </section>`, "dashboard", currentUsername);

  document.querySelector<HTMLButtonElement>("#visibility-toggle")?.addEventListener("click", () => {
    balanceVisible = !balanceVisible;
    renderDashboard();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "transfer") {
        showTransferCard();
      } else {
        showNotice(`${capitalize(action ?? "Action")} unavailable`, "Please contact support for assistance.");
      }
    });
  });
}

function renderAuth(kind: "login" | "signup") {
  const signup = kind === "signup";
  appRoot.innerHTML = `
    <main class="auth-page">
      <a class="auth-back" href="index.html">← <span>Back to dashboard</span></a>
      <section class="auth-card">
        <a class="auth-brand" href="index.html"><img src="${logoUrl}" alt="Triplex"></a>
        <p class="eyebrow">${signup ? "Get started" : "Welcome back"}</p>
        <h1>${signup ? "Create your account" : "Log in to Triplex"}</h1>
        <p class="auth-copy">${signup ? "Use your Google account to get started, then choose your username." : "Continue securely with your Google account."}</p>
        ${!isFirebaseConfigured ? '<div class="config-note"><strong>Setup needed</strong><span>Google sign-in will be available after Firebase is configured.</span></div>' : ""}
        <button class="google-button" id="google-auth" type="button" ${!isFirebaseConfigured ? "disabled" : ""}>
          <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6.1C12.2 13.7 17.6 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.2-3.2-.5-4.7H24v9h12.4c-.6 3-2.3 5.5-4.8 7.2l7.4 5.7c4.3-4 7.1-9.9 7.1-17.2Z"/><path fill="#FBBC05" d="M10.4 28.6a14.5 14.5 0 0 1 0-9.2l-7.8-6.1a24 24 0 0 0 0 21.4l7.8-6.1Z"/><path fill="#34A853" d="M24 48c6.5 0 12-2.1 16-6.3l-7.4-5.7c-2.1 1.4-4.8 2.3-8.6 2.3-6.4 0-11.8-4.2-13.6-10l-7.8 6.1C6.5 42.6 14.6 48 24 48Z"/></svg>
          <span>Continue with Google</span>
        </button>
        <p class="auth-switch">${signup ? 'Already have an account? <a href="login.html">Log in</a>' : 'New to Triplex? <a href="signup.html">Create an account</a>'}</p>
        <p class="auth-legal">Your account is protected by Google sign-in and Firebase authentication.</p>
      </section>
      <span class="auth-footer">TRIPLEX · SECURE ACCOUNT ACCESS</span>
    </main>`;
  document.querySelector<HTMLButtonElement>("#google-auth")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.classList.add("is-loading");
    button.querySelector("span")!.textContent = "Connecting to Google…";
    try {
      const user = await signInWithGoogle();
      const username = await getUsernameForUser(user.uid);
      window.location.assign(username ? "index.html" : "signup.html");
    } catch (error) {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.querySelector("span")!.textContent = "Continue with Google";
      showNotice("Sign-in could not be completed", errorMessage(error));
    }
  });
}

function renderUsernameSetup(user: User) {
  appRoot.innerHTML = `
    <main class="auth-page">
      <a class="auth-back" href="index.html">← <span>Back to dashboard</span></a>
      <section class="auth-card username-card">
        <a class="auth-brand" href="index.html"><img src="${logoUrl}" alt="Triplex"></a>
        <p class="eyebrow">One last step</p>
        <h1>Choose your username</h1>
        <p class="auth-copy">Your username will identify you on Triplex. Use 3–20 letters, numbers, or underscores.</p>
        <form id="username-form" novalidate>
          <label for="username-input">Username</label>
          <div class="username-field"><span aria-hidden="true">@</span><input id="username-input" name="username" autocomplete="username" minlength="3" maxlength="20" placeholder="yourname" required><span id="username-status" class="username-status" aria-live="polite"></span></div>
          <p class="field-help">Lowercase letters, numbers, and underscores only.</p>
          <button class="button button-primary username-submit" id="username-next" type="submit" disabled>Continue <span aria-hidden="true">→</span></button>
        </form>
        <button class="text-button" id="username-signout" type="button">Not you? Sign out</button>
      </section>
      <span class="auth-footer">TRIPLEX · SECURE ACCOUNT ACCESS</span>
    </main>`;

  const input = document.querySelector<HTMLInputElement>("#username-input")!;
  const status = document.querySelector<HTMLSpanElement>("#username-status")!;
  const next = document.querySelector<HTMLButtonElement>("#username-next")!;
  const form = document.querySelector<HTMLFormElement>("#username-form")!;

  input.addEventListener("input", () => {
    window.clearTimeout(lookupTimer);
    const username = input.value.trim().toLowerCase();
    input.value = username;
    next.disabled = true;
    status.className = "username-status";
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      status.textContent = username.length ? "Use 3–20 letters, numbers, or underscores." : "";
      return;
    }
    const version = ++lookupVersion;
    status.className = "username-status is-checking";
    status.textContent = "Checking…";
    lookupTimer = window.setTimeout(async () => {
      try {
        const available = await isUsernameAvailable(username);
        if (version !== lookupVersion || input.value !== username) return;
        status.className = `username-status ${available ? "is-available" : "is-taken"}`;
        status.textContent = available ? "Available" : "Taken";
        next.disabled = !available;
      } catch (error) {
        if (version !== lookupVersion) return;
        status.className = "username-status is-taken";
        status.textContent = "Could not check. Try again.";
        showNotice("Username check failed", errorMessage(error));
      }
    }, 350);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = input.value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username) || next.disabled) return;
    next.disabled = true;
    next.textContent = "Saving username…";
    try {
      await claimUsername(username, user.uid);
      window.location.assign("index.html");
    } catch (error) {
      next.disabled = false;
      next.innerHTML = 'Continue <span aria-hidden="true">→</span>';
      status.className = "username-status is-taken";
      status.textContent = "Taken or unable to save. Try another.";
      showNotice("Username was not saved", errorMessage(error));
    }
  });
  document.querySelector<HTMLButtonElement>("#username-signout")?.addEventListener("click", async () => {
    try {
      await signOutUser();
      window.location.assign("signup.html");
    } catch (error) {
      showNotice("Could not sign out", errorMessage(error));
    }
  });
}

function renderContact() {
  frame(`
    <p class="eyebrow">We’re here to help</p>
    <h1>Contact Triplex</h1>
    <p class="intro">Get in touch with our team using the contact option below.</p>
    <section class="contact-card">
      <span class="contact-icon" aria-hidden="true">✆</span>
      <div><p class="eyebrow">WhatsApp support</p><h2>Chat with our team</h2><p>Message Triplex at <strong>+44 7950 484434</strong>.</p></div>
      <a class="button button-primary" href="${whatsappUrl}" target="_blank" rel="noopener noreferrer">Open WhatsApp <span aria-hidden="true">↗</span></a>
    </section>
    <p class="contact-note">Please do not share passwords, verification codes, or sensitive financial information in chat.</p>`, "contact", currentUsername);
}

function renderAdmin() {
  frame(`
    <p class="eyebrow">Admin workspace</p>
    <h1>Admin page</h1>
    <p class="intro">This private workspace is ready for the admin tools you define later.</p>
    <section class="contact-card admin-placeholder">
      <span class="contact-icon" aria-hidden="true">◆</span>
      <div><p class="eyebrow">Restricted access</p><h2>Admin tools coming soon</h2><p>Only accounts with the admin role in Firestore can see this page.</p></div>
    </section>`, "admin", currentUsername);
}

function showNotice(title: string, message: string) {
  const previous = document.querySelector<HTMLElement>("#notice-overlay");
  previous?.remove();
  const overlay = document.createElement("div");
  overlay.id = "notice-overlay";
  overlay.className = "notice-overlay";
  overlay.setAttribute("role", "presentation");
  overlay.innerHTML = `
    <section class="notice-card" role="dialog" aria-modal="true" aria-labelledby="notice-title" aria-describedby="notice-message">
      <button class="notice-close" type="button" aria-label="Dismiss notification">×</button>
      <img class="notice-logo" src="${logoUrl}" alt="Triplex">
      <span class="notice-mark" aria-hidden="true">i</span>
      <h2 id="notice-title"></h2>
      <p id="notice-message"></p>
    </section>`;
  overlay.querySelector("#notice-title")!.textContent = title;
  overlay.querySelector("#notice-message")!.textContent = message;
  document.body.append(overlay);
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") overlay.remove();
  });
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.focus();
}

function showTransferCard() {
  const previous = document.querySelector<HTMLElement>("#notice-overlay");
  previous?.remove();
  const overlay = document.createElement("div");
  overlay.id = "notice-overlay";
  overlay.className = "notice-overlay";
  overlay.innerHTML = `
    <section class="notice-card transfer-card" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
      <button class="notice-close" type="button" aria-label="Dismiss transfer panel">×</button>
      <img class="notice-logo" src="${logoUrl}" alt="Triplex">
      <p class="eyebrow">Transfer</p>
      <h2 id="transfer-title">Send to a Triplex user</h2>
      <p class="transfer-explainer">Check the recipient username and amount carefully before continuing.</p>
      ${currentUser ? "" : '<p class="config-note"><strong>Sign in required</strong><span>Log in to check a recipient.</span></p>'}
      <form id="transfer-form">
        <label for="recipient-input">Recipient username</label>
        <div class="recipient-field"><span aria-hidden="true">@</span><input id="recipient-input" name="recipient" autocomplete="off" placeholder="Search username" required><span id="recipient-status" class="username-status" aria-live="polite"></span></div>
        <label for="transfer-amount">Amount (USD)</label>
        <div class="amount-field"><span aria-hidden="true">$</span><input id="transfer-amount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required></div>
        <button class="button button-primary transfer-submit" id="transfer-submit" type="submit" disabled>Continue</button>
      </form>
    </section>`;

  const close = () => overlay.remove();
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.addEventListener("click", close);
  document.body.append(overlay);
  const recipientInput = overlay.querySelector<HTMLInputElement>("#recipient-input")!;
  const amountInput = overlay.querySelector<HTMLInputElement>("#transfer-amount")!;
  const recipientStatus = overlay.querySelector<HTMLSpanElement>("#recipient-status")!;
  const submit = overlay.querySelector<HTMLButtonElement>("#transfer-submit")!;
  let recipientUid: string | null = null;
  const validate = () => {
    const amount = Number(amountInput.value);
    submit.disabled = !currentUser || !recipientUid || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) > balanceCents;
  };
  recipientInput.addEventListener("input", () => {
    window.clearTimeout(lookupTimer);
    recipientUid = null;
    const username = recipientInput.value.trim().toLowerCase();
    recipientStatus.className = "username-status";
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      recipientStatus.textContent = "";
      validate();
      return;
    }
    const version = ++lookupVersion;
    recipientStatus.className = "username-status is-checking";
    recipientStatus.textContent = "Searching…";
    lookupTimer = window.setTimeout(async () => {
      try {
        const uid = await findUsername(username);
        if (version !== lookupVersion || recipientInput.value.trim().toLowerCase() !== username) return;
        if (!uid || uid === currentUser?.uid) {
          recipientStatus.className = "username-status is-taken";
          recipientStatus.textContent = uid ? "Choose another account" : "User not found";
        } else {
          recipientUid = uid;
          recipientStatus.className = "username-status is-available";
          recipientStatus.textContent = "User found";
        }
        validate();
      } catch (error) {
        recipientStatus.className = "username-status is-taken";
        recipientStatus.textContent = "Could not search";
        showNotice("Recipient search failed", errorMessage(error));
      }
    }, 350);
    validate();
  });
  amountInput.addEventListener("input", validate);
  overlay.querySelector<HTMLFormElement>("#transfer-form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    validate();
    if (submit.disabled) return;
    close();
    showNotice("Transfer unavailable", "This transfer could not be completed. Please contact support.");
  });
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.focus();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Please try again in a moment.";
}

function formatCurrency(cents: number) {
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function loadAuthenticatedPage(user: User | null) {
  currentUser = user;
  currentUsername = null;
  currentRole = "user";
  balanceCents = 0;
  try {
    if (page === "admin" && !user) {
      window.location.replace("login.html");
      return;
    }
    if (user) {
      await ensureUserRole(user.uid);
      currentRole = await getAccountRole(user.uid);
      if (page === "admin" && currentRole !== "admin") {
        window.location.replace("index.html");
        return;
      }
      currentUsername = await getUsernameForUser(user.uid);
      if (page === "dashboard" && !currentUsername) {
        window.location.assign("signup.html");
        return;
      }
      if (currentUsername && page === "signup") {
        window.location.assign("index.html");
        return;
      }
      if (page === "dashboard") balanceCents = await getBalanceCents(user.uid);
    }
    if (page === "loading") {
      renderLoadingPage(user);
    } else if (page === "login" || page === "signup") {
      if (user && !currentUsername) renderUsernameSetup(user);
      else renderAuth(page);
    } else if (page === "contact") {
      renderContact();
    } else if (page === "admin") {
      renderAdmin();
    } else {
      renderDashboard();
    }
  } catch (error) {
    if (page === "dashboard") renderDashboard();
    showNotice("Could not load account data", errorMessage(error));
  }
}

function renderLoadingPage(user: User | null) {
  appRoot.innerHTML = `
    <main class="boot-screen loading-page" aria-live="polite">
      <img src="${logoUrl}" alt="Triplex" class="boot-logo">
      <span class="loader-orbit" aria-hidden="true"></span>
      <p>${user ? "Preparing your account" : "Triplex is loading"}</p>
      <span class="boot-caption">SECURE ACCOUNT ACCESS</span>
      <span class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <a class="loading-back" href="index.html">Return to dashboard</a>
    </main>`;
}

showBoot(page === "loading" ? "Triplex is loading" : "Checking your secure connection");
renderInstallPrompt();
if (page === "loading") renderLoadingPage(null);
watchAuth(
  (user) => {
    void loadAuthenticatedPage(user);
  },
  (error) => {
    showBoot("Connection interrupted");
    showNotice("Could not verify your session", error.message);
  },
);

function renderInstallPrompt() {
  if (window.matchMedia("(display-mode: standalone)").matches || document.querySelector("#install-prompt")) return;
  const dismissedAt = Number(localStorage.getItem(installDismissedKey));
  if (dismissedAt && Date.now() - dismissedAt < 30 * 24 * 60 * 60 * 1000) return;

  const prompt = document.createElement("aside");
  prompt.id = "install-prompt";
  prompt.className = "install-prompt";
  prompt.setAttribute("aria-label", "Install Triplex");
  prompt.innerHTML = `
    <img src="${logoUrl}" alt="" class="install-prompt-logo">
    <div class="install-prompt-copy"><strong>Install Triplex</strong><span>Keep your account one tap away.</span></div>
    <button class="button button-primary install-button" id="install-app" type="button">Install</button>
    <button class="install-dismiss" id="dismiss-install" type="button" aria-label="Dismiss install prompt">×</button>`;
  document.body.append(prompt);

  prompt.querySelector<HTMLButtonElement>("#dismiss-install")?.addEventListener("click", () => {
    localStorage.setItem(installDismissedKey, String(Date.now()));
    prompt.remove();
  });
  prompt.querySelector<HTMLButtonElement>("#install-app")?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      showNotice(
        "Install Triplex",
        isIos
          ? "Tap the Share button in Safari, then choose Add to Home Screen."
          : "Open your browser menu and choose Install app or Add to Home screen.",
      );
      return;
    }

    try {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (choice.outcome === "accepted") prompt.remove();
    } catch (error) {
      showNotice("Could not start installation", errorMessage(error));
    }
  });
}
