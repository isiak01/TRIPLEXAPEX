import "./style.css";
import type { User } from "firebase/auth";
import {
  claimUsername,
  apiRequest,
  deleteNotification,
  ensureUserRole,
  findUsername,
  getAccountRole,
  getBalanceCents,
  getUserProfile,
  getUsernameForUser,
  isFirebaseConfigured,
  isUsernameAvailable,
  markNotificationRead,
  subscribeAccountActivity,
  subscribeNotifications,
  subscribePendingReceipts,
  subscribePendingWithdrawals,
  subscribeProfitCycle,
  subscribeUserProfile,
  signInWithGoogle,
  signOutUser,
  type AccountNotification,
  type AccountActivity,
  type ProfitCycle,
  watchAuth,
} from "./firebase";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("The application root element is missing.");
const appRoot: HTMLDivElement = app;

interface DepositNetwork {
  code: string;
  name: string;
  available: boolean;
}

interface DepositAsset {
  code: string;
  name: string;
  symbol: string;
  networks: DepositNetwork[];
}

interface UploadSignature {
  apiKey: string;
  cloudName: string;
  params: Record<string, string | number | boolean>;
  signature: string;
  uploadUrl: string;
  requestId: string;
}

interface UploadedReceipt {
  requestId: string;
  publicId: string;
}

interface AssistantReply {
  text: string;
  link?: { label: string; href: string };
}

interface AssistantMessage {
  sender: "user" | "assistant";
  text: string;
  link?: AssistantReply["link"];
  time: Date;
}

const logoUrl = "/triplex-logo.png";
const whatsappUrl = "https://wa.me/447950484434";
const route = window.location.pathname.split("/").pop()?.toLowerCase() ?? "";
const pageRoutes: Record<string, string> = {
  "signup.html": "signup",
  "login.html": "login",
  "loading.html": "loading",
  "contact.html": "contact",
  "admin.html": "admin",
  "profit.html": "profit",
  "assistant.html": "assistant",
  "receipts.html": "receipts",
  "withdrawals.html": "withdrawals",
  "members.html": "members",
};
const page = pageRoutes[route] || "dashboard";

let currentUser: User | null = null;
let currentUsername: string | null = null;
let currentRole: "user" | "admin" = "user";
let balanceCents = 0;
let activeProfitCycleId: string | null = null;
let balanceVisible = true;
let notifications: AccountNotification[] = [];
let accountActivity: AccountActivity[] = [];
let currentProfitCycle: ProfitCycle | null = null;
let pendingReceiptCount = 0;
let pendingWithdrawalCount = 0;
let stopProfileWatch: (() => void) | null = null;
let stopNotificationsWatch: (() => void) | null = null;
let stopReceiptsWatch: (() => void) | null = null;
let stopWithdrawalsWatch: (() => void) | null = null;
let stopProfitCycleWatch: (() => void) | null = null;
let stopActivityWatch: (() => void) | null = null;
let profitCountdownTimer: number | null = null;
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
          ${notificationButton("mobile")}
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
          <a href="index.html" ${activePage === "dashboard" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-overview" aria-hidden="true">▦</span>Overview</a>
          <a href="index.html#activity"><span class="nav-icon nav-icon-activity" aria-hidden="true">◷</span>Activity</a>
          <a href="profit.html" ${activePage === "profit" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-profit" aria-hidden="true">↗</span>Profit progress</a>
          <a href="assistant.html" ${activePage === "assistant" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-assistant" aria-hidden="true">✦</span>TRIPLEX AI ASSISTANT</a>
          <a href="contact.html" ${activePage === "contact" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-contact" aria-hidden="true">✉</span>Contact</a>
          ${currentRole === "admin" ? `
            <a href="admin.html" ${activePage === "admin" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-admin" aria-hidden="true">◆</span>Admin</a>
            <a href="receipts.html" ${activePage === "receipts" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-receipts" aria-hidden="true">▤</span>Receipts${pendingReceiptCount ? `<span class="nav-count" data-receipt-count>${pendingReceiptCount > 99 ? "99+" : pendingReceiptCount}</span>` : ""}</a>
            <a href="withdrawals.html" ${activePage === "withdrawals" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-profit" aria-hidden="true">↓</span>Withdrawals${pendingWithdrawalCount ? `<span class="nav-count" data-withdrawal-count>${pendingWithdrawalCount > 99 ? "99+" : pendingWithdrawalCount}</span>` : ""}</a>
            <a href="members.html" ${activePage === "members" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-members" aria-hidden="true">♙</span>Members</a>` : ""}
        </nav>
        <div class="sidebar-bottom">
          ${currentUser
            ? '<button class="side-link" id="signout-button" type="button"><span class="nav-icon nav-icon-account" aria-hidden="true">↪</span>Sign out</button>'
            : '<a class="side-link" href="login.html"><span class="nav-icon nav-icon-account" aria-hidden="true">↪</span>Log in</a>'}
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="breadcrumb">Workspace <span aria-hidden="true">/</span> <strong>${pageTitle(activePage)}</strong></div>
          <div class="profile">
            ${notificationButton("desktop")}
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

function notificationButton(location: "mobile" | "desktop") {
  const unreadCount = notifications.filter((item) => !item.readAt).length;
  return `<div class="notification-wrap ${location}">
    <button class="notification-toggle" id="notification-toggle-${location}" type="button" aria-label="Notifications${unreadCount ? `, ${unreadCount} unread` : ""}" aria-expanded="false" aria-controls="notification-panel-${location}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
      ${unreadCount ? `<span class="notification-count">${unreadCount > 99 ? "99+" : unreadCount}</span>` : ""}
    </button>
    <section class="notification-panel" id="notification-panel-${location}" aria-label="Notifications" hidden>
      <header><strong>Notifications</strong><span>${unreadCount ? `${unreadCount} new` : "You're all caught up"}</span></header>
      <div class="notification-list">${notificationItemsMarkup()}</div>
    </section>
  </div>`;
}

function notificationItemsMarkup() {
  if (!currentUser) return '<p class="notification-empty">Log in to see your notifications.</p>';
  if (!notifications.length) return '<p class="notification-empty">You have no notifications yet.</p>';
  return notifications.map((item) => `
    <article class="notification-item ${item.readAt ? "" : "is-unread"}">
      <span class="notification-item-dot" aria-hidden="true"></span>
      <div class="notification-item-content"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.message)}</small><time>${item.createdAt ? escapeHtml(item.createdAt.toDate().toLocaleString()) : "Just now"}</time>
        <div class="notification-item-actions">
          ${item.readAt ? '<span class="notification-read-state">Read</span>' : `<button class="notification-action notification-mark-read" type="button" data-notification-read="${escapeHtml(item.id)}">Mark as read</button>`}
          <button class="notification-action notification-delete" type="button" data-notification-delete="${escapeHtml(item.id)}" aria-label="Delete notification: ${escapeHtml(item.title)}" title="Delete notification"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button>
        </div>
      </div>
    </article>`).join("");
}

function pageTitle(activePage: string) {
  switch (activePage) {
    case "contact": return "Contact";
    case "profit": return "Profit progress";
    case "assistant": return "TRIPLEX AI ASSISTANT";
    case "admin": return "Admin";
    case "receipts": return "Receipts";
    case "withdrawals": return "Withdrawals";
    case "members": return "Members";
    default: return "Overview";
  }
}

function bindShellEvents() {
  bindThemeEvents();
  bindNotificationEvents();

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

function bindNotificationEvents() {
  document.querySelectorAll<HTMLButtonElement>(".notification-toggle").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const panel = document.getElementById(button.getAttribute("aria-controls") || "");
      if (!panel) return;
      const opening = panel.hidden;
      document.querySelectorAll<HTMLElement>(".notification-panel").forEach((item) => { item.hidden = true; });
      document.querySelectorAll<HTMLButtonElement>(".notification-toggle").forEach((item) => item.setAttribute("aria-expanded", "false"));
      panel.hidden = !opening;
      button.setAttribute("aria-expanded", String(opening));
      if (opening && !currentUser) showNotice("Sign in to view notifications", "Your account notifications will appear here after you log in.");
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-notification-read]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      if (!currentUser || button.disabled) return;
      button.disabled = true;
      try {
        await markNotificationRead(currentUser.uid, button.dataset.notificationRead || "");
      } catch (error) {
        button.disabled = false;
        showNotice("Could not mark notification as read", errorMessage(error));
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-notification-delete]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      if (!currentUser || button.disabled) return;
      button.disabled = true;
      try {
        await deleteNotification(currentUser.uid, button.dataset.notificationDelete || "");
      } catch (error) {
        button.disabled = false;
        showNotice("Could not delete notification", errorMessage(error));
      }
    });
  });
}

function updateNotificationControls() {
  document.querySelectorAll<HTMLElement>(".notification-wrap").forEach((element) => {
    const location = element.classList.contains("mobile") ? "mobile" : "desktop";
    element.outerHTML = notificationButton(location);
  });
  bindNotificationEvents();
}

function updateReceiptBadge() {
  document.querySelectorAll<HTMLElement>("[data-receipt-count]").forEach((badge) => badge.remove());
  const summary = document.querySelector<HTMLAnchorElement>('.admin-shortcut[href="receipts.html"] small');
  if (summary) summary.textContent = `${pendingReceiptCount} awaiting review`;
  if (pendingReceiptCount > 0) {
    document.querySelectorAll<HTMLAnchorElement>('.nav a[href="receipts.html"]').forEach((link) => {
      const badge = document.createElement("span");
      badge.className = "nav-count";
      badge.dataset.receiptCount = "";
      badge.textContent = pendingReceiptCount > 99 ? "99+" : String(pendingReceiptCount);
      link.append(badge);
    });
  }
}

