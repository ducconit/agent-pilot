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

  // 1. Create Floating HUD Toolbar DOM Element in memory (mounted lazily when Feedback Studio starts)
  const existingHud = document.getElementById("agent-pilot-feedback-hud");
  if (existingHud) existingHud.remove();
  const hudMarkup = `
    <div class="ap-hud-drag-handle">
      <span class="ap-hud-badge">✏️ CHÚ THÍCH UI</span>
      <span class="ap-hud-status" id="ap-hud-item-count">0 vị trí</span>
    </div>
    <div class="ap-hud-modes">
      <div role="button" tabindex="0" class="ap-hud-btn active" data-mode="element" title="Chọn phần tử DOM (E)">🎯 Phần tử</div>
      <div role="button" tabindex="0" class="ap-hud-btn" data-mode="region" title="Kéo chọn một vùng (R)">⬚ Vùng chọn</div>
      <div role="button" tabindex="0" class="ap-hud-btn" data-mode="screen" title="Chụp toàn màn hình hiển thị (S)">🖥️ Màn hình</div>
      <div role="button" tabindex="0" class="ap-hud-btn" data-mode="fullpage" title="Chụp toàn bộ trang web dài (P)">📄 Toàn trang</div>
    </div>
    <div class="ap-hud-divider"></div>
    <div class="ap-hud-actions">
      <div role="button" tabindex="0" class="ap-hud-action-btn" id="ap-hud-btn-list" title="Xem danh sách các vị trí đã chọn">📋 Danh sách (<span id="ap-hud-list-count">0</span>)</div>
      <div role="button" tabindex="0" class="ap-hud-action-btn ap-btn-highlight" id="ap-hud-btn-copy" title="Copy toàn bộ chú thích dạng Markdown để gửi Agent (Kênh C)">📋 Copy Prompt</div>
      <div role="button" tabindex="0" class="ap-hud-action-btn ap-btn-save" id="ap-hud-btn-inbox" title="Lưu vào Inbox của Agent (Kênh B)">💾 Lưu Inbox</div>
      <div role="button" tabindex="0" class="ap-hud-action-btn ap-btn-send" id="ap-hud-btn-send" title="Gửi trực tiếp cho Agent qua cổng 58765 (Kênh A)">🚀 Gửi Agent</div>
      <div role="button" tabindex="0" class="ap-hud-close-btn" id="ap-hud-btn-close" title="Thoát chế độ chú thích UI">✕ Thoát</div>
    </div>
  `;
  const hud = window.__AP_INTERNAL__.createHtmlElement
    ? window.__AP_INTERNAL__.createHtmlElement("div", hudMarkup)
    : (() => {
        const el = document.createElement("div");
        el.innerHTML = hudMarkup;
        return el;
      })();
  hud.id = "agent-pilot-feedback-hud";
  hud.className = "agent-pilot-feedback-hud hidden";
  hud.style.display = "none";

  function canMountUi() {
    return !window.__AP_INTERNAL__.isHtmlDocument || window.__AP_INTERNAL__.isHtmlDocument();
  }

  function ensureMounted() {
    if (!canMountUi()) return false;
    if (!hud.isConnected) {
      const stale = document.getElementById("agent-pilot-feedback-hud");
      if (stale && stale !== hud) stale.remove();
      (document.body || document.documentElement).appendChild(hud);
    }
    return true;
  }

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

    const hudItemCount = hud.querySelector("#ap-hud-item-count") || document.getElementById("ap-hud-item-count");
    if (hudItemCount) hudItemCount.textContent = text;

    const hudListCount = hud.querySelector("#ap-hud-list-count") || document.getElementById("ap-hud-list-count");
    if (hudListCount) hudListCount.textContent = String(count);

    const listTotalCount = window.__AP_INTERNAL__.feedbackStudio.modals?.listModal?.querySelector("#ap-list-total-count") || document.getElementById("ap-list-total-count");
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
    if (!ensureMounted()) return;
    hud.classList.remove("hidden");
    hud.style.display = "flex";
  }

  function hideHud() {
    hud.classList.add("hidden");
    hud.style.display = "none";
  }

  window.__AP_INTERNAL__.feedbackStudio.hud = {
    hud,
    ensureMounted,
    updateCounters,
    setMode,
    showHud,
    hideHud
  };
})();
