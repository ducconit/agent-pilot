/**
 * Agent Pilot - Batch Action Handlers
 *
 * One handler per batch action, extracted from the executor's switch. Handlers
 * keep no executor-loop state of their own: everything they need is passed in
 * via `ctx`, and they mutate `ctx` (never executor locals) so the executor
 * remains the single owner of the loop's mutable state. They may still touch
 * shared browser bookkeeping (agent tab sets, devtools buffers, chrome.* APIs).
 *
 * ctx shape: { bridgeClient, currentTabId, params, stepResult, stepNum }
 *   - currentTabId: mutable; handlers may reassign ctx.currentTabId
 *   - stepResult:   the per-step result object handlers fill in
 *   - params:       the original executeBatchActions params (e.g. omitDataUrls)
 *
 * Aliases (e.g. "open_tab", "tabs.create") intentionally point at the same
 * handler so behaviour is identical to the previous grouped switch cases.
 */

import {
  agentControlledTabs,
  normalizeUrl,
  DEFAULT_LOAD_TIMEOUT_MS,
  attachedTabs,
  getBuffer,
  logDebug,
  TIMEOUTS,
  LIMITS,
  DEFAULTS
} from "./constants.js";
import {
  attachDebugger,
  sendCdpCommand,
  uploadFileInput,
  handleJavaScriptDialog,
  ensureCdpAttached,
  dispatchCdpMouseClick,
  dispatchCdpMouseDrag
} from "./cdp-manager.js";
import {
  getActiveTabId,
  getTargetTabId,
  assignTabToAgentGroup,
  ensureContentScript,
  sendTabMessageWithRetry
} from "./tab-manager.js";
import { captureTabScreenshot } from "./screenshot-service.js";
import { getPositiveNumber, normalizeVia, resolvePoint } from "./batch-validation.js";

/**
 * open / open_tab / tabs.create — create a tab (optionally background), attach
 * the debugger and wait for load completion.
 */
async function openAction(ctx, act) {
  const { bridgeClient } = ctx;
  const url = normalizeUrl(act.url || "https://google.com");
  const makeActive = act.active === true;
  const activeTabBefore = !makeActive ? await getActiveTabId() : null;

  const tab = await new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: makeActive }, (t) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(t);
    });
  });

  ctx.currentTabId = tab.id;
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
    const loadTimeout = getPositiveNumber(act.loadTimeout, act.timeoutMs, act.timeout) || DEFAULT_LOAD_TIMEOUT_MS;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };

      const timeout = setTimeout(finish, loadTimeout);

      const onUpdated = (tId, changeInfo) => {
        if (tId === tab.id && changeInfo.status === "complete") {
          finish();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);

      chrome.tabs.get(tab.id, (cur) => {
        if (!chrome.runtime.lastError && cur && cur.status === "complete") {
          finish();
        }
      });
    });
  }

  ctx.stepResult.success = true;
  ctx.stepResult.tabId = tab.id;
  ctx.stepResult.url = tab.url || tab.pendingUrl || url;
}

/**
 * navigate / tabs.update — navigate an explicit or current tab, optionally
 * waiting for load completion.
 */
async function navigateAction(ctx, act) {
  const { bridgeClient } = ctx;
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for navigate");
  const url = normalizeUrl(act.url);

  if (act.waitUntil !== false) {
    const loadTimeout = getPositiveNumber(act.loadTimeout, act.timeoutMs, act.timeout) || DEFAULT_LOAD_TIMEOUT_MS;
    await new Promise((resolve, reject) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      };

      const timeout = setTimeout(done, loadTimeout);

      const onUpdated = (tId, changeInfo) => {
        if (tId === targetTabId && changeInfo.status === "complete") {
          done();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);

      chrome.tabs.update(targetTabId, { url }, (t) => {
        if (chrome.runtime.lastError) {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (t && t.status === "complete") {
          done();
        }
      });
    });
  } else {
    await new Promise((resolve, reject) => {
      chrome.tabs.update(targetTabId, { url }, (t) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(t);
      });
    });
  }

  ctx.stepResult.success = true;
  ctx.stepResult.tabId = targetTabId;
  ctx.stepResult.url = url;
}

/**
 * close / close_tab / tabs.remove — close a tab and clear any agent bookkeeping
 * that pointed at it.
 */
async function closeAction(ctx, act) {
  const { bridgeClient } = ctx;
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab to close");
  await new Promise((resolve, reject) => {
    chrome.tabs.remove(targetTabId, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve();
    });
  });
  agentControlledTabs.delete(targetTabId);
  if (ctx.currentTabId === targetTabId) {
    ctx.currentTabId = null;
  }
  if (bridgeClient && bridgeClient.lastAgentTabId === targetTabId) {
    bridgeClient.lastAgentTabId = null;
  }
  ctx.stepResult.success = true;
  ctx.stepResult.closedTabId = targetTabId;
}

