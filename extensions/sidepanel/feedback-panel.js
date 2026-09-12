/**
 * Agent Pilot - Side Panel Feedback Studio Coordinator
 * Coordinates Feedback Studio state, selection modes, and Channel C/B/A export actions.
 */

export class FeedbackPanel {
  constructor(uiHelpers) {
    this.ui = uiHelpers;
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
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id || null;
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
      console.warn("[AgentPilot] Tab message warning:", e);
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
      this.ui.showToast("Hãy mở một trang web để kích hoạt Feedback Studio!", "warning");
    }
  }

  updateActiveState(active) {
    this.isActive = Boolean(active);

    if (this.statusBadge) {
      this.statusBadge.textContent = this.isActive ? "Đang hoạt động" : "Đang tắt";
      this.statusBadge.className = this.isActive ? "card-badge badge-success" : "card-badge";
    }

    if (this.btnToggle) {
      this.btnToggle.textContent = this.isActive ? "✕ Ngừng Chế Độ Feedback" : "🎯 Bật Chế Độ Feedback";
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
      this.ui.showToast("📋 Đã sao chép toàn bộ Feedback vào Clipboard!");
    } else {
      this.ui.showToast("Không thể sao chép prompt từ tab này.", "warning");
    }
  }

  async deleteItem(id) {
    const res = await this.sendTabMessage({ action: "delete_feedback_item", id });
    if (res && res.success) {
      this.items = res.items || [];
      this.renderItemsList();
      this.ui.showToast("🗑️ Đã xóa mục feedback.");
    }
  }

  async clearAllItems() {
    const res = await this.sendTabMessage({ action: "clear_feedback_items" });
    if (res && res.success) {
      this.items = [];
      this.renderItemsList();
      this.ui.showToast("🗑️ Đã xóa toàn bộ feedback.");
    }
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
            <span class="badge-mini mode-${item.mode}">${item.mode.toUpperCase()}</span>
            <span class="feedback-card-title">#${idx + 1}. ${this.escapeHtml(item.title || "")}</span>
            <button class="btn btn-icon btn-xs btn-del-item" data-id="${item.id}" title="Xóa">🗑️</button>
          </div>
          ${item.component ? `
            <div class="feedback-comp-tag">
              ⚡ <strong>${this.escapeHtml(item.component.componentName || "")}</strong>
              ${item.component.fileName ? `<span class="font-mono text-xs">(${this.escapeHtml(item.component.fileName)})</span>` : ""}
            </div>
          ` : ""}
          <div class="feedback-comment-preview">
            "${this.escapeHtml(item.comment || "Không có ghi chú")}"
          </div>
        </div>
      `).join("");

      this.itemsList.querySelectorAll(".btn-del-item").forEach(btn => {
        btn.onclick = () => this.deleteItem(btn.dataset.id);
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
