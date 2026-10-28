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
    return new Promise((resolve, reject) => {
      const reqId = "ap_" + Math.random().toString(36).substr(2, 9);
      const timer = setTimeout(() => {
        window.removeEventListener("__AGENT_PILOT_RESP__", onResponse);
        resolve(null);
      }, timeoutMs);
      function onResponse(e) {
        if (e.detail && e.detail.reqId === reqId) {
          clearTimeout(timer);
          window.removeEventListener("__AGENT_PILOT_RESP__", onResponse);
          if (e.detail.error) {
            reject(new Error(String(e.detail.error)));
          } else {
            resolve(e.detail.result);
          }
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
    : "1.2.0";

  window.__AGENT_PILOT__ = window.__AGENT_PILOT__ || {};
  const pageApi = {
    version: EXTENSION_VERSION,
    moveMouse: (x, y, duration) => sendBridgeRequest("virtual_mouse_move", { x, y, duration }),
    click: (x, y) => sendBridgeRequest("virtual_mouse_click", { x, y }),
    animateClick: (x, y, selector) => sendBridgeRequest("animate_cursor_click", { x, y, selector }),
    type: (selector, text, clear = false) => sendBridgeRequest("virtual_type", { selector, text, clear }),
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
    startRegionCrop: () => sendBridgeRequest("start_region_crop", {}),
    getLockedElement: () => sendBridgeRequest("get_locked_element", {}),
    pickColor: (x, y) => sendBridgeRequest("pick_color", { x, y }),
    stopEyedropper: () => sendBridgeRequest("stop_eyedropper", {}),
    isEyedropperActive: () => sendBridgeRequest("is_eyedropper_active", {}),
    getCursorPosition: () => sendBridgeRequest("get_cursor_pos", {}),
    isBusy: () => sendBridgeRequest("is_busy", {}),
    isAgentTab: () => sendBridgeRequest("is_agent_tab", {}),
    setBusy: (busy, action) => sendBridgeRequest("set_busy", { busy, action }),
    startFeedbackStudio: () => sendBridgeRequest("start_feedback_studio", {}),
    stopFeedbackStudio: () => sendBridgeRequest("stop_feedback_studio", {}),
    isFeedbackStudioActive: () => sendBridgeRequest("is_feedback_studio_active", {}),
    getFeedbackItems: () => sendBridgeRequest("get_feedback_items", {}),
    addFeedbackItem: (item) => sendBridgeRequest("add_feedback_item", { item }),
    clearFeedbackItems: () => sendBridgeRequest("clear_feedback_items", {}),
    copyFeedbackPrompt: () => sendBridgeRequest("copy_feedback_prompt", {}),
    generateFeedbackPrompt: (items) => sendBridgeRequest("generate_feedback_prompt", { items })
  };

  for (const [name, fn] of Object.entries(pageApi)) {
    if (typeof window.__AGENT_PILOT__[name] === "undefined") {
      window.__AGENT_PILOT__[name] = fn;
    }
  }

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

  // Handle source inspection requests from isolated content script (guard against duplicate injection)
  if (!window.__AP_MAIN_BRIDGE_LISTENER__) {
    window.__AP_MAIN_BRIDGE_LISTENER__ = true;
    window.addEventListener("__AP_INSPECT_SOURCE_REQ__", (e) => {
      const reqId = e.detail?.reqId;
      if (!reqId || typeof reqId !== "string" || !/^[\w-]+$/.test(reqId)) return;
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
  }

  // =========================================================================
  // QA Diagnostics Collector (Console Errors, Uncaught Exceptions & 4xx/5xx Network)
  // Lightweight, signal-only ring buffers for Tester Bug Reports (Zero-CDP required)
  // =========================================================================

  const MAX_QA_CONSOLE_ERRORS = 15;
  const MAX_QA_NETWORK_ERRORS = 15;
  const qaConsoleErrors = [];
  const qaNetworkErrors = [];

  function formatErrorArg(arg) {
    if (arg instanceof Error) {
      return arg.stack ? String(arg.stack).split("\n").slice(0, 3).join(" | ") : `${arg.name}: ${arg.message}`;
    }
    if (typeof arg === "object" && arg !== null) {
      try {
        return JSON.stringify(arg).slice(0, 240);
      } catch (_) {
        return String(arg);
      }
    }
    return String(arg);
  }

  function recordConsoleError(type, rawMessage, source = "") {
    const message = String(rawMessage || "").trim().slice(0, 400);
    if (!message || message.includes("[AgentPilot]") || message.includes("__AGENT_PILOT")) return;

    const existing = qaConsoleErrors.find((item) => item.type === type && item.message === message);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.timestamp = Date.now();
      return;
    }

    if (qaConsoleErrors.length >= MAX_QA_CONSOLE_ERRORS) {
      qaConsoleErrors.shift();
    }
    qaConsoleErrors.push({
      type,
      message,
      source: String(source || "").slice(0, 200),
      count: 1,
      timestamp: Date.now()
    });
  }

  function isIgnoredInternalUrl(urlStr) {
    if (!urlStr) return true;
    return urlStr.startsWith("chrome-extension://") || urlStr.includes("127.0.0.1:58765") || urlStr.includes("localhost:58765");
  }

  function recordNetworkError(method, url, status, statusText, durationMs) {
    const cleanUrl = String(url || "").slice(0, 500);
    if (isIgnoredInternalUrl(cleanUrl)) return;

    const cleanMethod = String(method || "GET").toUpperCase().slice(0, 16);
    const numStatus = Number(status) || 0;
    const cleanStatusText = String(statusText || "").slice(0, 120);

    const existing = qaNetworkErrors.find(
      (item) => item.method === cleanMethod && item.url === cleanUrl && item.status === numStatus
    );
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.durationMs = Math.round(Number(durationMs) || 0);
      existing.timestamp = Date.now();
      return;
    }

    if (qaNetworkErrors.length >= MAX_QA_NETWORK_ERRORS) {
      qaNetworkErrors.shift();
    }
    qaNetworkErrors.push({
      method: cleanMethod,
      url: cleanUrl,
      status: numStatus,
      statusText: cleanStatusText,
      durationMs: Math.round(Number(durationMs) || 0),
      count: 1,
      timestamp: Date.now()
    });
  }

  if (!window.__AP_QA_HOOKS_INSTALLED__) {
    window.__AP_QA_HOOKS_INSTALLED__ = true;

    // 1. Hook console.error
    const origConsoleError = console.error;
    if (typeof origConsoleError === "function") {
      console.error = function (...args) {
        try {
          const msg = args.map(formatErrorArg).join(" ");
          recordConsoleError("console.error", msg);
        } catch (_) {}
        return origConsoleError.apply(this, args);
      };
    }

    // 2. Global uncaught errors & unhandled promise rejections
    window.addEventListener("error", (event) => {
      try {
        const msg = event.error?.message || event.message || "Uncaught Error";
        const src = event.filename ? `${event.filename}:${event.lineno || 0}` : "";
        recordConsoleError("uncaught_error", msg, src);
      } catch (_) {}
    });

    window.addEventListener("unhandledrejection", (event) => {
      try {
        const reason = event.reason;
        const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : formatErrorArg(reason);
        recordConsoleError("unhandled_rejection", msg);
      } catch (_) {}
    });

    // 3. Hook window.fetch for 4xx/5xx & network failures
    if (typeof window.fetch === "function") {
      const origFetch = window.fetch;
      window.fetch = async function (...args) {
        const start = performance.now();
        let reqUrl = "";
        let reqMethod = "GET";
        try {
          const input = args[0];
          const init = args[1] || {};
          if (typeof input === "string") {
            reqUrl = input;
          } else if (input && typeof input.url === "string") {
            reqUrl = input.url;
            if (input.method) reqMethod = input.method;
          } else if (input instanceof URL) {
            reqUrl = input.href;
          }
          if (init && init.method) reqMethod = init.method;
        } catch (_) {}

        try {
          const response = await origFetch.apply(this, args);
          if (response && response.status >= 400) {
            recordNetworkError(reqMethod, response.url || reqUrl, response.status, response.statusText, performance.now() - start);
          }
          return response;
        } catch (err) {
          if (err && err.name !== "AbortError") {
            recordNetworkError(reqMethod, reqUrl, 0, err.message || "Network Error", performance.now() - start);
          }
          throw err;
        }
      };
    }

    // 4. Hook XMLHttpRequest for 4xx/5xx & network failures
    if (typeof XMLHttpRequest !== "undefined" && XMLHttpRequest.prototype) {
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        try {
          this.__apMethod = method || "GET";
          this.__apUrl = String(url || "");
        } catch (_) {}
        return origOpen.call(this, method, url, ...rest);
      };

      XMLHttpRequest.prototype.send = function (...args) {
        try {
          const start = performance.now();
          this.addEventListener("loadend", () => {
            try {
              if (this.status >= 400) {
                recordNetworkError(
                  this.__apMethod,
                  this.responseURL || this.__apUrl,
                  this.status,
                  this.statusText || `HTTP ${this.status}`,
                  performance.now() - start
                );
              }
            } catch (_) {}
          });
          this.addEventListener("error", () => {
            try {
              recordNetworkError(
                this.__apMethod,
                this.responseURL || this.__apUrl,
                0,
                "XHR Network Error",
                performance.now() - start
              );
            } catch (_) {}
          });
        } catch (_) {}
        return origSend.apply(this, args);
      };
    }
  }

  window.addEventListener("__AP_DIAGNOSTICS_REQ__", (e) => {
    const reqId = e.detail?.reqId;
    const clear = Boolean(e.detail?.clear);
    const clearStorage = Boolean(e.detail?.clearStorage);

    let clearedStorageDetails = null;
    if (clearStorage) {
      let localCount = 0;
      let sessionCount = 0;
      let cookieCount = 0;
      try {
        localCount = window.localStorage ? window.localStorage.length : 0;
        window.localStorage?.clear();
      } catch (_) {}
      try {
        sessionCount = window.sessionStorage ? window.sessionStorage.length : 0;
        window.sessionStorage?.clear();
      } catch (_) {}
      try {
        const cookies = document.cookie ? document.cookie.split(";") : [];
        for (const c of cookies) {
          const eqPos = c.indexOf("=");
          const name = (eqPos > -1 ? c.slice(0, eqPos) : c).trim();
          if (name) {
            cookieCount++;
            document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
          }
        }
      } catch (_) {}
      clearedStorageDetails = { localCount, sessionCount, cookieCount };
    }

    const consoleSnapshot = qaConsoleErrors.slice();
    const networkSnapshot = qaNetworkErrors.slice();

    if (clear || clearStorage) {
      qaConsoleErrors.length = 0;
      qaNetworkErrors.length = 0;
    }

    window.dispatchEvent(new CustomEvent("__AP_DIAGNOSTICS_RESP__", {
      detail: {
        reqId,
        consoleErrors: consoleSnapshot,
        networkErrors: networkSnapshot,
        clearedStorage: clearedStorageDetails
      }
    }));
  });
})();
