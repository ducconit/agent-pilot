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
  "return": { code: "Enter", keyCode: 13, key: "Enter", text: "\r" },
  "tab": { code: "Tab", keyCode: 9, key: "Tab" },
  "backspace": { code: "Backspace", keyCode: 8, key: "Backspace" },
  "escape": { code: "Escape", keyCode: 27, key: "Escape" },
  "esc": { code: "Escape", keyCode: 27, key: "Escape" },
  "space": { code: "Space", keyCode: 32, key: " ", text: " " },
  " ": { code: "Space", keyCode: 32, key: " ", text: " " },
  "arrowup": { code: "ArrowUp", keyCode: 38, key: "ArrowUp" },
  "up": { code: "ArrowUp", keyCode: 38, key: "ArrowUp" },
  "arrowdown": { code: "ArrowDown", keyCode: 40, key: "ArrowDown" },
  "down": { code: "ArrowDown", keyCode: 40, key: "ArrowDown" },
  "arrowleft": { code: "ArrowLeft", keyCode: 37, key: "ArrowLeft" },
  "left": { code: "ArrowLeft", keyCode: 37, key: "ArrowLeft" },
  "arrowright": { code: "ArrowRight", keyCode: 39, key: "ArrowRight" },
  "right": { code: "ArrowRight", keyCode: 39, key: "ArrowRight" },
  "delete": { code: "Delete", keyCode: 46, key: "Delete" },
  "del": { code: "Delete", keyCode: 46, key: "Delete" },
  "insert": { code: "Insert", keyCode: 45, key: "Insert" },
  "ins": { code: "Insert", keyCode: 45, key: "Insert" },
  "home": { code: "Home", keyCode: 36, key: "Home" },
  "end": { code: "End", keyCode: 35, key: "End" },
  "pageup": { code: "PageUp", keyCode: 33, key: "PageUp" },
  "pgup": { code: "PageUp", keyCode: 33, key: "PageUp" },
  "pagedown": { code: "PageDown", keyCode: 34, key: "PageDown" },
  "pgdn": { code: "PageDown", keyCode: 34, key: "PageDown" },
  "capslock": { code: "CapsLock", keyCode: 20, key: "CapsLock" },
  "numlock": { code: "NumLock", keyCode: 144, key: "NumLock" },
  "scrolllock": { code: "ScrollLock", keyCode: 145, key: "ScrollLock" },
  "pause": { code: "Pause", keyCode: 19, key: "Pause" },
  "contextmenu": { code: "ContextMenu", keyCode: 93, key: "ContextMenu" },
  "printscreen": { code: "PrintScreen", keyCode: 44, key: "PrintScreen" },
  "f1": { code: "F1", keyCode: 112, key: "F1" },
  "f2": { code: "F2", keyCode: 113, key: "F2" },
  "f3": { code: "F3", keyCode: 114, key: "F3" },
  "f4": { code: "F4", keyCode: 115, key: "F4" },
  "f5": { code: "F5", keyCode: 116, key: "F5" },
  "f6": { code: "F6", keyCode: 117, key: "F6" },
  "f7": { code: "F7", keyCode: 118, key: "F7" },
  "f8": { code: "F8", keyCode: 119, key: "F8" },
  "f9": { code: "F9", keyCode: 120, key: "F9" },
  "f10": { code: "F10", keyCode: 121, key: "F10" },
  "f11": { code: "F11", keyCode: 122, key: "F11" },
  "f12": { code: "F12", keyCode: 123, key: "F12" },
  "-": { code: "Minus", keyCode: 189, key: "-", text: "-" },
  "minus": { code: "Minus", keyCode: 189, key: "-", text: "-" },
  "_": { code: "Minus", keyCode: 189, key: "_", text: "_", shift: true },
  "underscore": { code: "Minus", keyCode: 189, key: "_", text: "_", shift: true },
  "=": { code: "Equal", keyCode: 187, key: "=", text: "=" },
  "equal": { code: "Equal", keyCode: 187, key: "=", text: "=" },
  "+": { code: "Equal", keyCode: 187, key: "+", text: "+", shift: true },
  "plus": { code: "Equal", keyCode: 187, key: "+", text: "+", shift: true },
  "[": { code: "BracketLeft", keyCode: 219, key: "[", text: "[" },
  "bracketleft": { code: "BracketLeft", keyCode: 219, key: "[", text: "[" },
  "{": { code: "BracketLeft", keyCode: 219, key: "{", text: "{", shift: true },
  "]": { code: "BracketRight", keyCode: 221, key: "]", text: "]" },
  "bracketright": { code: "BracketRight", keyCode: 221, key: "]", text: "]" },
  "}": { code: "BracketRight", keyCode: 221, key: "}", text: "}", shift: true },
  "\\": { code: "Backslash", keyCode: 220, key: "\\", text: "\\" },
  "backslash": { code: "Backslash", keyCode: 220, key: "\\", text: "\\" },
  "|": { code: "Backslash", keyCode: 220, key: "|", text: "|", shift: true },
  ";": { code: "Semicolon", keyCode: 186, key: ";", text: ";" },
  "semicolon": { code: "Semicolon", keyCode: 186, key: ";", text: ";" },
  ":": { code: "Semicolon", keyCode: 186, key: ":", text: ":", shift: true },
  "'": { code: "Quote", keyCode: 222, key: "'", text: "'" },
  "quote": { code: "Quote", keyCode: 222, key: "'", text: "'" },
  "\"": { code: "Quote", keyCode: 222, key: "\"", text: "\"", shift: true },
  ",": { code: "Comma", keyCode: 188, key: ",", text: "," },
  "comma": { code: "Comma", keyCode: 188, key: ",", text: "," },
  "<": { code: "Comma", keyCode: 188, key: "<", text: "<", shift: true },
  ".": { code: "Period", keyCode: 190, key: ".", text: "." },
  "period": { code: "Period", keyCode: 190, key: ".", text: "." },
  ">": { code: "Period", keyCode: 190, key: ">", text: ">", shift: true },
  "/": { code: "Slash", keyCode: 191, key: "/", text: "/" },
  "slash": { code: "Slash", keyCode: 191, key: "/", text: "/" },
  "?": { code: "Slash", keyCode: 191, key: "?", text: "?", shift: true },
  "`": { code: "Backquote", keyCode: 192, key: "`", text: "`" },
  "backquote": { code: "Backquote", keyCode: 192, key: "`", text: "`" },
  "~": { code: "Backquote", keyCode: 192, key: "~", text: "~", shift: true },
  "!": { code: "Digit1", keyCode: 49, key: "!", text: "!", shift: true },
  "@": { code: "Digit2", keyCode: 50, key: "@", text: "@", shift: true },
  "#": { code: "Digit3", keyCode: 51, key: "#", text: "#", shift: true },
  "$": { code: "Digit4", keyCode: 52, key: "$", text: "$", shift: true },
  "%": { code: "Digit5", keyCode: 53, key: "%", text: "%", shift: true },
  "^": { code: "Digit6", keyCode: 54, key: "^", text: "^", shift: true },
  "&": { code: "Digit7", keyCode: 55, key: "&", text: "&", shift: true },
  "*": { code: "Digit8", keyCode: 56, key: "*", text: "*", shift: true },
  "(": { code: "Digit9", keyCode: 57, key: "(", text: "(", shift: true },
  ")": { code: "Digit0", keyCode: 48, key: ")", text: ")", shift: true }
};

