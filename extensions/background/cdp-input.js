/**
 * Agent Pilot - CDP Input Synthesis
 *
 * Dispatches real, trusted keyboard/mouse events through the CDP Input domain.
 * Unlike synthetic DOM events these reach cross-origin iframes, canvas/WebGL
 * apps and native browser UI, which is why the agent prefers them when available.
 */

import { LIMITS, TIMEOUTS, DEFAULTS } from "./constants.js";
import { sendCdpCommand } from "./cdp-connection.js";

// CDP key descriptors keyed by lower-cased user-facing key name
const CDP_KEY_MAP = {
  "enter": { code: "Enter", keyCode: 13, key: "Enter", text: "\r" },
  "tab": { code: "Tab", keyCode: 9, key: "Tab" },
  "backspace": { code: "Backspace", keyCode: 8, key: "Backspace" },
  "escape": { code: "Escape", keyCode: 27, key: "Escape" },
  "esc": { code: "Escape", keyCode: 27, key: "Escape" },
  "space": { code: "Space", keyCode: 32, key: " ", text: " " },
  "arrowup": { code: "ArrowUp", keyCode: 38, key: "ArrowUp" },
  "up": { code: "ArrowUp", keyCode: 38, key: "ArrowUp" },
  "arrowdown": { code: "ArrowDown", keyCode: 40, key: "ArrowDown" },
  "down": { code: "ArrowDown", keyCode: 40, key: "ArrowDown" },
  "arrowleft": { code: "ArrowLeft", keyCode: 37, key: "ArrowLeft" },
  "left": { code: "ArrowLeft", keyCode: 37, key: "ArrowLeft" },
  "arrowright": { code: "ArrowRight", keyCode: 39, key: "ArrowRight" },
  "right": { code: "ArrowRight", keyCode: 39, key: "ArrowRight" },
  "delete": { code: "Delete", keyCode: 46, key: "Delete" },
  "home": { code: "Home", keyCode: 36, key: "Home" },
  "end": { code: "End", keyCode: 35, key: "End" },
  "pageup": { code: "PageUp", keyCode: 33, key: "PageUp" },
  "pagedown": { code: "PageDown", keyCode: 34, key: "PageDown" }
};

/**
 * Dispatch real, trusted keyboard events via CDP Input.dispatchKeyEvent
 */
export async function dispatchCdpKeyEvent(tabId, keyCombo, selector = null) {
  if (!keyCombo) throw new Error("key is required");

  // Focus element first if selector provided
  if (selector) {
    try {
      const res = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: "focus_element", selector }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { success: true });
          }
        });
      });
      if (!res || !res.success) {
        console.debug("[AgentPilot] focus_element warning:", res ? res.error : "no response");
      }
    } catch (err) {
      console.debug("[AgentPilot] focus_element message failed:", err);
    }
  }

  const parts = keyCombo.split("+").map(s => s.trim()).filter(Boolean);
  let modifiers = 0;
  let mainKey = "";

  // Modifier bitmask values are defined by the CDP Input.dispatchKeyEvent API:
  // 1 = Alt, 2 = Ctrl, 4 = Meta/Command, 8 = Shift.
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const lower = p.toLowerCase();
    if (lower === "ctrl" || lower === "control") {
      modifiers |= 2;
    } else if (lower === "alt" || lower === "option") {
      modifiers |= 1;
    } else if (lower === "shift") {
      modifiers |= 8;
    } else if (lower === "meta" || lower === "cmd" || lower === "command" || lower === "win") {
      modifiers |= 4;
    } else {
      mainKey = p;
    }
  }

  if (!mainKey && parts.length > 0) {
    mainKey = parts[parts.length - 1];
  }

  const lowerKey = mainKey.toLowerCase();
  let keyInfo = CDP_KEY_MAP[lowerKey];

  if (!keyInfo) {
    if (mainKey.length === 1) {
      const isAlpha = /[a-zA-Z]/.test(mainKey);
      const isDigit = /[0-9]/.test(mainKey);
      const upper = mainKey.toUpperCase();
      const code = isAlpha ? `Key${upper}` : isDigit ? `Digit${mainKey}` : mainKey;
      keyInfo = {
        code,
        keyCode: upper.charCodeAt(0),
        key: modifiers & 8 ? upper : mainKey,
        text: (modifiers & 2 || modifiers & 4) ? "" : mainKey
      };
    } else {
      keyInfo = { code: mainKey, keyCode: 0, key: mainKey };
    }
  }

  // 1. rawKeyDown
  await sendCdpCommand(tabId, "Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    modifiers,
    key: keyInfo.key,
    code: keyInfo.code,
    windowsVirtualKeyCode: keyInfo.keyCode
  });

  // 2. char (for character input when not a shortcut)
  if (keyInfo.text && !(modifiers & 2) && !(modifiers & 4)) {
    await sendCdpCommand(tabId, "Input.dispatchKeyEvent", {
      type: "char",
      modifiers,
      text: keyInfo.text,
      unmodifiedText: keyInfo.text
    });
  }

  // 3. keyUp
  await sendCdpCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers,
    key: keyInfo.key,
    code: keyInfo.code,
    windowsVirtualKeyCode: keyInfo.keyCode
  });

  return { success: true, key: keyCombo, selector, trusted: true };
}

