// ISOLATED-world guard: finds and neutralizes transparent click layers,
// known ad containers and popunder glue. Settings come from chrome.storage.
(() => {
  "use strict";

  if (window.__adshieldOverlay) return;
  window.__adshieldOverlay = true;

  const IS_TOP = window === window.top;
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

  // Known invisible overlays / click hijack layers
  const KNOWN_OVERLAYS = [
    "#AdsCreativeRedirect",
    "[id^='AdsCreativeRedirect']"
  ];

  // Containers that only exist to serve ads / banners (hidden cosmetically).
  const KNOWN_JUNK = [
    "#mm-sticky-ad",
    ".ads-core-ads-offerwall",
    "[id^='ads-core-']",
    "ins.adsbygoogle",
    ".adsbygoogle",
    "#downloadBtn",
    "#downloadBtn2",
    ".button-bodyad",
    "[class*='buttonPress-']",
    ".a728_90",
    ".a728_90q",
    "iframe[src*='a-ads.com']"
  ];

  const MODIFIED = new Map();
  const pending = { overlays: 0, popups: 0, cosmetic: 0, log: [] };

  let settings = { ...DEFAULTS };
  let active = false;
  let flushTimer = null;
  let scanTimer = null;
  let observer = null;

  const docRoot = () => document.documentElement || document.body || null;

  function setAttr(name, value) {
    const root = docRoot();
    if (root) root.setAttribute(name, value);
  }

  function colorAlpha(color) {
    if (!color || color === "transparent") return 0;
    const m = /rgba?\(([^)]+)\)/.exec(color);
    if (!m) return 1;
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    const a = Number.parseFloat(parts[3]);
    return Number.isFinite(a) ? a : 1;
  }

  function describe(el) {
    const id = el.id ? "#" + el.id : "";
    const cls =
      typeof el.className === "string" && el.className
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "";
    const r = el.getBoundingClientRect();
    return `${el.tagName.toLowerCase()}${id}${cls} ${Math.round(r.width)}x${Math.round(r.height)}`;
  }

  /* ------------------------------------------------------------- reporting */

  function count(kind, detail) {
    pending[kind] = (pending[kind] || 0) + 1;
    if (detail && pending.log.length < 4) pending.log.push(detail);
    if (!IS_TOP) return;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const patch = {
        overlays: pending.overlays,
        popups: pending.popups,
        cosmetic: pending.cosmetic,
        log: pending.log.slice(0, 3).join(" | ")
      };
      pending.overlays = 0;
      pending.popups = 0;
      pending.cosmetic = 0;
      pending.log = [];
      if (!patch.overlays && !patch.popups && !patch.cosmetic) return;
      try {
        chrome.runtime.sendMessage({ type: "stats", patch }).catch(() => {});
      } catch {
        /* extension context invalidated */
      }
    }, 600);
  }

  /* ------------------------------------------------------------- detection */

  function isInvisibleLayer(el) {
    if (!(el instanceof Element)) return false;
    if (el === document.documentElement || el === document.body) return false;
    if (el.hasAttribute("data-adshield-done")) return false;
    if (el.closest('dialog,[role="dialog"],[aria-modal="true"]')) return false;
    if (
      document.activeElement &&
      document.activeElement !== document.body &&
      el.contains(document.activeElement)
    ) {
      return false;
    }

    const cs = getComputedStyle(el);
    if (cs.pointerEvents === "none") return false;
    if (cs.position !== "fixed" && cs.position !== "absolute" && cs.position !== "sticky") {
      return false;
    }

    const rect = el.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area < 2500) return false;

    const alpha = colorAlpha(cs.backgroundColor);
    const opacity = Number.parseFloat(cs.opacity);
    const transparent =
      alpha <= 0.06 || (Number.isFinite(opacity) && opacity <= 0.06);
    if (!transparent) return false;

    const viewport = Math.max(1, innerWidth * innerHeight);
    const id = el.id || "";
    const cls = typeof el.className === "string" ? el.className : "";
    const known = /AdsCreativeRedirect|ads-core|popunder|click-?overlay|interstitial/i.test(
      id + " " + cls
    );
    if (known) return true;

    const z = Number.parseInt(cs.zIndex, 10);
    if (Number.isFinite(z) && z >= 1000) return area >= viewport * 0.02;
    if (el.tagName === "IFRAME" || el.tagName === "A") return area >= viewport * 0.25;
    return false;
  }

  function findLayer(start) {
    let el = start;
    for (let depth = 0; el && depth < 4; depth += 1) {
      if (isInvisibleLayer(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  /* -------------------------------------------------------------- mutation */

  function neutralize(el, reason) {
    if (!(el instanceof Element)) return false;
    if (el.hasAttribute("data-adshield-done")) return false;
    el.setAttribute("data-adshield-done", "1");

    if (settings.overlayMode === "remove") {
      el.remove();
    } else {
      MODIFIED.set(el, {
        value: el.style.getPropertyValue("pointer-events"),
        priority: el.style.getPropertyPriority("pointer-events")
      });
      el.style.setProperty("pointer-events", "none", "important");
      el.setAttribute("data-adshield-neutralized", "1");
    }

    count("overlays", `${reason}: ${describe(el)}`);
    return true;
  }

  function hideCosmetic(el) {
    if (!(el instanceof Element)) return;
    if (el.hasAttribute("data-adshield-cosmetic-done")) return;
    el.setAttribute("data-adshield-cosmetic-done", "1");
    el.style.setProperty("display", "none", "important");
    el.setAttribute("aria-hidden", "true");
    count("cosmetic", `ad container: ${describe(el)}`);
  }

  function restoreAll() {
    for (const [el, prev] of MODIFIED) {
      if (!el.isConnected) continue;
      if (prev.value) el.style.setProperty("pointer-events", prev.value, prev.priority);
      else el.style.removeProperty("pointer-events");
      el.removeAttribute("data-adshield-neutralized");
      el.removeAttribute("data-adshield-done");
    }
    MODIFIED.clear();

    for (const el of document.querySelectorAll("[data-adshield-cosmetic-done]")) {
      el.removeAttribute("data-adshield-cosmetic-done");
      el.style.removeProperty("display");
      el.removeAttribute("aria-hidden");
    }
  }

  /* -------------------------------------------------------------- scanning */

  function probeViewport() {
    if (!document.body) return;
    const points = [
      [0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75],
      [0.5, 0.12], [0.5, 0.88], [0.08, 0.5], [0.92, 0.5]
    ];
    for (const [fx, fy] of points) {
      const x = Math.round(innerWidth * fx);
      const y = Math.round(innerHeight * fy);
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      const layer = findLayer(el);
      if (layer) neutralize(layer, "invisible overlay");
    }
  }

  function scan() {
    if (!active) return;
    if (settings.blockOverlays) {
      for (const selector of KNOWN_OVERLAYS) {
        let nodes;
        try {
          nodes = document.querySelectorAll(selector);
        } catch {
          continue;
        }
        for (const el of nodes) neutralize(el, "known overlay");
      }
    }

    if (settings.cosmetic) {
      for (const selector of KNOWN_JUNK) {
        let nodes;
        try {
          nodes = document.querySelectorAll(selector);
        } catch {
          continue;
        }
        for (const el of nodes) hideCosmetic(el);
      }
    }

    probeViewport();
  }

  function scheduleScan(delay = 300) {
    if (!active || scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, delay);
  }

  function onMutations(records) {
    if (!active) return;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (settings.blockOverlays) {
          for (const selector of KNOWN_OVERLAYS) {
            if (node.matches?.(selector) || node.querySelector?.(selector)) {
              neutralize(node.matches?.(selector) ? node : node.querySelector(selector), "known overlay");
            }
          }
        }
        if (settings.cosmetic) {
          for (const selector of KNOWN_JUNK) {
            if (node.matches?.(selector) || node.querySelector?.(selector)) {
              hideCosmetic(node.matches?.(selector) ? node : node.querySelector(selector));
            }
          }
        }
      }
    }
    scheduleScan(400);
  }

  function startObserver() {
    if (observer || !active) return;
    const target = document.documentElement;
    if (!target) return;
    observer = new MutationObserver(onMutations);
    observer.observe(target, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  /* --------------------------------------------------------------- settings */

  async function loadSettings() {
    let stored;
    try {
      stored = await chrome.storage.sync.get(DEFAULTS);
    } catch {
      stored = DEFAULTS;
    }
    settings = { ...DEFAULTS, ...stored };

    const host = location.hostname.replace(/^www\./, "").toLowerCase();
    const allowlisted = (settings.allowlist || []).some(
      (d) => host === d || host.endsWith("." + d)
    );
    active = Boolean(settings.enabled) && !allowlisted;

    setAttr(
      "data-adshield-cfg",
      JSON.stringify({
        enabled: active,
        popunders: Boolean(settings.blockPopunders),
        exitNags: Boolean(settings.blockExitNags),
        strict: Boolean(settings.strictMode),
        crossSite: Boolean(settings.allowCrossSitePopups),
        hosts: Array.isArray(settings.customBlocklist) ? settings.customBlocklist : []
      })
    );
    setAttr("data-adshield-cosmetic", settings.cosmetic ? "1" : "0");
    setAttr("data-adshield-overlay-mode", settings.overlayMode);

    document.dispatchEvent(new CustomEvent("adshield:cfg"));

    if (!active) {
      restoreAll();
      stopObserver(); // stop watching DOM on allowlisted / disabled sites
    }
    return active;
  }

  /* ------------------------------------------------------------------ wiring */

  if (IS_TOP) {
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__adshield !== 1) return;
      if (data.kind === "popup") count("popups", data.detail);
      else count("overlays", data.detail);
    });
  }

  for (const evt of ["pointerdown", "mousedown", "click"]) {
    document.addEventListener(
      evt,
      (event) => {
        if (!active || !settings.blockOverlays) return;
        const el = document.elementFromPoint(event.clientX, event.clientY);
        const layer = el ? findLayer(el) : null;
        if (layer) {
          neutralize(layer, "click-layer on " + evt);
          if (evt === "click") {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }
      },
      true
    );
  }

  let resizeTimer = null;
  const rescanSoon = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => scheduleScan(150), 200);
  };
  window.addEventListener("scroll", rescanSoon, { passive: true });
  window.addEventListener("resize", rescanSoon, { passive: true });

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== "sync") return;
    loadSettings().then(() => {
      scheduleScan(100);
    });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "rescan") {
      loadSettings().then(() => scan());
    }
  });

  /* ------------------------------------------------------------------- boot */

  loadSettings().then(() => {
    startObserver();
    scan();
    [250, 800, 1800, 3500].forEach((delay) => setTimeout(() => scheduleScan(0), delay));
    setInterval(() => {
      if (document.visibilityState === "visible") scheduleScan(0);
      // Prune elements that were neutralized but have since been removed from the
      // DOM — prevents the MODIFIED map from growing unboundedly on dynamic pages.
      for (const [el] of MODIFIED) {
        if (!el.isConnected) MODIFIED.delete(el);
      }
    }, 5000);
  });
})();
