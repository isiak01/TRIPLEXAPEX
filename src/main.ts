import "./style.css";
import type { User } from "firebase/auth";
import {
  claimUsername,
  apiRequest,
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
  subscribeUserProfile,
  signInWithGoogle,
  signOutUser,
  type AccountNotification,
  type AccountActivity,
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
  "members.html": "members",
};
const page = pageRoutes[route] || "dashboard";

let currentUser: User | null = null;
let currentUsername: string | null = null;
let currentRole: "user" | "admin" = "user";
let balanceCents = 0;
let balanceVisible = true;
let notifications: AccountNotification[] = [];
let accountActivity: AccountActivity[] = [];
let pendingReceiptCount = 0;
let stopProfileWatch: (() => void) | null = null;
let stopNotificationsWatch: (() => void) | null = null;
let stopReceiptsWatch: (() => void) | null = null;
let stopActivityWatch: (() => void) | null = null;
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
          <a href="profit.html" ${activePage === "profit" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-profit" aria-hidden="true">↗</span>Profit projection</a>
          <a href="assistant.html" ${activePage === "assistant" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-assistant" aria-hidden="true">✦</span>TRIPLEX AI ASSISTANT</a>
          <a href="contact.html" ${activePage === "contact" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-contact" aria-hidden="true">✉</span>Contact</a>
          ${currentRole === "admin" ? `
            <a href="admin.html" ${activePage === "admin" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-admin" aria-hidden="true">◆</span>Admin</a>
            <a href="receipts.html" ${activePage === "receipts" ? 'aria-current="page"' : ""}><span class="nav-icon nav-icon-receipts" aria-hidden="true">▤</span>Receipts${pendingReceiptCount ? `<span class="nav-count" data-receipt-count>${pendingReceiptCount > 99 ? "99+" : pendingReceiptCount}</span>` : ""}</a>
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
    <button class="notification-item ${item.readAt ? "" : "is-unread"}" type="button" data-notification-id="${escapeHtml(item.id)}">
      <span class="notification-item-dot" aria-hidden="true"></span>
      <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.message)}</small><time>${item.createdAt ? escapeHtml(item.createdAt.toDate().toLocaleString()) : "Just now"}</time></span>
    </button>`).join("");
}

function pageTitle(activePage: string) {
  switch (activePage) {
    case "contact": return "Contact";
    case "profit": return "Profit projection";
    case "assistant": return "TRIPLEX AI ASSISTANT";
    case "admin": return "Admin";
    case "receipts": return "Receipts";
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
  document.querySelectorAll<HTMLButtonElement>(".notification-item[data-notification-id]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      if (!currentUser) return;
      const item = notifications.find((notification) => notification.id === button.dataset.notificationId);
      if (!item || item.readAt) return;
      try {
        await markNotificationRead(currentUser.uid, item.id);
      } catch (error) {
        showNotice("Could not update notification", errorMessage(error));
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
      <div class="section-heading"><div><p class="eyebrow">Your account</p><h2 id="activity-heading">Recent activity</h2></div><a class="section-link" href="profit.html">View projection <span aria-hidden="true">→</span></a></div>
      <div class="activity-card" id="activity-list"></div>
    </section>`, "dashboard", currentUsername);

  renderActivity();
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
    const incoming = item.type === "received" || (item.type === "deposit" && item.status === "approved");
    let title: string;
    if (item.type === "deposit") {
      title = item.status === "approved" ? "Deposit successful" : item.status === "rejected" ? "Deposit rejected" : "Deposit request";
    } else {
      title = item.type === "received" ? "Transfer received" : "Transfer sent";
    }
    const timestamp = item.createdAt ? item.createdAt.toDate().toLocaleString() : "Just now";
    return `<article class="activity-row">
      <span class="activity-row-icon ${incoming ? "is-incoming" : ""}" aria-hidden="true">${item.type === "deposit" ? "↓" : item.type === "received" ? "↙" : "↗"}</span>
      <span class="activity-row-copy"><strong>${title}</strong><small>${escapeHtml(item.detail)} · ${escapeHtml(timestamp)}</small></span>
      <span class="activity-row-amount ${incoming ? "is-incoming" : ""}">${incoming ? "+" : item.type === "sent" ? "−" : ""}${formatCurrency(item.amountCents)}</span>
      <span class="activity-status status-${escapeHtml(item.status)}">${escapeHtml(capitalize(item.status))}</span>
    </article>`;
  }).join("")}</div>`;
}

function formatUsdt(cents: number) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)} USDT`;
}

function renderProfitPage() {
  const projection: {
    cycle: number;
    openingCents: number;
    illustrativeCents: number;
    feeCents: number;
    netCents: number;
  }[] = [];
  let openingCents = 1_000;
  for (let cycle = 1; cycle <= 5; cycle += 1) {
    const illustrativeCents = Math.round(openingCents * 1.8);
    const feeCents = 400;
    const netCents = illustrativeCents - feeCents;
    projection.push({
      cycle,
      openingCents,
      illustrativeCents,
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
  frame(`
    <p class="eyebrow">Training illustration</p>
    <h1>Profit projection</h1>
    <p class="intro">See your account balance alongside a clearly labeled example projection. No live trading prices or automatic earnings are connected.</p>
    <section class="profit-terminal" aria-label="Account balance and hypothetical projection">
      <div class="profit-terminal-head"><span class="profit-market-tag"><i></i> ACCOUNT BALANCE</span><span class="profit-illustration-tag">HYPOTHETICAL EXAMPLE</span></div>
      <div class="profit-terminal-grid">
        <div class="profit-equity"><span>Available balance</span><strong id="profit-balance">${formatCurrency(currentUser ? balanceCents : 0)} <small>USD</small></strong><p>${currentUser ? "Current credited balance" : "Log in to view your account balance"}</p></div>
        <div class="profit-projected"><span>Example final amount</span><strong>${formatUsdt(finalCents)}</strong><p>After 5 hypothetical cycles · 15 days</p></div>
      </div>
      <div class="profit-chart-heading"><span>ILLUSTRATIVE NET AMOUNT</span><span>Not a live price feed</span></div>
      <svg class="profit-chart" viewBox="0 0 400 150" role="img" aria-label="Hypothetical five-cycle projection rising from 14 to 99.48 USDT">
        <defs><linearGradient id="profit-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#20c978" stop-opacity=".28"/><stop offset="1" stop-color="#20c978" stop-opacity="0"/></linearGradient></defs>
        <path class="profit-chart-area" d="${areaPath}"/>
        <polyline class="profit-chart-line" points="${points}"/>
        ${projection.map((row, index) => `<circle class="profit-chart-point" cx="${coordinates[index].x}" cy="${coordinates[index].y}" r="4"><title>Cycle ${row.cycle}: ${formatUsdt(row.netCents)}</title></circle>`).join("")}
      </svg>
      <div class="profit-chart-labels"><span>Cycle 1</span><span>Cycle 2</span><span>Cycle 3</span><span>Cycle 4</span><span>Cycle 5</span></div>
    </section>
    ${!currentUser || balanceCents <= 0 ? `
      <section class="progress-empty-state">
        <span class="progress-empty-icon" aria-hidden="true">↗</span>
        <div><h2>Deposit before account tracking</h2><p>${currentUser ? "Your available balance is currently $0.00. An approved deposit will appear in your balance and activity." : "Log in and make a deposit to see your credited account balance and activity here."}</p></div>
        <button class="button button-primary" type="button" data-progress-deposit>Make a deposit</button>
      </section>` : `
      <section class="progress-active-note"><strong>Your account balance is available</strong><span>The balance above reflects actual credited funds. The example below is not a forecast and does not change your balance.</span></section>`}
    <section class="projection-card" aria-labelledby="projection-heading">
      <div class="projection-heading"><div><p class="eyebrow">Example only · USDT</p><h2 id="projection-heading">10.00 USDT illustrative scenario</h2></div><span class="projection-badge">1.8× assumption</span></div>
      <div class="projection-table-wrap"><table class="projection-table">
        <thead><tr><th>Cycle</th><th>Period</th><th>Opening</th><th>Illustrative amount</th><th>Assumed fee</th><th>Net example</th></tr></thead>
        <tbody>${projection.map((row) => `<tr><td>${row.cycle}</td><td>Days ${(row.cycle - 1) * 3 + 1}–${row.cycle * 3}</td><td>${formatUsdt(row.openingCents)}</td><td>${formatUsdt(row.illustrativeCents)}</td><td class="projection-fee">−${formatUsdt(row.feeCents)}</td><td class="projection-net">${formatUsdt(row.netCents)}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="projection-summary"><span>Initial example <strong>${formatUsdt(1_000)}</strong></span><span>Assumed fees <strong>${formatUsdt(2_000)}</strong></span><span>Final example <strong>${formatUsdt(finalCents)}</strong></span></div>
      <div class="projection-disclaimer"><strong>Important</strong><span>This table repeats a hypothetical scenario, not an actual or guaranteed return. Triplex does not currently execute trades or automatically add hourly/daily earnings. The assumed $4 USDT fee is shown for illustration only and is not deducted from your account here. USD and USDT are displayed separately; no conversion is performed.</span></div>
    </section>
    <div class="progress-page-actions"><a class="button button-secondary" href="index.html#activity">View account activity</a><a class="button button-secondary" href="assistant.html">Ask the assistant</a></div>`, "profit", currentUsername);

  document.querySelector<HTMLButtonElement>("[data-progress-deposit]")?.addEventListener("click", () => void showDepositFlow());
}

function renderAssistantPage() {
  frame(`
    <p class="eyebrow">Triplex help</p>
    <h1>TRIPLEX AI ASSISTANT</h1>
    <p class="intro">Ask about features and steps available on this website.</p>
    <section class="assistant-shell" aria-label="Triplex help chat">
      <header class="assistant-header">
        <span class="assistant-mascot" data-mascot aria-hidden="true"><span>✦</span></span>
        <div class="assistant-heading"><strong>TRIPLEX AI ASSISTANT</strong><span>Prepared site-help replies · not live AI</span></div>
        <button class="assistant-reset" id="assistant-reset" type="button">New chat</button>
      </header>
      <div class="assistant-welcome"><span class="assistant-welcome-kicker">WELCOME TO TRIPLEX</span><h2>How can I help?</h2><p>I can explain the deposit flow, account activity, and what the example projection means. I can’t view your account or verify a payment.</p></div>
      <details class="assistant-suggestions" open>
        <summary>View suggestions</summary>
        <div class="assistant-suggestion-list">
          ${[
            "How do I make a deposit?",
            "Which network should I choose?",
            "What if I send to the wrong network?",
            "How long does deposit review take?",
            "How does the profit projection work?",
            "How do actual earnings get added?",
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
    text: "Hi! I’m the Triplex website help assistant. I can answer common questions using the features shown here, but I’m not live AI and can’t see account or payment records. What would you like to know?",
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
      return { text: "Hello! I can help explain Triplex’s deposit, account activity, example projection, transfers, and support options." };
    }
    if (/\b(thank|thanks|appreciate)\b/.test(normalized)) {
      return { text: "You’re welcome. If you have another question about the site, feel free to ask." };
    }
    if (/\b(bye|goodbye|see you)\b/.test(normalized)) {
      return { text: "Thanks for visiting Triplex. Contact support if you need help with an account or payment." };
    }
    if (/\b(help|what can you do|what can i ask)\b/.test(normalized)) {
      return { text: "I can explain how to choose a deposit network, submit a request, read account activity, understand the hypothetical projection, transfer between Triplex accounts, or contact support. I can’t verify payments or provide live market information." };
    }
    if (/\b(wrong network|wrong chain|sent to the wrong|wrong address)\b/.test(normalized)) {
      return { text: "Crypto sent using the wrong network or to the wrong address may be permanently unrecoverable. Contact Triplex support with the transaction hash and asset/network details; recovery is not guaranteed. Don’t send another payment until the destination is confirmed.", link: { label: "Contact support", href: "contact.html" } };
    }
    if (/\b(network|chain|which.*(send|choose)|send.*(usdt|usdc|crypto))\b/.test(normalized)) {
      return { text: "Choose the exact same network in your sending wallet and in the Triplex deposit flow, for the selected asset. Only networks with a configured receiving address are available. Never pick a different network based on a guess, and verify the full address before sending.", link: { label: "Go to dashboard to deposit", href: "index.html" } };
    }
    if (/\b(deposit|receipt|proof of payment|payment request)\b/.test(normalized)) {
      return { text: "Sign in, choose Deposit, select the asset and one of its available networks, then copy the displayed address. Enter the USD amount, optionally upload a JPG, PNG, WebP, or PDF receipt, confirm the payment is legitimate, and submit the request. The balance changes only after an administrator approves it. Never send crypto to an address from chat.", link: { label: "Go to dashboard", href: "index.html" } };
    }
    if (/\b(review|pending|how long|when.*(balance|deposit)|approve|approved)\b/.test(normalized)) {
      return { text: "After you submit a deposit request, it appears as pending. The site says reviews can take up to 24 hours. An administrator must approve the request before the credited USD balance changes. I can’t see your request status; use the in-app notifications or contact support if it is delayed.", link: { label: "Contact support", href: "contact.html" } };
    }
    if (/\b(fee|charge|service charge|cost)\b/.test(normalized)) {
      return { text: "The profit projection page shows an assumed 4 USDT fee per cycle as part of a hypothetical example. The example does not charge or deduct that fee from your account. Confirm any actual fees and terms with Triplex support before sending funds.", link: { label: "View the example projection", href: "profit.html" } };
    }
    if (/\b(profit|earning|growth|return|1\.8|projection|progress)\b/.test(normalized)) {
      return { text: "The progress page contains a hypothetical 5-cycle example based on the figures supplied for the site. It is not a forecast or guaranteed return. Triplex does not currently execute trades or automatically credit hourly/daily earnings, and this example never changes your actual balance.", link: { label: "View the example projection", href: "profit.html" } };
    }
    if (/\b(withdraw|cash ?out)\b/.test(normalized)) {
      return { text: "The withdrawal workflow is not available in the website yet. The Withdraw button does not submit a request. Contact support for current information, and don’t share passwords, PINs, or private keys.", link: { label: "Contact support", href: "contact.html" } };
    }
    if (/\b(transfer|send.*user|username)\b/.test(normalized)) {
      return { text: "The dashboard includes transfers between Triplex accounts. Enter the recipient’s Triplex username and amount, carefully recheck the username, and confirm. A completed transfer moves the amount between account balances.", link: { label: "Go to dashboard", href: "index.html" } };
    }
    if (/\b(login|log in|sign in|account|google)\b/.test(normalized)) {
      return { text: "Triplex sign-in uses Google. Choose Log in or Create account from the dashboard, continue with Google, then choose a username if prompted.", link: { label: "Log in", href: "login.html" } };
    }
    if (/\b(support|contact|whatsapp|help desk)\b/.test(normalized)) {
      return { text: "You can contact Triplex support through the verified WhatsApp link on the Contact page. Never send passwords, verification codes, or wallet recovery phrases.", link: { label: "Open Contact", href: "contact.html" } };
    }
    return { text: "I don’t have verified information to answer that. I can’t access account records or check a transaction. Please contact Triplex support for help." , link: { label: "Contact support", href: "contact.html" } };
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
    try {
      const result = await apiRequest<{ address: string; networkName: string }>(
        `/api/deposits/address?asset=${encodeURIComponent(asset.code)}&network=${encodeURIComponent(network.code)}`,
      );
      address = result.address;
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
      <div class="amount-field"><span>$</span><input id="deposit-amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required></div>
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
      const amountCents = amountToCents(content.querySelector<HTMLInputElement>("#deposit-amount")!.value);
      if (!amountCents) {
        showNotice("Enter a valid amount", "Enter a deposit amount greater than $0.00.");
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
    <p class="intro">Review deposit requests and manage member access.</p>
    <div class="admin-shortcuts">
      <a class="admin-shortcut" href="receipts.html"><span class="admin-shortcut-icon">▤</span><strong>Deposit receipts</strong><small>${pendingReceiptCount} awaiting review</small><span aria-hidden="true">→</span></a>
      <a class="admin-shortcut" href="members.html"><span class="admin-shortcut-icon">♙</span><strong>Members</strong><small>View member accounts</small><span aria-hidden="true">→</span></a>
    </div>`, "admin", currentUsername);
}

interface AdminReceipt {
  id: string;
  uid: string;
  username: string;
  email: string;
  amountCents: number;
  asset: string;
  networkName: string;
  receipt: { publicId: string; format: string; bytes: number } | null;
  createdAt: { _seconds?: number; seconds?: number } | null;
}

interface AdminMember {
  uid: string;
  username: string;
  email: string;
  role: "user" | "admin";
  isBanned: boolean;
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
  if (approve && !window.confirm(`Approve this deposit? This will immediately credit ${formatCurrency(amountCents)} to the member's USD balance.`)) return;
  let rejectionMessage = "";
  if (!approve) {
    const response = window.prompt("Optional message to include with the rejection:", "");
    if (response === null) return;
    rejectionMessage = response;
  }
  try {
    await apiRequest(`/api/admin/receipts/${encodeURIComponent(receiptId)}/${approve ? "approve" : "reject"}`, {
      method: "POST",
      body: { uid, ...(approve ? {} : { message: rejectionMessage }) },
    });
    showNotice(approve ? "Deposit approved" : "Deposit rejected", approve ? "The deposit was reviewed and the member's balance has been credited." : "The member has been notified of the decision.");
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
  stopActivityWatch?.();
  stopProfileWatch = null;
  stopNotificationsWatch = null;
  stopReceiptsWatch = null;
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
    if (profile.isBanned) {
      renderBannedScreen();
      return;
    }
    if (roleChanged && ["admin", "receipts", "members"].includes(page) && currentRole !== "admin") {
      window.location.replace("index.html");
      return;
    }
    const balanceValue = document.querySelector<HTMLElement>("#balance-value");
    if (balanceValue && balanceVisible) balanceValue.textContent = formatCurrency(balanceCents);
    if (page === "profit" && balanceChanged) renderProfitPage();
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
  }
  if (page === "dashboard") {
    stopActivityWatch = subscribeAccountActivity(user.uid, (items) => {
      accountActivity = items;
      renderActivity();
    }, (error) => showNotice("Could not load account activity", error.message));
  }
}

async function loadAuthenticatedPage(user: User | null) {
  stopLiveSubscriptions();
  notifications = [];
  accountActivity = [];
  pendingReceiptCount = 0;
  currentUser = user;
  currentUsername = null;
  currentRole = "user";
  balanceCents = 0;
  try {
    const adminPage = ["admin", "receipts", "members"].includes(page);
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
