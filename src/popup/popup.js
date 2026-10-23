"use strict";

const $ = (id) => document.getElementById(id);

let tabId = null;
let host = "";
let lastState = null;
let ruleCache = null;

const send = (msg) =>
  chrome.runtime.sendMessage(msg).catch(() => ({ ok: false }));

function hostOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) && u.protocol !== "file:") return "";
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

async function loadRuleIndex() {
  if (ruleCache) return ruleCache;
  ruleCache = new Map();
  for (const file of ["redirects", "ads", "trackers"]) {
    try {
      const res = await fetch(chrome.runtime.getURL(`rules/${file}.json`));
      const rules = await res.json();
      for (const rule of rules) {
        const filter = rule?.condition?.urlFilter || "";
        ruleCache.set(rule.id, filter.replace(/^\|\|/, "").replace(/\^$/, ""));
      }
    } catch {
      /* ruleset not readable */
    }
  }
  return ruleCache;
}

async function networkRows() {
  const rows = [];
  if (!tabId || !chrome.declarativeNetRequest?.getMatchedRules) return rows;
  try {
    const info = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
    const index = await loadRuleIndex();
    const counts = new Map();
    for (const match of info.rulesMatchedInfo || []) {
      const domain = index.get(match.rule?.ruleId);
      if (!domain) continue;
      counts.set(domain, (counts.get(domain) || 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    $("netCount").textContent = String(total);
    for (const [domain, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      rows.push({ tag: n > 1 ? `net x${n}` : "net", text: domain });
    }
  } catch {
    $("netCount").textContent = "—";
  }
  return rows;
}

function render(state) {
  const s = state.settings;
  lastState = state;

  $("globalText").textContent = s.enabled ? "On" : "Off";
  $("globalPill").className = "p-toggle " + (s.enabled ? "on" : "off");

  $("host").textContent = host || "This page";
  $("siteToggle").checked = !state.allowlisted;
  $("siteToggle").disabled = !host;

  const paused = state.allowlisted || !s.enabled;
  $("sitePill").textContent = state.allowlisted ? "Paused" : s.enabled ? "Protected" : "Off";
  $("sitePill").className = "badge " + (paused ? "off" : "on");

  $("ovCount").textContent = String(state.stats?.overlays || 0);
  $("popCount").textContent = String(state.stats?.popups || 0);
}

function renderList(netRows, logs) {
  const list = $("recent");
  list.replaceChildren();

  const items = [...netRows];
  for (const log of logs || []) {
    items.push({ tag: "layer", text: String(log) });
  }
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "p-empty t-muted t-xs";
    li.textContent = "Nothing yet on this page.";
    list.appendChild(li);
    return;
  }

  for (const item of items.slice(0, 8)) {
    const li = document.createElement("li");

    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = item.tag;

    const what = document.createElement("span");
    what.className = "what";
    what.textContent = item.text;
    what.title = item.text;

    li.append(tag, what);
    list.appendChild(li);
  }
}

async function refresh() {
  const state = await send({ type: "getState", host, tabId });
  if (!state?.ok) return;
  render(state);
  renderList(await networkRows(), state.stats?.logs || []);
}

async function init() {
  $("version").textContent = "v" + chrome.runtime.getManifest().version;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  host = hostOf(tab?.url || "");

  await refresh();
  if (!host) {
    $("sitePill").textContent = "Unavailable";
    $("sitePill").className = "badge neutral";
    $("siteToggle").disabled = true;
  }
}

$("siteToggle").addEventListener("change", async (event) => {
  if (!host) return;
  const allowlisted = !event.target.checked;
  await send({ type: "setSite", host, allowlisted });
  setTimeout(refresh, 200);
});

$("globalPill").addEventListener("click", async () => {
  if (!lastState) return;
  await send({ type: "setGlobal", enabled: !lastState.settings.enabled });
  setTimeout(refresh, 150);
});

$("rescan").addEventListener("click", async () => {
  await send({ type: "rescan", tabId });
  setTimeout(refresh, 600);
});

$("reload").addEventListener("click", () => {
  if (tabId) chrome.tabs.reload(tabId);
  window.close();
});

$("options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

init();

// Keep stats live while the popup is open.
setInterval(refresh, 3000);
