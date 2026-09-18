/**
 * Agent Pilot - Batch Action Validation Helpers
 *
 * Pure validation/coercion helpers shared by the batch action handlers. These
 * take only their arguments (plus tab-manager messaging for coordinate lookup)
 * and hold no reference to the executor loop state.
 */

import { ensureContentScript, sendTabMessageWithRetry } from "./tab-manager.js";
import { DEFAULTS } from "./constants.js";

/**
 * Return the first provided candidate coerced to a positive finite number.
 * An explicitly supplied but invalid value (non-numeric, <= 0, Infinity, or
 * beyond the 32-bit timer max) throws rather than silently falling through to a
 * default, so typos like "5s" surface as errors. Returns null when no candidate
 * was provided, letting the caller apply its own default.
 */
export function getPositiveNumber(...candidates) {
  for (const c of candidates) {
    if (c !== undefined && c !== null && c !== "") {
      const num = Number(c);
      if (!Number.isFinite(num) || num <= 0 || num > DEFAULTS.MAX_TIMER_DELAY_MS) {
        throw new Error(`Timeout value '${c}' is invalid: must be a positive finite number <= ${DEFAULTS.MAX_TIMER_DELAY_MS}ms`);
      }
      return num;
    }
  }
  return null;
}

/**
 * Collapse a step's `via` flag to one of "cdp" | "auto" | "synthetic".
 * Anything unrecognized (including missing) resolves to "synthetic", the safe
 * fallback that uses the content script rather than a CDP session.
 */
export function normalizeVia(step) {
  const via = String((step && step.via) || "synthetic").toLowerCase();
  return via === "cdp" || via === "auto" ? via : "synthetic";
}

/**
 * Resolve a viewport point for a mouse action.
 *
 * Coordinates must be finite: NaN/Infinity would be serialized into the CDP
 * payload and rejected by the browser with an opaque protocol error, so we fail
 * early with a clear message. When only a selector is available we ask the
 * content script for the element's viewport coordinates via `virtual_hover`
 * with synthetic dispatch disabled (we want the point, not a synthetic event).
 */
export async function resolvePoint(targetTabId, x, y, selector, label) {
  const hasX = x !== undefined && x !== null && x !== "";
  const hasY = y !== undefined && y !== null && y !== "";
  if (hasX !== hasY) {
    throw new Error(`Invalid ${label} coordinates: both x and y are required together`);
  }
  if (hasX && hasY) {
    const numX = Number(x);
    const numY = Number(y);
    if (!Number.isFinite(numX) || !Number.isFinite(numY)) {
      throw new Error(`Invalid ${label} coordinates: x='${x}', y='${y}' must be finite numbers`);
    }
    return { x: numX, y: numY };
  }
  if (!selector) {
    throw new Error(`Cannot resolve ${label}: provide coordinates or a selector`);
  }
  await ensureContentScript(targetTabId);
  const res = await sendTabMessageWithRetry(targetTabId, {
    action: "virtual_hover",
    selector,
    dispatchSynthetic: false
  });
  const coords = res && (res.coords || (res.x !== undefined && res.y !== undefined ? { x: res.x, y: res.y } : null));
  if (!coords || !Number.isFinite(Number(coords.x)) || !Number.isFinite(Number(coords.y))) {
    throw new Error(`Cannot resolve ${label} coordinates for selector: ${selector}`);
  }
  return { x: Number(coords.x), y: Number(coords.y) };
}
