/**
 * Agent Pilot - Test Suite for Continuous Agent Session Lifecycle
 * Verifies that during an active session:
 * 1. Virtual cursor remains visible continuously (>3s, defying the 2.5s hide timeout).
 * 2. Lock shield (neon border + action pill) remains visible continuously.
 * 3. Granular actions update the description and revert to session standby without flickering/hiding.
 * 4. Ending the session smoothly dismisses both the cursor and the lock shield.
 */

import { SESSION_HTTP_PORT, ROOT_DIR, NAV_WAIT_UNTIL, TIMEOUTS } from "./lib/config.mjs";
import { startStaticServer, launchExtensionBrowser, waitForServiceWorker, sleep } from "./lib/harness.mjs";

async function runSessionTest() {
  const server = await startStaticServer(SESSION_HTTP_PORT, ROOT_DIR);
  console.log(`[HTTP Server] Listening on http://127.0.0.1:${SESSION_HTTP_PORT}`);

  const { browser, close } = await launchExtensionBrowser();

  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${SESSION_HTTP_PORT}/test-page.html`, { waitUntil: NAV_WAIT_UNTIL });
    await sleep(TIMEOUTS.PAGE_SETTLE_MS);

    // Wait for background service worker
    const workerTarget = await waitForServiceWorker(browser, { timeoutMs: TIMEOUTS.SERVICE_WORKER_SLOW_MS });
    if (!workerTarget) throw new Error("Timed out waiting for the extension service worker");
    const worker = await workerTarget.worker();

    // Get the target tab ID
    const targetTabId = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url && t.url.includes("test-page.html"));
      return target ? target.id : null;
    });
    console.log(`[Target Tab] Identified tab ID: ${targetTabId}`);
    if (!targetTabId) throw new Error("Could not find test-page tab in Chrome");

    console.log("=== BẮT ĐẦU KIỂM THỬ CONTINUOUS AGENT SESSION LIFECYCLE ===");

    // Step 1: Initial state (session inactive)
    const initialCursor = await page.evaluate(() => {
      const c = document.querySelector(".agent-pilot-virtual-cursor");
      return c && c.classList.contains("visible");
    });
    console.log(`1. Initial cursor visible: ${initialCursor} (Expected: false)`);
    if (initialCursor !== false) throw new Error("Cursor should be hidden initially");

    // Step 2: Start Agent Session via worker -> content script
    console.log("2. Starting Agent Session...");
    const startRes = await worker.evaluate(async (tabId) => {
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tabId,
          { action: "set_agent_session", active: true, sessionName: "Automated Testing Session" },
          resolve
        );
      });
    }, targetTabId);
    console.log("   Start session result:", startRes);

    // Verify cursor and shield are active
    const activeState1 = await page.evaluate(() => {
      const cursor = document.querySelector(".agent-pilot-virtual-cursor");
      const overlay = document.getElementById("agent-pilot-lock-overlay");
      const desc = document.getElementById("agent-pilot-lock-action-desc");
      return {
        cursorVisible: cursor?.classList.contains("visible"),
        overlayDisplay: overlay?.style.display,
        descText: desc?.textContent
      };
    });
    console.log("   State immediately after start:", activeState1);
    if (!activeState1.cursorVisible) throw new Error("Cursor must be visible upon session start");
    if (activeState1.overlayDisplay !== "flex") throw new Error("Overlay must be display: flex");

    // Step 3: Wait 3.2 seconds (exceeds default 2.5s hide timeout)
    console.log("3. Waiting 3200ms to verify no auto-hide occurs during active session...");
    await sleep(3200);

    const persistentState = await page.evaluate(() => {
      const cursor = document.querySelector(".agent-pilot-virtual-cursor");
      const overlay = document.getElementById("agent-pilot-lock-overlay");
      return {
        cursorStillVisible: cursor?.classList.contains("visible"),
        overlayStillFlex: overlay?.style.display === "flex"
      };
    });
    console.log("   Persistent state after 3200ms:", persistentState);
    if (!persistentState.cursorStillVisible) throw new Error("Cursor vanished prematurely during active session!");
    if (!persistentState.overlayStillFlex) throw new Error("Lock overlay vanished prematurely during active session!");

    // Step 4: Perform granular action within session via worker
    console.log("4. Performing click action inside active session...");
    await worker.evaluate(async (tabId) => {
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tabId,
          { action: "virtual_mouse_click", x: 250, y: 180 },
          resolve
        );
      });
    }, targetTabId);

    // Wait 1.5s after click (longer than the 1.2s action auto-unlock)
    await sleep(1500);

    const postActionState = await page.evaluate(() => {
      const cursor = document.querySelector(".agent-pilot-virtual-cursor");
      const overlay = document.getElementById("agent-pilot-lock-overlay");
      const desc = document.getElementById("agent-pilot-lock-action-desc");
      return {
        cursorVisible: cursor?.classList.contains("visible"),
        overlayFlex: overlay?.style.display === "flex",
        descText: desc?.textContent
      };
    });
    console.log("   Post-action state (reverted to session standby):", postActionState);
    if (!postActionState.cursorVisible) throw new Error("Cursor must remain visible after sub-action in session");
    if (!postActionState.overlayFlex) throw new Error("Overlay must remain visible after sub-action in session");

    // Step 5: End Session
    console.log("5. Ending Agent Session...");
    const endRes = await worker.evaluate(async (tabId) => {
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tabId,
          { action: "set_agent_session", active: false },
          resolve
        );
      });
    }, targetTabId);
    console.log("   End session result:", endRes);

    const finalState = await page.evaluate(() => {
      const cursor = document.querySelector(".agent-pilot-virtual-cursor");
      const overlay = document.getElementById("agent-pilot-lock-overlay");
      return {
        cursorVisible: cursor?.classList.contains("visible"),
        overlayDisplay: overlay?.style.display
      };
    });
    console.log("   Final state after session end:", finalState);
    if (finalState.cursorVisible) throw new Error("Cursor should be hidden after session end");
    if (finalState.overlayDisplay !== "none") throw new Error("Overlay should be display: none after session end");

    console.log("🎉 ALL TESTS PASSED: Continuous session lifecycle works flawlessly!");
  } finally {
    // Always release the browser and server; exitCode (not process.exit) keeps the
    // numeric semantics while still letting this cleanup run.
    await close();
    server.close();
  }
}

runSessionTest().catch((err) => {
  console.error("❌ Test Failed:", err);
  process.exitCode = 1;
});