/**
 * Dispatch real, trusted mouse move via CDP Input.dispatchMouseEvent
 */
export async function dispatchCdpMouseMove(tabId, x, y) {
  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(x),
    y: Math.round(y)
  });
  return { success: true, x: Math.round(x), y: Math.round(y) };
}

/**
 * Dispatch a real, trusted mouse click (move -> press -> release) via CDP.
 * Works on cross-origin iframes, canvas and WebGL apps where synthetic DOM events fail.
 */
export async function dispatchCdpMouseClick(tabId, x, y, options = {}) {
  const px = Math.round(x);
  const py = Math.round(y);
  const button = options.button || "left";
  const clickCount = options.clickCount || 1;

  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py });
  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: px,
    y: py,
    button,
    buttons: 1,
    clickCount
  });
  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: px,
    y: py,
    button,
    buttons: 0,
    clickCount
  });

  return { success: true, via: "cdp", trusted: true, x: px, y: py, button, clickCount };
}

/**
 * Clamp the drag interpolation step count.
 * Fewer than CDP_DRAG_MIN_STEPS moves looks like a teleport to physics/aiming
 * logic, while unbounded steps would stall the service worker (each step is a
 * CDP round trip plus a frame delay). Non-numeric input falls back to the
 * shared default instead of producing NaN (which would skip the move loop).
 * Exported for unit testing.
 */
export function clampCdpDragSteps(value) {
  const parsed = Number(value);
  const steps = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULTS.DRAG_STEPS_CDP;
  return Math.max(LIMITS.CDP_DRAG_MIN_STEPS, Math.min(LIMITS.CDP_DRAG_MAX_STEPS, steps));
}

/**
 * Dispatch a real, trusted mouse drag (press -> interpolated moves -> optional hold -> release) via CDP.
 * Useful for slingshot/aim mechanics in canvas games.
 */
export async function dispatchCdpMouseDrag(tabId, fromX, fromY, toX, toY, options = {}) {
  const x1 = Math.round(Number(fromX));
  const y1 = Math.round(Number(fromY));
  const x2 = Math.round(Number(toX));
  const y2 = Math.round(Number(toY));
  const button = options.button || "left";
  const steps = clampCdpDragSteps(options.steps);
  // A negative hold is meaningless; the upper bound stops a bad caller from
  // pinning the pointer "down" indefinitely.
  const holdMs = Math.max(0, Math.min(TIMEOUTS.CDP_DRAG_HOLD_MAX_MS, parseInt(options.holdMs, 10) || 0));

  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1 });
  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: x1,
    y: y1,
    button,
    buttons: 1,
    clickCount: 1
  });

  for (let i = 1; i <= steps; i++) {
    const x = Math.round(x1 + ((x2 - x1) * i) / steps);
    const y = Math.round(y1 + ((y2 - y1) * i) / steps);
    await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button,
      buttons: 1
    });
    // Pause ~one frame so the page can process each intermediate position.
    await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.CDP_DRAG_STEP_DELAY_MS));
  }

  if (holdMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  }

  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: x2,
    y: y2,
    button,
    buttons: 0,
    clickCount: 1
  });

  return {
    success: true,
    via: "cdp",
    trusted: true,
    from: { x: x1, y: y1 },
    to: { x: x2, y: y2 },
    steps,
    holdMs
  };
}
