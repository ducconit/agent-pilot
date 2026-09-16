/**
 * Agent Pilot - Main World Bridge Script (Manifest V3)
 * Exposes window.__AGENT_PILOT__ directly to the web page execution context
 */
(() => {
  function sendBridgeRequest(action, data = {}, customTimeout = null) {
    let timeoutMs = 5000;
    if (customTimeout && Number(customTimeout) > 0) {
      timeoutMs = Number(customTimeout);
    } else if (action === "wait_for") {
      const waitDur = (data && (data.timeout || data.timeoutMs)) ? Number(data.timeout || data.timeoutMs) : 10000;
      timeoutMs = waitDur + 3000;
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs > 2147483647) {
      timeoutMs = 2147483647;
    } else if (timeoutMs <= 0) {
      timeoutMs = 5000;
    }
    return new Promise((resolve) => {
      const reqId = "ap_" + Math.random().toString(36).substr(2, 9);
      const timer = setTimeout(() => {
        window.removeEventListener("__AGENT_PILOT_RESP__", onResponse);
        resolve(null);
      }, timeoutMs);
      function onResponse(e) {
        if (e.detail && e.detail.reqId === reqId) {
          clearTimeout(timer);
          window.removeEventListener("__AGENT_PILOT_RESP__", onResponse);
          resolve(e.detail.result);
        }
      }
      window.addEventListener("__AGENT_PILOT_RESP__", onResponse);
      window.dispatchEvent(new CustomEvent("__AGENT_PILOT_REQ__", {
        detail: { reqId, action, data }
      }));
    });
  }

  const EXTENSION_VERSION = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest)
    ? (chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version)
    : "1.0.1-beta";

  window.__AGENT_PILOT__ = window.__AGENT_PILOT__ || {};
  Object.assign(window.__AGENT_PILOT__, {
    version: EXTENSION_VERSION,
    moveMouse: (x, y, duration) => sendBridgeRequest("virtual_mouse_move", { x, y, duration }),
    click: (x, y) => sendBridgeRequest("virtual_mouse_click", { x, y }),
    type: (selector, text) => sendBridgeRequest("virtual_type", { selector, text }),
    scroll: (deltaX, deltaY) => sendBridgeRequest("virtual_scroll", { deltaX, deltaY }),
    hover: (selector) => sendBridgeRequest("virtual_hover", { selector }),
    drag: (from, to, steps) => sendBridgeRequest("virtual_drag", { from, to, steps }),
    pressKey: (key, selector) => sendBridgeRequest("press_key", { key, selector }),
    waitFor: (options) => sendBridgeRequest("wait_for", options),
    snapshot: (maxElements, format) => sendBridgeRequest("get_snapshot", { maxElements, format }),
    fillForm: (fields, submitSelector, pressEnter) => sendBridgeRequest("fill_form", { fields, submitSelector, pressEnter }),
    toggleInspector: (enabled) => sendBridgeRequest("toggle_inspector", { enabled }),
    isInspectorActive: () => sendBridgeRequest("is_inspector_active", {}),
    getElement: (selector, includeStyles) => sendBridgeRequest("get_element_info", { selector, includeStyles }),
    startElementSnap: () => sendBridgeRequest("start_element_snap", {}),
    stopElementSnap: () => sendBridgeRequest("stop_element_snap", {}),
    isElementSnapActive: () => sendBridgeRequest("is_element_snap_active", {}),
    pickColor: (x, y) => sendBridgeRequest("pick_color", { x, y }),
    stopEyedropper: () => sendBridgeRequest("stop_eyedropper", {}),
    isEyedropperActive: () => sendBridgeRequest("is_eyedropper_active", {}),
    getCursorPosition: () => sendBridgeRequest("get_cursor_pos", {}),
    startFeedbackStudio: () => sendBridgeRequest("start_feedback_studio", {}),
    stopFeedbackStudio: () => sendBridgeRequest("stop_feedback_studio", {}),
    isFeedbackStudioActive: () => sendBridgeRequest("is_feedback_studio_active", {}),
    getFeedbackItems: () => sendBridgeRequest("get_feedback_items", {}),
    addFeedbackItem: (item) => sendBridgeRequest("add_feedback_item", { item }),
    clearFeedbackItems: () => sendBridgeRequest("clear_feedback_items", {}),
    copyFeedbackPrompt: () => sendBridgeRequest("copy_feedback_prompt", {}),
    generateFeedbackPrompt: (items) => sendBridgeRequest("generate_feedback_prompt", { items })
  });

  // =========================================================================
  // Framework Component Source Introspection (React, Vue, Astro, Svelte)
  // =========================================================================

  function extractFrameworkSource(target) {
    if (!target || !(target instanceof Element)) return null;

    // 1. React Fiber Dev Tools (_debugSource & component hierarchy)
    const fiberKey = Object.keys(target).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (fiberKey) {
      let fiber = target[fiberKey];
      const componentHierarchy = [];
      let debugSource = null;
      let mainComponent = null;

      while (fiber) {
        const name = fiber.type?.displayName || fiber.type?.name || (typeof fiber.type === "string" ? fiber.type : null);
        if (name && typeof name === "string" && !["div", "span", "p", "button", "input", "a", "ul", "li", "section", "header", "footer", "main", "svg", "path", "form"].includes(name.toLowerCase())) {
          if (!mainComponent) mainComponent = name;
          if (!componentHierarchy.includes(name)) componentHierarchy.push(name);
        }
        if (!debugSource && fiber._debugSource) {
          debugSource = {
            fileName: fiber._debugSource.fileName,
            lineNumber: fiber._debugSource.lineNumber,
            columnNumber: fiber._debugSource.columnNumber
          };
        }
        fiber = fiber.return;
      }

      if (debugSource || mainComponent) {
        return {
          framework: "React",
          componentName: mainComponent || "ReactComponent",
          hierarchy: componentHierarchy.slice(0, 5),
          fileName: debugSource?.fileName || null,
          lineNumber: debugSource?.lineNumber || null,
          columnNumber: debugSource?.columnNumber || null
        };
      }
    }

    // 2. Vue 3 component metadata
    if (target.__vueParentComponent || target.__vnode) {
      const comp = target.__vueParentComponent;
      const compName = comp?.type?.__name || comp?.type?.name || "VueComponent";
      const fileName = comp?.type?.__file || null;
      return {
        framework: "Vue",
        componentName: compName,
        fileName,
        lineNumber: null,
        columnNumber: null
      };
    }

    // 3. Astro source metadata
    const astroEl = target.closest ? target.closest("[data-astro-source-file]") : null;
    if (astroEl) {
      const fileName = astroEl.getAttribute("data-astro-source-file");
      const loc = astroEl.getAttribute("data-astro-source-loc") || "";
      const parts = loc.split(":").map(Number);
      return {
        framework: "Astro",
        componentName: target.tagName.toLowerCase(),
        fileName,
        lineNumber: parts[0] || null,
        columnNumber: parts[1] || null
      };
    }

    // 4. Svelte scope tag
    if (target.classList) {
      const svelteClass = Array.from(target.classList).find(c => c.startsWith("svelte-"));
      if (svelteClass) {
        return {
          framework: "Svelte",
          componentName: target.tagName.toLowerCase(),
          scopeClass: svelteClass
        };
      }
    }

    return null;
  }

  // Handle source inspection requests from isolated content script
  window.addEventListener("__AP_INSPECT_SOURCE_REQ__", (e) => {
    const reqId = e.detail?.reqId;
    const inspectAttr = "data-ap-inspect-target";
    const el = document.querySelector(`[${inspectAttr}="${reqId}"]`);
    let source = null;
    if (el) {
      source = extractFrameworkSource(el);
      el.removeAttribute(inspectAttr);
    }
    window.dispatchEvent(new CustomEvent("__AP_INSPECT_SOURCE_RESP__", {
      detail: { reqId, source }
    }));
  });
})();
