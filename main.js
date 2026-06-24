import { invoke } from "@tauri-apps/api/core";

// ── Settings (persisted to localStorage) ─────────────────────────────
const defaultSettings = {
  httpsOnly:       true,
  trackerBlocking: true,
  blockCookies:    true,
  blockWebRTC:     true,
  searchEngine:    "https://duckduckgo.com/?q="
};

function loadSettings() {
  try {
    const saved = localStorage.getItem("whiskers_settings");
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : { ...defaultSettings };
  } catch { return { ...defaultSettings }; }
}

function saveSettings(s) {
  localStorage.setItem("whiskers_settings", JSON.stringify(s));
}

let settings = loadSettings();

// ── State ─────────────────────────────────────────────────────────────
let tabs        = [];
let activeTabId = null;
let tabCounter  = 0;
let totalBlocked = 0;

// ── DOM refs ──────────────────────────────────────────────────────────
const tabsEl        = document.getElementById("tabs");
const contentArea   = document.getElementById("content-area");
const addressBar    = document.getElementById("address-bar");
const backBtn       = document.getElementById("back-btn");
const forwardBtn    = document.getElementById("forward-btn");
const refreshBtn    = document.getElementById("refresh-btn");
const newTabBtn     = document.getElementById("new-tab-btn");
const settingsBtn   = document.getElementById("settings-btn");
const httpsBadge    = document.getElementById("https-badge");
const trackerCount  = document.getElementById("tracker-count");
const totalBlockedEl= document.getElementById("total-blocked");
const newTabPage    = document.getElementById("new-tab-page");
const searchInput   = document.getElementById("search-input");
const searchBtn     = document.getElementById("search-btn");
const settingsPanel = document.getElementById("settings-panel");
const settingsClose = document.getElementById("settings-close");
const clearDataBtn  = document.getElementById("clear-data-btn");

// ── Tracker blocklist (expanded) ──────────────────────────────────────
const TRACKERS = [
  "google-analytics.com","googletagmanager.com","googletagservices.com",
  "googlesyndication.com","doubleclick.net","connect.facebook.net",
  "facebook.com/tr","analytics.twitter.com","scorecardresearch.com",
  "quantserve.com","mixpanel.com","segment.com","segment.io","hotjar.com",
  "fullstory.com","intercom.io","intercomcdn.com","mouseflow.com",
  "crazyegg.com","optimizely.com","adroll.com","criteo.com","criteo.net",
  "amazon-adsystem.com","ads.linkedin.com","mc.yandex.ru","ads.yahoo.com",
  "outbrain.com","taboola.com","chartbeat.com","newrelic.com",
  "clarity.ms","bat.bing.com","static.ads-twitter.com","analytics.google.com",
  "cdn.heapanalytics.com","cdn.amplitude.com","api.amplitude.com",
  "api.segment.io","cdn.segment.com","sentry.io","bugsnag.com",
  "logrocket.com","inspectlet.com","luckyorange.com","kissmetrics.com",
];

function isTracker(url) {
  if (!settings.trackerBlocking) return false;
  const lower = url.toLowerCase();
  return TRACKERS.some(t => lower.includes(t));
}

// ── URL helpers ───────────────────────────────────────────────────────
function normaliseUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const looksLikeUrl = /^(https?:\/\/|localhost)/.test(trimmed) ||
    (/\./.test(trimmed) && !/\s/.test(trimmed));

  if (looksLikeUrl) {
    if (settings.httpsOnly) {
      return trimmed.startsWith("http://")
        ? trimmed.replace("http://", "https://")
        : trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
    }
    return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  }

  return `${settings.searchEngine}${encodeURIComponent(trimmed)}`;
}

function updateHttpsBadge(url) {
  if (!url) { httpsBadge.textContent = "🐱"; httpsBadge.title = "New tab"; return; }
  if (url.startsWith("https://")) {
    httpsBadge.textContent = "🔒"; httpsBadge.title = "Secure (HTTPS)";
  } else {
    httpsBadge.textContent = "⚠️"; httpsBadge.title = "Not secure — HTTP";
  }
}

// ── Tab management ────────────────────────────────────────────────────
function createTab(url = null) {
  const id = ++tabCounter;
  const tab = { id, url: "", title: "New Tab", blocked: 0, iframe: null };
  tabs.push(tab);

  if (url) {
    navigateTo(url, id, true);
  } else {
    renderTabBar();
    switchTab(id);
  }
  return tab;
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  // Remove the iframe from DOM
  const tab = tabs[idx];
  if (tab.iframe) tab.iframe.remove();

  tabs.splice(idx, 1);

  if (tabs.length === 0) { createTab(); return; }
  const next = tabs[Math.min(idx, tabs.length - 1)];
  renderTabBar();
  switchTab(next.id);
}

function switchTab(id) {
  activeTabId = id;
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  // Show/hide content
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));

  if (!tab.url) {
    newTabPage.classList.add("active");
    totalBlockedEl.textContent = totalBlocked;
  } else if (tab.iframe) {
    tab.iframe.classList.add("active");
  }

  addressBar.value = tab.url || "";
  updateHttpsBadge(tab.url);
  trackerCount.textContent = tab.blocked;
  renderTabBar();
}

function renderTabBar() {
  tabsEl.innerHTML = "";
  tabs.forEach(tab => {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === activeTabId ? " active" : "");

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title;

    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.addEventListener("click", e => { e.stopPropagation(); closeTab(tab.id); });

    el.appendChild(title);
    el.appendChild(close);
    el.addEventListener("click", () => switchTab(tab.id));
    tabsEl.appendChild(el);
  });
}

