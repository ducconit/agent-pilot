/**
 * Agent Pilot - Shared verification harness.
 *
 * Small, single-purpose helpers extracted from the verification suites. Each
 * helper owns exactly one concern (recording results, serving the test page,
 * launching Chromium with the extension, waiting for the service worker) so the
 * suites themselves stay focused on assertions.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { LOCAL_HOST, ROOT_DIR, EXTENSIONS_DIR, TIMEOUTS, SEPARATOR } from "./config.mjs";
import { resolveChromiumBin, getChromiumLaunchArgs } from "../browser_resolver.mjs";

// MIME map for the static test server. Mirrors what the suites served before:
// unknown extensions fall back to text/plain.
const STATIC_CONTENT_TYPES = Object.freeze({
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml"
});

/** Resolve after `ms` milliseconds. Shared replacement for inline setTimeout sleeps. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a result recorder that prints per-item lines plus a totals block.
 *
 * Options preserve the (slightly different) wording each suite already printed:
 *  - title:          summary heading line (ignored by the "compact" style)
 *  - itemKey:        key stored on each result ("feature" or "name")
 *  - summaryStyle:   "features" | "compact" | "passed"
 *  - successMessage: printed (console.log) when everything passes; null to omit
 *  - failureMessage: printed (console.error) when anything fails; null to omit
 */
export function createRecorder({
  title = "📊 KẾT QUẢ KIỂM THỬ:",
  itemKey = "feature",
  summaryStyle = "features",
  successMessage = null,
  failureMessage = "\n❌ Có kiểm thử chưa vượt qua!"
} = {}) {
  const results = [];

  function record(feature, passed, details = "") {
    results.push({ [itemKey]: feature, passed, details });
    const mark = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${mark}: ${feature} ${details ? `-> ${details}` : ""}`);
  }

  function passedCount() {
    return results.filter((t) => t.passed).length;
  }

  function summarize() {
    const total = results.length;
    const passed = passedCount();
    // Real percentage (the previous hardcoded "(100%)" misreported partial runs)
    const percent = total === 0 ? 100 : Math.round((passed / total) * 100);
    console.log(`\n${SEPARATOR}`);
    if (summaryStyle === "compact") {
      console.log(`📊 TỔNG SỐ KIỂM TRA: ${total} | THÀNH CÔNG: ${passed}/${total}`);
    } else {
      console.log(title);
      if (summaryStyle === "passed") {
        console.log(`Passed: ${passed} / ${total} (${percent}%)`);
      } else {
        console.log(`TỔNG SỐ TÍNH NĂNG KIỂM TRA: ${total}`);
        console.log(`THÀNH CÔNG: ${passed} / ${total} (${percent}%)`);
      }
    }
    console.log(SEPARATOR);
    if (passed === total) {
      if (successMessage) console.log(successMessage);
    } else if (failureMessage) {
      console.error(failureMessage);
    }
  }

  // Sets the process exit code (never calls process.exit) so every upstream
  // `finally` block still runs and the browser/server are always torn down.
  function exitIfFailed() {
    if (passedCount() !== results.length) process.exitCode = 1;
  }

  return { record, results, passedCount, summarize, exitIfFailed };
}

/**
 * Start a tiny static file server rooted at `rootDir`.
 *
 * Serves `/` (and any unknown/missing path) as test-page.html so navigations never
 * 404 mid-run. The rewritten URL is normalized and stripped of leading "../"
 * segments, then rejected if it still escapes rootDir — the original path
 * traversal guard, preserved verbatim. Assets (images, css, js) are served with
 * their real content type from STATIC_CONTENT_TYPES.
 */
export function startStaticServer(port, rootDir = ROOT_DIR) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const sanitizedUrl = path
        .normalize(req.url === "/" ? "/test-page.html" : req.url.split("?")[0])
        .replace(/^(\.\.[\/\\])+/, "");
      let filePath = path.join(rootDir, sanitizedUrl);
      if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(rootDir, "test-page.html");
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": STATIC_CONTENT_TYPES[ext] || "text/plain" });
      res.end(fs.readFileSync(filePath));
    });
    server.listen(port, LOCAL_HOST, () => resolve(server));
  });
}

// Track live browsers so an abrupt process exit can still reap the Chromium child;
// normal runs remove themselves via close().
const launchedBrowsers = new Set();
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const browser of launchedBrowsers) {
      try {
        browser.process()?.kill("SIGKILL");
      } catch (_) {
        // Best effort only; the process is already exiting.
      }
    }
  });
}

/**
 * Launch Chromium with the unpacked extension loaded.
 *
 * Returns { browser, executablePath, close } where close() is idempotent so it is
 * safe to call from a `finally` block even if the browser was already closed.
 */
export async function launchExtensionBrowser({ headless = false, extensionsDir = EXTENSIONS_DIR } = {}) {
  const { default: puppeteer } = await import("puppeteer-core");
  const executablePath = resolveChromiumBin();
  const browser = await puppeteer.launch({
    executablePath,
    headless,
    args: getChromiumLaunchArgs(extensionsDir)
  });
  launchedBrowsers.add(browser);
  installExitHook();

  let closed = false;
  async function close() {
    if (closed) return; // guard double-close
    closed = true;
    launchedBrowsers.delete(browser);
    await browser.close().catch(() => {});
  }

  return { browser, executablePath, close };
}

/**
 * Wait for the extension's background service worker target.
 * Resolves to the target, or null if it never shows up within `timeoutMs`.
 * Pass urlIncludes: null to match any service worker (used by the agent suite).
 */
export async function waitForServiceWorker(
  browser,
  { timeoutMs = TIMEOUTS.SERVICE_WORKER_MS, urlIncludes = "background.js" } = {}
) {
  const target = await browser
    .waitForTarget(
      (t) => t.type() === "service_worker" && (urlIncludes ? t.url().includes(urlIncludes) : true),
      { timeout: timeoutMs }
    )
    .catch(() => null);
  return target;
}

/** Extract the extension id (2nd path segment of chrome-extension://<id>/...) from a target. */
export function extensionIdFromTarget(target) {
  return target ? target.url().split("/")[2] : null;
}
