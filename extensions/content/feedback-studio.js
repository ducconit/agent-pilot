/**
 * Agent Pilot - Feedback Studio Module
 * Interactive visual feedback suite with multi-mode selection (Element, Region, Screen, Full Page),
 * React/Vue/Astro component source detection, visual annotations, and Channel C clipboard export.
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

  // State
  let isFeedbackActive = false;
  let currentMode = "element"; // "element" | "region" | "screen" | "fullpage"
  let feedbackItems = []; // List of collected feedback items
  let hoveredElement = null;
  let cropState = { dragging: false, startX: 0, startY: 0, currentRect: null };
  let pendingCapture = null;

  // Visual Palette for Pinned Regions & Feedback Badges
  const PIN_COLORS = [
    { color: "#38bdf8", bg: "rgba(56, 189, 248, 0.12)", glow: "rgba(56, 189, 248, 0.3)" }, // Sky Blue
    { color: "#f59e0b", bg: "rgba(245, 158, 11, 0.12)", glow: "rgba(245, 158, 11, 0.3)" }, // Amber
    { color: "#10b981", bg: "rgba(16, 185, 129, 0.12)", glow: "rgba(16, 185, 129, 0.3)" }, // Emerald
    { color: "#a855f7", bg: "rgba(168, 85, 247, 0.12)", glow: "rgba(168, 85, 247, 0.3)" }, // Purple
    { color: "#f43f5e", bg: "rgba(244, 63, 94, 0.12)", glow: "rgba(244, 63, 94, 0.3)" },   // Rose
    { color: "#06b6d4", bg: "rgba(6, 182, 212, 0.12)", glow: "rgba(6, 182, 212, 0.3)" },   // Cyan
    { color: "#ec4899", bg: "rgba(236, 72, 153, 0.12)", glow: "rgba(236, 72, 153, 0.3)" }, // Pink
    { color: "#84cc16", bg: "rgba(132, 204, 22, 0.12)", glow: "rgba(132, 204, 22, 0.3)" }  // Lime
  ];

  // =========================================================================
  // DOM Elements Setup (HUD, Highlighter, Overlay, Popover, Modals)
  // =========================================================================

  // 1. Floating HUD Toolbar
  const hud = document.createElement("div");
  hud.id = "agent-pilot-feedback-hud";
  hud.className = "agent-pilot-feedback-hud hidden";
  hud.innerHTML = `
    <div class="ap-hud-drag-handle">
      <span class="ap-hud-badge">✏️ CHÚ THÍCH UI</span>
      <span class="ap-hud-status" id="ap-hud-item-count">0 vị trí</span>
    </div>
    <div class="ap-hud-modes">
      <button class="ap-hud-btn active" data-mode="element" title="Chọn phần tử DOM (E)">🎯 Phần tử</button>
      <button class="ap-hud-btn" data-mode="region" title="Kéo chọn một vùng (R)">⬚ Vùng chọn</button>
      <button class="ap-hud-btn" data-mode="screen" title="Chụp toàn màn hình hiển thị (S)">🖥️ Màn hình</button>
      <button class="ap-hud-btn" data-mode="fullpage" title="Chụp toàn bộ trang web dài (P)">📄 Toàn trang</button>
    </div>
    <div class="ap-hud-divider"></div>
    <div class="ap-hud-actions">
      <button class="ap-hud-action-btn" id="ap-hud-btn-list" title="Xem danh sách các vị trí đã chọn">📋 Danh sách (<span id="ap-hud-list-count">0</span>)</button>
      <button class="ap-hud-action-btn ap-btn-highlight" id="ap-hud-btn-copy" title="Copy toàn bộ chú thích dạng Markdown để gửi Agent (Kênh C)">📋 Copy Prompt</button>
      <button class="ap-hud-action-btn ap-btn-save" id="ap-hud-btn-inbox" title="Lưu vào Inbox của Agent (Kênh B)">💾 Lưu Inbox</button>
      <button class="ap-hud-action-btn ap-btn-send" id="ap-hud-btn-send" title="Gửi trực tiếp cho Agent qua cổng 58765 (Kênh A)">🚀 Gửi Agent</button>
      <button class="ap-hud-close-btn" id="ap-hud-btn-close" title="Thoát chế độ chú thích UI">✕ Thoát</button>
    </div>
  `;
  document.documentElement.appendChild(hud);

  // 2. Element Highlighter Box & Tooltip
  const highlighter = document.createElement("div");
  highlighter.id = "agent-pilot-feedback-highlighter";
  highlighter.className = "agent-pilot-feedback-highlighter hidden";
  document.documentElement.appendChild(highlighter);

  const elementTooltip = document.createElement("div");
  elementTooltip.id = "agent-pilot-feedback-tooltip";
  elementTooltip.className = "agent-pilot-feedback-tooltip hidden";
  document.documentElement.appendChild(elementTooltip);

  // 3. Region Crop Overlay
  const cropOverlay = document.createElement("div");
  cropOverlay.id = "agent-pilot-feedback-crop-overlay";
  cropOverlay.className = "agent-pilot-feedback-crop-overlay hidden";
  cropOverlay.innerHTML = `
    <div class="ap-crop-hint">Kéo chuột để chọn vùng cần sửa • Nhấn Esc để hủy</div>
    <div class="ap-crop-box" id="ap-feedback-crop-box"></div>
  `;
  document.documentElement.appendChild(cropOverlay);
  const cropBox = cropOverlay.querySelector("#ap-feedback-crop-box");

  // 3b. Pinned Visual Layer & Active Draft Highlight
  const pinnedLayer = document.createElement("div");
  pinnedLayer.id = "agent-pilot-feedback-pinned-layer";
  pinnedLayer.className = "agent-pilot-feedback-pinned-layer hidden";
  document.documentElement.appendChild(pinnedLayer);

  const draftBox = document.createElement("div");
  draftBox.id = "agent-pilot-feedback-draft-box";
  draftBox.className = "ap-pinned-box draft hidden";
  draftBox.innerHTML = `<span class="ap-pinned-badge" id="ap-draft-badge">Đang soạn...</span>`;
  pinnedLayer.appendChild(draftBox);

  // 4. Quick Comment Popover (for Element & Region)
  const commentPopover = document.createElement("div");
  commentPopover.id = "agent-pilot-feedback-popover";
  commentPopover.className = "agent-pilot-feedback-popover hidden";
  commentPopover.innerHTML = `
    <div class="ap-popover-header" title="Nhấp giữ và kéo để di chuyển tự do">
      <div class="ap-popover-title-row">
        <span class="ap-popover-drag-icon">⋮⋮</span>
        <span class="ap-popover-icon">💬</span>
        <span class="ap-popover-title" id="ap-popover-title">Ghi chú sửa giao diện</span>
      </div>
      <button class="ap-popover-close" id="ap-popover-btn-close" title="Đóng">✕</button>
    </div>
    <div class="ap-popover-body">
      <div class="ap-popover-preview">
        <img id="ap-popover-img" class="ap-popover-thumb" alt="Preview">
        <div class="ap-popover-meta" id="ap-popover-meta"></div>
      </div>
      <textarea id="ap-popover-input" class="ap-popover-textarea" placeholder="Nhập yêu cầu sửa giao diện (vd: đổi màu nút, thu nhỏ padding, sửa căn lề, thay đổi text...)" rows="3"></textarea>
    </div>
    <div class="ap-popover-footer">
      <button class="ap-popover-btn ap-btn-cancel" id="ap-popover-btn-cancel">Hủy</button>
      <button class="ap-popover-btn ap-btn-submit" id="ap-popover-btn-save">✓ Lưu Chú Thích</button>
    </div>
  `;
  document.documentElement.appendChild(commentPopover);

  // 5. Annotator Modal (for Screen & Full Page)
  const annotatorModal = document.createElement("div");
  annotatorModal.id = "agent-pilot-feedback-annotator";
  annotatorModal.className = "agent-pilot-feedback-annotator hidden";
  annotatorModal.innerHTML = `
    <div class="ap-annotator-backdrop"></div>
    <div class="ap-annotator-dialog">
      <div class="ap-annotator-header">
        <div class="ap-annotator-title-row">
          <span class="ap-annotator-icon">🖌️</span>
          <span class="ap-annotator-title" id="ap-annotator-title">Khoanh vùng & Ghi chú</span>
        </div>
        <div class="ap-annotator-tools">
          <button class="ap-tool-btn active" id="ap-tool-pin" title="Ghim điểm đánh dấu">📍 Ghim điểm</button>
          <button class="ap-tool-btn" id="ap-tool-box" title="Vẽ khung chữ nhật">⬜ Khung</button>
          <button class="ap-tool-btn" id="ap-tool-clear" title="Xóa các dấu đã vẽ">🗑️ Xóa dấu</button>
        </div>
        <button class="ap-popover-close" id="ap-annotator-btn-close">✕</button>
      </div>
      <div class="ap-annotator-body">
        <div class="ap-canvas-wrapper" id="ap-canvas-wrapper">
          <img id="ap-annotator-img" class="ap-annotator-img" alt="Captured Screen">
          <svg id="ap-annotator-svg" class="ap-annotator-svg"></svg>
        </div>
        <div class="ap-annotator-sidebar">
          <label class="ap-sidebar-label">Ghi chú cho ảnh chụp này:</label>
          <textarea id="ap-annotator-comment" class="ap-annotator-textarea" placeholder="Nhập yêu cầu sửa đổi tổng quát hoặc mô tả các điểm đã đánh dấu..." rows="5"></textarea>
          <div class="ap-pins-list" id="ap-pins-list"></div>
        </div>
      </div>
      <div class="ap-annotator-footer">
        <button class="ap-popover-btn ap-btn-cancel" id="ap-annotator-btn-cancel">Hủy bỏ</button>
        <button class="ap-popover-btn ap-btn-submit" id="ap-annotator-btn-save">✓ Lưu Chú Thích Này</button>
      </div>
    </div>
  `;
  document.documentElement.appendChild(annotatorModal);

  // 6. Feedback Items List Modal (Review, Edit, Delete)
  const listModal = document.createElement("div");
  listModal.id = "agent-pilot-feedback-list-modal";
  listModal.className = "agent-pilot-feedback-list-modal hidden";
  listModal.innerHTML = `
    <div class="ap-list-backdrop"></div>
    <div class="ap-list-dialog">
      <div class="ap-list-header">
        <div class="ap-list-title-row">
          <span class="ap-list-icon">📋</span>
          <span class="ap-list-title">Danh sách vị trí cần sửa (<span id="ap-list-total-count">0</span>)</span>
        </div>
        <button class="ap-popover-close" id="ap-list-btn-close">✕</button>
      </div>
      <div class="ap-list-body" id="ap-list-items-container">
        <!-- Dynamic items rendered here -->
      </div>
      <div class="ap-list-footer">
        <button class="ap-popover-btn ap-btn-danger" id="ap-list-btn-clear-all">🗑️ Xóa tất cả</button>
        <div style="display:flex;gap:8px;">
          <button class="ap-popover-btn ap-btn-cancel" id="ap-list-btn-back">Đóng</button>
          <button class="ap-popover-btn ap-btn-submit" id="ap-list-btn-copy-all">📋 Copy Prompt cho Agent</button>
        </div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(listModal);

  // =========================================================================
  // Framework Component Source Query (Bridge to Main World)
  // =========================================================================

  function queryFrameworkSource(element) {
    return new Promise((resolve) => {
      if (!element || !(element instanceof Element)) {
        return resolve(null);
      }
      const reqId = "req_" + Math.random().toString(36).substr(2, 9);
      element.setAttribute("data-ap-inspect-target", reqId);

      const timeout = setTimeout(() => {
        window.removeEventListener("__AP_INSPECT_SOURCE_RESP__", onResp);
        element.removeAttribute("data-ap-inspect-target");
        resolve(null);
      }, 250);

      function onResp(e) {
        if (e.detail && e.detail.reqId === reqId) {
          clearTimeout(timeout);
          window.removeEventListener("__AP_INSPECT_SOURCE_RESP__", onResp);
          resolve(e.detail.source || null);
        }
      }

      window.addEventListener("__AP_INSPECT_SOURCE_RESP__", onResp);
      window.dispatchEvent(new CustomEvent("__AP_INSPECT_SOURCE_REQ__", { detail: { reqId } }));
    });
  }

  // =========================================================================
  // Canvas Image Cropping & Annotation Helpers
  // =========================================================================

  function cropDataUrl(fullDataUrl, clip) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const dpr = clip.devicePixelRatio || (img.naturalWidth / (clip.pageWidth || window.innerWidth)) || window.devicePixelRatio || 1;
        const padding = 10; // Extra context margin around element
        const rawX = Math.max(0, clip.x - padding);
        const rawY = Math.max(0, clip.y - padding);
        const rawW = clip.width + (padding * 2);
        const rawH = clip.height + (padding * 2);

        const sx = Math.max(0, Math.min(img.naturalWidth, Math.round(rawX * dpr)));
        const sy = Math.max(0, Math.min(img.naturalHeight, Math.round(rawY * dpr)));
        const sw = Math.min(img.naturalWidth - sx, Math.round(rawW * dpr));
        const sh = Math.min(img.naturalHeight - sy, Math.round(rawH * dpr));

        if (sw <= 0 || sh <= 0) {
          return resolve(fullDataUrl);
        }

        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

        // Optional subtle highlight frame on cropped element
        ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
        ctx.lineWidth = Math.max(2, Math.round(2 * dpr));
        ctx.strokeRect(
          Math.round(padding * dpr),
          Math.round(padding * dpr),
          Math.round(clip.width * dpr),
          Math.round(clip.height * dpr)
        );

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve(fullDataUrl);
      img.src = fullDataUrl;
    });
  }

  function requestCapture(mode = "visible", clip = null) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "capture_screenshot", mode, clip }, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.success && response.dataUrl) {
          resolve(response.dataUrl);
        } else {
          reject(new Error(response?.error || "Không thể chụp màn hình"));
        }
      });
    });
  }

  // =========================================================================
  // HUD Controls & Mode Switching
  // =========================================================================

  function updateHudCounters() {
    const count = feedbackItems.length;
    const text = `${count} mục`;
    document.getElementById("ap-hud-item-count").textContent = text;
    document.getElementById("ap-hud-list-count").textContent = String(count);
    document.getElementById("ap-list-total-count").textContent = String(count);

    // Sync with side panel
    chrome.runtime.sendMessage({
      action: "FEEDBACK_ITEMS_UPDATED",
      count,
      items: feedbackItems.map(item => ({
        id: item.id,
        mode: item.mode,
        title: item.title,
        comment: item.comment,
        component: item.component,
        timestamp: item.timestamp
      }))
    }).catch(() => {});
  }

  function setMode(mode) {
    currentMode = mode;
    hud.querySelectorAll(".ap-hud-btn").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
    });

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
  // Selection Logic: 1. Element Mode
  // =========================================================================

  function onElementMouseMove(e) {
    if (!isFeedbackActive || currentMode !== "element") return;
    if (e.target.closest("#agent-pilot-feedback-hud") ||
        e.target.closest("#agent-pilot-feedback-popover") ||
        e.target.closest("#agent-pilot-feedback-annotator") ||
        e.target.closest("#agent-pilot-feedback-list-modal")) {
      hideHighlighter();
      return;
    }

    const target = e.target;
    if (target === document.body || target === document.documentElement) {
      hideHighlighter();
      return;
    }

    hoveredElement = target;
    const rect = target.getBoundingClientRect();

    highlighter.style.left = `${rect.left}px`;
    highlighter.style.top = `${rect.top}px`;
    highlighter.style.width = `${rect.width}px`;
    highlighter.style.height = `${rect.height}px`;
    highlighter.classList.remove("hidden");

    let tagInfo = target.tagName.toLowerCase();
    if (target.id) tagInfo += `#${target.id}`;
    else if (target.className && typeof target.className === "string") {
      const cls = target.className.trim().split(/\s+/).filter(c => !c.startsWith("agent-pilot")).slice(0, 2);
      if (cls.length) tagInfo += `.${cls.join(".")}`;
    }

    elementTooltip.textContent = `🎯 Click để chọn: <${tagInfo}>`;
    elementTooltip.style.left = `${Math.max(10, Math.min(window.innerWidth - 220, rect.left))}px`;
    elementTooltip.style.top = `${Math.max(10, rect.top - 28)}px`;
    elementTooltip.classList.remove("hidden");
  }

  async function onElementClick(e) {
    if (!isFeedbackActive || currentMode !== "element") return;
    if (e.target.closest("#agent-pilot-feedback-hud") ||
        e.target.closest("#agent-pilot-feedback-popover") ||
        e.target.closest("#agent-pilot-feedback-annotator") ||
        e.target.closest("#agent-pilot-feedback-list-modal")) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const target = hoveredElement || e.target;
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

    const componentSource = await queryFrameworkSource(target);

    // 2. Capture Screenshot & Crop
    try {
      showToast("📸 Đang chụp ảnh phần tử...");
      showDraftBox(clip, feedbackItems.length + 1);
      const fullShot = await requestCapture("visible");
      const croppedShot = await cropDataUrl(fullShot, clip);

      pendingCapture = {
        mode: "element",
        title: `<${detailedInfo.tagName}${detailedInfo.id ? `#${detailedInfo.id}` : ""}>`,
        dom: detailedInfo,
        component: componentSource,
        clip,
        screenshotDataUrl: croppedShot
      };

      openCommentPopover(pendingCapture, rect);
    } catch (err) {
      hideDraftBox();
      showToast("❌ Lỗi chụp ảnh: " + err.message);
    }
  }

  function hideHighlighter() {
    hoveredElement = null;
    highlighter.classList.add("hidden");
    elementTooltip.classList.add("hidden");
  }

  // =========================================================================
  // Selection Logic: 2. Region Crop Mode
  // =========================================================================

  function onCropMouseDown(e) {
    if (e.target.closest("#agent-pilot-feedback-hud")) return;
    cropState.dragging = true;
    cropState.startX = e.clientX;
    cropState.startY = e.clientY;
    cropBox.style.display = "block";
    cropBox.style.left = `${e.clientX}px`;
    cropBox.style.top = `${e.clientY}px`;
    cropBox.style.width = "0px";
    cropBox.style.height = "0px";
  }

  function onCropMouseMove(e) {
    if (!cropState.dragging) return;
    const x = Math.min(cropState.startX, e.clientX);
    const y = Math.min(cropState.startY, e.clientY);
    const w = Math.abs(e.clientX - cropState.startX);
    const h = Math.abs(e.clientY - cropState.startY);

    cropBox.style.left = `${x}px`;
    cropBox.style.top = `${y}px`;
    cropBox.style.width = `${w}px`;
    cropBox.style.height = `${h}px`;
    cropState.currentRect = { x, y, width: w, height: h };
  }

  async function onCropMouseUp(e) {
    if (!cropState.dragging) return;
    cropState.dragging = false;

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

    try {
      showToast("📸 Đang cắt vùng chọn...");
      showDraftBox(clip, feedbackItems.length + 1);
      const fullShot = await requestCapture("visible");
      const croppedShot = await cropDataUrl(fullShot, clip);

      pendingCapture = {
        mode: "region",
        title: `Vùng chọn (${clip.width}×${clip.height}px)`,
        dom: null,
        component: null,
        clip,
        screenshotDataUrl: croppedShot
      };

      openCommentPopover(pendingCapture, rect);
    } catch (err) {
      hideDraftBox();
      showToast("❌ Lỗi chụp vùng chọn: " + err.message);
    }
  }

  // =========================================================================
  // Selection Logic: 3. Screen Viewport Mode & 4. Full Page Mode
  // =========================================================================

  async function triggerScreenCapture() {
    try {
      showToast("📸 Đang chụp màn hình hiển thị...");
      const shot = await requestCapture("visible");
      openAnnotatorModal("screen", "Toàn màn hình (Viewport)", shot);
    } catch (err) {
      showToast("❌ Lỗi chụp màn hình: " + err.message);
    }
  }

  async function triggerFullPageCapture() {
    try {
      showToast("📸 Đang chụp toàn bộ trang web (Full Page)...");
      const shot = await requestCapture("fullpage");
      openAnnotatorModal("fullpage", "Toàn bộ trang web (Full Page)", shot);
    } catch (err) {
      showToast("❌ Lỗi chụp toàn trang: " + err.message);
    }
  }

  // =========================================================================
  // Pinned Regions & Active Draft Highlight Layer
  // =========================================================================

  function showDraftBox(clip, itemNumber) {
    if (!clip) return;
    const pageX = (clip.pageX !== undefined) ? clip.pageX : (clip.x + (clip.scrollX !== undefined ? clip.scrollX : window.scrollX));
    const pageY = (clip.pageY !== undefined) ? clip.pageY : (clip.y + (clip.scrollY !== undefined ? clip.scrollY : window.scrollY));

    draftBox.style.left = `${pageX}px`;
    draftBox.style.top = `${pageY}px`;
    draftBox.style.width = `${clip.width}px`;
    draftBox.style.height = `${clip.height}px`;

    const viewportY = (clip.y !== undefined) ? clip.y : (pageY - window.scrollY);
    draftBox.classList.toggle("flip-badge-inside", viewportY < 28);
    const badgeEl = draftBox.querySelector("#ap-draft-badge");
    if (badgeEl) {
      badgeEl.textContent = `#${itemNumber} (Đang soạn...)`;
    }

    draftBox.classList.remove("hidden");
    pinnedLayer.classList.remove("hidden");
  }

  function hideDraftBox() {
    draftBox.classList.add("hidden");
    const hasItemsWithClip = feedbackItems.some(it => it.clip && it.clip.width > 0);
    if (!hasItemsWithClip) {
      pinnedLayer.classList.add("hidden");
    }
  }

  function renderPinnedBoxes() {
    // Remove all existing pinned boxes except draftBox
    pinnedLayer.querySelectorAll(".ap-pinned-box:not(#agent-pilot-feedback-draft-box)").forEach(el => el.remove());

    if (!isFeedbackActive) {
      pinnedLayer.classList.add("hidden");
      draftBox.classList.add("hidden");
      return;
    }

    const itemsWithClip = feedbackItems.filter(it => it.clip && it.clip.width > 0 && it.clip.height > 0);
    if (!itemsWithClip.length && draftBox.classList.contains("hidden")) {
      pinnedLayer.classList.add("hidden");
      return;
    }

    pinnedLayer.classList.remove("hidden");

    feedbackItems.forEach((item, idx) => {
      if (!item.clip || !item.clip.width) return;
      const palette = PIN_COLORS[idx % PIN_COLORS.length];
      const pageX = (item.clip.pageX !== undefined) ? item.clip.pageX : (item.clip.x + (item.clip.scrollX !== undefined ? item.clip.scrollX : 0));
      const pageY = (item.clip.pageY !== undefined) ? item.clip.pageY : (item.clip.y + (item.clip.scrollY !== undefined ? item.clip.scrollY : 0));

      const box = document.createElement("div");
      box.className = "ap-pinned-box";
      box.dataset.id = item.id;
      box.style.setProperty("--box-color", palette.color);
      box.style.setProperty("--box-bg", palette.bg);
      box.style.setProperty("--box-glow", palette.glow);
      box.style.left = `${pageX}px`;
      box.style.top = `${pageY}px`;
      box.style.width = `${item.clip.width}px`;
      box.style.height = `${item.clip.height}px`;

      const viewportY = (item.clip.y !== undefined) ? item.clip.y : (pageY - window.scrollY);
      if (viewportY < 28) {
        box.classList.add("flip-badge-inside");
      }

      const badge = document.createElement("span");
      badge.className = "ap-pinned-badge";
      badge.innerHTML = `
        <span>#${idx + 1}</span>
        <button class="ap-pinned-del-btn" title="Xóa vị trí #${idx + 1}">✕</button>
        ${item.comment ? `<div class="ap-pinned-tooltip"><strong>#${idx + 1}:</strong> ${escapeHtml(item.comment)}</div>` : ""}
      `;

      badge.querySelector(".ap-pinned-del-btn").onclick = (e) => {
        e.stopPropagation();
        deleteFeedbackItem(item.id);
      };

      box.appendChild(badge);
      pinnedLayer.appendChild(box);
    });
  }

  // =========================================================================
  // Popovers & Modals Presentation
  // =========================================================================

  function openCommentPopover(capture, anchorRect) {
    document.getElementById("ap-popover-title").textContent = capture.mode === "element" ? "Ghi chú phần tử" : "Ghi chú vùng chọn";
    document.getElementById("ap-popover-img").src = capture.screenshotDataUrl;
    document.getElementById("ap-popover-input").value = "";

    const metaEl = document.getElementById("ap-popover-meta");
    let metaHtml = "";

    if (capture.component) {
      metaHtml += `<div class="ap-badge-comp">⚡ ${escapeHtml(capture.component.framework || "Component")}: <strong>${escapeHtml(capture.component.componentName)}</strong></div>`;
      if (capture.component.fileName) {
        metaHtml += `<div class="ap-meta-file">📁 ${escapeHtml(capture.component.fileName)}${capture.component.lineNumber ? `:${capture.component.lineNumber}` : ""}</div>`;
      }
    } else if (capture.dom) {
      metaHtml += `<div class="ap-meta-selector">🎯 <code>${escapeHtml(capture.dom.selector || capture.dom.tagName)}</code></div>`;
      if (capture.dom.text) {
        metaHtml += `<div class="ap-meta-text">"${escapeHtml(capture.dom.text.slice(0, 60))}"</div>`;
      }
    } else {
      metaHtml += `<div class="ap-meta-pos">📐 ${capture.clip.width}×${capture.clip.height}px (x:${capture.clip.x}, y:${capture.clip.y})</div>`;
    }

    metaEl.innerHTML = metaHtml;

    // Position popover near anchor (supports both DOMRect and {x, y, width, height})
    const aLeft = anchorRect.left ?? anchorRect.x ?? 0;
    const aTop = anchorRect.top ?? anchorRect.y ?? 0;
    const aBottom = anchorRect.bottom ?? ((anchorRect.y !== undefined && anchorRect.height !== undefined) ? anchorRect.y + anchorRect.height : aTop + 40);

    let left = aLeft;
    let top = aBottom + 12;

    if (top + 260 > window.innerHeight) {
      top = Math.max(10, aTop - 270);
    }
    if (left + 340 > window.innerWidth) {
      left = Math.max(10, window.innerWidth - 350);
    }

    commentPopover.style.left = `${left}px`;
    commentPopover.style.top = `${top}px`;
    commentPopover.classList.remove("hidden");
    document.getElementById("ap-popover-input").focus();
  }

  function closeCommentPopover() {
    hideDraftBox();
    pendingCapture = null;
    commentPopover.classList.add("hidden");
  }

  // Annotator Modal (Pins & Boxes on Screen/FullPage)
  let activeTool = "pin"; // "pin" | "box"
  let currentAnnotations = [];
  let annotatorCaptureData = null;

  function openAnnotatorModal(mode, title, dataUrl) {
    annotatorCaptureData = { mode, title, dataUrl };
    currentAnnotations = [];

    document.getElementById("ap-annotator-title").textContent = title;
    document.getElementById("ap-annotator-img").src = dataUrl;
    document.getElementById("ap-annotator-comment").value = "";
    document.getElementById("ap-annotator-svg").innerHTML = "";
    renderPinsList();

    annotatorModal.classList.remove("hidden");
  }

  function closeAnnotatorModal() {
    annotatorCaptureData = null;
    annotatorModal.classList.add("hidden");
    setMode("element"); // Reset to element mode
  }

  function renderPinsList() {
    const list = document.getElementById("ap-pins-list");
    if (!currentAnnotations.length) {
      list.innerHTML = `<div class="ap-empty-hint">Chưa có ghim nào. Nhấp vào ảnh để đặt điểm cần sửa.</div>`;
      return;
    }
    list.innerHTML = currentAnnotations.map((ann, idx) => `
      <div class="ap-pin-row">
        <span class="ap-pin-num">${idx + 1}</span>
        <input type="text" class="ap-pin-input" data-idx="${idx}" placeholder="Ghi chú cho điểm ${idx + 1}..." value="${escapeHtml(ann.comment || "")}">
        <button class="ap-pin-del" data-idx="${idx}">🗑️</button>
      </div>
    `).join("");

    list.querySelectorAll(".ap-pin-input").forEach(input => {
      input.oninput = (e) => {
        const idx = Number(e.target.dataset.idx);
        if (currentAnnotations[idx]) currentAnnotations[idx].comment = e.target.value;
      };
    });

    list.querySelectorAll(".ap-pin-del").forEach(btn => {
      btn.onclick = (e) => {
        const idx = Number(e.target.dataset.idx);
        currentAnnotations.splice(idx, 1);
        renderSvgAnnotations();
        renderPinsList();
      };
    });
  }

  function renderSvgAnnotations() {
    const svg = document.getElementById("ap-annotator-svg");
    svg.innerHTML = currentAnnotations.map((ann, idx) => {
      if (ann.type === "pin") {
        return `
          <g transform="translate(${ann.x}, ${ann.y})">
            <circle r="12" fill="#f43f5e" stroke="#fff" stroke-width="2" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))"/>
            <text text-anchor="middle" dy="4" fill="#fff" font-size="11" font-weight="bold">${idx + 1}</text>
          </g>
        `;
      }
      return "";
    }).join("");
  }

  // =========================================================================
  // Feedback Items Management (Add, Edit, Delete, Clear)
  // =========================================================================

  function addFeedbackItem(item) {
    const newItem = {
      id: "fb_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
      ...item,
      timestamp: Date.now()
    };
    feedbackItems.push(newItem);
    updateHudCounters();
    renderPinnedBoxes();
    showToast(`✓ Đã lưu vị trí #${feedbackItems.length} vào danh sách!`);
    return newItem;
  }

  function deleteFeedbackItem(id) {
    feedbackItems = feedbackItems.filter(item => item.id !== id);
    updateHudCounters();
    renderPinnedBoxes();
    renderItemsListModal();
    showToast("🗑️ Đã xóa vị trí này.");
  }

  function updateFeedbackComment(id, newComment) {
    const item = feedbackItems.find(it => it.id === id);
    if (item) {
      item.comment = newComment;
      updateHudCounters();
      renderPinnedBoxes();
      renderItemsListModal();
      showToast("✓ Đã cập nhật ghi chú!");
    }
  }

  function clearAllFeedbackItems(skipConfirm = false) {
    if (skipConfirm || confirm("Bạn có chắc chắn muốn xóa toàn bộ danh sách chú thích?")) {
      feedbackItems = [];
      updateHudCounters();
      renderPinnedBoxes();
      renderItemsListModal();
      showToast("🗑️ Đã xóa toàn bộ danh sách chú thích.");
    }
  }

  function renderItemsListModal() {
    const container = document.getElementById("ap-list-items-container");
    if (!feedbackItems.length) {
      container.innerHTML = `
        <div class="ap-empty-state">
          <div class="ap-empty-icon">✏️</div>
          <div class="ap-empty-title">Chưa có vị trí nào được đánh dấu</div>
          <div class="ap-empty-desc">Chọn "Phần tử", "Vùng chọn" hoặc "Màn hình" trên thanh HUD để thêm yêu cầu sửa đổi cho Agent.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = feedbackItems.map((item, idx) => {
      const palette = PIN_COLORS[idx % PIN_COLORS.length];
      return `
      <div class="ap-item-card" data-id="${item.id}">
        <div class="ap-card-thumb-col">
          <img src="${item.screenshotDataUrl}" class="ap-card-thumb" alt="Item ${idx + 1}">
          <span class="ap-card-badge mode-${item.mode}">${item.mode.toUpperCase()}</span>
        </div>
        <div class="ap-card-content-col">
          <div class="ap-card-header">
            <span class="ap-card-title">
              <span style="display:inline-block;background:${palette.color};color:#ffffff;font-size:10px;font-weight:bold;padding:1px 6px;border-radius:4px;margin-right:6px;">#${idx + 1}</span>
              ${escapeHtml(item.title)}
            </span>
            <div class="ap-card-actions">
              <button class="ap-card-action-btn btn-edit" data-id="${item.id}" title="Sửa ghi chú">✏️</button>
              <button class="ap-card-action-btn btn-delete" data-id="${item.id}" title="Xóa mục này">🗑️</button>
            </div>
          </div>
          ${item.component ? `
            <div class="ap-card-comp-info">
              ⚡ <strong>${escapeHtml(item.component.componentName)}</strong>
              ${item.component.fileName ? `<span class="ap-code-file">(${escapeHtml(item.component.fileName)}${item.component.lineNumber ? `:${item.component.lineNumber}` : ""})</span>` : ""}
            </div>
          ` : ""}
          ${item.dom?.selector ? `
            <div class="ap-card-selector"><code>${escapeHtml(item.dom.selector)}</code></div>
          ` : ""}
          <div class="ap-card-comment-wrap">
            <div class="ap-card-comment-text" id="comment-text-${item.id}">${escapeHtml(item.comment || "Không có ghi chú")}</div>
            <div class="ap-card-comment-edit hidden" id="comment-edit-${item.id}">
              <textarea class="ap-card-edit-textarea">${escapeHtml(item.comment || "")}</textarea>
              <div style="display:flex;gap:6px;margin-top:6px;">
                <button class="ap-popover-btn ap-btn-submit btn-save-edit" data-id="${item.id}">Lưu</button>
                <button class="ap-popover-btn ap-btn-cancel btn-cancel-edit" data-id="${item.id}">Hủy</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    }).join("");

    // Bind Edit & Delete buttons
    container.querySelectorAll(".btn-delete").forEach(btn => {
      btn.onclick = () => deleteFeedbackItem(btn.dataset.id);
    });

    container.querySelectorAll(".btn-edit").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        document.getElementById(`comment-text-${id}`).classList.add("hidden");
        document.getElementById(`comment-edit-${id}`).classList.remove("hidden");
      };
    });

    container.querySelectorAll(".btn-cancel-edit").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        document.getElementById(`comment-text-${id}`).classList.remove("hidden");
        document.getElementById(`comment-edit-${id}`).classList.add("hidden");
      };
    });

    container.querySelectorAll(".btn-save-edit").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const newText = document.querySelector(`#comment-edit-${id} textarea`).value;
        updateFeedbackComment(id, newText);
      };
    });
  }

  // =========================================================================
  // Channel C: 1-Click Clipboard Markdown Prompt Generator
  // =========================================================================

  function generateMarkdownPrompt(customItems) {
    const items = (customItems && customItems.length) ? customItems : feedbackItems;
    if (!items || !items.length) return null;

    let md = `### 🎯 YÊU CẦU CHỈNH SỬA GIAO DIỆN (Agent Pilot Visual Feedback)\n\n`;
    md += `- **URL**: \`${window.location.href}\`\n`;
    md += `- **Tiêu đề trang**: "${document.title}"\n`;
    md += `- **Thời gian ghi nhận**: ${new Date().toLocaleString("vi-VN")}\n`;
    md += `- **Tổng số mục phản hồi**: ${items.length}\n\n`;
    md += `---\n\n`;

    items.forEach((item, index) => {
      const num = index + 1;
      md += `#### Mục ${num}: [${item.mode.toUpperCase()}] ${item.title}\n`;

      if (item.component) {
        md += `- **Component Framework**: \`${item.component.framework || "React"}\`\n`;
        md += `- **Component Name**: \`<${item.component.componentName} />\`\n`;
        if (item.component.fileName) {
          md += `- **Đường dẫn tệp nguồn (Source File)**: \`${item.component.fileName}${item.component.lineNumber ? `:${item.component.lineNumber}` : ""}\`\n`;
        }
        if (item.component.hierarchy) {
          const hierStr = Array.isArray(item.component.hierarchy)
            ? item.component.hierarchy.join(" > ")
            : String(item.component.hierarchy);
          md += `- **Cây Component**: \`${hierStr}\`\n`;
        }
      }

      if (item.dom) {
        md += `- **CSS Selector**: \`${item.dom.selector || item.dom.tagName}\`\n`;
        if (item.dom.xpath) md += `- **XPath**: \`${item.dom.xpath}\`\n`;
        if (item.dom.text) md += `- **Nội dung text**: "${item.dom.text.replace(/\n+/g, " ").slice(0, 150)}"\n`;
        if (item.dom.styles) {
          md += `- **Thông số CSS hiện tại**: \`color: ${item.dom.styles.color}; background: ${item.dom.styles.backgroundColor}; font-size: ${item.dom.styles.fontSize};\`\n`;
        }
      }

      if (item.clip) {
        md += `- **Tọa độ / Kích thước**: ${item.clip.width}×${item.clip.height}px (x: ${item.clip.x}, y: ${item.clip.y})\n`;
      }

      if (item.annotations && item.annotations.length) {
        md += `- **Các điểm đánh dấu (Pins)**:\n`;
        item.annotations.forEach((ann, pinIdx) => {
          md += `  - Điểm ${pinIdx + 1} (x:${ann.x}, y:${ann.y}): ${ann.comment || "Cần sửa vị trí này"}\n`;
        });
      }

      md += `- **Yêu cầu chỉnh sửa của người dùng (User Note)**:\n`;
      md += `  > ${item.comment ? item.comment.replace(/\n/g, "\n  > ") : "*(Không có ghi chú cụ thể)*"}\n\n`;

      if (item.screenshotDataUrl) {
        md += `- **Ảnh chụp thực tế**: \n  ![Mục ${num}](${item.screenshotDataUrl})\n\n`;
      }

      md += `---\n\n`;
    });

    md += `\n**Chỉ dẫn cho AI Agent**:\n`;
    md += `1. Xem xét chính xác tệp nguồn và component được liệt kê ở trên.\n`;
    md += `2. Cập nhật mã nguồn và kiểu dáng CSS/Tailwind theo đúng yêu cầu ghi chú của người dùng.\n`;
    md += `3. Giữ nguyên các chức năng và cấu trúc không được yêu cầu thay đổi.\n`;

    return md;
  }

  async function copyFeedbackPrompt() {
    if (!feedbackItems.length) {
      showToast("⚠️ Chưa có vị trí nào được đánh dấu để copy. Hãy chọn phần tử hoặc kéo vùng trước!");
      return;
    }

    const md = generateMarkdownPrompt();
    try {
      await navigator.clipboard.writeText(md);
      showToast(`📋 Đã copy ${feedbackItems.length} vị trí chú thích! Hãy dán (Ctrl+V) vào khung chat Agent.`);
    } catch (err) {
      // Fallback via textarea
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast(`📋 Đã copy ${feedbackItems.length} vị trí chú thích vào Clipboard!`);
    }
  }

  // =========================================================================
  // Feedback Studio Session Lifecycle (Start & Stop)
  // =========================================================================

  function startFeedbackStudio() {
    if (isFeedbackActive) return;
    isFeedbackActive = true;

    // Deactivate inspector / crop if active
    if (window.__AP_INTERNAL__.inspector?.toggleInspector) {
      window.__AP_INTERNAL__.inspector.toggleInspector(false);
    }

    hud.classList.remove("hidden");
    renderPinnedBoxes();
    setMode("element");

    // Bind event listeners
    document.addEventListener("mousemove", onElementMouseMove, true);
    document.addEventListener("click", onElementClick, true);
    cropOverlay.addEventListener("mousedown", onCropMouseDown);
    cropOverlay.addEventListener("mousemove", onCropMouseMove);
    cropOverlay.addEventListener("mouseup", onCropMouseUp);

    showToast("✏️ Đã bật chế độ Chú thích & Chỉ điểm UI! Nhấp vào phần tử cần sửa.");
    chrome.runtime.sendMessage({ action: "FEEDBACK_MODE_CHANGED", active: true }).catch(() => {});
  }

  function stopFeedbackStudio() {
    if (!isFeedbackActive) return;
    isFeedbackActive = false;

    hud.classList.add("hidden");
    hideHighlighter();
    cropOverlay.classList.add("hidden");
    closeCommentPopover();
    closeAnnotatorModal();
    listModal.classList.add("hidden");
    hideDraftBox();
    renderPinnedBoxes();

    document.removeEventListener("mousemove", onElementMouseMove, true);
    document.removeEventListener("click", onElementClick, true);
    cropOverlay.removeEventListener("mousedown", onCropMouseDown);
    cropOverlay.removeEventListener("mousemove", onCropMouseMove);
    cropOverlay.removeEventListener("mouseup", onCropMouseUp);

    showToast("✓ Đã thoát chế độ Chú thích UI.");
    chrome.runtime.sendMessage({ action: "FEEDBACK_MODE_CHANGED", active: false }).catch(() => {});
  }

  // =========================================================================
  // Wire Popovers & Modal Events
  // =========================================================================

  // Channel B: Save feedback items to ~/.agent-pilot/inbox/feedback/<timestamp>/*
  async function saveFeedbackToInbox() {
    if (feedbackItems.length === 0) {
      showToast("⚠️ Chưa có vị trí nào được đánh dấu để lưu vào inbox. Hãy chọn phần tử hoặc kéo vùng trước!");
      return { success: false, error: "No feedback items" };
    }
    showToast("💾 Đang lưu chú thích vào inbox...");
    const promptMd = generateMarkdownPrompt(feedbackItems);
    const payload = {
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title,
      items: feedbackItems,
      prompt: promptMd
    };

    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: "save_feedback_inbox",
          payload
        }, (res) => resolve(res || { success: false }));
      });

      if (resp && resp.success) {
        if (resp.storage === "filesystem") {
          showToast(`✓ Đã lưu ${feedbackItems.length} vị trí vào ~/.agent-pilot/inbox/feedback/${resp.sessionId}/`);
        } else {
          showToast(`✓ Đã lưu ${feedbackItems.length} vị trí vào bộ nhớ Extension!`);
        }
        return resp;
      } else {
        showToast(`❌ Lỗi lưu inbox: ${resp?.error || "Không thể lưu"}`);
        return resp || { success: false };
      }
    } catch (err) {
      showToast(`❌ Lỗi: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // Channel A: Push feedback live to waiting agent
  async function pushFeedbackToAgent() {
    if (feedbackItems.length === 0) {
      showToast("⚠️ Chưa có vị trí nào được đánh dấu để gửi. Hãy chọn phần tử hoặc kéo vùng trước!");
      return { success: false, error: "No feedback items" };
    }
    showToast("🚀 Đang gửi chú thích trực tiếp cho Agent...");
    const promptMd = generateMarkdownPrompt(feedbackItems);
    const payload = {
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title,
      items: feedbackItems,
      prompt: promptMd
    };

    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: "push_feedback_live",
          payload
        }, (res) => resolve(res || { success: false }));
      });

      if (resp && resp.success) {
        showToast(`✓ Đã truyền trực tiếp ${feedbackItems.length} vị trí cần sửa cho AI Agent!`);
        return resp;
      } else {
        showToast(`⚠️ Không có Agent nào đang chờ (chạy browser_wait_for_feedback). Đã tự động lưu vào inbox!`);
        return resp || { success: false };
      }
    } catch (err) {
      showToast(`❌ Lỗi gửi: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // HUD mode buttons
  hud.querySelectorAll(".ap-hud-btn").forEach(btn => {
    btn.onclick = () => setMode(btn.dataset.mode);
  });

  hud.querySelector("#ap-hud-btn-close").onclick = stopFeedbackStudio;
  hud.querySelector("#ap-hud-btn-copy").onclick = copyFeedbackPrompt;
  const hudBtnInbox = hud.querySelector("#ap-hud-btn-inbox");
  if (hudBtnInbox) hudBtnInbox.onclick = saveFeedbackToInbox;
  const hudBtnSend = hud.querySelector("#ap-hud-btn-send");
  if (hudBtnSend) hudBtnSend.onclick = pushFeedbackToAgent;
  hud.querySelector("#ap-hud-btn-list").onclick = () => {
    renderItemsListModal();
    listModal.classList.remove("hidden");
  };

  // Popover save & cancel
  document.getElementById("ap-popover-btn-close").onclick = closeCommentPopover;
  document.getElementById("ap-popover-btn-cancel").onclick = closeCommentPopover;
  document.getElementById("ap-popover-btn-save").onclick = () => {
    if (!pendingCapture) return;
    const comment = document.getElementById("ap-popover-input").value.trim();
    addFeedbackItem({
      ...pendingCapture,
      comment
    });
    closeCommentPopover();
  };

  // Annotator click to drop pins
  const canvasWrapper = document.getElementById("ap-canvas-wrapper");
  canvasWrapper.onclick = (e) => {
    if (activeTool !== "pin") return;
    const rect = canvasWrapper.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);

    currentAnnotations.push({
      type: "pin",
      x,
      y,
      comment: ""
    });

    renderSvgAnnotations();
    renderPinsList();
  };

  document.getElementById("ap-annotator-btn-close").onclick = closeAnnotatorModal;
  document.getElementById("ap-annotator-btn-cancel").onclick = closeAnnotatorModal;
  document.getElementById("ap-tool-clear").onclick = () => {
    currentAnnotations = [];
    renderSvgAnnotations();
    renderPinsList();
  };
  document.getElementById("ap-annotator-btn-save").onclick = () => {
    if (!annotatorCaptureData) return;
    const comment = document.getElementById("ap-annotator-comment").value.trim();
    addFeedbackItem({
      mode: annotatorCaptureData.mode,
      title: annotatorCaptureData.title,
      dom: null,
      component: null,
      clip: null,
      screenshotDataUrl: annotatorCaptureData.dataUrl,
      annotations: currentAnnotations,
      comment
    });
    closeAnnotatorModal();
  };

  // List modal buttons
  document.getElementById("ap-list-btn-close").onclick = () => listModal.classList.add("hidden");
  document.getElementById("ap-list-btn-back").onclick = () => listModal.classList.add("hidden");
  document.getElementById("ap-list-btn-clear-all").onclick = clearAllFeedbackItems;
  document.getElementById("ap-list-btn-copy-all").onclick = () => {
    copyFeedbackPrompt();
    listModal.classList.add("hidden");
  };

  // Escape key cancels active popover or closes modals
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isFeedbackActive) {
      if (!commentPopover.classList.contains("hidden")) {
        closeCommentPopover();
      } else if (!annotatorModal.classList.contains("hidden")) {
        closeAnnotatorModal();
      } else if (!listModal.classList.contains("hidden")) {
        listModal.classList.add("hidden");
      }
    }
  });

  // =========================================================================
  // Free Dragging Controller for Quick Comment Popover and HUD Toolbar
  // =========================================================================

  function makeDraggable(element, handle, onStart) {
    if (!element || !handle) return;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initLeft = 0;
    let initTop = 0;

    handle.addEventListener("mousedown", (e) => {
      // Don't drag if clicking buttons, inputs, links, or textareas
      if (e.target.closest("button, input, textarea, a, select")) return;
      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = element.getBoundingClientRect();
      initLeft = rect.left;
      initTop = rect.top;

      if (typeof onStart === "function") {
        onStart(initLeft, initTop);
      } else {
        element.style.left = `${initLeft}px`;
        element.style.top = `${initTop}px`;
        element.style.right = "auto";
        element.style.bottom = "auto";
      }

      handle.style.cursor = "grabbing";
      document.body.style.userSelect = "none";

      const onMouseMove = (moveEvent) => {
        if (!isDragging) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        const elWidth = element.offsetWidth || 340;
        const elHeight = element.offsetHeight || 200;

        let newLeft = initLeft + dx;
        let newTop = initTop + dy;

        // Keep inside viewport bounds
        newLeft = Math.max(6, Math.min(window.innerWidth - elWidth - 6, newLeft));
        newTop = Math.max(6, Math.min(window.innerHeight - elHeight - 6, newTop));

        element.style.left = `${newLeft}px`;
        element.style.top = `${newTop}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        handle.style.cursor = "grab";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove, true);
        window.removeEventListener("mouseup", onMouseUp, true);
      };

      window.addEventListener("mousemove", onMouseMove, true);
      window.addEventListener("mouseup", onMouseUp, true);
    });
  }

  // 1. Quick Comment Popover: free dragging via header
  const popoverHeader = commentPopover.querySelector(".ap-popover-header");
  makeDraggable(commentPopover, popoverHeader);

  // 2. Floating HUD Toolbar: free dragging via drag-handle
  const hudDragHandle = hud.querySelector(".ap-hud-drag-handle");
  makeDraggable(hud, hudDragHandle, (left, top) => {
    hud.style.transform = "none";
    hud.style.left = `${left}px`;
    hud.style.top = `${top}px`;
    hud.style.right = "auto";
    hud.style.bottom = "auto";
  });

  // =========================================================================
  // Expose to Internal Coordinator & Message Dispatcher
  // =========================================================================

  window.__AP_INTERNAL__.feedback = {
    start: startFeedbackStudio,
    stop: stopFeedbackStudio,
    isActive: () => isFeedbackActive,
    getItems: () => [...feedbackItems],
    addItem: addFeedbackItem,
    setMode,
    copyPrompt: copyFeedbackPrompt,
    deleteItem: deleteFeedbackItem,
    clearAll: (skipConfirm = true) => clearAllFeedbackItems(skipConfirm),
    generateMarkdownPrompt,
    saveToInbox: saveFeedbackToInbox,
    pushToAgent: pushFeedbackToAgent
  };
})();