function updateWithdrawalBadge() {
  document.querySelectorAll<HTMLElement>("[data-withdrawal-count]").forEach((badge) => badge.remove());
  const summary = document.querySelector<HTMLAnchorElement>('.admin-shortcut[href="withdrawals.html"] small');
  if (summary) summary.textContent = `${pendingWithdrawalCount} awaiting review`;
  if (pendingWithdrawalCount > 0) {
    document.querySelectorAll<HTMLAnchorElement>('.nav a[href="withdrawals.html"]').forEach((link) => {
      const badge = document.createElement("span");
      badge.className = "nav-count";
      badge.dataset.withdrawalCount = "";
      badge.textContent = pendingWithdrawalCount > 99 ? "99+" : String(pendingWithdrawalCount);
      link.append(badge);
    });
  }
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
      <p class="balance-growth" id="balance-growth" ${currentProfitCycle ? "" : "hidden"}></p>
      <div class="balance-footer"><span class="balance-foot">${currentUser ? "Account balance" : "No account connected"}</span><span class="balance-period">USD · US Dollar</span></div>
    </section>
    ${authActions}
    <div class="actions" aria-label="Account actions">
      <button class="action-button primary" type="button" data-action="deposit"><span class="action-symbol" aria-hidden="true">＋</span>Deposit</button>
      <button class="action-button" type="button" data-action="withdraw"><span class="action-symbol" aria-hidden="true">↓</span>Withdraw</button>
      <button class="action-button" type="button" data-action="transfer"><span class="action-symbol" aria-hidden="true">↗</span>Transfer</button>
    </div>
    <section id="activity" aria-labelledby="activity-heading">
      <div class="section-heading"><div><p class="eyebrow">Your account</p><h2 id="activity-heading">Recent activity</h2></div><a class="section-link" href="profit.html">Profit progress <span aria-hidden="true">→</span></a></div>
      <div class="activity-card" id="activity-list"></div>
    </section>`, "dashboard", currentUsername);

  renderActivity();
  updateBalanceGrowth();
  document.querySelector<HTMLButtonElement>("#visibility-toggle")?.addEventListener("click", () => {
    balanceVisible = !balanceVisible;
    renderDashboard();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "transfer") {
        showTransferCard();
      } else if (action === "deposit") {
        void showDepositFlow();
      } else if (action === "withdraw") {
        void showWithdrawalFlow();
      } else {
        showNotice(`${capitalize(action ?? "Action")} unavailable`, "Please contact support for assistance.");
      }
    });
  });
}

function renderActivity() {
  const activityRoot = document.querySelector<HTMLDivElement>("#activity-list");
  if (!activityRoot) return;
  if (!accountActivity.length) {
    activityRoot.innerHTML = '<div class="empty-state"><span class="empty-state-icon" aria-hidden="true">↗</span><p>No activity to show yet. Your account activity will appear here.</p></div>';
    return;
  }
  activityRoot.innerHTML = `<div class="activity-list">${accountActivity.map((item) => {
    const incoming = item.type === "received"
      || (item.type === "deposit" && item.status === "approved")
      || (item.type === "withdrawal" && item.status === "rejected")
      || (item.type === "profit" && item.amountCents > 0);
    let title: string;
    if (item.type === "deposit") {
      title = item.status === "approved" ? "Deposit successful" : item.status === "rejected" ? "Deposit rejected" : "Deposit request";
    } else if (item.type === "withdrawal") {
      title = item.status === "completed" ? "Withdrawal sent" : item.status === "rejected" ? "Withdrawal returned" : "Withdrawal request";
    } else if (item.type === "profit") {
      title = item.status === "fee" ? "Cycle fee" : "Profit credited";
    } else {
      title = item.type === "received" ? "Transfer received" : "Transfer sent";
    }
    const timestamp = item.createdAt ? item.createdAt.toDate().toLocaleString() : "Just now";
    const outgoing = item.type === "sent" || (item.type === "withdrawal" && item.status !== "rejected")
      || (item.type === "profit" && item.amountCents < 0);
    const sign = incoming ? "+" : outgoing ? "−" : "";
    return `<article class="activity-row">
      <span class="activity-row-icon ${incoming ? "is-incoming" : ""}" aria-hidden="true">${item.type === "deposit" ? "↓" : item.type === "withdrawal" ? "↑" : item.type === "profit" ? item.amountCents < 0 ? "−" : "↗" : item.type === "received" ? "↙" : "↗"}</span>
      <span class="activity-row-copy"><strong>${title}</strong><small>${escapeHtml(item.detail)} · ${escapeHtml(timestamp)}</small></span>
      <span class="activity-row-amount ${incoming ? "is-incoming" : outgoing ? "is-outgoing" : ""}">${sign}${formatCurrency(Math.abs(item.amountCents))}</span>
      <span class="activity-status status-${escapeHtml(item.status)}">${escapeHtml(capitalize(item.status))}</span>
    </article>`;
  }).join("")}</div>`;
}

function updateBalanceGrowth() {
  const element = document.querySelector<HTMLParagraphElement>("#balance-growth");
  if (!element) return;
  const netEarnings = currentProfitCycle
    ? currentProfitCycle.totalProfitCents - currentProfitCycle.totalFeeCents
    : 0;
  element.hidden = !currentProfitCycle || netEarnings <= 0;
  element.textContent = `Cycle earnings  +${formatCurrency(Math.max(0, netEarnings))}`;
}

function renderProfitPage() {
  const projection: {
    day: number;
    openingCents: number;
    growthCents: number;
    postGrowthCents: number;
    feeCents: number;
    netCents: number;
  }[] = [];
  let openingCents = 1_000;
  for (let day = 1; day <= 5; day += 1) {
    const growthCents = Math.round(openingCents * 0.053);
    const postGrowthCents = openingCents + growthCents;
    const feeCents = Math.round(postGrowthCents * 0.01);
    const netCents = postGrowthCents - feeCents;
    projection.push({
      day,
      openingCents,
      growthCents,
      postGrowthCents,
      feeCents,
      netCents,
    });
    openingCents = netCents;
  }
  const coordinates = projection.map((row, index) => {
    const x = 28 + index * 86;
    const y = 124 - (row.netCents / projection[projection.length - 1].netCents) * 90;
    return { x, y: y.toFixed(1) };
  });
  const points = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = `M${coordinates[0].x} ${coordinates[0].y} ${coordinates.slice(1).map((point) => `L${point.x} ${point.y}`).join(" ")} L${coordinates[coordinates.length - 1].x} 136 L${coordinates[0].x} 136 Z`;
  const finalCents = projection[projection.length - 1].netCents;
  const activeCycle = currentProfitCycle?.status === "active" ? currentProfitCycle : null;
  const completedCycle = currentProfitCycle?.status === "completed" ? currentProfitCycle : null;
  const cycleProgressHours = activeCycle
    ? Math.min(120, Math.max(0, (activeCycle.dayNumber - 1) * 24 + activeCycle.hourInDay))
    : 0;
  const hoursLeft = activeCycle
    ? Math.max(0, Math.ceil((activeCycle.startedAtMs + 120 * 60 * 60 * 1000 - Date.now()) / (60 * 60 * 1000)))
    : 0;
  const cyclePanel = activeCycle
    ? `<section class="cycle-status-card" aria-live="polite">
        <div class="cycle-status-header"><div><p class="eyebrow">Cycle ${activeCycle.dayNumber} of 5</p><h2>Five-day cycle active</h2></div><span class="cycle-live-pill"><i></i> ACTIVE</span></div>
        <div class="cycle-progress-track"><span style="width:${Math.min(100, (cycleProgressHours / 120) * 100)}%"></span></div>
        <div class="cycle-stat-grid">
          <div><span>Time left</span><strong data-cycle-time-left>${Math.floor(hoursLeft / 24)}d ${hoursLeft % 24}h</strong></div>
          <div><span>Profit earned</span><strong class="cycle-positive">+${formatCurrency(Math.max(0, activeCycle.totalProfitCents - activeCycle.totalFeeCents))}</strong></div>
          <div><span>Fee deducted</span><strong class="cycle-negative">−${formatCurrency(activeCycle.totalFeeCents)}</strong></div>
          <div><span>Growing amount</span><strong>${formatCurrency(activeCycle.currentAmountCents)}</strong></div>
        </div>
        <p class="cycle-status-copy">Hourly earnings are added to your available balance. Withdrawals and transfers are paused until the five-day cycle finishes.</p>
        <button class="button button-secondary" type="button" disabled>Withdrawals available after cycle completion</button>
      </section>`
    : completedCycle
      ? `<section class="cycle-status-card cycle-complete-card">
          <div class="cycle-status-header"><div><p class="eyebrow">Cycle complete</p><h2>Your five-day cycle is finished</h2></div><span class="cycle-complete-pill">COMPLETE</span></div>
          <p>Your reserved starting amount has returned to your available balance. Withdrawals are available.</p>
          <div class="receipt-actions"><button class="button button-primary" type="button" data-profit-withdraw>Withdraw</button><button class="button button-secondary" type="button" data-profit-start>Start another cycle</button></div>
        </section>`
      : currentUser && balanceCents > 0
        ? `<section class="progress-start-card"><div><p class="eyebrow">Ready when you are</p><h2>Grow a selected amount</h2><p>Choose an amount from your available balance to start a five-day cycle.</p></div><button class="button button-primary" type="button" data-profit-start>Start growing profit</button></section>`
        : `<section class="progress-empty-state"><span class="progress-empty-icon" aria-hidden="true">↗</span><div><h2>Deposit before starting</h2><p>${currentUser ? "Your available balance is $0.00. Make a deposit before starting a profit cycle." : "Log in and deposit funds before starting a profit cycle."}</p></div><button class="button button-primary" type="button" data-progress-deposit>Make a deposit</button></section>`;

  if (profitCountdownTimer !== null) window.clearInterval(profitCountdownTimer);
  frame(`
    <p class="eyebrow">Account growth</p>
    <h1>Profit progress</h1>
    <p class="intro">Follow your five-day cycle and review the daily growth, fees, and account activity.</p>
    <section class="profit-terminal" aria-label="Account balance and five-day growth schedule">
      <div class="profit-terminal-head"><span class="profit-market-tag"><i></i> ACCOUNT BALANCE</span><span class="profit-illustration-tag">5 DAY CYCLE</span></div>
      <div class="profit-terminal-grid">
        <div class="profit-equity"><span>Available balance</span><strong id="profit-balance">${formatCurrency(currentUser ? balanceCents : 0)} <small>USD</small></strong><p>${currentUser ? "Current credited balance" : "Log in to view your account balance"}</p>${currentProfitCycle && currentProfitCycle.totalProfitCents > currentProfitCycle.totalFeeCents ? `<p class="profit-balance-growth">Cycle earnings +${formatCurrency(currentProfitCycle.totalProfitCents - currentProfitCycle.totalFeeCents)}</p>` : ""}</div>
        <div class="profit-projected"><span>Net after day 5</span><strong>${formatCurrency(finalCents)}</strong><p>From a $10.00 starting amount</p></div>
      </div>
      <div class="profit-chart-heading"><span>NET AMOUNT BY DAY</span></div>
      <svg class="profit-chart" viewBox="0 0 400 150" role="img" aria-label="Five-day growth schedule from a $10 starting amount">
        <defs><linearGradient id="profit-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#20c978" stop-opacity=".28"/><stop offset="1" stop-color="#20c978" stop-opacity="0"/></linearGradient></defs>
        <path class="profit-chart-area" d="${areaPath}"/>
        <polyline class="profit-chart-line" points="${points}"/>
        ${projection.map((row, index) => `<circle class="profit-chart-point" cx="${coordinates[index].x}" cy="${coordinates[index].y}" r="4"><title>Day ${row.day}: ${formatCurrency(row.netCents)}</title></circle>`).join("")}
      </svg>
      <div class="profit-chart-labels"><span>Day 1</span><span>Day 2</span><span>Day 3</span><span>Day 4</span><span>Day 5</span></div>
    </section>
    <section class="projection-card" aria-labelledby="projection-heading">
      <div class="projection-heading"><div><p class="eyebrow">Five-day schedule · USD</p><h2 id="projection-heading">Calculation for a $10.00 start</h2></div><span class="projection-badge">5.3% daily growth</span></div>
      <div class="projection-table-wrap"><table class="projection-table">
        <thead><tr><th>Day</th><th>Opening</th><th>Daily growth</th><th>After growth</th><th>Fee · 1%</th><th>Net amount</th></tr></thead>
        <tbody>${projection.map((row) => `<tr><td>Day ${row.day}</td><td>${formatCurrency(row.openingCents)}</td><td class="projection-net">+${formatCurrency(row.growthCents)}</td><td>${formatCurrency(row.postGrowthCents)}</td><td class="projection-fee">−${formatCurrency(row.feeCents)}</td><td class="projection-net">${formatCurrency(row.netCents)}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="projection-summary"><span>Starting amount <strong>${formatCurrency(1_000)}</strong></span><span>Total fees <strong>−${formatCurrency(projection.reduce((total, row) => total + row.feeCents, 0))}</strong></span><span>Net after day 5 <strong>${formatCurrency(finalCents)}</strong></span></div>
      <p class="cycle-formula-note">The table calculates a $10.00 starting amount. A different cycle amount follows the same daily 5.3% growth, then a 1% fee on the amount after growth. Hourly earnings are credited to your available balance; the daily fee is recorded at the end of each 24-hour period.</p>
    </section>
    ${cyclePanel}
    <div class="progress-page-actions"><a class="button button-secondary" href="index.html#activity">View account activity</a><a class="button button-secondary" href="assistant.html">Ask the assistant</a></div>`, "profit", currentUsername);

  document.querySelector<HTMLButtonElement>("[data-progress-deposit]")?.addEventListener("click", () => void showDepositFlow());
  document.querySelectorAll<HTMLButtonElement>("[data-profit-start]").forEach((button) => {
    button.addEventListener("click", () => showProfitStartFlow());
  });
  document.querySelector<HTMLButtonElement>("[data-profit-withdraw]")?.addEventListener("click", () => void showWithdrawalFlow());
  if (activeCycle) {
    profitCountdownTimer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((activeCycle.startedAtMs + 120 * 60 * 60 * 1000 - Date.now()) / (60 * 60 * 1000)));
      const element = document.querySelector<HTMLElement>("[data-cycle-time-left]");
      if (element) element.textContent = `${Math.floor(remaining / 24)}d ${remaining % 24}h`;
    }, 60_000);
  }
}

