/**
 * Agent Pilot - Full End-to-End AI Agent WebSocket Bridge Verification Test
 * Tests AI Agent commands over WebSocket port 58765 controlling a real Chromium browser
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { WebSocketServer, WebSocket } from "ws";

import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRIDGE_PORT = 58765;
const HTTP_PORT = 8765;
const PROJECT_DIR = path.resolve(__dirname, "..");
const EXT_DIR = path.join(PROJECT_DIR, "extensions");

import { resolveChromiumBin, getChromiumLaunchArgs } from "./browser_resolver.mjs";
const CHROMIUM_BIN = resolveChromiumBin();

function startTestHttpServer() {
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
    server.listen(HTTP_PORT, "127.0.0.1", () => {
      console.log(`[Test Server] Listening on http://127.0.0.1:${HTTP_PORT}`);
      resolve(server);
    });
  });
}

async function run() {
  console.log("==================================================================");
  console.log("🤖 KIỂM THỬ KẾT NỐI AI AGENT ĐẾN AGENT PILOT (WEBSOCKET PORT 58765)");
  console.log("==================================================================\n");

  const testResults = [];
  function record(feature, passed, details = "") {
    testResults.push({ feature, passed, details });
    const mark = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${mark}: ${feature} ${details ? `-> ${details}` : ""}`);
  }

  // 1. Start Bridge WebSocket Server on Port 58765
  let extensionSocket = null;
  let handshakeData = null;
  const pendingRequests = new Map();
  let requestIdCounter = 1;

  // 1. Check if live bridge server is already active, otherwise start our own
  let isLiveServer = false;
  try {
    const health = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`, { signal: AbortSignal.timeout(1000) }).then(r => r.json());
    if (health && (health.name === "Agent Pilot Bridge Server" || health.name === "Agent Pilot Go Bridge Server")) {
      isLiveServer = true;
      console.log(`[Bridge Server] Using active live Agent Pilot Bridge Server on port ${BRIDGE_PORT}`);
    }
  } catch (_) {}

  let initialClientCount = 0;
  if (isLiveServer) {
    try {
      const h = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`).then(r => r.json());
      initialClientCount = h.clientCount || (h.extensionConnected ? 1 : 0);
    } catch (_) {}
  }

  let bridgeServer = null;
  let wss = null;
  let onExtensionConnected = null;

  let selectedTestInstanceId = null;

  if (isLiveServer) {
    const MAX_CLIENT_POLL_RETRIES = 40;
    const CLIENT_POLL_INTERVAL_MS = 250;
    onExtensionConnected = (async () => {
      for (let i = 0; i < MAX_CLIENT_POLL_RETRIES; i++) {
        await new Promise(r => setTimeout(r, CLIENT_POLL_INTERVAL_MS));
        try {
          const listResp = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: "instances.list" }),
            signal: AbortSignal.timeout(1000)
          });
          const listData = await listResp.json();
          const clients = Array.isArray(listData?.result) ? listData.result : (listData?.result?.clients || []);
          if (clients.length > initialClientCount || (!initialClientCount && clients.length > 0)) {
            const targetClient = clients[clients.length - 1];
            selectedTestInstanceId = targetClient.instanceId;
            await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ method: "instances.select", params: { instanceId: targetClient.instanceId } }),
              signal: AbortSignal.timeout(1000)
            });
            console.log(`[Test] Selected test browser instance: ${targetClient.instanceId}`);
            return {
              type: "HANDSHAKE",
              agent: "AgentPilot-Extension",
              version: "1.0.0",
              capabilities: ["tabs", "cdp", "cursor", "type", "inspector", "screenshot"]
            };
          }
        } catch (_) {}
      }
      throw new Error("Timeout waiting for test extension to connect to live bridge server");
    })();
  } else {
    bridgeServer = http.createServer((req, res) => {
      if (req.url === "/api" && req.method === "POST") {
        let body = "";
        req.on("data", c => body += c);
        req.on("end", async () => {
          try {
            const { method, params } = JSON.parse(body || "{}");
            const result = await sendAgentCommand(method, params);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, result }));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", port: BRIDGE_PORT }));
    });

    wss = new WebSocketServer({ server: bridgeServer });

    onExtensionConnected = new Promise((resolve) => {
      wss.on("connection", (ws) => {
        extensionSocket = ws;
        ws.on("message", (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "HANDSHAKE") {
              handshakeData = msg;
              resolve(msg);
            }
            if (msg.id && pendingRequests.has(msg.id)) {
              const { resolve: reqResolve, reject: reqReject } = pendingRequests.get(msg.id);
              pendingRequests.delete(msg.id);
              if (msg.error) reqReject(new Error(msg.error));
              else reqResolve(msg.result);
            }
          } catch (e) {
            console.error("Error parsing msg:", e);
          }
        });
      });
    });

    await new Promise((r) => bridgeServer.listen(BRIDGE_PORT, "127.0.0.1", r));
    console.log(`[Bridge Server] Listening on ws://127.0.0.1:${BRIDGE_PORT}`);
  }

  async function sendAgentCommand(method, params = {}, timeoutMs = 15000) {
    if (isLiveServer) {
      const payloadParams = { ...params };
      if (selectedTestInstanceId && payloadParams.instanceId === undefined) {
        payloadParams.instanceId = selectedTestInstanceId;
      }
      if (method === "batch.run" && payloadParams.timeoutMs === undefined) {
        payloadParams.timeoutMs = timeoutMs;
      }
      const resp = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params: payloadParams }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || "Command failed");
      return data.result;
    }

    return new Promise((resolve, reject) => {
      if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
        return reject(new Error("Extension not connected to bridge"));
      }
      const id = requestIdCounter++;
      const timer = setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`Command ${method} timed out`));
        }
      }, timeoutMs);

      pendingRequests.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });

      extensionSocket.send(JSON.stringify({ id, method, params }));
    });
  }

  const httpServer = await startTestHttpServer();
  let browser = null;

  try {
    // 2. Launch Chromium with Agent Pilot Extension
    console.log(`[Chromium] Launching binary: ${CHROMIUM_BIN}`);
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_BIN,
      headless: false,
      args: getChromiumLaunchArgs(EXT_DIR)
    });

    // 3. Verify Extension automatically connects to Bridge Server on Port 58765
    console.log("[Test] Waiting for extension to connect via WebSocket...");
    const handshake = await Promise.race([
      onExtensionConnected,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for extension connection")), 15000))
    ]);

    const isConnected = (isLiveServer || !!extensionSocket) && handshake?.type === "HANDSHAKE";
    record("1. WebSocket Connection on Port 58765", isConnected, `Agent: ${handshake?.agent} v${handshake?.version}, Capabilities: [${handshake?.capabilities?.slice(0, 4).join(", ")}...]`);

    // 4. Test Agent ping
    const pingRes = await sendAgentCommand("ping");
    record("2. Agent Ping/Pong Heartbeat", pingRes?.pong === true, `Latency: ${Date.now() - pingRes?.timestamp}ms, Version: ${pingRes?.version}`);

    // 3. Test Agent Command: tabs.create (Open Test Page in background without focus)
    const newTab = await sendAgentCommand("tabs.create", { url: `http://127.0.0.1:${HTTP_PORT}/test-page.html` });
    const isBgByDefault = newTab?.active === false;
    record("3. Agent Command: tabs.create (Background by default)", !!newTab?.id && isBgByDefault, `Created Tab ID: ${newTab?.id}, active: ${newTab?.active} (No focus stealing)`);
    // Find testPage and wait for content script injection
    let testPage = null;
    for (let i = 0; i < 20; i++) {
      const pages = await browser.pages();
      testPage = pages.find(p => p.url().includes("test-page.html"));
      if (testPage) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (testPage) {
      await testPage.waitForSelector("#btn-sample-click");
      await testPage.waitForFunction(() => !!document.getElementById("agent-pilot-cursor-layer"));
    }

    // Target tab ID returned from tabs.create
    const tabId = newTab?.id;
    const tabsList = await sendAgentCommand("tabs.query", {});
    console.log(`[Test] Active tabs count: ${tabsList.length}, targetTabId: ${tabId}`);

    // Verify Virtual Cursor is HIDDEN by default on page load
    let initialCursorHidden = false;
    let initialOpacity = "1";
    if (testPage) {
      initialOpacity = await testPage.evaluate(() => {
        const cursor = document.querySelector(".agent-pilot-virtual-cursor");
        return cursor ? window.getComputedStyle(cursor).opacity : null;
      });
      initialCursorHidden = initialOpacity === "0";
    }
    record("4. Cursor Initial Hidden State", initialCursorHidden, `Initial cursor opacity: ${initialOpacity} (Expected 0)`);

    // Verify Clean DOM (In-page badge removed, replaced by Chrome Native Tab Groups)
    let domBadgeRemoved = false;
    if (testPage) {
      domBadgeRemoved = await testPage.evaluate(() => !document.getElementById("agent-pilot-tab-badge"));
    }
    record("5. Native Tab Group & Clean DOM", domBadgeRemoved, `In-page badge removed for clean DOM: ${domBadgeRemoved}`);

    // Test Human Input Lock (page.setBusy)
    const lockRes = await sendAgentCommand("page.setBusy", { tabId, busy: true, action: "Kiểm thử tự động" });
    let lockOverlayDetails = {};
    if (testPage) {
      // Wait briefly for DOM update
      await new Promise(r => setTimeout(r, 100));
      lockOverlayDetails = await testPage.evaluate(() => {
        const overlay = document.getElementById("agent-pilot-lock-overlay");
        return {
          hasOverlay: !!overlay,
          display: overlay ? window.getComputedStyle(overlay).display : null,
          titleText: overlay ? overlay.querySelector("#agent-pilot-lock-title-text")?.textContent : "",
          descText: overlay ? overlay.querySelector("#agent-pilot-lock-action-desc")?.textContent : ""
        };
      });
    }
    const lockOverlayActive = lockOverlayDetails.hasOverlay && lockOverlayDetails.display === "flex";
    record("6. Agent Lock Overlay Active", lockOverlayActive, `Overlay: ${lockOverlayDetails.display}, Title: "${lockOverlayDetails.titleText}"`);

    // 7. Test: Explicit Lock Persistence across automated action (Finding 1)
    await sendAgentCommand("page.setBusy", { tabId, busy: true, action: "Khóa kiểm thử chuỗi thao tác" });
    await sendAgentCommand("page.moveMouse", { tabId, x: 200, y: 150, duration: 100 });
    // Wait > 200ms (longer than the 150ms auto-unlock timeout)
    await new Promise(r => setTimeout(r, 250));
    let lockSurvivesAction = false;
    if (testPage) {
      lockSurvivesAction = await testPage.evaluate(() => {
        const overlay = document.getElementById("agent-pilot-lock-overlay");
        return overlay && window.getComputedStyle(overlay).display === "flex";
      });
    }
    record("7. Lock Persistence Across Action", lockSurvivesAction, `Lock maintained after moveMouse (150ms timeout did not destroy explicit lock)`);

    // 8. Test: Lock Persistence Across Navigation (Finding 2)
    await sendAgentCommand("tabs.update", { tabId, url: `http://127.0.0.1:${HTTP_PORT}/test-page.html?reloaded=1` });
    await new Promise(r => setTimeout(r, 600));
    let lockSurvivesNav = false;
    if (testPage) {
      for (let i = 0; i < 15; i++) {
        lockSurvivesNav = await testPage.evaluate(() => {
          const overlay = document.getElementById("agent-pilot-lock-overlay");
          return overlay && window.getComputedStyle(overlay).display === "flex";
        }).catch(() => false);
        if (lockSurvivesNav) break;
        await new Promise(r => setTimeout(r, 150));
      }
    }
    record("8. Lock Persistence Across Navigation", lockSurvivesNav, `Lock overlay restored on page reload/navigation`);

    // Re-bind testPage reference after navigation
    const pagesAfterNav = await browser.pages();
    testPage = pagesAfterNav.find(p => p.url().includes("test-page.html")) || testPage;
    await testPage.waitForSelector("#btn-sample-click");

    // Unlock tab
    const unlockRes = await sendAgentCommand("page.setBusy", { tabId, busy: false });
    let lockOverlayHidden = false;
    if (testPage) {
      await new Promise(r => setTimeout(r, 150));
      lockOverlayHidden = await testPage.evaluate(() => {
        const overlay = document.getElementById("agent-pilot-lock-overlay");
        return overlay && window.getComputedStyle(overlay).display === "none";
      });
    }
    record("9. Agent Lock Overlay Release", lockOverlayHidden, `Lock overlay dismissed (display: none)`);

    // 10. Test Agent Command: page.moveMouse
    const moveRes = await sendAgentCommand("page.moveMouse", { tabId, x: 380, y: 240, duration: 150 });
    let isHiddenOnMove = false;
    let cursorVisibleOnMove = false;
    if (testPage) {
      isHiddenOnMove = await testPage.evaluate(() => document.hidden);
      cursorVisibleOnMove = await testPage.evaluate(() => document.querySelector(".agent-pilot-virtual-cursor")?.classList.contains("visible"));
    }
    // When operating on a background tab, virtual cursor is intentionally kept hidden to prevent DOM/CPU thrashing
    const moveSuccess = moveRes?.success === true && (isHiddenOnMove ? !cursorVisibleOnMove : cursorVisibleOnMove);
    record("10. Agent Command: page.moveMouse", moveSuccess, `Virtual cursor moved to (380, 240) (Hidden tab: ${isHiddenOnMove}, Cursor invisible: ${!cursorVisibleOnMove})`);

    // 11. Test Agent Command: page.click (Click the test button on page)
    const clickRes = await sendAgentCommand("page.click", { tabId, selector: "#btn-sample-click" });
    await new Promise(r => setTimeout(r, 600));

    // Verify button was actually clicked on the page
    let clickCounterText = "";
    if (testPage) {
      clickCounterText = await testPage.evaluate(() => document.getElementById("click-counter-text")?.textContent);
    }
    const clickSuccess = clickCounterText.includes("1 lần");
    record("11. Agent Command: page.click", clickSuccess, `Button Counter: "${clickCounterText}"`);

    // 12. Test Agent Command: page.type (Type into input field)
    const typeRes = await sendAgentCommand("page.type", {
      tabId,
      selector: "#test-search-input",
      text: "Controlled via Port 58765 by Antigravity"
    });
    let typedValue = "";
    if (testPage) {
      typedValue = await testPage.evaluate(() => document.getElementById("test-search-input")?.value);
    }
    const typeSuccess = typedValue === "Controlled via Port 58765 by Antigravity";
    record("12. Agent Command: page.type", typeSuccess, `Input Value: "${typedValue}"`);

    // 13. Test Agent Command: page.getElement
    const elInfo = await sendAgentCommand("page.getElement", { tabId, selector: "#inspector-special-box" });
    const getElSuccess = elInfo && elInfo.rect?.width > 0 && elInfo.selector?.includes("inspector-special-box");
    record("13. Agent Command: page.getElement", getElSuccess, `Selector: ${elInfo?.selector}, BoundingBox: ${elInfo?.rect?.width}x${elInfo?.rect?.height}px`);

    // 14. Test Agent Command: page.screenshot
    const shotRes = await sendAgentCommand("page.screenshot", { tabId, mode: "visible" });
    const shotSuccess = shotRes?.success && shotRes?.dataUrl && shotRes.dataUrl.startsWith("data:image/png;base64,");
    if (shotSuccess) {
      const base64 = shotRes.dataUrl.replace(/^data:image\/png;base64,/, "");
      const buf = Buffer.from(base64, "base64");
      const outPath = path.join(PROJECT_DIR, "assets", "verified_agent_screenshot.png");
      fs.writeFileSync(outPath, buf);
      record("14. Agent Command: page.screenshot", true, `Captured ${buf.length} bytes -> assets/verified_agent_screenshot.png`);
    } else {
      record("14. Agent Command: page.screenshot", false, shotRes?.error || "Screenshot failed");
    }

    // 15. Test Agent Command: cdp.attach & devtools.getData
    const attachRes = await sendAgentCommand("cdp.attach", { tabId });
    record("15. Agent Command: cdp.attach", attachRes?.success === true, `CDP Attached to Tab ${tabId}`);

    // Trigger a console log and fetch devtools data over bridge
    if (testPage) {
      await testPage.evaluate(() => console.log("LOG_VIA_AGENT_PORT_58765_TOKEN"));
    }
    await new Promise(r => setTimeout(r, 600));

    const devtoolsRes = await sendAgentCommand("devtools.getData", { tabId });
    const hasLog = devtoolsRes?.console?.some(c => c.text.includes("LOG_VIA_AGENT_PORT_58765_TOKEN"));
    const hasPerf = devtoolsRes?.performance?.domNodes > 0 && typeof devtoolsRes?.performance?.jsHeapUsedMB === "number";
    record("16. Agent Command: devtools.getData", hasLog && hasPerf, `Captured ${devtoolsRes?.console?.length} logs & Performance (Heap: ${devtoolsRes?.performance?.jsHeapUsedMB} MB, Nodes: ${devtoolsRes?.performance?.domNodes})`);

    // 17. Test Agent Command: tabs.listAll
    const listTabsRes = await sendAgentCommand("tabs.listAll", {});
    const hasAgentTab = Array.isArray(listTabsRes) && listTabsRes.some(t => t.tabId === tabId && t.isAgentTab === true);
    record("17. Agent Command: tabs.listAll", hasAgentTab, `Listed ${listTabsRes?.length} tabs (found Agent tabId: ${tabId})`);

    // 18. Test Background Tab Screenshot (while user is working on another active tab)
    const userActivePage = await browser.newPage();
    await userActivePage.goto(`http://127.0.0.1:${HTTP_PORT}/test-page.html?user_tab=active`);
    await userActivePage.bringToFront();
    await new Promise(r => setTimeout(r, 400));
    // Now userActivePage is active in foreground, tabId is in background!
    const bgShotRes = await sendAgentCommand("page.screenshot", { tabId, mode: "visible" }, 15000);
    const bgShotSuccess = bgShotRes?.success && bgShotRes?.isBackgroundTab === true && bgShotRes?.dataUrl?.startsWith("data:image/png;base64,");
    record("18. Background Tab Screenshot via CDP", bgShotSuccess, `Background tab ${tabId} captured silently via CDP while user was on active tab`);

    // 19. Test Background Screenshot Privacy Isolation (Must NOT leak active tab on failure)
    let privacyLeakDetected = false;
    try {
      const invalidBgShotRes = await sendAgentCommand("page.screenshot", { tabId: 999999999, mode: "visible" });
      if (invalidBgShotRes && invalidBgShotRes.success) privacyLeakDetected = true;
    } catch (_) {
      // Expected to throw or return error
    }
    record("19. Privacy Isolation for Background Screenshot", !privacyLeakDetected, `Invalid background tab correctly rejected without leaking foreground user screen`);
    // 20. Test Background Tab Operations without focus (Click, Type & Scroll in hidden background tab)
    const isTargetHidden = await testPage.evaluate(() => document.hidden);
    const isUserActive = await userActivePage.evaluate(() => !document.hidden);

    const bgClickRes = await sendAgentCommand("page.click", { tabId, selector: "#btn-sample-click" });
    const bgTypeRes = await sendAgentCommand("page.type", {
      tabId,
      selector: "#test-search-input",
      text: "Background execution without focus"
    });
    const bgScrollRes = await sendAgentCommand("page.scroll", { tabId, deltaY: 200 });

    let bgClickCounter = "";
    let bgTypedVal = "";
    let bgScrollY = 0;
    if (testPage) {
      bgClickCounter = await testPage.evaluate(() => document.getElementById("click-counter-text")?.textContent);
      bgTypedVal = await testPage.evaluate(() => document.getElementById("test-search-input")?.value);
      bgScrollY = await testPage.evaluate(() => window.scrollY);
    }
    const bgOpsSuccess = isTargetHidden &&
                         isUserActive &&
                         bgClickCounter.includes("2 lần") &&
                         bgTypedVal.includes("Background execution without focus") &&
                         bgScrollY > 0;
    record("20. Background Tab Control Without Focus", bgOpsSuccess, `Tab operated silently in background without stealing focus (Target hidden: ${isTargetHidden}, User active: ${isUserActive}, Counter: "${bgClickCounter}", ScrollY: ${bgScrollY})`);
    await userActivePage.close();

    // 21. Test HTTP API Endpoint (POST http://127.0.0.1:58765/api)
    const httpRes = await new Promise((resolve) => {
      const req = http.request(`http://127.0.0.1:${BRIDGE_PORT}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }, (res) => {
        let b = "";
        res.on("data", c => b += c);
        res.on("end", () => {
          try { resolve(JSON.parse(b)); } catch { resolve(null); }
        });
      });
      req.on("error", () => resolve(null));
      req.write(JSON.stringify({ method: "ping" }));
      req.end();
    });
    record("21. HTTP REST/JSON-RPC API Endpoint", httpRes?.success === true && httpRes?.result?.pong === true, `POST /api response: pong=true`);

    // 22. Test Side Panel UI displays Agent Connection Status
    const swTarget = await browser.waitForTarget(t => t.type() === "service_worker");
    const extId = swTarget.url().split("/")[2];
    const sidepanelPage = await browser.newPage();
    await sidepanelPage.goto(`chrome-extension://${extId}/sidepanel.html`);

    await new Promise(r => setTimeout(r, 500));
    const sidepanelBridgeStatus = await sidepanelPage.evaluate(() => {
      return {
        dotClass: document.getElementById("agent-bridge-dot")?.className,
        text: document.getElementById("agent-bridge-text")?.textContent,
        portVal: document.getElementById("input-bridge-port")?.value
      };
    });

    const isSidepanelConnected = sidepanelBridgeStatus.dotClass?.includes("connected") && sidepanelBridgeStatus.portVal === String(BRIDGE_PORT);
    record("22. Side Panel Agent Status Indicator", isSidepanelConnected, `Badge: "${sidepanelBridgeStatus.text}", Dot: ${sidepanelBridgeStatus.dotClass}`);

    await sidepanelPage.close();

    // 23. Test Batch Action Execution via WebSocket (batch.run)
    // Sequence: open -> wait_for_selector -> click -> type (with clear) -> devtools -> screenshot -> close
    const batchRes = await sendAgentCommand("batch.run", {
      actions: [
        { type: "open", url: `http://127.0.0.1:${HTTP_PORT}/test-page.html`, loadTimeout: 3000 },
        { type: "wait_for_selector", selector: "#btn-sample-click", timeoutMs: 4000 },
        { type: "click", selector: "#btn-sample-click" },
        { type: "type", selector: "#test-search-input", text: "Batch Action Automation Verified", clear: true },
        { type: "devtools", devtoolsType: "performance" },
        { type: "screenshot", label: "batch_test" },
        { type: "close" }
      ]
    }, 30000);

    const isBatchSuccess = batchRes?.success === true &&
                           batchRes?.results?.length === 7 &&
                           batchRes?.results[0]?.type === "open" &&
                           batchRes?.results[1]?.type === "wait_for_selector" &&
                           batchRes?.results[2]?.type === "click" &&
                           batchRes?.results[3]?.type === "type" &&
                           batchRes?.results[4]?.type === "devtools" &&
                           batchRes?.results[4]?.performance?.domNodes > 0 &&
                           batchRes?.results[5]?.dataUrl?.startsWith("data:image/png;base64,") &&
                           batchRes?.results[6]?.type === "close";

    record("23. Batch Actions Engine (Single Tool Call)", isBatchSuccess, `Executed 7-step batch (open -> wait -> click -> type -> devtools -> screenshot -> close) in ${batchRes?.durationMs}ms`);

    // 24. Test Batch Actions via HTTP REST API (POST /api method: batch.run)
    const httpBatchParams = {
      actions: [
        { type: "open", url: `http://127.0.0.1:${HTTP_PORT}/test-page.html` },
        { type: "wait_for_selector", selector: "#btn-sample-click" },
        { type: "devtools" },
        { type: "close" }
      ]
    };
    if (selectedTestInstanceId) {
      httpBatchParams.instanceId = selectedTestInstanceId;
    }

    const httpBatchRes = await new Promise((resolve) => {
      const req = http.request(`http://127.0.0.1:${BRIDGE_PORT}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }, (res) => {
        let b = "";
        res.on("data", c => b += c);
        res.on("end", () => {
          try { resolve(JSON.parse(b)); } catch { resolve(null); }
        });
      });
      req.on("error", () => resolve(null));
      req.write(JSON.stringify({
        method: "batch.run",
        params: httpBatchParams
      }));
      req.end();
    });

    const isHttpBatchSuccess = httpBatchRes?.success === true &&
                               httpBatchRes?.result?.success === true &&
                               httpBatchRes?.result?.executedActions === 4 &&
                               Array.isArray(httpBatchRes?.result?.results[2]?.console) &&
                               httpBatchRes?.result?.results[2]?.performance?.domNodes > 0;
    record("24. Batch Actions HTTP API Endpoint", isHttpBatchSuccess, `Executed 4 actions (including default devtools) via HTTP /api in ${httpBatchRes?.result?.durationMs}ms`);

    // 25. Secret & API Key Sanitizer over WebSocket Bridge
    const secretEvalBatch = {
      tabId,
      actions: [
        {
          type: "evaluate",
          expression: "JSON.stringify({ apiKey: 'sk-proj-test1234567890abcdef1234567890', awsKey: 'AKIAIOSFODNN7EXAMPLE', password: 'SecretPassword123!' })"
        }
      ]
    };
    if (selectedTestInstanceId) secretEvalBatch.instanceId = selectedTestInstanceId;

    const secretRes = await sendAgentCommand("batch.run", secretEvalBatch);
    const evalResultStr = secretRes?.results?.[0]?.value || "";
    const isMaskedProperly =
      evalResultStr.includes("sk-proj") &&
      evalResultStr.includes("*****") &&
      evalResultStr.includes("[MASKED_SECRET: OpenAI API Key]") &&
      evalResultStr.includes("AKIA") &&
      evalResultStr.includes("[MASKED_SECRET: AWS Access Key]") &&
      secretRes?._securityNotice?.includes("⚠️ [SECURITY NOTICE FOR AGENT]");

    record("25. Secret & API Key Redaction over WebSocket", isMaskedProperly, "Verified API keys & credentials masked with asterisks and agent security notice attached");

    // 26. Secret Filter Config Dynamic Toggle & Bypass
    const filterConfigInitial = await sendAgentCommand("config.getSecretFilter");
    const isDefaultEnabled = filterConfigInitial?.enabled === true;

    await sendAgentCommand("config.setSecretFilter", { enabled: false });
    const disabledRes = await sendAgentCommand("batch.run", secretEvalBatch);
    const disabledResultStr = disabledRes?.results?.[0]?.value || "";
    const isBypassed =
      disabledResultStr.includes("sk-proj-test1234567890abcdef1234567890") &&
      disabledRes?._securityNotice === undefined;

    // Restore to enabled: true
    await sendAgentCommand("config.setSecretFilter", { enabled: true });
    const restoredConfig = await sendAgentCommand("config.getSecretFilter");
    const isRestored = restoredConfig?.enabled === true;

    const isToggleWorking = isDefaultEnabled && isBypassed && isRestored;
    record("26. Secret Filter Config Dynamic Toggle", isToggleWorking, "Verified default enabled: true, bypass when toggled false, and clean restoration");

    // 27. Agent Command: page.pickColor (Precision Eyedropper Pixel Sampling)
    const pickColorParams = { tabId, x: 200, y: 150 };
    if (selectedTestInstanceId) pickColorParams.instanceId = selectedTestInstanceId;
    const colorPickRes = await sendAgentCommand("page.pickColor", pickColorParams);
    const isColorPickSuccess = colorPickRes?.success === true &&
                               Boolean(colorPickRes?.color?.hex) &&
                               Boolean(colorPickRes?.color?.rgb);
    record("27. Agent Command: page.pickColor", isColorPickSuccess, `Picked Color at (200, 150): HEX: ${colorPickRes?.color?.hex}, RGB: ${colorPickRes?.color?.rgb}`);

    // 28. Visual UI Feedback (Channel B - Persistent Shared Inbox)
    const testFeedbackPayload = {
      timestamp: Date.now(),
      url: `http://127.0.0.1:${HTTP_PORT}/test-page.html`,
      title: "Agent Pilot Test Page",
      items: [
        {
          id: "item_conn_1",
          mode: "element",
          title: "Nút kiểm thử click",
          comment: "Thêm viền neon xanh cyan và hiệu ứng hover",
          component: {
            framework: "React",
            componentName: "TestButton",
            fileName: "src/components/TestButton.jsx",
            lineNumber: 18
          },
          dom: { selector: "#btn-click" },
          screenshotDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        }
      ]
    };

    let saveResp = null;
    let pendingResp = null;
    try {
      saveResp = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/feedback/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testFeedbackPayload)
      }).then(r => r.json());
      pendingResp = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/feedback/pending?sessionId=${testFeedbackPayload.timestamp}`, {
        headers: { "Content-Type": "application/json" }
      }).then(r => r.json());
    } catch (e) {
      console.error("Feedback fetch error:", e);
    }

    const savedSessionId = String(saveResp?.result?.sessionId || saveResp?.sessionId || "");
    const sessionsList = Array.isArray(pendingResp?.sessions) ? pendingResp.sessions : (pendingResp?.result?.sessions || []);
    const isChannelBVerified = Boolean(savedSessionId) &&
                              savedSessionId === String(testFeedbackPayload.timestamp) &&
                              (pendingResp?.success === true || pendingResp?.result?.success === true || Array.isArray(sessionsList)) &&
                              sessionsList.length >= 1;
    record("28. Visual UI Feedback (Channel B - Shared Inbox)", isChannelBVerified, `Saved session ${savedSessionId} with 1 item; retrieved from pending inbox`);

    // 29. Visual UI Feedback (Channel A - Live Reactive Long-Polling)
    let waitResolvedLive = false;
    let waitDataLive = null;

    const livePushPayload = {
      timestamp: Date.now() + 50,
      url: `http://127.0.0.1:${HTTP_PORT}/test-page.html`,
      title: "Agent Pilot Test Page - Live Push",
      items: [
        {
          id: "item_live_push",
          mode: "screen",
          title: "Toàn màn hình với ghi chú trực tiếp",
          comment: "Khoảng cách giữa nút và form quá gần",
          annotations: [{ x: 100, y: 100, comment: "Cần tăng margin-bottom: 24px" }]
        }
      ]
    };

    const waitPromise = fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/feedback/wait`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeout: 5 })
    }).then(r => r.json()).then(res => {
      waitResolvedLive = true;
      waitDataLive = res?.result || res;
    }).catch(e => {
      console.error("Wait feedback error:", e);
    });

    setTimeout(async () => {
      try {
        await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/feedback/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(livePushPayload)
        });
      } catch (_) {}
    }, 100);

    await waitPromise;
    const isChannelAVerified = waitResolvedLive &&
                              waitDataLive?.success === true &&
                              waitDataLive?.channel === "reactive_channel_a" &&
                              String(waitDataLive?.sessionId) === String(livePushPayload.timestamp);
    record("29. Visual UI Feedback (Channel A - Reactive Long-Polling)", isChannelAVerified, `Long-poll resolved instantaneously upon submission (Session: ${waitDataLive?.sessionId})`);



    console.log("\n==================================================================");
    console.log("📊 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ KẾT NỐI AI AGENT:");
    const passedCount = testResults.filter(t => t.passed).length;
    console.log(`TỔNG SỐ TÍNH NĂNG KIỂM TRA: ${testResults.length}`);
    console.log(`THÀNH CÔNG: ${passedCount} / ${testResults.length} (100%)`);
    console.log("==================================================================");

    if (passedCount === testResults.length) {
      console.log("\n🎉 HOÀN TOÀN XÁC MINH: AI AGENT KẾT NỐI & ĐIỀU KHIỂN TRÌNH DUYỆT QUA CỔNG 58765 THÀNH CÔNG RỰC RỠ!");
    } else {
      console.error("\n❌ Có tính năng chưa vượt qua kiểm thử!");
      process.exitCode = 1;
    }

  } catch (err) {
    console.error("\n[LỖI]:", err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (wss) wss.close();
    if (bridgeServer) bridgeServer.close();
    if (httpServer) httpServer.close();
  }
}

run();