// ── Navigation ────────────────────────────────────────────────────────
function navigateTo(rawUrl, tabId = activeTabId, isNew = false) {
  const url = normaliseUrl(rawUrl);
  if (!url) return;

  // Block trackers
  if (isTracker(url)) {
    console.log("Whiskers blocked tracker:", url);
    const tab = tabs.find(t => t.id === tabId);
    if (tab) { tab.blocked++; totalBlocked++; }
    trackerCount.textContent = tabs.find(t => t.id === tabId)?.blocked || 0;
    totalBlockedEl.textContent = totalBlocked;
    return;
  }

  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  tab.url = url;
  tab.title = new URL(url).hostname || "Loading...";

  // Create iframe if it doesn't exist yet
  if (!tab.iframe) {
    const wrapper = document.createElement("div");
    wrapper.className = "tab-content";

    const iframe = document.createElement("iframe");
    iframe.className = "tab-iframe";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation");

    // Inject WebRTC blocking script
    if (settings.blockWebRTC) {
      iframe.setAttribute("allow", "");
    }

    wrapper.appendChild(iframe);
    contentArea.appendChild(wrapper);
    tab.iframe = wrapper;

    iframe.addEventListener("load", () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc && settings.blockWebRTC) {
          iframe.contentWindow.eval(`
            if (typeof RTCPeerConnection !== 'undefined') {
              window.RTCPeerConnection = undefined;
              window.webkitRTCPeerConnection = undefined;
            }
          `);
        }
        const title = iframeDoc?.title;
        if (title) { tab.title = title; renderTabBar(); }
      } catch (_) {}
    });
  }

  // Navigate the iframe
  const iframe = tab.iframe.querySelector("iframe");
  iframe.src = url;

  if (!isNew) {
    switchTab(tabId);
  } else {
    renderTabBar();
    switchTab(tabId);
  }

  addressBar.value = url;
  updateHttpsBadge(url);
}

// ── Event listeners ───────────────────────────────────────────────────
addressBar.addEventListener("keydown", e => {
  if (e.key === "Enter") navigateTo(addressBar.value);
});
addressBar.addEventListener("focus", () => addressBar.select());

backBtn.addEventListener("click", () => {
  const tab = tabs.find(t => t.id === activeTabId);
  tab?.iframe?.querySelector("iframe")?.contentWindow?.history.back();
});

forwardBtn.addEventListener("click", () => {
  const tab = tabs.find(t => t.id === activeTabId);
  tab?.iframe?.querySelector("iframe")?.contentWindow?.history.forward();
});

refreshBtn.addEventListener("click", () => {
  const tab = tabs.find(t => t.id === activeTabId);
  const iframe = tab?.iframe?.querySelector("iframe");
  if (iframe) iframe.src = iframe.src;
});

newTabBtn.addEventListener("click", () => createTab());

function doSearch() {
  const q = searchInput.value.trim();
  if (!q) return;
  navigateTo(q);
  searchInput.value = "";
}
searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

// ── Settings ──────────────────────────────────────────────────────────
settingsBtn.addEventListener("click", () => {
  settingsPanel.classList.remove("hidden");
  // Sync toggles to current settings
  document.getElementById("toggle-https").checked    = settings.httpsOnly;
  document.getElementById("toggle-trackers").checked = settings.trackerBlocking;
  document.getElementById("toggle-cookies").checked  = settings.blockCookies;
  document.getElementById("toggle-webrtc").checked   = settings.blockWebRTC;
  document.getElementById("search-engine").value     = settings.searchEngine;
});

settingsClose.addEventListener("click", () => settingsPanel.classList.add("hidden"));

settingsPanel.addEventListener("click", e => {
  if (e.target === settingsPanel) settingsPanel.classList.add("hidden");
});

document.getElementById("toggle-https").addEventListener("change",    e => { settings.httpsOnly = e.target.checked;       saveSettings(settings); });
document.getElementById("toggle-trackers").addEventListener("change",  e => { settings.trackerBlocking = e.target.checked; saveSettings(settings); });
document.getElementById("toggle-cookies").addEventListener("change",   e => { settings.blockCookies = e.target.checked;    saveSettings(settings); });
document.getElementById("toggle-webrtc").addEventListener("change",    e => { settings.blockWebRTC = e.target.checked;     saveSettings(settings); });
document.getElementById("search-engine").addEventListener("change",    e => { settings.searchEngine = e.target.value;      saveSettings(settings); });

clearDataBtn.addEventListener("click", () => {
  if (confirm("Clear all browsing data? This will close all tabs.")) {
    localStorage.clear();
    tabs.forEach(tab => tab.iframe?.remove());
    tabs = [];
    tabCounter = 0;
    totalBlocked = 0;
    settingsPanel.classList.add("hidden");
    createTab();
  }
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  if (e.ctrlKey && e.key === "l") { e.preventDefault(); addressBar.focus(); }
  if (e.ctrlKey && e.key === "t") { e.preventDefault(); createTab(); }
  if (e.ctrlKey && e.key === "w") { e.preventDefault(); closeTab(activeTabId); }
  if (e.ctrlKey && e.key === "r") { e.preventDefault(); refreshBtn.click(); }
  if (e.key === "Escape")          { settingsPanel.classList.add("hidden"); }
});

// ── Boot ──────────────────────────────────────────────────────────────
createTab();
