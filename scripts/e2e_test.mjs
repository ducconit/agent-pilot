/**
 * Agent Pilot - End-to-End Automated Verification Test
 * Uses Node native WebSocket, HTTP server, and Chrome CDP under Xvfb
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 8765;
const CDP_PORT = 9222;
const PROJECT_DIR = path.resolve(__dirname, "..");
const EXT_DIR = path.join(PROJECT_DIR, "extentions");
const USER_DATA_DIR = "/tmp/agent-pilot-e2e-" + Date.now();

// Simple HTTP server to serve test-page.html
function startHttpServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(PROJECT_DIR, req.url === "/" ? "test-page.html" : req.url.split("?")[0]);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(PROJECT_DIR, "test-page.html");
      }
      const ext = path.extname(filePath);
      const contentTypes = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".svg": "image/svg+xml"
      };
      res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
      res.end(fs.readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`[HTTP] Local test server listening at http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

// Launch Google Chrome under xvfb
function launchChrome() {
  console.log(`[Chrome] Launching Chrome with unpacked extension: ${EXT_DIR}...`);
  const args = [
    ":99",
    "google-chrome",
    `--remote-debugging-port=${CDP_PORT}`,
    `--load-extension=${EXT_DIR}`,
    `--disable-extensions-except=${EXT_DIR}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-sync",
    "--window-size=1280,800",
    `http://127.0.0.1:${PORT}/test-page.html`
  ];

  const proc = spawn("xvfb-run", args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });

  proc.stderr.on("data", (d) => {
    const s = d.toString();
    if (s.includes("DevTools listening")) {
      console.log("[Chrome] DevTools endpoint initialized!");
    }
  });

  return proc;
}

// Wait for Chrome CDP port to become active
async function waitForCdp(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) {
        const json = await res.json();
        console.log(`[CDP] Connected to ${json.Browser}`);
        return json;
      }
    } catch (e) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw new Error("Timeout waiting for Chrome CDP port " + CDP_PORT);
}

// CDP Client Helper
class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(new Error(msg.error.message));
          else cb.resolve(msg.result);
        } else if (msg.method && this.eventListeners.has(msg.method)) {
          this.eventListeners.get(msg.method)(msg.params);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, handler) {
    this.eventListeners.set(event, handler);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// Test Runner
async function runTests() {
  console.log("===============================================================");
  console.log("🚀 BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG CHỨC NĂNG CỦA AGENT PILOT EXTENSION");
  console.log("===============================================================\n");

  const server = await startHttpServer();
  const chromeProc = launchChrome();

  const testResults = [];
  function record(name, passed, details = "") {
    testResults.push({ name, passed, details });
    const status = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status}: ${name} ${details ? `(${details})` : ""}`);
  }

  try {
    await waitForCdp();

    // Give extension and page a moment to initialize
    await new Promise((r) => setTimeout(r, 2500));

    // Get list of targets (pages + service workers)
    const targetsRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const targets = await targetsRes.json();

    console.log(`[CDP] Tìm thấy ${targets.length} targets.`);
    targets.forEach((t) => console.log(` - [${t.type}] ${t.title || t.url}`));

    // 1. Locate Extension Service Worker
    const swTarget = targets.find((t) => t.type === "service_worker" && t.url.includes("background.js"));
    const pageTarget = targets.find((t) => t.type === "page" && t.url.includes("test-page.html"));

    if (!swTarget) {
      record("Extension Service Worker Load", false, "Không tìm thấy background.js target");
    } else {
      record("Extension Service Worker Load", true, `Target ID: ${swTarget.id}`);
    }

    if (!pageTarget) {
      throw new Error("Không tìm thấy target test-page.html!");
    }

    // Connect to Page CDP
    console.log("\n--- KẾT NỐI VÀO TEST PAGE QUA CDP ---");
    const pageCdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await pageCdp.connect();
    await pageCdp.send("Page.enable");
    await pageCdp.send("Runtime.enable");
    await pageCdp.send("DOM.enable");

    // Connect to Extension Service Worker CDP
    let swCdp = null;
    if (swTarget) {
      swCdp = new CdpClient(swTarget.webSocketDebuggerUrl);
      await swCdp.connect();
      await swCdp.send("Runtime.enable");
    }

    // TEST 1: Check Content Script Injected
    const contentCheck = await pageCdp.send("Runtime.evaluate", {
      expression: `!!document.getElementById('agent-pilot-cursor-layer') && !!document.getElementById('agent-pilot-inspector-box')`,
      returnByValue: true
    });
    record("Content Script Injection & DOM Layer", contentCheck.result.value === true, "Cursor layer & Inspector overlay present in DOM");

    // TEST 2: Check Virtual Mouse Movement API
    const moveRes = await pageCdp.send("Runtime.evaluate", {
      expression: `
        (async () => {
          if (!window.__AGENT_PILOT__) return { success: false, reason: "No bridge" };
          const pos = await window.__AGENT_PILOT__.moveMouse(320, 240, 100);
          const badge = document.getElementById('agent-pilot-coords').textContent;
          return { success: true, pos, badge };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    const moveOk = moveRes.result.value && moveRes.result.value.success && moveRes.result.value.pos.x === 320;
    record("Virtual Mouse Movement & Coordinates", moveOk, `Pos: (${moveRes.result.value?.pos?.x}, ${moveRes.result.value?.pos?.y}), Badge: ${moveRes.result.value?.badge}`);

    // TEST 3: Check Virtual Mouse Click & Ripple
    const clickRes = await pageCdp.send("Runtime.evaluate", {
      expression: `
        (async () => {
          const btn = document.getElementById('btn-sample-click');
          const rect = btn.getBoundingClientRect();
          const targetX = rect.left + rect.width / 2;
          const targetY = rect.top + rect.height / 2;
          
          await window.__AGENT_PILOT__.click(targetX, targetY);
          const counterText = document.getElementById('click-counter-text').textContent;
          return { counterText };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    const clickOk = clickRes.result.value && clickRes.result.value.counterText.includes("1 lần");
    record("Virtual Click & DOM Event Dispatch", clickOk, clickRes.result.value?.counterText);

    // TEST 4: Check Virtual Typing into Input
    const typeRes = await pageCdp.send("Runtime.evaluate", {
      expression: `
        (async () => {
          await window.__AGENT_PILOT__.type('#test-search-input', 'Agent Pilot Automated E2E Test');
          const val = document.getElementById('test-search-input').value;
          const badge = document.getElementById('typing-result-badge').textContent;
          return { val, badge };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    const typeOk = typeRes.result.value && typeRes.result.value.val === "Agent Pilot Automated E2E Test";
    record("Virtual Typing (Human-like Input)", typeOk, `Value: "${typeRes.result.value?.val}"`);

    // TEST 5: Check Element Inspector (Selector, XPath, Bounding Rect)
    const inspectRes = await pageCdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const info = window.__AGENT_PILOT__.getElement('#inspector-special-box');
          return info;
        })()
      `,
      returnByValue: true
    });
    const inspectData = inspectRes.result.value;
    const inspectOk = inspectData && inspectData.tagName === "div" && inspectData.rect.width > 0 && inspectData.selector.includes("inspector-special-box");
    record("Element Inspector (Coordinates, BoundingBox, Selector, XPath)", inspectOk, `Selector: ${inspectData?.selector}, Dims: ${inspectData?.rect?.width}x${inspectData?.rect?.height}`);

    // TEST 6: Check Eyedropper / Color Picker Subsystem
    const colorCheck = await pageCdp.send("Runtime.evaluate", {
      expression: `typeof window.__AGENT_PILOT__.pickColor === "function"`,
      returnByValue: true
    });
    record("Color Eyedropper API Availability", colorCheck.result.value === true, "window.__AGENT_PILOT__.pickColor ready");

    // TEST 7: Check Background Service Worker CDP Debugger Attachment & Console Interception
    if (swCdp) {
      console.log("\n--- KIỂM THỬ BACKGROUND SERVICE WORKER & CDP INTERCEPTION ---");
      // Get tabId from chrome.tabs in service worker
      const tabIdRes = await swCdp.send("Runtime.evaluate", {
        expression: `
          new Promise((resolve) => {
            chrome.tabs.query({ url: "*://127.0.0.1/*" }, (tabs) => {
              resolve(tabs[0] ? tabs[0].id : null);
            });
          })
        `,
        awaitPromise: true,
        returnByValue: true
      });
      const activeTabId = tabIdRes.result.value;
      console.log(`[SW] Found tab ID: ${activeTabId}`);

      if (activeTabId) {
        // Attach debugger from background
        const attachRes = await swCdp.send("Runtime.evaluate", {
          expression: `attachDebugger(${activeTabId})`,
          awaitPromise: true,
          returnByValue: true
        });
        record("CDP chrome.debugger.attach", attachRes.result.value?.success === true, `Attached to Tab ${activeTabId}`);

        // Trigger console.log on page
        await pageCdp.send("Runtime.evaluate", {
          expression: `console.log("VERIFY_CONSOLE_CDP_MESSAGE_12345");`
        });
        await new Promise((r) => setTimeout(r, 600));

        // Check if background intercepted the console log
        const devtoolsData = await swCdp.send("Runtime.evaluate", {
          expression: `
            new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: "get_devtools_data", tabId: ${activeTabId} }, resolve);
            })
          `,
          awaitPromise: true,
          returnByValue: true
        });
        const hasLog = devtoolsData.result.value?.console?.some((e) => e.text.includes("VERIFY_CONSOLE_CDP_MESSAGE_12345"));
        record("CDP Console Log Interception", hasLog, `Found ${devtoolsData.result.value?.console?.length} logs`);

        // Trigger network request on page
        await pageCdp.send("Runtime.evaluate", {
          expression: `fetch('http://127.0.0.1:${PORT}/test-page.html').catch(() => {});`
        });
        await new Promise((r) => setTimeout(r, 600));

        // Check if background intercepted network request
        const devtoolsNetData = await swCdp.send("Runtime.evaluate", {
          expression: `
            new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: "get_devtools_data", tabId: ${activeTabId} }, resolve);
            })
          `,
          awaitPromise: true,
          returnByValue: true
        });
        const hasNet = devtoolsNetData.result.value?.network?.some((r) => r.url.includes("test-page.html"));
        record("CDP Network Request Interception", hasNet, `Intercepted ${devtoolsNetData.result.value?.network?.length} network requests`);

        // Test Performance metrics
        const perfData = await swCdp.send("Runtime.evaluate", {
          expression: `
            new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: "get_performance_metrics", tabId: ${activeTabId} }, resolve);
            })
          `,
          awaitPromise: true,
          returnByValue: true
        });
        const hasPerf = perfData.result.value?.success && perfData.result.value?.metrics?.JSHeapUsedSize > 0;
        record("CDP Performance Metrics (JS Heap, Nodes)", hasPerf, `JSHeapUsed: ${(perfData.result.value?.metrics?.JSHeapUsedSize / 1024 / 1024).toFixed(1)}MB, Nodes: ${perfData.result.value?.metrics?.Nodes}`);

        // TEST 8: Screenshot Capture
        const shotRes = await swCdp.send("Runtime.evaluate", {
          expression: `
            new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: "capture_screenshot", mode: "visible" }, resolve);
            })
          `,
          awaitPromise: true,
          returnByValue: true
        });
        const shotData = shotRes.result.value;
        const shotOk = shotData && shotData.success && shotData.dataUrl && shotData.dataUrl.startsWith("data:image/png;base64,");
        if (shotOk) {
          // Save screenshot to disk as tangible proof
          const base64Data = shotData.dataUrl.replace(/^data:image\/png;base64,/, "");
          const outPath = path.join(PROJECT_DIR, "assets", "test_verification_screenshot.png");
          fs.writeFileSync(outPath, Buffer.from(base64Data, "base64"));
          record("Screenshot Suite (Visible Tab Capture)", true, `Saved ${fs.statSync(outPath).size} bytes to assets/test_verification_screenshot.png`);
        } else {
          record("Screenshot Suite (Visible Tab Capture)", false, shotData?.error || "Failed");
        }
      }
    }

    pageCdp.close();
    if (swCdp) swCdp.close();

    console.log("\n===============================================================");
    console.log("📊 KẾT QUẢ TỔNG HỢP KIỂM THỬ:");
    const passedCount = testResults.filter((t) => t.passed).length;
    console.log(`TỔNG SỐ: ${testResults.length} KIỂM THỬ | THÀNH CÔNG: ${passedCount} | THẤT BẠI: ${testResults.length - passedCount}`);
    console.log("===============================================================");

    if (passedCount === testResults.length) {
      console.log("\n🎉 TẤT CẢ CÁC CHỨC NĂNG ĐÃ ĐƯỢC XÁC MINH HOẠT ĐỘNG HOÀN HẢO TRÊN GOOGLE CHROME THẬT!");
    } else {
      console.error("\n❌ Có kiểm thử thất bại!");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("\n[FATAL ERROR] Lỗi trong quá trình kiểm thử:", err);
    process.exitCode = 1;
  } finally {
    try {
      chromeProc.kill("SIGTERM");
      server.close();
      if (fs.existsSync(USER_DATA_DIR)) {
        fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
      }
    } catch (e) {}
  }
}

runTests();
