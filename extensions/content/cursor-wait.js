/**
 * Agent Pilot - Content Script Virtual Wait Helper
 *
 * Split out of cursor-simulator.js. Polls the DOM until a selector / text condition is
 * satisfied. Only uses the public `window.__AP_INTERNAL__.cursor` API
 * (resolveElement / isElementVisible) so no cursor internals leak across the boundary.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.cursorWait) return;
  window.__AP_INTERNAL__.__guards.cursorWait = true;

  // Shared config with local fallbacks (see content/config.js).
  const T = (window.__AP_CONFIG__ && window.__AP_CONFIG__.timeouts) || {};
  const WAIT_FOR_DEFAULT_MS = T.waitForDefaultMs || 10000;
  const WAIT_FOR_POLL_INTERVAL_MS = T.waitForPollIntervalMs || 100;
  const WAIT_FOR_MAX_MS = T.bridgeMaxDelayMs || 2147483647;

  const cursor = window.__AP_INTERNAL__.cursor || {};

  /**
   * Smart polling wait for selector, text, or condition.
   */
  async function waitFor(options = {}) {
    let { selector, text, state = "visible", timeoutMs = WAIT_FOR_DEFAULT_MS, pollIntervalMs = WAIT_FOR_POLL_INTERVAL_MS } = options;
    const parsedTimeout = Number(timeoutMs);
    timeoutMs = (Number.isFinite(parsedTimeout) && parsedTimeout > 0) ? Math.min(parsedTimeout, WAIT_FOR_MAX_MS) : WAIT_FOR_DEFAULT_MS;
    if (selector && !text && typeof selector === "string" && !selector.startsWith("@")) {
      try {
        document.createDocumentFragment().querySelector(selector);
      } catch (selErr) {
        console.debug("[AgentPilot] Selector syntax error, falling back to text search:", selErr);
        text = selector;
        selector = "";
      }
    }
    if (!selector && !text) {
      return {
        success: false,
        error: "waitFor requires either 'selector' or 'text' option"
      };
    }
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      let conditionMet = true;

      if (selector) {
        const el = cursor.resolveElement(selector);
        const attached = !!(el && document.contains(el));
        if (state === "attached") {
          if (!attached) conditionMet = false;
        } else if (state === "hidden") {
          if (attached && cursor.isElementVisible(el)) conditionMet = false;
        } else { // "visible"
          if (!attached || !cursor.isElementVisible(el)) conditionMet = false;
        }
      }

      if (conditionMet && text) {
        const bodyText = document.body ? (document.body.innerText || "") : "";
        const containsText = bodyText.includes(text);
        if (state === "hidden") {
          if (containsText) conditionMet = false;
        } else {
          if (!containsText) conditionMet = false;
        }
      }

      if (conditionMet && (selector || text)) {
        return {
          success: true,
          waitedMs: Date.now() - startTime,
          selector,
          text,
          state
        };
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    return {
      success: false,
      error: `Timed out waiting after ${timeoutMs}ms for ${selector || text || "condition"}`
    };
  }

  window.__AP_INTERNAL__.cursorWait = {
    waitFor
  };
})();