/** wait_for_selector — poll the content script until the selector matches. */
async function waitForSelectorAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for wait_for_selector");
  await ensureContentScript(targetTabId);
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "wait_for_selector",
    selector: act.selector,
    timeoutMs: getPositiveNumber(act.timeoutMs, act.timeout) || TIMEOUTS.BATCH_WAIT_SELECTOR_MS
  });
  if (!res || !res.success) throw new Error(res?.error || `Selector '${act.selector}' not found within timeout`);
  ctx.stepResult.success = true;
  ctx.stepResult.found = true;
  ctx.stepResult.details = res.details;
}

/** scroll_into_view — ask the content script to scroll an element into view. */
async function scrollIntoViewAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for scroll_into_view");
  await ensureContentScript(targetTabId);
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "scroll_into_view",
    selector: act.selector,
    behavior: act.behavior || "auto"
  });
  if (!res || !res.success) throw new Error(res?.error || `Failed to scroll into view: ${act.selector}`);
  ctx.stepResult.success = true;
  ctx.stepResult.rect = res.rect;
}

/**
 * click / page.click — prefer a trusted CDP click when `via` is cdp/auto
 * (falling back to the synthetic content-script click on CDP failure for
 * "auto"), otherwise click via the content script.
 */
async function clickAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for click");
  const via = normalizeVia(act);
  if (via !== "synthetic") {
    try {
      const point = await resolvePoint(targetTabId, act.x, act.y, act.selector, "click");
      await ensureCdpAttached(targetTabId);
      ctx.stepResult.result = await dispatchCdpMouseClick(targetTabId, point.x, point.y, {
        button: act.button || "left",
        clickCount: act.clickCount || 1
      });
      ctx.stepResult.success = true;
      ctx.stepResult.via = "cdp";
      return;
    } catch (err) {
      if (via !== "auto") throw err;
      logDebug("batch CDP click fallback", err);
    }
  }
  await ensureContentScript(targetTabId);
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "click_cursor",
    selector: act.selector,
    x: act.x,
    y: act.y
  });
  if (!res || !res.success) throw new Error(res?.error || "Click failed");
  ctx.stepResult.success = true;
  ctx.stepResult.element = res.element;
}

/** type / page.type — type text into an element via the content script. */
async function typeAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
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
  ctx.stepResult.success = true;
  ctx.stepResult.textEntered = res.textEntered;
}

/** press_key / key — dispatch a key press via the content script. */
async function pressKeyAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for press_key");
  await ensureContentScript(targetTabId);
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "press_key",
    key: act.key || "Enter",
    selector: act.selector
  });
  ctx.stepResult.success = true;
  ctx.stepResult.key = act.key || "Enter";
}

/** scroll / page.scroll — scroll the page by a delta. */
async function scrollAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for scroll");
  await ensureContentScript(targetTabId);
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "scroll_page",
    deltaX: act.deltaX || 0,
    deltaY: act.deltaY || 0
  });
  ctx.stepResult.success = true;
  ctx.stepResult.scroll = res;
}

/** hover / page.hover — hover an element via the content script. */
async function hoverAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for hover");
  await ensureContentScript(targetTabId);
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "virtual_hover",
    selector: act.selector
  });
  if (!res || !res.success) throw new Error(res?.error || "Hover failed");
  ctx.stepResult.success = true;
  ctx.stepResult.hover = res;
}

/**
 * drag / page.drag — interpolated CDP drag when possible; on "auto" with both
 * selectors present, fall back to the synthetic content-script drag.
 */
async function dragAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for drag");
  const via = normalizeVia(act);
  const fromSelector = act.from || act.fromSelector;
  const toSelector = act.to || act.toSelector;
  if (via !== "synthetic") {
    try {
      const fromPoint = await resolvePoint(targetTabId, act.fromX, act.fromY, fromSelector, "drag source");
      const toPoint = await resolvePoint(targetTabId, act.toX, act.toY, toSelector, "drag target");
      await ensureCdpAttached(targetTabId);
      ctx.stepResult.result = await dispatchCdpMouseDrag(
        targetTabId,
        fromPoint.x,
        fromPoint.y,
        toPoint.x,
        toPoint.y,
        { steps: act.steps || DEFAULTS.DRAG_STEPS_CDP, holdMs: act.holdMs || act.hold || 0 }
      );
      ctx.stepResult.success = true;
      ctx.stepResult.via = "cdp";
      return;
    } catch (err) {
      if (via !== "auto" || !fromSelector || !toSelector) throw err;
      logDebug("batch CDP drag fallback", err);
    }
  }
  await ensureContentScript(targetTabId);
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "virtual_drag",
    fromSelector,
    toSelector,
    steps: act.steps || DEFAULTS.DRAG_STEPS
  });
  if (!res || !res.success) throw new Error(res?.error || "Drag failed");
  ctx.stepResult.success = true;
  ctx.stepResult.drag = res;
}

