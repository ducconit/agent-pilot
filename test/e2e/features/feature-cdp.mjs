/**
 * verify_all_features - Feature section: Chrome DevTools Protocol engine
 * (tab controller, attach, console/network interception, performance) — records 9-13.
 *
 * Record 9 always runs. The CDP assertions (10-13) only run when a test-page tab
 * was found — the original kept them behind `if (tabInfo)`, and we preserve that
 * by recording tabInfo on ctx for the screenshot section that follows.
 */
import { LOCAL_HOST } from "../../../scripts/lib/config.mjs";

export async function run(ctx) {
  const { sw, page, sidepanelPage, httpPort, record } = ctx;

  console.log("\n--- KIỂM THỬ CHROME DEVTOOLS PROTOCOL (CDP ENGINE) ---");

  // 9. Tab Controller (find the test-page tab via the service worker)
  const tabInfo = await sw.evaluate(async (port) => {
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const t = tabs.find(tab => tab.url && tab.url.includes("test-page.html"));
        resolve(t ? { id: t.id, url: t.url } : null);
      });
    });
  }, httpPort);

  record("9. Tab Controller (chrome.tabs Query & Navigation)", !!tabInfo, `Tab ID: ${tabInfo?.id}, URL: ${tabInfo?.url}`);

  if (!tabInfo) return;
  ctx.tabInfo = tabInfo;

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
  // (host/port must be passed in: page.evaluate runs in the browser context)
  await page.evaluate((host, port) => {
    fetch(`http://${host}:${port}/test-page.html`).catch(() => {});
  }, LOCAL_HOST, httpPort);
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

  // 13b. Cleanly detach CDP Debugger
  const detachRes = await sidepanelPage.evaluate(async (tabId) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "detach_debugger", tabId }, resolve);
    });
  }, tabInfo.id);
  record("13b. CDP Detach (chrome.debugger.detach)", detachRes?.success === true, `Detached from Tab ${tabInfo.id}`);
}
