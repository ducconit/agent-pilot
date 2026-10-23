/**
 * Agent Pilot - Agent bridge handlers: page interaction (input & navigation of the DOM)
 * Moved verbatim from bridge-client.js; behaviour must stay identical.
 * All handlers run inside the per-tab lock so concurrent agent steps cannot interleave.
 */

import {
  attachedTabs,
  DEFAULTS,
  NO_TARGET_TAB_ERROR,
  logDebug
} from "../constants.js";
import {
  attachDebugger,
  sendCdpCommand,
  ensureCdpAttached,
  dispatchCdpMouseClick,
  dispatchCdpMouseMove,
  dispatchCdpMouseDrag,
  dispatchCdpKeyEvent,
  uploadFileInput
} from "../cdp-manager.js";
import { getPositiveNumber } from "../batch-validation.js";

const DEFAULT_EVAL_SCRIPTING_TIMEOUT_MS = 3500;
const DEFAULT_EVAL_CDP_TIMEOUT_MS = 5000;

/**
 * Shared page evaluation helper (MAIN world scripting first, CDP Runtime.evaluate fallback).
 * Bounds both MAIN-world executeScript and CDP Runtime.evaluate with timeouts so a wedged
 * main thread (e.g. infinite reactivity loop) fails fast instead of hanging the bridge for 15s.
 */
export async function evaluateInTab(tabId, script, broadcastFn = null, options = {}) {
  const requestedTimeout = Number(options?.timeoutMs || options?.timeout);
  const scriptingTimeoutMs =
    Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.max(100, Math.min(requestedTimeout, 4000))
      : DEFAULT_EVAL_SCRIPTING_TIMEOUT_MS;
  const cdpTimeoutMs =
    Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.max(100, Math.min(requestedTimeout, 10000))
      : DEFAULT_EVAL_CDP_TIMEOUT_MS;
  let scriptingTimedOut = false;

  // Attempt 1: Execute in MAIN world for direct window/DOM framework access
  if (typeof chrome !== "undefined" && chrome.scripting && chrome.scripting.executeScript) {
    let mainWorldRan = false;
    let userEvalError = null;
    let timerId = null;
    try {
      const execPromise = chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (code) => {
          try {
            const rawVal = window.eval(code);
            const value = await Promise.resolve(rawVal);
            return { __eval_ok: true, value };
          } catch (e) {
            return {
              __eval_err: true,
              name: e?.name || "",
              message: e?.message || String(e),
              stack: e?.stack
            };
          }
        },
        args: [script]
      });
      const timeoutPromise = new Promise((resolve) => {
        timerId = setTimeout(() => {
          resolve([{ result: { __eval_timeout: true, timeoutMs: scriptingTimeoutMs } }]);
        }, scriptingTimeoutMs);
      });
      const results = await Promise.race([execPromise, timeoutPromise]);
      if (results && results[0] && results[0].result) {
        const resObj = results[0].result;
        if (resObj.__eval_timeout) {
          scriptingTimedOut = true;
          logDebug(`evaluateInTab MAIN world timed out after ${scriptingTimeoutMs}ms, falling back to CDP`);
        } else if (resObj.__eval_err) {
          const isCspEvalError =
            resObj.name === "EvalError" ||
            (typeof resObj.message === "string" && resObj.message.includes("unsafe-eval"));
          if (!isCspEvalError) {
            mainWorldRan = true;
            userEvalError = new Error(resObj.message);
          }
        } else {
          return resObj.value;
        }
      }
    } catch (scriptingErr) {
      logDebug("evaluate in MAIN world fallback to CDP", scriptingErr);
    } finally {
      if (timerId !== null) clearTimeout(timerId);
    }

    if (mainWorldRan && userEvalError) {
      throw userEvalError;
    }
  }

  // Attempt 2: Fallback to CDP Runtime.evaluate with V8 execution timeout
  if (!attachedTabs.has(tabId)) {
    await attachDebugger(tabId, broadcastFn).catch((err) => logDebug("evaluate attachDebugger", err));
  }
  let evalRes;
  try {
    evalRes = await sendCdpCommand(
      tabId,
      "Runtime.evaluate",
      {
        expression: script,
        returnByValue: true,
        awaitPromise: true,
        timeout: cdpTimeoutMs
      },
      cdpTimeoutMs + 1000
    );
  } catch (cdpErr) {
    if (scriptingTimedOut) {
      throw new Error(
        `MAIN_THREAD_BLOCKED: Page main thread did not respond to page.evaluate within ${scriptingTimeoutMs}ms (${cdpErr?.message || String(cdpErr)})`
      );
    }
    throw cdpErr;
  }
  if (evalRes?.exceptionDetails) {
    throw new Error(evalRes.exceptionDetails.exception?.description || evalRes.exceptionDetails.text);
  }
  return evalRes && evalRes.result ? evalRes.result.value : evalRes;
}

