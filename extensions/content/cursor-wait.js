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

  function resolveSleepMs(options) {
    for (const candidate of [options.waitMs, options.sleepMs, options.sleep, options.ms, options.duration]) {
      if (candidate !== undefined && candidate !== null && candidate !== "") {
        const n = Number(candidate);
        if (Number.isFinite(n) && n > 0) {
          return Math.min(n, WAIT_FOR_MAX_MS);
        }
      }
    }
    return 0;
  }

  /**
   * Smart polling wait for selector, text, pure sleep duration, or document readyState.
   */
  async function waitFor(options = {}) {
    let { selector, text, state = "visible", timeoutMs = WAIT_FOR_DEFAULT_MS, pollIntervalMs = WAIT_FOR_POLL_INTERVAL_MS } = options;
    const parsedTimeout = Number(timeoutMs);
    timeoutMs = (Number.isFinite(parsedTimeout) && parsedTimeout > 0) ? Math.min(parsedTimeout, WAIT_FOR_MAX_MS) : WAIT_FOR_DEFAULT_MS;
    const sleepDuration = resolveSleepMs(options);

    if (selector && !text && typeof selector === "string" && !selector.startsWith("@")) {
      try {
        document.createDocumentFragment().querySelector(selector);
      } catch (selErr) {
        console.debug("[AgentPilot] Selector syntax error, falling back to text search:", selErr);
        text = selector;
        selector = "";
      }
    }

    const startTime = Date.now();

    // Case 1: Pure sleep requested without selector/text
    if (!selector && !text && sleepDuration > 0) {
      await new Promise((r) => setTimeout(r, sleepDuration));
      return {
        success: true,
        waitedMs: Date.now() - startTime,
        state: "slept"
      };
    }

    // Case 2: Condition-less wait (wait for document.readyState === "complete" + brief settle)
    if (!selector && !text) {
      while (Date.now() - startTime < timeoutMs) {
        if (typeof document !== "undefined" && document.readyState === "complete") {
          await new Promise((r) => setTimeout(r, 50));
          return {
            success: true,
            waitedMs: Date.now() - startTime,
            state: "ready",
            readyState: document.readyState
          };
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
      return {
        success: true,
        waitedMs: Date.now() - startTime,
        state: "ready",
        readyState: typeof document !== "undefined" ? document.readyState : "unknown"
      };
    }

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
        const bodyText = document.body ? `${document.body.innerText || ""}\n${document.body.textContent || ""}` : "";
        const titleText = typeof document.title === "string" ? document.title : "";
        const containsText = bodyText.includes(text) || titleText.includes(text);
        if (state === "hidden") {
          if (containsText) conditionMet = false;
        } else {
          if (!containsText) conditionMet = false;
        }
      }

      if (conditionMet && (selector || text)) {
        if (sleepDuration > 0) {
          await new Promise((r) => setTimeout(r, sleepDuration));
        }
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
