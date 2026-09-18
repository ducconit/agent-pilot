/**
 * verify_agent_connection - Feature section: background-tab control, HTTP JSON-RPC
 * endpoint and side-panel agent status (records 17-22).
 *
 * These assertions prove the agent can operate a hidden tab (screenshot, click,
 * type, scroll) without stealing the user's foreground focus, and that the bridge
 * is reachable both over WebSocket and plain HTTP.
 */
import http from "node:http";
import { TIMEOUTS } from "../lib/config.mjs";
import { sleep, waitForServiceWorker, extensionIdFromTarget } from "../lib/harness.mjs";

export async function run({ browser, testPage, tabId, sendAgentCommand, bridgePort, httpPort, record }) {
  // 17. Test Agent Command: tabs.listAll
  const listTabsRes = await sendAgentCommand("tabs.listAll", {});
  const hasAgentTab = Array.isArray(listTabsRes) && listTabsRes.some(t => t.tabId === tabId && t.isAgentTab === true);
  record("17. Agent Command: tabs.listAll", hasAgentTab, `Listed ${listTabsRes?.length} tabs (found Agent tabId: ${tabId})`);

  // 18. Test Background Tab Screenshot (while user is working on another active tab)
  const userActivePage = await browser.newPage();
  await userActivePage.goto(`http://127.0.0.1:${httpPort}/test-page.html?user_tab=active`);
  await userActivePage.bringToFront();
  await sleep(400);
  // Now userActivePage is active in foreground, tabId is in background!
  const bgShotRes = await sendAgentCommand("page.screenshot", { tabId, mode: "visible" }, TIMEOUTS.AGENT_COMMAND_MS);
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
    const req = http.request(`http://127.0.0.1:${bridgePort}/api`, {
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
  const swTarget = await waitForServiceWorker(browser, { timeoutMs: TIMEOUTS.SERVICE_WORKER_SLOW_MS, urlIncludes: null });
  const extId = extensionIdFromTarget(swTarget);
  const sidepanelPage = await browser.newPage();
  await sidepanelPage.goto(`chrome-extension://${extId}/sidepanel.html`);

  await sleep(500);
  const sidepanelBridgeStatus = await sidepanelPage.evaluate(() => {
    return {
      dotClass: document.getElementById("agent-bridge-dot")?.className,
      text: document.getElementById("agent-bridge-text")?.textContent,
      portVal: document.getElementById("input-bridge-port")?.value
    };
  });

  const isSidepanelConnected = sidepanelBridgeStatus.dotClass?.includes("connected") && sidepanelBridgeStatus.portVal === String(bridgePort);
  record("22. Side Panel Agent Status Indicator", isSidepanelConnected, `Badge: "${sidepanelBridgeStatus.text}", Dot: ${sidepanelBridgeStatus.dotClass}`);

  await sidepanelPage.close();
}
