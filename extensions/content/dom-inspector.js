/**
 * Agent Pilot - Content Script DOM Inspector & Region Crop Module
 * Inspects DOM elements, calculates CSS selectors / XPath, highlights elements, and supports visual region cropping
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showToast(msg) {
    if (window.__AP_INTERNAL__.showToast) {
      window.__AP_INTERNAL__.showToast(msg);
    }
  }

  let isInspectorActive = false;
  let lockedElement = null;
  let cropState = { active: false, startX: 0, startY: 0, currentRect: null };

  // =========================================================================
  // Inspector UI Elements
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

  let highlightTimer = null;

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

    // Tự động tắt ngay chế độ soi sau khi chọn xong phần tử
    toggleInspector(false, false);

    // Hiển thị viền highlight xanh thành công trong 1.2s trước khi ẩn
    inspectorTooltip.style.display = "none";
    inspectorBox.style.display = "block";
    inspectorBox.style.borderColor = "#10b981";
    inspectorBox.style.boxShadow = "0 0 20px rgba(16, 185, 129, 0.7)";
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      inspectorBox.style.display = "none";
      highlightTimer = null;
    }, 1200);

    // Gửi thông tin phần tử đã chọn sang Side Panel
    chrome.runtime.sendMessage({
      type: "ELEMENT_SELECTED",
      details
    }).catch(() => {});

    showToast(`🎯 Đã chọn &lt;${escapeHtml(details.tagName)}&gt; - Đã tắt chế độ soi.`);
  }

  function handleInspectorKeyDown(e) {
    if (!isInspectorActive) return;
    if (e.key === "Escape") {
      e.preventDefault();
      toggleInspector(false);
      chrome.runtime.sendMessage({
        type: "INSPECTOR_STATUS_CHANGED",
        enabled: false
      }).catch(() => {});
    }
  }

  function toggleInspector(enabled, showToastNotice = true) {
    isInspectorActive = Boolean(enabled);
    if (enabled) {
      if (highlightTimer) {
        clearTimeout(highlightTimer);
        highlightTimer = null;
      }
      inspectorBox.style.borderColor = "#38bdf8";
      inspectorBox.style.boxShadow = "0 0 15px rgba(56, 189, 248, 0.5)";
      document.addEventListener("mousemove", handleInspectorMouseMove, true);
      document.addEventListener("click", handleInspectorClick, true);
      document.addEventListener("keydown", handleInspectorKeyDown, true);
      if (showToastNotice) showToast("🎯 Chế độ soi phần tử: Đã BẬT. Di chuột để soi, click để chọn.");
    } else {
      document.removeEventListener("mousemove", handleInspectorMouseMove, true);
      document.removeEventListener("click", handleInspectorClick, true);
      document.removeEventListener("keydown", handleInspectorKeyDown, true);
      inspectorTooltip.style.display = "none";
      if (!highlightTimer) {
        inspectorBox.style.display = "none";
      }
      if (showToastNotice) showToast("🎯 Chế độ soi phần tử: Đã TẮT.");
    }
  }

  // =========================================================================
  // Region Screenshot Crop Overlay
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

  window.__AP_INTERNAL__.inspector = {
    toggleInspector,
    isInspectorActive: () => isInspectorActive,
    getDetailedElementInfo,
    getElementSelector,
    getXPath,
    getLockedElement: () => (lockedElement ? getDetailedElementInfo(lockedElement) : null),
    startRegionCrop
  };
})();
