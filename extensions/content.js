/**
 * Agent Pilot - Injected Content Script (Modular Coordinator)
 * Coordinates Virtual Mouse, Human Input Lock Shield, DOM Inspector, and Eyedropper
 */

(function () {
  // Prevent multiple injections
  if (window.__AGENT_PILOT_INITIALIZED__) return;
  window.__AGENT_PILOT_INITIALIZED__ = true;

  const modules = window.__AP_INTERNAL__ || {};
  const shield = modules.shield || {
    setAgentBusyState: () => {},
    isBusy: () => false,
    isDispatching: () => false,
    setIsDispatching: () => {},
    getLockOverlayEl: () => null
  };
  const cursor = modules.cursor || {
    moveVirtualMouse: () => Promise.resolve({ success: false }),
    virtualClick: () => Promise.resolve({ success: false }),
    virtualType: () => Promise.resolve({ success: false }),
    virtualScroll: () => ({ success: false }),
    dispatchKey: () => ({ success: false }),
    getCursorPosition: () => ({ x: 0, y: 0 })
  };
  const inspector = modules.inspector || {
    toggleInspector: () => {},
    isInspectorActive: () => false,
    getDetailedElementInfo: () => null,
    getLockedElement: () => null,
    startRegionCrop: () => {}
  };
  const eyedropper = modules.eyedropper || {
    pickColor: () => Promise.resolve(null)
  };

  let isAgentTab = false;

  // =========================================================================
  // Antigravity-First Global Bridge API (`window.__AGENT_PILOT__`)
  // =========================================================================

  window.__AGENT_PILOT__ = {
    version: "1.0.0",
    moveMouse: (x, y, duration) => cursor.moveVirtualMouse(x, y, duration),
    click: (x, y, selector) => cursor.virtualClick(x, y, selector),
    type: (selector, text, clear, pressEnter) => cursor.virtualType(selector, text, clear, pressEnter),
    scroll: (deltaX, deltaY) => cursor.virtualScroll(deltaX, deltaY),
    toggleInspector: (enabled) => inspector.toggleInspector(enabled),
    getElement: (selector) => {
      const el = document.querySelector(selector);
      return inspector.getDetailedElementInfo(el);
    },
    startRegionCrop: () => inspector.startRegionCrop(),
    pickColor: () => eyedropper.pickColor(),
    getLockedElement: () => inspector.getLockedElement(),
    getCursorPosition: () => cursor.getCursorPosition(),
    setBusy: (busy, action) => shield.setAgentBusyState(busy, action),
    isBusy: () => shield.isBusy(),
    isAgentTab: () => isAgentTab,
    setAgentTab: (enabled) => {
      isAgentTab = Boolean(enabled);
      return isAgentTab;
    }
  };

  // Bridge to Main World so page scripts, DevTools Console and Agents can access window.__AGENT_PILOT__
  try {
    const bridgeScript = document.createElement("script");
    bridgeScript.textContent = `
      (() => {
        if (window.__AGENT_PILOT__) return;
        function sendBridgeRequest(action, data = {}) {
          return new Promise((resolve) => {
            const reqId = "ap_" + Math.random().toString(36).substr(2, 9);
            function onResponse(e) {
              if (e.detail && e.detail.reqId === reqId) {
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

        window.__AGENT_PILOT__ = {
          version: "1.0.0",
          moveMouse: (x, y, duration) => sendBridgeRequest("virtual_mouse_move", { x, y, duration }),
          click: (x, y) => sendBridgeRequest("virtual_mouse_click", { x, y }),
          type: (selector, text) => sendBridgeRequest("virtual_type", { selector, text }),
          scroll: (deltaX, deltaY) => sendBridgeRequest("virtual_scroll", { deltaX, deltaY }),
          toggleInspector: (enabled) => sendBridgeRequest("toggle_inspector", { enabled }),
          getElement: (selector) => sendBridgeRequest("get_element_info", { selector }),
          pickColor: () => sendBridgeRequest("pick_color", {}),
          getCursorPosition: () => sendBridgeRequest("get_cursor_pos", {}),
          isBusy: () => sendBridgeRequest("is_busy", {}),
          isAgentTab: () => sendBridgeRequest("is_agent_tab", {}),
          setBusy: (busy, action) => sendBridgeRequest("set_busy", { busy, action })
        };
      })();
    `;
    (document.head || document.documentElement).appendChild(bridgeScript);
    bridgeScript.remove();
  } catch (e) {}

  // Listen for bridge requests from Main World
  window.addEventListener("__AGENT_PILOT_REQ__", async (e) => {
    if (!e.detail) return;
    const { reqId, action, data } = e.detail;
    let result = null;
    if (action === "virtual_mouse_move") result = await cursor.moveVirtualMouse(data.x, data.y, data.duration);
    else if (action === "virtual_mouse_click") result = await cursor.virtualClick(data.x, data.y);
    else if (action === "virtual_type") result = await cursor.virtualType(data.selector, data.text);
    else if (action === "virtual_scroll") result = cursor.virtualScroll(data.deltaX, data.deltaY);
    else if (action === "toggle_inspector") { inspector.toggleInspector(data.enabled); result = { success: true, active: inspector.isInspectorActive() }; }
    else if (action === "is_inspector_active") result = inspector.isInspectorActive();
    else if (action === "get_element_info") {
      const el = document.querySelector(data.selector);
      result = inspector.getDetailedElementInfo(el);
    }
    else if (action === "pick_color") result = await eyedropper.pickColor();
    else if (action === "get_cursor_pos") result = cursor.getCursorPosition();
    else if (action === "is_busy") result = shield.isBusy();
    else if (action === "is_agent_tab") result = isAgentTab;
    else if (action === "set_busy") { shield.setAgentBusyState(data.busy, data.action); result = { success: true, isAgentBusy: shield.isBusy() }; }

    window.dispatchEvent(new CustomEvent("__AGENT_PILOT_RESP__", {
      detail: { reqId, result }
    }));
  });

  // Listen for messages from Background & Side Panel
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === "virtual_mouse_move" || req.action === "move_cursor") {
      cursor.moveVirtualMouse(req.x, req.y, req.duration || 300).then(sendResponse);
      return true;
    }

    if (req.action === "virtual_mouse_click" || req.action === "click_cursor") {
      if (req.selector && (!req.x || !req.y)) {
        const el = document.querySelector(req.selector);
        if (el) {
          const r = el.getBoundingClientRect();
          const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
          if (!inView) {
            el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
          }
          const rect = el.getBoundingClientRect();
          req.x = rect.left + rect.width / 2;
          req.y = rect.top + rect.height / 2;
        }
      }
      cursor.virtualClick(req.x, req.y, req.selector).then(sendResponse);
      return true;
    }

    if (req.action === "virtual_type" || req.action === "type_text") {
      cursor.virtualType(req.selector, req.text, req.clear, req.pressEnter).then(sendResponse);
      return true;
    }

    if (req.action === "press_key" || req.action === "dispatch_key") {
      sendResponse(cursor.dispatchKey(req.key, req.code, req.keyCode, req.selector));
      return true;
    }

    if (req.action === "virtual_scroll" || req.action === "scroll_page") {
      sendResponse(cursor.virtualScroll(req.deltaX, req.deltaY));
      return true;
    }

    if (req.action === "scroll_into_view") {
      const el = document.querySelector(req.selector);
      if (!el) {
        sendResponse({ success: false, error: `Selector '${req.selector}' not found` });
        return true;
      }
      el.scrollIntoView({ behavior: req.behavior || "auto", block: req.block || "center", inline: req.inline || "center" });
      const rect = el.getBoundingClientRect();
      sendResponse({ success: true, rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } });
      return true;
    }

    if (req.action === "wait_for_selector") {
      const selector = req.selector;
      const timeoutMs = Number(req.timeoutMs || req.timeout || 5000);
      const startTime = Date.now();
      const checkInterval = 100;

      const check = () => {
        const el = document.querySelector(selector);
        if (el) {
          sendResponse({ success: true, found: true, details: inspector.getDetailedElementInfo(el) });
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          sendResponse({ success: false, found: false, error: `Selector '${selector}' not found within ${timeoutMs}ms` });
          return;
        }
        setTimeout(check, checkInterval);
      };
      check();
      return true;
    }

    if (req.action === "toggle_inspector") {
      inspector.toggleInspector(req.enabled);
      sendResponse({ success: true, active: inspector.isInspectorActive() });
      return true;
    }

    if (req.action === "get_element_info") {
      const el = req.selector ? document.querySelector(req.selector) : null;
      const details = el ? inspector.getDetailedElementInfo(el) : inspector.getLockedElement();
      sendResponse({ success: !!(el || details), ...(details || {}), details });
      return true;
    }

    if (req.action === "start_region_crop") {
      inspector.startRegionCrop();
      sendResponse({ success: true });
      return true;
    }

    if (req.action === "pick_color") {
      eyedropper.pickColor().then((color) => sendResponse({ success: !!color, color }));
      return true;
    }

    if (req.action === "set_agent_tab_status") {
      isAgentTab = Boolean(req.isAgentTab);
      sendResponse({ success: true, isAgentTab });
      return true;
    }

    if (req.action === "set_agent_busy") {
      shield.setAgentBusyState(req.busy, req.currentAction || "");
      sendResponse({ success: true, isAgentBusy: shield.isBusy() });
      return true;
    }

    if (req.action === "ping") {
      sendResponse({ success: true, status: "ready", isAgentTab, isAgentBusy: shield.isBusy() });
      return true;
    }
  });

  // Keep background service worker alive and connected to Agent Pilot bridge
  function setupServiceWorkerKeepAlive() {
    try {
      if (!chrome.runtime || !chrome.runtime.connect) return;
      const port = chrome.runtime.connect({ name: "agent-pilot-keepalive" });
      port.onDisconnect.addListener(() => {
        // Automatically reconnect after a short delay if context is still valid
        setTimeout(() => {
          try {
            setupServiceWorkerKeepAlive();
          } catch (_) {}
        }, 1500);
      });
    } catch (_) {}
  }
  setupServiceWorkerKeepAlive();

  console.log("🚀 [Agent Pilot] Injected and ready for AI Agent control. Antigravity-First.");
})();