function renderAssistantPage() {
  frame(`
    <p class="eyebrow">Triplex help</p>
    <h1>TRIPLEX AI ASSISTANT</h1>
    <p class="intro">Ask about features and steps available on this website.</p>
    <section class="assistant-shell" aria-label="Triplex help chat">
      <header class="assistant-header">
        <span class="assistant-mascot" data-mascot aria-hidden="true"><span>✦</span></span>
        <div class="assistant-heading"><strong>TRIPLEX AI ASSISTANT</strong><span>Triplex website help · ready to assist</span></div>
        <button class="assistant-reset" id="assistant-reset" type="button">New chat</button>
      </header>
      <div class="assistant-welcome"><span class="assistant-welcome-kicker">WELCOME TO TRIPLEX</span><h2>How can I help?</h2><p>Get clear guidance on deposits, network choices, account activity, and the cycle breakdown. For account-specific payment updates, check your notifications or contact support.</p></div>
      <details class="assistant-suggestions" open>
        <summary>View suggestions</summary>
        <div class="assistant-suggestion-list">
          ${[
            "How do I make a deposit?",
            "How does the first-deposit gift work?",
            "Which network should I choose?",
            "What if I send to the wrong network?",
            "How long does deposit review take?",
            "How do actual earnings get added?",
            "How long is a profit cycle?",
            "Can I withdraw?",
            "How do I contact support?",
          ].map((suggestion) => `<button type="button" class="assistant-suggestion">${escapeHtml(suggestion)}</button>`).join("")}
        </div>
      </details>
      <div class="assistant-messages" id="assistant-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Chat messages"></div>
      <p class="assistant-typing-status" id="assistant-typing-status" role="status" aria-live="polite"></p>
      <form class="assistant-form" id="assistant-form">
        <label class="sr-only" for="assistant-input">Message Triplex AI Assistant</label>
        <textarea id="assistant-input" name="message" rows="1" maxlength="500" placeholder="Ask a question…" autocomplete="off"></textarea>
        <button class="assistant-send" id="assistant-send" type="submit" aria-label="Send message" disabled><span aria-hidden="true">➤</span></button>
      </form>
      <p class="assistant-privacy">For your safety, don’t share passwords, PINs, seed phrases, private keys, or sensitive payment details.</p>
    </section>`, "assistant", currentUsername);

  const conversation = document.querySelector<HTMLDivElement>("#assistant-messages")!;
  const form = document.querySelector<HTMLFormElement>("#assistant-form")!;
  const input = document.querySelector<HTMLTextAreaElement>("#assistant-input")!;
  const send = document.querySelector<HTMLButtonElement>("#assistant-send")!;
  const reset = document.querySelector<HTMLButtonElement>("#assistant-reset")!;
  const status = document.querySelector<HTMLParagraphElement>("#assistant-typing-status")!;
  const mascot = document.querySelector<HTMLSpanElement>("[data-mascot]")!;
  const suggestions = document.querySelector<HTMLDetailsElement>(".assistant-suggestions")!;
  const messages: AssistantMessage[] = [];
  let responding = false;

  const appendMessage = (message: AssistantMessage) => {
    messages.push(message);
    const item = document.createElement("article");
    item.className = `assistant-message ${message.sender === "user" ? "from-user" : "from-assistant"}`;
    if (message.sender === "assistant") {
      const avatar = document.createElement("span");
      avatar.className = "assistant-message-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = "✦";
      item.append(avatar);
    }
    const bubble = document.createElement("div");
    bubble.className = "assistant-bubble";
    const text = document.createElement("p");
    text.textContent = message.text;
    bubble.append(text);
    if (message.link) {
      const link = document.createElement("a");
      link.className = "assistant-reply-link";
      link.href = message.link.href;
      link.textContent = message.link.label;
      bubble.append(link);
    }
    const time = document.createElement("time");
    time.dateTime = message.time.toISOString();
    time.textContent = message.time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    bubble.append(time);
    item.append(bubble);
    conversation.append(item);
    conversation.scrollTop = conversation.scrollHeight;
  };

  const greeting = (): AssistantMessage => ({
    sender: "assistant",
    text: "Hi! Welcome to Triplex. I can guide you through deposits, supported networks, account activity, and the cycle breakdown. What can I help you with today?",
    time: new Date(),
  });
  appendMessage(greeting());

  document.querySelectorAll<HTMLButtonElement>(".assistant-suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.textContent || "";
      send.disabled = responding || !input.value.trim();
      suggestions.open = false;
      input.focus();
    });
  });

  const replyTo = (message: string): AssistantReply => {
    const normalized = message.toLowerCase();
    if (/\b(hi|hello|hey|good morning|good afternoon)\b/.test(normalized)) {
      return { text: "Hello! I’m happy to help with deposits, network choices, account activity, cycle calculations, and support." };
    }
    if (/\b(thank|thanks|appreciate)\b/.test(normalized)) {
      return { text: "You’re welcome. If you have another question about the site, feel free to ask." };
    }
    if (/\b(bye|goodbye|see you)\b/.test(normalized)) {
      return { text: "Thanks for visiting Triplex. Contact support if you need help with an account or payment." };
    }
    if (/\b(help|what can you do|what can i ask)\b/.test(normalized)) {
      return { text: "I can walk you through making a deposit, choosing the matching network, checking account activity, understanding the five-day profit cycle, submitting a withdrawal request, transferring to another Triplex user, or contacting support. Choose a suggestion below or type your question." };
    }
    if (/\b(wrong network|wrong chain|sent to the wrong|wrong address)\b/.test(normalized)) {
      return { text: "Please contact Triplex support as soon as possible and include the asset, network, destination address, and transaction hash. Recovery depends on the network and receiving wallet and cannot be guaranteed, so please don’t send another payment until support has advised you.", link: { label: "Contact customer support", href: "contact.html" } };
    }
    if (/\b(first|initial).{0,20}(deposit|gift|bonus)\b|\b(deposit|gift|bonus).{0,20}(first|20 ?%)\b/.test(normalized)) {
      return { text: "Eligible accounts receive a 20% gift bonus on their first approved deposit. The deposit screen previews the estimated bonus; the bonus is credited to your USD balance together with the deposit after approval. Each account can receive this bonus once." };
    }
    if (/\b(network|chain|which.*(send|choose)|send.*(usdt|usdc|crypto))\b/.test(normalized)) {
      return { text: "For a successful deposit, select the same asset and exact same network in Triplex and in your sending wallet. The deposit screen lists the networks currently available for each asset. Check the full destination address and network before confirming your transfer.", link: { label: "Open your dashboard", href: "index.html" } };
    }
    if (/\b(deposit|receipt|proof of payment|payment request)\b/.test(normalized)) {
      return { text: "To deposit, sign in and open Deposit from your dashboard. Choose an asset and an available network, copy the displayed address, and enter at least $10 USD. You can attach a JPG, PNG, WebP, or PDF receipt, then confirm and submit your request. Your USD balance updates after the deposit has been reviewed and approved.", link: { label: "Start a deposit", href: "index.html" } };
    }
    if (/\b(review|pending|how long|when.*(balance|deposit)|approve|approved)\b/.test(normalized)) {
      return { text: "Deposit reviews usually take about 24 hours. If 24 hours have passed without an update, please message customer support and include your deposit details. You’ll also receive an in-app notification when your request is reviewed; approved deposits are then added to your USD balance.", link: { label: "Contact customer support", href: "contact.html" } };
    }
    if (/\b(actual )?earnings?\b|\b(per|each|every) cycle\b/.test(normalized)) {
      return { text: "A profit cycle lasts five days. Earnings are calculated at 5.3% per day and credited in hourly portions. At the end of each 24-hour day, a 1% fee is deducted from the amount after growth, and that net amount is used as the next day's opening amount. Your activity shows each hourly credit and daily fee. Withdrawals and transfers are paused until the cycle completes.", link: { label: "View profit progress", href: "profit.html" } };
    }
    if (/\b(how long|duration|days?).*(profit|cycle)|(profit|cycle).*(how long|duration|days?)\b/.test(normalized)) {
      return { text: "Each profit cycle runs for five days. The Profit progress page shows the current day, time remaining, earnings credited, and fees deducted. When day five is complete, the reserved starting amount returns to your available balance and withdrawals reopen.", link: { label: "View profit progress", href: "profit.html" } };
    }
    if (/\b(fee|charge|service charge|cost)\b/.test(normalized)) {
      return { text: "The profit cycle deducts a 1% fee at the end of each 24-hour day. The fee is calculated from that day's amount after the 5.3% growth and appears as a separate red entry in account activity.", link: { label: "View profit progress", href: "profit.html" } };
    }
    if (/\b(profit|earning|growth|return|5\.3|projection|progress)\b/.test(normalized)) {
      return { text: "Profit progress shows a five-day calculation based on a $10 starting amount: 5.3% daily growth, followed by a 1% fee on the post-growth amount. Your selected amount is reserved for the five-day cycle; hourly earnings and daily fees appear in your activity as they are processed.", link: { label: "View profit progress", href: "profit.html" } };
    }
    if (/\b(withdraw|cash ?out)\b/.test(normalized)) {
      return { text: "You can submit a withdrawal request from the dashboard. Choose the cryptocurrency and network, enter the USD amount (minimum $20), and carefully check the destination wallet address. The requested amount is reserved from your balance while an admin reviews and manually processes the payment. You’ll be notified when it is marked paid or rejected; if rejected, the reserved amount is returned to your balance.", link: { label: "Open your dashboard", href: "index.html" } };
    }
    if (/\b(transfer|send.*user|username)\b/.test(normalized)) {
      return { text: "You can transfer funds to another Triplex account from your dashboard. Enter the recipient’s username and amount, double-check the username, then confirm the transfer.", link: { label: "Open your dashboard", href: "index.html" } };
    }
    if (/\b(login|log in|sign in|account|google)\b/.test(normalized)) {
      return { text: "Getting started is simple: choose Log in or Create account, continue securely with Google, and choose a username if prompted.", link: { label: "Continue to log in", href: "login.html" } };
    }
    if (/\b(support|contact|whatsapp|help desk)\b/.test(normalized)) {
      return { text: "The Contact page has the Triplex customer support WhatsApp link. Include a short description of what you need help with, and never share your password, verification codes, or wallet recovery phrase.", link: { label: "Contact customer support", href: "contact.html" } };
    }
    return { text: "I want to make sure you get accurate information. I can help with deposits, network selection, deposit reviews, transfers, and the cycle breakdown. For anything account-specific, customer support can assist you directly.", link: { label: "Contact customer support", href: "contact.html" } };
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || responding || text.length > 500) return;
    appendMessage({ sender: "user", text, time: new Date() });
    input.value = "";
    responding = true;
    send.disabled = true;
    reset.disabled = true;
    status.textContent = "Triplex Assistant is preparing a reply.";
    mascot.classList.add("is-thinking");
    const typing = document.createElement("div");
    typing.className = "assistant-typing";
    typing.setAttribute("aria-hidden", "true");
    typing.innerHTML = "<i></i><i></i><i></i>";
    conversation.append(typing);
    conversation.scrollTop = conversation.scrollHeight;
    window.setTimeout(() => {
      typing.remove();
      const reply = replyTo(text);
      appendMessage({ sender: "assistant", text: reply.text, link: reply.link, time: new Date() });
      responding = false;
      reset.disabled = false;
      send.disabled = !input.value.trim();
      status.textContent = "Reply ready.";
      mascot.classList.remove("is-thinking");
      mascot.classList.add("is-happy");
      window.setTimeout(() => mascot.classList.remove("is-happy"), 700);
    }, 420);
  });

  input.addEventListener("input", () => {
    send.disabled = responding || !input.value.trim();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  reset.addEventListener("click", () => {
    if (responding) return;
    messages.length = 0;
    conversation.replaceChildren();
    suggestions.open = false;
    input.value = "";
    status.textContent = "";
    mascot.classList.remove("is-thinking", "is-happy");
    appendMessage(greeting());
    input.focus();
  });
}

async function showDepositFlow() {
  if (!currentUser) {
    showNotice("Log in to deposit", "Create an account or log in before starting a deposit.");
    return;
  }
  document.querySelector<HTMLElement>("#notice-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "notice-overlay";
  overlay.className = "notice-overlay deposit-overlay";
  overlay.innerHTML = `
    <section class="notice-card deposit-card" role="dialog" aria-modal="true" aria-labelledby="deposit-title">
      <button class="notice-close" type="button" aria-label="Close deposit">×</button>
      <p class="eyebrow">Add funds</p>
      <h2 id="deposit-title">Select cryptocurrency</h2>
      <div id="deposit-content" class="deposit-content"><div class="deposit-loading"><span class="loader-orbit"></span><p>Loading deposit methods…</p></div></div>
    </section>`;
  const close = () => overlay.remove();
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  const content = overlay.querySelector<HTMLDivElement>("#deposit-content")!;
  const title = overlay.querySelector<HTMLHeadingElement>("#deposit-title")!;
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.focus();

  let assets: DepositAsset[];
  try {
    ({ assets } = await apiRequest<{ assets: DepositAsset[] }>("/api/deposits/options"));
  } catch (error) {
    content.innerHTML = `<p class="deposit-error">${escapeHtml(errorMessage(error))}</p>`;
    return;
  }

  const renderAssets = () => {
    title.textContent = "Select cryptocurrency";
    content.innerHTML = `
      <p class="deposit-intro">Choose the cryptocurrency you want to deposit.</p>
      <div class="crypto-grid">${assets.map((asset) => `
        <button class="crypto-choice" type="button" data-asset="${escapeHtml(asset.code)}">
          <span class="crypto-symbol crypto-${escapeHtml(asset.code.toLowerCase())}">${escapeHtml(asset.symbol)}</span>
          <span><strong>${escapeHtml(asset.code)}</strong><small>${escapeHtml(asset.name)}</small></span>
          <span class="crypto-chevron" aria-hidden="true">›</span>
        </button>`).join("")}</div>`;
    content.querySelectorAll<HTMLButtonElement>("[data-asset]").forEach((button) => {
      button.addEventListener("click", () => {
        const selected = assets.find((asset) => asset.code === button.dataset.asset);
        if (selected) renderNetworks(selected);
      });
    });
  };

  const renderNetworks = (asset: DepositAsset) => {
    title.textContent = `Select ${asset.code} network`;
    content.innerHTML = `
      <button class="deposit-back" type="button">← All cryptocurrencies</button>
      <div class="network-safety"><span aria-hidden="true">ⓘ</span><p>Only send ${escapeHtml(asset.code)} using the selected network. Sending through another network may result in lost funds.</p></div>
      <div class="network-list">${asset.networks.map((network) => `
        <button class="network-choice" type="button" data-network="${escapeHtml(network.code)}" ${network.available ? "" : "disabled"}>
          <span>${escapeHtml(network.name)}</span><span class="${network.available ? "network-arrow" : "network-unavailable"}">${network.available ? "›" : "Unavailable"}</span>
        </button>`).join("")}</div>`;
    content.querySelector<HTMLButtonElement>(".deposit-back")!.addEventListener("click", renderAssets);
    content.querySelectorAll<HTMLButtonElement>("[data-network]").forEach((button) => {
      button.addEventListener("click", () => {
        const network = asset.networks.find((item) => item.code === button.dataset.network);
        if (network?.available) void renderDepositAddress(asset, network);
      });
    });
  };

  const renderDepositAddress = async (asset: DepositAsset, network: DepositNetwork) => {
    title.textContent = "Preparing deposit";
    content.innerHTML = `<div class="deposit-loading"><span class="loader-orbit"></span><p>Generating ${escapeHtml(asset.code)} ${escapeHtml(network.name)} address…</p></div>`;
    let address: string;
    let firstDepositBonusEligible = false;
    try {
      const result = await apiRequest<{
        address: string;
        networkName: string;
        firstDepositBonus: { eligible: boolean; percentage: number };
      }>(
        `/api/deposits/address?asset=${encodeURIComponent(asset.code)}&network=${encodeURIComponent(network.code)}`,
      );
      address = result.address;
      firstDepositBonusEligible = result.firstDepositBonus.eligible;
    } catch (error) {
      content.innerHTML = `<button class="deposit-back" type="button">← Select another network</button><p class="deposit-error">${escapeHtml(errorMessage(error))}</p>`;
      content.querySelector<HTMLButtonElement>(".deposit-back")!.addEventListener("click", () => renderNetworks(asset));
      return;
    }

    title.textContent = `${asset.code} deposit`;
    content.innerHTML = `
      <button class="deposit-back" type="button">← Change network</button>
      <div class="deposit-network-pill">${escapeHtml(network.name)}</div>
      <div class="deposit-warning"><strong>Network matters</strong><span>Send only ${escapeHtml(asset.code)} over ${escapeHtml(network.name)} to this address.</span></div>
      <label class="deposit-label" for="deposit-address">Deposit address</label>
      <div class="deposit-address"><code id="deposit-address">${escapeHtml(address)}</code><button id="copy-address" type="button">Copy</button></div>
      <label class="deposit-label" for="deposit-amount">Amount to deposit (USD)</label>
      <div class="amount-field"><span>$</span><input id="deposit-amount" type="number" min="10.00" step="0.01" inputmode="decimal" placeholder="10.00" required></div>
      ${firstDepositBonusEligible
        ? `<section class="deposit-gift-offer" aria-label="First deposit gift bonus">
            <span class="deposit-gift-icon" aria-hidden="true">🎁</span>
            <div class="deposit-gift-copy"><strong>FIRST DEPOSIT GIFT · 20% EXTRA</strong><span>Get a 20% bonus on your first approved deposit.</span><small id="deposit-bonus-estimate">Enter your deposit amount to preview your gift.</small></div>
            <span class="deposit-gift-sparkle" aria-hidden="true">✦</span>
          </section>`
        : `<p class="deposit-gift-claimed">Your first-deposit gift bonus has already been claimed on this account.</p>`}
      <label class="deposit-label" for="receipt-file">Payment receipt <span>(optional)</span></label>
      <input class="receipt-file" id="receipt-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf">
      <p class="receipt-file-note" id="receipt-file-note">Upload a screenshot or PDF, up to 10 MB.</p>
      <div class="deposit-receipt-preview" id="deposit-receipt-preview" hidden></div>
      <button class="button button-primary deposit-complete" id="deposit-complete" type="button">Complete payment</button>
      <div class="deposit-confirmation" id="deposit-confirmation" hidden></div>`;
    content.querySelector<HTMLButtonElement>(".deposit-back")!.addEventListener("click", () => renderNetworks(asset));
    content.querySelector<HTMLButtonElement>("#copy-address")!.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(address);
        content.querySelector<HTMLButtonElement>("#copy-address")!.textContent = "Copied";
      } catch {
        showNotice("Could not copy address", "Select and copy the deposit address manually.");
      }
    });

    let uploadedReceipt: UploadedReceipt | null = null;
    const requestId = crypto.randomUUID();
    const fileInput = content.querySelector<HTMLInputElement>("#receipt-file")!;
    const fileNote = content.querySelector<HTMLParagraphElement>("#receipt-file-note")!;
    const preview = content.querySelector<HTMLDivElement>("#deposit-receipt-preview")!;
    const depositAmountInput = content.querySelector<HTMLInputElement>("#deposit-amount")!;
    const bonusEstimate = content.querySelector<HTMLElement>("#deposit-bonus-estimate");
    const updateBonusEstimate = () => {
      if (!bonusEstimate || !firstDepositBonusEligible) return;
      const amountCents = amountToCents(depositAmountInput.value);
      bonusEstimate.textContent = amountCents > 0
        ? `Your gift: +${formatCurrency(Math.round(amountCents * 0.2))} USD`
        : "Enter your deposit amount to preview your gift.";
    };
    depositAmountInput.addEventListener("input", updateBonusEstimate);
    updateBonusEstimate();
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      uploadedReceipt = null;
      if (!file) {
        fileNote.textContent = "Upload a screenshot or PDF, up to 10 MB.";
        preview.hidden = true;
        return;
      }
      if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) || file.size > 10 * 1024 * 1024) {
        fileInput.value = "";
        fileNote.textContent = "Choose a JPG, PNG, WebP, or PDF file up to 10 MB.";
        return;
      }
      fileNote.textContent = "Uploading securely…";
      preview.hidden = false;
      preview.textContent = `Uploading ${file.name}…`;
      fileInput.disabled = true;
      try {
        uploadedReceipt = await uploadReceipt(file, asset.code, network.code);
        fileNote.textContent = "Receipt uploaded.";
        preview.textContent = `✓ ${file.name}`;
      } catch (error) {
        fileInput.value = "";
        fileNote.textContent = "Upload failed. Please choose the file again and retry.";
        preview.textContent = errorMessage(error);
      } finally {
        fileInput.disabled = false;
      }
    });

    const completeButton = content.querySelector<HTMLButtonElement>("#deposit-complete")!;
    completeButton.addEventListener("click", () => {
      const amountCents = amountToCents(depositAmountInput.value);
      if (amountCents < 1_000) {
        showNotice("Minimum deposit is $10.00", "Enter a deposit amount of at least $10.00.");
        return;
      }
      if (fileInput.files?.length && !uploadedReceipt) {
        showNotice("Receipt upload in progress", "Wait for the selected receipt to finish uploading before continuing.");
        return;
      }
      const confirmation = content.querySelector<HTMLDivElement>("#deposit-confirmation")!;
      confirmation.hidden = false;
      confirmation.innerHTML = `
        <div class="deposit-fraud-warning"><strong>WARNING</strong><span>Payment receipts are checked strictly. Submitting a fake payment receipt may result in your account being permanently banned.</span></div>
        <label class="deposit-agree"><input id="deposit-agree" type="checkbox"><span>I confirm that this payment is legitimate and the details are correct.</span></label>
        <button class="button button-primary deposit-confirm" id="deposit-confirm" type="button" disabled>Confirm payment</button>`;
      const agree = confirmation.querySelector<HTMLInputElement>("#deposit-agree")!;
      const confirm = confirmation.querySelector<HTMLButtonElement>("#deposit-confirm")!;
      agree.addEventListener("change", () => { confirm.disabled = !agree.checked; });
      confirm.addEventListener("click", async () => {
        if (!agree.checked) return;
        confirm.disabled = true;
        confirm.textContent = "Submitting…";
        try {
          await apiRequest("/api/deposits/requests", {
            method: "POST",
            body: {
              asset: asset.code,
              network: network.code,
              amountCents,
              requestId,
              ...(uploadedReceipt ? { uploadRequestId: uploadedReceipt.requestId, publicId: uploadedReceipt.publicId } : {}),
            },
          });
          overlay.remove();
          showNotice(
            "Payment request received",
            "Your payment request is under review. Your USD balance will be updated once approved. Reviews can take up to 24 hours; contact customer support if your payment is delayed.",
          );
        } catch (error) {
          confirm.disabled = false;
          confirm.textContent = "Confirm payment";
          showNotice("Could not submit payment request", errorMessage(error));
        }
      });
    });
  };

  renderAssets();
}

