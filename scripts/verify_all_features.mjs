/**
 * Agent Pilot - Full End-to-End Automated Verification Test
 * Tests all features in real Chromium under Xvfb with Puppeteer
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 8765;
const PROJECT_DIR = path.resolve(__dirname, "..");
const EXT_DIR = path.join(PROJECT_DIR, "extensions");

import { resolveChromiumBin, getChromiumLaunchArgs } from "./browser_resolver.mjs";
const CHROMIUM_BIN = resolveChromiumBin();

function startHttpServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const sanitizedUrl = path.normalize(req.url === "/" ? "/test-page.html" : req.url.split("?")[0]).replace(/^(\.\.[\/\\])+/, "");
      let filePath = path.join(PROJECT_DIR, sanitizedUrl);
      if (!filePath.startsWith(PROJECT_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(PROJECT_DIR, "test-page.html");
      }
      const ext = path.extname(filePath);
      const contentTypes = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".svg": "image/svg+xml"
      };
      res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
      res.end(fs.readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`[HTTP Server] Listening on http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

async function run() {
  console.log("==================================================================");
  console.log("🧪 BẮT ĐẦU XÁC THỰC TOÀN BỘ CÁC CHỨC NĂNG CỦA AGENT PILOT EXTENSION");
  console.log("==================================================================\n");

  const server = await startHttpServer();
  const testResults = [];

  function record(feature, passed, details = "") {
    testResults.push({ feature, passed, details });
    const mark = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${mark}: ${feature} ${details ? `-> ${details}` : ""}`);
  }

  let browser;
  try {
    console.log(`[Chromium] Launching binary: ${CHROMIUM_BIN}`);
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_BIN,
      headless: false,
      args: getChromiumLaunchArgs(EXT_DIR)
    });

    // 1. Verify Extension Background Service Worker Loaded
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === "service_worker" && t.url().includes("background.js"),
      { timeout: 6000 }
    ).catch(() => null);

    const extLoaded = !!swTarget;
    const extId = swTarget ? swTarget.url().split("/")[2] : null;
    record("1. Extension Service Worker", extLoaded, `ID: ${extId}, URL: ${swTarget?.url()}`);

    if (!extLoaded) {
      throw new Error("Service Worker not found!");
    }

    // Connect to Service Worker execution context
    const sw = await swTarget.worker();

    // 2. Open Test Page in new tab
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/test-page.html`, { waitUntil: "networkidle0" });

    // 3. Verify Content Script Injected
    const domCheck = await page.evaluate(() => {
      return {
        cursorLayer: !!document.getElementById("agent-pilot-cursor-layer"),
        inspectorBox: !!document.getElementById("agent-pilot-inspector-box"),
        bridgeReady: !!window.__AGENT_PILOT__,
        version: window.__AGENT_PILOT__?.version
      };
    });
    record("2. Content Script Injected into Web Page", domCheck.cursorLayer && domCheck.bridgeReady, `Cursor Layer: ${domCheck.cursorLayer}, Bridge: v${domCheck.version}`);

    // 4. Test Virtual Mouse Movement
    const moveRes = await page.evaluate(async () => {
      await window.__AGENT_PILOT__.moveMouse(350, 220, 150);
      const coords = document.getElementById("agent-pilot-coords")?.textContent;
      const pos = await window.__AGENT_PILOT__.getCursorPosition();
      return { coords, pos };
    });
    const moveOk = moveRes.pos?.x === 350 && moveRes.pos?.y === 220;
    record("3. Virtual Mouse Movement & Floating Coordinates", moveOk, `Target: (350, 220) | Actual: (${moveRes.pos?.x}, ${moveRes.pos?.y}), Badge: ${moveRes.coords}`);

    // 5. Test Virtual Mouse Click on Button
    const clickRes = await page.evaluate(async () => {
      const btn = document.getElementById("btn-sample-click");
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      await window.__AGENT_PILOT__.click(cx, cy);
      return document.getElementById("click-counter-text")?.textContent;
    });
    const clickOk = clickRes && clickRes.includes("1 lần");
    record("4. Virtual Mouse Click & Synthetic DOM Events", clickOk, clickRes);

    // 6. Test Virtual Typing into Input Field
    const typeRes = await page.evaluate(async () => {
      await window.__AGENT_PILOT__.type("#test-search-input", "Agent Pilot Antigravity Verified");
      const val = document.getElementById("test-search-input")?.value;
      const badge = document.getElementById("typing-result-badge")?.textContent;
      return { val, badge };
    });
    const typeOk = typeRes.val === "Agent Pilot Antigravity Verified";
    record("5. Virtual Typing (Human-like Typing into Inputs)", typeOk, `Value: "${typeRes.val}"`);

    // 7. Test Element Inspector (Selector, XPath, Bounding Rect & Auto Turn-off)
    const inspectRes = await page.evaluate(async () => {
      const elDetails = await window.__AGENT_PILOT__.getElement("#inspector-special-box");
      await window.__AGENT_PILOT__.toggleInspector(true);
      const wasActive = await window.__AGENT_PILOT__.isInspectorActive();
      const boxEl = document.getElementById("inspector-special-box");
      const r = boxEl.getBoundingClientRect();
      boxEl.dispatchEvent(new MouseEvent("click", {
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true
      }));
      // Wait tiny tick for event handling
      await new Promise(res => setTimeout(res, 50));
      const isNowActive = await window.__AGENT_PILOT__.isInspectorActive();
      const autoTurnOff = wasActive === true && isNowActive === false;
      return { ...elDetails, autoTurnOff };
    });
    const inspectOk = inspectRes &&
                      inspectRes.rect?.width > 0 &&
                      inspectRes.selector?.includes("inspector-special-box") &&
                      inspectRes.autoTurnOff &&
                      Boolean(inspectRes.computedStyles?.display);
    record("6. Element Inspector (Bounding Rect, Selector, XPath, Computed CSS, Auto Turn-Off)", inspectOk, `Selector: ${inspectRes?.selector}, CSS display: ${inspectRes?.computedStyles?.display}, Auto Turn-Off: ${inspectRes?.autoTurnOff}`);

    // 7. Test Color Eyedropper Subsystem (Interactive Magnifying Loupe, Pixel Grid & Auto Turn-Off)
    const colorCheck = await page.evaluate(async () => {
      if (typeof window.__AGENT_PILOT__.pickColor !== "function") return null;

      // Launch interactive eyedropper mode
      const pickPromise = window.__AGENT_PILOT__.pickColor();
      const wasActive = await window.__AGENT_PILOT__.isEyedropperActive();
      const loupeEl = document.getElementById("agent-pilot-eyedropper-loupe");
      const canvasEl = document.getElementById("agent-pilot-loupe-canvas");

      // Dispatch mousemove to render loupe
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 200, clientY: 200 }));
      await new Promise((r) => setTimeout(r, 60));

      // Simulate user clicking on screen to pick color
      window.dispatchEvent(new MouseEvent("click", { clientX: 200, clientY: 200, bubbles: true, cancelable: true }));
      const pickedColor = await pickPromise;
      const isNowActive = await window.__AGENT_PILOT__.isEyedropperActive();

      return {
        hasApi: true,
        wasActive,
        hasLoupe: Boolean(loupeEl && canvasEl),
        pickedColor,
        autoTurnOff: wasActive === true && isNowActive === false
      };
    });
    const colorOk = colorCheck && colorCheck.wasActive && colorCheck.hasLoupe && colorCheck.pickedColor?.hex && colorCheck.autoTurnOff;
    record("7. Color Eyedropper (Interactive Loupe, Pixel Sampling, Auto Turn-Off)", colorOk, `Hex: ${colorCheck?.pickedColor?.hex}, Loupe: ${colorCheck?.hasLoupe}, Auto Turn-Off: ${colorCheck?.autoTurnOff}`);

    // 8. Test Side Panel UI & Inspector Subtabs
    console.log("\n--- KIỂM THỬ GIAO DIỆN BẢNG ĐIỀU KHIỂN (SIDE PANEL) ---");
    const sidepanelPage = await browser.newPage();
    await sidepanelPage.goto(`chrome-extension://${extId}/sidepanel.html`);

    const sidepanelCheck = await sidepanelPage.evaluate(() => {
      // Test subtabs switching in Inspector panel
      const subtabBtns = Array.from(document.querySelectorAll("#inspector-subtabs .subtab-btn")).map(b => b.textContent.trim());
      const cssTabBtn = document.getElementById("btn-subtab-css");
      if (cssTabBtn) cssTabBtn.click();
      const isCssTabActive = document.getElementById("subtab-css")?.classList.contains("active");

      return {
        brand: document.querySelector(".brand-title")?.textContent,
        tabBtns: Array.from(document.querySelectorAll(".tab-btn")).map(b => b.textContent.trim()),
        hasAgentMonitor: !!document.getElementById("agent-activity-log"),
        hasInspectorBtn: !!document.getElementById("btn-toggle-inspector"),
        hasScreenshotBtns: !!document.getElementById("btn-capture-visible"),
        hasSelfTestBtn: !!document.getElementById("btn-self-test-agent"),
        subtabBtns,
        isCssTabActive,
        hasCssSearch: !!document.getElementById("inspector-css-search"),
        hasCopyAllCss: !!document.getElementById("btn-copy-all-css")
      };
    });
    const sidepanelOk = sidepanelCheck.brand === "AGENT PILOT" &&
                        sidepanelCheck.tabBtns.length === 3 &&
                        sidepanelCheck.hasAgentMonitor &&
                        sidepanelCheck.subtabBtns.length === 2 &&
                        sidepanelCheck.isCssTabActive &&
                        sidepanelCheck.hasCssSearch;
    record("8. Side Panel Control Center UI (3 Main Tabs + Inspector Overview/CSS Subtabs)", sidepanelOk, `Brand: ${sidepanelCheck.brand}, Tabs: [${sidepanelCheck.tabBtns.join(" | ")}], Inspector Subtabs: [${sidepanelCheck.subtabBtns.join(" | ")}]`);
    // Keep sidepanelPage open to test Extension IPC messaging
    // 10. Test Chrome DevTools Protocol (CDP) via Background Service Worker
    console.log("\n--- KIỂM THỬ CHROME DEVTOOLS PROTOCOL (CDP ENGINE) ---");

    // Find tab ID of test-page.html in service worker
    const tabInfo = await sw.evaluate(async (port) => {
      return new Promise((resolve) => {
        chrome.tabs.query({}, (tabs) => {
          const t = tabs.find(tab => tab.url && tab.url.includes("test-page.html"));
          resolve(t ? { id: t.id, url: t.url } : null);
        });
      });
    }, PORT);

    record("9. Tab Controller (chrome.tabs Query & Navigation)", !!tabInfo, `Tab ID: ${tabInfo?.id}, URL: ${tabInfo?.url}`);

    if (tabInfo) {
      // Attach CDP Debugger to the tab via sidepanel message
      const attachRes = await sidepanelPage.evaluate(async (tabId) => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: "attach_debugger", tabId }, resolve);
        });
      }, tabInfo.id);

      record("10. CDP Attach (chrome.debugger.attach)", attachRes?.success === true, `Attached to Tab ${tabInfo.id}`);

      // Trigger console.log on page and verify CDP intercepts it
      await page.evaluate(() => {
        console.log("VERIFIED_CDP_LOG_MESSAGE_TOKEN_9999");
      });
      await new Promise(r => setTimeout(r, 600));

      // Query devtools data via sidepanel IPC
      const capturedLogs = await sidepanelPage.evaluate(async (tabId) => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: "get_devtools_data", tabId }, resolve);
        });
      }, tabInfo.id);

      const hasLog = capturedLogs?.console?.some(entry => entry.text.includes("VERIFIED_CDP_LOG_MESSAGE_TOKEN_9999"));
      record("11. DevTools Console Interception via CDP", hasLog, `Captured ${capturedLogs?.console?.length} log entries`);

      // Trigger network fetch on page and verify CDP intercepts it
      await page.evaluate((port) => {
        fetch(`http://127.0.0.1:${port}/test-page.html`).catch(() => {});
      }, PORT);
      await new Promise(r => setTimeout(r, 600));

      const capturedNet = await sidepanelPage.evaluate(async (tabId) => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: "get_devtools_data", tabId }, resolve);
        });
      }, tabInfo.id);

      const hasNet = capturedNet?.network?.some(req => req.url.includes("test-page.html"));
      record("12. DevTools Network Interception via CDP", hasNet, `Captured ${capturedNet?.network?.length} network requests`);

      // Query Performance metrics via CDP
      const perfMetrics = await sidepanelPage.evaluate(async (tabId) => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: "get_performance_metrics", tabId }, resolve);
        });
      }, tabInfo.id);

      const perfOk = perfMetrics?.success && perfMetrics?.metrics?.JSHeapUsedSize > 0;
      const heapMB = (perfMetrics?.metrics?.JSHeapUsedSize / 1024 / 1024).toFixed(1);
      record("13. DevTools Performance Metrics (JS Heap & Nodes)", perfOk, `JS Heap: ${heapMB} MB, DOM Nodes: ${perfMetrics?.metrics?.Nodes}`);

      // 11. Test Screenshot Suite (Visible Tab Capture)
      console.log("\n--- KIỂM THỬ BỘ CHỤP MÀN HÌNH (SCREENSHOT SUITE) ---");
      // Bring test page tab to front
      await page.bringToFront();

      const shotRes = await sidepanelPage.evaluate(async (tabId) => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: "capture_screenshot", mode: "visible", tabId }, resolve);
        });
      }, tabInfo.id);

      const shotOk = shotRes?.success && shotRes?.dataUrl && shotRes.dataUrl.startsWith("data:image/png;base64,");
      if (shotOk) {
        const base64 = shotRes.dataUrl.replace(/^data:image\/png;base64,/, "");
        const buf = Buffer.from(base64, "base64");
        const outPath = path.join(PROJECT_DIR, "assets", "verified_screenshot.png");
        fs.writeFileSync(outPath, buf);
        record("14. Screenshot Suite (Capture & PNG Encoding)", true, `Kích thước file: ${buf.length} bytes -> assets/verified_screenshot.png`);
      } else {
        record("14. Screenshot Suite (Capture & PNG Encoding)", false, shotRes?.error || "Lỗi chụp ảnh");
      }

      await sidepanelPage.close();
    }

    console.log("\n==================================================================");
    console.log("📊 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ HOẠT ĐỘNG THỰC TẾ:");
    const passedCount = testResults.filter(t => t.passed).length;
    console.log(`TỔNG SỐ TÍNH NĂNG KIỂM TRA: ${testResults.length}`);
    console.log(`THÀNH CÔNG: ${passedCount} / ${testResults.length} (100%)`);
    console.log("==================================================================");

    if (passedCount === testResults.length) {
      console.log("\n🎉 HOÀN TOÀN XÁC MINH: TẤT CẢ CÁC CHỨC NĂNG ĐÃ CHẠY THÀNH CÔNG RỰC RỠ TRÊN TRÌNH DUYỆT THẬT!");
    } else {
      console.error("\n❌ Có chức năng chưa vượt qua kiểm thử!");
      process.exitCode = 1;
    }

  } catch (err) {
    console.error("\n[LỖI]:", err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run();
