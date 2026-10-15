/**
 * Agent Pilot - Agent bridge handlers: page interaction (input & navigation of the DOM)
 * Moved verbatim from bridge-client.js; behaviour must stay identical.
 * All handlers run inside the per-tab lock so concurrent agent steps cannot interleave.
 */

import {
  attachedTabs,
  DEFAULTS,
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

export const pageInputHandlers = {
  "page.evaluate": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    const script = params.script || params.expression || params.code || "";
    if (!script) return respond(null, new Error("Missing script or expression to evaluate"));

    client.runWithTabLock(tabId, "page.evaluate", async () => {
      // Attempt 1: Execute in MAIN world for direct window/DOM framework access
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: async (code) => {
            try {
              const rawVal = window.eval(code);
              const value = await Promise.resolve(rawVal);
              return { __eval_ok: true, value };
            } catch (e) {
              return { __eval_err: true, message: e?.message || String(e), stack: e?.stack };
            }
          },
          args: [script]
        });
        if (results && results[0] && results[0].result) {
          const resObj = results[0].result;
          if (resObj.__eval_err) {
            throw new Error(resObj.message);
          }
          return resObj.value;
        }
      } catch (scriptingErr) {
        logDebug("evaluate in MAIN world fallback to CDP", scriptingErr);
      }

      // Attempt 2: Fallback to CDP Runtime.evaluate
      if (!attachedTabs.has(tabId)) {
        await attachDebugger(tabId, client.broadcastFn).catch((err) => logDebug("evaluate attachDebugger", err));
      }
      const evalRes = await sendCdpCommand(tabId, "Runtime.evaluate", {
        expression: script,
        returnByValue: true,
        awaitPromise: true
      });
      if (evalRes?.exceptionDetails) {
        throw new Error(evalRes.exceptionDetails.exception?.description || evalRes.exceptionDetails.text);
      }
      return evalRes?.result?.value ?? evalRes;
    })
      .then(res => respond(res !== undefined ? res : null))
      .catch(err => respond(null, err));
  },

  "page.moveMouse": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    client.runWithTabLock(tabId, "page.moveMouse", () =>
      client.sendTabMessageWithRetry(tabId, {
        action: "move_cursor",
        x: params.x,
        y: params.y,
        duration: params.duration || DEFAULTS.MOVE_DURATION_MS
      })
    )
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.click": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    const via = client.normalizeVia(params);
    if (via === "synthetic") {
      client.runWithTabLock(tabId, "page.click", () =>
        client.sendTabMessageWithRetry(tabId, {
          action: "click_cursor",
          x: params.x,
          y: params.y,
          selector: params.selector
        })
      )
        .then(res => respond(res || { success: true }))
        .catch(err => respond(null, err));
      return;
    }
    client.runWithTabLock(tabId, "page.click", async () => {
      try {
        const point = await client.resolveCdpPoint(tabId, params, "click");
        await client.sendTabMessageWithRetry(tabId, {
          action: "animate_cursor_click",
          x: point.x,
          y: point.y
        }).catch((err) => logDebug("visual cursor animation note", err));
        await ensureCdpAttached(tabId, client.broadcastFn);
        return await dispatchCdpMouseClick(tabId, point.x, point.y, {
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
          return Object.assign({}, res || {}, {
            via: "synthetic",
            fallback: true,
            cdpError: err.message
          });
        }
        throw err;
      }
    })
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.type": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    client.runWithTabLock(tabId, "page.type", () =>
      client.sendTabMessageWithRetry(tabId, {
        action: "type_text",
        selector: params.selector,
        text: params.text,
        clear: Boolean(params.clear),
        pressEnter: Boolean(params.pressEnter),
        delay: params.delay || DEFAULTS.TYPE_DELAY_MS
      })
    )
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.scroll": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    client.runWithTabLock(tabId, "page.scroll", () =>
      client.sendTabMessageWithRetry(tabId, {
        action: "scroll_page",
        deltaX: params.deltaX || 0,
        deltaY: params.deltaY || 0,
        smooth: params.smooth !== false
      })
    )
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.hover": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
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
          return res;
        } catch (cdpErr) {
          console.debug("[AgentPilot] CDP hover failed, falling back to synthetic events:", cdpErr);
          // Fallback to synthetic pointer/mouse events if CDP fails
          await client.sendTabMessageWithRetry(tabId, {
            action: "virtual_hover",
            selector: params.selector,
            dispatchSynthetic: true
          });
          return res;
        }
      }
      return res || { success: true };
    })
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "page.drag": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
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
      client.runWithTabLock(tabId, "page.drag", syntheticDrag)
        .then(res => respond(res || { success: true }))
        .catch(err => respond(null, err));
      return;
    }
    client.runWithTabLock(tabId, "page.drag", async () => {
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
        return await dispatchCdpMouseDrag(tabId, fromPoint.x, fromPoint.y, toPoint.x, toPoint.y, {
          steps: params.steps || DEFAULTS.DRAG_STEPS_CDP,
          holdMs: params.holdMs || params.hold || 0
        });
      } catch (err) {
        if (via === "auto" && fromSelector && toSelector) {
          console.debug("[AgentPilot] CDP drag failed, falling back to synthetic:", err);
          const res = await syntheticDrag();
          return Object.assign({}, res || {}, {
            via: "synthetic",
            fallback: true,
            cdpError: err.message
          });
        }
        throw err;
      }
    })
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.pressKey": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    client.runWithTabLock(tabId, "page.pressKey", async () => {
      try {
        if (!attachedTabs.has(tabId)) {
          await attachDebugger(tabId, client.broadcastFn);
        }
        return await dispatchCdpKeyEvent(tabId, params.key || "Enter", params.selector);
      } catch (cdpErr) {
        console.debug("[AgentPilot] CDP key event failed, falling back to synthetic event:", cdpErr);
        return await client.sendTabMessageWithRetry(tabId, {
          action: "press_key",
          key: params.key || "Enter",
          code: params.code,
          keyCode: params.keyCode,
          selector: params.selector
        });
      }
    })
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.waitFor": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    let timeoutMs = DEFAULTS.WAIT_FOR_TIMEOUT_MS;
    let candidate = params.timeoutMs;
    if (candidate === undefined || candidate === null || candidate === "") {
      candidate = params.timeout;
    }
    if (candidate !== undefined && candidate !== null && candidate !== "") {
      const num = Number(candidate);
      if (!Number.isFinite(num) || num <= 0 || num > DEFAULTS.MAX_TIMER_DELAY_MS) {
        return respond(null, new Error(`Invalid timeout '${candidate}': must be a positive finite number <= ${DEFAULTS.MAX_TIMER_DELAY_MS}ms`));
      }
      timeoutMs = num;
    }
    client.sendTabMessageWithRetry(tabId, {
      action: "wait_for",
      selector: params.selector,
      text: params.text,
      state: params.state || "visible",
      timeoutMs
    })
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  },

  "page.uploadFile": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    if (!attachedTabs.has(tabId)) {
      await attachDebugger(tabId, client.broadcastFn);
    }
    const files = Array.isArray(params.files) ? params.files : (params.filePath ? [params.filePath] : (params.file ? [params.file] : []));
    uploadFileInput(tabId, params.selector, files)
      .then(res => respond(res))
      .catch(err => respond(null, err));
  }
};