/**
 * Executes optional inline wait on a target tab:
 * 1. If params.waitForSelector or params.waitForText is non-empty, sends a `wait_for`
 *    command to the content script on `tabId` (throwing if the wait times out).
 * 2. If a positive sleep duration is specified via `waitMs`, `sleepMs`, `sleep`, or
 *    numeric `wait`, sleeps for that many milliseconds.
 * Returns metadata `{ waitedMs, waitForResult }` when any wait was executed, or `null` otherwise.
 */
export async function runInlineWait(client, tabId, params = {}) {
  if (!params || typeof params !== "object") return null;

  const waitForSelector = typeof params.waitForSelector === "string" ? params.waitForSelector.trim() : "";
  const waitForText = typeof params.waitForText === "string" ? params.waitForText.trim() : "";
  let sleepMs = 0;
  try {
    sleepMs = getPositiveNumber(params.waitMs, params.sleepMs, params.sleep, params.wait) || 0;
  } catch (_) {
    sleepMs = 0;
  }

  if (!waitForSelector && !waitForText && sleepMs <= 0) {
    return null;
  }

  const startTime = Date.now();
  let waitForResult = undefined;

  if ((waitForSelector || waitForText) && client && typeof client.sendTabMessageWithRetry === "function") {
    let timeoutMs = DEFAULTS.WAIT_FOR_TIMEOUT_MS;
    try {
      timeoutMs = getPositiveNumber(params.timeoutMs, params.timeout) || DEFAULTS.WAIT_FOR_TIMEOUT_MS;
    } catch (_) {}

    waitForResult = await client.sendTabMessageWithRetry(tabId, {
      action: "wait_for",
      selector: waitForSelector || undefined,
      text: waitForText || undefined,
      state: params.waitForState || "visible",
      timeoutMs
    });
    if (waitForResult && waitForResult.success === false) {
      throw new Error(waitForResult.error || `Timed out waiting after ${timeoutMs}ms for ${waitForSelector || waitForText}`);
    }
  }

  if (sleepMs > 0) {
    await new Promise((r) => setTimeout(r, sleepMs));
  }

  return {
    waitedMs: Date.now() - startTime,
    ...(waitForResult ? { waitForResult } : {})
  };
}

export function mergeWaitMeta(res, waitMeta) {
  if (!waitMeta) return res;
  if (res && typeof res === "object" && !Array.isArray(res)) {
    return {
      ...res,
      waitedMs: (Number(res.waitedMs) || 0) + waitMeta.waitedMs,
      ...(waitMeta.waitForResult ? { waitForResult: waitMeta.waitForResult } : {})
    };
  }
  return res;
}