/** wait_for — wait for a selector/text/state via the content script. */
async function waitForAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for wait_for");
  await ensureContentScript(targetTabId);
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "wait_for",
    selector: act.selector,
    text: act.text,
    state: act.state || "visible",
    timeoutMs: getPositiveNumber(act.timeoutMs, act.timeout) || DEFAULTS.WAIT_FOR_TIMEOUT_MS
  });
  if (!res || !res.success) throw new Error(res?.error || "Wait timed out");
  ctx.stepResult.success = true;
  ctx.stepResult.waited = res;
}

/** upload / upload_file — set files on a file input via CDP. */
async function uploadAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for upload");
  if (!attachedTabs.has(targetTabId)) {
    await attachDebugger(targetTabId);
  }
  const files = Array.isArray(act.files) ? act.files : (act.filePath ? [act.filePath] : (act.file ? [act.file] : []));
  const res = await uploadFileInput(targetTabId, act.selector, files);
  ctx.stepResult.success = true;
  ctx.stepResult.upload = res;
}

/** dialog / handle_dialog — accept/dismiss a JavaScript dialog via CDP. */
async function dialogAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for dialog");
  if (!attachedTabs.has(targetTabId)) {
    await attachDebugger(targetTabId);
  }
  const res = await handleJavaScriptDialog(targetTabId, act.accept !== false, act.promptText || "");
  ctx.stepResult.success = true;
  ctx.stepResult.dialog = res;
}

/**
 * sleep / wait — either a plain sleep, or (when a selector/text is supplied) a
 * content-script `wait_for`, matching the historical overload.
 */
async function sleepAction(ctx, act) {
  if (act.selector || act.text) {
    const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
    if (!targetTabId) throw new Error("No active tab for wait");
    await ensureContentScript(targetTabId);
    const res = await sendTabMessageWithRetry(targetTabId, {
      action: "wait_for",
      selector: act.selector,
      text: act.text,
      state: act.state || "visible",
      timeoutMs: getPositiveNumber(act.timeoutMs, act.timeout) || DEFAULTS.WAIT_FOR_TIMEOUT_MS
    });
    if (!res || !res.success) throw new Error(res?.error || "Wait timed out");
    ctx.stepResult.success = true;
    ctx.stepResult.waited = res;
    return;
  }
  const ms = getPositiveNumber(act.ms, act.duration) || TIMEOUTS.BATCH_SLEEP_MS;
  await new Promise(r => setTimeout(r, ms));
  ctx.stepResult.success = true;
  ctx.stepResult.ms = ms;
}

/**
 * screenshot / page.screenshot — capture the tab, honouring the batch-level
 * `omitDataUrls` RAM guard (only a byte length is returned in that case).
 */
async function screenshotAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for screenshot");
  const shotRes = await captureTabScreenshot(targetTabId, act);
  ctx.stepResult.success = true;
  if (ctx.params.omitDataUrls || act.omitDataUrl) {
    ctx.stepResult.dataUrlOmitted = true;
    ctx.stepResult.byteLength = shotRes.dataUrl ? shotRes.dataUrl.length : 0;
  } else {
    ctx.stepResult.dataUrl = shotRes.dataUrl;
  }
  ctx.stepResult.label = act.label || act.name || `step_${ctx.stepNum}`;
}

/** snapshot / page.snapshot — fetch a text/DOM snapshot from the content script. */
async function snapshotAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for snapshot");
  await ensureContentScript(targetTabId);
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "get_snapshot",
    maxElements: act.maxElements || LIMITS.SNAPSHOT_MAX_ELEMENTS_DEFAULT,
    format: act.format || "text"
  });
  ctx.stepResult.success = true;
  ctx.stepResult.snapshot = res?.result !== undefined ? res.result : res;
}

/** fill_form / fill / page.fillform — fill (and optionally submit) form fields. */
async function fillFormAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for fill_form");
  await ensureContentScript(targetTabId);
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "fill_form",
    fields: act.fields || [],
    submitSelector: act.submitSelector || null,
    pressEnter: Boolean(act.pressEnter)
  });
  if (!res || !res.success) throw new Error(res?.error || "Fill form failed");
  ctx.stepResult.success = true;
  ctx.stepResult.filledCount = res.filledCount;
  ctx.stepResult.submitted = res.submitted;
}

