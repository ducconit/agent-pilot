/**
 * Agent Pilot - Feedback Studio Selection Modes
 * Element inspection, Region drag-crop, Screen Viewport, and Full Page capture modes.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};
  window.__AP_INTERNAL__.feedbackStudio = window.__AP_INTERNAL__.feedbackStudio || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.fsSelection) return;
  window.__AP_INTERNAL__.__guards.fsSelection = true;

  const constants = window.__AP_INTERNAL__.feedbackStudio.constants || {};
  const showToast = constants.showToast || (() => {});
  const escapeHtml = constants.escapeHtml || ((s) => s);

  // =========================================================================
  // DOM Elements Setup (Highlighter, Tooltip, Crop Overlay)
  // =========================================================================

  // 1. Element Highlighter Box & Tooltip
  const highlighter = document.createElement("div");
  highlighter.id = "agent-pilot-feedback-highlighter";
  highlighter.className = "agent-pilot-feedback-highlighter hidden";
  document.documentElement.appendChild(highlighter);

  const elementTooltip = document.createElement("div");
  elementTooltip.id = "agent-pilot-feedback-tooltip";
  elementTooltip.className = "agent-pilot-feedback-tooltip hidden";
  document.documentElement.appendChild(elementTooltip);

  // 2. Region Crop Overlay & Box
  const cropOverlay = document.createElement("div");
  cropOverlay.id = "agent-pilot-feedback-crop-overlay";
  cropOverlay.className = "agent-pilot-feedback-crop-overlay hidden";
  cropOverlay.innerHTML = `
    <div class="ap-crop-hint">Kéo chuột để chọn vùng cần sửa • Nhấn Esc để hủy</div>
    <div class="ap-crop-box" id="ap-feedback-crop-box"></div>
  `;
  document.documentElement.appendChild(cropOverlay);
  const cropBox = cropOverlay.querySelector("#ap-feedback-crop-box");

  // =========================================================================
  // Mode Controller
  // =========================================================================

  function setMode(mode) {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    if (state) state.setMode(mode);

    const hud = window.__AP_INTERNAL__.feedbackStudio.hud;
    if (hud) hud.setMode(mode);

    hideHighlighter();
    cropOverlay.classList.add("hidden");

    if (mode === "region") {
      cropOverlay.classList.remove("hidden");
    } else if (mode === "screen") {
      triggerScreenCapture();
    } else if (mode === "fullpage") {
      triggerFullPageCapture();
    }
  }

  // =========================================================================
  // Mode 1: Element Selection Mode
  // =========================================================================

  function onElementMouseMove(e) {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    if (!state || !state.isActive() || state.getMode() !== "element") return;

    if (e.target.closest("#agent-pilot-feedback-hud") ||
        e.target.closest("#agent-pilot-feedback-popover") ||
        e.target.closest("#agent-pilot-feedback-annotator") ||
        e.target.closest("#agent-pilot-feedback-list-modal") ||
        e.target.closest("#agent-pilot-feedback-pinned-layer")) {
      hideHighlighter();
      return;
    }

    const target = e.target;
    if (target === document.body || target === document.documentElement) {
      hideHighlighter();
      return;
    }

    state.setHoveredElement(target);
    const rect = target.getBoundingClientRect();

    highlighter.style.left = `${rect.left}px`;
    highlighter.style.top = `${rect.top}px`;
    highlighter.style.width = `${rect.width}px`;
    highlighter.style.height = `${rect.height}px`;
    highlighter.classList.remove("hidden");

    let tagInfo = target.tagName.toLowerCase();
    if (target.id) tagInfo += `#${target.id}`;
    else if (target.className && typeof target.className === "string") {
      const cls = target.className.trim().split(/\s+/).filter((c) => !c.startsWith("agent-pilot")).slice(0, 2);
      if (cls.length) tagInfo += `.${cls.join(".")}`;
    }

    elementTooltip.textContent = `🎯 Click để chọn: <${tagInfo}>`;
    elementTooltip.style.left = `${Math.max(10, Math.min(window.innerWidth - 220, rect.left))}px`;
    elementTooltip.style.top = `${Math.max(10, rect.top - 28)}px`;
    elementTooltip.classList.remove("hidden");
  }

  async function onElementClick(e) {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    if (!state || !state.isActive() || state.getMode() !== "element") return;

    if (e.target.closest("#agent-pilot-feedback-hud") ||
        e.target.closest("#agent-pilot-feedback-popover") ||
        e.target.closest("#agent-pilot-feedback-annotator") ||
        e.target.closest("#agent-pilot-feedback-list-modal") ||
        e.target.closest("#agent-pilot-feedback-pinned-layer")) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const target = state.getHoveredElement() || e.target;
    if (!target) return;

    hideHighlighter();

    const rect = target.getBoundingClientRect();
    const clip = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      pageX: Math.round(rect.left + window.scrollX),
      pageY: Math.round(rect.top + window.scrollY),
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      width: Math.max(10, Math.round(rect.width)),
      height: Math.max(10, Math.round(rect.height)),
      pageWidth: window.innerWidth,
      pageHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    };

    // 1. Inspect DOM & Framework Source
    const detailedInfo = window.__AP_INTERNAL__.inspector?.getDetailedElementInfo
      ? window.__AP_INTERNAL__.inspector.getDetailedElementInfo(target)
      : {
          tagName: target.tagName.toLowerCase(),
          selector: target.tagName.toLowerCase() + (target.id ? `#${target.id}` : ""),
          xpath: "",
          text: (target.innerText || "").slice(0, 200)
        };

    const captureService = window.__AP_INTERNAL__.feedbackStudio.capture;
    const pinned = window.__AP_INTERNAL__.feedbackStudio.pinned;
    const modals = window.__AP_INTERNAL__.feedbackStudio.modals;

    const componentSource = captureService?.queryFrameworkSource ? await captureService.queryFrameworkSource(target) : null;

    // 2. Capture Screenshot & Crop
    try {
      showToast("📸 Đang chụp ảnh phần tử...");
      const items = state.getItems();
      if (pinned?.showDraftBox) {
        pinned.showDraftBox(clip, items.length + 1);
      }

      const fullShot = await captureService.requestCapture("visible");
      const croppedShot = await captureService.cropDataUrl(fullShot, clip);

      const pendingCapture = {
        mode: "element",
        title: `<${detailedInfo.tagName}${detailedInfo.id ? `#${detailedInfo.id}` : ""}>`,
        dom: detailedInfo,
        component: componentSource,
        clip,
        screenshotDataUrl: croppedShot
      };

      if (modals?.openCommentPopover) {
        modals.openCommentPopover(pendingCapture, rect);
      }
    } catch (err) {
      if (pinned?.hideDraftBox) pinned.hideDraftBox();
      showToast("❌ Lỗi chụp ảnh: " + escapeHtml(err.message));
    }
  }

  function hideHighlighter() {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    if (state) state.setHoveredElement(null);
    highlighter.classList.add("hidden");
    elementTooltip.classList.add("hidden");
  }

  // =========================================================================
  // Mode 2: Region Crop Mode
  // =========================================================================

  function onCropMouseDown(e) {
    if (e.target.closest("#agent-pilot-feedback-hud")) return;
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    if (!state) return;

    state.setCropState({
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      currentRect: null
    });

    cropBox.style.display = "block";
    cropBox.style.left = `${e.clientX}px`;
    cropBox.style.top = `${e.clientY}px`;
    cropBox.style.width = "0px";
    cropBox.style.height = "0px";
  }

  function onCropMouseMove(e) {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    if (!state) return;
    const cropState = state.getCropState();
    if (!cropState.dragging) return;

    const x = Math.min(cropState.startX, e.clientX);
    const y = Math.min(cropState.startY, e.clientY);
    const w = Math.abs(e.clientX - cropState.startX);
    const h = Math.abs(e.clientY - cropState.startY);

    cropBox.style.left = `${x}px`;
    cropBox.style.top = `${y}px`;
    cropBox.style.width = `${w}px`;
    cropBox.style.height = `${h}px`;
    state.setCropState({ currentRect: { x, y, width: w, height: h } });
  }

  async function onCropMouseUp() {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    if (!state) return;
    const cropState = state.getCropState();
    if (!cropState.dragging) return;

    state.setCropState({ dragging: false });
    const rect = cropState.currentRect;
    cropBox.style.display = "none";

    if (!rect || rect.width < 15 || rect.height < 15) {
      showToast("⚠️ Vùng chọn quá nhỏ, vui lòng kéo lại.");
      return;
    }

    const clip = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      pageX: Math.round(rect.x + window.scrollX),
      pageY: Math.round(rect.y + window.scrollY),
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      pageWidth: window.innerWidth,
      pageHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    };

    const captureService = window.__AP_INTERNAL__.feedbackStudio.capture;
    const pinned = window.__AP_INTERNAL__.feedbackStudio.pinned;
    const modals = window.__AP_INTERNAL__.feedbackStudio.modals;

    try {
      showToast("📸 Đang cắt vùng chọn...");
      const items = state.getItems();
      if (pinned?.showDraftBox) {
        pinned.showDraftBox(clip, items.length + 1);
      }

      const fullShot = await captureService.requestCapture("visible");
      const croppedShot = await captureService.cropDataUrl(fullShot, clip);

      const pendingCapture = {
        mode: "region",
        title: `Vùng chọn (${clip.width}×${clip.height}px)`,
        dom: null,
        component: null,
        clip,
        screenshotDataUrl: croppedShot
      };

      if (modals?.openCommentPopover) {
        modals.openCommentPopover(pendingCapture, rect);
      }
    } catch (err) {
      if (pinned?.hideDraftBox) pinned.hideDraftBox();
      showToast("❌ Lỗi chụp vùng chọn: " + escapeHtml(err.message));
    }
  }

  // =========================================================================
  // Mode 3: Screen Viewport & Mode 4: Full Page Modes
  // =========================================================================

  async function triggerScreenCapture() {
    const captureService = window.__AP_INTERNAL__.feedbackStudio.capture;
    const modals = window.__AP_INTERNAL__.feedbackStudio.modals;
    try {
      showToast("📸 Đang chụp màn hình hiển thị...");
      const shot = await captureService.requestCapture("visible");
      if (modals?.openAnnotatorModal) {
        modals.openAnnotatorModal("screen", "Toàn màn hình (Viewport)", shot);
      }
    } catch (err) {
      showToast("❌ Lỗi chụp màn hình: " + escapeHtml(err.message));
    }
  }

  async function triggerFullPageCapture() {
    const captureService = window.__AP_INTERNAL__.feedbackStudio.capture;
    const modals = window.__AP_INTERNAL__.feedbackStudio.modals;
    try {
      showToast("📸 Đang chụp toàn bộ trang web (Full Page)...");
      const shot = await captureService.requestCapture("fullpage");
      if (modals?.openAnnotatorModal) {
        modals.openAnnotatorModal("fullpage", "Toàn bộ trang web (Full Page)", shot);
      }
    } catch (err) {
      showToast("❌ Lỗi chụp toàn trang: " + escapeHtml(err.message));
    }
  }

  // =========================================================================
  // Event Listeners Lifecycle
  // =========================================================================

  function attachSelectionListeners() {
    document.addEventListener("mousemove", onElementMouseMove, true);
    document.addEventListener("click", onElementClick, true);
    cropOverlay.addEventListener("mousedown", onCropMouseDown);
    cropOverlay.addEventListener("mousemove", onCropMouseMove);
    cropOverlay.addEventListener("mouseup", onCropMouseUp);
  }

  function detachSelectionListeners() {
    document.removeEventListener("mousemove", onElementMouseMove, true);
    document.removeEventListener("click", onElementClick, true);
    cropOverlay.removeEventListener("mousedown", onCropMouseDown);
    cropOverlay.removeEventListener("mousemove", onCropMouseMove);
    cropOverlay.removeEventListener("mouseup", onCropMouseUp);
  }

  window.__AP_INTERNAL__.feedbackStudio.selection = {
    highlighter,
    elementTooltip,
    cropOverlay,
    setMode,
    hideHighlighter,
    attachSelectionListeners,
    detachSelectionListeners,
    triggerScreenCapture,
    triggerFullPageCapture
  };
})();