export const pageInputHandlers = {
  "page.evaluate": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    const script = params.script || params.expression || params.code || "";
    if (!script) return respond(null, new Error("Missing script or expression to evaluate"));

    client.runWithTabLock(tabId, "page.evaluate", async () => {
      const evalRes = await evaluateInTab(tabId, script, client.broadcastFn, params);
      await runInlineWait(client, tabId, params);
      return evalRes;
    })
      .then(res => respond(res !== undefined ? res : null))
      .catch(err => respond(null, err));
  },

  "page.moveMouse": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    client.runWithTabLock(tabId, "page.moveMouse", async () => {
      const res = await client.sendTabMessageWithRetry(tabId, {
        action: "move_cursor",
        x: params.x,
        y: params.y,
        duration: params.duration || DEFAULTS.MOVE_DURATION_MS
      });
      const waitMeta = await runInlineWait(client, tabId, params);
      return mergeWaitMeta(res || { success: true }, waitMeta);
    })
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.click": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    const via = client.normalizeVia(params);
    if (via === "synthetic") {
      client.runWithTabLock(tabId, "page.click", async () => {
        const res = await client.sendTabMessageWithRetry(tabId, {
          action: "click_cursor",
          x: params.x,
          y: params.y,
          selector: params.selector
        });
        const waitMeta = await runInlineWait(client, tabId, params);
        return mergeWaitMeta(res || { success: true }, waitMeta);
      })
        .then(res => respond(res || { success: true }))
        .catch(err => respond(null, err));
      return;
    }
    client.runWithTabLock(tabId, "page.click", async () => {
      let clickRes;
      try {
        const point = await client.resolveCdpPoint(tabId, params, "click");
        await client.sendTabMessageWithRetry(tabId, {
          action: "animate_cursor_click",
          x: point.x,
          y: point.y
        }).catch((err) => logDebug("visual cursor animation note", err));
        await ensureCdpAttached(tabId, client.broadcastFn);
        clickRes = await dispatchCdpMouseClick(tabId, point.x, point.y, {
          button: params.button || "left",
          clickCount: params.clickCount || 1
        });
      } catch (err) {
        // via=auto: CDP can be unavailable (DevTools open, no debugger permission) → synthetic
        if (via === "auto") {
          console.debug("[AgentPilot] CDP click failed, falling back to synthetic:", err);
          const res = await client.sendTabMessageWithRetry(tabId, {
            action: "click_cursor",
            x: params.x,
            y: params.y,
            selector: params.selector
          });
          clickRes = Object.assign({}, res || {}, {
            via: "synthetic",
            fallback: true,
            cdpError: err.message
          });
        } else {
          throw err;
        }
      }
      const waitMeta = await runInlineWait(client, tabId, params);
      return mergeWaitMeta(clickRes || { success: true }, waitMeta);
    })
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.type": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    client.runWithTabLock(tabId, "page.type", async () => {
      const res = await client.sendTabMessageWithRetry(tabId, {
        action: "type_text",
        selector: params.selector,
        text: params.text,
        clear: Boolean(params.clear),
        pressEnter: Boolean(params.pressEnter),
        delay: params.delay || DEFAULTS.TYPE_DELAY_MS
      });
      const waitMeta = await runInlineWait(client, tabId, params);
      return mergeWaitMeta(res || { success: true }, waitMeta);
    })
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.scroll": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    client.runWithTabLock(tabId, "page.scroll", async () => {
      const res = await client.sendTabMessageWithRetry(tabId, {
        action: "scroll_page",
        deltaX: params.deltaX || 0,
        deltaY: params.deltaY || 0,
        smooth: params.smooth !== false
      });
      const waitMeta = await runInlineWait(client, tabId, params);
      return mergeWaitMeta(res || { success: true }, waitMeta);
    })
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.hover": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    client.runWithTabLock(tabId, "page.hover", async () => {
      // First locate coordinates, scroll into view and move visual cursor without dispatching duplicate DOM events
      const res = await client.sendTabMessageWithRetry(tabId, {
        action: "virtual_hover",
        selector: params.selector,
        dispatchSynthetic: false
      });
      if (res && res.coords) {
        try {
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, client.broadcastFn);
          }
          await dispatchCdpMouseMove(tabId, res.coords.x, res.coords.y);
        } catch (cdpErr) {
          console.debug("[AgentPilot] CDP hover failed, falling back to synthetic events:", cdpErr);
          // Fallback to synthetic pointer/mouse events if CDP fails
          await client.sendTabMessageWithRetry(tabId, {
            action: "virtual_hover",
            selector: params.selector,
            dispatchSynthetic: true
          });
        }
      }
      const waitMeta = await runInlineWait(client, tabId, params);
      return mergeWaitMeta(res || { success: true }, waitMeta);
    })
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "page.drag": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    const via = client.normalizeVia(params);
    const fromSelector = params.from || params.fromSelector;
    const toSelector = params.to || params.toSelector;
    const syntheticDrag = () =>
      client.sendTabMessageWithRetry(tabId, {
        action: "virtual_drag",
        fromSelector,
        toSelector,
        steps: params.steps || DEFAULTS.DRAG_STEPS
      });
    if (via === "synthetic") {
      client.runWithTabLock(tabId, "page.drag", async () => {
        const res = await syntheticDrag();
        const waitMeta = await runInlineWait(client, tabId, params);
        return mergeWaitMeta(res || { success: true }, waitMeta);
      })
        .then(res => respond(res || { success: true }))
        .catch(err => respond(null, err));
      return;
    }
    client.runWithTabLock(tabId, "page.drag", async () => {
      let dragRes;
      try {
        const fromPoint = await client.resolveCdpPoint(
          tabId,
          { x: params.fromX, y: params.fromY, selector: fromSelector },
          "drag source"
        );
        const toPoint = await client.resolveCdpPoint(
          tabId,
          { x: params.toX, y: params.toY, selector: toSelector },
          "drag target"
        );
        await ensureCdpAttached(tabId, client.broadcastFn);
        dragRes = await dispatchCdpMouseDrag(tabId, fromPoint.x, fromPoint.y, toPoint.x, toPoint.y, {
          steps: params.steps || DEFAULTS.DRAG_STEPS_CDP,
          holdMs: params.holdMs || params.hold || 0
        });
      } catch (err) {
        if (via === "auto" && fromSelector && toSelector) {
          console.debug("[AgentPilot] CDP drag failed, falling back to synthetic:", err);
          const res = await syntheticDrag();
          dragRes = Object.assign({}, res || {}, {
            via: "synthetic",
            fallback: true,
            cdpError: err.message
          });
        } else {
          throw err;
        }
      }
      const waitMeta = await runInlineWait(client, tabId, params);
      return mergeWaitMeta(dragRes || { success: true }, waitMeta);
    })
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.pressKey": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    client.runWithTabLock(tabId, "page.pressKey", async () => {
      let keyRes;
      try {
        if (!attachedTabs.has(tabId)) {
          await attachDebugger(tabId, client.broadcastFn);
        }
        keyRes = await dispatchCdpKeyEvent(tabId, params.key || "Enter", params.selector);
      } catch (cdpErr) {
        console.debug("[AgentPilot] CDP key event failed, falling back to synthetic event:", cdpErr);
        keyRes = await client.sendTabMessageWithRetry(tabId, {
          action: "press_key",
          key: params.key || "Enter",
          code: params.code,
          keyCode: params.keyCode,
          selector: params.selector
        });
      }
      const waitMeta = await runInlineWait(client, tabId, params);
      return mergeWaitMeta(keyRes || { success: true }, waitMeta);
    })
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.waitFor": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    let timeoutMs;
    try {
      timeoutMs = getPositiveNumber(params.timeoutMs, params.timeout) || DEFAULTS.WAIT_FOR_TIMEOUT_MS;
    } catch (err) {
      return respond(null, err);
    }
    let sleepMs = 0;
    try {
      sleepMs = getPositiveNumber(params.waitMs, params.sleepMs, params.sleep, params.ms, params.duration, params.wait) || 0;
    } catch (err) {
      return respond(null, err);
    }
    client.sendTabMessageWithRetry(tabId, {
      action: "wait_for",
      selector: params.selector,
      text: params.text,
      state: params.state || "visible",
      timeoutMs,
      ...(sleepMs > 0 ? { waitMs: sleepMs } : {})
    })
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.uploadFile": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    const files = Array.isArray(params.files) ? params.files : (params.filePath ? [params.filePath] : (params.file ? [params.file] : []));
    client.runWithTabLock(tabId, "page.uploadFile", async () => {
      const res = await uploadFileInput(tabId, params.selector, files, {
        via: params.via,
        filePayloads: params.filePayloads,
        broadcastFn: client.broadcastFn
      });
      const waitMeta = await runInlineWait(client, tabId, params);
      return mergeWaitMeta(res, waitMeta);
    })
      .then(res => respond(res))
      .catch(err => respond(null, err));
  }
};
