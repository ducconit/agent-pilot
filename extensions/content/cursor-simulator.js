/**
 * Agent Pilot - Content Script Virtual Mouse & Cursor Simulator Module
 * Simulates human-like mouse movements, clicks, typing and scrolling
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  const CONFIG = {
    DEFAULT_MOVE_DURATION: 350,
    CLICK_DELAY: 150,
    TYPING_INTERVAL: 40,
    SCROLL_AMOUNT: 300
  };

  let currentMouseX = 100;
  let currentMouseY = 100;
  let cursorHideTimeout = null;
  let isSessionActive = false;

  // Create Cursor Layer
  const cursorLayer = document.createElement("div");
  cursorLayer.id = "agent-pilot-cursor-layer";
  document.documentElement.appendChild(cursorLayer);

  // Virtual Pointer Element
  const virtualCursor = document.createElement("div");
  virtualCursor.className = "agent-pilot-virtual-cursor";
  virtualCursor.innerHTML = `
    <svg class="agent-pilot-cursor-svg" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 2 L26 14 L14 16 L10 28 Z" fill="#06b6d4" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="14" cy="14" r="3" fill="#ffffff" />
    </svg>
    <div class="agent-pilot-cursor-badge" id="agent-pilot-coords">(100, 100)</div>
  `;
  cursorLayer.appendChild(virtualCursor);
  updateCursorTransform(currentMouseX, currentMouseY);

  function activateCursor(timeoutMs = 2500) {
    if (document.hidden) return;
    if (cursorHideTimeout) {
      clearTimeout(cursorHideTimeout);
      cursorHideTimeout = null;
    }
    virtualCursor.classList.add("visible");
    if (!isSessionActive && timeoutMs > 0) {
      cursorHideTimeout = setTimeout(() => {
        virtualCursor.classList.remove("visible");
        cursorHideTimeout = null;
      }, timeoutMs);
    }
  }

  function hideCursor() {
    if (cursorHideTimeout) {
      clearTimeout(cursorHideTimeout);
      cursorHideTimeout = null;
    }
    if (!isSessionActive) {
      virtualCursor.classList.remove("visible");
    }
  }

  function setSessionActive(active) {
    isSessionActive = Boolean(active);
    if (isSessionActive) {
      if (cursorHideTimeout) {
        clearTimeout(cursorHideTimeout);
        cursorHideTimeout = null;
      }
      virtualCursor.classList.add("visible");
    } else {
      if (cursorHideTimeout) {
        clearTimeout(cursorHideTimeout);
        cursorHideTimeout = null;
      }
      virtualCursor.classList.remove("visible");
    }
  }

  function updateCursorTransform(x, y) {
    currentMouseX = x;
    currentMouseY = y;
    virtualCursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const coordsBadge = document.getElementById("agent-pilot-coords");
    if (coordsBadge) coordsBadge.textContent = `(${Math.round(x)}, ${Math.round(y)})`;
  }

  function setDispatching(val) {
    if (window.__AP_INTERNAL__.shield?.setIsDispatching) {
      window.__AP_INTERNAL__.shield.setIsDispatching(val);
    }
  }

  /**
   * Animate Virtual Mouse to (targetX, targetY) with smooth trajectory
   */
  function moveVirtualMouse(targetX, targetY, duration = CONFIG.DEFAULT_MOVE_DURATION) {
    activateCursor();
    // Chromium pauses requestAnimationFrame in background tabs (document.hidden = true).
    // In background mode, immediately update coordinates without waiting for rAF.
    if (document.hidden) {
      updateCursorTransform(targetX, targetY);
      return Promise.resolve({ success: true, x: targetX, y: targetY });
    }

    return new Promise((resolve) => {
      const startX = currentMouseX;
      const startY = currentMouseY;
      const startTime = performance.now();

      function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const ease = 1 - Math.pow(1 - progress, 3);
        const x = startX + (targetX - startX) * ease;
        const y = startY + (targetY - startY) * ease;
        updateCursorTransform(x, y);

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          updateCursorTransform(targetX, targetY);
          resolve({ success: true, x: targetX, y: targetY });
        }
      }

      requestAnimationFrame(step);
    });
  }

  function resolveElement(selector) {
    if (!selector) return null;
    if (selector instanceof Element) return selector;
    if (typeof selector === "string" && selector.startsWith("@")) {
      const idx = parseInt(selector.slice(1), 10);
      const snapList = window.__AP_INTERNAL__?.snapshotElements;
      if (snapList && snapList[idx] && document.contains(snapList[idx])) {
        return snapList[idx];
      }
      return null;
    }
    try {
      return document.querySelector(selector);
    } catch (err) {
      console.warn("[AgentPilot] querySelector error for selector:", selector, err);
      return null;
    }
  }

  function getElementCenter(selector) {
    if (!selector) return null;
    try {
      const el = resolveElement(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
      if (!inView && el.scrollIntoView) {
        el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
      }
      const rect = el.getBoundingClientRect();
      return {
        element: el,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    } catch (err) {
      console.warn("[AgentPilot] getElementCenter selector error:", err);
      return null;
    }
  }

  function isElementVisible(el) {
    if (!el || !document.contains(el)) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (err) {
      console.debug("[AgentPilot] isElementVisible check error:", err);
      return false;
    }
  }

  /**
   * Trigger click animation & dispatch synthetic events on DOM element
   */
  async function virtualClick(x, y, selector = null) {
    let el = null;
    if (selector) {
      el = resolveElement(selector);
      if (!el) {
        return { success: false, error: `Element not found for selector: ${selector}` };
      }
      const center = getElementCenter(selector);
      if (center) {
        x = center.x;
        y = center.y;
      }
    }

    if (x === undefined || x === null) x = currentMouseX;
    if (y === undefined || y === null) y = currentMouseY;

    activateCursor();
    await moveVirtualMouse(x, y, CONFIG.CLICK_DELAY);

    // Render Ripple Effect (skipped when tab is in background)
    if (!document.hidden) {
      const ripple = document.createElement("div");
      ripple.className = "agent-pilot-click-ripple";
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.style.width = "48px";
      ripple.style.height = "48px";
      cursorLayer.appendChild(ripple);
      setTimeout(() => ripple.remove(), 550);
    }

    // Find element under pointer if selector was not specified
    if (!el) {
      const prevCursorDisplay = cursorLayer.style.display;
      const lockOverlayEl = window.__AP_INTERNAL__.shield?.getLockOverlayEl?.();
      const prevOverlayDisplay = lockOverlayEl ? lockOverlayEl.style.display : null;
      cursorLayer.style.display = "none";
      if (lockOverlayEl) lockOverlayEl.style.display = "none";

      el = document.elementFromPoint(x, y);

      cursorLayer.style.display = prevCursorDisplay;
      if (lockOverlayEl && prevOverlayDisplay !== null) lockOverlayEl.style.display = prevOverlayDisplay;
    }

    if (el) {
      // Focus if form control
      if (el.focus && typeof el.focus === "function") {
        el.focus();
      }

      // Dispatch full mouse event lifecycle
      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x + window.screenX,
        screenY: y + window.screenY,
        button: 0
      };

      try {
        setDispatching(true);
        el.dispatchEvent(new PointerEvent("pointerdown", eventInit));
        el.dispatchEvent(new MouseEvent("mousedown", eventInit));
        el.dispatchEvent(new PointerEvent("pointerup", eventInit));
        el.dispatchEvent(new MouseEvent("mouseup", eventInit));
        el.dispatchEvent(new MouseEvent("click", eventInit));
      } finally {
        setDispatching(false);
      }

      return {
        success: true,
        element: {
          tagName: el.tagName,
          id: el.id,
          className: el.className,
          text: (el.innerText || el.value || "").slice(0, 50)
        }
      };
    }

    return { success: false, error: "No element at coordinates" };
  }

  /**
   * Virtual Type text into an element with human-like typing
   */
  async function virtualType(selector, text, clear = false, pressEnter = false) {
    activateCursor();
    let el = null;
    if (selector) {
      el = resolveElement(selector);
      if (el) {
        const r = el.getBoundingClientRect();
        const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
        if (!inView && el.scrollIntoView) {
          el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
        }
      }
    } else {
      const prevCursorDisplay = cursorLayer.style.display;
      const lockOverlayEl = window.__AP_INTERNAL__.shield?.getLockOverlayEl?.();
      const prevOverlayDisplay = lockOverlayEl ? lockOverlayEl.style.display : null;
      cursorLayer.style.display = "none";
      if (lockOverlayEl) lockOverlayEl.style.display = "none";

      el = document.elementFromPoint(currentMouseX, currentMouseY);

      cursorLayer.style.display = prevCursorDisplay;
      if (lockOverlayEl && prevOverlayDisplay !== null) lockOverlayEl.style.display = prevOverlayDisplay;
    }

    if (!el) return { success: false, error: "Target element not found" };

    const rect = el.getBoundingClientRect();
    await moveVirtualMouse(rect.left + rect.width / 2, rect.top + rect.height / 2, 250);
    await virtualClick(rect.left + rect.width / 2, rect.top + rect.height / 2);

    el.focus();
    const proto = (el instanceof HTMLTextAreaElement) ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

    if (clear) {
      if (el.isContentEditable) {
        el.textContent = "";
      } else if (el.value !== undefined) {
        if (typeof el.select === "function") {
          try {
            el.select();
          } catch (selectErr) {
            console.debug("[AgentPilot] el.select failed:", selectErr);
          }
        }
        try {
          document.execCommand("selectAll", false, null);
          document.execCommand("delete", false, null);
        } catch (execErr) {
          console.debug("[AgentPilot] execCommand selectAll/delete failed:", execErr);
        }
        if (nativeSetter) {
          nativeSetter.call(el, "");
        } else {
          el.value = "";
        }
      }
      try {
        setDispatching(true);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } finally {
        setDispatching(false);
      }
    }
    const cleanText = String(text ?? "").replace(/\r\n/g, "\n");
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) {
      for (const char of cleanText) {
        if (char === "\r") continue;
        try {
          setDispatching(true);
          if (el.isContentEditable) {
            document.execCommand("insertText", false, char);
          } else {
            let inserted = false;
            try {
              inserted = document.execCommand("insertText", false, char);
            } catch (insertErr) {
              console.debug("[AgentPilot] execCommand insertText fallback:", insertErr);
            }
            if (!inserted) {
              const nextVal = (el.value || "") + char;
              if (nativeSetter) {
                nativeSetter.call(el, nextVal);
              } else {
                el.value = nextVal;
              }
            }
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        } finally {
          setDispatching(false);
        }
        await new Promise((r) => setTimeout(r, CONFIG.TYPING_INTERVAL));
      }
      try {
        setDispatching(true);
        el.dispatchEvent(new Event("change", { bubbles: true }));
        if (pressEnter) {
          const keyCode = 13;
          const enterEvent = { key: "Enter", code: "Enter", keyCode, which: keyCode, bubbles: true, cancelable: true };
          el.dispatchEvent(new KeyboardEvent("keydown", enterEvent));
          el.dispatchEvent(new KeyboardEvent("keypress", enterEvent));
          el.dispatchEvent(new KeyboardEvent("keyup", enterEvent));
          if (el.form && typeof el.form.requestSubmit === "function") {
            try {
              el.form.requestSubmit();
            } catch (submitErr) {
              console.debug("[AgentPilot] form.requestSubmit failed:", submitErr);
            }
          }
        }
      } finally {
        setDispatching(false);
      }
      return { success: true, textEntered: cleanText };
    } else {
      return { success: false, error: "Element is not an input or editable field" };
    }
  }

  /**
   * Virtual Scroll
   */
  function virtualScroll(deltaX = 0, deltaY = CONFIG.SCROLL_AMOUNT) {
    try {
      setDispatching(true);
      window.scrollBy({
        top: deltaY,
        left: deltaX,
        behavior: document.hidden ? "auto" : "smooth"
      });
    } finally {
      setDispatching(false);
    }
    return { success: true, scrollX: window.scrollX, scrollY: window.scrollY };
  }

  /**
   * Dispatch keyboard event with support for modifiers (Control+A, Shift+Tab, etc.)
   */
  function dispatchKey(key = "Enter", code = null, keyCode = null, selector = null) {
    let target = selector ? resolveElement(selector) : null;
    if (!target) {
      target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    }
    try {
      setDispatching(true);
      let ctrlKey = false, shiftKey = false, altKey = false, metaKey = false;
      let actualKey = key;
      if (typeof key === "string" && key.includes("+")) {
        const parts = key.split("+");
        actualKey = parts.pop().trim();
        for (const part of parts) {
          const p = part.trim().toLowerCase();
          if (p === "control" || p === "ctrl") ctrlKey = true;
          else if (p === "shift") shiftKey = true;
          else if (p === "alt") altKey = true;
          else if (p === "meta" || p === "cmd" || p === "command") metaKey = true;
        }
      }

      const keyCodeMap = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Space: 32 };
      const finalCode = code || (actualKey.length === 1 ? `Key${actualKey.toUpperCase()}` : actualKey);
      const finalKeyCode = keyCode || keyCodeMap[actualKey] || (actualKey.length === 1 ? actualKey.toUpperCase().charCodeAt(0) : 0);
      const eventInit = {
        key: actualKey,
        code: finalCode,
        keyCode: finalKeyCode,
        which: finalKeyCode,
        ctrlKey,
        shiftKey,
        altKey,
        metaKey,
        bubbles: true,
        cancelable: true
      };
      target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      target.dispatchEvent(new KeyboardEvent("keypress", eventInit));
      target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
      if (actualKey === "Enter" && target.form && typeof target.form.requestSubmit === "function") {
        try {
          target.form.requestSubmit();
        } catch (keySubmitErr) {
          console.debug("[AgentPilot] target.form.requestSubmit failed:", keySubmitErr);
        }
      }
      return { success: true, key: actualKey, modifiers: { ctrlKey, shiftKey, altKey, metaKey } };
    } finally {
      setDispatching(false);
    }
  }

  /**
   * Fast batch fill for forms with React/Vue/Angular/HTML5 compatibility
   */
  async function virtualFillForm(fields = [], submitSelector = null, pressEnter = false) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return { success: false, error: "Fields array must not be empty" };
    }

    activateCursor();
    let filledCount = 0;
    let lastTargetEl = null;

    for (const field of fields) {
      const selector = field.selector || field.name || field.id;
      if (!selector) continue;
      const el = resolveElement(selector);
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
          // Input or Textarea
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
      await new Promise(r => setTimeout(r, 25));
    }

    let submitted = false;
    if (submitSelector) {
      const subRes = await virtualClick(undefined, undefined, submitSelector);
      submitted = subRes?.success || false;
    } else if (pressEnter && lastTargetEl) {
      dispatchKey("Enter", "Enter", 13, null);
      submitted = true;
    }

    return {
      success: filledCount > 0,
      filledCount,
      totalFields: fields.length,
      submitted
    };
  }

  /**
   * Virtual Hover on element
   */
  async function virtualHover(selector, options = {}) {
    const el = resolveElement(selector);
    if (!el) {
      return { success: false, error: "Element not found for selector: " + selector };
    }
    if (el.scrollIntoViewIfNeeded) {
      el.scrollIntoViewIfNeeded();
    } else if (el.scrollIntoView) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    const center = getElementCenter(selector);
    activateCursor();
    await moveVirtualMouse(center.x, center.y, CONFIG.DEFAULT_MOVE_DURATION);

    const shouldDispatch = options.dispatchSynthetic !== false;
    if (shouldDispatch) {
      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: center.x,
        clientY: center.y,
        screenX: center.x + window.screenX,
        screenY: center.y + window.screenY
      };

      try {
        setDispatching(true);
        if (typeof PointerEvent !== "undefined") {
          el.dispatchEvent(new PointerEvent("pointerenter", { ...eventInit, bubbles: false, pointerType: "mouse" }));
          el.dispatchEvent(new PointerEvent("pointerover", { ...eventInit, pointerType: "mouse" }));
          el.dispatchEvent(new PointerEvent("pointermove", { ...eventInit, pointerType: "mouse" }));
        }
        el.dispatchEvent(new MouseEvent("mouseenter", { ...eventInit, bubbles: false }));
        el.dispatchEvent(new MouseEvent("mouseover", eventInit));
        el.dispatchEvent(new MouseEvent("mousemove", eventInit));
      } finally {
        setDispatching(false);
      }
    }

    return { success: true, selector, coords: { x: center.x, y: center.y }, x: center.x, y: center.y };
  }

  /**
   * Virtual Drag & Drop from one element/ref to another
   */
  async function virtualDrag(fromSelector, toSelector, steps = 8) {
    const fromEl = resolveElement(fromSelector);
    if (!fromEl) return { success: false, error: "Source element not found: " + fromSelector };
    const toEl = resolveElement(toSelector);
    if (!toEl) return { success: false, error: "Target element not found: " + toSelector };

    const fromCenter = getElementCenter(fromSelector);
    const toCenter = getElementCenter(toSelector);

    activateCursor();
    await moveVirtualMouse(fromCenter.x, fromCenter.y, CONFIG.CLICK_DELAY);

    const baseInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: fromCenter.x,
      clientY: fromCenter.y,
      screenX: fromCenter.x + window.screenX,
      screenY: fromCenter.y + window.screenY,
      button: 0
    };

    let dataTransfer = null;
    if (typeof DataTransfer !== "undefined") {
      try {
        dataTransfer = new DataTransfer();
      } catch (dtErr) {
        console.debug("[AgentPilot] DataTransfer constructor fallback:", dtErr);
      }
    }

    try {
      setDispatching(true);
      if (typeof PointerEvent !== "undefined") {
        fromEl.dispatchEvent(new PointerEvent("pointerdown", { ...baseInit, buttons: 1, pointerType: "mouse", isPrimary: true }));
      }
      fromEl.dispatchEvent(new MouseEvent("mousedown", { ...baseInit, buttons: 1 }));
      if (fromEl.draggable) {
        fromEl.dispatchEvent(new DragEvent("dragstart", { ...baseInit, dataTransfer }));
      }

      const totalSteps = Math.max(3, steps);
      for (let i = 1; i <= totalSteps; i++) {
        const progress = i / totalSteps;
        const curX = Math.round(fromCenter.x + (toCenter.x - fromCenter.x) * progress);
        const curY = Math.round(fromCenter.y + (toCenter.y - fromCenter.y) * progress);

        currentMouseX = curX;
        currentMouseY = curY;
        updateCursorTransform(curX, curY);

        const moveInit = { ...baseInit, clientX: curX, clientY: curY, buttons: 1 };
        const targetEl = document.elementFromPoint(curX, curY) || fromEl || document.body;
        if (typeof PointerEvent !== "undefined") {
          targetEl.dispatchEvent(new PointerEvent("pointermove", { ...moveInit, pointerType: "mouse", isPrimary: true }));
        }
        targetEl.dispatchEvent(new MouseEvent("mousemove", moveInit));
        if (fromEl.draggable) {
          toEl.dispatchEvent(new DragEvent("dragover", { ...moveInit, dataTransfer }));
        }
        await new Promise((r) => setTimeout(r, 25));
      }

      const dropInit = { ...baseInit, clientX: toCenter.x, clientY: toCenter.y, buttons: 0 };
      if (fromEl.draggable) {
        toEl.dispatchEvent(new DragEvent("dragenter", { ...dropInit, dataTransfer }));
        toEl.dispatchEvent(new DragEvent("dragover", { ...dropInit, dataTransfer }));
        toEl.dispatchEvent(new DragEvent("drop", { ...dropInit, dataTransfer }));
        fromEl.dispatchEvent(new DragEvent("dragend", { ...dropInit, dataTransfer }));
      }
      if (typeof PointerEvent !== "undefined") {
        toEl.dispatchEvent(new PointerEvent("pointerup", { ...dropInit, pointerType: "mouse", isPrimary: true }));
      }
      toEl.dispatchEvent(new MouseEvent("mouseup", dropInit));
    } finally {
      setDispatching(false);
    }

    return { success: true, from: fromCenter, to: toCenter };
  }

  /**
   * Smart polling wait for selector, text, or condition
   */
  async function waitFor(options = {}) {
    let { selector, text, state = "visible", timeoutMs = 10000, pollIntervalMs = 100 } = options;
    const parsedTimeout = Number(timeoutMs);
    timeoutMs = (Number.isFinite(parsedTimeout) && parsedTimeout > 0) ? Math.min(parsedTimeout, 2147483647) : 10000;
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

    while (Date.now() - startTime < timeoutMs) {
      let conditionMet = true;

      if (selector) {
        const el = resolveElement(selector);
        const attached = !!(el && document.contains(el));
        if (state === "attached") {
          if (!attached) conditionMet = false;
        } else if (state === "hidden") {
          if (attached && isElementVisible(el)) conditionMet = false;
        } else { // "visible"
          if (!attached || !isElementVisible(el)) conditionMet = false;
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

  window.__AP_INTERNAL__.cursor = {
    moveVirtualMouse,
    virtualClick,
    virtualType,
    virtualScroll,
    virtualFillForm,
    virtualHover,
    virtualDrag,
    waitFor,
    dispatchKey,
    resolveElement,
    activateCursor,
    hideCursor,
    setSessionActive,
    isSessionActive: () => isSessionActive,
    updateCursorTransform,
    getCursorPosition: () => ({ x: currentMouseX, y: currentMouseY }),
    getCursorLayer: () => cursorLayer,
    getElementCenter
  };
})();
