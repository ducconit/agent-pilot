/**
 * Agent Pilot - Feedback Studio Main Coordinator
 * Coordinates session lifecycle, actions, events, and exposes the public API on window.__AP_INTERNAL__.feedback.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};
  const studio = window.__AP_INTERNAL__.feedbackStudio || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.fsIndex) return;
  window.__AP_INTERNAL__.__guards.fsIndex = true;

  const constants = studio.constants || {};
  const state = studio.state;
  const hud = studio.hud;
  const pinned = studio.pinned;
  const modals = studio.modals;
  const selection = studio.selection;
  const channels = studio.channels;
  const showToast = constants.showToast || (() => {});

  // =========================================================================
  // Centralized Action Dispatchers
  // =========================================================================

  function notifyItemsUpdated() {
    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          action: "FEEDBACK_ITEMS_UPDATED",
          items: state.getItems()
        }).catch(() => {});
      }
    } catch (_) {}
  }

  function addItem(item) {
    const newItem = state.addItem(item);
    hud.updateCounters();
    pinned.renderPinnedBoxes();
    notifyItemsUpdated();
    showToast(`✓ Đã lưu vị trí #${state.getItems().length} vào danh sách!`);
    return newItem;
  }

  function deleteItem(id) {
    state.deleteItem(id);
    hud.updateCounters();
    pinned.renderPinnedBoxes();
    modals.renderItemsListModal();
    notifyItemsUpdated();
    showToast("🗑️ Đã xóa vị trí này.");
  }

  function updateComment(id, newComment) {
    const ok = state.updateComment(id, newComment);
    if (ok) {
      hud.updateCounters();
      pinned.renderPinnedBoxes();
      modals.renderItemsListModal();
      notifyItemsUpdated();
      showToast("✓ Đã cập nhật ghi chú!");
    }
  }

  function clearAll(skipConfirm = false) {
    if (skipConfirm || confirm("Bạn có chắc chắn muốn xóa toàn bộ danh sách chú thích?")) {
      state.clearAll();
      hud.updateCounters();
      pinned.renderPinnedBoxes();
      modals.renderItemsListModal();
      notifyItemsUpdated();
      showToast("🗑️ Đã xóa toàn bộ danh sách chú thích.");
    }
  }

  // Register internal actions for sub-modules
  studio.actions = {
    addItem,
    deleteItem,
    updateComment,
    clearAll
  };

  // =========================================================================
  // Wire HUD Button Actions
  // =========================================================================

  if (hud?.hud) {
    hud.hud.querySelectorAll(".ap-hud-btn").forEach((btn) => {
      btn.onclick = () => selection.setMode(btn.dataset.mode);
    });

    const btnClose = hud.hud.querySelector("#ap-hud-btn-close");
    if (btnClose) btnClose.onclick = stopFeedbackStudio;

    const btnCopy = hud.hud.querySelector("#ap-hud-btn-copy");
    if (btnCopy) btnCopy.onclick = () => channels.copyFeedbackPrompt();

    const btnInbox = hud.hud.querySelector("#ap-hud-btn-inbox");
    if (btnInbox) btnInbox.onclick = () => channels.saveFeedbackToInbox();

    const btnSend = hud.hud.querySelector("#ap-hud-btn-send");
    if (btnSend) btnSend.onclick = () => channels.pushFeedbackToAgent();

    const btnList = hud.hud.querySelector("#ap-hud-btn-list");
    if (btnList) btnList.onclick = () => modals.openListModal();
  }

  // =========================================================================
  // Global Keyboard Shortcuts (Escape Key Handling)
  // Attached only while the feedback session is active
  // =========================================================================

  function handleStudioEscapeKey(e) {
    if (e.key === "Escape" && state?.isActive()) {
      if (!modals.commentPopover.classList.contains("hidden")) {
        modals.closeCommentPopover();
      } else if (!modals.annotatorModal.classList.contains("hidden")) {
        modals.closeAnnotatorModal();
      } else if (!modals.listModal.classList.contains("hidden")) {
        modals.closeListModal();
      }
    }
  }

  function attachStudioKeyboardListener() {
    document.removeEventListener("keydown", handleStudioEscapeKey);
    document.addEventListener("keydown", handleStudioEscapeKey);
  }

  function detachStudioKeyboardListener() {
    document.removeEventListener("keydown", handleStudioEscapeKey);
  }

  // =========================================================================
  // Feedback Studio Session Lifecycle (Start & Stop)
  // =========================================================================

  function startFeedbackStudio() {
    if (window.__AP_INTERNAL__.isHtmlDocument && !window.__AP_INTERNAL__.isHtmlDocument()) {
      return;
    }
    if (state.isActive()) return;
    state.setActive(true);

    // Deactivate inspector / crop if active
    if (window.__AP_INTERNAL__.inspector?.toggleInspector) {
      window.__AP_INTERNAL__.inspector.toggleInspector(false);
    }

    hud.ensureMounted?.();
    pinned.ensureMounted?.();
    modals.ensureMounted?.();
    selection.ensureMounted?.();

    hud.showHud();
    pinned.renderPinnedBoxes();
    selection.setMode("element");
    selection.attachSelectionListeners();
    attachStudioKeyboardListener();

    showToast("✏️ Đã bật chế độ Chú thích & Chỉ điểm UI! Nhấp vào phần tử cần sửa.");
    chrome.runtime.sendMessage({ action: "FEEDBACK_MODE_CHANGED", active: true }).catch(() => {});
  }

  function stopFeedbackStudio() {
    if (!state.isActive()) return;
    state.setActive(false);

    hud.hideHud();
    selection.hideHighlighter();
    if (selection.cropOverlay) {
      selection.cropOverlay.classList.add("hidden");
      selection.cropOverlay.style.display = "none";
    }
    modals.closeAllModals();
    pinned.hideDraftBox();
    pinned.renderPinnedBoxes();
    selection.detachSelectionListeners();
    detachStudioKeyboardListener();

    showToast("✓ Đã thoát chế độ Chú thích UI.");
    chrome.runtime.sendMessage({ action: "FEEDBACK_MODE_CHANGED", active: false }).catch(() => {});
  }

  // =========================================================================
  // Expose Public API on window.__AP_INTERNAL__.feedback
  // =========================================================================

  window.__AP_INTERNAL__.feedback = {
    start: startFeedbackStudio,
    stop: stopFeedbackStudio,
    isActive: () => state.isActive(),
    getItems: () => state.getItems(),
    addItem,
    setMode: (mode) => selection.setMode(mode),
    copyPrompt: () => channels.copyFeedbackPrompt(),
    deleteItem,
    updateComment,
    clearAll: (skipConfirm = true) => clearAll(skipConfirm),
    generateMarkdownPrompt: (items) => channels.generateMarkdownPrompt(items),
    saveToInbox: () => channels.saveFeedbackToInbox(),
    pushToAgent: () => channels.pushFeedbackToAgent()
  };
})();
