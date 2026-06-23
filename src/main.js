import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

// ── State ─────────────────────────────────────────────────────────────
let tabs = [];
let activeTabId = null;
let totalBlocked = 0;

// ── DOM refs ──────────────────────────────────────────────────────────
const tabsEl        = document.getElementById("tabs");
const addressBar    = document.getElementById("address-bar");
const backBtn       = document.getElementById("back-btn");
const forwardBtn    = document.getElementById("forward-btn");
const refreshBtn    = document.getElementById("refresh-btn");
const newTabBtn     = document.getElementById("new-tab-btn");
const httpsBadge    = document.getElementById("https-badge");
const trackerCount  = document.getElementById("tracker-count");
const totalBlockedEl= document.getElementById("total-blocked");
const newTabPage    = document.getElementById("new-tab-page");
const searchInput   = document.getElementById("search-input");
const searchBtn     = document.getElementById("search-btn");

// ── Helpers ───────────────────────────────────────────────────────────

function normaliseUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // If it looks like a URL (has a dot and no spaces), treat it as one.
  const looksLikeUrl = /^(https?:\/\/|localhost)/.test(trimmed) ||
    (/\./.test(trimmed) && !/\s/.test(trimmed));

  if (looksLikeUrl) {
    // Enforce HTTPS — never allow plain HTTP.
    const withProtocol = trimmed.startsWith("http://")
      ? trimmed.replace("http://", "https://")
      : trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`;
    return withProtocol;
  }

  // Otherwise treat it as a search query.
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

function getTabById(id) {
  return tabs.find(t => t.id === id);
}

function updateHttpsBadge(url) {
  if (!url || url.startsWith("whiskers://") || url === "about:blank") {
    httpsBadge.textContent = "🐱";
    httpsBadge.title = "New tab";
    return;
  }
  if (url.startsWith("https://")) {
    httpsBadge.textContent = "🔒";
    httpsBadge.title = "Secure connection (HTTPS)";
  } else {
    httpsBadge.textContent = "⚠️";
    httpsBadge.title = "Not secure — this site is not using HTTPS";
  }
}

function updateTrackerDisplay(count) {
  trackerCount.textContent = count;
}

function updateTotalBlocked() {
  totalBlockedEl.textContent = totalBlocked;
}

// ── Tab management ────────────────────────────────────────────────────

let tabCounter = 0;

function createTab(url = null) {
  const id = ++tabCounter;
  const tab = {
    id,
    url: url || "",
    title: "New Tab",
    blocked: 0,
    webview: null   // will hold the Tauri WebviewWindow reference
  };
  tabs.push(tab);
  renderTabBar();
  switchTab(id);

  if (url) {
    navigateTo(url, id);
  } else {
    showNewTabPage();
  }

  return tab;
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    // No tabs left — open a fresh one instead of closing the app.
    createTab();
    return;
  }

  // Switch to the nearest tab.
  const nextTab = tabs[Math.min(idx, tabs.length - 1)];
  renderTabBar();
  switchTab(nextTab.id);
}

function switchTab(id) {
  activeTabId = id;
  const tab = getTabById(id);
  if (!tab) return;

  renderTabBar();

  // Update address bar.
  addressBar.value = tab.url || "";
  updateHttpsBadge(tab.url);
  updateTrackerDisplay(tab.blocked);

  // Show/hide new tab page.
  if (!tab.url) {
    showNewTabPage();
  } else {
    hideNewTabPage();
    // Tell the Rust backend to show this tab's webview.
    invoke("show_tab", { tabId: id }).catch(console.error);
  }
}

function renderTabBar() {
  tabsEl.innerHTML = "";
  tabs.forEach(tab => {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === activeTabId ? " active" : "");
    el.dataset.id = tab.id;

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title;

    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.title = "Close tab";
    close.addEventListener("click", e => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    el.appendChild(title);
    el.appendChild(close);
    el.addEventListener("click", () => switchTab(tab.id));
    tabsEl.appendChild(el);
  });
}

// ── Navigation ────────────────────────────────────────────────────────

async function navigateTo(rawUrl, tabId = activeTabId) {
  const url = normaliseUrl(rawUrl);
  if (!url) return;

  const tab = getTabById(tabId);
  if (!tab) return;

  tab.url = url;
  tab.blocked = 0;
  addressBar.value = url;
  updateHttpsBadge(url);
  updateTrackerDisplay(0);
  hideNewTabPage();

  try {
    await invoke("navigate", { tabId, url });
  } catch (err) {
    console.error("Navigation error:", err);
  }
}

function showNewTabPage() {
  newTabPage.style.display = "flex";
  updateTotalBlocked();
  // Hide all existing tab WebviViews so they don't bleed through.
  invoke("hide_all_tabs").catch(console.error);
}

function hideNewTabPage() {
  newTabPage.style.display = "none";
}

// ── Event listeners ───────────────────────────────────────────────────

// Address bar — navigate on Enter.
addressBar.addEventListener("keydown", e => {
  if (e.key === "Enter") navigateTo(addressBar.value);
});

// Select all text on focus so user can immediately type a new URL.
addressBar.addEventListener("focus", () => addressBar.select());

// Nav buttons.
backBtn.addEventListener("click",    () => invoke("go_back",    { tabId: activeTabId }));
forwardBtn.addEventListener("click", () => invoke("go_forward", { tabId: activeTabId }));
refreshBtn.addEventListener("click", () => invoke("go_refresh", { tabId: activeTabId }));

// New tab button.
newTabBtn.addEventListener("click", () => createTab());

// New tab page search.
function doSearch() {
  const q = searchInput.value.trim();
  if (!q) return;
  navigateTo(q);
  searchInput.value = "";
}
searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

// ── Keyboard shortcuts ─────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  // Ctrl+L — focus address bar.
  if (e.ctrlKey && e.key === "l") {
    e.preventDefault();
    addressBar.focus();
  }
  // Ctrl+T — new tab.
  if (e.ctrlKey && e.key === "t") {
    e.preventDefault();
    createTab();
  }
  // Ctrl+W — close current tab.
  if (e.ctrlKey && e.key === "w") {
    e.preventDefault();
    closeTab(activeTabId);
  }
  // Ctrl+R — refresh.
  if (e.ctrlKey && e.key === "r") {
    e.preventDefault();
    invoke("go_refresh", { tabId: activeTabId });
  }
  // Alt+Left — back.
  if (e.altKey && e.key === "ArrowLeft") {
    e.preventDefault();
    invoke("go_back", { tabId: activeTabId });
  }
  // Alt+Right — forward.
  if (e.altKey && e.key === "ArrowRight") {
    e.preventDefault();
    invoke("go_forward", { tabId: activeTabId });
  }
});

// ── Listen for events from Rust backend ───────────────────────────────
import { listen } from "@tauri-apps/api/event";

// Page navigation completed — update tab title and address bar.
listen("nav-committed", ({ payload }) => {
  const { tabId, url, title } = payload;
  const tab = getTabById(tabId);
  if (!tab) return;
  tab.url = url;
  if (title) tab.title = title;
  if (tabId === activeTabId) {
    addressBar.value = url;
    updateHttpsBadge(url);
    renderTabBar();
  }
});

// Tracker blocked — increment counter.
listen("tracker-blocked", ({ payload }) => {
  const { tabId } = payload;
  const tab = getTabById(tabId);
  if (!tab) return;
  tab.blocked++;
  totalBlocked++;
  if (tabId === activeTabId) {
    updateTrackerDisplay(tab.blocked);
  }
  updateTotalBlocked();
});

// ── Boot ──────────────────────────────────────────────────────────────
createTab();
