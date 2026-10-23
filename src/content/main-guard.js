// MAIN-world guard. Runs before page scripts at document_start.
// No chrome.* APIs here: settings arrive through a data attribute.
(() => {
  "use strict";

  if (window.__adshieldMain) return;
  window.__adshieldMain = true;

  const CFG_ATTR = "data-adshield-cfg";

  const HARDCODED_AD_HOSTS = [
    "recrampwiped.com",
    "adsboosters.xyz",
    "traffmovie.com",
    "eo9viqvtjnmst.com",
    "popads.net",
    "popcash.net",
    "propellerads.com",
    "propellerclick.com",
    "adsterra.com",
    "highperformanceformat.com",
    "monetag.com",
    "hilltopads.net",
    "hilltopads.com",
    "juicyads.com",
    "exoclick.com",
    "exdynsrv.com",
    "magsrv.com",
    "trafficjunky.net",
    "trafficfactory.biz",
    "trafficstars.com",
    "realsrv.com",
    "tsyndicate.com",
    "onclckds.com",
    "onclickalgo.com",
    "clickadu.com",
    "adcash.com",
    "popmyads.com",
    "mgid.com",
    "adspyzen.com",
    "adspyglass.com",
    "clickaine.com",
    "zeropark.com",
    "ad-maven.com",
    "ad-maven.net",
    "clickmonetizer.com",
    "dolohen.com",
    "pemsrv.com",
    "mybetterads.com",
    "jdpirata98.it.com",
    "it.com",
    "yvjskep4.click",
    "dubzenom.com",
    "dc9xwpjprguup.cloudfront.net",
    "a-ads.com",
    "acceptable.a-ads.com",
    "ukankingwithea.com",
    "enaightdecipie.com",
    "unlockr.app"
  ];

  const DEFAULT_CFG = {
    enabled: true,
    popunders: true,
    exitNags: true,
    strict: false,
    crossSite: false,
    hosts: []
  };

  let cfg = { ...DEFAULT_CFG };
  let lastRead = 0;

  const docRoot = () => document.documentElement || document.body || null;

  function readCfg(force = false) {
    const now = Date.now();
    if (!force && now - lastRead < 500) return cfg;
    lastRead = now;
    try {
      const raw = docRoot()?.getAttribute(CFG_ATTR);
      if (!raw) return cfg;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        cfg = {
          ...DEFAULT_CFG,
          ...parsed,
          hosts: Array.isArray(parsed.hosts) ? parsed.hosts : []
        };
      }
    } catch {
      /* malformed config: keep previous */
    }
    return cfg;
  }

  readCfg(true);
  document.addEventListener("adshield:cfg", () => readCfg(true), true);

  /* ------------------------------------------------------------- reporting */

  let reported = new Set();
  let reportedAt = 0;

  function report(kind, detail) {
    const now = Date.now();
    if (now - reportedAt > 2000) {
      reported = new Set();
      reportedAt = now;
    }
    const key = kind + "|" + detail;
    if (reported.has(key)) return;
    reported.add(key);
    try {
      window.postMessage({ __adshield: 1, kind, detail: String(detail).slice(0, 180) }, "*");
    } catch {
      /* ignore */
    }
  }

  /* --------------------------------------------------------------- helpers */

  function hostMatches(host, list) {
    for (const entry of list) {
      if (!entry) continue;
      const d = String(entry).toLowerCase().replace(/^\*\./, "");
      if (host === d || host.endsWith("." + d)) return true;
    }
    return false;
  }

  function isBlockedUrl(raw) {
    let u;
    try {
      u = new URL(String(raw), location.href);
    } catch {
      return false;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    const host = u.hostname.toLowerCase();
    return hostMatches(host, cfg.hosts) || hostMatches(host, HARDCODED_AD_HOSTS);
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

  function isClickHijacker(el) {
    if (!(el instanceof Element)) return false;
    if (el === document.documentElement || el === document.body) return false;
    if (el.closest?.('dialog,[role="dialog"],[aria-modal="true"]')) return false;

    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "absolute" && cs.position !== "sticky") {
      return false;
    }

    const alpha = colorAlpha(cs.backgroundColor);
    const opacity = Number.parseFloat(cs.opacity);
    const transparent =
      (Number.isFinite(opacity) && opacity <= 0.06) || alpha <= 0.06;
    if (!transparent) return false;

    const rect = el.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area < 400) return false;

    const id = el.id || "";
    const cls = typeof el.className === "string" ? el.className : "";
    const known = /AdsCreativeRedirect|ads-core|adshield|popunder|click-?overlay|interstitial/i.test(
      id + " " + cls
    );
    const z = Number.parseInt(cs.zIndex, 10);
    const viewport = Math.max(1, innerWidth * innerHeight);

    if (known) return true;
    if (!Number.isFinite(z) || z < 1000) return false;
    if (z >= 1000000) return true;
    return area >= viewport * 0.03;
  }

  /* ----------------------------------------------------------- user gesture */

  let gesture = { type: "", at: -1e9, trusted: false };
  let gestureBlocked = false;
  let clickAnchorHost = "";

  for (const type of ["pointerdown", "mousedown", "touchstart", "click"]) {
    window.addEventListener(
      type,
      (e) => {
        if (e.isTrusted) gesture = { type: e.type, at: performance.now(), trusted: true };
      },
      { capture: true, passive: true }
    );
  }

  /* -------------------------------------------------- click hijack defense */

  document.addEventListener(
    "click",
    (e) => {
      if (!e.isTrusted) return;
      readCfg();

      gestureBlocked = false;
      const path = typeof e.composedPath === "function" ? e.composedPath() : [e.target];
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;

      clickAnchorHost = "";
      if (anchor) {
        try {
          clickAnchorHost = new URL(anchor.href, location.href).hostname.toLowerCase();
        } catch {
          clickAnchorHost = "";
        }
      }

      for (const node of path) {
        if (!(node instanceof Element)) continue;
        if (node === document.documentElement || node === document.body) break;
        if (isClickHijacker(node)) {
          gestureBlocked = true;
          e.preventDefault();
          e.stopImmediatePropagation();
          report("overlay", describeNode(node));
          break;
        }
      }

      if (gestureBlocked) return;

      if (anchor && isBlockedUrl(anchor.href)) {
        gestureBlocked = true;
        e.preventDefault();
        e.stopImmediatePropagation();
        report("link", anchor.href);
      }
    },
    true
  );

  // Guard against programmatic/synthetic detached anchor clicks (used by ad cloakers on sites like pesktop)
  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const config = readCfg();
    if (config.enabled && this.href && isBlockedUrl(this.href)) {
      report("link", this.href);
      return;
    }
    return nativeAnchorClick.apply(this, arguments);
  };

  function describeNode(el) {
    const id = el.id ? "#" + el.id : "";
    const cls =
      typeof el.className === "string" && el.className
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "";
    const r = el.getBoundingClientRect();
    return `${el.tagName.toLowerCase()}${id}${cls} ${Math.round(r.width)}x${Math.round(r.height)}`;
  }

  /* ------------------------------------------------------- window.open guard */

  const nativeOpen = window.open.bind(window);
  let lastAllowedOpen = -1e9;

  function guardedOpen(url, target, features) {
    const config = readCfg();
    if (!config.enabled || !config.popunders) {
      return nativeOpen(url, target, features);
    }

    const tgt = target == null ? "" : String(target);
    if (tgt === "_self" || tgt === "_top" || tgt === "_parent") {
      return nativeOpen(url, target, features);
    }

    if (config.strict) {
      report("popup", "blocked by strict mode");
      return null;
    }

    let href = "";
    try {
      href = url == null ? "" : String(url);
    } catch {
      href = "";
    }

    // Blank popups are the delivery vehicle for tabunder/popunder chains.
    if (!href || /^about:blank/i.test(href)) {
      report("popup", "blocked blank popup");
      return null;
    }
    if (/^(data|javascript|vbscript|file|chrome|edge|brave):/i.test(href)) {
      report("popup", "blocked " + href.slice(0, 40));
      return null;
    }
    if (isBlockedUrl(href)) {
      report("popup", href);
      return null;
    }
    if (document.visibilityState === "hidden") {
      report("popup", "blocked background popup");
      return null;
    }

    const fresh =
      gesture.trusted && gesture.type === "click" && performance.now() - gesture.at < 1200;

    if (gestureBlocked || !fresh || performance.now() - lastAllowedOpen < 1500) {
      report("popup", "blocked unexpected popup");
      return null;
    }

    // A popunder almost always targets a different domain than the link you
    // actually clicked. Only allow same-site / clicked-link-host popups.
    if (!config.crossSite) {
      const popupHost = new URL(href, location.href).hostname.toLowerCase();
      const allowed = [location.hostname.toLowerCase(), clickAnchorHost];
      const trustedHost = allowed.some(
        (h) => h && (popupHost === h || popupHost.endsWith("." + h) || h.endsWith("." + popupHost))
      );
      if (!trustedHost) {
        report("popup", "cross-site popup blocked: " + popupHost);
        return null;
      }
    }

    lastAllowedOpen = performance.now();
    return nativeOpen(url, target, features);
  }

  try {
    Object.defineProperty(window, "open", {
      value: guardedOpen,
      writable: false,
      configurable: false
    });
  } catch {
    try {
      window.open = guardedOpen;
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------------- exit-nag blocker */

  const nativeAdd = EventTarget.prototype.addEventListener;

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const config = readCfg();
    if (config.enabled && config.exitNags && this === window && type === "beforeunload") {
      return;
    }
    return nativeAdd.call(this, type, listener, options);
  };

  try {
    let stored;
    Object.defineProperty(window, "onbeforeunload", {
      configurable: true,
      get: () => stored,
      set: () => {
        /* swallow exit-confirm nags */
      }
    });
  } catch {
    /* ignore */
  }
})();
