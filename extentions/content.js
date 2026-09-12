/**
 * Agent Pilot - Injected Content Script
 * Virtual Mouse, Element Inspector, Region Crop Tool, Eyedropper & Agent Bridge
 */

(function () {
  // Prevent multiple injections
  if (window.__AGENT_PILOT_INITIALIZED__) return;
  window.__AGENT_PILOT_INITIALIZED__ = true;

  const CONFIG = {
    DEFAULT_MOVE_DURATION: 350,
    CLICK_DELAY: 150,
    TYPING_INTERVAL: 40,
    SCROLL_AMOUNT: 300,
    TOAST_DURATION: 3200
  };

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  let currentMouseX = 100;
  let currentMouseY = 100;
  let isInspectorActive = false;
  let lockedElement = null;
  let cropState = { active: false, startX: 0, startY: 0, currentRect: null };

  let isAgentTab = false;
  let isAgentBusy = false;
  let isAgentDispatching = false;
  let lockOverlayEl = null;

  // =========================================================================
  // 1. Virtual Mouse Subsystem
  // =========================================================================

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

  let cursorHideTimeout = null;

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

  /**
   * Trigger click animation & dispatch synthetic events on DOM element
   */
  async function virtualClick(x = currentMouseX, y = currentMouseY, selector = null) {
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

    // Find and dispatch event on element under pointer
    let el = selector ? document.querySelector(selector) : null;
    if (!el) {
      const prevCursorDisplay = cursorLayer.style.display;
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
        isAgentDispatching = true;
        el.dispatchEvent(new PointerEvent("pointerdown", eventInit));
        el.dispatchEvent(new MouseEvent("mousedown", eventInit));
        el.dispatchEvent(new PointerEvent("pointerup", eventInit));
        el.dispatchEvent(new MouseEvent("mouseup", eventInit));
        el.dispatchEvent(new MouseEvent("click", eventInit));
      } finally {
        isAgentDispatching = false;
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
        isAgentDispatching = true;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } finally {
        isAgentDispatching = false;
      }
    }
    const cleanText = String(text ?? "").replace(/\r\n/g, "\n");
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) {
      for (const char of cleanText) {
        if (char === "\r") continue;
        try {
          isAgentDispatching = true;
          if (el.isContentEditable) {
            document.execCommand("insertText", false, char);
          } else {
            el.value = (el.value || "") + char;
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        } finally {
          isAgentDispatching = false;
        }
        await new Promise((r) => setTimeout(r, CONFIG.TYPING_INTERVAL));
      }
      try {
        isAgentDispatching = true;
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
        isAgentDispatching = false;
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
      isAgentDispatching = true;
      window.scrollBy({
        top: deltaY,
        left: deltaX,
        behavior: document.hidden ? "auto" : "smooth"
      });
    } finally {
      isAgentDispatching = false;
    }
    return { success: true, scrollX: window.scrollX, scrollY: window.scrollY };
  }

  // =========================================================================
  // 2. Element Inspector Subsystem
  // =========================================================================

  const inspectorBox = document.createElement("div");
  inspectorBox.id = "agent-pilot-inspector-box";
  document.documentElement.appendChild(inspectorBox);

  const inspectorTooltip = document.createElement("div");
  inspectorTooltip.id = "agent-pilot-inspector-tooltip";
  document.documentElement.appendChild(inspectorTooltip);

  function getElementSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return el ? el.tagName.toLowerCase() : "";
    if (el.id) return `#${el.id}`;

    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.body) {
      let selector = el.nodeName.toLowerCase();
      if (el.className && typeof el.className === "string") {
        const classes = el.className.trim().split(/\s+/).filter(c => !c.startsWith("agent-pilot"));
        if (classes.length) selector += "." + classes.slice(0, 2).join(".");
      }
      path.unshift(selector);
      el = el.parentElement;
    }
    return path.join(" > ");
  }

  function getXPath(el) {
    if (!el) return "";
    if (el.id) return `//*[@id="${el.id}"]`;
    if (el === document.body) return "/html/body";

    let ix = 0;
    const siblings = el.parentNode ? el.parentNode.childNodes : [];
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === el) {
        return getXPath(el.parentNode) + "/" + el.tagName.toLowerCase() + "[" + (ix + 1) + "]";
      }
      if (sibling.nodeType === 1 && sibling.tagName === el.tagName) {
        ix++;
      }
    }
    return "";
  }

  function getDetailedElementInfo(el) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || "",
      className: typeof el.className === "string" ? el.className : "",
      selector: getElementSelector(el),
      xpath: getXPath(el),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        bottom: Math.round(rect.bottom),
        right: Math.round(rect.right)
      },
      text: (el.innerText || el.textContent || "").trim().slice(0, 150),
      value: el.value !== undefined ? String(el.value) : undefined,
      styles: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontSize: style.fontSize,
        display: style.display,
        visibility: style.visibility
      }
    };
  }

  function handleInspectorMouseMove(e) {
    if (!isInspectorActive) return;

    // Ignore inspector elements
    if (e.target.closest("#agent-pilot-cursor-layer") || 
        e.target.closest("#agent-pilot-inspector-box") || 
        e.target.closest("#agent-pilot-inspector-tooltip") ||
        e.target.closest("#agent-pilot-crop-overlay")) {
      return;
    }

    const target = e.target;
    const rect = target.getBoundingClientRect();

    inspectorBox.style.display = "block";
    inspectorBox.style.left = `${rect.left}px`;
    inspectorBox.style.top = `${rect.top}px`;
    inspectorBox.style.width = `${rect.width}px`;
    inspectorBox.style.height = `${rect.height}px`;

    const selector = getElementSelector(target);
    const classes = target.className && typeof target.className === "string" 
      ? target.className.trim().split(/\s+/).slice(0, 2).map(c => `.${c}`).join("") 
      : "";

    const safeTag = escapeHtml(target.tagName.toLowerCase());
    const safeClasses = escapeHtml(classes);
    const safeSelector = escapeHtml(selector);

    inspectorTooltip.innerHTML = `
      <div class="agent-pilot-tooltip-header">
        <span class="agent-pilot-tag">&lt;${safeTag}&gt;</span>
        <span class="agent-pilot-class">${safeClasses}</span>
        <span class="agent-pilot-dimensions">${Math.round(rect.width)} × ${Math.round(rect.height)}</span>
      </div>
      <div class="agent-pilot-selector">${safeSelector}</div>
      <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Tọa độ: (${Math.round(rect.left)}, ${Math.round(rect.top)})</div>
    `;

    // Position tooltip above or below element
    let tooltipTop = rect.top - 54;
    if (tooltipTop < 10) tooltipTop = rect.bottom + 10;
    let tooltipLeft = Math.max(10, Math.min(rect.left, window.innerWidth - 390));

    inspectorTooltip.style.top = `${tooltipTop}px`;
    inspectorTooltip.style.left = `${tooltipLeft}px`;
    inspectorTooltip.style.display = "block";
  }

  function handleInspectorClick(e) {
    if (!isInspectorActive) return;

    if (e.target.closest("#agent-pilot-cursor-layer") || 
        e.target.closest("#agent-pilot-inspector-box") || 
        e.target.closest("#agent-pilot-inspector-tooltip")) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    lockedElement = e.target;
    const details = getDetailedElementInfo(lockedElement);

    // Highlight locked element
    inspectorBox.style.borderColor = "#f59e0b";
    inspectorBox.style.boxShadow = "0 0 20px rgba(245, 158, 11, 0.6)";

    // Send element data to Side Panel
    chrome.runtime.sendMessage({
      type: "ELEMENT_SELECTED",
      details
    }).catch(() => {});

    showToast(`Đã chọn phần tử: &lt;${escapeHtml(details.tagName)}&gt; (${details.rect.width}×${details.rect.height})`);
  }

  function toggleInspector(enabled) {
    isInspectorActive = enabled;
    if (enabled) {
      document.addEventListener("mousemove", handleInspectorMouseMove, true);
      document.addEventListener("click", handleInspectorClick, true);
      showToast("🎯 Chế độ soi phần tử: Đã BẬT. Di chuột để soi, click để chọn.");
    } else {
      document.removeEventListener("mousemove", handleInspectorMouseMove, true);
      document.removeEventListener("click", handleInspectorClick, true);
      inspectorBox.style.display = "none";
      inspectorTooltip.style.display = "none";
      showToast("🎯 Chế độ soi phần tử: Đã TẮT.");
    }
  }

  // =========================================================================
  // 3. Region Screenshot Crop Overlay
  // =========================================================================

  const cropOverlay = document.createElement("div");
  cropOverlay.id = "agent-pilot-crop-overlay";
  cropOverlay.innerHTML = `
    <div id="agent-pilot-crop-box">
      <div class="agent-pilot-crop-toolbar">
        <span class="agent-pilot-crop-dims" id="agent-pilot-crop-dims">0 × 0</span>
        <button class="agent-pilot-crop-btn" id="agent-pilot-crop-confirm">✓ Chụp vùng này</button>
        <button class="agent-pilot-crop-btn cancel" id="agent-pilot-crop-cancel">✕ Hủy</button>
      </div>
    </div>
  `;
  document.documentElement.appendChild(cropOverlay);

  const cropBox = document.getElementById("agent-pilot-crop-box");
  const cropDims = document.getElementById("agent-pilot-crop-dims");
  const cropConfirmBtn = document.getElementById("agent-pilot-crop-confirm");
  const cropCancelBtn = document.getElementById("agent-pilot-crop-cancel");

  function startRegionCrop() {
    cropOverlay.style.display = "block";
    cropBox.style.display = "none";
    cropState.active = false;

    function onMouseDown(e) {
      if (e.target.closest(".agent-pilot-crop-toolbar")) return;
      cropState.active = true;
      cropState.startX = e.clientX;
      cropState.startY = e.clientY;
      cropBox.style.left = `${e.clientX}px`;
      cropBox.style.top = `${e.clientY}px`;
      cropBox.style.width = "0px";
      cropBox.style.height = "0px";
      cropBox.style.display = "block";
    }

    function onMouseMove(e) {
      if (!cropState.active) return;
      const x = Math.min(e.clientX, cropState.startX);
      const y = Math.min(e.clientY, cropState.startY);
      const w = Math.abs(e.clientX - cropState.startX);
      const h = Math.abs(e.clientY - cropState.startY);

      cropBox.style.left = `${x}px`;
      cropBox.style.top = `${y}px`;
      cropBox.style.width = `${w}px`;
      cropBox.style.height = `${h}px`;
      cropDims.textContent = `${w} × ${h}`;

      cropState.currentRect = { x, y, width: w, height: h };
    }

    function onMouseUp() {
      cropState.active = false;
    }

    cropOverlay.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    function cleanup() {
      cropOverlay.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      cropOverlay.style.display = "none";
    }

    cropCancelBtn.onclick = () => {
      cleanup();
      showToast("Đã hủy chụp vùng.");
    };

    cropConfirmBtn.onclick = () => {
      if (!cropState.currentRect || cropState.currentRect.width < 5 || cropState.currentRect.height < 5) {
        showToast("Vui lòng kéo chọn vùng lớn hơn!");
        return;
      }
      const clip = { ...cropState.currentRect };
      cleanup();

      // Send to side panel / background
      chrome.runtime.sendMessage({
        type: "REGION_CROP_REQUESTED",
        clip
      }).catch(() => {});
    };
  }

  // =========================================================================
  // 4. Color Eyedropper Subsystem
  // =========================================================================

  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgb(${r}, ${g}, ${b})`;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  }

  async function pickColor() {
    if (window.EyeDropper) {
      try {
        const eyeDropper = new window.EyeDropper();
        const result = await eyeDropper.open();
        const hex = result.sRGBHex;
        const rgb = hexToRgb(hex);

        // Parse RGB numbers for HSL
        const matches = rgb.match(/\d+/g);
        const hsl = matches ? rgbToHsl(parseInt(matches[0]), parseInt(matches[1]), parseInt(matches[2])) : "";

        // Copy to clipboard
        navigator.clipboard.writeText(hex).catch(() => {});

        showToast(`🎨 Đã lấy màu: <b>${hex}</b> (đã copy vào clipboard)`);

        chrome.runtime.sendMessage({
          type: "COLOR_PICKED",
          color: { hex, rgb, hsl, timestamp: Date.now() }
        }).catch(() => {});

        return { hex, rgb, hsl };
      } catch (err) {
        // User canceled picker
        return null;
      }
    } else {
      showToast("⚠️ Trình duyệt chưa hỗ trợ native EyeDropper API!");
      return null;
    }
  }

  // =========================================================================
  // 5. Floating Toast Notification
  // =========================================================================

  function showToast(htmlMessage) {
    const existing = document.querySelector(".agent-pilot-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "agent-pilot-toast";
    toast.innerHTML = `<span>🚀</span><div>${htmlMessage}</div>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.4s ease";
      setTimeout(() => toast.remove(), 400);
    }, CONFIG.TOAST_DURATION);
  }

  // =========================================================================
  // 6. Agent Human Input Lock Subsystem (ChatGPT Operator-Style Input Barrier)
  // =========================================================================

  function getActionDescription(action) {
    switch (action) {
      case "page.click":
      case "click_cursor":
      case "browser_click":
        return "Đang thực hiện click phần tử...";
      case "page.type":
      case "type_text":
      case "browser_type":
        return "Đang nhập dữ liệu tự động...";
      case "page.moveMouse":
      case "move_cursor":
        return "Đang di chuyển con trỏ chuột...";
      case "page.scroll":
      case "scroll_page":
      case "browser_scroll":
        return "Đang cuộn nội dung trang...";
      case "page.screenshot":
      case "browser_screenshot":
        return "Đang chụp ảnh màn hình...";
      case "tabs.update":
      case "browser_navigate":
        return "Đang chuyển hướng trang...";
      default:
        return action ? `Đang thực thi: ${action}` : "AI Agent đang thực hiện thao tác...";
    }
  }

  function showLockOverlay(action = "") {
    if (!lockOverlayEl) {
      lockOverlayEl = document.createElement("div");
      lockOverlayEl.id = "agent-pilot-lock-overlay";
      lockOverlayEl.innerHTML = `
        <div class="agent-pilot-lock-card">
          <div class="agent-pilot-lock-spinner"></div>
          <div class="agent-pilot-lock-info">
            <div class="agent-pilot-lock-title">
              <span>🤖</span>
              <span id="agent-pilot-lock-title-text">AI Agent đang thao tác...</span>
            </div>
            <div class="agent-pilot-lock-desc" id="agent-pilot-lock-action-desc">
              Vui lòng không can thiệp chuột hoặc bàn phím lúc này.
            </div>
          </div>
          <button class="agent-pilot-unlock-btn" id="agent-pilot-emergency-unlock" title="Lấy lại quyền điều khiển thủ công">
            <span>🔓</span> Chiếm quyền
          </button>
        </div>
      `;
      (document.body || document.documentElement).appendChild(lockOverlayEl);

      const unlockBtn = lockOverlayEl.querySelector("#agent-pilot-emergency-unlock");
      if (unlockBtn) {
        unlockBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          setAgentBusyState(false);
          try {
            chrome.runtime.sendMessage({ action: "agent_emergency_unlocked" }).catch(() => {});
          } catch (_) {}
        });
      }
    }

    const descEl = document.getElementById("agent-pilot-lock-action-desc");
    if (descEl) {
      const desc = getActionDescription(action);
      descEl.textContent = `${desc} Vui lòng không can thiệp.`;
    }
    lockOverlayEl.style.display = "flex";
  }

  function hideLockOverlay() {
    if (lockOverlayEl) {
      lockOverlayEl.style.display = "none";
    }
  }

  // Intercept human input events in capture phase
  const BLOCKED_INPUT_EVENTS = [
    "mousedown", "mouseup", "click", "dblclick", "contextmenu",
    "keydown", "keyup", "keypress",
    "wheel", "pointerdown", "pointerup",
    "touchstart", "touchend", "touchmove"
  ];

  function handleCaptureInput(e) {
    if (!isAgentBusy) return;

    // Allow synthetic events dispatched by Agent Pilot
    if (isAgentDispatching || !e.isTrusted) {
      return;
    }

    // Allow emergency takeover button clicks
    if (e.target && typeof e.target.closest === "function" && e.target.closest("#agent-pilot-emergency-unlock")) {
      return;
    }

    // Block human interactions
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  let areBlockersAttached = false;

  function attachInputBlockers() {
    if (areBlockersAttached) return;
    areBlockersAttached = true;
    BLOCKED_INPUT_EVENTS.forEach((evtName) => {
      window.addEventListener(evtName, handleCaptureInput, { capture: true, passive: false });
    });
  }

  function detachInputBlockers() {
    if (!areBlockersAttached) return;
    areBlockersAttached = false;
    BLOCKED_INPUT_EVENTS.forEach((evtName) => {
      window.removeEventListener(evtName, handleCaptureInput, { capture: true, passive: false });
    });
  }

  function setAgentBusyState(busy, action = "") {
    isAgentBusy = Boolean(busy);
    if (isAgentBusy) {
      attachInputBlockers();
      showLockOverlay(action);
    } else {
      detachInputBlockers();
      hideLockOverlay();
    }
  }

  // =========================================================================
  // 7. Antigravity-First Global Bridge API (`window.__AGENT_PILOT__`)
  // =========================================================================

  window.__AGENT_PILOT__ = {
    version: "1.0.0",
    moveMouse: moveVirtualMouse,
    click: virtualClick,
    type: virtualType,
    scroll: virtualScroll,
    toggleInspector: toggleInspector,
    getElement: (selector) => {
      const el = document.querySelector(selector);
      return getDetailedElementInfo(el);
    },
    startRegionCrop: startRegionCrop,
    pickColor: pickColor,
    getLockedElement: () => (lockedElement ? getDetailedElementInfo(lockedElement) : null),
    getCursorPosition: () => ({ x: currentMouseX, y: currentMouseY }),
    setBusy: (busy, action) => setAgentBusyState(busy, action),
    isBusy: () => isAgentBusy,
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
    if (action === "virtual_mouse_move") result = await moveVirtualMouse(data.x, data.y, data.duration);
    else if (action === "virtual_mouse_click") result = await virtualClick(data.x, data.y);
    else if (action === "virtual_type") result = await virtualType(data.selector, data.text);
    else if (action === "virtual_scroll") result = virtualScroll(data.deltaX, data.deltaY);
    else if (action === "toggle_inspector") { toggleInspector(data.enabled); result = { success: true }; }
    else if (action === "get_element_info") {
      const el = document.querySelector(data.selector);
      result = getDetailedElementInfo(el);
    }
    else if (action === "pick_color") result = await pickColor();
    else if (action === "get_cursor_pos") result = { x: currentMouseX, y: currentMouseY };
    else if (action === "is_busy") result = isAgentBusy;
    else if (action === "is_agent_tab") result = isAgentTab;
    else if (action === "set_busy") { setAgentBusyState(data.busy, data.action); result = { success: true, isAgentBusy }; }

    window.dispatchEvent(new CustomEvent("__AGENT_PILOT_RESP__", {
      detail: { reqId, result }
    }));
  });

  // Listen for messages from Background & Side Panel
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === "virtual_mouse_move" || req.action === "move_cursor") {
      moveVirtualMouse(req.x, req.y, req.duration || 300).then(sendResponse);
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
      virtualClick(req.x, req.y, req.selector).then(sendResponse);
      return true;
    }

    if (req.action === "virtual_type" || req.action === "type_text") {
      virtualType(req.selector, req.text, req.clear, req.pressEnter).then(sendResponse);
      return true;
    }

    if (req.action === "press_key" || req.action === "dispatch_key") {
      const key = req.key || "Enter";
      let target = req.selector ? document.querySelector(req.selector) : null;
      if (!target) {
        target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
      }
      try {
        isAgentDispatching = true;
        const keyCodeMap = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
        const code = req.code || key;
        const keyCode = req.keyCode || keyCodeMap[key] || 0;
        const eventInit = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true };
        target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
        target.dispatchEvent(new KeyboardEvent("keypress", eventInit));
        target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
        if (key === "Enter" && target.form && typeof target.form.requestSubmit === "function") {
          try { target.form.requestSubmit(); } catch (_) {}
        }
        sendResponse({ success: true, key });
      } finally {
        isAgentDispatching = false;
      }
      return true;
    }

    if (req.action === "virtual_scroll" || req.action === "scroll_page") {
      sendResponse(virtualScroll(req.deltaX, req.deltaY));
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
          sendResponse({ success: true, found: true, details: getDetailedElementInfo(el) });
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
      toggleInspector(req.enabled);
      sendResponse({ success: true, active: isInspectorActive });
      return true;
    }

    if (req.action === "get_element_info") {
      const el = req.selector ? document.querySelector(req.selector) : lockedElement;
      const details = el ? getDetailedElementInfo(el) : null;
      sendResponse({ success: !!el, ...(details || {}), details });
      return true;
    }

    if (req.action === "start_region_crop") {
      startRegionCrop();
      sendResponse({ success: true });
      return true;
    }

    if (req.action === "pick_color") {
      pickColor().then((color) => sendResponse({ success: !!color, color }));
      return true;
    }

    if (req.action === "set_agent_tab_status") {
      isAgentTab = Boolean(req.isAgentTab);
      sendResponse({ success: true, isAgentTab });
      return true;
    }

    if (req.action === "set_agent_busy") {
      setAgentBusyState(req.busy, req.currentAction || "");
      sendResponse({ success: true, isAgentBusy });
      return true;
    }

    if (req.action === "ping") {
      sendResponse({ success: true, status: "ready", isAgentTab, isAgentBusy });
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