async function uploadReceipt(file: File, asset: string, network: string): Promise<UploadedReceipt> {
  const signed = await apiRequest<UploadSignature>("/api/uploads/sign", {
    method: "POST",
    body: { asset, network },
  });
  const body = new FormData();
  body.append("file", file);
  body.append("api_key", signed.apiKey);
  body.append("signature", signed.signature);
  for (const [key, value] of Object.entries(signed.params)) body.append(key, String(value));

  const response = await fetch(signed.uploadUrl, { method: "POST", body });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== "object") {
    throw new Error(
      result && typeof result === "object" && "error" in result && typeof result.error === "object"
        && result.error && "message" in result.error && typeof result.error.message === "string"
        ? result.error.message
        : "Cloudinary could not accept this receipt.",
    );
  }
  const uploadedAsset = result as { public_id?: unknown; format?: unknown; bytes?: unknown };
  if (
    typeof uploadedAsset.public_id !== "string"
    || uploadedAsset.public_id !== `triplex-receipts/${currentUser?.uid}/${signed.requestId}`
    || !Number.isSafeInteger(uploadedAsset.bytes)
    || Number(uploadedAsset.bytes) <= 0
    || Number(uploadedAsset.bytes) > 10 * 1024 * 1024
    || typeof uploadedAsset.format !== "string"
    || !["jpg", "jpeg", "png", "webp", "pdf"].includes(uploadedAsset.format.toLowerCase())
  ) {
    throw new Error("The uploaded receipt could not be verified.");
  }
  return { requestId: signed.requestId, publicId: uploadedAsset.public_id };
}

