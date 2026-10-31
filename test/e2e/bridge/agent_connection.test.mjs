/**
 * Agent Pilot - Full End-to-End AI Agent WebSocket Bridge Verification Test
 * Tests AI Agent commands over WebSocket port 58765 controlling a real Chromium browser.
 *
 * The bridge plumbing plus the page/lock/cursor assertions live here; the CDP,
 * background-tab, batch, secret-filter and feedback sections are extracted into
 * scripts/features/agent-*.mjs and run against a shared context object.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";

import { resolveChromiumBin } from "../../../scripts/browser_resolver.mjs";
import { BRIDGE_PORT, ROOT_DIR, TIMEOUTS, SEPARATOR } from "../../../scripts/lib/config.mjs";
import { createRecorder, startStaticServer, closeHttpServer, launchExtensionBrowser } from "../../../scripts/lib/harness.mjs";

import * as agentCdp from "../features/agent-cdp.mjs";
import * as agentBackground from "../features/agent-background.mjs";
import * as agentBatch from "../features/agent-batch.mjs";
import * as agentSecretFilter from "../features/agent-secret-filter.mjs";
import * as agentFeedback from "../features/agent-feedback.mjs";

async function run() {
  console.log(SEPARATOR);
  console.log(`🤖 KIỂM THỬ KẾT NỐI AI AGENT ĐẾN AGENT PILOT (WEBSOCKET PORT ${BRIDGE_PORT})`);
  console.log(`${SEPARATOR}\n`);

  const recorder = createRecorder({
    title: "📊 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ KẾT NỐI AI AGENT:",
    successMessage: `\n🎉 HOÀN TOÀN XÁC MINH: AI AGENT KẾT NỐI & ĐIỀU KHIỂN TRÌNH DUYỆT QUA CỔNG ${BRIDGE_PORT} THÀNH CÔNG RỰC RỠ!`,
    failureMessage: "\n❌ Có tính năng chưa vượt qua kiểm thử!"
  });
  const record = recorder.record;

  // 1. Start Bridge WebSocket Server on the configured bridge port
  let extensionSocket = null;
  let handshakeData = null;
  const pendingRequests = new Map();
  let requestIdCounter = 1;

  // 1. Check if live bridge server is already active, otherwise start our own
  let isLiveServer = false;
  try {
    const health = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`, { signal: AbortSignal.timeout(TIMEOUTS.HTTP_PROBE_MS) }).then(r => r.json());
    if (health && (health.name === "Agent Pilot Bridge Server" || health.name === "Agent Pilot Go Bridge Server")) {
      isLiveServer = true;
      console.log(`[Bridge Server] Using active live Agent Pilot Bridge Server on port ${BRIDGE_PORT}`);
    }
  } catch (_) {}

  const initialClients = new Set();
  if (isLiveServer) {
    try {
      const h = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`).then(r => r.json());
      const existing = (h.clients || []).map(c => c.instanceId);
      existing.forEach(id => initialClients.add(id));
    } catch (_) {}
  }

  let bridgeServer = null;
  let wss = null;
  let onExtensionConnected = null;

  let selectedTestInstanceId = null;

  if (isLiveServer) {
    const MAX_CLIENT_POLL_RETRIES = TIMEOUTS.CLIENT_POLL_RETRIES;
    const CLIENT_POLL_INTERVAL_MS = TIMEOUTS.CLIENT_POLL_INTERVAL_MS;
    onExtensionConnected = (async () => {
      for (let i = 0; i < MAX_CLIENT_POLL_RETRIES; i++) {
        await new Promise(r => setTimeout(r, CLIENT_POLL_INTERVAL_MS));
        try {
          const listResp = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: "instances.list" }),
            signal: AbortSignal.timeout(TIMEOUTS.HTTP_PROBE_MS)
          });
          const listData = await listResp.json();
          const clients = Array.isArray(listData?.result) ? listData.result : (listData?.result?.clients || []);
          const newClient = clients.find(c => !initialClients.has(c.instanceId)) || (initialClients.size === 0 && clients[0]);
          if (newClient) {
            selectedTestInstanceId = newClient.instanceId;
            await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ method: "instances.select", params: { instanceId: newClient.instanceId } }),
              signal: AbortSignal.timeout(TIMEOUTS.HTTP_PROBE_MS)
            });
            console.log(`[Test] Selected test browser instance: ${newClient.instanceId}`);
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

  async function sendAgentCommand(method, params = {}, timeoutMs = TIMEOUTS.AGENT_COMMAND_MS) {
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

  const httpServer = await startStaticServer(0, ROOT_DIR);
  const httpPort = httpServer.address().port;
  console.log(`[Test Server] Listening on http://127.0.0.1:${httpPort}`);
  let browser = null;
  let closeBrowser = null;

  try {
    // 2. Launch Chromium with Agent Pilot Extension
    console.log(`[Chromium] Launching binary: ${resolveChromiumBin()}`);
    const launched = await launchExtensionBrowser();
    browser = launched.browser;
    closeBrowser = launched.close;

    // 3. Verify Extension automatically connects to Bridge Server on the bridge port
    console.log("[Test] Waiting for extension to connect via WebSocket...");
    const handshake = await Promise.race([
      onExtensionConnected,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for extension connection")), TIMEOUTS.EXTENSION_CONNECT_MS))
    ]);

    const isConnected = (isLiveServer || !!extensionSocket) && handshake?.type === "HANDSHAKE";
    record(`1. WebSocket Connection on Port ${BRIDGE_PORT}`, isConnected, `Agent: ${handshake?.agent} v${handshake?.version}, Capabilities: [${handshake?.capabilities?.slice(0, 4).join(", ")}...]`);

    // 4. Test Agent ping
    const pingRes = await sendAgentCommand("ping");
    record("2. Agent Ping/Pong Heartbeat", pingRes?.pong === true, `Latency: ${Date.now() - pingRes?.timestamp}ms, Version: ${pingRes?.version}`);

    // 3. Test Agent Command: tabs.create (Open Test Page in background without focus)
    const newTab = await sendAgentCommand("tabs.create", { url: `http://127.0.0.1:${httpPort}/test-page.html` });
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
      await testPage.waitForFunction(() => !!window.__AGENT_PILOT__);
    }

    // Target tab ID returned from tabs.create
    const tabId = newTab?.id;
    const tabsList = await sendAgentCommand("tabs.query", {});
    console.log(`[Test] Active tabs count: ${tabsList.length}, targetTabId: ${tabId}`);

    // 3b. Test Agent Command: tabs.getActive
    const activeTabInfo = await sendAgentCommand("tabs.getActive", {});
    record("3b. Agent Command: tabs.getActive", !!activeTabInfo && typeof activeTabInfo.id !== "undefined", `Active tab ID: ${activeTabInfo?.id}`);

    // Verify Virtual Cursor is HIDDEN / UNMOUNTED by default on page load
    let initialCursorHidden = false;
    let initialCursorState = "visible";
    if (testPage) {
      initialCursorState = await testPage.evaluate(() => {
        const cursor = document.querySelector(".agent-pilot-virtual-cursor");
        if (!cursor) return "unmounted";
        const style = window.getComputedStyle(cursor);
        return style.display === "none" || style.opacity === "0" ? "hidden" : "visible";
      });
      initialCursorHidden = initialCursorState === "unmounted" || initialCursorState === "hidden";
    }
    record("4. Cursor Initial Hidden State", initialCursorHidden, `Initial cursor state: ${initialCursorState} (Expected unmounted or hidden)`);

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
          hasCard: overlay ? !!overlay.querySelector(".agent-pilot-lock-card") : false,
          actionDesc: overlay ? overlay.dataset.action || "" : ""
        };
      });
    }
    const lockOverlayActive = lockOverlayDetails.hasOverlay && lockOverlayDetails.display === "flex" && !lockOverlayDetails.hasCard;
    record("6. Agent Lock Overlay Active", lockOverlayActive, `Overlay: ${lockOverlayDetails.display}, CardRemoved: ${!lockOverlayDetails.hasCard}, Action: "${lockOverlayDetails.actionDesc}"`);

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
    await sendAgentCommand("tabs.update", { tabId, url: `http://127.0.0.1:${httpPort}/test-page.html?reloaded=1` });
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
    if (testPage) {
      await testPage.waitForFunction(() => {
        const text = document.getElementById("click-counter-text")?.textContent || "";
        return text.includes("1 lần");
      }, { timeout: 4000 }).catch(() => {});
    }

    // Verify button was actually clicked on the page
    let clickCounterText = "";
    if (testPage) {
      clickCounterText = await testPage.evaluate(() => document.getElementById("click-counter-text")?.textContent);
    }
    const clickSuccess = clickCounterText.includes("1 lần");
    record("11. Agent Command: page.click", clickSuccess, `Button Counter: "${clickCounterText}"`);

    // 11b. Test Agent Command: page.hover
    const hoverRes = await sendAgentCommand("page.hover", { tabId, selector: "#btn-sample-click" });
    record("11b. Agent Command: page.hover", hoverRes?.success === true, `Hovered button successfully`);

    // 12. Test Agent Command: page.type (Type into input field)
    const typeRes = await sendAgentCommand("page.type", {
      tabId,
      selector: "#test-search-input",
      text: `Controlled via Port ${BRIDGE_PORT} by Antigravity`
    });
    let typedValue = "";
    if (testPage) {
      typedValue = await testPage.evaluate(() => document.getElementById("test-search-input")?.value);
    }
    const typeSuccess = typedValue === `Controlled via Port ${BRIDGE_PORT} by Antigravity`;
    record("12. Agent Command: page.type", typeSuccess, `Input Value: "${typedValue}"`);

    // 12b. Test Agent Command: page.pressKey
    const pressRes = await sendAgentCommand("page.pressKey", { tabId, key: "ArrowRight" });
    record("12b. Agent Command: page.pressKey", pressRes?.success === true, `Key ArrowRight dispatched`);

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
      const outPath = path.join(ROOT_DIR, "assets", "verified_agent_screenshot.png");
      fs.writeFileSync(outPath, buf);
      record("14. Agent Command: page.screenshot", true, `Captured ${buf.length} bytes -> assets/verified_agent_screenshot.png`);
    } else {
      record("14. Agent Command: page.screenshot", false, shotRes?.error || "Screenshot failed");
    }

    // Feature sections (CDP, background control, batch, secret filter, feedback).
    const ctx = {
      browser,
      testPage,
      tabId,
      record,
      sendAgentCommand,
      bridgePort: BRIDGE_PORT,
      httpPort,
      getSelectedInstanceId: () => selectedTestInstanceId
    };

    await agentCdp.run(ctx);
    await agentBackground.run(ctx);
    await agentBatch.run(ctx);
    await agentSecretFilter.run(ctx);

    // 27. Agent Command: page.pickColor (Precision Eyedropper Pixel Sampling)
    const pickColorParams = { tabId, x: 200, y: 150 };
    if (selectedTestInstanceId) pickColorParams.instanceId = selectedTestInstanceId;
    const colorPickRes = await sendAgentCommand("page.pickColor", pickColorParams);
    const isColorPickSuccess = colorPickRes?.success === true &&
                               Boolean(colorPickRes?.color?.hex) &&
                               Boolean(colorPickRes?.color?.rgb) &&
                               Boolean(colorPickRes?.color?.rgba) &&
                               Boolean(colorPickRes?.color?.hsl) &&
                               Boolean(colorPickRes?.color?.oklch);
    record("27. Agent Command: page.pickColor (5 Formats: HEX, RGB, RGBA, HSL, OKLCH)", isColorPickSuccess, `HEX: ${colorPickRes?.color?.hex}, RGB: ${colorPickRes?.color?.rgb}, RGBA: ${colorPickRes?.color?.rgba}, HSL: ${colorPickRes?.color?.hsl}, OKLCH: ${colorPickRes?.color?.oklch}`);

    await agentFeedback.run(ctx);

    if (tabId) {
      await sendAgentCommand("tabs.remove", { tabId }).catch(() => {});
    }

    recorder.summarize();
    recorder.exitIfFailed();
  } catch (err) {
    console.error("\n[LỖI]:", err);
    process.exitCode = 1;
  } finally {
    // Cleanup in `finally` (exitCode, never process.exit) guarantees the browser,
    // bridge and page server are always released even when an assertion throws.
    if (closeBrowser) await closeBrowser();
    if (wss) await new Promise((resolve) => wss.close(resolve));
    if (bridgeServer) await closeHttpServer(bridgeServer);
    if (httpServer) await closeHttpServer(httpServer);
  }
}

run();
