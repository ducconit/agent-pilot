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
    cursorHideTimeout = setTimeout(() => {
      virtualCursor.classList.remove("visible");
      cursorHideTimeout = null;
    }, timeoutMs);
  }

  function hideCursor() {
    if (cursorHideTimeout) {
      clearTimeout(cursorHideTimeout);
      cursorHideTimeout = null;
    }
    virtualCursor.classList.remove("visible");
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

  function getElementCenter(selector) {
    if (!selector) return null;
    try {
      const el = document.querySelector(selector);
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

  /**
   * Trigger click animation & dispatch synthetic events on DOM element
   */
  async function virtualClick(x = currentMouseX, y = currentMouseY, selector = null) {
    let el = null;
    if (selector) {
      try {
        el = document.querySelector(selector);
      } catch (err) {
        console.warn("[AgentPilot] virtualClick querySelector error:", err);
        return { success: false, error: `Invalid selector: ${err.message}` };
      }
      if (!el) {
        return { success: false, error: `Element not found for selector: ${selector}` };
      }
      if ((!x && !y) || (x === currentMouseX && y === currentMouseY)) {
        const center = getElementCenter(selector);
        if (center) {
          x = center.x;
          y = center.y;
        }
      }
    }
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
      el = document.querySelector(selector);
      if (el) {
        const r = el.getBoundingClientRect();
        const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
        if (!inView) {
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
    if (clear) {
      if (el.isContentEditable) {
        el.textContent = "";
      } else if (el.value !== undefined) {
        el.value = "";
      }
      try {
        setDispatching(true);
        el.dispatchEvent(new Event("input", { bubbles: true }));
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
            el.value = (el.value || "") + char;
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
            try { el.form.requestSubmit(); } catch (_) {}
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
   * Dispatch keyboard event
   */
  function dispatchKey(key = "Enter", code = null, keyCode = null, selector = null) {
    let target = selector ? document.querySelector(selector) : null;
    if (!target) {
      target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    }
    try {
      setDispatching(true);
      const keyCodeMap = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
      const finalCode = code || key;
      const finalKeyCode = keyCode || keyCodeMap[key] || 0;
      const eventInit = { key, code: finalCode, keyCode: finalKeyCode, which: finalKeyCode, bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      target.dispatchEvent(new KeyboardEvent("keypress", eventInit));
      target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
      if (key === "Enter" && target.form && typeof target.form.requestSubmit === "function") {
        try { target.form.requestSubmit(); } catch (_) {}
      }
      return { success: true, key };
    } finally {
      setDispatching(false);
    }
  }

  window.__AP_INTERNAL__.cursor = {
    moveVirtualMouse,
    virtualClick,
    virtualType,
    virtualScroll,
    dispatchKey,
    activateCursor,
    hideCursor,
    updateCursorTransform,
    getCursorPosition: () => ({ x: currentMouseX, y: currentMouseY }),
    getCursorLayer: () => cursorLayer,
    getElementCenter
  };
})();
