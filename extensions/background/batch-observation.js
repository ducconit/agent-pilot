/**
 * Agent Pilot - Batch action handlers: observation & utilities (wait / screenshot / snapshot / evaluate / devtools)
 *
 * Pure moves from the original batch-actions.js switch (behaviour unchanged).
 * Handlers receive the shared ctx { bridgeClient, currentTabId, params, stepResult, stepNum }
 * and mutate only ctx / shared browser bookkeeping.
 */

import {
  attachedTabs,
  getBuffer,
  logDebug,
  TIMEOUTS,
  LIMITS,
  DEFAULTS
} from "./constants.js";
import { attachDebugger, sendCdpCommand } from "./cdp-manager.js";
import {
  getTargetTabId,
  ensureContentScript,
  sendTabMessageWithRetry
} from "./tab-manager.js";
import { captureTabScreenshot } from "./screenshot-service.js";
import { getPositiveNumber } from "./batch-validation.js";

export const observationHandlers = {
  wait_for_selector: waitForSelectorAction,
  wait_for: waitForAction,
  sleep: sleepAction,
  screenshot: screenshotAction,
  snapshot: snapshotAction,
  get_element: getElementAction,
  evaluate: evaluateAction,
  cdp: cdpAction,
  devtools: devtoolsAction
};

async function resolveStepTabId(ctx, act) {
  if (!act.tabId) return ctx.currentTabId;
  const agentId = act.agentId || ctx.params?.agentId || null;
  if (ctx.bridgeClient && typeof ctx.bridgeClient.getTargetTabId === "function") {
    return await ctx.bridgeClient.getTargetTabId(act.tabId, agentId);
  }
  return await getTargetTabId(act.tabId, ctx.bridgeClient?.lastAgentTabId, {
    tabOwners: ctx.bridgeClient?.tabOwners,
    agentId
  });
}

/** wait_for_selector — poll the content script until the selector matches. */
async function waitForSelectorAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
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

/** wait_for — wait for a selector/text/state via the content script. */
async function waitForAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
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

/**
 * sleep / wait — either a plain sleep, or (when a selector/text is supplied) a
 * content-script `wait_for`, matching the historical overload.
 */
async function sleepAction(ctx, act) {
  if (act.selector || act.text) {
    const targetTabId = await resolveStepTabId(ctx, act);
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
  const targetTabId = await resolveStepTabId(ctx, act);
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
  const targetTabId = await resolveStepTabId(ctx, act);
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

/** get_element / page.getelement — retrieve element details by selector/point. */
async function getElementAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
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
  const targetTabId = await resolveStepTabId(ctx, act);
  if (!targetTabId) throw new Error("No active tab for evaluate");
  await attachDebugger(targetTabId).catch((err) => logDebug("batch attachDebugger evaluate", err));
  const evalRes = await sendCdpCommand(targetTabId, "Runtime.evaluate", {
    expression: act.expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (evalRes?.exceptionDetails) {
    throw new Error(evalRes.exceptionDetails.exception?.description || evalRes.exceptionDetails.text || "Evaluation threw an exception");
  }
  ctx.stepResult.success = true;
  ctx.stepResult.value = evalRes?.result?.value;
}

/** cdp — escape hatch to send an arbitrary CDP method on the target tab. */
async function cdpAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
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
  const targetTabId = await resolveStepTabId(ctx, act);
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