function amountToCents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return 0;
  return Math.round(amount * 100);
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
    <h1>Admin dashboard</h1>
    <p class="intro">Review deposit and withdrawal requests, and manage member access.</p>
    <div class="admin-shortcuts">
      <a class="admin-shortcut" href="receipts.html"><span class="admin-shortcut-icon">▤</span><strong>Deposit receipts</strong><small>${pendingReceiptCount} awaiting review</small><span aria-hidden="true">→</span></a>
      <a class="admin-shortcut" href="withdrawals.html"><span class="admin-shortcut-icon">↓</span><strong>Withdrawals</strong><small>${pendingWithdrawalCount} awaiting review</small><span aria-hidden="true">→</span></a>
      <a class="admin-shortcut" href="members.html"><span class="admin-shortcut-icon">♙</span><strong>Members</strong><small>View member accounts</small><span aria-hidden="true">→</span></a>
    </div>`, "admin", currentUsername);
}

interface AdminReceipt {
  id: string;
  uid: string;
  userId: string;
  username: string;
  email: string;
  amount: number;
  amountCents: number;
  asset: string;
  networkName: string;
  receipt: { publicId: string; format: string; bytes: number } | null;
  cloudinaryUrl: string | null;
  createdAt: { _seconds?: number; seconds?: number } | null;
}

interface AdminMember {
  uid: string;
  username: string;
  email: string;
  role: "user" | "admin";
  isBanned: boolean;
}

interface AdminWithdrawal {
  id: string;
  uid: string;
  userId: string;
  username: string;
  email: string;
  amount: number;
  amountCents: number;
  asset: string;
  network: string;
  networkName: string;
  walletAddress: string;
  createdAt: { _seconds?: number; seconds?: number } | null;
}

function renderReceiptsPage() {
  frame(`
    <p class="eyebrow">Admin workspace</p>
    <h1>Deposit receipts</h1>
    <p class="intro">Review pending deposit requests. Approving a request immediately credits the member's USD balance.</p>
    <section class="admin-list" aria-live="polite"><div id="admin-receipt-list" class="admin-list-content"><div class="deposit-loading"><span class="loader-orbit"></span><p>Loading deposit requests…</p></div></div></section>`,
  "receipts", currentUsername);
  void refreshAdminReceipts();
}

async function refreshAdminReceipts() {
  const list = document.querySelector<HTMLDivElement>("#admin-receipt-list");
  if (!list) return;
  try {
    const result = await apiRequest<{ receipts: AdminReceipt[] }>("/api/admin/receipts");
    if (!document.body.contains(list)) return;
    if (!result.receipts.length) {
      list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">✓</span><p>There are no pending deposit requests.</p></div>';
      return;
    }
    list.innerHTML = result.receipts.map((receipt) => `
      <article class="receipt-card">
        <div class="receipt-card-heading"><div><p class="eyebrow">${escapeHtml(receipt.asset)} · ${escapeHtml(receipt.networkName)}</p><h2>@${escapeHtml(receipt.username || "member")}</h2><p>${escapeHtml(receipt.email)}</p></div><strong class="receipt-amount">${formatCurrency(receipt.amountCents)}</strong></div>
        <div class="receipt-meta"><span>Submitted ${escapeHtml(formatTimestamp(receipt.createdAt))}</span><span>${receipt.receipt ? "Receipt attached" : "No receipt attached"}</span></div>
        <div class="receipt-actions">
          ${receipt.receipt ? `<button class="button button-secondary" type="button" data-view-receipt="${escapeHtml(receipt.id)}" data-uid="${escapeHtml(receipt.uid)}">View receipt</button>` : ""}
          <button class="button button-approve" type="button" data-approve-receipt="${escapeHtml(receipt.id)}" data-uid="${escapeHtml(receipt.uid)}" data-amount-cents="${receipt.amountCents}">Approve</button>
          <button class="button button-reject" type="button" data-reject-receipt="${escapeHtml(receipt.id)}" data-uid="${escapeHtml(receipt.uid)}">Reject</button>
        </div>
      </article>`).join("");
    list.querySelectorAll<HTMLButtonElement>("[data-view-receipt]").forEach((button) => {
      button.addEventListener("click", () => void viewAdminReceipt(button.dataset.uid || "", button.dataset.viewReceipt || ""));
    });
    list.querySelectorAll<HTMLButtonElement>("[data-approve-receipt]").forEach((button) => {
      button.addEventListener("click", () => void reviewReceipt(
        button.dataset.uid || "",
        button.dataset.approveReceipt || "",
        true,
        Number(button.dataset.amountCents) || 0,
      ));
    });
    list.querySelectorAll<HTMLButtonElement>("[data-reject-receipt]").forEach((button) => {
      button.addEventListener("click", () => void reviewReceipt(button.dataset.uid || "", button.dataset.rejectReceipt || "", false));
    });
  } catch (error) {
    if (document.body.contains(list)) list.innerHTML = `<p class="admin-error">${escapeHtml(errorMessage(error))}</p>`;
  }
}

function renderWithdrawalsPage() {
  frame(`
    <p class="eyebrow">Admin workspace</p>
    <h1>Withdrawal requests</h1>
    <p class="intro">Verify the exact asset, network, requested USD amount, and destination address. Mark complete only after manually sending the payment.</p>
    <section class="admin-list" aria-live="polite"><div id="admin-withdrawal-list" class="admin-list-content"><div class="deposit-loading"><span class="loader-orbit"></span><p>Loading withdrawal requests…</p></div></div></section>`,
  "withdrawals", currentUsername);
  void refreshAdminWithdrawals();
}

async function refreshAdminWithdrawals() {
  const list = document.querySelector<HTMLDivElement>("#admin-withdrawal-list");
  if (!list) return;
  try {
    const result = await apiRequest<{ withdrawals: AdminWithdrawal[] }>("/api/admin/withdrawals");
    if (!document.body.contains(list)) return;
    if (!result.withdrawals.length) {
      list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">✓</span><p>There are no pending withdrawal requests.</p></div>';
      return;
    }
    list.innerHTML = result.withdrawals.map((withdrawal) => `
      <article class="receipt-card">
        <div class="receipt-card-heading"><div><p class="eyebrow">${escapeHtml(withdrawal.asset)} · ${escapeHtml(withdrawal.networkName)}</p><h2>@${escapeHtml(withdrawal.username || withdrawal.userId || "member")}</h2><p>${escapeHtml(withdrawal.email)}</p></div><strong class="receipt-amount">${formatCurrency(withdrawal.amountCents)} USD</strong></div>
        <div class="withdrawal-review-details"><div><span>Wallet address</span><code>${escapeHtml(withdrawal.walletAddress)}</code></div><div><span>Request ID</span><code>${escapeHtml(withdrawal.id)}</code></div></div>
        <div class="receipt-meta"><span>Submitted ${escapeHtml(formatTimestamp(withdrawal.createdAt))}</span><span>Reserved from member balance</span></div>
        <div class="receipt-actions">
          <button class="button button-secondary" type="button" data-copy-withdrawal-address="${escapeHtml(withdrawal.walletAddress)}">Copy wallet address</button>
          <button class="button button-approve" type="button" data-complete-withdrawal="${escapeHtml(withdrawal.id)}">Confirm payment sent</button>
          <button class="button button-reject" type="button" data-reject-withdrawal="${escapeHtml(withdrawal.id)}">Reject and refund</button>
        </div>
      </article>`).join("");
    list.querySelectorAll<HTMLButtonElement>("[data-complete-withdrawal]").forEach((button) => {
      button.addEventListener("click", () => {
        const withdrawal = result.withdrawals.find((item) => item.id === button.dataset.completeWithdrawal);
        if (withdrawal) showWithdrawalCompletionDialog(withdrawal);
      });
    });
    list.querySelectorAll<HTMLButtonElement>("[data-copy-withdrawal-address]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copyWithdrawalAddress || "");
          showNotice("Wallet address copied", "Compare the copied address with the request before sending payment.");
        } catch {
          showNotice("Could not copy address", "Select and copy the displayed wallet address manually.");
        }
      });
    });
    list.querySelectorAll<HTMLButtonElement>("[data-reject-withdrawal]").forEach((button) => {
      button.addEventListener("click", () => {
        if (window.confirm("Reject this request? The reserved USD amount will be returned to the member's balance.")) {
          void reviewWithdrawal(button.dataset.rejectWithdrawal || "", "reject");
        }
      });
    });
  } catch (error) {
    if (document.body.contains(list)) list.innerHTML = `<p class="admin-error">${escapeHtml(errorMessage(error))}</p>`;
  }
}

function showWithdrawalCompletionDialog(withdrawal: AdminWithdrawal) {
  document.querySelector<HTMLElement>("#notice-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "notice-overlay";
  overlay.className = "notice-overlay";
  overlay.innerHTML = `
    <section class="notice-card transfer-card withdrawal-completion-card" role="dialog" aria-modal="true" aria-labelledby="withdrawal-completion-title">
      <button class="notice-close" type="button" aria-label="Close payment confirmation">×</button>
      <p class="eyebrow">Record manual payment</p>
      <h2 id="withdrawal-completion-title">Confirm payment sent</h2>
      <p class="transfer-explainer">Only continue after you have sent the payment. Verify the amount, cryptocurrency, network, and full wallet address first.</p>
      <div class="withdrawal-review-details">
        <div><span>Requested amount</span><strong>${formatCurrency(withdrawal.amountCents)} USD</strong></div>
        <div><span>Send as</span><strong>${escapeHtml(withdrawal.asset)} · ${escapeHtml(withdrawal.networkName)}</strong></div>
        <div><span>Destination wallet</span><code>${escapeHtml(withdrawal.walletAddress)}</code></div>
      </div>
      <form id="withdrawal-completion-form">
        <label for="paid-crypto-amount">Exact ${escapeHtml(withdrawal.asset)} amount sent</label>
        <input id="paid-crypto-amount" type="text" inputmode="decimal" maxlength="80" autocomplete="off" placeholder="0.00000000" required>
        <label for="withdrawal-transaction-hash">Blockchain transaction ID / hash</label>
        <input id="withdrawal-transaction-hash" type="text" minlength="8" maxlength="200" autocomplete="off" placeholder="Paste transaction hash" required>
        <label class="withdrawal-confirm-label"><input id="withdrawal-payment-confirmed" type="checkbox"> I confirm I have sent the payment to the exact address and network shown above.</label>
        <button class="button button-approve transfer-submit" id="withdrawal-completion-submit" type="submit" disabled>Record payment and notify member</button>
      </form>
    </section>`;
  const close = () => overlay.remove();
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.addEventListener("click", close);
  document.body.append(overlay);

  const form = overlay.querySelector<HTMLFormElement>("#withdrawal-completion-form")!;
  const amountInput = overlay.querySelector<HTMLInputElement>("#paid-crypto-amount")!;
  const hashInput = overlay.querySelector<HTMLInputElement>("#withdrawal-transaction-hash")!;
  const confirmedInput = overlay.querySelector<HTMLInputElement>("#withdrawal-payment-confirmed")!;
  const submit = overlay.querySelector<HTMLButtonElement>("#withdrawal-completion-submit")!;
  const validate = () => {
    const amount = amountInput.value.trim();
    const hash = hashInput.value.trim();
    submit.disabled = !/^\d+(?:\.\d{1,18})?$/.test(amount)
      || !Number.isFinite(Number(amount))
      || Number(amount) <= 0
      || hash.length < 8
      || hash.length > 200
      || !confirmedInput.checked;
  };
  amountInput.addEventListener("input", validate);
  hashInput.addEventListener("input", validate);
  confirmedInput.addEventListener("change", validate);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    validate();
    if (submit.disabled) return;
    const paidCryptoAmount = amountInput.value.trim();
    const transactionHash = hashInput.value.trim();
    close();
    void reviewWithdrawal(withdrawal.id, "complete", paidCryptoAmount, transactionHash);
  });
  amountInput.focus();
}

async function reviewWithdrawal(
  withdrawalId: string,
  action: "complete" | "reject",
  paidCryptoAmount?: string,
  transactionHash?: string,
) {
  try {
    await apiRequest(`/api/admin/withdrawals/${encodeURIComponent(withdrawalId)}/${action}`, {
      method: "POST",
      body: action === "complete" ? { paidCryptoAmount, transactionHash } : {},
    });
    showNotice(
      action === "complete" ? "Payment recorded" : "Withdrawal rejected",
      action === "complete" ? "The member has been notified that payment was sent." : "The request was rejected and the reserved amount was returned to the member.",
    );
    await refreshAdminWithdrawals();
  } catch (error) {
    showNotice("Could not update withdrawal", errorMessage(error));
  }
}

async function viewAdminReceipt(uid: string, receiptId: string) {
  const receiptWindow = window.open("about:blank", "_blank");
  try {
    const result = await apiRequest<{ url: string }>(
      `/api/admin/receipts/${encodeURIComponent(receiptId)}/image?uid=${encodeURIComponent(uid)}`,
    );
    if (receiptWindow) {
      receiptWindow.opener = null;
      receiptWindow.location.href = result.url;
    } else {
      showNotice("Receipt viewer blocked", "Allow pop-ups to open this receipt.");
    }
  } catch (error) {
    receiptWindow?.close();
    showNotice("Could not open receipt", errorMessage(error));
  }
}

async function reviewReceipt(uid: string, receiptId: string, approve: boolean, amountCents = 0) {
  if (approve && !window.confirm(`Approve this ${formatCurrency(amountCents)} deposit? If it is the member's first approved deposit, an additional 20% gift bonus will also be credited. Eligibility is checked automatically.`)) return;
  let rejectionMessage = "";
  if (!approve) {
    const response = window.prompt("Optional message to include with the rejection:", "");
    if (response === null) return;
    rejectionMessage = response;
  }
  try {
    const result = await apiRequest<{ firstDepositBonusCents?: number }>(`/api/admin/receipts/${encodeURIComponent(receiptId)}/${approve ? "approve" : "reject"}`, {
      method: "POST",
      body: { uid, ...(approve ? {} : { message: rejectionMessage }) },
    });
    const bonusCents = Number.isSafeInteger(result.firstDepositBonusCents) ? result.firstDepositBonusCents || 0 : 0;
    showNotice(
      approve ? "Deposit approved" : "Deposit rejected",
      approve
        ? bonusCents > 0
          ? `The member's balance was credited with the deposit and a ${formatCurrency(bonusCents)} first-deposit gift bonus.`
          : "The member's balance has been credited and the member has been notified."
        : "The member has been notified of the decision.",
    );
    await refreshAdminReceipts();
  } catch (error) {
    showNotice("Could not review deposit", errorMessage(error));
  }
}

