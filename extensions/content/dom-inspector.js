/**
 * Agent Pilot - Content Script DOM Inspector & Region Crop Module
 * Inspects DOM elements, calculates CSS selectors / XPath, highlights elements, and supports visual region cropping
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.inspector) return;
  window.__AP_INTERNAL__.__guards.inspector = true;

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
  let isElementSnapActive = false;
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

  function escapeSelectorToken(token) {
    return (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(token) : String(token);
  }

  function buildStructuralPath(el) {
    const segments = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
      let segment = node.nodeName.toLowerCase();
      if (node.parentElement) {
        const sameTag = Array.from(node.parentElement.children).filter((c) => c.nodeName === node.nodeName);
        if (sameTag.length > 1) segment += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      segments.unshift(segment);
      node = node.parentElement;
    }
    return segments.join(" > ");
  }

  function getElementSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return el ? el.tagName.toLowerCase() : "";
    try {
      if (el.id) {
        const idSelector = `#${escapeSelectorToken(el.id)}`;
        if (document.querySelectorAll(idSelector).length === 1) return idSelector;
      }

      const path = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
        let selector = node.nodeName.toLowerCase();
        if (node.className && typeof node.className === "string") {
          const classes = node.className.trim().split(/\s+/).filter((c) => c && !c.startsWith("agent-pilot"));
          if (classes.length) selector += "." + classes.slice(0, 2).map(escapeSelectorToken).join(".");
        }
        path.unshift(selector);
        node = node.parentElement;
      }

      const selector = path.join(" > ");
      if (selector && document.querySelectorAll(selector).length === 1) return selector;
    } catch (_) {}
    return buildStructuralPath(el);
  }

  function getXPath(el) {
    if (!el) return "";
    if (el.id && !el.id.includes('"')) return `//*[@id="${el.id}"]`;
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

  function getDetailedElementInfo(el, includeStyles = false) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const info = {
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
      text: (el.innerText || el.textContent || "").trim().slice(0, 500),
      value: el.value !== undefined ? String(el.value) : undefined,
      isVisible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0,
      inlineStyle: el.getAttribute("style") || ""
    };

    if (includeStyles) {
      info.styles = {
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontSize: style.fontSize,
        display: style.display,
        visibility: style.visibility
      };
      info.computedStyles = {
        // Typography
        color: style.color,
        "font-family": style.fontFamily,
        "font-size": style.fontSize,
        "font-weight": style.fontWeight,
        "font-style": style.fontStyle !== "normal" ? style.fontStyle : undefined,
        "line-height": style.lineHeight,
        "text-align": style.textAlign,
        "letter-spacing": style.letterSpacing !== "normal" ? style.letterSpacing : undefined,
        "text-decoration": style.textDecorationLine || (style.textDecoration !== "none" ? style.textDecoration : undefined),
        "white-space": style.whiteSpace !== "normal" ? style.whiteSpace : undefined,
        "word-break": style.wordBreak !== "normal" ? style.wordBreak : undefined,
        // Box Model & Layout
        display: style.display,
        position: style.position,
        top: style.top !== "auto" ? style.top : undefined,
        right: style.right !== "auto" ? style.right : undefined,
        bottom: style.bottom !== "auto" ? style.bottom : undefined,
        left: style.left !== "auto" ? style.left : undefined,
        "z-index": style.zIndex !== "auto" ? style.zIndex : undefined,
        "box-sizing": style.boxSizing,
        width: style.width,
        height: style.height,
        "min-width": style.minWidth !== "0px" ? style.minWidth : undefined,
        "max-width": style.maxWidth !== "none" ? style.maxWidth : undefined,
        "min-height": style.minHeight !== "0px" ? style.minHeight : undefined,
        "max-height": style.maxHeight !== "none" ? style.maxHeight : undefined,
        margin: `${style.marginTop} ${style.marginRight} ${style.marginBottom} ${style.marginLeft}`,
        "margin-top": style.marginTop,
        "margin-right": style.marginRight,
        "margin-bottom": style.marginBottom,
        "margin-left": style.marginLeft,
        padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
        "padding-top": style.paddingTop,
        "padding-right": style.paddingRight,
        "padding-bottom": style.paddingBottom,
        "padding-left": style.paddingLeft,
        // Background & Borders
        "background-color": style.backgroundColor,
        "background-image": style.backgroundImage !== "none" ? style.backgroundImage : undefined,
        border: `${style.borderWidth} ${style.borderStyle} ${style.borderColor}`,
        "border-width": style.borderWidth !== "0px" ? style.borderWidth : undefined,
        "border-style": style.borderStyle !== "none" ? style.borderStyle : undefined,
        "border-color": style.borderColor,
        "border-radius": style.borderRadius !== "0px" ? style.borderRadius : undefined,
        outline: style.outlineStyle !== "none" ? `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}` : undefined,
        // Visuals & Effects
        "box-shadow": style.boxShadow !== "none" ? style.boxShadow : undefined,
        opacity: style.opacity !== "1" ? style.opacity : undefined,
        visibility: style.visibility,
        cursor: style.cursor !== "auto" ? style.cursor : undefined,
        overflow: style.overflow !== "visible" ? style.overflow : undefined,
        "overflow-x": style.overflowX !== "visible" ? style.overflowX : undefined,
        "overflow-y": style.overflowY !== "visible" ? style.overflowY : undefined,
        transform: style.transform !== "none" ? style.transform : undefined,
        transition: style.transition !== "all 0s ease 0s" && style.transition !== "none" ? style.transition : undefined,
        // Flexbox & Grid
        "flex-direction": style.display.includes("flex") ? style.flexDirection : undefined,
        "flex-wrap": style.display.includes("flex") ? style.flexWrap : undefined,
        "justify-content": style.display.includes("flex") || style.display.includes("grid") ? style.justifyContent : undefined,
        "align-items": style.display.includes("flex") || style.display.includes("grid") ? style.alignItems : undefined,
        gap: style.gap !== "normal" && style.gap !== "0px" ? style.gap : undefined,
        "grid-template-columns": style.display.includes("grid") ? style.gridTemplateColumns : undefined,
        "grid-template-rows": style.display.includes("grid") ? style.gridTemplateRows : undefined
      };
    }
    return info;
  }

  function getInteractiveSnapshot(maxElements = 80, format = "text") {
    maxElements = Math.min(Math.max(Number(maxElements) || 80, 10), 300);
    const selectorQuery = [
      "a[href]",
      "button",
      "input:not([type=hidden])",
      "textarea",
      "select",
      "details",
      "summary",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='combobox']",
      "[role='textbox']",
      "[role='searchbox']",
      "[tabindex]:not([tabindex='-1'])",
      "[contenteditable='true']"
    ].join(", ");

    const rawNodes = Array.from(document.querySelectorAll(selectorQuery));
    const seenNodes = new Set(rawNodes);

    // Also include elements with direct onclick
    const allDivsSpans = document.querySelectorAll("div, span, li, tr");
    for (let i = 0; i < allDivsSpans.length && rawNodes.length < 500; i++) {
      const node = allDivsSpans[i];
      if (node.onclick || node.getAttribute("onclick")) {
        if (!seenNodes.has(node)) {
          seenNodes.add(node);
          rawNodes.push(node);
        }
      }
    }

    const items = [];
    const elementsList = [null]; // 1-indexed for @1, @2, ...

    for (const el of rawNodes) {
      if (items.length >= maxElements) break;

      // Filter out Agent Pilot's internal UI elements
      if ((el.id && el.id.startsWith("agent-pilot")) ||
          el.closest("[id^='agent-pilot']") ||
          el.closest(".agent-pilot-virtual-cursor") ||
          el.closest("#agent-pilot-cursor-layer") ||
          el.closest("#agent-pilot-inspector-box") ||
          el.closest("#agent-pilot-inspector-tooltip") ||
          el.closest("#agent-pilot-crop-overlay") ||
          el.closest("#agent-pilot-toast-container") ||
          el.closest("#agent-pilot-loupe") ||
          el.closest("#agent-pilot-feedback-studio")) {
        continue;
      }

      // Visibility & geometry check
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) continue;

      const idx = items.length + 1;
      elementsList.push(el);

      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || (tag === "textarea" ? "textarea" : tag === "select" ? "select" : undefined);
      const name = el.getAttribute("name") || "";
      const placeholder = el.getAttribute("placeholder") || "";
      const role = el.getAttribute("role") || "";
      const ariaLabel = el.getAttribute("aria-label") || "";

      let label = ariaLabel || placeholder || "";
      if (!label && el.labels && el.labels.length > 0) {
        label = (el.labels[0].innerText || "").trim();
      }
      if (!label) {
        label = (el.title || el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
      }

      const val = el.value !== undefined && el.value !== "" ? String(el.value).slice(0, 60) : undefined;
      const isChecked = el.checked !== undefined ? el.checked : undefined;
      const isDisabled = el.disabled === true || el.getAttribute("aria-disabled") === "true";
      const safeName = name ? name.replace(/["\\]/g, "\\$&") : "";

      const item = {
        ref: `@${idx}`,
        index: idx,
        tagName: tag,
        type,
        id: el.id || undefined,
        name: name || undefined,
        selector: el.id ? `#${el.id}` : (safeName ? `${tag}[name="${safeName}"]` : getElementSelector(el)),
        label: label || undefined,
        value: val,
        checked: isChecked,
        disabled: isDisabled || undefined,
        role: role || undefined,
        rect: {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
      items.push(item);
    }

    // Save globally so cursor simulation and selectors can resolve @<index>
    window.__AP_INTERNAL__.snapshotElements = elementsList;

    if (format === "json") {
      return {
        url: window.location.href,
        title: document.title,
        totalInteractive: items.length,
        elements: items
      };
    }

    const lines = [
      `Page: "${document.title}" (${window.location.href})`,
      `Interactive Elements (${items.length} found - use ref like @1 or CSS selector in click/type):`
    ];

    for (const it of items) {
      let desc = `[${it.index}] <${it.tagName}`;
      if (it.type && it.type !== "text") desc += ` type="${it.type}"`;
      if (it.id) desc += ` id="${it.id}"`;
      if (it.name) desc += ` name="${it.name}"`;
      if (it.role) desc += ` role="${it.role}"`;
      if (it.disabled) desc += ` disabled`;
      desc += ">";

      if (it.label) desc += ` "${it.label}"`;
      if (it.value !== undefined) desc += ` [value="${it.value}"]`;
      if (it.checked !== undefined && (it.type === "checkbox" || it.type === "radio")) desc += ` [checked=${it.checked}]`;

      desc += ` (pos: ${it.rect.x},${it.rect.y})`;
      lines.push(desc);
    }

    return lines.join("\n");
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
    if (enabled && isElementSnapActive) {
      stopElementSnap(false);
    }
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
      window.__AP_INTERNAL__.snapshotElements = [null];
      if (showToastNotice) showToast("🎯 Chế độ soi phần tử: Đã TẮT.");
    }
  }

  // =========================================================================
  // Interactive Element Snap (Chụp Phần tử Trực tiếp trên DOM)
  // =========================================================================

  function handleElementSnapMouseMove(e) {
    if (!isElementSnapActive) return;

    if (e.target.closest("#agent-pilot-cursor-layer") || 
        e.target.closest("#agent-pilot-inspector-box") || 
        e.target.closest("#agent-pilot-inspector-tooltip") ||
        e.target.closest("#agent-pilot-crop-overlay") ||
        e.target.closest("#agent-pilot-toast-container") ||
        e.target.closest("#agent-pilot-loupe")) {
      return;
    }

    const target = e.target;
    if (!target || target === document.documentElement || target === document.body) return;

    const rect = target.getBoundingClientRect();
    inspectorBox.style.top = `${rect.top}px`;
    inspectorBox.style.left = `${rect.left}px`;
    inspectorBox.style.width = `${rect.width}px`;
    inspectorBox.style.height = `${rect.height}px`;
    inspectorBox.style.borderColor = "#a855f7";
    inspectorBox.style.boxShadow = "0 0 16px rgba(168, 85, 247, 0.7)";
    inspectorBox.style.display = "block";

    const safeTag = escapeHtml(target.tagName.toLowerCase());
    inspectorTooltip.innerHTML = `
      <div class="agent-pilot-tooltip-header" style="color: #a855f7;">
        <span class="agent-pilot-tag" style="background: rgba(168, 85, 247, 0.2); color: #d8b4fe;">📸 &lt;${safeTag}&gt;</span>
        <span class="agent-pilot-dimensions">${Math.round(rect.width)} × ${Math.round(rect.height)}</span>
      </div>
      <div style="font-size: 11px; color: #cbd5e1; margin-top: 3px;">🎯 Click để chụp phần tử này • Esc để hủy</div>
    `;

    let tooltipTop = rect.top - 52;
    if (tooltipTop < 10) tooltipTop = rect.bottom + 10;
    let tooltipLeft = Math.max(10, Math.min(rect.left, window.innerWidth - 320));

    inspectorTooltip.style.top = `${tooltipTop}px`;
    inspectorTooltip.style.left = `${tooltipLeft}px`;
    inspectorTooltip.style.display = "block";
  }

  function handleElementSnapClick(e) {
    if (!isElementSnapActive) return;

    if (e.target.closest("#agent-pilot-cursor-layer") || 
        e.target.closest("#agent-pilot-inspector-box") || 
        e.target.closest("#agent-pilot-inspector-tooltip") ||
        e.target.closest("#agent-pilot-crop-overlay") ||
        e.target.closest("#agent-pilot-toast-container") ||
        e.target.closest("#agent-pilot-loupe")) {
      return;
    }

    const target = e.target;
    if (!target || target === document.documentElement || target === document.body) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const r = target.getBoundingClientRect();
    const rect = {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
      pageWidth: window.innerWidth,
      pageHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    };
    const tagName = target.tagName.toLowerCase();

    // Tự động tắt ngay chế độ chọn phần tử chụp
    stopElementSnap(false);

    // Hiệu ứng chớp xanh xác nhận chụp thành công
    inspectorTooltip.style.display = "none";
    inspectorBox.style.display = "block";
    inspectorBox.style.borderColor = "#10b981";
    inspectorBox.style.boxShadow = "0 0 20px rgba(16, 185, 129, 0.8)";
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      inspectorBox.style.display = "none";
      highlightTimer = null;
    }, 1000);

    // Gửi yêu cầu chụp phần tử đến Side Panel / Background
    chrome.runtime.sendMessage({
      type: "ELEMENT_SNAP_REQUESTED",
      rect,
      tagName
    }).catch(() => {});

    showToast(`📸 Đã chọn phần tử &lt;${escapeHtml(tagName)}&gt; - Đang chụp ảnh...`);
  }

  function handleElementSnapKeyDown(e) {
    if (!isElementSnapActive) return;
    if (e.key === "Escape") {
      e.preventDefault();
      stopElementSnap(true);
      chrome.runtime.sendMessage({
        type: "ELEMENT_SNAP_CANCELLED"
      }).catch(() => {});
    }
  }

  function startElementSnap() {
    if (isInspectorActive) {
      toggleInspector(false, false);
    }
    if (isElementSnapActive) return;
    isElementSnapActive = true;
    if (highlightTimer) {
      clearTimeout(highlightTimer);
      highlightTimer = null;
    }
    inspectorBox.style.borderColor = "#a855f7";
    inspectorBox.style.boxShadow = "0 0 16px rgba(168, 85, 247, 0.7)";
    document.addEventListener("mousemove", handleElementSnapMouseMove, true);
    document.addEventListener("click", handleElementSnapClick, true);
    document.addEventListener("keydown", handleElementSnapKeyDown, true);
    showToast("📸 Chế độ chụp phần tử: Di chuột và click chọn phần tử trên trang • Esc để hủy");
  }

  function stopElementSnap(showToastNotice = false) {
    if (!isElementSnapActive) return;
    isElementSnapActive = false;
    document.removeEventListener("mousemove", handleElementSnapMouseMove, true);
    document.removeEventListener("click", handleElementSnapClick, true);
    document.removeEventListener("keydown", handleElementSnapKeyDown, true);
    inspectorTooltip.style.display = "none";
    if (!highlightTimer) {
      inspectorBox.style.display = "none";
    }
    window.__AP_INTERNAL__.snapshotElements = [null];
    if (showToastNotice) showToast("Đã hủy chụp phần tử.");
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
    if (isElementSnapActive) stopElementSnap(false);
    if (isInspectorActive) toggleInspector(false, false);
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
      const clip = {
        x: Math.round(cropState.currentRect.x),
        y: Math.round(cropState.currentRect.y),
        width: Math.round(cropState.currentRect.width),
        height: Math.round(cropState.currentRect.height),
        pageWidth: window.innerWidth,
        pageHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      };
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
    getInteractiveSnapshot,
    getElementSelector,
    getXPath,
    getLockedElement: () => (lockedElement ? getDetailedElementInfo(lockedElement) : null),
    startRegionCrop,
    startElementSnap,
    stopElementSnap,
    isElementSnapActive: () => isElementSnapActive
  };
})();
