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
    virtualFillForm: () => Promise.resolve({ success: false }),
    dispatchKey: () => ({ success: false }),
    resolveElement: () => null,
    getCursorPosition: () => ({ x: 0, y: 0 })
  };
  const inspector = modules.inspector || {
    toggleInspector: () => {},
    isInspectorActive: () => false,
    getDetailedElementInfo: () => null,
    getInteractiveSnapshot: () => null,
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
    updateComment: () => {},
    clearAll: () => {},
    generateMarkdownPrompt: () => null
  };

  // Shared config with local fallbacks (see content/config.js).
  const T = (window.__AP_CONFIG__ && window.__AP_CONFIG__.timeouts) || {};
  const IDS = (window.__AP_CONFIG__ && window.__AP_CONFIG__.ids) || {};
  const BRIDGE_REQUEST_MS = T.bridgeRequestMs || 5000;
  const BRIDGE_MAX_DELAY_MS = T.bridgeMaxDelayMs || 2147483647;
  const WAIT_FOR_EXTRA_MS = T.waitForExtraMs || 3000;
  const WAIT_FOR_SELECTOR_DEFAULT_MS = T.waitForSelectorDefaultMs || 5000;
  const MOUSE_MOVE_DEFAULT_MS = T.mouseMoveDefaultMs || 300;
  const CURSOR_BUSY_MS = T.cursorBusyMs || 3000;
  const KEEPALIVE_RECONNECT_MS = T.keepAliveReconnectMs || 1500;
  const UNIQUE_ID_SALT_LEN = IDS.uniqueIdSaltLen || 9;

  let isAgentTab = false;

  const EXTENSION_VERSION = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest)
    ? (chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version)
    : "1.0.7-beta";

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
    getElement: (selector, includeStyles = false) => {
      const el = cursor.resolveElement ? cursor.resolveElement(selector) : document.querySelector(selector);
      return inspector.getDetailedElementInfo(el, includeStyles);
    },
    snapshot: (maxElements, format) => inspector.getInteractiveSnapshot(maxElements, format),
    fillForm: (fields, submitSelector, pressEnter) => cursor.virtualFillForm(fields, submitSelector, pressEnter),
    hover: (selector) => cursor.virtualHover(selector),
    drag: (fromSelector, toSelector, steps) => cursor.virtualDrag(fromSelector, toSelector, steps),
    waitFor: (options) => cursor.waitFor(options),
    pressKey: (key, code, keyCode, selector) => cursor.dispatchKey(key, code, keyCode, selector),
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

  // Listen for bridge requests from Main World (main-world-bridge.js)
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
      else if (action === "virtual_hover") result = await cursor.virtualHover(data.selector);
      else if (action === "virtual_drag") result = await cursor.virtualDrag(data.from, data.to, data.steps);
      else if (action === "press_key") result = cursor.dispatchKey(data.key, data.code, data.keyCode, data.selector);
      else if (action === "wait_for") result = await cursor.waitFor(data);
      else if (action === "toggle_inspector") { inspector.toggleInspector(data.enabled); result = { success: true, active: inspector.isInspectorActive() }; }
      else if (action === "is_inspector_active") result = inspector.isInspectorActive();
      else if (action === "get_element_info") {
        const el = cursor.resolveElement ? cursor.resolveElement(data.selector) : document.querySelector(data.selector);
        result = inspector.getDetailedElementInfo(el, Boolean(data.includeStyles));
      }
      else if (action === "get_locked_element") result = inspector.getLockedElement();
      else if (action === "get_snapshot") result = inspector.getInteractiveSnapshot(data.maxElements, data.format);
      else if (action === "fill_form") result = await cursor.virtualFillForm(data.fields, data.submitSelector, data.pressEnter);
      else if (action === "start_element_snap") { inspector.startElementSnap(); result = { success: true }; }
      else if (action === "stop_element_snap") { inspector.stopElementSnap(); result = { success: true }; }
      else if (action === "is_element_snap_active") result = inspector.isElementSnapActive();
      else if (action === "start_region_crop") { inspector.startRegionCrop(); result = { success: true }; }
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
      else {
        error = `Unsupported or restricted bridge action: ${action}`;
      }
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
      cursor.moveVirtualMouse(req.x, req.y, req.duration || MOUSE_MOVE_DEFAULT_MS).then(sendResponse).catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
      return true;
    }

    if (req.action === "virtual_mouse_click" || req.action === "click_cursor") {
      cursor.virtualClick(req.x, req.y, req.selector, req.fallbackHints || null).then(sendResponse).catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
      return true;
    }

    if (req.action === "virtual_type" || req.action === "type_text") {
      cursor.virtualType(req.selector, req.text, req.clear, req.pressEnter, req.fallbackHints || null).then(sendResponse).catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
      return true;
    }

    if (req.action === "press_key" || req.action === "dispatch_key") {
      sendResponse(cursor.dispatchKey(req.key, req.code, req.keyCode, req.selector));
      return true;
    }

    if (req.action === "virtual_hover" || req.action === "hover") {
      cursor.virtualHover(req.selector, { dispatchSynthetic: req.dispatchSynthetic }).then(sendResponse).catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
      return true;
    }

    if (req.action === "virtual_drag" || req.action === "drag") {
      cursor.virtualDrag(req.fromSelector || req.from, req.toSelector || req.to, req.steps).then(sendResponse).catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
      return true;
    }

    if (req.action === "wait_for") {
      cursor.waitFor(req).then(sendResponse).catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
      return true;
    }

    if (req.action === "focus_element") {
      const el = cursor.resolveElement ? cursor.resolveElement(req.selector) : document.querySelector(req.selector);
      if (!el) {
        sendResponse({ success: false, error: "Element not found for selector: " + req.selector });
        return true;
      }
      if (typeof el.focus === "function") {
        el.focus();
      }
      sendResponse({ success: true });
      return true;
    }

    if (req.action === "mark_upload_target") {
      const el = cursor.resolveElement ? cursor.resolveElement(req.selector) : document.querySelector(req.selector);
      if (!el) {
        sendResponse({ success: false, error: "Element not found for selector: " + req.selector });
        return true;
      }
      let target = el;
      if (target.tagName !== "INPUT" || (target.type && target.type.toLowerCase() !== "file")) {
        const fileInput = target.querySelector ? target.querySelector("input[type=file]") : null;
        if (fileInput) target = fileInput;
      }
      const marker = "ap-upload-" + Math.random().toString(36).slice(2, UNIQUE_ID_SALT_LEN);
      target.setAttribute("data-agent-pilot-upload", marker);
      sendResponse({ success: true, marker });
      return true;
    }

    if (req.action === "unmark_upload_target") {
      const target = document.querySelector(`[data-agent-pilot-upload="${req.marker}"]`);
      if (target) {
        target.removeAttribute("data-agent-pilot-upload");
      }
      sendResponse({ success: true });
      return true;
    }

    if (req.action === "virtual_scroll" || req.action === "scroll_page") {
      sendResponse(cursor.virtualScroll(req.deltaX, req.deltaY));
      return true;
    }

    if (req.action === "scroll_into_view") {
      const el = req.selector ? (cursor.resolveElement ? cursor.resolveElement(req.selector) : document.querySelector(req.selector)) : null;
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
      const timeoutMs = Number(req.timeoutMs || req.timeout || WAIT_FOR_SELECTOR_DEFAULT_MS);
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
      const el = req.selector ? (cursor.resolveElement ? cursor.resolveElement(req.selector) : document.querySelector(req.selector)) : null;
      if (req.scrollIntoView && el && el.scrollIntoView) {
        const r = el.getBoundingClientRect();
        const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
        if (!inView) {
          el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
        }
      }
      const details = el ? inspector.getDetailedElementInfo(el, Boolean(req.includeStyles)) : inspector.getLockedElement();
      sendResponse({
        success: !!(el || details),
        ...(details || {}),
        details,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1
        }
      });
      return true;
    }

    if (req.action === "get_snapshot") {
      const result = inspector.getInteractiveSnapshot(req.maxElements, req.format);
      sendResponse({ success: true, result });
      return true;
    }

    if (req.action === "fill_form") {
      cursor.virtualFillForm(req.fields, req.submitSelector, req.pressEnter).then(sendResponse).catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
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
            window.__AP_INTERNAL__.showToast?.("📋 Đã sao chép ảnh vào clipboard!");
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

    if (req.action === "update_feedback_comment") {
      feedback.updateComment(req.id, req.comment);
      sendResponse({ success: true, items: feedback.getItems() });
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

    if (req.action === "save_feedback_inbox_tab") {
      feedback.saveToInbox().then(sendResponse).catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
      return true;
    }

    if (req.action === "push_feedback_agent_tab") {
      feedback.pushToAgent().then(sendResponse).catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
      return true;
    }

    if (req.action === "get_page_diagnostics") {
      if (inspector.queryPageDiagnostics) {
        inspector.queryPageDiagnostics({
          clear: Boolean(req.clear),
          clearStorage: Boolean(req.clearStorage)
        }).then((diagnostics) => sendResponse({ success: true, diagnostics }))
          .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
      } else {
        sendResponse({ success: false, error: "Diagnostics unavailable" });
      }
      return true;
    }

    if (req.action === "export_repro_batch") {
      const batch = inspector.exportReproBatchJson ? inspector.exportReproBatchJson() : { actions: [] };
      sendResponse({ success: true, batch });
      return true;
    }

    if (req.action === "set_agent_tab_status") {
      isAgentTab = Boolean(req.isAgentTab);
      sendResponse({ success: true, isAgentTab });
      return true;
    }

    if (req.action === "set_agent_session") {
      const active = Boolean(req.active);
      shield.setSessionActive(active, req.sessionName || "");
      cursor.setSessionActive(active);
      sendResponse({
        success: true,
        sessionActive: active,
        sessionName: req.sessionName || "",
        isAgentBusy: shield.isBusy()
      });
      return true;
    }

    if (req.action === "set_agent_busy") {
      shield.setAgentBusyState(req.busy, req.currentAction || "");
      if (req.busy) {
        cursor.activateCursor(CURSOR_BUSY_MS);
      }
      sendResponse({ success: true, isAgentBusy: shield.isBusy(), isSessionActive: shield.isSessionActive() });
      return true;
    }

    if (req.action === "ping") {
      sendResponse({
        success: true,
        status: "ready",
        isAgentTab,
        isAgentBusy: shield.isBusy(),
        isSessionActive: shield.isSessionActive()
      });
      return true;
    }

    sendResponse({ success: false, error: `Unknown action: ${req.action || req.type || "unnamed"}` });
    return true;
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
        }, KEEPALIVE_RECONNECT_MS);
      });
    } catch (_) {}
  }
  setupServiceWorkerKeepAlive();

  console.log("🚀 [Agent Pilot] Injected and ready for AI Agent control. Antigravity-First.");
})();