function renderMembersPage() {
  frame(`
    <p class="eyebrow">Admin workspace</p>
    <h1>Members</h1>
    <p class="intro">View member accounts and manage access.</p>
    <section class="admin-list" aria-live="polite"><div id="admin-member-list" class="admin-list-content"><div class="deposit-loading"><span class="loader-orbit"></span><p>Loading members…</p></div></div></section>`,
  "members", currentUsername);
  void refreshMembers();
}

async function refreshMembers() {
  const list = document.querySelector<HTMLDivElement>("#admin-member-list");
  if (!list) return;
  try {
    const result = await apiRequest<{ members: AdminMember[] }>("/api/admin/members");
    if (!document.body.contains(list)) return;
    if (!result.members.length) {
      list.innerHTML = '<div class="empty-state"><p>No members found.</p></div>';
      return;
    }
    list.innerHTML = result.members.map((member) => `
      <article class="member-card">
        <div class="member-avatar">${escapeHtml((member.username || member.email || "U").slice(0, 2).toUpperCase())}</div>
        <div class="member-info"><strong>${member.username ? `@${escapeHtml(member.username)}` : "Username not set"}</strong><span>${escapeHtml(member.email)}</span><small>${member.role === "admin" ? "Administrator" : member.isBanned ? "Banned" : "Active"}</small></div>
        ${member.role === "admin" ? '<span class="member-role">ADMIN</span>' : `<button class="button ${member.isBanned ? "button-secondary" : "button-reject"}" type="button" data-ban-member="${escapeHtml(member.uid)}" data-ban-state="${member.isBanned ? "true" : "false"}">${member.isBanned ? "Unban" : "Ban"}</button>`}
      </article>`).join("");
    list.querySelectorAll<HTMLButtonElement>("[data-ban-member]").forEach((button) => {
      button.addEventListener("click", () => void setMemberBan(button.dataset.banMember || "", button.dataset.banState !== "true"));
    });
  } catch (error) {
    if (document.body.contains(list)) list.innerHTML = `<p class="admin-error">${escapeHtml(errorMessage(error))}</p>`;
  }
}

