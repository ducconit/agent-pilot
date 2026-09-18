/**
 * Agent Pilot - Content Script Virtual Form Filler
 *
 * Split out of cursor-simulator.js so that module stays focused on the core pointer
 * simulation. This module only talks to the public `window.__AP_INTERNAL__.cursor`
 * API (resolveElement / activateCursor / virtualClick / dispatchKey) so no private
 * internals of cursor-simulator.js leak across the boundary.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.cursorForm) return;
  window.__AP_INTERNAL__.__guards.cursorForm = true;

  // Shared config with local fallbacks (see content/config.js).
  const T = (window.__AP_CONFIG__ && window.__AP_CONFIG__.timeouts) || {};
  const FILL_FIELD_DELAY_MS = T.fillFieldDelayMs || 25;

  const cursor = window.__AP_INTERNAL__.cursor || {};

  // Toggle the shield "dispatching" flag so the human-input lock-shield lets our
  // synthetic input/change events through instead of swallowing them as human input.
  function setDispatching(val) {
    if (window.__AP_INTERNAL__.shield?.setIsDispatching) {
      window.__AP_INTERNAL__.shield.setIsDispatching(val);
    }
  }

  /**
   * Fast batch fill for forms with React/Vue/Angular/HTML5 compatibility.
   */
  async function virtualFillForm(fields = [], submitSelector = null, pressEnter = false) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return { success: false, error: "Fields array must not be empty" };
    }
    if (typeof cursor.resolveElement !== "function" || typeof cursor.activateCursor !== "function") {
      return { success: false, error: "cursor module unavailable" };
    }

    cursor.activateCursor();
    let filledCount = 0;
    let lastTargetEl = null;

    for (const field of fields) {
      const selector = field.selector || field.name || field.id;
      if (!selector) continue;
      const el = cursor.resolveElement(selector);
      if (!el) {
        console.warn("[AgentPilot] virtualFillForm: element not found for", selector);
        continue;
      }

      // Scroll into view if needed
      const r = el.getBoundingClientRect();
      const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
      if (!inView && el.scrollIntoView) {
        el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
      }

      el.focus();
      lastTargetEl = el;

      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || "").toLowerCase();
      const val = field.value !== undefined ? field.value : "";

      try {
        setDispatching(true);

        if (tag === "select") {
          el.value = String(val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          filledCount++;
        } else if (type === "checkbox" || type === "radio") {
          const shouldCheck = typeof val === "boolean" ? val : (val === "true" || val === "1" || val === "checked");
          if (el.checked !== shouldCheck) {
            el.checked = shouldCheck;
            el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
          filledCount++;
        } else if (el.isContentEditable) {
          el.textContent = String(val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          filledCount++;
        } else {
          // Input or Textarea.
          // React/Vue native-setter fallback: frameworks patch the `value` property on
          // the element instance and track state via their own listener, so a plain
          // `el.value = x` can be swallowed. Calling the ORIGINAL prototype descriptor
          // setter bypasses the patch and reliably notifies the framework's tracker.
          const proto = (el instanceof HTMLTextAreaElement) ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

          if (field.clear !== false) {
            if (nativeSetter) nativeSetter.call(el, ""); else el.value = "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }

          if (nativeSetter) nativeSetter.call(el, String(val)); else el.value = String(val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          filledCount++;
        }
      } finally {
        setDispatching(false);
      }

      // Microtask delay for UI framework state propagation
      await new Promise(r => setTimeout(r, FILL_FIELD_DELAY_MS));
    }

    let submitted = false;
    if (submitSelector) {
      const subRes = await cursor.virtualClick(undefined, undefined, submitSelector);
      submitted = subRes?.success || false;
    } else if (pressEnter && lastTargetEl) {
      cursor.dispatchKey("Enter", "Enter", 13, null);
      submitted = true;
    }

    return {
      success: filledCount > 0,
      filledCount,
      totalFields: fields.length,
      submitted
    };
  }

  window.__AP_INTERNAL__.cursorForm = {
    virtualFillForm
  };
})();
