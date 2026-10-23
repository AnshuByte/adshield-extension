// Headless Chrome/Brave/Edge smoke test for the extension.
// Usage: node tools/test-extension.mjs [path-to-chromium-binary]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8123;
const CDP_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

import { existsSync } from "node:fs";

const candidatePaths = [
  process.argv[2],
  process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
].filter(Boolean);

const chromePath = candidatePaths.find((p) => existsSync(p)) || candidatePaths[0];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const file = join(ROOT, "test", url.pathname === "/" ? "demo.html" : url.pathname);
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id) return;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result);
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function jsonList() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return res.json();
}

async function waitFor(fn, timeout = 20000, interval = 250) {
  const start = Date.now();
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      /* retry */
    }
    if (Date.now() - start > timeout) throw new Error("timeout waiting for condition");
    await sleep(interval);
  }
}

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  const icon = passed ? "PASS" : "FAIL";
  console.log(`[${icon}] ${name}${detail ? "  ->  " + detail : ""}`);
}

const profile = mkdtempSync(join(tmpdir(), "adshield-test-"));
let chrome;
let cdp;

try {
  server.listen(PORT, "127.0.0.1");

  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--user-data-dir=" + profile,
      `--remote-debugging-port=${CDP_PORT}`,
      `--load-extension=${ROOT}`,
      `--disable-extensions-except=${ROOT}`,
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      "about:blank"
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  chrome.stderr.on("data", (buf) => {
    const line = buf.toString();
    if (/error|fail/i.test(line) && !/GCM|gcm|registration/i.test(line)) {
      console.log("[chrome]", line.trim().slice(0, 220));
    }
  });

  const version = await waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      return await res.json();
    } catch {
      return null;
    }
  });
  console.log(`browser: ${version.Browser}`);

  const targets = await jsonList();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");

  cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/demo.html` });

  await waitFor(() =>
    cdp.send("Runtime.evaluate", {
      expression: "document.readyState === 'complete' && !!document.getElementById('realButton')",
      returnByValue: true
    }).then((r) => r.result.value)
  );
  await sleep(900);

  const evalJS = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: false
    });
    if (r.exceptionDetails) {
      return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    }
    return r.result.value;
  };

  const pageCount = async () => (await jsonList()).filter((t) => t.type === "page").length;

  async function click(selector) {
    const point = await evalJS(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!point) throw new Error("missing element " + selector);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1
    });
    await sleep(700);
  }

  /* ------------------------------------------------------------- assertions */

  const cfg = await evalJS("document.documentElement.getAttribute('data-adshield-cfg')");
  check("content script injects config", typeof cfg === "string" && cfg.includes("enabled"), cfg || "missing");

  const mainGuard = await evalJS("window.__adshieldMain === true && window.open.toString().includes('guardedOpen')");
  check("main-world guard wraps window.open", mainGuard === true, String(mainGuard));

  const rulesets = await (async () => {
    const sw = (await jsonList()).find((t) => t.type === "service_worker" && t.url.includes("background.js"));
    if (!sw) return null;
    const swCdp = await CDP.connect(sw.webSocketDebuggerUrl);
    const out = await swCdp.send("Runtime.evaluate", {
      expression: "chrome.declarativeNetRequest.getEnabledRulesets()",
      awaitPromise: true,
      returnByValue: true
    });
    swCdp.close();
    return out.result.value;
  })();
  check(
    "static rulesets enabled",
    Array.isArray(rulesets) && rulesets.includes("redirects") && rulesets.includes("ads"),
    JSON.stringify(rulesets)
  );

  const blockedFetch = await evalJS(
    "fetch('https://popads.net/serve?z=1').then(() => 'allowed').catch(() => 'blocked')"
  );
  check("network rule blocks ad host", blockedFetch === "blocked", String(blockedFetch));

  const overlayNeutralized = await evalJS(`(() => {
    const el = document.getElementById('AdsCreativeRedirect');
    if (!el || !el.isConnected) return 'removed';
    return getComputedStyle(el).pointerEvents;
  })()`);
  check("invisible layer neutralized", overlayNeutralized === "none" || overlayNeutralized === "removed", String(overlayNeutralized));

  const sticky = await evalJS(
    "getComputedStyle(document.getElementById('mm-sticky-ad')).display"
  );
  check("sticky ad container hidden", sticky === "none", String(sticky));

  const offerwall = await evalJS(
    "getComputedStyle(document.querySelector('.ads-core-ads-offerwall')).display"
  );
  check("offerwall container hidden", offerwall === "none", String(offerwall));

  const nau = await evalJS("window.onbeforeunload = () => 1; String(typeof window.onbeforeunload)");
  check("exit-confirm handler swallowed", nau === "undefined", String(nau));

  const programmatic = await evalJS("String(window.open('https://popads.net/x'))");
  check("programmatic popunder returns null", programmatic === "null", programmatic);

  let before = await pageCount();
  await click("#fakeDownload");
  let after = await pageCount();
  check("click on transparent layer opens nothing", after === before, `${before} -> ${after}`);

  before = await pageCount();
  await click("#popunderListed");
  after = await pageCount();
  check("listed popunder domain blocked", after === before, `${before} -> ${after}`);

  before = await pageCount();
  await click("#popunderUnlisted");
  after = await pageCount();
  check("unlisted cross-site popunder blocked", after === before, `${before} -> ${after}`);

  before = await pageCount();
  await click("#popupSameSite");
  after = await pageCount();
  check("same-site popup still allowed", after === before + 1, `${before} -> ${after}`);

  for (const t of (await jsonList()).filter((x) => x.type === "page" && x.url.includes("/ok.html"))) {
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${t.id}`).catch(() => {});
  }
  await sleep(300);

  before = await pageCount();
  await click("#legitLink");
  after = await pageCount();
  check("legit target=_blank link works", after === before + 1, `${before} -> ${after}`);

  await click("#realButton");
  await sleep(400);
  const realClicks = await evalJS("document.getElementById('realCount').textContent");
  check("normal buttons still work", String(realClicks) === "1", String(realClicks));
} catch (err) {
  console.error("test harness error:", err);
  results.push({ name: "harness", passed: false, detail: String(err) });
} finally {
  if (cdp) cdp.close();
  try {
    server.close();
  } catch {
    /* ignore */
  }
  if (chrome?.pid) {
    spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
  }
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