/** get_element / page.getelement — retrieve element details by selector/point. */
async function getElementAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
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
  ctx.stepResult.success = true;
  ctx.stepResult.element = res.details || res;
}

/** evaluate / eval — run an expression in the page via CDP Runtime.evaluate. */
async function evaluateAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for evaluate");
  await attachDebugger(targetTabId).catch((err) => logDebug("batch attachDebugger evaluate", err));
  const evalRes = await sendCdpCommand(targetTabId, "Runtime.evaluate", {
    expression: act.expression,
    returnByValue: true,
    awaitPromise: true
  });
  ctx.stepResult.success = true;
  ctx.stepResult.value = evalRes?.result?.value;
}

/** cdp — escape hatch to send an arbitrary CDP method on the target tab. */
async function cdpAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for cdp");
  await attachDebugger(targetTabId).catch((err) => logDebug("batch attachDebugger cdp", err));
  const cdpRes = await sendCdpCommand(targetTabId, act.cdpMethod || act.method, act.cdpParams || act.params || {});
  ctx.stepResult.success = true;
  ctx.stepResult.result = cdpRes;
}

/**
 * devtools / get_devtools_data — read the buffered console/network/performance
 * data for a tab (optionally clearing the buffers).
 */
async function devtoolsAction(ctx, act) {
  const targetTabId = act.tabId ? await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId) : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for devtools");
  if (!attachedTabs.has(targetTabId)) {
    await attachDebugger(targetTabId).catch((err) => {
      console.warn("[AgentPilot] Batch auto-attach failed:", err);
    });
  }
  const buffer = getBuffer(targetTabId);
  // `source` only selects a specific devtools stream when it is one of the known
  // types; any other value (or only devtoolsType) falls back to "all".
  const devType = act.devtoolsType || (["all", "console", "network", "performance"].includes(act.source) ? act.source : "all");
  const limit = Math.min(Math.max(Number(act.limit) || LIMITS.DEVTOOLS_FETCH_DEFAULT, 1), LIMITS.DEVTOOLS_FETCH_MAX);

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

  ctx.stepResult.success = true;
  ctx.stepResult.tabId = targetTabId;
  ctx.stepResult.attached = attachedTabs.has(targetTabId);
  ctx.stepResult.summary = {
    consoleEntries: consoleData ? consoleData.length : 0,
    networkRequests: networkData ? networkData.length : 0,
    jsHeapUsedMB: perfData?.jsHeapUsedMB,
    domNodes: perfData?.domNodes
  };
  if (consoleData !== undefined) ctx.stepResult.console = consoleData;
  if (networkData !== undefined) ctx.stepResult.network = networkData;
  if (perfData !== undefined) ctx.stepResult.performance = perfData;
}

/**
 * Dispatch table keyed by the normalized (lower-cased) action type. Aliases
 * share a handler, preserving the original grouped switch semantics.
 */
export const BATCH_ACTION_HANDLERS = {
  open: openAction,
  open_tab: openAction,
  "tabs.create": openAction,

  navigate: navigateAction,
  "tabs.update": navigateAction,

  close: closeAction,
  close_tab: closeAction,
  "tabs.remove": closeAction,

  wait_for_selector: waitForSelectorAction,

  scroll_into_view: scrollIntoViewAction,

  click: clickAction,
  "page.click": clickAction,

  type: typeAction,
  "page.type": typeAction,

  press_key: pressKeyAction,
  key: pressKeyAction,

  scroll: scrollAction,
  "page.scroll": scrollAction,

  hover: hoverAction,
  "page.hover": hoverAction,

  drag: dragAction,
  "page.drag": dragAction,

  wait_for: waitForAction,

  upload: uploadAction,
  upload_file: uploadAction,

  dialog: dialogAction,
  handle_dialog: dialogAction,

  sleep: sleepAction,
  wait: sleepAction,

  screenshot: screenshotAction,
  "page.screenshot": screenshotAction,

  snapshot: snapshotAction,
  "page.snapshot": snapshotAction,

  fill_form: fillFormAction,
  fill: fillFormAction,
  "page.fillform": fillFormAction,

  get_element: getElementAction,
  "page.getelement": getElementAction,

  evaluate: evaluateAction,
  eval: evaluateAction,

  cdp: cdpAction,

  devtools: devtoolsAction,
  get_devtools_data: devtoolsAction
};
