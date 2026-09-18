/**
 * Agent Pilot - Content Script Virtual Mouse & Cursor Simulator Module
 * Simulates human-like mouse movements, clicks, typing and scrolling
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.cursor) return;
  window.__AP_INTERNAL__.__guards.cursor = true;

  // Shared config with local fallbacks (see content/config.js).
  const T = (window.__AP_CONFIG__ && window.__AP_CONFIG__.timeouts) || {};

  const CONFIG = {
    DEFAULT_MOVE_DURATION: T.defaultMoveMs || 350,
    CLICK_DELAY: T.clickDelayMs || 150,
    TYPING_INTERVAL: T.typingIntervalMs || 40,
    SCROLL_AMOUNT: T.scrollAmountPx || 300,
    CURSOR_ACTIVATE_MS: T.cursorActivateMs || 2500,
    FIELD_FOCUS_MOVE_MS: T.fieldFocusMoveMs || 250,
    CLICK_RIPPLE_MS: T.clickRippleMs || 550,
    DRAG_STEP_DELAY_MS: T.dragStepDelayMs || 25
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

  function activateCursor(timeoutMs = CONFIG.CURSOR_ACTIVATE_MS) {
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
   * Animate Virtual Mouse to (targetX, targetY) with a smooth trajectory.
   *
   * Animation path: this drives a requestAnimationFrame loop that interpolates the
   * cursor position with an ease-out-cubic curve (fast start, soft landing) so the
   * synthetic motion looks human rather than teleporting.
   */
  function moveVirtualMouse(targetX, targetY, duration = CONFIG.DEFAULT_MOVE_DURATION) {
    activateCursor();
    // Background-tab workaround: Chromium suspends requestAnimationFrame for hidden
    // tabs (document.hidden === true), so the rAF loop below would never tick and the
    // returned promise would hang forever. When hidden, snap straight to the target
    // and resolve immediately instead of waiting on a frame that will not arrive.
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
      setTimeout(() => ripple.remove(), CONFIG.CLICK_RIPPLE_MS);
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
    await moveVirtualMouse(rect.left + rect.width / 2, rect.top + rect.height / 2, CONFIG.FIELD_FOCUS_MOVE_MS);
    await virtualClick(rect.left + rect.width / 2, rect.top + rect.height / 2);

    el.focus();
    // React/Vue native-setter fallback: frameworks patch the `value` property on the
    // DOM element instance and track state through their own listener. Assigning
    // `el.value = ...` directly can be swallowed; calling the ORIGINAL descriptor setter
    // from the prototype (HTMLInputElement/HTMLTextAreaElement) bypasses the patch and
    // reliably notifies the framework's value tracker.
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
   * Thin delegating wrapper — the implementation moved to content/cursor-form.js
   * (injected right after this file). Kept on the public cursor API so every existing
   * caller (content.js routing, form-fill bridge actions, ...) keeps working unchanged.
   */
  function virtualFillForm(fields, submitSelector, pressEnter) {
    const impl = window.__AP_INTERNAL__.cursorForm && window.__AP_INTERNAL__.cursorForm.virtualFillForm;
    if (impl) return impl(fields, submitSelector, pressEnter);
    return Promise.resolve({ success: false, error: "cursorForm module unavailable" });
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
        await new Promise((r) => setTimeout(r, CONFIG.DRAG_STEP_DELAY_MS));
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
   * Thin delegating wrapper — the implementation moved to content/cursor-wait.js
   * (injected right after this file). Kept on the public cursor API so every existing
   * caller (content.js routing, wait_for bridge actions, ...) keeps working unchanged.
   */
  function waitFor(options) {
    const impl = window.__AP_INTERNAL__.cursorWait && window.__AP_INTERNAL__.cursorWait.waitFor;
    if (impl) return impl(options);
    return Promise.resolve({ success: false, error: "cursorWait module unavailable" });
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
    getElementCenter,
    // Exposed for cursor-wait.js (waitFor polls element visibility).
    isElementVisible
  };
})();
