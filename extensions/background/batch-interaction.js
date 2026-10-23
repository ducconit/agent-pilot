/**
 * Agent Pilot - Batch action handlers: interaction (click / type / scroll / hover / drag / upload / dialog / fill)
 *
 * Pure moves from the original batch-actions.js switch (behaviour unchanged).
 * Handlers receive the shared ctx { bridgeClient, currentTabId, params, stepResult, stepNum }
 * and mutate only ctx / shared browser bookkeeping.
 */

import {
  attachedTabs,
  DEFAULTS,
  LIMITS,
  logDebug
} from "./constants.js";
import {
  attachDebugger,
  ensureCdpAttached,
  dispatchCdpMouseClick,
  dispatchCdpMouseDrag,
  uploadFileInput,
  handleJavaScriptDialog
} from "./cdp-manager.js";
import {
  getTargetTabId,
  sendTabMessageWithRetry
} from "./tab-manager.js";
import { normalizeVia, resolvePoint } from "./batch-validation.js";

export const interactionHandlers = {
  click: clickAction,
  type: typeAction,
  press_key: pressKeyAction,
  scroll: scrollAction,
  hover: hoverAction,
  drag: dragAction,
  upload: uploadAction,
  dialog: dialogAction,
  fill_form: fillFormAction,
  scroll_into_view: scrollIntoViewAction
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

async function attachStepSnapshotIfRequested(ctx, tabId, act) {
  if (!act?.includeSnapshot || !tabId) return;
  try {
    const snapRes = await sendTabMessageWithRetry(tabId, {
      action: "get_snapshot",
      maxElements: act.snapshotMaxElements || act.maxElements || LIMITS.SNAPSHOT_MAX_ELEMENTS_DEFAULT,
      format: act.snapshotFormat || "text"
    });
    ctx.stepResult.snapshot = snapRes?.result !== undefined ? snapRes.result : snapRes;
  } catch (err) {
    logDebug("batch interaction includeSnapshot", err);
  }
}

/** scroll_into_view — ask the content script to scroll an element into view. */
async function scrollIntoViewAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
  if (!targetTabId) throw new Error("No active tab for scroll_into_view");
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "scroll_into_view",
    selector: act.selector,
    behavior: act.behavior || "auto"
  });
  if (!res || !res.success) throw new Error(res?.error || `Failed to scroll into view: ${act.selector}`);
  await attachStepSnapshotIfRequested(ctx, targetTabId, act);
  ctx.stepResult.success = true;
  ctx.stepResult.rect = res.rect;
}

/**
 * click / page.click — prefer a trusted CDP click when `via` is cdp/auto
 * (falling back to the synthetic content-script click on CDP failure for
 * "auto"), otherwise click via the content script.
 */
async function clickAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
  if (!targetTabId) throw new Error("No active tab for click");
  const via = normalizeVia(act);
  const clickCount = (act.dblClick || act.doubleClick) ? 2 : (Number(act.clickCount) || 1);
  if (via !== "synthetic") {
    try {
      const point = await resolvePoint(targetTabId, act.x, act.y, act.selector, "click");
      await sendTabMessageWithRetry(targetTabId, {
        action: "animate_cursor_click",
        x: point.x,
        y: point.y
      }).catch((err) => logDebug("batch visual cursor animation note", err));
      await ensureCdpAttached(targetTabId);
      ctx.stepResult.result = await dispatchCdpMouseClick(targetTabId, point.x, point.y, {
        button: act.button || "left",
        clickCount,
        dblClick: Boolean(act.dblClick || act.doubleClick)
      });
      await attachStepSnapshotIfRequested(ctx, targetTabId, act);
      ctx.stepResult.success = true;
      ctx.stepResult.via = "cdp";
      return;
    } catch (err) {
      if (via !== "auto") throw err;
      logDebug("batch CDP click fallback", err);
    }
  }
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "click_cursor",
    selector: act.selector,
    x: act.x,
    y: act.y,
    clickCount
  });
  if (!res || !res.success) throw new Error(res?.error || "Click failed");
  await attachStepSnapshotIfRequested(ctx, targetTabId, act);
  ctx.stepResult.success = true;
  ctx.stepResult.element = res.element;
}

