// AdShield service worker.
// Chromium-only APIs: works unchanged on Chrome, Brave and Edge (MV3).
"use strict";

const DEFAULTS = {
  enabled: true,
  blockPopunders: true,
  blockExitNags: true,
  blockOverlays: true,
  overlayMode: "neutralize", // "neutralize" = click-through, "remove" = delete node
  cosmetic: true,
  mainstreamAds: true,
  trackers: false,
  strictMode: false,
  allowCrossSitePopups: false,
  allowlist: [],
  customBlocklist: []
};

const ALLOW_BASE = 5000;
const ALLOW_SLOTS = 100;
const CUSTOM_BASE = 6000;
const CUSTOM_SLOTS = 300;
const SUB_TYPES = [
  "script", "sub_frame", "stylesheet", "image", "font",
  "object", "xmlhttprequest", "ping", "media", "websocket", "other"
];

const normalizeDomain = (value) => {
  if (typeof value !== "string") return "";
  let host = value.trim().toLowerCase();
  if (!host) return "";
  host = host.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  if (!/^[a-z0-9.*-]+\.[a-z]{2,}$/.test(host)) return "";
  return host.replace(/^\*\./, "");
};

const uniqueDomains = (list) =>
  [...new Set((Array.isArray(list) ? list : []).map(normalizeDomain).filter(Boolean))];

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return {
    ...DEFAULTS,
    ...stored,
    allowlist: uniqueDomains(stored.allowlist),
    customBlocklist: uniqueDomains(stored.customBlocklist)
  };
}

let applying = null;
function applyRules() {
  if (applying) return applying;
  applying = (async () => {
    const s = await getSettings();

    try {
      // All three rulesets are gated on the master enabled switch.
      // redirects is the always-on popunder/overlay network list — it must also
      // turn off when the user disables AdShield globally.
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [
          ...(s.enabled ? ["redirects"] : []),
          ...(s.enabled && s.mainstreamAds ? ["ads"] : []),
          ...(s.enabled && s.trackers ? ["trackers"] : [])
        ],
        disableRulesetIds: [
          ...(!s.enabled ? ["redirects"] : []),
          ...(s.enabled && s.mainstreamAds ? [] : ["ads"]),
          ...(s.enabled && s.trackers ? [] : ["trackers"])
        ]
      });
    } catch (err) {
      console.warn("[AdShield] could not toggle rulesets", err);
    }

    const removeRuleIds = [
      ...Array.from({ length: ALLOW_SLOTS }, (_, i) => ALLOW_BASE + i),
      ...Array.from({ length: CUSTOM_SLOTS }, (_, i) => CUSTOM_BASE + i)
    ];

    const allowRules = s.allowlist.slice(0, ALLOW_SLOTS).map((domain, i) => ({
      id: ALLOW_BASE + i,
      priority: 5000,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: [domain], resourceTypes: ["main_frame", "sub_frame"] }
    }));

    const customRules = s.customBlocklist.slice(0, CUSTOM_SLOTS).map((domain, i) => ({
      id: CUSTOM_BASE + i,
      priority: 10,
      action: { type: "block" },
      condition: { urlFilter: `||${domain}^`, resourceTypes: SUB_TYPES }
    }));

    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules: [...allowRules, ...customRules]
      });
    } catch (err) {
      console.warn("[AdShield] could not update dynamic rules", err);
    }

    return s;
  })().finally(() => {
    applying = null;
  });
  return applying;
}

/* ------------------------------------------------------------------ stats */

const tabKey = (id) => `tab:${id}`;
const emptyStats = () => ({ overlays: 0, popups: 0, cosmetic: 0, logs: [] });

async function readStats(tabId) {
  if (typeof tabId !== "number") return emptyStats();
  try {
    const key = tabKey(tabId);
    const stored = await chrome.storage.session.get(key);
    return { ...emptyStats(), ...(stored[key] || {}) };
  } catch {
    return emptyStats();
  }
}

async function bumpStats(tabId, patch = {}) {
  if (typeof tabId !== "number") return;
  const current = await readStats(tabId);
  const next = {
    overlays: current.overlays + (Number(patch.overlays) || 0),
    popups: current.popups + (Number(patch.popups) || 0),
    cosmetic: current.cosmetic + (Number(patch.cosmetic) || 0),
    logs: current.logs
  };
  if (patch.log) {
    next.logs = [String(patch.log).slice(0, 160), ...current.logs].slice(0, 12);
  }
  const total = next.overlays + next.popups + next.cosmetic;
  try {
    await chrome.storage.session.set({ [tabKey(tabId)]: next });
  } catch {
    return;
  }
  await setBadge(tabId, total);
}

async function setBadge(tabId, count) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(Math.min(count, 99)) : "" });
  } catch {
    /* tab already gone */
  }
}

/* ------------------------------------------------------------- lifecycle */

applyRules().catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  applyRules().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  applyRules().catch(() => {});
});

let reapplyTimer = null;
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== "sync") return;
  clearTimeout(reapplyTimer);
  reapplyTimer = setTimeout(() => applyRules().catch(() => {}), 150);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(tabKey(tabId)).catch(() => {});
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "loading") return;
  try {
    await chrome.storage.session.remove(tabKey(tabId));
  } catch {
    /* ignore */
  }
  await setBadge(tabId, 0);
});

/* --------------------------------------------------------------- messages */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id;

    switch (msg?.type) {
      case "stats": {
        await bumpStats(tabId, msg.patch || {});
        return { ok: true };
      }

      case "getState": {
        const settings = await getSettings();
        const host = normalizeDomain(msg.host || "");
        return {
          ok: true,
          settings,
          host,
          allowlisted: host ? settings.allowlist.includes(host) : false,
          stats: await readStats(msg.tabId)
        };
      }

      case "setGlobal": {
        await chrome.storage.sync.set({ enabled: Boolean(msg.enabled) });
        return { ok: true };
      }

      case "setSite": {
        const host = normalizeDomain(msg.host || "");
        if (!host) return { ok: false, error: "no host" };
        const settings = await getSettings();
        const allowlist = new Set(settings.allowlist);
        if (msg.allowlisted) allowlist.add(host);
        else allowlist.delete(host);
        await chrome.storage.sync.set({ allowlist: [...allowlist] });
        return { ok: true, allowlisted: allowlist.has(host) };
      }

      case "rescan": {
        if (typeof msg.tabId === "number") {
          try {
            await chrome.tabs.sendMessage(msg.tabId, { type: "rescan" });
          } catch {
            /* no content script on this page */
          }
        }
        return { ok: true };
      }

      case "clearStats": {
        if (typeof msg.tabId === "number") {
          await chrome.storage.session.remove(tabKey(msg.tabId));
          await setBadge(msg.tabId, 0);
        }
        return { ok: true };
      }

      case "openOptions": {
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      }

      default:
        return { ok: false, error: "unknown message" };
    }
  })()
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err) }));

  return true;
});
