/**
 * Agent Pilot - Feedback Studio Modals & Popovers
 * Quick Comment Popover, Screen/FullPage Annotator, and Feedback Items List Modal.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};
  window.__AP_INTERNAL__.feedbackStudio = window.__AP_INTERNAL__.feedbackStudio || {};

  const constants = window.__AP_INTERNAL__.feedbackStudio.constants || {};
  const escapeHtml = constants.escapeHtml || ((s) => s);

  // =========================================================================
  // 1. Quick Comment Popover (Element & Region Modes)
  // =========================================================================
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

  // Enable free dragging via header
  if (constants?.makeDraggable) {
    const popoverHeader = commentPopover.querySelector(".ap-popover-header");
    constants.makeDraggable(commentPopover, popoverHeader);
  }

  function openCommentPopover(capture, anchorRect) {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    if (state) state.setPendingCapture(capture);

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
    } else if (capture.clip) {
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
    const pinned = window.__AP_INTERNAL__.feedbackStudio.pinned;
    if (pinned) pinned.hideDraftBox();

    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    if (state) state.setPendingCapture(null);

    commentPopover.classList.add("hidden");
  }

  // =========================================================================
  // 2. Annotator Modal (Screen Viewport & Full Page Modes)
  // =========================================================================
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

  const MIN_BOX_SIZE = 10;
  const BADGE_BASE_WIDTH = 24;
  const BADGE_CHAR_WIDTH = 7;
  const BADGE_HEIGHT = 18;
  const BADGE_TOP_THRESHOLD = 22;

  let activeTool = "pin"; // "pin" | "box"
  let currentAnnotations = [];
  let annotatorCaptureData = null;
  let boxDragState = { dragging: false, startX: 0, startY: 0, currentRect: null };

  function setActiveTool(tool) {
    if (activeTool === tool) return;
    activeTool = tool; // "pin" | "box"
    boxDragState.dragging = false;
    boxDragState.currentRect = null;
    renderSvgAnnotations();
    const btnPin = document.getElementById("ap-tool-pin");
    const btnBox = document.getElementById("ap-tool-box");
    if (btnPin) btnPin.classList.toggle("active", tool === "pin");
    if (btnBox) btnBox.classList.toggle("active", tool === "box");
  }

  function syncSvgDimensions() {
    const img = document.getElementById("ap-annotator-img");
    const svg = document.getElementById("ap-annotator-svg");
    if (img && svg) {
      const w = img.clientWidth || img.offsetWidth || img.naturalWidth;
      const h = img.clientHeight || img.offsetHeight || img.naturalHeight;
      if (w > 0 && h > 0) {
        svg.style.width = `${w}px`;
        svg.style.height = `${h}px`;
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      }
    }
  }

  function openAnnotatorModal(mode, title, dataUrl) {
    annotatorCaptureData = { mode, title, dataUrl };
    currentAnnotations = [];
    setActiveTool("pin");

    document.getElementById("ap-annotator-title").textContent = title;
    const img = document.getElementById("ap-annotator-img");
    img.onload = () => {
      syncSvgDimensions();
    };
    img.src = dataUrl;
    document.getElementById("ap-annotator-comment").value = "";
    document.getElementById("ap-annotator-svg").innerHTML = "";
    renderPinsList();

    annotatorModal.classList.remove("hidden");
    setTimeout(syncSvgDimensions, 60);
  }

  function closeAnnotatorModal() {
    annotatorCaptureData = null;
    annotatorModal.classList.add("hidden");
    const selection = window.__AP_INTERNAL__.feedbackStudio.selection;
    if (selection) selection.setMode("element");
  }

  function renderPinsList() {
    const list = document.getElementById("ap-pins-list");
    if (!currentAnnotations.length) {
      list.innerHTML = `<div class="ap-empty-hint">Chưa có đánh dấu nào. Chọn "Ghim điểm" hoặc "Khung" để đánh dấu vị trí cần sửa trên ảnh.</div>`;
      return;
    }
    list.innerHTML = currentAnnotations.map((ann, idx) => {
      const num = idx + 1;
      const isBox = ann.type === "box";
      const icon = isBox ? "⬜" : "📍";
      const typeClass = isBox ? "type-box" : "";
      const placeholder = isBox
        ? `Ghi chú cho khung #${num} (${ann.width}×${ann.height}px)...`
        : `Ghi chú cho điểm #${num}...`;

      return `
      <div class="ap-pin-row" data-idx="${idx}">
        <span class="ap-pin-num ${typeClass}" title="${isBox ? "Khung vùng" : "Điểm ghim"}">${icon} ${num}</span>
        <input type="text" class="ap-pin-input" data-idx="${idx}" placeholder="${placeholder}" value="${escapeHtml(ann.comment || "")}">
        <button class="ap-pin-del" data-idx="${idx}" title="Xóa đánh dấu #${num}">🗑️</button>
      </div>
    `;
    }).join("");

    list.querySelectorAll(".ap-pin-input").forEach((input) => {
      input.oninput = (e) => {
        const idx = Number(e.target.dataset.idx);
        if (currentAnnotations[idx]) currentAnnotations[idx].comment = e.target.value;
      };
    });

    list.querySelectorAll(".ap-pin-del").forEach((btn) => {
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
    syncSvgDimensions();

    let svgHtml = "";

    // 1. Render all committed annotations
    currentAnnotations.forEach((ann, idx) => {
      const num = idx + 1;
      if (ann.type === "pin") {
        svgHtml += `
          <g transform="translate(${ann.x}, ${ann.y})">
            <circle r="12" fill="#f43f5e" stroke="#fff" stroke-width="2" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))"/>
            <text text-anchor="middle" dy="4" fill="#fff" font-size="11" font-weight="bold">${num}</text>
          </g>
        `;
      } else if (ann.type === "box") {
        const badgeW = BADGE_BASE_WIDTH + (String(num).length * BADGE_CHAR_WIDTH);
        const badgeY = ann.y < BADGE_TOP_THRESHOLD ? ann.y + 4 : ann.y - 20;
        svgHtml += `
          <g class="ap-svg-ann-box" data-idx="${idx}">
            <rect x="${ann.x}" y="${ann.y}" width="${ann.width}" height="${ann.height}" rx="4"
                  fill="rgba(56, 189, 248, 0.16)" stroke="#38bdf8" stroke-width="2" stroke-dasharray="4,2"/>
            <g transform="translate(${ann.x}, ${Math.max(2, badgeY)})">
              <rect x="0" y="0" width="${badgeW}" height="${BADGE_HEIGHT}" rx="4" fill="#0284c7" stroke="#38bdf8" stroke-width="1"/>
              <text x="${badgeW / 2}" y="13" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">#${num}</text>
            </g>
          </g>
        `;
      }
    });

    // 2. Render live drafting box if currently dragging
    if (boxDragState.dragging && boxDragState.currentRect && boxDragState.currentRect.width > 2 && boxDragState.currentRect.height > 2) {
      const r = boxDragState.currentRect;
      const num = currentAnnotations.length + 1;
      const badgeY = r.y < BADGE_TOP_THRESHOLD ? r.y + 4 : r.y - 20;
      svgHtml += `
        <g class="ap-svg-ann-draft-box">
          <rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="4"
                fill="rgba(245, 158, 11, 0.16)" stroke="#f59e0b" stroke-width="2" stroke-dasharray="5,3"/>
          <g transform="translate(${r.x}, ${Math.max(2, badgeY)})">
            <rect x="0" y="0" width="70" height="${BADGE_HEIGHT}" rx="4" fill="#d97706"/>
            <text x="35" y="13" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">#${num} (Khung)</text>
          </g>
        </g>
      `;
    }

    svg.innerHTML = svgHtml;
  }

  // =========================================================================
  // 3. Feedback Items List Modal (Review, Edit, Delete)
  // =========================================================================
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

  function renderItemsListModal() {
    const container = document.getElementById("ap-list-items-container");
    const items = window.__AP_INTERNAL__.feedbackStudio.state?.getItems() || [];
    const PIN_COLORS = constants.PIN_COLORS || [];

    if (!items.length) {
      container.innerHTML = `
        <div class="ap-empty-state">
          <div class="ap-empty-icon">✏️</div>
          <div class="ap-empty-title">Chưa có vị trí nào được đánh dấu</div>
          <div class="ap-empty-desc">Chọn "Phần tử", "Vùng chọn" hoặc "Màn hình" trên thanh HUD để thêm yêu cầu sửa đổi cho Agent.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map((item, idx) => {
      const palette = PIN_COLORS[idx % PIN_COLORS.length] || { color: "#38bdf8" };
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
    container.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.onclick = () => {
        if (window.__AP_INTERNAL__.feedbackStudio.actions?.deleteItem) {
          window.__AP_INTERNAL__.feedbackStudio.actions.deleteItem(btn.dataset.id);
        }
      };
    });

    container.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        document.getElementById(`comment-text-${id}`)?.classList.add("hidden");
        document.getElementById(`comment-edit-${id}`)?.classList.remove("hidden");
      };
    });

    container.querySelectorAll(".btn-cancel-edit").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        document.getElementById(`comment-text-${id}`)?.classList.remove("hidden");
        document.getElementById(`comment-edit-${id}`)?.classList.add("hidden");
      };
    });

    container.querySelectorAll(".btn-save-edit").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const newText = document.querySelector(`#comment-edit-${id} textarea`)?.value;
        if (window.__AP_INTERNAL__.feedbackStudio.actions?.updateComment) {
          window.__AP_INTERNAL__.feedbackStudio.actions.updateComment(id, newText);
        }
      };
    });
  }

  function openListModal() {
    renderItemsListModal();
    listModal.classList.remove("hidden");
  }

  function closeListModal() {
    listModal.classList.add("hidden");
  }

  function closeAllModals() {
    closeCommentPopover();
    closeAnnotatorModal();
    closeListModal();
  }

  // =========================================================================
  // Wire Popover and Modal DOM Events
  // =========================================================================

  // Popover buttons
  document.getElementById("ap-popover-btn-close").onclick = closeCommentPopover;
  document.getElementById("ap-popover-btn-cancel").onclick = closeCommentPopover;
  document.getElementById("ap-popover-btn-save").onclick = () => {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    const pendingCapture = state?.getPendingCapture();
    if (!pendingCapture) return;

    const comment = document.getElementById("ap-popover-input").value.trim();
    if (window.__AP_INTERNAL__.feedbackStudio.actions?.addItem) {
      window.__AP_INTERNAL__.feedbackStudio.actions.addItem({
        ...pendingCapture,
        comment
      });
    }
    closeCommentPopover();
  };

  // Annotator tool switching buttons
  const btnToolPin = document.getElementById("ap-tool-pin");
  if (btnToolPin) {
    btnToolPin.onclick = () => setActiveTool("pin");
  }

  const btnToolBox = document.getElementById("ap-tool-box");
  if (btnToolBox) {
    btnToolBox.onclick = () => setActiveTool("box");
  }

  // Annotator Canvas Mouse Interaction (Pin Click & Box Drag-to-Draw)
  const canvasWrapper = document.getElementById("ap-canvas-wrapper");

  canvasWrapper.addEventListener("mousedown", (e) => {
    if (activeTool !== "box") return;
    const img = document.getElementById("ap-annotator-img");
    if (!img) return;
    const imgRect = img.getBoundingClientRect();

    if (e.clientX < imgRect.left || e.clientX > imgRect.right || e.clientY < imgRect.top || e.clientY > imgRect.bottom) {
      return;
    }

    e.preventDefault();
    boxDragState.dragging = true;
    const startX = Math.max(0, Math.min(img.clientWidth, Math.round(e.clientX - imgRect.left)));
    const startY = Math.max(0, Math.min(img.clientHeight, Math.round(e.clientY - imgRect.top)));
    boxDragState.startX = startX;
    boxDragState.startY = startY;
    boxDragState.currentRect = { x: startX, y: startY, width: 0, height: 0 };
  });

  window.addEventListener("mousemove", (e) => {
    if (!boxDragState.dragging || activeTool !== "box") return;
    const img = document.getElementById("ap-annotator-img");
    if (!img) return;
    const imgRect = img.getBoundingClientRect();

    const curX = Math.max(0, Math.min(img.clientWidth, Math.round(e.clientX - imgRect.left)));
    const curY = Math.max(0, Math.min(img.clientHeight, Math.round(e.clientY - imgRect.top)));

    const x = Math.min(boxDragState.startX, curX);
    const y = Math.min(boxDragState.startY, curY);
    const width = Math.abs(curX - boxDragState.startX);
    const height = Math.abs(curY - boxDragState.startY);

    boxDragState.currentRect = { x, y, width, height };
    renderSvgAnnotations();
  });

  window.addEventListener("mouseup", () => {
    if (!boxDragState.dragging || activeTool !== "box") return;
    boxDragState.dragging = false;
    const rect = boxDragState.currentRect;
    boxDragState.currentRect = null;

    if (rect && rect.width >= MIN_BOX_SIZE && rect.height >= MIN_BOX_SIZE) {
      currentAnnotations.push({
        type: "box",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        comment: ""
      });
      renderPinsList();
    }
    renderSvgAnnotations();
  });

  canvasWrapper.addEventListener("click", (e) => {
    if (activeTool !== "pin") return;
    const img = document.getElementById("ap-annotator-img");
    if (!img) return;
    const imgRect = img.getBoundingClientRect();

    if (e.clientX < imgRect.left || e.clientX > imgRect.right || e.clientY < imgRect.top || e.clientY > imgRect.bottom) {
      return;
    }

    const x = Math.round(e.clientX - imgRect.left);
    const y = Math.round(e.clientY - imgRect.top);

    currentAnnotations.push({
      type: "pin",
      x,
      y,
      comment: ""
    });

    renderSvgAnnotations();
    renderPinsList();
  });

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
    if (window.__AP_INTERNAL__.feedbackStudio.actions?.addItem) {
      window.__AP_INTERNAL__.feedbackStudio.actions.addItem({
        mode: annotatorCaptureData.mode,
        title: annotatorCaptureData.title,
        dom: null,
        component: null,
        clip: null,
        screenshotDataUrl: annotatorCaptureData.dataUrl,
        annotations: currentAnnotations,
        comment
      });
    }
    closeAnnotatorModal();
  };

  // List modal buttons
  document.getElementById("ap-list-btn-close").onclick = closeListModal;
  document.getElementById("ap-list-btn-back").onclick = closeListModal;
  document.getElementById("ap-list-btn-clear-all").onclick = () => {
    if (window.__AP_INTERNAL__.feedbackStudio.actions?.clearAll) {
      window.__AP_INTERNAL__.feedbackStudio.actions.clearAll(false);
    }
  };
  document.getElementById("ap-list-btn-copy-all").onclick = () => {
    if (window.__AP_INTERNAL__.feedbackStudio.channels?.copyFeedbackPrompt) {
      window.__AP_INTERNAL__.feedbackStudio.channels.copyFeedbackPrompt();
    }
    closeListModal();
  };

  window.__AP_INTERNAL__.feedbackStudio.modals = {
    commentPopover,
    annotatorModal,
    listModal,
    openCommentPopover,
    closeCommentPopover,
    openAnnotatorModal,
    closeAnnotatorModal,
    renderItemsListModal,
    openListModal,
    closeListModal,
    closeAllModals
  };
})();
