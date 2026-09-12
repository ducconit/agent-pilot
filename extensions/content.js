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
    startRegionCrop: () => {},
    startElementSnap: () => {},
    stopElementSnap: () => {},
    isElementSnapActive: () => false
  };
  const eyedropper = modules.eyedropper || {
    pickColor: () => Promise.resolve(null),
    stopEyedropper: () => {},
    isEyedropperActive: () => false
  };
  const feedback = modules.feedback || {
    start: () => {},
    stop: () => {},
    isActive: () => false,
    getItems: () => [],
    setMode: () => {},
    copyPrompt: () => Promise.resolve(),
    deleteItem: () => {},
    clearAll: () => {},
    generateMarkdownPrompt: () => null
  };

  let isAgentTab = false;

  const EXTENSION_VERSION = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest)
    ? (chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version)
    : "1.0.1-beta";

  // =========================================================================
  // Antigravity-First Global Bridge API (`window.__AGENT_PILOT__`)
  // =========================================================================

  window.__AGENT_PILOT__ = {
    version: EXTENSION_VERSION,
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
    startElementSnap: () => inspector.startElementSnap(),
    stopElementSnap: () => inspector.stopElementSnap(),
    isElementSnapActive: () => inspector.isElementSnapActive(),
    pickColor: (x, y) => eyedropper.pickColor(x, y),
    stopEyedropper: () => eyedropper.stopEyedropper(),
    isEyedropperActive: () => eyedropper.isEyedropperActive(),
    startFeedbackStudio: () => feedback.start(),
    stopFeedbackStudio: () => feedback.stop(),
    isFeedbackStudioActive: () => feedback.isActive(),
    getFeedbackItems: () => feedback.getItems(),
    addFeedbackItem: (item) => feedback.addItem(item),
    clearFeedbackItems: () => feedback.clearAll(),
    copyFeedbackPrompt: () => feedback.copyPrompt(),
    generateFeedbackPrompt: (items) => feedback.generateMarkdownPrompt(items),
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
            const timer = setTimeout(() => {
              window.removeEventListener("__AGENT_PILOT_RESP__", onResponse);
              resolve(null);
            }, 5000);
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

        window.__AGENT_PILOT__ = window.__AGENT_PILOT__ || {};
        Object.assign(window.__AGENT_PILOT__, {
          version: "${EXTENSION_VERSION}",
          moveMouse: (x, y, duration) => sendBridgeRequest("virtual_mouse_move", { x, y, duration }),
          click: (x, y) => sendBridgeRequest("virtual_mouse_click", { x, y }),
          type: (selector, text) => sendBridgeRequest("virtual_type", { selector, text }),
          scroll: (deltaX, deltaY) => sendBridgeRequest("virtual_scroll", { deltaX, deltaY }),
          toggleInspector: (enabled) => sendBridgeRequest("toggle_inspector", { enabled }),
          getElement: (selector) => sendBridgeRequest("get_element_info", { selector }),
          startElementSnap: () => sendBridgeRequest("start_element_snap", {}),
          stopElementSnap: () => sendBridgeRequest("stop_element_snap", {}),
          isElementSnapActive: () => sendBridgeRequest("is_element_snap_active", {}),
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
        });
      })();
    `;
    (document.head || document.documentElement).appendChild(bridgeScript);
    bridgeScript.remove();
  } catch (e) {}

  // Listen for bridge requests from Main World
  window.addEventListener("__AGENT_PILOT_REQ__", async (e) => {
    if (!e.detail) return;
    const { reqId, action, data = {} } = e.detail;
    let result = null;
    let error = null;
    try {
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
      else if (action === "start_element_snap") { inspector.startElementSnap(); result = { success: true }; }
      else if (action === "stop_element_snap") { inspector.stopElementSnap(); result = { success: true }; }
      else if (action === "is_element_snap_active") result = inspector.isElementSnapActive();
      else if (action === "pick_color") result = await eyedropper.pickColor(data.x, data.y);
      else if (action === "stop_eyedropper") { eyedropper.stopEyedropper(); result = { success: true }; }
      else if (action === "is_eyedropper_active") result = eyedropper.isEyedropperActive();
      else if (action === "get_cursor_pos") result = cursor.getCursorPosition();
      else if (action === "is_busy") result = shield.isBusy();
      else if (action === "is_agent_tab") result = isAgentTab;
      else if (action === "set_busy") { shield.setAgentBusyState(data.busy, data.action); result = { success: true, isAgentBusy: shield.isBusy() }; }
      else if (action === "start_feedback_studio") { feedback.start(); result = { success: true, active: feedback.isActive() }; }
      else if (action === "stop_feedback_studio") { feedback.stop(); result = { success: true, active: feedback.isActive() }; }
      else if (action === "is_feedback_studio_active") result = feedback.isActive();
      else if (action === "get_feedback_items") result = feedback.getItems();
      else if (action === "add_feedback_item") result = feedback.addItem(data.item);
      else if (action === "clear_feedback_items") { feedback.clearAll(); result = { success: true }; }
      else if (action === "copy_feedback_prompt") result = await feedback.copyPrompt();
      else if (action === "generate_feedback_prompt") result = feedback.generateMarkdownPrompt(data.items);
    } catch (err) {
      console.warn("[AgentPilot] Bridge request error:", action, err);
      error = err?.message || String(err);
    }

    window.dispatchEvent(new CustomEvent("__AGENT_PILOT_RESP__", {
      detail: { reqId, result, error }
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

    if (req.action === "start_element_snap") {
      inspector.startElementSnap();
      sendResponse({ success: true });
      return true;
    }

    if (req.action === "stop_element_snap") {
      inspector.stopElementSnap();
      sendResponse({ success: true });
      return true;
    }

    if (req.action === "copy_image_to_clipboard" && req.dataUrl) {
      (async () => {
        try {
          if (!navigator.clipboard || !navigator.clipboard.write) {
            throw new Error("Tính năng sao chép yêu cầu trang web chạy trong bối cảnh an toàn (HTTPS/Localhost)");
          }
          const parts = req.dataUrl.split(",");
          const binStr = atob(parts[1]);
          const u8arr = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) u8arr[i] = binStr.charCodeAt(i);
          const blob = new Blob([u8arr], { type: "image/png" });
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob })
          ]);
          if (req.showInPageToast) {
            toast.showToast("📋 Đã sao chép ảnh vào clipboard!");
          }
          sendResponse({ success: true });
        } catch (e) {
          console.warn("[AgentPilot] Content script clipboard copy error:", e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (req.action === "pick_color") {
      eyedropper.pickColor(req.x, req.y).then((color) => sendResponse({ success: !!color, color }));
      return true;
    }

    if (req.action === "stop_eyedropper") {
      eyedropper.stopEyedropper();
      sendResponse({ success: true });
      return true;
    }

    if (req.action === "is_eyedropper_active") {
      sendResponse({ active: eyedropper.isEyedropperActive() });
      return true;
    }

    if (req.action === "toggle_feedback_studio") {
      if (req.enabled) {
        feedback.start();
      } else {
        feedback.stop();
      }
      sendResponse({ success: true, active: feedback.isActive(), items: feedback.getItems() });
      return true;
    }

    if (req.action === "get_feedback_studio_state") {
      sendResponse({
        success: true,
        active: feedback.isActive(),
        items: feedback.getItems()
      });
      return true;
    }

    if (req.action === "set_feedback_mode") {
      feedback.setMode(req.mode);
      sendResponse({ success: true, mode: req.mode });
      return true;
    }

    if (req.action === "copy_feedback_prompt") {
      feedback.copyPrompt().then(() => sendResponse({ success: true }));
      return true;
    }

    if (req.action === "delete_feedback_item") {
      feedback.deleteItem(req.id);
      sendResponse({ success: true, items: feedback.getItems() });
      return true;
    }

    if (req.action === "clear_feedback_items") {
      feedback.clearAll();
      sendResponse({ success: true, items: feedback.getItems() });
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
