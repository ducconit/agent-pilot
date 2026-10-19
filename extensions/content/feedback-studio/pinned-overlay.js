/**
 * Agent Pilot - Feedback Studio Pinned Regions & Draft Highlight Layer
 * Renders persistent numbered pinned boxes on screen for annotated areas.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};
  window.__AP_INTERNAL__.feedbackStudio = window.__AP_INTERNAL__.feedbackStudio || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.fsPinned) return;
  window.__AP_INTERNAL__.__guards.fsPinned = true;

  // Setup DOM Elements
  const pinnedLayer = document.createElement("div");
  pinnedLayer.id = "agent-pilot-feedback-pinned-layer";
  pinnedLayer.className = "agent-pilot-feedback-pinned-layer hidden";
  document.documentElement.appendChild(pinnedLayer);

  const draftBox = document.createElement("div");
  draftBox.id = "agent-pilot-feedback-draft-box";
  draftBox.className = "ap-pinned-box draft hidden";
  draftBox.innerHTML = `<span class="ap-pinned-badge" id="ap-draft-badge">Đang soạn...</span>`;
  pinnedLayer.appendChild(draftBox);

  /**
   * Show animated draft box while user is writing comment for a selected region
   */
  function showDraftBox(clip, itemNumber) {
    if (!clip) return;
    const pageX = (clip.pageX !== undefined) ? clip.pageX : (clip.x + (clip.scrollX !== undefined ? clip.scrollX : window.scrollX));
    const pageY = (clip.pageY !== undefined) ? clip.pageY : (clip.y + (clip.scrollY !== undefined ? clip.scrollY : window.scrollY));

    draftBox.style.left = `${pageX}px`;
    draftBox.style.top = `${pageY}px`;
    draftBox.style.width = `${clip.width}px`;
    draftBox.style.height = `${clip.height}px`;

    const viewportY = (clip.y !== undefined) ? clip.y : (pageY - window.scrollY);
    // Flip-badge: the numbered badge normally sits just above the box. When the box is
    // near the top of the viewport (< 28px) there is no room, so we add a class that
    // moves the badge inside the box instead of letting it overflow off-screen.
    draftBox.classList.toggle("flip-badge-inside", viewportY < 28);
    const badgeEl = draftBox.querySelector("#ap-draft-badge");
    if (badgeEl) {
      badgeEl.textContent = `#${itemNumber} (Đang soạn...)`;
    }

    draftBox.classList.remove("hidden");
    pinnedLayer.classList.remove("hidden");
  }

  /**
   * Hide the active draft highlight
   */
  function hideDraftBox() {
    draftBox.classList.add("hidden");
    const items = window.__AP_INTERNAL__.feedbackStudio.state?.getItems() || [];
    const hasItemsWithClip = items.some((it) => it.clip && it.clip.width > 0);
    if (!hasItemsWithClip) {
      pinnedLayer.classList.add("hidden");
    }
  }

  /**
   * Render all persistent pinned boxes on the page
   */
  function renderPinnedBoxes() {
    // Remove all existing pinned boxes except draftBox
    pinnedLayer.querySelectorAll(".ap-pinned-box:not(#agent-pilot-feedback-draft-box)").forEach((el) => el.remove());

    const isFeedbackActive = window.__AP_INTERNAL__.feedbackStudio.state?.isActive() || false;
    if (!isFeedbackActive) {
      pinnedLayer.classList.add("hidden");
      draftBox.classList.add("hidden");
      return;
    }

    const items = window.__AP_INTERNAL__.feedbackStudio.state?.getItems() || [];
    const itemsWithClip = items.filter((it) => it.clip && it.clip.width > 0 && it.clip.height > 0);
    if (!itemsWithClip.length && draftBox.classList.contains("hidden")) {
      pinnedLayer.classList.add("hidden");
      return;
    }

    pinnedLayer.classList.remove("hidden");
    const constants = window.__AP_INTERNAL__.feedbackStudio.constants || {};
    const PIN_COLORS = constants.PIN_COLORS || [];
    const escapeHtml = constants.escapeHtml || ((s) => s);

    items.forEach((item, idx) => {
      if (!item.clip || !item.clip.width) return;
      const palette = PIN_COLORS[idx % PIN_COLORS.length] || { color: "#38bdf8", bg: "rgba(56, 189, 248, 0.12)", glow: "rgba(56, 189, 248, 0.3)" };
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

      // Same flip-badge rule as the draft box: keep the badge visible when the box
      // hugs the top edge of the viewport.
      const viewportY = (item.clip.y !== undefined) ? item.clip.y : (pageY - window.scrollY);
      if (viewportY < 28) {
        box.classList.add("flip-badge-inside");
      }

      const badge = document.createElement("span");
      badge.className = "ap-pinned-badge";
      badge.innerHTML = `
        <span class="ap-pinned-badge-num" title="Bấm để sửa ghi chú #${idx + 1}">#${idx + 1}</span>
        <span role="button" tabindex="0" class="ap-pinned-edit-btn" title="Sửa ghi chú #${idx + 1}">✏️</span>
        <span role="button" tabindex="0" class="ap-pinned-del-btn" title="Xóa vị trí #${idx + 1}">✕</span>
        ${item.comment ? `<div class="ap-pinned-tooltip" title="Bấm để sửa"><strong>#${idx + 1}:</strong> ${escapeHtml(item.comment)}</div>` : ""}
      `;

      const editBtn = badge.querySelector(".ap-pinned-edit-btn");
      if (editBtn) {
        editBtn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          const modals = window.__AP_INTERNAL__.feedbackStudio.modals;
          if (modals?.openEditCommentPopover) {
            modals.openEditCommentPopover(item, badge.getBoundingClientRect());
          }
        };
      }

      const numBtn = badge.querySelector(".ap-pinned-badge-num");
      if (numBtn) {
        numBtn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          const modals = window.__AP_INTERNAL__.feedbackStudio.modals;
          if (modals?.openEditCommentPopover) {
            modals.openEditCommentPopover(item, badge.getBoundingClientRect());
          }
        };
      }

      const delBtn = badge.querySelector(".ap-pinned-del-btn");
      if (delBtn) {
        delBtn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (window.__AP_INTERNAL__.feedbackStudio.actions?.deleteItem) {
            window.__AP_INTERNAL__.feedbackStudio.actions.deleteItem(item.id);
          }
        };
      }

      box.appendChild(badge);
      pinnedLayer.appendChild(box);
    });
  }

  window.__AP_INTERNAL__.feedbackStudio.pinned = {
    pinnedLayer,
    draftBox,
    showDraftBox,
    hideDraftBox,
    renderPinnedBoxes
  };
})();
