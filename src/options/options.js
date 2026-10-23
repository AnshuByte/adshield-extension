"use strict";

const DEFAULTS = {
  enabled: true,
  blockPopunders: true,
  blockExitNags: true,
  blockOverlays: true,
  overlayMode: "neutralize",
  cosmetic: true,
  mainstreamAds: true,
  trackers: false,
  strictMode: false,
  allowCrossSitePopups: false,
  allowlist: [],
  customBlocklist: []
};

const $ = (id) => document.getElementById(id);
const BOOLEAN_KEYS = [
  "enabled",
  "blockPopunders",
  "blockExitNags",
  "blockOverlays",
  "cosmetic",
  "mainstreamAds",
  "trackers",
  "strictMode",
  "allowCrossSitePopups"
];

let saveTimer = null;

function setStatus(text, saving = false) {
  const el = $("saveState");
  el.textContent = text;
  el.className = "badge " + (saving ? "saving" : "on");
}

function normalizeDomains(text) {
  const seen = new Set();
  for (const raw of String(text).split(/[\s,]+/)) {
    let value = raw.trim().toLowerCase();
    if (!value) continue;
    value = value
      .replace(/^[a-z]+:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0]
      .replace(/^\*\./, "")
      .replace(/\.$/, "");
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) seen.add(value);
  }
  return [...seen];
}

function save(patch, delay = 250) {
  clearTimeout(saveTimer);
  setStatus("Saving…", true);
  saveTimer = setTimeout(async () => {
    try {
      await chrome.storage.sync.set(patch);
      setStatus("Saved");
    } catch (err) {
      setStatus("Error");
      console.error(err);
    }
  }, delay);
}

async function load() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  const settings = { ...DEFAULTS, ...stored };

  for (const key of BOOLEAN_KEYS) {
    const input = $(key);
    if (input) input.checked = Boolean(settings[key]);
  }
  $("overlayMode").value = settings.overlayMode;
  $("allowlist").value = (settings.allowlist || []).join("\n");
  $("customBlocklist").value = (settings.customBlocklist || []).join("\n");
  setStatus("Saved");
}

for (const key of BOOLEAN_KEYS) {
  const input = $(key);
  if (!input) continue;
  input.addEventListener("change", () => save({ [key]: input.checked }));
}

$("overlayMode").addEventListener("change", () =>
  save({ overlayMode: $("overlayMode").value })
);

for (const key of ["allowlist", "customBlocklist"]) {
  const input = $(key);
  input.addEventListener("input", () =>
    save({ [key]: normalizeDomains(input.value) }, 700)
  );
  input.addEventListener("blur", () => {
    const normalized = normalizeDomains(input.value);
    input.value = normalized.join("\n");
    save({ [key]: normalized }, 0);
  });
}

$("export").addEventListener("click", async () => {
  const settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "adshield-settings.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

$("import").addEventListener("click", () => $("importFile").click());

$("importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const patch = {};
    for (const key of BOOLEAN_KEYS) {
      if (typeof parsed[key] === "boolean") patch[key] = parsed[key];
    }
    if (["neutralize", "remove"].includes(parsed.overlayMode)) patch.overlayMode = parsed.overlayMode;
    if (Array.isArray(parsed.allowlist)) patch.allowlist = normalizeDomains(parsed.allowlist.join("\n"));
    if (Array.isArray(parsed.customBlocklist)) {
      patch.customBlocklist = normalizeDomains(parsed.customBlocklist.join("\n"));
    }
    await chrome.storage.sync.set(patch);
    await load();
    setStatus("Imported");
  } catch {
    setStatus("Invalid file");
  } finally {
    event.target.value = "";
  }
});

$("reset").addEventListener("click", async () => {
  if (!confirm("Reset AdShield to default settings?")) return;
  await chrome.storage.sync.set(DEFAULTS);
  await load();
});

$("manage").addEventListener("click", () => {
  const isBrave = Boolean(navigator.brave && typeof navigator.brave.isBrave === "function");
  const isEdge = navigator.userAgent.includes("Edg/");
  const url = isBrave ? "brave://extensions" : isEdge ? "edge://extensions" : "chrome://extensions";
  chrome.tabs.create({ url });
});

load();
