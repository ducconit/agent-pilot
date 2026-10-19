/**
 * Agent Pilot - Content Script DOM Inspector & Region Crop Module
 * Inspects DOM elements, calculates CSS selectors / XPath, highlights elements, and supports visual region cropping
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.inspector) return;
  window.__AP_INTERNAL__.__guards.inspector = true;

  // Shared config with local fallbacks (see content/config.js).
  const T = (window.__AP_CONFIG__ && window.__AP_CONFIG__.timeouts) || {};
  const L = (window.__AP_CONFIG__ && window.__AP_CONFIG__.limits) || {};
  const SNAPSHOT_DEFAULT_ELEMENTS = L.snapshotDefaultElements || 80;
  const SNAPSHOT_MIN_ELEMENTS = L.snapshotMinElements || 10;
  const SNAPSHOT_MAX_FROM_CALLER = L.snapshotMaxFromCaller || 300;
  const SNAPSHOT_MAX_ELEMENTS = L.snapshotMaxElements || 500;
  const HIGHLIGHT_FLASH_MS = T.highlightFlashMs || 1200;
  const SNAP_FLASH_MS = T.snapFlashMs || 1000;

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

  // ---------------------------------------------------------------------------
  // Selector / XPath helpers live in content/selector-utils.js, injected just
  // before this module (see manifest order). Manifest injection guarantees the
  // dependency, so we delegate directly instead of keeping a duplicate
  // implementation that could drift out of sync; if the module is somehow
  // missing we degrade to a minimal selector rather than breaking the inspector.
  // ---------------------------------------------------------------------------
  const selectorUtils = window.__AP_INTERNAL__.selectorUtils || null;

  function getElementSelector(el) {
    if (!el) return "";
    if (selectorUtils) return selectorUtils.getElementSelector(el);
    return el.tagName ? el.tagName.toLowerCase() : "";
  }

  function getXPath(el) {
    if (!el) return "";
    if (selectorUtils) return selectorUtils.getXPath(el);
    return el.id && !el.id.includes('"') ? `//*[@id="${el.id}"]` : "";
  }

  function parseRgbColor(colorStr) {
    if (!colorStr || typeof colorStr !== "string") return null;
    const match = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
    if (!match) return null;
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
      a: match[4] !== undefined ? Number(match[4]) : 1
    };
  }

  function getEffectiveBackgroundColor(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const bg = window.getComputedStyle(node).backgroundColor;
      const parsed = parseRgbColor(bg);
      if (parsed && parsed.a > 0.05) {
        if (parsed.a < 1) {
          const alpha = parsed.a;
          return {
            r: Math.round(parsed.r * alpha + 255 * (1 - alpha)),
            g: Math.round(parsed.g * alpha + 255 * (1 - alpha)),
            b: Math.round(parsed.b * alpha + 255 * (1 - alpha)),
            a: 1
          };
        }
        return parsed;
      }
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function computeRelativeLuminance({ r, g, b }) {
    const toLinear = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  }

  function computeContrastRatio(fg, bg) {
    if (!fg || !bg) return null;
    const l1 = computeRelativeLuminance(fg);
    const l2 = computeRelativeLuminance(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
  }

  function evaluateAccessibility(el, style, rect, testLocators) {
    const fg = parseRgbColor(style.color);
    const bg = getEffectiveBackgroundColor(el);
    const contrastRatio = computeContrastRatio(fg, bg);
    const fontSizePx = parseFloat(style.fontSize) || 16;
    const fontWeightNum = parseInt(style.fontWeight, 10) || (style.fontWeight === "bold" ? 700 : 400);
    const isLargeText = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeightNum >= 700);

    let wcagLevel = "AA";
    if (contrastRatio !== null) {
      const minAA = isLargeText ? 3.0 : 4.5;
      const minAAA = isLargeText ? 4.5 : 7.0;
      if (contrastRatio >= minAAA) wcagLevel = "AAA";
      else if (contrastRatio >= minAA) wcagLevel = "AA";
      else wcagLevel = "Fail";
    }

    const warnings = [];
    const tag = el.tagName.toLowerCase();
    const role = testLocators?.role || "";
    const accessibleName = testLocators?.accessibleName || "";
    const isInteractive = ["button", "a", "input", "select", "textarea"].includes(tag) ||
      ["button", "link", "checkbox", "radio", "switch", "combobox", "textbox"].includes(role);

    if (tag === "img" && !el.hasAttribute("alt")) {
      warnings.push("Thẻ <img> thiếu thuộc tính alt");
    }
    if (isInteractive && !accessibleName && el.getAttribute("type") !== "hidden") {
      warnings.push(`Phần tử tương tác <${tag}> thiếu nhãn trợ năng (aria-label / label / text)`);
    }
    if (isInteractive && rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24)) {
      warnings.push(`Kích thước vùng bấm nhỏ (${Math.round(rect.width)}×${Math.round(rect.height)}px < 24×24px chuẩn WCAG 2.2)`);
    }
    const hasDirectText = Boolean((el.innerText || "").trim());
    if (hasDirectText && wcagLevel === "Fail" && contrastRatio !== null) {
      warnings.push(`Độ tương phản chữ thấp (${contrastRatio}:1 - chưa đạt chuẩn WCAG AA)`);
    }

    return {
      contrastRatio,
      wcagLevel,
      role: role || undefined,
      accessibleName: accessibleName || undefined,
      warnings
    };
  }

  function getDetailedElementInfo(el, includeStyles = false) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const testLocators = selectorUtils?.getTestLocators ? selectorUtils.getTestLocators(el) : null;
    const selector = testLocators?.selector || getElementSelector(el);
    const xpath = testLocators?.xpath || getXPath(el);
    const selectorMatches = testLocators?.selectorMatches ?? (selectorUtils?.getSelectorMatchCount ? selectorUtils.getSelectorMatchCount(selector) : 1);
    const a11y = evaluateAccessibility(el, style, rect, testLocators);

    const info = {
      tagName: el.tagName.toLowerCase(),
      id: el.id || "",
      className: typeof el.className === "string" ? el.className : "",
      selector,
      selectorMatches,
      xpath,
      playwrightLocator: testLocators?.playwrightLocator || "",
      testId: testLocators?.testId || undefined,
      testIdAttr: testLocators?.testIdAttr || undefined,
      role: testLocators?.role || undefined,
      accessibleName: testLocators?.accessibleName || undefined,
      a11y,
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

  function getInteractiveSnapshot(maxElements = SNAPSHOT_DEFAULT_ELEMENTS, format = "text") {
    maxElements = Math.min(Math.max(Number(maxElements) || SNAPSHOT_DEFAULT_ELEMENTS, SNAPSHOT_MIN_ELEMENTS), SNAPSHOT_MAX_FROM_CALLER);
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
    for (let i = 0; i < allDivsSpans.length && rawNodes.length < SNAPSHOT_MAX_ELEMENTS; i++) {
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
          el.closest("[id^='agent-pilot'], .agent-pilot-virtual-cursor, .agent-pilot-toast")) {
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
    const matchCount = selectorUtils?.getSelectorMatchCount ? selectorUtils.getSelectorMatchCount(selector) : 1;
    const testInfo = selectorUtils?.getTestIdInfo ? selectorUtils.getTestIdInfo(target) : null;
    const classes = target.className && typeof target.className === "string"
      ? target.className.trim().split(/\s+/).filter(c => !c.startsWith("agent-pilot")).slice(0, 2).map(c => `.${c}`).join("")
      : "";

    const safeTag = escapeHtml(target.tagName.toLowerCase());
    const safeClasses = escapeHtml(classes);
    const safeSelector = escapeHtml(selector);
    const matchBadge = matchCount === 1
      ? `<span style="color:#10b981;font-weight:700;margin-left:6px;">✓ 1 match</span>`
      : `<span style="color:#f59e0b;font-weight:700;margin-left:6px;">⚠ ${matchCount} matches</span>`;
    const testIdLine = testInfo
      ? `<div style="font-size: 10px; color: #38bdf8; margin-top: 2px;">🧪 ${escapeHtml(testInfo.attr)}="${escapeHtml(testInfo.value)}"</div>`
      : "";

    inspectorTooltip.innerHTML = `
      <div class="agent-pilot-tooltip-header">
        <span class="agent-pilot-tag">&lt;${safeTag}&gt;</span>
        <span class="agent-pilot-class">${safeClasses}</span>
        <span class="agent-pilot-dimensions">${Math.round(rect.width)} × ${Math.round(rect.height)} ${matchBadge}</span>
      </div>
      <div class="agent-pilot-selector">${safeSelector}</div>
      ${testIdLine}
      <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Tọa độ: (${Math.round(rect.left)}, ${Math.round(rect.top)})</div>
    `;

    // Position tooltip above or below element
    let tooltipTop = rect.top - (testInfo ? 70 : 54);
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
    const details = getDetailedElementInfo(lockedElement, true);

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
    }, HIGHLIGHT_FLASH_MS);

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
    }, SNAP_FLASH_MS);

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
        <div role="button" tabindex="0" class="agent-pilot-crop-btn" id="agent-pilot-crop-confirm">✓ Chụp vùng này</div>
        <div role="button" tabindex="0" class="agent-pilot-crop-btn cancel" id="agent-pilot-crop-cancel">✕ Hủy</div>
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

  // =========================================================================
  // QA User Action Breadcrumbs ("Steps to Reproduce") & Page Diagnostics
  // =========================================================================

  const MAX_REPRO_STEPS = 100;
  const SENSITIVE_FIELD_RE = /pass(word)?|passcode|secret|token|api[-_]?key|auth|cvv|cvc|pin|otp|one[-_]?time|credit|card/i;
  const reproSteps = [];

  function isInternalAgentPilotNode(target) {
    if (!target || target.nodeType !== 1) return true;
    if (target.id && target.id.startsWith("agent-pilot")) return true;
    return Boolean(
      target.closest &&
      (target.closest("[id^='agent-pilot-']") ||
       target.closest(".agent-pilot-virtual-cursor"))
    );
  }

  function isOverlayModeBusy() {
    if (isInspectorActive || isElementSnapActive || cropState.active) return true;
    if (window.__AP_INTERNAL__.eyedropper?.isEyedropperActive?.()) return true;
    if (window.__AP_INTERNAL__.feedbackStudio?.state?.isActive?.()) return true;
    return false;
  }

  function recordReproStep(entry) {
    if (!entry || !entry.action) return;
    const stepPayload = {
      ...entry,
      url: entry.url || window.location.href,
      timestamp: Date.now()
    };

    const prev = reproSteps[reproSteps.length - 1];
    if (
      prev &&
      prev.action === stepPayload.action &&
      prev.selector === stepPayload.selector &&
      ((stepPayload.action === "type" || stepPayload.action === "select") ||
        (prev.value === stepPayload.value && (Date.now() - prev.timestamp < 800)))
    ) {
      prev.value = stepPayload.value;
      prev.description = stepPayload.description || prev.description;
      prev.playwrightLocator = stepPayload.playwrightLocator || prev.playwrightLocator;
      prev.timestamp = Date.now();
    } else {
      if (reproSteps.length >= MAX_REPRO_STEPS) {
        reproSteps.shift();
      }
      reproSteps.push(stepPayload);
    }

    try {
      chrome.runtime.sendMessage({
        action: "record_flow_step",
        step: stepPayload
      }).catch((err) => {
        if (window.__AP_DEBUG__) console.debug("[AgentPilot] record_flow_step send error:", err);
      });
    } catch (err) {
      if (window.__AP_DEBUG__) console.debug("[AgentPilot] record_flow_step dispatch error:", err);
    }
  }

  function isRecordableInteractionEvent(e) {
    return Boolean(e && (e.isTrusted || window.__AP_INTERNAL__.shield?.isDispatching?.()));
  }

  let inputDebounceTimer = null;
  let pendingInputTarget = null;

  function flushPendingInputEvent() {
    if (inputDebounceTimer) {
      clearTimeout(inputDebounceTimer);
      inputDebounceTimer = null;
    }
    if (pendingInputTarget) {
      const target = pendingInputTarget;
      pendingInputTarget = null;
      handleFieldValueEvent({ type: "change", target, isTrusted: true });
    }
  }

  document.addEventListener("click", (e) => {
    try {
      if (!isRecordableInteractionEvent(e) || isOverlayModeBusy() || isInternalAgentPilotNode(e.target)) return;
      flushPendingInputEvent();
      const interactiveTarget = e.target.closest("button, a, input, select, textarea, summary, label, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='checkbox'], [role='radio']");
      if (!interactiveTarget && e.target.closest && e.target.closest("pre, code")) {
        return;
      }
      const target = interactiveTarget || e.target;
      if (!target || target === document.body || target === document.documentElement) return;
      const tag = target.tagName.toLowerCase();
      // Ignore plain clicks on text inputs/textareas/selects since typing/change is recorded separately
      if ((tag === "input" && !["button", "submit", "reset", "checkbox", "radio"].includes((target.getAttribute("type") || "text").toLowerCase())) || tag === "textarea" || tag === "select" || target.isContentEditable) {
        return;
      }
      // Ignore clicks on non-semantic wrapper div/span that simply contain an input/textarea (e.g. Google AI Mode div.esoFne)
      if ((tag === "div" || tag === "span" || tag === "form") && !target.getAttribute("role") && !target.getAttribute("data-testid")) {
        if (target.querySelector && target.querySelector("input, textarea, select, [contenteditable='true']")) {
          return;
        }
      }
      const locators = selectorUtils?.getTestLocators ? selectorUtils.getTestLocators(target) : null;
      const selector = locators?.selector || getElementSelector(target);
      const label = (locators?.accessibleName || (target.innerText || "").trim())
        .replace(/\s+/g, " ")
        .slice(0, 50);
      recordReproStep({
        action: "click",
        tagName: tag,
        selector,
        playwrightLocator: locators?.playwrightLocator || undefined,
        label: label || undefined,
        description: `Click <${tag}>${label ? ` "${label}"` : ""} (\`${selector}\`)`
      });
    } catch (err) {
      if (window.__AP_DEBUG__) console.debug("[AgentPilot] Flow click listener error:", err);
    }
  }, true);

  function handleFieldValueEvent(e) {
    try {
      if (!isRecordableInteractionEvent(e) || isOverlayModeBusy() || isInternalAgentPilotNode(e.target)) return;
      const target = e.target;
      if (!target || !target.tagName) return;
      const tag = target.tagName.toLowerCase();
      const isEditable = target.isContentEditable;
      if (!["input", "textarea", "select"].includes(tag) && !isEditable) return;

      const type = (target.getAttribute("type") || "text").toLowerCase();
      // For checkbox/radio/select, record on change; for text inputs, record on both input and change
      if (e.type === "input" && (tag === "select" || type === "checkbox" || type === "radio")) {
        return;
      }

      const nameAttr = `${target.name || ""} ${target.id || ""} ${target.getAttribute("autocomplete") || ""}`;
      const isSensitive = type === "password" || SENSITIVE_FIELD_RE.test(nameAttr);
      const locators = selectorUtils?.getTestLocators ? selectorUtils.getTestLocators(target) : null;
      const selector = locators?.selector || getElementSelector(target);
      const label = (locators?.accessibleName || "").slice(0, 40);

      let displayVal = "";
      if (type === "checkbox" || type === "radio") {
        displayVal = target.checked ? "checked" : "unchecked";
      } else if (isSensitive) {
        displayVal = "[REDACTED]";
      } else {
        const rawText = isEditable ? (target.innerText || target.textContent || "") : (target.value || "");
        displayVal = String(rawText).replace(/\s+/g, " ").slice(0, 80);
      }

      // Do not record empty value events (e.g. when a chat box clears its textarea right after pressing Enter)
      if (!displayVal && type !== "checkbox" && type !== "radio") {
        return;
      }

      const verb = tag === "select" ? "Chọn" : (type === "checkbox" || type === "radio" ? "Đánh dấu" : "Nhập");
      recordReproStep({
        action: tag === "select" ? "select" : "type",
        tagName: tag,
        selector,
        playwrightLocator: locators?.playwrightLocator || undefined,
        label: label || undefined,
        value: displayVal,
        description: `${verb} "${displayVal}" vào <${tag}>${label ? ` "${label}"` : ""} (\`${selector}\`)`
      });
    } catch (err) {
      if (window.__AP_DEBUG__) console.debug("[AgentPilot] Flow field value listener error:", err);
    }
  }

  document.addEventListener("input", (e) => {
    if (!isRecordableInteractionEvent(e) || isOverlayModeBusy() || isInternalAgentPilotNode(e.target)) return;
    if (window.__AP_INTERNAL__.shield?.isDispatching?.()) {
      handleFieldValueEvent(e);
      return;
    }
    pendingInputTarget = e.target;
    if (inputDebounceTimer) clearTimeout(inputDebounceTimer);
    inputDebounceTimer = setTimeout(() => {
      inputDebounceTimer = null;
      const target = pendingInputTarget;
      pendingInputTarget = null;
      if (target) {
        handleFieldValueEvent({ type: "input", target, isTrusted: true });
      }
    }, 250);
  }, true);

  document.addEventListener("change", (e) => {
    if (inputDebounceTimer && pendingInputTarget === e.target) {
      clearTimeout(inputDebounceTimer);
      inputDebounceTimer = null;
      pendingInputTarget = null;
    }
    handleFieldValueEvent(e);
  }, true);

  document.addEventListener("keydown", (e) => {
    try {
      if (!isRecordableInteractionEvent(e) || e.key !== "Enter" || e.shiftKey || e.isComposing || isOverlayModeBusy() || isInternalAgentPilotNode(e.target)) return;
      const target = e.target;
      if (!target || !target.tagName) return;
      const tag = target.tagName.toLowerCase();
      if (tag !== "input" && tag !== "textarea" && !target.isContentEditable) return;

      if (inputDebounceTimer) {
        clearTimeout(inputDebounceTimer);
        inputDebounceTimer = null;
        pendingInputTarget = null;
      }

      // Ensure any pending non-empty text in the input/textarea is recorded before Enter clears it
      const rawText = target.isContentEditable ? (target.innerText || target.textContent || "") : (target.value || "");
      if (String(rawText).trim()) {
        handleFieldValueEvent({ type: "change", target, isTrusted: true });
      }

      const locators = selectorUtils?.getTestLocators ? selectorUtils.getTestLocators(target) : null;
      const selector = locators?.selector || getElementSelector(target);
      const label = (locators?.accessibleName || "").slice(0, 40);
      recordReproStep({
        action: "press_key",
        tagName: tag,
        selector,
        playwrightLocator: locators?.playwrightLocator || undefined,
        label: label || undefined,
        key: "Enter",
        description: `Nhấn phím Enter tại <${tag}>${label ? ` "${label}"` : ""} (\`${selector}\`)`
      });
    } catch (err) {
      if (window.__AP_DEBUG__) console.debug("[AgentPilot] Flow keydown listener error:", err);
    }
  }, true);

  function getReproSteps() {
    return reproSteps.slice();
  }

  function clearReproSteps() {
    reproSteps.length = 0;
    try {
      chrome.runtime.sendMessage({ action: "clear_flow_steps" }).catch(() => {});
    } catch (_) {}
  }

  function exportReproBatchJson() {
    const actions = reproSteps.map((step) => {
      if (step.action === "navigate") {
        return {
          action: "navigate",
          url: step.url
        };
      }
      if (step.action === "type" || step.action === "select") {
        return {
          action: "type",
          selector: step.selector,
          text: step.value === "[REDACTED]" ? "<SENSITIVE_VALUE>" : (step.value || ""),
          clear: true
        };
      }
      if (step.action === "press_key") {
        return {
          action: "press_key",
          selector: step.selector,
          key: step.key || "Enter"
        };
      }
      return {
        action: "click",
        selector: step.selector
      };
    });
    return {
      url: window.location.href,
      title: document.title,
      generatedAt: new Date().toISOString(),
      actions
    };
  }

  async function fetchPersistentFlowSteps() {
    try {
      const res = await chrome.runtime.sendMessage({ action: "get_flow_recorder_state" });
      if (res && res.success && Array.isArray(res.steps) && res.steps.length > 0) {
        return res.steps;
      }
    } catch (_) {}
    return getReproSteps();
  }

  function queryPageDiagnostics({ clear = false, clearStorage = false } = {}) {
    return new Promise((resolve) => {
      const reqId = "diag_" + Math.random().toString(36).slice(2, 10);
      const environment = {
        viewport: `${window.innerWidth}×${window.innerHeight}`,
        devicePixelRatio: window.devicePixelRatio || 1,
        userAgent: navigator.userAgent,
        language: navigator.language || "vi-VN",
        url: window.location.href,
        timestamp: new Date().toISOString()
      };

      const finish = async (consoleErrors, networkErrors, clearedStorage) => {
        const stepsSnapshot = await fetchPersistentFlowSteps();
        if (clear || clearStorage) clearReproSteps();
        resolve({
          environment,
          consoleErrors,
          networkErrors,
          reproSteps: stepsSnapshot,
          clearedStorage
        });
      };

      const timeout = setTimeout(() => {
        window.removeEventListener("__AP_DIAGNOSTICS_RESP__", onResp);
        finish([], [], null);
      }, 250);

      function onResp(e) {
        if (e.detail && e.detail.reqId === reqId) {
          clearTimeout(timeout);
          window.removeEventListener("__AP_DIAGNOSTICS_RESP__", onResp);
          finish(
            Array.isArray(e.detail.consoleErrors) ? e.detail.consoleErrors : [],
            Array.isArray(e.detail.networkErrors) ? e.detail.networkErrors : [],
            e.detail.clearedStorage || null
          );
        }
      }

      window.addEventListener("__AP_DIAGNOSTICS_RESP__", onResp);
      window.dispatchEvent(new CustomEvent("__AP_DIAGNOSTICS_REQ__", {
        detail: { reqId, clear, clearStorage }
      }));
    });
  }

  window.__AP_INTERNAL__.inspector = {
    toggleInspector,
    isInspectorActive: () => isInspectorActive,
    getDetailedElementInfo,
    getInteractiveSnapshot,
    getElementSelector,
    getXPath,
    getLockedElement: () => (lockedElement ? getDetailedElementInfo(lockedElement, true) : null),
    startRegionCrop,
    startElementSnap,
    stopElementSnap,
    isElementSnapActive: () => isElementSnapActive,
    getReproSteps,
    clearReproSteps,
    exportReproBatchJson,
    queryPageDiagnostics
  };
})();
