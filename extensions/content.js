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
    setSessionActive: () => {},
    isSessionActive: () => false,
    isBusy: () => false,
    isDispatching: () => false,
    setIsDispatching: () => {},
    getLockOverlayEl: () => null
  };
  const cursor = modules.cursor || {
    moveVirtualMouse: () => Promise.resolve({ success: false }),
    virtualClick: () => Promise.resolve({ success: false }),
    animateCursorClick: () => Promise.resolve({ success: false }),
    virtualType: () => Promise.resolve({ success: false }),
    virtualScroll: () => ({ success: false }),
    virtualFillForm: () => Promise.resolve({ success: false }),
    virtualHover: () => Promise.resolve({ success: false }),
    virtualDrag: () => Promise.resolve({ success: false }),
    waitFor: () => Promise.resolve({ success: false }),
    dispatchKey: () => ({ success: false }),
    resolveElement: () => null,
    getCursorPosition: () => ({ x: 0, y: 0 }),
    activateCursor: () => {},
    setSessionActive: () => {}
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
    : "1.2.1";

  function resolveTargetElement(selector) {
    if (!selector) return null;
    return cursor.resolveElement ? cursor.resolveElement(selector) : document.querySelector(selector);
  }

  // =========================================================================
  // Antigravity-First Global Bridge API (`window.__AGENT_PILOT__`)
  // =========================================================================

  window.__AGENT_PILOT__ = {
    version: EXTENSION_VERSION,
    moveMouse: (x, y, duration) => cursor.moveVirtualMouse(x, y, duration),
    click: (x, y, selector) => cursor.virtualClick(x, y, selector),
    animateClick: (x, y, selector) => cursor.animateCursorClick(x, y, selector),
    type: (selector, text, clear, pressEnter) => cursor.virtualType(selector, text, clear, pressEnter),
    scroll: (deltaX, deltaY) => cursor.virtualScroll(deltaX, deltaY),
    toggleInspector: (enabled) => inspector.toggleInspector(enabled),
    getElement: (selector, includeStyles = false) => {
      return inspector.getDetailedElementInfo(resolveTargetElement(selector), includeStyles);
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

  // Table-driven dispatcher for Main World bridge requests (__AGENT_PILOT_REQ__)
  const BRIDGE_ACTION_HANDLERS = {
    virtual_mouse_move: (d) => cursor.moveVirtualMouse(d.x, d.y, d.duration),
    virtual_mouse_click: (d) => cursor.virtualClick(d.x, d.y),
    animate_cursor_click: (d) => cursor.animateCursorClick(d.x, d.y, d.selector),
    virtual_type: (d) => cursor.virtualType(d.selector, d.text, d.clear),
    virtual_scroll: (d) => cursor.virtualScroll(d.deltaX, d.deltaY),
    virtual_hover: (d) => cursor.virtualHover(d.selector),
    virtual_drag: (d) => cursor.virtualDrag(d.from, d.to, d.steps),
    press_key: (d) => cursor.dispatchKey(d.key, d.code, d.keyCode, d.selector),
    wait_for: (d) => cursor.waitFor(d),
    toggle_inspector: (d) => {
      inspector.toggleInspector(d.enabled);
      return { success: true, active: inspector.isInspectorActive() };
    },
    is_inspector_active: () => inspector.isInspectorActive(),
    get_element_info: (d) => inspector.getDetailedElementInfo(resolveTargetElement(d.selector), Boolean(d.includeStyles)),
    get_locked_element: () => inspector.getLockedElement(),
    get_snapshot: (d) => inspector.getInteractiveSnapshot(d.maxElements, d.format),
    fill_form: (d) => cursor.virtualFillForm(d.fields, d.submitSelector, d.pressEnter),
    start_element_snap: () => { inspector.startElementSnap(); return { success: true }; },
    stop_element_snap: () => { inspector.stopElementSnap(); return { success: true }; },
    is_element_snap_active: () => inspector.isElementSnapActive(),
    start_region_crop: () => { inspector.startRegionCrop(); return { success: true }; },
    pick_color: (d) => eyedropper.pickColor(d.x, d.y),
    stop_eyedropper: () => { eyedropper.stopEyedropper(); return { success: true }; },
    is_eyedropper_active: () => eyedropper.isEyedropperActive(),
    get_cursor_pos: () => cursor.getCursorPosition(),
    is_busy: () => shield.isBusy(),
    is_agent_tab: () => isAgentTab,
    set_busy: (d) => {
      shield.setAgentBusyState(d.busy, d.action);
      return { success: true, isAgentBusy: shield.isBusy() };
    },
    start_feedback_studio: () => { feedback.start(); return { success: true, active: feedback.isActive() }; },
    stop_feedback_studio: () => { feedback.stop(); return { success: true, active: feedback.isActive() }; },
    is_feedback_studio_active: () => feedback.isActive(),
    get_feedback_items: () => feedback.getItems(),
    add_feedback_item: (d) => feedback.addItem(d.item),
    clear_feedback_items: () => { feedback.clearAll(); return { success: true }; },
    copy_feedback_prompt: () => feedback.copyPrompt(),
    generate_feedback_prompt: (d) => feedback.generateMarkdownPrompt(d.items)
  };

  // Listen for bridge requests from Main World (main-world-bridge.js)
  window.addEventListener("__AGENT_PILOT_REQ__", async (e) => {
    if (!e.detail) return;
    const { reqId, action, data = {} } = e.detail;
    let result = null;
    let error = null;
    try {
      const handler = BRIDGE_ACTION_HANDLERS[action];
      if (handler) {
        result = await handler(data);
      } else {
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

  // Shared handlers for Background & Side Panel runtime messages
  const moveCursorHandler = (req) => cursor.moveVirtualMouse(req.x, req.y, req.duration || MOUSE_MOVE_DEFAULT_MS);
  const clickCursorHandler = (req) => cursor.virtualClick(
    req.x,
    req.y,
    req.selector,
    req.fallbackHints || null,
    req.clickCount
  );
  const typeTextHandler = (req) => cursor.virtualType(req.selector, req.text, req.clear, req.pressEnter, req.fallbackHints || null);
  const pressKeyHandler = (req) => {
    if (req.eventType && typeof cursor.dispatchKeyEvent === "function") {
      return cursor.dispatchKeyEvent(req.key, req.code, req.keyCode, req.selector, req.eventType, req.modifiers);
    }
    return cursor.dispatchKey(req.key, req.code, req.keyCode, req.selector, {
      keys: req.keys,
      delayMs: req.delayMs,
      repeat: req.repeat
    });
  };
  const hoverHandler = (req) => cursor.virtualHover(req.selector, { dispatchSynthetic: req.dispatchSynthetic });
  const dragHandler = (req) => cursor.virtualDrag(req.fromSelector || req.from, req.toSelector || req.to, req.steps);
  const scrollHandler = (req) => cursor.virtualScroll(req.deltaX, req.deltaY);

  const RUNTIME_ACTION_HANDLERS = {
    virtual_mouse_move: moveCursorHandler,
    move_cursor: moveCursorHandler,
    virtual_mouse_click: clickCursorHandler,
    click_cursor: clickCursorHandler,
    animate_cursor_click: (req) => cursor.animateCursorClick(req.x, req.y, req.selector),
    virtual_type: typeTextHandler,
    type_text: typeTextHandler,
    press_key: pressKeyHandler,
    dispatch_key: pressKeyHandler,
    virtual_hover: hoverHandler,
    hover: hoverHandler,
    virtual_drag: dragHandler,
    drag: dragHandler,
    virtual_scroll: scrollHandler,
    scroll_page: scrollHandler,
    wait_for: (req) => cursor.waitFor(req),
    focus_element: (req) => {
      const el = resolveTargetElement(req.selector);
      if (!el) return { success: false, error: "Element not found for selector: " + req.selector };
      if (typeof el.focus === "function") el.focus();
      return { success: true };
    },
    mark_upload_target: (req) => {
      const el = resolveTargetElement(req.selector);
      if (!el) return { success: false, error: "Element not found for selector: " + req.selector };
      let target = el;
      if (target.tagName !== "INPUT" || (target.type && target.type.toLowerCase() !== "file")) {
        const fileInput = target.querySelector ? target.querySelector("input[type=file]") : null;
        if (fileInput) target = fileInput;
      }
      const marker = "ap-upload-" + Math.random().toString(36).slice(2, UNIQUE_ID_SALT_LEN);
      target.setAttribute("data-agent-pilot-upload", marker);
      return { success: true, marker };
    },
    unmark_upload_target: (req) => {
      if (req.marker) {
        const target = document.querySelector(`[data-agent-pilot-upload="${req.marker}"]`);
        if (target) target.removeAttribute("data-agent-pilot-upload");
      }
      for (const tempInput of document.querySelectorAll('[data-ap-temp-upload-input="1"]')) {
        tempInput.remove();
      }
      return { success: true };
    },
    mark_eval_targets: (req) => {
      const rawArgs = Array.isArray(req.args) ? req.args : [];
      const prefix = "ap-eval-" + Math.random().toString(36).slice(2, UNIQUE_ID_SALT_LEN);
      const cleanupPrefix = () => {
        for (let j = 0; j < rawArgs.length; j++) {
          const attr = `data-ap-eval-arg-${j}`;
          for (const marked of document.querySelectorAll(`[${attr}="${prefix}"]`)) {
            marked.removeAttribute(attr);
          }
        }
      };
      const descriptors = [];
      for (let i = 0; i < rawArgs.length; i++) {
        const item = rawArgs[i];
        let selectorCandidate = null;
        let requireElement = false;
        if (typeof item === "string") {
          const trimmed = item.trim();
          if (/^@\d+$/.test(trimmed)) {
            selectorCandidate = trimmed;
            requireElement = true;
          } else if (trimmed.length > 0) {
            selectorCandidate = trimmed;
          }
        } else if (item && typeof item === "object" && !Array.isArray(item) && (typeof item.selector === "string" || typeof item.ref === "string")) {
          selectorCandidate = String(item.selector || item.ref).trim();
          requireElement = true;
        }

        if (selectorCandidate) {
          let el = null;
          try {
            el = resolveTargetElement(selectorCandidate);
          } catch (_) {
            el = null;
          }
          if (el) {
            const attr = `data-ap-eval-arg-${i}`;
            el.setAttribute(attr, prefix);
            descriptors.push({ kind: "element", attr, prefix, selector: selectorCandidate });
            continue;
          }
          if (requireElement) {
            cleanupPrefix();
            return { success: false, error: `Element not found for evaluate argument: ${selectorCandidate}` };
          }
        }
        descriptors.push({ kind: "value", value: item });
      }
      return { success: true, prefix, count: rawArgs.length, descriptors };
    },
    unmark_eval_targets: (req) => {
      const count = Number(req.count) || 0;
      const prefix = req.prefix || "";
      for (let i = 0; i < count; i++) {
        const attr = `data-ap-eval-arg-${i}`;
        const sel = prefix ? `[${attr}="${prefix}"]` : `[${attr}]`;
        for (const el of document.querySelectorAll(sel)) {
          el.removeAttribute(attr);
        }
      }
      return { success: true };
    },
    scroll_into_view: (req) => {
      const el = resolveTargetElement(req.selector);
      if (!el) return { success: false, error: `Selector '${req.selector}' not found` };
      el.scrollIntoView({ behavior: req.behavior || "auto", block: req.block || "center", inline: req.inline || "center" });
      const rect = el.getBoundingClientRect();
      return {
        success: true,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      };
    },
    wait_for_selector: async (req) => {
      const selector = req.selector;
      const timeoutMs = Number(req.timeoutMs || req.timeout || WAIT_FOR_SELECTOR_DEFAULT_MS);
      const waited = await cursor.waitFor({ selector, state: "attached", timeoutMs });
      if (waited && waited.success) {
        const el = resolveTargetElement(selector);
        if (el) {
          return { success: true, found: true, details: inspector.getDetailedElementInfo(el) };
        }
      }
      return { success: false, found: false, error: `Selector '${selector}' not found within ${timeoutMs}ms` };
    },
    toggle_inspector: (req) => {
      inspector.toggleInspector(req.enabled);
      return { success: true, active: inspector.isInspectorActive() };
    },
    get_element_info: (req) => {
      const el = resolveTargetElement(req.selector);
      if (req.scrollIntoView && el && el.scrollIntoView) {
        const r = el.getBoundingClientRect();
        const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
        if (!inView) {
          el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
        }
      }
      const details = el ? inspector.getDetailedElementInfo(el, Boolean(req.includeStyles)) : inspector.getLockedElement();
      return {
        success: !!(el || details),
        ...(details || {}),
        details,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX || window.pageXOffset || 0,
          scrollY: window.scrollY || window.pageYOffset || 0,
          devicePixelRatio: window.devicePixelRatio || 1
        }
      };
    },
    get_snapshot: (req) => ({
      success: true,
      result: inspector.getInteractiveSnapshot(req.maxElements, req.format)
    }),
    fill_form: (req) => cursor.virtualFillForm(req.fields, req.submitSelector, req.pressEnter),
    start_region_crop: () => { inspector.startRegionCrop(); return { success: true }; },
    start_element_snap: () => { inspector.startElementSnap(); return { success: true }; },
    stop_element_snap: () => { inspector.stopElementSnap(); return { success: true }; },
    copy_image_to_clipboard: async (req) => {
      if (!req.dataUrl) return { success: false, error: "Missing dataUrl" };
      if (!navigator.clipboard || !navigator.clipboard.write) {
        throw new Error("Tính năng sao chép yêu cầu trang web chạy trong bối cảnh an toàn (HTTPS/Localhost)");
      }
      const parts = req.dataUrl.split(",");
      const binStr = atob(parts[1]);
      const u8arr = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) u8arr[i] = binStr.charCodeAt(i);
      const blob = new Blob([u8arr], { type: "image/png" });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      if (req.showInPageToast) {
        window.__AP_INTERNAL__.showToast?.("📋 Đã sao chép ảnh vào clipboard!");
      }
      return { success: true };
    },
    pick_color: async (req) => {
      const color = await eyedropper.pickColor(req.x, req.y);
      return { success: !!color, color };
    },
    stop_eyedropper: () => { eyedropper.stopEyedropper(); return { success: true }; },
    is_eyedropper_active: () => ({ active: eyedropper.isEyedropperActive() }),
    toggle_feedback_studio: (req) => {
      if (req.enabled) feedback.start();
      else feedback.stop();
      return { success: true, active: feedback.isActive(), items: feedback.getItems() };
    },
    get_feedback_studio_state: () => ({
      success: true,
      active: feedback.isActive(),
      items: feedback.getItems()
    }),
    set_feedback_mode: (req) => {
      feedback.setMode(req.mode);
      return { success: true, mode: req.mode };
    },
    copy_feedback_prompt: async () => {
      await feedback.copyPrompt();
      return { success: true };
    },
    update_feedback_comment: (req) => {
      feedback.updateComment(req.id, req.comment);
      return { success: true, items: feedback.getItems() };
    },
    delete_feedback_item: (req) => {
      feedback.deleteItem(req.id);
      return { success: true, items: feedback.getItems() };
    },
    clear_feedback_items: () => {
      feedback.clearAll();
      return { success: true, items: feedback.getItems() };
    },
    save_feedback_inbox_tab: () => feedback.saveToInbox(),
    push_feedback_agent_tab: () => feedback.pushToAgent(),
    get_page_diagnostics: async (req) => {
      if (!inspector.queryPageDiagnostics) {
        return { success: false, error: "Diagnostics unavailable" };
      }
      const diagnostics = await inspector.queryPageDiagnostics({
        clear: Boolean(req.clear),
        clearStorage: Boolean(req.clearStorage)
      });
      return { success: true, diagnostics };
    },
    export_repro_batch: () => ({
      success: true,
      batch: inspector.exportReproBatchJson ? inspector.exportReproBatchJson() : { actions: [] }
    }),
    set_agent_tab_status: (req) => {
      isAgentTab = Boolean(req.isAgentTab);
      return { success: true, isAgentTab };
    },
    set_agent_session: (req) => {
      const active = Boolean(req.active);
      shield.setSessionActive(active, req.sessionName || "");
      cursor.setSessionActive(active);
      return {
        success: true,
        sessionActive: active,
        sessionName: req.sessionName || "",
        isAgentBusy: shield.isBusy()
      };
    },
    set_agent_busy: (req) => {
      shield.setAgentBusyState(req.busy, req.currentAction || "");
      if (req.busy) {
        cursor.activateCursor(CURSOR_BUSY_MS);
      }
      return { success: true, isAgentBusy: shield.isBusy(), isSessionActive: shield.isSessionActive() };
    },
    ping: () => ({
      success: true,
      status: "ready",
      isAgentTab,
      isAgentBusy: shield.isBusy(),
      isSessionActive: shield.isSessionActive()
    })
  };

  // Listen for messages from Background & Side Panel
  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    const handler = req && RUNTIME_ACTION_HANDLERS[req.action];
    if (!handler) {
      sendResponse({ success: false, error: `Unknown action: ${req?.action || req?.type || "unnamed"}` });
      return true;
    }
    Promise.resolve()
      .then(() => handler(req))
      .then(sendResponse)
      .catch((err) => {
        console.warn("[AgentPilot] Content script action error:", req.action, err);
        sendResponse({ success: false, error: err?.message || String(err) });
      });
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
