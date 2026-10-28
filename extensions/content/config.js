/**
 * Agent Pilot - Content Script Centralized Configuration
 *
 * Single source of truth for the shared timeouts / limits / id tuning constants used
 * by the isolated-world content scripts. This file MUST be injected before any other
 * content module (it is the first entry in the manifest `content_scripts[].js` array),
 * so later modules can read `window.__AP_CONFIG__`.
 *
 * Design notes:
 * - Every consumer still keeps a local fallback default, so a missing / partially
 *   loaded config can never change behavior (a missing key simply falls back to the
 *   value that used to be hardcoded at the call site).
 * - The object is deeply frozen: it is shared global state, never mutated at runtime.
 * - The module is idempotent (guarded) so double injection is a no-op.
 *
 * NOTE: PIN_COLORS intentionally stays in feedback-studio/constants.js — do not
 * duplicate the visual palette here.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.contentConfig) return;
  window.__AP_INTERNAL__.__guards.contentConfig = true;

  /**
   * Recursively freeze a config tree so no module can accidentally mutate shared
   * global state at runtime.
   */
  function deepFreeze(target) {
    Object.getOwnPropertyNames(target).forEach((key) => {
      const value = target[key];
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        deepFreeze(value);
      }
    });
    return Object.freeze(target);
  }

  const CONFIG = {
    // Discrete waits / animation timings (all in milliseconds).
    timeouts: {
      // --- Bridge (content <-> page) request envelope -----------------------
      bridgeRequestMs: 5000,
      // 2^31 - 1: the maximum delay `setTimeout` accepts in Chromium (used to clamp
      // caller-provided waits so they never overflow into an immediate timeout).
      bridgeMaxDelayMs: 2147483647,
      waitForDefaultMs: 10000,
      // Extra cushion added on top of a wait_for timeout so the bridge reply has
      // time to travel back after the wait itself resolves.
      waitForExtraMs: 3000,
      waitForPollIntervalMs: 100,
      waitForSelectorDefaultMs: 5000,

      // --- Cursor / virtual input animation --------------------------------
      cursorActivateMs: 2500,
      cursorBusyMs: 3000,
      clickDelayMs: 150,
      typingIntervalMs: 40,
      defaultMoveMs: 350,
      fieldFocusMoveMs: 250,
      mouseMoveDefaultMs: 300,
      clickRippleMs: 550,
      dragStepDelayMs: 25,
      fillFieldDelayMs: 25,
      scrollAmountPx: 300,

      // --- Feedback Studio / eyedropper / inspector ------------------------
      snapshotRefreshDebounceMs: 120,
      frameworkProbeMs: 250,
      highlightFlashMs: 1200,
      snapFlashMs: 1000,
      modalInitDelayMs: 60,

      // --- Misc ------------------------------------------------------------
      keepAliveReconnectMs: 1500,
      toastMs: 3200,
      toastFadeMs: 400
    },

    // Snapshot / annotation size bounds.
    limits: {
      snapshotDefaultElements: 80,
      snapshotMinElements: 10,
      snapshotMaxFromCaller: 300,
      snapshotMaxElements: 500,
      annotationMinBoxPx: 10
    },

    // Random-id generation tuning.
    ids: {
      // Length of the base36 random salt appended to generated request / marker ids.
      uniqueIdSaltLen: 9
    }
  };

  window.__AP_CONFIG__ = deepFreeze(CONFIG);

  /**
   * Returns true only when the current document is an HTML / XHTML document where
   * visual UI overlays (Virtual Cursor, Inspector, Feedback Studio, Toast, Loupe)
   * can safely be mounted. Returns false for XML (text/xml, application/xml,
   * image/svg+xml), JSON (application/json), plain text, or XMLDocument trees.
   */
  function isHtmlDocument() {
    if (typeof document === "undefined" || !document.documentElement) return false;
    if (typeof XMLDocument !== "undefined" && document instanceof XMLDocument) return false;
    if (document.xmlVersion) return false;
    if (typeof document.getElementById === "function" && document.getElementById("webkit-xml-viewer-source-xml")) {
      return false;
    }
    const contentType = String(document.contentType || "").toLowerCase().trim();
    if (contentType && contentType !== "text/html" && contentType !== "application/xhtml+xml") {
      return false;
    }
    const rootTag = String(document.documentElement.tagName || "").toLowerCase();
    if (rootTag !== "html") return false;
    return true;
  }

  window.__AP_INTERNAL__.isHtmlDocument = isHtmlDocument;
})();
