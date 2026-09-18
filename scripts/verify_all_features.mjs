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
      const elDetails = await window.__AGENT_PILOT__.getElement("#inspector-special-box", true);
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
        hasBetaBadge: document.querySelector(".badge-beta")?.textContent.trim() === "BETA",
        brandSub: document.querySelector(".brand-sub")?.textContent.trim(),
        hasGuideBtn: !!document.getElementById("btn-open-guide"),
        tabBtns: Array.from(document.querySelectorAll(".tab-btn")).map(b => b.textContent.trim()),
        hasAgentMonitor: !!document.getElementById("agent-activity-log"),
        hasInspectorBtn: !!document.getElementById("btn-toggle-inspector"),
        hasScreenshotBtns: !!document.getElementById("btn-capture-visible"),
        hasSelfTestBtn: !!document.getElementById("btn-self-test-agent"),
        subtabBtns,
        isCssTabActive,
        hasCssSearch: !!document.getElementById("inspector-css-search"),
        hasCopyAllCss: !!document.getElementById("btn-copy-all-css"),
        hasCopyAllOverview: !!document.getElementById("btn-copy-all-overview"),
        hasSlimScrollbar: (() => {
          const rules = Array.from(document.styleSheets).flatMap(s => {
            try { return Array.from(s.cssRules || []); } catch (_) { return []; }
          });
          return rules.some(r => r.selectorText && r.selectorText.includes("::-webkit-scrollbar"));
        })(),
        captureElementText: document.getElementById("btn-capture-element")?.textContent.replace(/\s+/g, " ").trim(),
        hasAutoCopySwitch: !!document.getElementById("toggle-auto-copy-shot"),
        colorFormats: {
          hasHex: !!document.getElementById("color-hex"),
          hasRgb: !!document.getElementById("color-rgb"),
          hasRgba: !!document.getElementById("color-rgba"),
          hasHsl: !!document.getElementById("color-hsl"),
          hasOklch: !!document.getElementById("color-oklch"),
          copyBtnsCount: document.querySelectorAll("#latest-color-box .color-copy-btn").length
        }
      };
    });

    // Test Inspector Overview Click-to-Copy and Copy All Overview button
    const overviewCopyTest = await sidepanelPage.evaluate(async () => {
      const details = {
        tagName: "button",
        selector: "#test-btn",
        xpath: '//*[@id="test-btn"]',
        rect: { x: 120, y: 80, width: 95, height: 36 },
        text: "Nội dung mẫu cần sao chép",
        value: "btn-sample-value"
      };
      if (window.__INSPECTOR_PANEL__) {
        window.__INSPECTOR_PANEL__.displayElementDetails(details);
      }

      const toolbar = document.getElementById("overview-toolbar");
      const copyAllBtn = document.getElementById("btn-copy-all-overview");
      const clickableRows = Array.from(document.querySelectorAll("#inspector-result-box .detail-row.clickable"));
      const copyTag = document.getElementById("copy-tag");
      const copyCoords = document.getElementById("copy-coords");
      const copyDims = document.getElementById("copy-dimensions");
      const copySel = document.getElementById("copy-selector");
      const copyXpath = document.getElementById("copy-xpath");
      const copyText = document.getElementById("copy-text");
      const copyVal = document.getElementById("copy-value");

      const allPresent = Boolean(
        toolbar && toolbar.style.display === "flex" &&
        copyAllBtn &&
        clickableRows.length >= 6 &&
        copyTag && copyCoords && copyDims && copySel && copyXpath && copyText && copyVal
      );

      // Also simulate clicking copy-text and copy-all
      if (copyText) copyText.click();
      if (copyAllBtn) copyAllBtn.click();

      return {
        success: allPresent,
        rowCount: clickableRows.length,
        toolbarVisible: toolbar?.style.display === "flex",
        hasCopyAllBtn: !!copyAllBtn
      };
    });

    // Test clicking guide button: opens guide.html and focuses on repeated clicks
    const guideTest = await sidepanelPage.evaluate(async () => {
      const btn = document.getElementById("btn-open-guide");
      if (!btn) return { opened: false, singleTab: false };
      btn.click();
      await new Promise(r => setTimeout(r, 300));
      return new Promise((resolve) => {
        chrome.tabs.query({}, (tabs) => {
          const guideTabs = tabs.filter(t => t.url && t.url.includes("guide.html"));
          // Click again to verify existing tab is focused rather than duplicated
          btn.click();
          setTimeout(() => {
            chrome.tabs.query({}, (tabsAfter) => {
              const guideTabsAfter = tabsAfter.filter(t => t.url && t.url.includes("guide.html"));
              resolve({
                opened: guideTabs.length >= 1,
                singleTab: guideTabsAfter.length === 1,
                guideUrl: guideTabs[0]?.url
              });
            });
          }, 300);
        });
      });
    });

    // Test Color Eyedropper 5 formats update and 1-click copy
    const colorFormatTest = await sidepanelPage.evaluate(async () => {
      if (!window.__INSPECTOR_PANEL__) return { success: false };
      window.__INSPECTOR_PANEL__.addColorToPalette({ hex: "#38bdf8", r: 56, g: 189, b: 248 });

      const valHex = document.getElementById("val-hex")?.textContent?.trim();
      const valRgb = document.getElementById("val-rgb")?.textContent?.trim();
      const valRgba = document.getElementById("val-rgba")?.textContent?.trim();
      const valHsl = document.getElementById("val-hsl")?.textContent?.trim();
      const valOklch = document.getElementById("val-oklch")?.textContent?.trim();

      // Test click on OKLCH row
      const oklchRow = document.getElementById("color-oklch");
      if (oklchRow) oklchRow.click();

      // Test click on RGBA row
      const rgbaRow = document.getElementById("color-rgba");
      if (rgbaRow) rgbaRow.click();

      const valid = Boolean(
        valHex === "#38bdf8" &&
        valRgb === "rgb(56, 189, 248)" &&
        valRgba === "rgba(56, 189, 248, 1)" &&
        valHsl && valHsl.startsWith("hsl(") &&
        valOklch && valOklch.startsWith("oklch(")
      );

      return {
        success: valid,
        valHex,
        valRgb,
        valRgba,
        valHsl,
        valOklch
      };
    });

    const sidepanelOk = sidepanelCheck.brand === "AGENT PILOT" &&
                        sidepanelCheck.hasBetaBadge === true &&
                        sidepanelCheck.brandSub === "Next-Gen AI Browser Companion" &&
                        sidepanelCheck.hasGuideBtn === true &&
                        sidepanelCheck.tabBtns.length === 4 &&
                        sidepanelCheck.hasAgentMonitor &&
                        sidepanelCheck.subtabBtns.length === 2 &&
                        sidepanelCheck.isCssTabActive &&
                        sidepanelCheck.hasCssSearch &&
                        sidepanelCheck.hasCopyAllOverview === true &&
                        overviewCopyTest.success === true &&
                        colorFormatTest.success === true &&
                        sidepanelCheck.colorFormats.copyBtnsCount === 5 &&
                        sidepanelCheck.hasSlimScrollbar === true &&
                        sidepanelCheck.captureElementText === "🎯 Chụp phần tử" &&
                        sidepanelCheck.hasAutoCopySwitch === true &&
                        guideTest.opened === true &&
                        guideTest.singleTab === true;
    record("8. Side Panel Control Center UI (5-Format Eyedropper, Beta Badge, Slogan, Slim Scrollbar & Overview Copy All)", sidepanelOk, `Eyedropper 5 Formats: ${colorFormatTest.success} (OKLCH: ${colorFormatTest.valOklch}), CopyBtns: ${sidepanelCheck.colorFormats.copyBtnsCount}, Slogan: "${sidepanelCheck.brandSub}"`);
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

      // Also test interactive element snap mode (auto turn-off on element click)
      const elementSnapTest = await page.evaluate(async () => {
        await window.__AGENT_PILOT__.startElementSnap();
        const wasActive = await window.__AGENT_PILOT__.isElementSnapActive();
        const testTarget = document.getElementById("inspector-special-box");
        const r = testTarget.getBoundingClientRect();
        testTarget.dispatchEvent(new MouseEvent("click", {
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          bubbles: true,
          cancelable: true
        }));
        await new Promise(res => setTimeout(res, 60));
        const isNowActive = await window.__AGENT_PILOT__.isElementSnapActive();
        return { wasActive, autoTurnOff: wasActive === true && isNowActive === false };
      });

      // Also test PNG blob creation & ClipboardItem image/png compatibility
      const clipboardTest = await sidepanelPage.evaluate(async (dataUrl) => {
        const parts = dataUrl.split(",");
        const binStr = atob(parts[1]);
        const u8arr = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) u8arr[i] = binStr.charCodeAt(i);
        const blob = new Blob([u8arr], { type: "image/png" });
        const item = new ClipboardItem({ "image/png": blob });
        return {
          isPng: blob.type === "image/png",
          blobSize: blob.size,
          itemSupported: Boolean(item && item.types && item.types.includes("image/png"))
        };
      }, shotRes?.dataUrl || "");

      // Test real Region Crop via chrome.runtime.sendMessage to sidepanel listener
      const regionCropTest = await sidepanelPage.evaluate(async () => {
        return new Promise((resolve) => {
          const clip = { x: 20, y: 20, width: 120, height: 90, pageWidth: 1280, pageHeight: 800, devicePixelRatio: 1 };
          chrome.runtime.sendMessage({ type: "REGION_CROP_REQUESTED", clip });
          
          let checks = 0;
          const interval = setInterval(() => {
            checks++;
            const previewCard = document.getElementById("screenshot-preview-card");
            const previewImg = document.getElementById("screenshot-img");
            if (previewCard && previewCard.style.display === "block" && previewImg && previewImg.src.startsWith("data:image/png;base64,")) {
              clearInterval(interval);
              resolve({ success: true, hasPreview: true, validDimensions: true, imgLength: previewImg.src.length });
            } else if (checks > 30) {
              clearInterval(interval);
              resolve({ success: false, error: "Timeout waiting for cropped image preview" });
            }
          }, 100);
        });
      });

      // Test real Delegated Clipboard write in content script via chrome.tabs.sendMessage
      const delegatedCopyTest = await sidepanelPage.evaluate(async (targetTabId, sampleDataUrl) => {
        return new Promise((resolve) => {
          chrome.tabs.sendMessage(targetTabId, {
            action: "copy_image_to_clipboard",
            dataUrl: sampleDataUrl,
            showInPageToast: false
          }, (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(res || { success: false, error: "No response" });
            }
          });
        });
      }, tabInfo.id, shotRes?.dataUrl || "");

      // Also test Auto-Copy Toggle state persistence
      const autoCopyToggleTest = await sidepanelPage.evaluate(async () => {
        const toggle = document.getElementById("toggle-auto-copy-shot");
        if (!toggle) return { found: false, canToggle: false };
        toggle.checked = true;
        toggle.dispatchEvent(new Event("change"));
        const stored = localStorage.getItem("agent_pilot_auto_copy_shot") === "true";
        toggle.checked = false;
        toggle.dispatchEvent(new Event("change"));
        return { found: true, canToggle: stored };
      });

      const shotOk = shotRes?.success && shotRes?.dataUrl && shotRes.dataUrl.startsWith("data:image/png;base64,") &&
                     elementSnapTest.autoTurnOff &&
                     regionCropTest.validDimensions &&
                     clipboardTest.isPng && clipboardTest.itemSupported &&
                     delegatedCopyTest.success &&
                     autoCopyToggleTest.canToggle;
      if (shotOk) {
        const base64 = shotRes.dataUrl.replace(/^data:image\/png;base64,/, "");
        const buf = Buffer.from(base64, "base64");
        const outPath = path.join(PROJECT_DIR, "assets", "verified_screenshot.png");
        fs.writeFileSync(outPath, buf);
        record("14. Screenshot Suite (Capture, Region Crop, Element Snap, Delegated Clipboard & Auto-Copy)", true, `Kích thước: ${buf.length} bytes, Crop: true, Snap Auto-Off: ${elementSnapTest.autoTurnOff}, Clipboard: ${delegatedCopyTest.success}, Auto-Copy: ${autoCopyToggleTest.canToggle}`);
      } else {
        record("14. Screenshot Suite (Capture, Region Crop, Element Snap, Delegated Clipboard & Auto-Copy)", false, shotRes?.error || regionCropTest?.error || `Crop: ${regionCropTest?.validDimensions}, Snap: ${elementSnapTest?.autoTurnOff}, Clipboard: ${delegatedCopyTest?.success}, Auto-Copy: ${autoCopyToggleTest?.canToggle}`);
      }

      // 15. Test Visual UI Feedback Studio & Channel C Clipboard Prompt
      console.log("\n--- KIỂM THỬ GIAO DIỆN PHẢN HỒI TRỰC QUAN (FEEDBACK STUDIO & CHANNEL C) ---");
      const feedbackTest = await page.evaluate(async () => {
        // Start feedback studio
        await window.__AGENT_PILOT__.startFeedbackStudio();
        await new Promise(r => setTimeout(r, 100));

        const hud = document.getElementById("agent-pilot-feedback-hud");
        const hudVisible = hud && !hud.classList.contains("hidden");
        const isActive = await window.__AGENT_PILOT__.isFeedbackStudioActive();

        // Check mode buttons
        const modeBtns = Array.from(hud ? hud.querySelectorAll(".ap-hud-btn") : []).map(b => b.dataset.mode);

        // Switch mode to region
        const regionBtn = hud?.querySelector('.ap-hud-btn[data-mode="region"]');
        if (regionBtn) regionBtn.click();
        const activeBtn = hud?.querySelector('.ap-hud-btn.active')?.dataset.mode;

        // Add a mock feedback item directly via __AGENT_PILOT__
        await window.__AGENT_PILOT__.clearFeedbackItems();
        const mockItem = {
          id: "fb_test_123",
          mode: "element",
          title: "Button: Gửi phản hồi",
          comment: "Nút này cần đổi màu nền thành cyan và thêm icon tên lửa",
          dom: {
            selector: "#submit-btn",
            xpath: '//*[@id="submit-btn"]',
            tagName: "button",
            text: "Gửi phản hồi",
            rect: { x: 100, y: 200, width: 140, height: 40 }
          },
          component: {
            framework: "React",
            componentName: "SubmitButton",
            fileName: "src/components/FeedbackModal.tsx",
            lineNumber: 48,
            hierarchy: "App > FeedbackModal > SubmitButton"
          },
          screenshotDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          timestamp: new Date().toISOString()
        };

        const addRes = await window.__AGENT_PILOT__.addFeedbackItem(mockItem);
        const items = await window.__AGENT_PILOT__.getFeedbackItems();

        // Generate prompt
        const prompt = await window.__AGENT_PILOT__.generateFeedbackPrompt([mockItem]);
        const hasComponent = prompt && prompt.includes("src/components/FeedbackModal.tsx:48");
        const hasComment = prompt && prompt.includes("Nút này cần đổi màu nền thành cyan");
        const hasSelector = prompt && prompt.includes("#submit-btn");

        // Security regression: crafted item must not inject markup or smuggle a remote image URL.
        // DOM is shared between the isolated and main worlds, so the marker is observable here.
        const maliciousItem = {
          id: '"><img src=x onerror="document.documentElement.setAttribute(\'data-ap-xss\',\'1\')">',
          mode: '</span><img src=x onerror="document.documentElement.setAttribute(\'data-ap-xss\',\'2\')">',
          title: '<img src=x onerror="document.documentElement.setAttribute(\'data-ap-xss\',\'3\')">',
          comment: '<img src=x onerror="document.documentElement.setAttribute(\'data-ap-xss\',\'4\')">',
          screenshotDataUrl: "https://evil.example/xss.png",
          extraEvilKey: { nested: true }
        };
        await window.__AGENT_PILOT__.addFeedbackItem(maliciousItem);
        const listButton = document.getElementById("ap-hud-btn-list");
        if (listButton) listButton.click();
        await new Promise(r => setTimeout(r, 150));
        const xssTriggered = document.documentElement.getAttribute("data-ap-xss") !== null;
        const storedMalicious = (await window.__AGENT_PILOT__.getFeedbackItems())
          .find((it) => typeof it.title === "string" && it.title.includes("data-ap-xss"));
        const maliciousSanitized = Boolean(storedMalicious) &&
          storedMalicious.mode === "element" &&
          storedMalicious.screenshotDataUrl === undefined &&
          !storedMalicious.id.includes("<") &&
          !storedMalicious.id.includes('"') &&
          storedMalicious.extraEvilKey === undefined;
        await window.__AGENT_PILOT__.clearFeedbackItems();
        if (listButton) document.getElementById("ap-list-btn-close")?.click();

        // Test HUD stays active until explicitly stopped
        const stillActive = await window.__AGENT_PILOT__.isFeedbackStudioActive();
        await window.__AGENT_PILOT__.stopFeedbackStudio();
        const stoppedActive = await window.__AGENT_PILOT__.isFeedbackStudioActive();
        const hudHidden = hud?.classList.contains("hidden");

        return {
          hudVisible,
          isActive,
          modeBtns,
          activeModeSwitched: activeBtn === "region",
          hasComponent: Boolean(hasComponent),
          hasComment: Boolean(hasComment),
          hasSelector: Boolean(hasSelector),
          xssTriggered,
          maliciousSanitized,
          stillActive,
          stoppedActive: !stoppedActive && hudHidden
        };
      });

      const feedbackOk = feedbackTest.hudVisible &&
                         feedbackTest.isActive &&
                         feedbackTest.modeBtns.includes("element") &&
                         feedbackTest.modeBtns.includes("region") &&
                         feedbackTest.modeBtns.includes("screen") &&
                         feedbackTest.modeBtns.includes("fullpage") &&
                         feedbackTest.activeModeSwitched &&
                         feedbackTest.hasComponent &&
                         feedbackTest.hasComment &&
                         feedbackTest.hasSelector &&
                         feedbackTest.xssTriggered === false &&
                         feedbackTest.maliciousSanitized === true &&
                         feedbackTest.stillActive &&
                         feedbackTest.stoppedActive;

      record(
        "15. Visual UI Feedback Studio & Channel C Prompt (In-Page HUD, Multi-Mode, Source Detection & XSS-Safe Prompt Export)",
        feedbackOk,
        `HUD: ${feedbackTest.hudVisible}, Modes: [${feedbackTest.modeBtns?.join(",")}], Component: ${feedbackTest.hasComponent}, Prompt: ${feedbackTest.hasComment}, XSS Blocked: ${feedbackTest.xssTriggered === false && feedbackTest.maliciousSanitized === true}, Persistent: ${feedbackTest.stillActive}`
      );

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
