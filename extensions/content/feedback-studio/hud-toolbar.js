/**
 * Agent Pilot - Feedback Studio HUD Toolbar
 * Floating draggable toolbar for switching annotation modes and triggering feedback actions.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};
  window.__AP_INTERNAL__.feedbackStudio = window.__AP_INTERNAL__.feedbackStudio || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.fsHud) return;
  window.__AP_INTERNAL__.__guards.fsHud = true;

  // 1. Create Floating HUD Toolbar DOM Element
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

  // Make HUD draggable
  const constants = window.__AP_INTERNAL__.feedbackStudio.constants;
  if (constants?.makeDraggable) {
    const hudDragHandle = hud.querySelector(".ap-hud-drag-handle");
    constants.makeDraggable(hud, hudDragHandle, (left, top) => {
      hud.style.transform = "none";
      hud.style.left = `${left}px`;
      hud.style.top = `${top}px`;
      hud.style.right = "auto";
      hud.style.bottom = "auto";
    });
  }

  /**
   * Update HUD item count badges and sync with background / sidepanel
   */
  function updateCounters() {
    const items = window.__AP_INTERNAL__.feedbackStudio.state?.getItems() || [];
    const count = items.length;
    const text = `${count} vị trí`;

    const hudItemCount = document.getElementById("ap-hud-item-count");
    if (hudItemCount) hudItemCount.textContent = text;

    const hudListCount = document.getElementById("ap-hud-list-count");
    if (hudListCount) hudListCount.textContent = String(count);

    const listTotalCount = document.getElementById("ap-list-total-count");
    if (listTotalCount) listTotalCount.textContent = String(count);

    // Sync with side panel
    chrome.runtime.sendMessage({
      action: "FEEDBACK_ITEMS_UPDATED",
      count,
      items: items.map((item) => ({
        id: item.id,
        mode: item.mode,
        title: item.title,
        comment: item.comment,
        component: item.component,
        timestamp: item.timestamp
      }))
    }).catch(() => {});
  }

  /**
   * Update HUD mode button active styles
   */
  function setMode(mode) {
    hud.querySelectorAll(".ap-hud-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
    });
  }

  function showHud() {
    hud.classList.remove("hidden");
  }

  function hideHud() {
    hud.classList.add("hidden");
  }

  window.__AP_INTERNAL__.feedbackStudio.hud = {
    hud,
    updateCounters,
    setMode,
    showHud,
    hideHud
  };
})();