function splitKeyTokens(raw) {
  if (typeof raw !== "string") return [];
  const trimmed = raw.trim();
  if (!trimmed) return raw === " " ? [" "] : [];
  if (trimmed === "," || /[+]\s*,$/.test(trimmed)) {
    return [trimmed];
  }
  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map(part => part.trim())
      .filter(Boolean);
  }
  return [trimmed];
}

/**
 * Normalize a single key string, comma-separated key string, or array of keys
 * into an ordered flat array of key combos, applying optional repeat count.
 */
export function normalizeKeySequence(keyOrKeys, repeat = 1) {
  const rawList = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  const baseKeys = [];
  for (const item of rawList) {
    if (typeof item === "string") {
      baseKeys.push(...splitKeyTokens(item));
    }
  }
  const parsedRepeat = Number(repeat);
  const count = Number.isFinite(parsedRepeat) && parsedRepeat > 1
    ? Math.min(100, Math.floor(parsedRepeat))
    : 1;
  if (count === 1) return baseKeys;
  const expanded = [];
  for (let i = 0; i < count; i++) {
    expanded.push(...baseKeys);
  }
  return expanded;
}

/**
 * Parse a key combo string (e.g. "Ctrl+Shift+Z", "Ctrl++", "+") into modifiers bitmask and keyInfo.
 */
