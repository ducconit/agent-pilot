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
  let virtualTypeQueue = Promise.resolve();

  function createEl(tagName = "div", html = "") {
    if (window.__AP_INTERNAL__.createHtmlElement) {
      return window.__AP_INTERNAL__.createHtmlElement(tagName, html);
    }
    const el = document.createElement(tagName);
    if (html) el.innerHTML = html;
    return el;
  }

  // Create Cursor Layer in memory (mounted lazily only when virtual cursor is activated on HTML pages)
  const existingCursorLayer = document.getElementById("agent-pilot-cursor-layer");
  if (existingCursorLayer) existingCursorLayer.remove();
  const cursorLayer = createEl("div");
  cursorLayer.id = "agent-pilot-cursor-layer";
  cursorLayer.style.display = "none";

  // Virtual Pointer Element
  const virtualCursor = createEl("div", `
    <svg class="agent-pilot-cursor-svg" width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 2 L26 14 L14 16 L10 28 Z" fill="#06b6d4" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="14" cy="14" r="3" fill="#ffffff" />
    </svg>
    <div class="agent-pilot-cursor-badge" id="agent-pilot-coords">(100, 100)</div>
  `);
  virtualCursor.className = "agent-pilot-virtual-cursor";
  virtualCursor.style.display = "none";
  const coordsBadgeEl = virtualCursor.querySelector("#agent-pilot-coords");
  cursorLayer.appendChild(virtualCursor);
  updateCursorTransform(currentMouseX, currentMouseY);

  function canMountUi() {
    return !window.__AP_INTERNAL__.isHtmlDocument || window.__AP_INTERNAL__.isHtmlDocument();
  }

  function ensureCursorLayerMounted() {
    if (!canMountUi()) return false;
    if (!cursorLayer.isConnected) {
      const stale = document.getElementById("agent-pilot-cursor-layer");
      if (stale && stale !== cursorLayer) stale.remove();
      (document.body || document.documentElement).appendChild(cursorLayer);
    }
    return true;
  }

  function activateCursor(timeoutMs = CONFIG.CURSOR_ACTIVATE_MS) {
    if (document.hidden || !ensureCursorLayerMounted()) return;
    if (cursorHideTimeout) {
      clearTimeout(cursorHideTimeout);
      cursorHideTimeout = null;
    }
    cursorLayer.style.display = "block";
    virtualCursor.style.display = "block";
    virtualCursor.classList.add("visible");
    if (!isSessionActive && timeoutMs > 0) {
      cursorHideTimeout = setTimeout(() => {
        virtualCursor.classList.remove("visible");
        virtualCursor.style.display = "none";
        cursorLayer.style.display = "none";
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
      virtualCursor.style.display = "none";
      cursorLayer.style.display = "none";
    }
  }

  function setSessionActive(active) {
    isSessionActive = Boolean(active);
    if (isSessionActive) {
      if (cursorHideTimeout) {
        clearTimeout(cursorHideTimeout);
        cursorHideTimeout = null;
      }
      if (ensureCursorLayerMounted()) {
        cursorLayer.style.display = "block";
        virtualCursor.style.display = "block";
        virtualCursor.classList.add("visible");
      }
    } else {
      if (cursorHideTimeout) {
        clearTimeout(cursorHideTimeout);
        cursorHideTimeout = null;
      }
      virtualCursor.classList.remove("visible");
      virtualCursor.style.display = "none";
      cursorLayer.style.display = "none";
    }
  }

  function updateCursorTransform(x, y) {
    currentMouseX = x;
    currentMouseY = y;
    virtualCursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const coordsBadge = coordsBadgeEl || document.getElementById("agent-pilot-coords");
    if (coordsBadge) coordsBadge.textContent = `(${Math.round(x)}, ${Math.round(y)})`;
  }

  function calculateMoveDuration(startX, startY, targetX, targetY) {
    if (!Number.isFinite(startX) || !Number.isFinite(startY) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) {
      return CONFIG.DEFAULT_MOVE_DURATION;
    }
    const dist = Math.hypot(targetX - startX, targetY - startY);
    if (dist < 5) return 60;
    return Math.min(380, Math.max(180, Math.round(150 + dist * 0.2)));
  }

  function renderClickRipple(x, y) {
    if (document.hidden || !ensureCursorLayerMounted()) return;
    cursorLayer.style.display = "block";
    const ripple = createEl("div");
    ripple.className = "agent-pilot-click-ripple";
    ripple.style.left = `${Math.round(x)}px`;
    ripple.style.top = `${Math.round(y)}px`;
    ripple.style.width = "48px";
    ripple.style.height = "48px";
    cursorLayer.appendChild(ripple);
    setTimeout(() => {
      if (ripple.parentNode) ripple.remove();
    }, CONFIG.CLICK_RIPPLE_MS);
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
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        if (safetyTimer) clearTimeout(safetyTimer);
        updateCursorTransform(targetX, targetY);
        resolve({ success: true, x: targetX, y: targetY });
      };

      // Safety fallback: Chromium throttles or pauses requestAnimationFrame when the
      // window is minimized, occluded, backgrounded, or on display servers without focus.
      // Ensure we ALWAYS resolve even if requestAnimationFrame never fires.
      const safetyTimer = setTimeout(done, Math.max(duration + 100, 300));

      const startX = currentMouseX;
      const startY = currentMouseY;
      const startTime = performance.now();

      function step(currentTime) {
        if (settled) return;
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
          done();
        }
      }

      requestAnimationFrame(step);
    });
  }

  function resolveElement(selector, fallbackHints = null) {
    if (selector instanceof Element) return selector;
    if (typeof selector === "string" && selector.startsWith("@")) {
      const idx = parseInt(selector.slice(1), 10);
      const snapList = window.__AP_INTERNAL__?.snapshotElements;
      if (snapList && snapList[idx] && document.contains(snapList[idx])) {
        return snapList[idx];
      }
      return null;
    }

    let hiddenFallback = null;
    if (selector && typeof selector === "string") {
      try {
        const allMatches = Array.from(document.querySelectorAll(selector));
        if (allMatches.length > 0) {
          const visibleMatch = allMatches.find(isElementVisible);
          if (visibleMatch) return visibleMatch;
          hiddenFallback = allMatches[0];
        }
      } catch (err) {
        console.warn("[AgentPilot] querySelector error for selector:", selector, err);
      }

      // Generalize dynamic SSR/hydration IDs (e.g. #reka-tabs-v-0-1-7-0-1-2-0-0-trigger-yarn -> [id^="reka-tabs-"][id$="-trigger-yarn"])
      const generalized = selector.replace(
        /#([a-zA-Z0-9_-]+?)-(?:v-\d+(?:-\d+)*|r[0-9a-z]+)-([a-zA-Z0-9_-]+)/g,
        '[id^="$1-"][id$="-$2"]'
      );
      if (generalized !== selector) {
        try {
          const genMatches = Array.from(document.querySelectorAll(generalized));
          if (genMatches.length > 0) {
            const visibleGen = genMatches.find(isElementVisible);
            if (visibleGen) return visibleGen;
            if (!hiddenFallback) hiddenFallback = genMatches[0];
          }
        } catch (_) {}
      }
    }

    // Fallback resolution when a dynamic/obfuscated selector (e.g. #ti6dpd, button.plR5qb) changed across page loads
    if (fallbackHints && typeof fallbackHints === "object") {
      const wantLabel = String(fallbackHints.label || "").trim().toLowerCase();
      const wantTag = String(fallbackHints.tagName || "").trim().toLowerCase();
      const wantAction = String(fallbackHints.action || "").trim().toLowerCase();

      if (wantLabel) {
        const candidateQuery = wantTag && /^[a-z0-9-]+$/.test(wantTag)
          ? `${wantTag}, button, a, input, textarea, select, [role='button'], [role='tab'], [role='link']`
          : "button, a, input, textarea, select, [role='button'], [role='tab'], [role='link']";
        const candidates = Array.from(document.querySelectorAll(candidateQuery)).filter(isElementVisible);

        const getCandTexts = (c) => [
          c.getAttribute("aria-label"),
          c.getAttribute("placeholder"),
          c.getAttribute("name"),
          c.getAttribute("title"),
          (c.innerText || c.textContent || "").trim()
        ]
          .filter(Boolean)
          .map((s) => String(s).replace(/\s+/g, " ").trim().toLowerCase());

        const exact = candidates.find((c) => getCandTexts(c).some((t) => t === wantLabel));
        if (exact) return exact;
        const partial = candidates.find((c) => getCandTexts(c).some((t) => t.includes(wantLabel) || wantLabel.includes(t)));
        if (partial) return partial;
      }

      if (wantAction === "type" || wantAction === "press_key" || wantTag === "textarea" || wantTag === "input") {
        const editables = Array.from(
          document.querySelectorAll(
            "textarea, input[type='search'], input[type='text'], input:not([type]), [contenteditable='true']"
          )
        ).filter(isElementVisible);
        if (wantTag === "textarea") {
          const ta = editables.find((e) => e.tagName === "TEXTAREA");
          if (ta) return ta;
        }
        if (editables.length > 0) return editables[0];
      }
    }

    return hiddenFallback;
  }

  function getElementCenter(selector, fallbackHints = null) {
    if (!selector && !fallbackHints) return null;
    try {
      const el = resolveElement(selector, fallbackHints);
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
   * Visually move the cursor to (x, y) or selector, render click ripple,
   * without dispatching DOM click events (used by CDP or visual sync).
   */
  async function animateCursorClick(x, y, selector = null) {
    if (selector) {
      const center = getElementCenter(selector);
      if (center) {
        x = center.x;
        y = center.y;
      } else {
        return { success: false, error: "Could not calculate element center for selector: " + selector };
      }
    }

    if (x === undefined || x === null) x = currentMouseX;
    if (y === undefined || y === null) y = currentMouseY;

    activateCursor();
    const duration = calculateMoveDuration(currentMouseX, currentMouseY, x, y);
    await moveVirtualMouse(x, y, duration);
    renderClickRipple(x, y);

    // Brief tactile pause (60ms) to allow ripple animation to start visibly before next action
    if (!document.hidden) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    return { success: true, x, y };
  }

  /**
   * Trigger click animation & dispatch synthetic events on DOM element
   */
  async function virtualClick(x, y, selector = null, fallbackHints = null, clickCount = 1) {
    let el = null;
    if (selector || fallbackHints) {
      el = resolveElement(selector, { ...fallbackHints, action: "click" });
      if (!el) {
        return { success: false, error: `Element not found for selector: ${selector}` };
      }
      const center = getElementCenter(el);
      if (center) {
        x = center.x;
        y = center.y;
      }
    }

    if (x === undefined || x === null) x = currentMouseX;
    if (y === undefined || y === null) y = currentMouseY;

    activateCursor();
    const duration = calculateMoveDuration(currentMouseX, currentMouseY, x, y);
    await moveVirtualMouse(x, y, duration);

    // Render Ripple Effect (skipped when tab is in background)
    renderClickRipple(x, y);

    // Brief tactile pause for visual feedback before event dispatch
    if (!document.hidden) {
      await new Promise((resolve) => setTimeout(resolve, 60));
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
        button: 0,
        buttons: 1
      };

      try {
        setDispatching(true);
        const clickCycles = Number(clickCount) === 2 ? 2 : 1;
        if (clickCycles === 1) {
          el.dispatchEvent(new PointerEvent("pointerdown", eventInit));
          el.dispatchEvent(new MouseEvent("mousedown", eventInit));
          el.dispatchEvent(new PointerEvent("pointerup", { ...eventInit, buttons: 0 }));
          el.dispatchEvent(new MouseEvent("mouseup", { ...eventInit, buttons: 0 }));
          // Preserve the established click() activation path for all existing callers.
          if (typeof el.click === "function") {
            el.click();
          } else {
            el.dispatchEvent(new MouseEvent("click", { ...eventInit, buttons: 0 }));
          }
        } else {
          for (let index = 0; index < clickCycles; index++) {
            const detail = index + 1;
            const cycleEventInit = { ...eventInit, detail };
            el.dispatchEvent(new PointerEvent("pointerdown", cycleEventInit));
            el.dispatchEvent(new MouseEvent("mousedown", cycleEventInit));
            el.dispatchEvent(new PointerEvent("pointerup", { ...cycleEventInit, buttons: 0 }));
            el.dispatchEvent(new MouseEvent("mouseup", { ...cycleEventInit, buttons: 0 }));
            el.dispatchEvent(new MouseEvent("click", { ...cycleEventInit, buttons: 0 }));
          }
          el.dispatchEvent(new MouseEvent("dblclick", { ...eventInit, detail: 2, buttons: 0 }));
        }
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
  function virtualType(selector, text, clear = false, pressEnter = false, fallbackHints = null) {
    // Main-world calls and extension commands can reach this content script at
    // the same time. Concurrent character loops on one input interleave writes
    // and produce corrupted text, so serialize typing operations per document.
    const operation = virtualTypeQueue.then(() => performVirtualType(selector, text, clear, pressEnter, fallbackHints));
    virtualTypeQueue = operation.catch(() => {});
    return operation;
  }

  async function performVirtualType(selector, text, clear = false, pressEnter = false, fallbackHints = null) {
    activateCursor();
    let el = null;
    if (selector || fallbackHints) {
      el = resolveElement(selector, { ...fallbackHints, action: pressEnter && !text ? "press_key" : "type" });
      if (el) {
        const r = el.getBoundingClientRect();
        const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
        if (!inView && el.scrollIntoView) {
          el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
        }
      }
    } else {
      // 1. Prioritize active element if it's an editable form control or contentEditable
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) {
        if (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable) {
          el = active;
        } else {
          const nestedInput = active.querySelector ? active.querySelector("input, textarea, [contenteditable='true']") : null;
          if (nestedInput) el = nestedInput;
        }
      }

      // 2. Fall back to element under current virtual cursor
      if (!el) {
        const prevCursorDisplay = cursorLayer.style.display;
        const lockOverlayEl = window.__AP_INTERNAL__.shield?.getLockOverlayEl?.();
        const prevOverlayDisplay = lockOverlayEl ? lockOverlayEl.style.display : null;
        cursorLayer.style.display = "none";
        if (lockOverlayEl) lockOverlayEl.style.display = "none";

        const pointEl = document.elementFromPoint(currentMouseX, currentMouseY);

        cursorLayer.style.display = prevCursorDisplay;
        if (lockOverlayEl && prevOverlayDisplay !== null) lockOverlayEl.style.display = prevOverlayDisplay;

        if (pointEl) {
          if (pointEl.tagName === "INPUT" || pointEl.tagName === "TEXTAREA" || pointEl.isContentEditable) {
            el = pointEl;
          } else {
            const nested = pointEl.querySelector ? pointEl.querySelector("input, textarea, [contenteditable='true']") : null;
            el = nested || pointEl;
          }
        }
      }
    }

    if (!el) return { success: false, error: "Target element not found" };

    const rect = el.getBoundingClientRect();
    if (el !== document.activeElement) {
      if (rect.width > 0 && rect.height > 0) {
        await moveVirtualMouse(rect.left + rect.width / 2, rect.top + rect.height / 2, CONFIG.FIELD_FOCUS_MOVE_MS);
        await virtualClick(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
    } else if (rect.width > 0 && rect.height > 0) {
      await moveVirtualMouse(rect.left + rect.width / 2, rect.top + rect.height / 2, CONFIG.FIELD_FOCUS_MOVE_MS);
    }

    if (typeof el.focus === "function") {
      el.focus();
    }
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
      const isHidden = Boolean(document.hidden);
      const typeInterval = isHidden ? 0 : (CONFIG.TYPING_INTERVAL || 25);
      const typingStartTime = Date.now();
      let useFastTyping = isHidden || cleanText.length > 50;

      for (let i = 0; i < cleanText.length; i++) {
        const char = cleanText[i];
        if (char === "\r") continue;

        // Background timer throttling guard: if typing loop takes >3500ms,
        // fast-forward remaining characters so we never hit the RPC bridge timeout.
        if (!useFastTyping && Date.now() - typingStartTime > 3500) {
          useFastTyping = true;
        }

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

        if (!useFastTyping && typeInterval > 0) {
          await new Promise((r) => setTimeout(r, typeInterval));
        }
      }
      try {
        setDispatching(true);
        el.dispatchEvent(new Event("change", { bubbles: true }));
        if (pressEnter) {
          const valBeforeEnter = el.isContentEditable ? (el.innerText || "") : (el.value || "");
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
          } else {
            // For SPA chat boxes (e.g. Google AI Mode textarea[aria-label="Ask anything"]) that ignore untrusted Enter keydown:
            // look for an adjacent enabled submit/send button in the surrounding container
            const valAfterEnter = el.isContentEditable ? (el.innerText || "") : (el.value || "");
            if (valBeforeEnter && valAfterEnter === valBeforeEnter) {
              let container = el.parentElement;
              for (let depth = 0; depth < 5 && container && container !== document.body; depth++) {
                const submitBtn = Array.from(
                  container.querySelectorAll(
                    "button[type='submit'], button[aria-label*='Send' i], button[aria-label*='Submit' i], button[aria-label*='Gửi' i], button[aria-label*='Ask' i], button[aria-label*='Search' i], button[aria-label*='Tìm' i], [role='button'][aria-label*='Send' i], [role='button'][aria-label*='Gửi' i]"
                  )
                ).find((b) => isElementVisible(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true");
                if (submitBtn) {
                  submitBtn.click();
                  break;
                }
                container = container.parentElement;
              }
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
        behavior: "auto"
      });
      window.__AP_INTERNAL__.inspector?.recordViewportScroll?.();
    } finally {
      setDispatching(false);
    }
    return { success: true, scrollX: window.scrollX, scrollY: window.scrollY };
  }

  function splitSyntheticKeyTokens(raw) {
    if (typeof raw !== "string") return [];
    const trimmed = raw.trim();
    if (!trimmed) return raw === " " ? [" "] : [];
    if (trimmed === "," || /[+]\s*,$/.test(trimmed)) {
      return [trimmed];
    }
    if (trimmed.includes(",")) {
      return trimmed.split(",").map((p) => p.trim()).filter(Boolean);
    }
    return [trimmed];
  }

  function dispatchSingleKey(target, key = "Enter", code = null, keyCode = null) {
    let ctrlKey = false, shiftKey = false, altKey = false, metaKey = false;
    let raw = String(key || "Enter");
    let trailingPlus = false;
    if (raw === "+") {
      trailingPlus = true;
      raw = "";
    } else if (raw.endsWith("++")) {
      trailingPlus = true;
      raw = raw.slice(0, -2);
    }
    const parts = raw ? raw.split("+").map((p) => p.trim()).filter(Boolean) : [];
    if (trailingPlus) parts.push("+");

    let actualKey = parts.length > 0 ? parts.pop() : "Enter";
    for (const part of parts) {
      const p = part.toLowerCase();
      if (p === "control" || p === "ctrl") ctrlKey = true;
      else if (p === "shift") shiftKey = true;
      else if (p === "alt" || p === "option") altKey = true;
      else if (p === "meta" || p === "cmd" || p === "command" || p === "win") metaKey = true;
    }

    const lowerActual = actualKey.toLowerCase();
    if (lowerActual === "space") actualKey = " ";
    else if (lowerActual === "esc") actualKey = "Escape";
    else if (lowerActual === "del") actualKey = "Delete";
    else if (lowerActual === "return") actualKey = "Enter";
    else if (lowerActual === "up") actualKey = "ArrowUp";
    else if (lowerActual === "down") actualKey = "ArrowDown";
    else if (lowerActual === "left") actualKey = "ArrowLeft";
    else if (lowerActual === "right") actualKey = "ArrowRight";
    else if (lowerActual === "plus") { actualKey = "+"; shiftKey = true; }
    else if (lowerActual === "minus") actualKey = "-";
    else if (lowerActual === "equal") actualKey = "=";
    else if (lowerActual === "comma") actualKey = ",";
    else if (lowerActual === "period") actualKey = ".";
    else if (lowerActual === "slash") actualKey = "/";

    const keyCodeMap = {
      Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, Insert: 45,
      ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39,
      Home: 36, End: 35, PageUp: 33, PageDown: 34, " ": 32,
      F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
      F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
      "-": 189, "_": 189, "=": 187, "+": 187, "[": 219, "{": 219,
      "]": 221, "}": 221, "\\": 220, "|": 220, ";": 186, ":": 186,
      "'": 222, "\"": 222, ",": 188, "<": 188, ".": 190, ">": 190,
      "/": 191, "?": 191, "`": 192, "~": 192
    };
    const isAlpha = actualKey.length === 1 && /[a-zA-Z]/.test(actualKey);
    const isDigit = actualKey.length === 1 && /[0-9]/.test(actualKey);
    const finalCode = code || (actualKey === " " ? "Space" : isAlpha ? `Key${actualKey.toUpperCase()}` : isDigit ? `Digit${actualKey}` : actualKey);
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
    const kdEvent = new KeyboardEvent("keydown", eventInit);
    const notCancelled = target.dispatchEvent(kdEvent);
    target.dispatchEvent(new KeyboardEvent("keypress", eventInit));

    // Apply synthetic editing behavior when untrusted KeyboardEvent is not cancelled
    if (notCancelled) {
      const isTextControl = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      const isEditable = isTextControl || target.isContentEditable;
      if ((ctrlKey || metaKey) && !altKey) {
        const lk = actualKey.toLowerCase();
        if (lk === "a" && !shiftKey) {
          if (isTextControl && typeof target.select === "function") {
            try { target.select(); } catch (_) {}
          }
          try { document.execCommand("selectAll", false, null); } catch (_) {}
        } else if (lk === "c" && !shiftKey) {
          try { document.execCommand("copy", false, null); } catch (_) {}
        } else if (lk === "x" && !shiftKey) {
          try { document.execCommand("cut", false, null); } catch (_) {}
        } else if (lk === "v" && !shiftKey) {
          try { document.execCommand("paste", false, null); } catch (_) {}
        } else if (lk === "z") {
          try { document.execCommand(shiftKey ? "redo" : "undo", false, null); } catch (_) {}
        } else if (lk === "y" && !shiftKey) {
          try { document.execCommand("redo", false, null); } catch (_) {}
        }
      } else if (!ctrlKey && !metaKey && !altKey && isEditable) {
        const proto = (target instanceof HTMLTextAreaElement) ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const nativeSetter = isTextControl ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
        const setInputVal = (nextVal, nextCursor) => {
          if (nativeSetter) nativeSetter.call(target, nextVal);
          else target.value = nextVal;
          if (typeof target.setSelectionRange === "function" && typeof nextCursor === "number") {
            try { target.setSelectionRange(nextCursor, nextCursor); } catch (_) {}
          }
          target.dispatchEvent(new Event("input", { bubbles: true }));
        };
        if (actualKey.length === 1) {
          if (isTextControl) {
            const val = String(target.value || "");
            const start = typeof target.selectionStart === "number" ? target.selectionStart : val.length;
            const end = typeof target.selectionEnd === "number" ? target.selectionEnd : val.length;
            const nextVal = val.slice(0, start) + actualKey + val.slice(end);
            setInputVal(nextVal, start + 1);
          } else if (target.isContentEditable) {
            try { document.execCommand("insertText", false, actualKey); } catch (_) {}
          }
        } else if (actualKey === "Backspace" || actualKey === "Delete") {
          if (isTextControl) {
            const val = String(target.value || "");
            const start = typeof target.selectionStart === "number" ? target.selectionStart : val.length;
            const end = typeof target.selectionEnd === "number" ? target.selectionEnd : val.length;
            if (start !== end) {
              setInputVal(val.slice(0, start) + val.slice(end), start);
            } else if (actualKey === "Backspace" && start > 0) {
              setInputVal(val.slice(0, start - 1) + val.slice(end), start - 1);
            } else if (actualKey === "Delete" && start < val.length) {
              setInputVal(val.slice(0, start) + val.slice(start + 1), start);
            }
          } else if (target.isContentEditable) {
            try { document.execCommand(actualKey === "Backspace" ? "delete" : "forwardDelete", false, null); } catch (_) {}
          }
        }
      }
    }

    target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    if (actualKey === "Enter" && target.form && typeof target.form.requestSubmit === "function") {
      try {
        target.form.requestSubmit();
      } catch (keySubmitErr) {
        console.debug("[AgentPilot] target.form.requestSubmit failed:", keySubmitErr);
      }
    }
    return { success: true, key: actualKey, modifiers: { ctrlKey, shiftKey, altKey, metaKey } };
  }

  /**
   * Dispatch keyboard event or sequence of keys with support for modifiers (Control+A, Shift+Tab, etc.)
   */
  async function dispatchKey(key = "Enter", code = null, keyCode = null, selector = null, options = {}) {
    let target = selector ? resolveElement(selector) : null;
    if (!target) {
      target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    }
    if (target && typeof target.focus === "function" && target !== document.body) {
      try { target.focus(); } catch (_) {}
    }

    const rawList = Array.isArray(options?.keys) && options.keys.length > 0 ? options.keys : [key];
    const baseKeys = [];
    for (const item of rawList) {
      if (typeof item === "string") {
        baseKeys.push(...splitSyntheticKeyTokens(item));
      }
    }
    if (baseKeys.length === 0) baseKeys.push("Enter");
    const parsedRepeat = Number(options?.repeat);
    const repeatCount = Number.isFinite(parsedRepeat) && parsedRepeat > 1 ? Math.min(100, Math.floor(parsedRepeat)) : 1;
    const keys = [];
    for (let r = 0; r < repeatCount; r++) {
      keys.push(...baseKeys);
    }
    const rawDelay = Number(options?.delayMs ?? options?.delay ?? 0);
    const delayMs = Number.isFinite(rawDelay) && rawDelay > 0 ? Math.min(5000, Math.floor(rawDelay)) : 0;

    try {
      setDispatching(true);
      let lastRes = null;
      for (let i = 0; i < keys.length; i++) {
        lastRes = dispatchSingleKey(target, keys[i], keys.length === 1 ? code : null, keys.length === 1 ? keyCode : null);
        if (delayMs > 0 && i < keys.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      if (keys.length > 1) {
        return {
          success: true,
          key: keys.join(", "),
          keys,
          count: keys.length,
          modifiers: lastRes ? lastRes.modifiers : { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }
        };
      }
      return lastRes;
    } finally {
      setDispatching(false);
    }
  }

  /**
   * Dispatch one Recorder keyboard event. Unlike dispatchKey, this does not
   * synthesize the rest of the key lifecycle or submit forms.
   */
  function dispatchKeyEvent(key = "Enter", code = null, keyCode = null, selector = null, eventType = "keyDown", modifiers = null) {
    const normalizedType = eventType === "keyDown" ? "keydown" : eventType === "keyUp" ? "keyup" : null;
    if (!normalizedType) {
      return { success: false, error: `Unsupported keyboard eventType: ${eventType}` };
    }

    let target = selector ? resolveElement(selector) : null;
    if (selector && !target) {
      return { success: false, error: `Element not found for selector: ${selector}` };
    }
    if (!target) {
      target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    }

    let ctrlKey = false, shiftKey = false, altKey = false, metaKey = false;
    let actualKey = key;
    if (typeof key === "string" && key.includes("+")) {
      const parts = key.split("+");
      actualKey = parts.pop().trim();
      for (const part of parts) {
        const modifier = part.trim().toLowerCase();
        if (modifier === "control" || modifier === "ctrl") ctrlKey = true;
        else if (modifier === "shift") shiftKey = true;
        else if (modifier === "alt") altKey = true;
        else if (modifier === "meta" || modifier === "cmd" || modifier === "command") metaKey = true;
      }
    }

    if (typeof modifiers === "number") {
      ctrlKey = ctrlKey || Boolean(modifiers & 2);
      altKey = altKey || Boolean(modifiers & 1);
      metaKey = metaKey || Boolean(modifiers & 4);
      shiftKey = shiftKey || Boolean(modifiers & 8);
    } else if (modifiers && typeof modifiers === "object") {
      ctrlKey = ctrlKey || Boolean(modifiers.ctrlKey || modifiers.control);
      shiftKey = shiftKey || Boolean(modifiers.shiftKey || modifiers.shift);
      altKey = altKey || Boolean(modifiers.altKey || modifiers.alt);
      metaKey = metaKey || Boolean(modifiers.metaKey || modifiers.meta);
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

    try {
      setDispatching(true);
      const event = new KeyboardEvent(normalizedType, eventInit);
      target.dispatchEvent(event);
      return { success: true, eventType, key: actualKey, modifiers: { ctrlKey, shiftKey, altKey, metaKey } };
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
    if (!center) {
      return { success: false, error: "Could not calculate element center for selector: " + selector };
    }
    activateCursor();
    const hoverDuration = options.duration || calculateMoveDuration(currentMouseX, currentMouseY, center.x, center.y);
    await moveVirtualMouse(center.x, center.y, hoverDuration);

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
    animateCursorClick,
    calculateMoveDuration,
    renderClickRipple,
    virtualType,
    virtualScroll,
    virtualFillForm,
    virtualHover,
    virtualDrag,
    waitFor,
    dispatchKey,
    dispatchKeyEvent,
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
