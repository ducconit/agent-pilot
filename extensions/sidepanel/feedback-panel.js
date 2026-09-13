/**
 * Agent Pilot - Side Panel Feedback Studio Coordinator
 * Coordinates Feedback Studio state, selection modes, and Channel C/B/A export actions.
 */

export class FeedbackPanel {
  constructor(options = {}) {
    this.ui = options.showToast ? { showToast: options.showToast } : options;
    this.getTabIdCallback = typeof options.getActiveTabId === "function" ? options.getActiveTabId : null;
    this.isActive = false;
    this.currentMode = "element";
    this.items = [];

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.btnToggle = document.getElementById("btn-toggle-feedback");
    this.btnCopyPrompt = document.getElementById("btn-copy-feedback-prompt");
    this.btnSaveInbox = document.getElementById("btn-save-feedback-inbox");
    this.btnPushAgent = document.getElementById("btn-push-feedback-agent");
    this.statusBadge = document.getElementById("feedback-status-badge");
    this.cardTools = document.getElementById("card-feedback-tools");
    this.currentModeBadge = document.getElementById("feedback-current-mode-badge");
    this.itemsCounter = document.getElementById("feedback-items-counter");
    this.btnClearList = document.getElementById("btn-clear-feedback-list");
    this.emptyState = document.getElementById("feedback-empty-state");
    this.itemsList = document.getElementById("feedback-items-list");

    this.btnModeElement = document.getElementById("btn-panel-mode-element");
    this.btnModeRegion = document.getElementById("btn-panel-mode-region");
    this.btnModeScreen = document.getElementById("btn-panel-mode-screen");
    this.btnModeFullpage = document.getElementById("btn-panel-mode-fullpage");
  }