async function setMemberBan(uid: string, shouldBan: boolean) {
  const message = shouldBan
    ? "Permanently ban this member? Their current session will be blocked immediately."
    : "Restore this member's account access?";
  if (!window.confirm(message)) return;
  try {
    await apiRequest(`/api/admin/members/${encodeURIComponent(uid)}/ban`, {
      method: "POST",
      body: { isBanned: shouldBan },
    });
    await refreshMembers();
  } catch (error) {
    showNotice("Could not update member access", errorMessage(error));
  }
}

function formatTimestamp(value: AdminReceipt["createdAt"]) {
  if (!value) return "Just now";
  const seconds = value._seconds ?? value.seconds;
  return typeof seconds === "number" ? new Date(seconds * 1000).toLocaleString() : "Just now";
}

function renderBannedScreen() {
  appRoot.innerHTML = `
    <main class="banned-screen">
      <div class="banned-card">
        <span class="banned-mark" aria-hidden="true">!</span>
        <p class="eyebrow">Account access restricted</p>
        <h1>ACCOUNT PERMANENTLY BANNED</h1>
        <p>Your account may have been involved in a fake payment receipt or another violation of Triplex rules. If you believe this decision was made in error, contact customer support.</p>
        <a class="button button-banned-support" href="${whatsappUrl}" target="_blank" rel="noopener noreferrer">Contact support</a>
        <button class="button button-secondary" id="banned-signout" type="button">Sign out</button>
      </div>
    </main>`;
  document.querySelector<HTMLButtonElement>("#banned-signout")?.addEventListener("click", async () => {
    try {
      await signOutUser();
      window.location.assign("index.html");
    } catch (error) {
      showNotice("Could not sign out", errorMessage(error));
    }
  });
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
  if (activeProfitCycleId) {
    showNotice("Transfer temporarily unavailable", "Transfers are paused while your five-day profit cycle is active. You can transfer again after the cycle completes.");
    return;
  }
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
      <p class="transfer-explainer">The amount will be transferred to the selected user. Recheck the username carefully before continuing.</p>
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
  const requestId = crypto.randomUUID();
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.addEventListener("click", close);
  document.body.append(overlay);
  const recipientInput = overlay.querySelector<HTMLInputElement>("#recipient-input")!;
  const amountInput = overlay.querySelector<HTMLInputElement>("#transfer-amount")!;
  const recipientStatus = overlay.querySelector<HTMLSpanElement>("#recipient-status")!;
  const submit = overlay.querySelector<HTMLButtonElement>("#transfer-submit")!;
  let recipientUid: string | null = null;
  const validate = () => {
    const amountCents = amountToCents(amountInput.value);
    submit.disabled = !currentUser || !recipientUid || !amountCents || amountCents > balanceCents;
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
  overlay.querySelector<HTMLFormElement>("#transfer-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    validate();
    if (submit.disabled) return;
    const username = recipientInput.value.trim().toLowerCase();
    const amountCents = amountToCents(amountInput.value);
    if (!window.confirm(`Transfer ${formatCurrency(amountCents)} to @${username}? Please check the username carefully; completed transfers cannot be reversed.`)) return;
    submit.disabled = true;
    submit.textContent = "Transferring…";
    try {
      await apiRequest("/api/transfers", {
        method: "POST",
        body: { username, amountCents, requestId },
      });
      close();
      showNotice("Transfer complete", `${formatCurrency(amountCents)} was transferred to @${username}.`);
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "Continue";
      showNotice("Transfer could not be completed", errorMessage(error));
    }
  });
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.focus();
}

function showProfitStartFlow() {
  if (!currentUser) {
    showNotice("Sign in to start a cycle", "Log in and deposit funds before starting a profit cycle.");
    return;
  }
  if (activeProfitCycleId) {
    showNotice("A cycle is already active", "Complete your current five-day cycle before starting another.");
    return;
  }
  if (balanceCents <= 0) {
    showNotice("No funds available", "Deposit funds before starting a profit cycle.");
    return;
  }
  document.querySelector<HTMLElement>("#notice-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "notice-overlay";
  overlay.className = "notice-overlay";
  overlay.innerHTML = `
    <section class="notice-card transfer-card" role="dialog" aria-modal="true" aria-labelledby="profit-start-title">
      <button class="notice-close" type="button" aria-label="Dismiss cycle form">×</button>
      <img class="notice-logo" src="${logoUrl}" alt="Triplex">
      <p class="eyebrow">Five-day profit cycle</p>
      <h2 id="profit-start-title">Choose an amount to grow</h2>
      <p class="transfer-explainer">The selected amount is reserved for five days. Earnings are credited hourly; the 1% fee is deducted at the end of each day from the amount after growth. Withdrawals and transfers are paused until the cycle completes.</p>
      <p class="withdrawal-balance">Available balance: <strong>${formatCurrency(balanceCents)} USD</strong></p>
      <form id="profit-start-form">
        <label for="profit-start-amount">Cycle starting amount (USD)</label>
        <div class="amount-field"><span aria-hidden="true">$</span><input id="profit-start-amount" type="number" min="0.01" max="${(balanceCents / 100).toFixed(2)}" step="0.01" inputmode="decimal" placeholder="10.00" required></div>
        <button class="button button-primary transfer-submit" id="profit-start-submit" type="submit" disabled>Start five-day cycle</button>
      </form>
    </section>`;
  const close = () => overlay.remove();
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.addEventListener("click", close);
  document.body.append(overlay);
  const form = overlay.querySelector<HTMLFormElement>("#profit-start-form")!;
  const amountInput = overlay.querySelector<HTMLInputElement>("#profit-start-amount")!;
  const submit = overlay.querySelector<HTMLButtonElement>("#profit-start-submit")!;
  const validate = () => {
    const amountCents = amountToCents(amountInput.value);
    submit.disabled = amountCents <= 0 || amountCents > balanceCents || !currentUser || Boolean(activeProfitCycleId);
  };
  amountInput.addEventListener("input", validate);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    validate();
    if (submit.disabled) return;
    const amountCents = amountToCents(amountInput.value);
    if (!window.confirm(`Start a five-day profit cycle using ${formatCurrency(amountCents)}? This amount will be reserved until the cycle is complete.`)) return;
    submit.disabled = true;
    submit.textContent = "Starting cycle…";
    try {
      await apiRequest("/api/profits/start", {
        method: "POST",
        body: { amountCents, requestId: crypto.randomUUID() },
      });
      close();
      showNotice("Profit cycle started", "Your five-day cycle is active. Hourly earnings and daily fees will appear in your account activity.");
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "Start five-day cycle";
      showNotice("Could not start profit cycle", errorMessage(error));
    }
  });
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.focus();
}