export function parseCdpKeyCombo(keyCombo) {
  const raw = String(keyCombo || "");
  let trailingPlus = false;
  let working = raw;
  if (working === "+") {
    trailingPlus = true;
    working = "";
  } else if (working.endsWith("++")) {
    trailingPlus = true;
    working = working.slice(0, -2);
  }

  const parts = working.split("+").map(s => s.trim()).filter(Boolean);
  if (trailingPlus) {
    parts.push("+");
  }

  let modifiers = 0;
  let mainKey = "";

  // Modifier bitmask values are defined by the CDP Input.dispatchKeyEvent API:
  // 1 = Alt, 2 = Ctrl, 4 = Meta/Command, 8 = Shift.
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const lower = p.toLowerCase();
    if ((lower === "ctrl" || lower === "control") && i < parts.length - 1) {
      modifiers |= 2;
    } else if ((lower === "alt" || lower === "option") && i < parts.length - 1) {
      modifiers |= 1;
    } else if (lower === "shift" && i < parts.length - 1) {
      modifiers |= 8;
    } else if ((lower === "meta" || lower === "cmd" || lower === "command" || lower === "win") && i < parts.length - 1) {
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

  if (keyInfo) {
    if (keyInfo.shift) {
      modifiers |= 8;
    }
  } else if (mainKey.length === 1) {
    const isAlpha = /[a-zA-Z]/.test(mainKey);
    const isDigit = /[0-9]/.test(mainKey);
    const upper = mainKey.toUpperCase();
    const isUpperAlpha = isAlpha && mainKey === upper && mainKey !== mainKey.toLowerCase();
    if (isUpperAlpha && !(modifiers & 2) && !(modifiers & 4) && !(modifiers & 1)) {
      modifiers |= 8;
    }
    const code = isAlpha ? `Key${upper}` : isDigit ? `Digit${mainKey}` : mainKey;
    const keyChar = (modifiers & 8) ? upper : (isAlpha ? mainKey.toLowerCase() : mainKey);
    keyInfo = {
      code,
      keyCode: upper.charCodeAt(0),
      key: keyChar,
      text: (modifiers & 2 || modifiers & 4 || modifiers & 1) ? "" : keyChar
    };
  } else {
    keyInfo = { code: mainKey, keyCode: 0, key: mainKey };
  }

  // Native Chromium editing commands for standard Ctrl/Cmd shortcuts
  const commands = [];
  const hasCtrlOrMeta = Boolean((modifiers & 2) || (modifiers & 4));
  const hasAlt = Boolean(modifiers & 1);
  const hasShift = Boolean(modifiers & 8);
  if (hasCtrlOrMeta && !hasAlt) {
    if (lowerKey === "a" && !hasShift) commands.push("selectAll");
    else if (lowerKey === "c" && !hasShift) commands.push("copy");
    else if (lowerKey === "v" && !hasShift) commands.push("paste");
    else if (lowerKey === "x" && !hasShift) commands.push("cut");
    else if (lowerKey === "z" && !hasShift) commands.push("undo");
    else if ((lowerKey === "z" && hasShift) || (lowerKey === "y" && !hasShift)) commands.push("redo");
  }

  return { modifiers, keyInfo, commands };
}

/**
 * Dispatch real, trusted keyboard events (single key or sequence) via CDP Input.dispatchKeyEvent
 */
export async function dispatchCdpKeyEvent(tabId, keyCombo, selector = null, options = {}) {
  const keys = normalizeKeySequence(options.keys && Array.isArray(options.keys) && options.keys.length > 0 ? options.keys : keyCombo, options.repeat);
  if (keys.length === 0) throw new Error("key is required");

  const rawDelay = Number(options.delayMs ?? options.delay ?? 0);
  const delayMs = Number.isFinite(rawDelay) && rawDelay > 0 ? Math.min(5000, Math.floor(rawDelay)) : 0;

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

  for (let idx = 0; idx < keys.length; idx++) {
    const currentCombo = keys[idx];
    const { modifiers, keyInfo, commands } = parseCdpKeyCombo(currentCombo);

    // 1. rawKeyDown (attach native editing commands for Ctrl/Cmd+A/C/V/X/Z/Y)
    const keyDownParams = {
      type: "rawKeyDown",
      modifiers,
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode
    };
    if (commands.length > 0) {
      keyDownParams.commands = commands;
    }
    await sendCdpCommand(tabId, "Input.dispatchKeyEvent", keyDownParams);

    // 2. char (for character input when not a shortcut)
    if (keyInfo.text && !(modifiers & 2) && !(modifiers & 4) && !(modifiers & 1)) {
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

    if (delayMs > 0 && idx < keys.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return {
    success: true,
    key: keys.length === 1 ? keys[0] : keys.join(", "),
    ...(keys.length > 1 ? { keys, count: keys.length } : {}),
    selector,
    trusted: true
  };
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

function buttonToBitmask(button) {
  if (button === "right") return 2;
  if (button === "middle") return 4;
  return 1;
}

/**
 * Dispatch a real, trusted mouse click (move -> press -> release) via CDP.
 * Works on cross-origin iframes, canvas and WebGL apps where synthetic DOM events fail.
 */
export async function dispatchCdpMouseClick(tabId, x, y, options = {}) {
  const px = Math.round(x);
  const py = Math.round(y);
  const button = options.button || "left";
  const buttons = buttonToBitmask(button);
  const rawCount = (options.dblClick || options.doubleClick) ? 2 : (Number(options.clickCount) || 1);
  const clickCount = Math.max(1, Math.min(3, Math.floor(rawCount)));

  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py });
  for (let currentCount = 1; currentCount <= clickCount; currentCount++) {
    await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: px,
      y: py,
      button,
      buttons,
      clickCount: currentCount
    });
    await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: px,
      y: py,
      button,
      buttons: 0,
      clickCount: currentCount
    });
  }

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
  const buttons = buttonToBitmask(button);
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
    buttons,
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
      buttons
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