/** type / page.type — type text into an element via the content script. */
async function typeAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
  if (!targetTabId) throw new Error("No active tab for type");
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "type_text",
    selector: act.selector,
    text: act.text,
    clear: Boolean(act.clear),
    pressEnter: Boolean(act.pressEnter)
  });
  if (!res || !res.success) throw new Error(res?.error || "Type failed");
  await attachStepSnapshotIfRequested(ctx, targetTabId, act);
  ctx.stepResult.success = true;
  ctx.stepResult.textEntered = res.textEntered;
}

/** press_key / key — dispatch a key press via the content script. */
async function pressKeyAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
  if (!targetTabId) throw new Error("No active tab for press_key");
  await sendTabMessageWithRetry(targetTabId, {
    action: "press_key",
    key: act.key || "Enter",
    selector: act.selector
  });
  await attachStepSnapshotIfRequested(ctx, targetTabId, act);
  ctx.stepResult.success = true;
  ctx.stepResult.key = act.key || "Enter";
}

/** scroll / page.scroll — scroll the page by a delta. */
async function scrollAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
  if (!targetTabId) throw new Error("No active tab for scroll");
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "scroll_page",
    deltaX: act.deltaX || 0,
    deltaY: act.deltaY || 0
  });
  await attachStepSnapshotIfRequested(ctx, targetTabId, act);
  ctx.stepResult.success = true;
  ctx.stepResult.scroll = res;
}

/** hover / page.hover — hover an element via the content script. */
async function hoverAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
  if (!targetTabId) throw new Error("No active tab for hover");
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "virtual_hover",
    selector: act.selector
  });
  if (!res || !res.success) throw new Error(res?.error || "Hover failed");
  await attachStepSnapshotIfRequested(ctx, targetTabId, act);
  ctx.stepResult.success = true;
  ctx.stepResult.hover = res;
}

/**
 * drag / page.drag — interpolated CDP drag when possible; on "auto" with both
 * selectors present, fall back to the synthetic content-script drag.
 */
async function dragAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
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
      await attachStepSnapshotIfRequested(ctx, targetTabId, act);
      ctx.stepResult.success = true;
      ctx.stepResult.via = "cdp";
      return;
    } catch (err) {
      if (via !== "auto" || !fromSelector || !toSelector) throw err;
      logDebug("batch CDP drag fallback", err);
    }
  }
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "virtual_drag",
    fromSelector,
    toSelector,
    steps: act.steps || DEFAULTS.DRAG_STEPS
  });
  if (!res || !res.success) throw new Error(res?.error || "Drag failed");
  await attachStepSnapshotIfRequested(ctx, targetTabId, act);
  ctx.stepResult.success = true;
  ctx.stepResult.drag = res;
}

/** upload / upload_file — set files on a file input via CDP or synthetic DataTransfer fallback. */
async function uploadAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
  if (!targetTabId) throw new Error("No active tab for upload");
  const files = Array.isArray(act.files) ? act.files : (act.filePath ? [act.filePath] : (act.file ? [act.file] : []));
  const res = await uploadFileInput(targetTabId, act.selector, files, {
    via: act.via,
    filePayloads: act.filePayloads,
    broadcastFn: ctx.bridgeClient?.broadcastFn
  });
  await attachStepSnapshotIfRequested(ctx, targetTabId, act);
  ctx.stepResult.success = true;
  ctx.stepResult.upload = res;
}

/** dialog / handle_dialog — accept/dismiss a JavaScript dialog via CDP. */
async function dialogAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
  if (!targetTabId) throw new Error("No active tab for dialog");
  if (!attachedTabs.has(targetTabId)) {
    await attachDebugger(targetTabId);
  }
  const res = await handleJavaScriptDialog(targetTabId, act.accept !== false, act.promptText || "");
  await attachStepSnapshotIfRequested(ctx, targetTabId, act);
  ctx.stepResult.success = true;
  ctx.stepResult.dialog = res;
}

/** fill_form / fill / page.fillform — fill (and optionally submit) form fields. */
async function fillFormAction(ctx, act) {
  const targetTabId = await resolveStepTabId(ctx, act);
  if (!targetTabId) throw new Error("No active tab for fill_form");
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "fill_form",
    fields: act.fields || [],
    submitSelector: act.submitSelector || null,
    pressEnter: Boolean(act.pressEnter)
  });
  if (!res || !res.success) throw new Error(res?.error || "Fill form failed");
  await attachStepSnapshotIfRequested(ctx, targetTabId, act);
  ctx.stepResult.success = true;
  ctx.stepResult.filledCount = res.filledCount;
  ctx.stepResult.submitted = res.submitted;
}