async function showWithdrawalFlow() {
  if (!currentUser) {
    showNotice("Sign in to withdraw", "Log in to submit a withdrawal request.");
    return;
  }
  if (activeProfitCycleId) {
    showNotice("Profit cycle in progress", "Withdrawals are unavailable while your five-day profit cycle is active. You can request a withdrawal after the cycle completes.");
    return;
  }
  if (balanceCents <= 0) {
    showNotice("No funds available", "Your current balance is $0.00. Deposit funds before requesting a withdrawal.");
    return;
  }
  if (balanceCents < 2_000) {
    showNotice("Minimum withdrawal is $20.00", `Your current available balance is ${formatCurrency(balanceCents)}. Add funds until your available balance reaches at least $20.00 to request a withdrawal.`);
    return;
  }
  let assets: DepositAsset[];
  try {
    const options = await apiRequest<{ assets: DepositAsset[] }>("/api/withdrawals/options");
    assets = options.assets.filter((asset) => asset.networks.length > 0);
  } catch (error) {
    showNotice("Withdrawal options unavailable", errorMessage(error));
    return;
  }
  if (!assets.length) {
    showNotice("Withdrawals unavailable", "No configured cryptocurrency networks are available. Please contact customer support.");
    return;
  }

  document.querySelector<HTMLElement>("#notice-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "notice-overlay";
  overlay.className = "notice-overlay";
  overlay.innerHTML = `
    <section class="notice-card transfer-card withdrawal-card" role="dialog" aria-modal="true" aria-labelledby="withdrawal-title">
      <button class="notice-close" type="button" aria-label="Dismiss withdrawal panel">×</button>
      <img class="notice-logo" src="${logoUrl}" alt="Triplex">
      <p class="eyebrow">Withdrawal request</p>
      <h2 id="withdrawal-title">Withdraw to your crypto wallet</h2>
      <p class="transfer-explainer">Minimum withdrawal: $20.00 USD. Your request is in USD; an admin will determine and record the crypto amount sent. The requested USD amount is reserved while your payment is reviewed and manually processed.</p>
      <form id="withdrawal-form">
        <label for="withdrawal-asset">Cryptocurrency</label>
        <select id="withdrawal-asset" required>${assets.map((asset) => `<option value="${escapeHtml(asset.code)}">${escapeHtml(asset.name)} (${escapeHtml(asset.code)})</option>`).join("")}</select>
        <label for="withdrawal-network">Network</label>
        <select id="withdrawal-network" required></select>
        <label for="withdrawal-amount">Amount to withdraw (USD)</label>
        <div class="amount-field"><span aria-hidden="true">$</span><input id="withdrawal-amount" name="amount" type="number" min="20.00" max="${(balanceCents / 100).toFixed(2)}" step="0.01" inputmode="decimal" placeholder="20.00" required></div>
        <label for="withdrawal-address">Destination wallet address</label>
        <input class="withdrawal-address" id="withdrawal-address" name="walletAddress" type="text" autocomplete="off" minlength="20" maxlength="200" placeholder="Paste your wallet address" required>
        <div class="deposit-warning withdrawal-warning"><strong>Check the address and network carefully</strong><span>Select the network that matches your wallet exactly and verify every character in the destination address. Crypto sent to a wrong address or network may not be recoverable.</span></div>
        <p class="withdrawal-balance">Available balance: <strong>${formatCurrency(balanceCents)} USD</strong></p>
        <button class="button button-primary transfer-submit" id="withdrawal-submit" type="submit" disabled>Submit withdrawal request</button>
      </form>
    </section>`;
  const close = () => overlay.remove();
  overlay.querySelector<HTMLButtonElement>(".notice-close")!.addEventListener("click", close);
  document.body.append(overlay);

  const form = overlay.querySelector<HTMLFormElement>("#withdrawal-form")!;
  const assetSelect = overlay.querySelector<HTMLSelectElement>("#withdrawal-asset")!;
  const networkSelect = overlay.querySelector<HTMLSelectElement>("#withdrawal-network")!;
  const amountInput = overlay.querySelector<HTMLInputElement>("#withdrawal-amount")!;
  const addressInput = overlay.querySelector<HTMLInputElement>("#withdrawal-address")!;
  const submit = overlay.querySelector<HTMLButtonElement>("#withdrawal-submit")!;
  const fillNetworks = () => {
    const selected = assets.find((asset) => asset.code === assetSelect.value);
    networkSelect.innerHTML = (selected?.networks || []).map((network) =>
      `<option value="${escapeHtml(network.code)}">${escapeHtml(network.name)}</option>`).join("");
    validate();
  };
  const validate = () => {
    const amountCents = amountToCents(amountInput.value);
    const address = addressInput.value.trim();
    submit.disabled = !currentUser || amountCents < 2_000 || amountCents > balanceCents
      || address.length < 20 || address.length > 200 || /\s/.test(address) || !networkSelect.value;
  };
  assetSelect.addEventListener("change", fillNetworks);
  amountInput.addEventListener("input", validate);
  addressInput.addEventListener("input", validate);
  fillNetworks();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    validate();
    if (submit.disabled || !currentUser) return;
    const amountCents = amountToCents(amountInput.value);
    const asset = assetSelect.value;
    const network = networkSelect.value;
    const walletAddress = addressInput.value.trim();
    if (!window.confirm(`Submit a $${(amountCents / 100).toFixed(2)} USD withdrawal in ${asset} on ${networkSelect.selectedOptions[0]?.textContent} to:\n\n${walletAddress}\n\nThe amount will be reserved from your balance while the request is reviewed.`)) return;
    submit.disabled = true;
    submit.textContent = "Submitting request…";
    try {
      await apiRequest("/api/withdrawals", {
        method: "POST",
        body: { amountCents, asset, network, walletAddress, requestId: crypto.randomUUID() },
      });
      close();
      showNotice("Withdrawal request submitted", "The requested amount has been reserved while an admin reviews and manually processes your payment. You’ll receive a notification when the request is completed or rejected.");
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "Submit withdrawal request";
      showNotice("Could not submit withdrawal request", errorMessage(error));
    }
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

function stopLiveSubscriptions() {
  stopProfileWatch?.();
  stopNotificationsWatch?.();
  stopReceiptsWatch?.();
  stopWithdrawalsWatch?.();
  stopProfitCycleWatch?.();
  stopActivityWatch?.();
  stopProfileWatch = null;
  stopNotificationsWatch = null;
  stopReceiptsWatch = null;
  stopWithdrawalsWatch = null;
  stopProfitCycleWatch = null;
  stopActivityWatch = null;
}

function startLiveSubscriptions(user: User) {
  stopLiveSubscriptions();
  stopProfileWatch = subscribeUserProfile(user.uid, (profile) => {
    if (!profile) return;
    const roleChanged = profile.role !== currentRole;
    const balanceChanged = profile.balanceCents !== balanceCents;
    currentRole = profile.role;
    currentUsername = profile.username || null;
    balanceCents = profile.balanceCents;
    const cycleChanged = activeProfitCycleId !== profile.activeProfitCycleId;
    activeProfitCycleId = profile.activeProfitCycleId;
    if (profile.isBanned) {
      renderBannedScreen();
      return;
    }
    if (roleChanged && ["admin", "receipts", "withdrawals", "members"].includes(page) && currentRole !== "admin") {
      window.location.replace("index.html");
      return;
    }
    const balanceValue = document.querySelector<HTMLElement>("#balance-value");
    if (balanceValue && balanceVisible) balanceValue.textContent = formatCurrency(balanceCents);
    if (page === "profit" && balanceChanged) renderProfitPage();
    if (page === "profit" && cycleChanged) renderProfitPage();
    if (page === "dashboard" && balanceChanged) updateBalanceGrowth();
    if (roleChanged && currentRole === "admin" && document.querySelector(".app-shell")) {
      window.location.reload();
    }
  }, (error) => showNotice("Could not sync your account", error.message));

  stopNotificationsWatch = subscribeNotifications(user.uid, (items) => {
    notifications = items;
    updateNotificationControls();
  }, (error) => showNotice("Could not load notifications", error.message));

  if (currentRole === "admin") {
    stopReceiptsWatch = subscribePendingReceipts((count) => {
      const countChanged = pendingReceiptCount !== count;
      pendingReceiptCount = count;
      updateReceiptBadge();
      if (countChanged && page === "receipts") void refreshAdminReceipts();
    }, (error) => showNotice("Could not sync deposit requests", error.message));
    stopWithdrawalsWatch = subscribePendingWithdrawals((count) => {
      const countChanged = pendingWithdrawalCount !== count;
      pendingWithdrawalCount = count;
      updateWithdrawalBadge();
      if (countChanged && page === "withdrawals") void refreshAdminWithdrawals();
    }, (error) => showNotice("Could not sync withdrawal requests", error.message));
  }
  if (page === "dashboard") {
    stopActivityWatch = subscribeAccountActivity(user.uid, (items) => {
      accountActivity = items;
      renderActivity();
    }, (error) => showNotice("Could not load account activity", error.message));
  }
  stopProfitCycleWatch = subscribeProfitCycle(user.uid, (cycle) => {
    if (currentProfitCycle?.id === cycle?.id
      && currentProfitCycle?.status === cycle?.status
      && currentProfitCycle?.dayNumber === cycle?.dayNumber
      && currentProfitCycle?.hourInDay === cycle?.hourInDay
      && currentProfitCycle?.currentAmountCents === cycle?.currentAmountCents
      && currentProfitCycle?.totalProfitCents === cycle?.totalProfitCents
      && currentProfitCycle?.totalFeeCents === cycle?.totalFeeCents) return;
    currentProfitCycle = cycle;
    if (page === "profit") renderProfitPage();
    if (page === "dashboard") updateBalanceGrowth();
  }, (error) => showNotice("Could not sync your profit cycle", error.message));
}

async function loadAuthenticatedPage(user: User | null) {
  stopLiveSubscriptions();
  notifications = [];
  accountActivity = [];
  pendingReceiptCount = 0;
  pendingWithdrawalCount = 0;
  currentProfitCycle = null;
  activeProfitCycleId = null;
  currentUser = user;
  currentUsername = null;
  currentRole = "user";
  balanceCents = 0;
  try {
    const adminPage = ["admin", "receipts", "withdrawals", "members"].includes(page);
    if (adminPage && !user) {
      window.location.replace("login.html");
      return;
    }
    if (user) {
      await ensureUserRole(user.uid);
      currentRole = await getAccountRole(user.uid);
      if (adminPage && currentRole !== "admin") {
        window.location.replace("index.html");
        return;
      }
      currentUsername = await getUsernameForUser(user.uid);
      balanceCents = await getBalanceCents(user.uid);
      if (page === "dashboard" && !currentUsername) {
        window.location.assign("signup.html");
        return;
      }
      if (currentUsername && page === "signup") {
        window.location.assign("index.html");
        return;
      }
      const currentProfile = await getUserProfile(user.uid);
      activeProfitCycleId = currentProfile?.activeProfitCycleId || null;
      if (currentProfile?.isBanned) {
        renderBannedScreen();
        return;
      }
    }
    if (user) startLiveSubscriptions(user);
    if (page === "loading") {
      renderLoadingPage(user);
    } else if (page === "login" || page === "signup") {
      if (user && !currentUsername) renderUsernameSetup(user);
      else renderAuth(page);
    } else if (page === "contact") {
      renderContact();
    } else if (page === "profit") {
      renderProfitPage();
    } else if (page === "assistant") {
      renderAssistantPage();
    } else if (page === "admin") {
      renderAdmin();
    } else if (page === "receipts") {
      renderReceiptsPage();
    } else if (page === "withdrawals") {
      renderWithdrawalsPage();
    } else if (page === "members") {
      renderMembersPage();
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
