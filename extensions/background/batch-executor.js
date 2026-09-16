/**
 * Agent Pilot - Batch Actions Execution Engine
 * Executes ordered sequences of browser actions in a single tool call
 */

import {
  agentControlledTabs,
  normalizeUrl,
  DEFAULT_LOAD_TIMEOUT_MS,
  attachedTabs,
  getBuffer,
  logDebug
} from "./constants.js";
import { attachDebugger, sendCdpCommand, uploadFileInput, handleJavaScriptDialog } from "./cdp-manager.js";
import {
  getActiveTabId,
  getTargetTabId,
  assignTabToAgentGroup,
  ensureContentScript,
  sendTabMessageWithRetry
} from "./tab-manager.js";
import { captureTabScreenshot } from "./screenshot-service.js";

/**
 * Execute batch action list sequentially
 */
export async function executeBatchActions(params, bridgeClient = null) {
  const actions = Array.isArray(params.actions) ? params.actions : [];
  const stopOnError = params.stopOnError !== false;
  let currentTabId = params.tabId
    ? await getTargetTabId(params.tabId, bridgeClient?.lastAgentTabId)
    : (bridgeClient?.lastAgentTabId || (await getActiveTabId()));
  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    const stepNum = i + 1;
    const type = (act.type || act.action || "").toLowerCase();
    const stepResult = { step: stepNum, type, success: false };

    try {
      switch (type) {
        case "open":
        case "open_tab":
        case "tabs.create": {
          const url = normalizeUrl(act.url || "https://google.com");
          const makeActive = act.active === true;
          const activeTabBefore = !makeActive ? await getActiveTabId() : null;

          const tab = await new Promise((resolve, reject) => {
            chrome.tabs.create({ url, active: makeActive }, (t) => {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              resolve(t);
            });
          });

          currentTabId = tab.id;
          if (bridgeClient) bridgeClient.lastAgentTabId = tab.id;
          agentControlledTabs.add(tab.id);
          await assignTabToAgentGroup(tab).catch((err) => logDebug("batch assignTabToAgentGroup", err));

          if (!makeActive && activeTabBefore && activeTabBefore !== tab.id) {
            const curActive = await getActiveTabId();
            if (curActive === tab.id) {
              await chrome.tabs.update(activeTabBefore, { active: true }).catch((err) => logDebug("batch restore active tab", err));
            }
          }

          await attachDebugger(tab.id).catch((err) => logDebug("batch attachDebugger", err));

          // Wait for tab load completion if requested (default true)
          if (act.waitUntil !== false) {
            await new Promise(async (resolve) => {
              let done = false;
              const finish = () => {
                if (!done) {
                  done = true;
                  clearTimeout(timeout);
                  chrome.tabs.onUpdated.removeListener(onUpdated);
                  resolve();
                }
              };

              const timeout = setTimeout(finish, Number(act.loadTimeout || act.timeoutMs || act.timeout || DEFAULT_LOAD_TIMEOUT_MS));

              const onUpdated = (tId, changeInfo) => {
                if (tId === tab.id && changeInfo.status === "complete") {
                  finish();
                }
              };
              chrome.tabs.onUpdated.addListener(onUpdated);

              try {
                const cur = await chrome.tabs.get(tab.id);
                if (cur && cur.status === "complete") {
                  finish();
                }
              } catch (err) {
                logDebug("batch create tab status check failed", err);
              }
            });
          }

          stepResult.success = true;
          stepResult.tabId = tab.id;
          stepResult.url = tab.url || tab.pendingUrl || url;
          break;
        }

        case "navigate":
        case "tabs.update": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for navigate");
          const url = normalizeUrl(act.url);

          if (act.waitUntil !== false) {
            await new Promise(async (resolve, reject) => {
              let resolved = false;
              const done = () => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(onUpdated);
                resolve();
              };

              const timeout = setTimeout(done, Number(act.loadTimeout || act.timeoutMs || act.timeout || DEFAULT_LOAD_TIMEOUT_MS));

              const onUpdated = (tId, changeInfo) => {
                if (tId === targetTabId && changeInfo.status === "complete") {
                  done();
                }
              };
              chrome.tabs.onUpdated.addListener(onUpdated);

              try {
                const t = await chrome.tabs.update(targetTabId, { url });
                if (t && t.status === "complete") {
                  done();
                }
              } catch (err) {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(onUpdated);
                return reject(err);
              }
            });
          } else {
            await new Promise((resolve, reject) => {
              chrome.tabs.update(targetTabId, { url }, (t) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                resolve(t);
              });
            });
          }

          stepResult.success = true;
          stepResult.tabId = targetTabId;
          stepResult.url = url;
          break;
        }

        case "close":
        case "close_tab":
        case "tabs.remove": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab to close");
          await new Promise((resolve, reject) => {
            chrome.tabs.remove(targetTabId, () => {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              resolve();
            });
          });
          agentControlledTabs.delete(targetTabId);
          if (currentTabId === targetTabId) {
            currentTabId = null;
          }
          if (bridgeClient && bridgeClient.lastAgentTabId === targetTabId) {
            bridgeClient.lastAgentTabId = null;
          }
          stepResult.success = true;
          stepResult.closedTabId = targetTabId;
          break;
        }

        case "wait_for_selector": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for wait_for_selector");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "wait_for_selector",
            selector: act.selector,
            timeoutMs: act.timeoutMs || act.timeout || 5000
          });
          if (!res || !res.success) throw new Error(res?.error || `Selector '${act.selector}' not found within timeout`);
          stepResult.success = true;
          stepResult.found = true;
          stepResult.details = res.details;
          break;
        }

        case "scroll_into_view": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for scroll_into_view");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "scroll_into_view",
            selector: act.selector,
            behavior: act.behavior || "auto"
          });
          if (!res || !res.success) throw new Error(res?.error || `Failed to scroll into view: ${act.selector}`);
          stepResult.success = true;
          stepResult.rect = res.rect;
          break;
        }

        case "click":
        case "page.click": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for click");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "click_cursor",
            selector: act.selector,
            x: act.x,
            y: act.y
          });
          if (!res || !res.success) throw new Error(res?.error || "Click failed");
          stepResult.success = true;
          stepResult.element = res.element;
          break;
        }

        case "type":
        case "page.type": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for type");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "type_text",
            selector: act.selector,
            text: act.text,
            clear: Boolean(act.clear),
            pressEnter: Boolean(act.pressEnter)
          });
          if (!res || !res.success) throw new Error(res?.error || "Type failed");
          stepResult.success = true;
          stepResult.textEntered = res.textEntered;
          break;
        }

        case "press_key":
        case "key": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for press_key");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "press_key",
            key: act.key || "Enter",
            selector: act.selector
          });
          stepResult.success = true;
          stepResult.key = act.key || "Enter";
          break;
        }

        case "scroll":
        case "page.scroll": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for scroll");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "scroll_page",
            deltaX: act.deltaX || 0,
            deltaY: act.deltaY || 0
          });
          stepResult.success = true;
          stepResult.scroll = res;
          break;
        }

        case "hover":
        case "page.hover": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for hover");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "virtual_hover",
            selector: act.selector
          });
          if (!res || !res.success) throw new Error(res?.error || "Hover failed");
          stepResult.success = true;
          stepResult.hover = res;
          break;
        }

        case "drag":
        case "page.drag": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for drag");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "virtual_drag",
            fromSelector: act.from || act.fromSelector,
            toSelector: act.to || act.toSelector,
            steps: act.steps || 8
          });
          if (!res || !res.success) throw new Error(res?.error || "Drag failed");
          stepResult.success = true;
          stepResult.drag = res;
          break;
        }

        case "wait_for": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for wait_for");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "wait_for",
            selector: act.selector,
            text: act.text,
            state: act.state || "visible",
            timeoutMs: act.timeoutMs || act.timeout || 10000
          });
          if (!res || !res.success) throw new Error(res?.error || "Wait timed out");
          stepResult.success = true;
          stepResult.waited = res;
          break;
        }

        case "upload":
        case "upload_file": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for upload");
          if (!attachedTabs.has(targetTabId)) {
            await attachDebugger(targetTabId);
          }
          const files = Array.isArray(act.files) ? act.files : (act.filePath ? [act.filePath] : (act.file ? [act.file] : []));
          const res = await uploadFileInput(targetTabId, act.selector, files);
          stepResult.success = true;
          stepResult.upload = res;
          break;
        }

        case "dialog":
        case "handle_dialog": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for dialog");
          if (!attachedTabs.has(targetTabId)) {
            await attachDebugger(targetTabId);
          }
          const res = await handleJavaScriptDialog(targetTabId, act.accept !== false, act.promptText || "");
          stepResult.success = true;
          stepResult.dialog = res;
          break;
        }

        case "sleep":
        case "wait": {
          if (act.selector || act.text) {
            const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for wait");
            await ensureContentScript(targetTabId);
            const res = await sendTabMessageWithRetry(targetTabId, {
              action: "wait_for",
              selector: act.selector,
              text: act.text,
              state: act.state || "visible",
              timeoutMs: act.timeoutMs || act.timeout || 10000
            });
            if (!res || !res.success) throw new Error(res?.error || "Wait timed out");
            stepResult.success = true;
            stepResult.waited = res;
            break;
          }
          const ms = Number(act.ms || act.duration || 1000);
          await new Promise(r => setTimeout(r, ms));
          stepResult.success = true;
          stepResult.ms = ms;
          break;
        }

        case "screenshot":
        case "page.screenshot": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for screenshot");
          const shotRes = await captureTabScreenshot(targetTabId, act);
          stepResult.success = true;
          if (params.omitDataUrls || act.omitDataUrl) {
            stepResult.dataUrlOmitted = true;
            stepResult.byteLength = shotRes.dataUrl ? shotRes.dataUrl.length : 0;
          } else {
            stepResult.dataUrl = shotRes.dataUrl;
          }
          stepResult.label = act.label || act.name || `step_${stepNum}`;
          break;
        }

        case "snapshot":
        case "page.snapshot": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for snapshot");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "get_snapshot",
            maxElements: act.maxElements || 80,
            format: act.format || "text"
          });
          stepResult.success = true;
          stepResult.snapshot = res?.result !== undefined ? res.result : res;
          break;
        }

        case "fill_form":
        case "fill":
        case "page.fillform": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for fill_form");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "fill_form",
            fields: act.fields || [],
            submitSelector: act.submitSelector || null,
            pressEnter: Boolean(act.pressEnter)
          });
          if (!res || !res.success) throw new Error(res?.error || "Fill form failed");
          stepResult.success = true;
          stepResult.filledCount = res.filledCount;
          stepResult.submitted = res.submitted;
          break;
        }

        case "get_element":
        case "page.getelement": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for get_element");
          await ensureContentScript(targetTabId);
          const res = await sendTabMessageWithRetry(targetTabId, {
            action: "get_element_info",
            selector: act.selector,
            x: act.x,
            y: act.y,
            includeStyles: Boolean(act.includeStyles)
          });
          if (!res || !res.success) throw new Error(res?.error || `Element not found: ${act.selector}`);
          stepResult.success = true;
          stepResult.element = res.details || res;
          break;
        }

        case "evaluate":
        case "eval": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for evaluate");
          await attachDebugger(targetTabId).catch((err) => logDebug("batch attachDebugger evaluate", err));
          const evalRes = await sendCdpCommand(targetTabId, "Runtime.evaluate", {
            expression: act.expression,
            returnByValue: true,
            awaitPromise: true
          });
          stepResult.success = true;
          stepResult.value = evalRes?.result?.value;
          break;
        }

        case "cdp": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for cdp");
          await attachDebugger(targetTabId).catch((err) => logDebug("batch attachDebugger cdp", err));
          const cdpRes = await sendCdpCommand(targetTabId, act.cdpMethod || act.method, act.cdpParams || act.params || {});
          stepResult.success = true;
          stepResult.result = cdpRes;
          break;
        }

        case "devtools":
        case "get_devtools_data": {
          const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : currentTabId;
          if (!targetTabId) throw new Error("No active tab for devtools");
          if (!attachedTabs.has(targetTabId)) {
            await attachDebugger(targetTabId).catch((err) => {
              console.warn("[AgentPilot] Batch auto-attach failed:", err);
            });
          }
          const buffer = getBuffer(targetTabId);
          const devType = act.devtoolsType || (["all", "console", "network", "performance"].includes(act.type) ? act.type : "all");
          const limit = Math.min(Math.max(Number(act.limit) || 50, 1), 200);

          let consoleData = undefined;
          let networkData = undefined;
          let perfData = undefined;

          if (devType === "all" || devType === "console") {
            consoleData = buffer.console.slice(-limit);
            if (act.clear) buffer.console = [];
          }
          if (devType === "all" || devType === "network") {
            networkData = Array.from(buffer.network.values()).slice(-limit);
            if (act.clear) buffer.network.clear();
          }
          if (devType === "all" || devType === "performance") {
            try {
              const pRes = await sendCdpCommand(targetTabId, "Performance.getMetrics");
              const mMap = {};
              (pRes.metrics || []).forEach(m => { mMap[m.name] = m.value; });
              perfData = {
                metrics: mMap,
                jsHeapUsedMB: mMap.JSHeapUsedSize ? +(mMap.JSHeapUsedSize / (1024 * 1024)).toFixed(2) : undefined,
                domNodes: mMap.Nodes,
                timestamp: Date.now()
              };
            } catch (pErr) {
              perfData = { error: pErr.message };
            }
          }

          stepResult.success = true;
          stepResult.tabId = targetTabId;
          stepResult.attached = attachedTabs.has(targetTabId);
          stepResult.summary = {
            consoleEntries: consoleData ? consoleData.length : 0,
            networkRequests: networkData ? networkData.length : 0,
            jsHeapUsedMB: perfData?.jsHeapUsedMB,
            domNodes: perfData?.domNodes
          };
          if (consoleData !== undefined) stepResult.console = consoleData;
          if (networkData !== undefined) stepResult.network = networkData;
          if (perfData !== undefined) stepResult.performance = perfData;
          break;
        }

        default:
          throw new Error(`Unsupported batch action type: ${type}`);
      }

      results.push(stepResult);
    } catch (stepErr) {
      stepResult.success = false;
      stepResult.error = stepErr.message || String(stepErr);
      results.push(stepResult);

      if (stopOnError) {
        return {
          success: false,
          error: `Batch execution halted at step ${stepNum} (${type}): ${stepErr.message || stepErr}`,
          failedStep: stepNum,
          totalActions: actions.length,
          executedActions: results.length,
          durationMs: Date.now() - startTime,
          results
        };
      }
    }
  }

  return {
    success: results.every(r => r.success),
    totalActions: actions.length,
    executedActions: results.length,
    durationMs: Date.now() - startTime,
    results
  };
}