  bindEvents() {
    if (this.btnToggle) {
      this.btnToggle.onclick = () => this.toggleFeedbackStudio();
    }

    if (this.btnCopyPrompt) {
      this.btnCopyPrompt.onclick = () => this.copyPromptToClipboard();
    }

    if (this.btnSaveInbox) {
      this.btnSaveInbox.onclick = () => this.saveToInbox();
    }

    if (this.btnPushAgent) {
      this.btnPushAgent.onclick = () => this.pushToAgent();
    }

    if (this.btnClearList) {
      this.btnClearList.onclick = () => this.clearAllItems();
    }

    if (this.btnModeElement) {
      this.btnModeElement.onclick = () => this.setMode("element");
    }
    if (this.btnModeRegion) {
      this.btnModeRegion.onclick = () => this.setMode("region");
    }
    if (this.btnModeScreen) {
      this.btnModeScreen.onclick = () => this.setMode("screen");
    }
    if (this.btnModeFullpage) {
      this.btnModeFullpage.onclick = () => this.setMode("fullpage");
    }

    // Listen to messages from content script
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === "FEEDBACK_MODE_CHANGED") {
        this.updateActiveState(msg.active);
      } else if (msg.action === "FEEDBACK_ITEMS_UPDATED") {
        this.items = msg.items || [];
        this.renderItemsList();
      }
    });
  }

  async getActiveTabId() {
    const isWeb = (t) => t && t.url && (t.url.startsWith("http://") || t.url.startsWith("https://") || t.url.startsWith("file://"));

    if (this.getTabIdCallback) {
      try {
        const id = await this.getTabIdCallback();
        if (id) {
          try {
            const tab = await chrome.tabs.get(id);
            if (isWeb(tab)) return id;
          } catch (_) {}
        }
      } catch (_) {}
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const webTab = tabs && tabs.find(isWeb);
      if (webTab?.id) return webTab.id;

      const allTabs = await chrome.tabs.query({});
      const activeWeb = allTabs && allTabs.find(t => t.active && isWeb(t));
      if (activeWeb?.id) return activeWeb.id;

      const candidate = allTabs && allTabs.find(isWeb);
      if (candidate?.id) return candidate.id;
    } catch (_) {}

    return null;
  }

  async sendTabMessage(msg) {
    const tabId = await this.getActiveTabId();
    if (!tabId) {
      this.ui.showToast("Không tìm thấy tab web đang hoạt động!", "warning");
      return null;
    }
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      console.warn("[AgentPilot] Tab message warning:", tabId, msg, e);
      return null;
    }
  }

  async refreshState() {
    const res = await this.sendTabMessage({ action: "get_feedback_studio_state" });
    if (res && res.success) {
      this.updateActiveState(res.active);
      this.items = res.items || [];
      this.renderItemsList();
    }
  }

  async toggleFeedbackStudio() {
    const targetState = !this.isActive;
    const res = await this.sendTabMessage({
      action: "toggle_feedback_studio",
      enabled: targetState
    });

    if (res && res.success) {
      this.updateActiveState(res.active);
      if (res.items) {
        this.items = res.items;
        this.renderItemsList();
      }
    } else {
      this.ui.showToast("Hãy mở một trang web để kích hoạt chế độ Chú thích UI!", "warning");
    }
  }

  updateActiveState(active) {
    this.isActive = Boolean(active);

    if (this.statusBadge) {
      this.statusBadge.textContent = this.isActive ? "Đang hoạt động" : "Đang tắt";
      this.statusBadge.className = this.isActive ? "card-badge badge-success" : "card-badge";
    }

    if (this.btnToggle) {
      this.btnToggle.textContent = this.isActive ? "🛑 Dừng Chú Thích" : "✏️ Bật Chế Độ Chú Thích";
      this.btnToggle.className = this.isActive ? "btn btn-danger-outline" : "btn btn-primary";
    }

    if (this.cardTools) {
      this.cardTools.style.display = this.isActive ? "block" : "none";
    }
  }

  async setMode(mode) {
    this.currentMode = mode;
    const modeNames = {
      element: "Phần tử",
      region: "Vùng chọn",
      screen: "Màn hình",
      fullpage: "Toàn trang"
    };

    if (this.currentModeBadge) {
      this.currentModeBadge.textContent = modeNames[mode] || mode;
    }

    // Highlight active button
    [this.btnModeElement, this.btnModeRegion, this.btnModeScreen, this.btnModeFullpage].forEach(btn => {
      if (btn) btn.classList.remove("btn-primary");
    });

    if (mode === "element" && this.btnModeElement) this.btnModeElement.classList.add("btn-primary");
    if (mode === "region" && this.btnModeRegion) this.btnModeRegion.classList.add("btn-primary");
    if (mode === "screen" && this.btnModeScreen) this.btnModeScreen.classList.add("btn-primary");
    if (mode === "fullpage" && this.btnModeFullpage) this.btnModeFullpage.classList.add("btn-primary");

    await this.sendTabMessage({ action: "set_feedback_mode", mode });
  }

  async copyPromptToClipboard() {
    const res = await this.sendTabMessage({ action: "copy_feedback_prompt" });
    if (res && res.success) {
      this.ui.showToast("📋 Đã sao chép prompt chú thích UI vào Clipboard!");
    } else {
      this.ui.showToast("Không thể sao chép prompt từ tab này.", "warning");
    }
  }

  async saveToInbox() {
    const res = await this.sendTabMessage({ action: "save_feedback_inbox_tab" });
    if (res && res.success) {
      if (res.storage === "filesystem") {
        this.ui.showToast(`✓ Đã lưu ${this.items.length} vị trí vào inbox ~/.agent-pilot/inbox/feedback/!`);
      } else {
        this.ui.showToast(`✓ Đã lưu ${this.items.length} vị trí vào bộ nhớ Extension!`);
      }
    } else {
      this.ui.showToast(`Lỗi: ${res?.error || "Không thể lưu inbox"}`, "warning");
    }
  }

  async pushToAgent() {
    const res = await this.sendTabMessage({ action: "push_feedback_agent_tab" });
    if (res && res.success) {
      this.ui.showToast(`🚀 Đã gửi trực tiếp ${this.items.length} vị trí cần sửa cho Agent!`);
    } else {
      this.ui.showToast(`Lỗi: ${res?.error || "Không có agent nào đang lắng nghe"}`, "warning");
    }
  }

  async deleteItem(id) {
    const res = await this.sendTabMessage({ action: "delete_feedback_item", id });
    if (res && res.success) {
      this.items = res.items || [];
    } else {
      this.items = this.items.filter(it => it.id !== id);
    }
    this.renderItemsList();
    this.ui.showToast("🗑️ Đã xóa vị trí này.");
  }

  async updateComment(id, newComment) {
    const res = await this.sendTabMessage({ action: "update_feedback_comment", id, comment: newComment });
    if (res && res.success) {
      this.items = res.items || [];
    } else {
      const target = this.items.find(it => it.id === id);
      if (target) target.comment = newComment;
    }
    this.renderItemsList();
    this.ui.showToast("✓ Đã cập nhật ghi chú!");
  }

  showEditForm(id) {
    const viewEl = document.getElementById(`side-comment-view-${id}`);
    const editEl = document.getElementById(`side-comment-edit-${id}`);
    if (viewEl) viewEl.classList.add("hidden");
    if (editEl) {
      editEl.classList.remove("hidden");
      const ta = editEl.querySelector("textarea");
      if (ta) {
        ta.focus();
        ta.select();
      }
    }
  }

  hideEditForm(id) {
    const viewEl = document.getElementById(`side-comment-view-${id}`);
    const editEl = document.getElementById(`side-comment-edit-${id}`);
    if (viewEl) viewEl.classList.remove("hidden");
    if (editEl) {
      editEl.classList.add("hidden");
      const ta = editEl.querySelector("textarea");
      const item = this.items.find(i => i.id === id);
      if (ta && item) {
        ta.value = item.comment || "";
      }
    }
  }

  async clearAllItems() {
    const res = await this.sendTabMessage({ action: "clear_feedback_items" });
    if (res && res.success) {
      this.items = [];
    } else {
      this.items = [];
    }
    this.renderItemsList();
    this.ui.showToast("🗑️ Đã xóa toàn bộ danh sách.");
  }

  renderItemsList() {
    const count = this.items.length;
    if (this.itemsCounter) this.itemsCounter.textContent = String(count);

    const hasItems = count > 0;
    if (this.btnCopyPrompt) this.btnCopyPrompt.disabled = !hasItems;
    if (this.btnSaveInbox) this.btnSaveInbox.disabled = !hasItems;
    if (this.btnPushAgent) this.btnPushAgent.disabled = !hasItems;
    if (this.btnClearList) this.btnClearList.style.display = hasItems ? "inline-flex" : "none";

    if (!hasItems) {
      if (this.emptyState) this.emptyState.style.display = "flex";
      if (this.itemsList) this.itemsList.style.display = "none";
      return;
    }

    if (this.emptyState) this.emptyState.style.display = "none";
    if (this.itemsList) {
      this.itemsList.style.display = "flex";
      this.itemsList.innerHTML = this.items.map((item, idx) => `
        <div class="feedback-card" data-id="${item.id}">
          <div class="feedback-card-header">
            <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">
              <span class="badge-mini mode-${item.mode}">${item.mode.toUpperCase()}</span>
              <span class="feedback-card-title">#${idx + 1}. ${this.escapeHtml(item.title || "")}</span>
            </div>
            <div class="feedback-card-actions">
              <button class="btn btn-icon btn-xs btn-edit-item" data-id="${item.id}" title="Sửa ghi chú">✏️</button>
              <button class="btn btn-icon btn-xs btn-del-item" data-id="${item.id}" title="Xóa">🗑️</button>
            </div>
          </div>
          ${item.component ? `
            <div class="feedback-comp-tag">
              ⚡ <strong>${this.escapeHtml(item.component.componentName || "")}</strong>
              ${item.component.fileName ? `<span class="font-mono text-xs">(${this.escapeHtml(item.component.fileName)})</span>` : ""}
            </div>
          ` : ""}
          <div class="feedback-comment-container">
            <div class="feedback-comment-preview" id="side-comment-view-${item.id}" data-id="${item.id}" title="Bấm để sửa ghi chú">
              "${this.escapeHtml(item.comment || "Không có ghi chú")}"
            </div>
            <div class="feedback-comment-edit hidden" id="side-comment-edit-${item.id}">
              <textarea class="side-comment-textarea" rows="2" placeholder="Nhập ghi chú cần sửa...">${this.escapeHtml(item.comment || "")}</textarea>
              <div class="side-comment-actions">
                <button class="btn btn-primary btn-xs btn-save-comment" data-id="${item.id}">✓ Lưu</button>
                <button class="btn btn-outline btn-xs btn-cancel-comment" data-id="${item.id}">Hủy</button>
              </div>
            </div>
          </div>
        </div>
      `).join("");

      this.itemsList.querySelectorAll(".btn-del-item").forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          this.deleteItem(btn.dataset.id);
        };
      });

      this.itemsList.querySelectorAll(".btn-edit-item").forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          this.showEditForm(btn.dataset.id);
        };
      });

      this.itemsList.querySelectorAll(".feedback-comment-preview").forEach(preview => {
        preview.onclick = () => {
          this.showEditForm(preview.dataset.id);
        };
      });

      this.itemsList.querySelectorAll(".btn-cancel-comment").forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          this.hideEditForm(btn.dataset.id);
        };
      });

      this.itemsList.querySelectorAll(".btn-save-comment").forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const textarea = document.querySelector(`#side-comment-edit-${id} textarea`);
          const newText = textarea ? textarea.value.trim() : "";
          this.updateComment(id, newText);
        };
      });
    }
  }

  escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
