/**
 * Agent Pilot - Side Panel Feedback Studio Coordinator
 * Coordinates Feedback Studio state, selection modes, and Channel C/B/A export actions.
 */

import { escapeHtml, sendTabMessageWithEnsure } from "./ui-helpers.js";

export class FeedbackPanel {
  constructor(options = {}) {
    this.ui = options.showToast ? { showToast: options.showToast } : options;
    this.getTabIdCallback = typeof options.getActiveTabId === "function" ? options.getActiveTabId : null;
    this.isActive = false;
    this.currentMode = "element";
    this.items = [];
    this.flowRecording = false;
    this.flowReplaying = false;
    this.flowSteps = [];

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

    this.btnRefreshQaDiag = document.getElementById("btn-refresh-qa-diag");
    this.qaFlowRecordBadge = document.getElementById("qa-flow-record-badge");
    this.qaConsoleErrCount = document.getElementById("qa-console-err-count");
    this.qaNetErrCount = document.getElementById("qa-net-err-count");
    this.qaReproStepCount = document.getElementById("qa-repro-step-count");
    this.qaDiagSummaryBox = document.getElementById("qa-diag-summary-box");

    this.btnToggleFlowRecord = document.getElementById("btn-toggle-flow-record");
    this.btnReplayFlow = document.getElementById("btn-replay-flow");
    this.qaFlowTimelineWrap = document.getElementById("qa-flow-timeline-wrap");
    this.qaFlowTimeline = document.getElementById("qa-flow-timeline");
    this.btnClearFlowSteps = document.getElementById("btn-clear-flow-steps");

    this.btnCopyReproBatch = document.getElementById("btn-copy-repro-batch");
    this.btnCopyPlaywright = document.getElementById("btn-copy-playwright");
    this.btnResetSiteStorage = document.getElementById("btn-reset-site-storage");
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

    if (this.btnRefreshQaDiag) {
      this.btnRefreshQaDiag.onclick = () => this.refreshDiagnostics({ silent: false });
    }
    if (this.btnToggleFlowRecord) {
      this.btnToggleFlowRecord.onclick = () => this.toggleFlowRecording();
    }
    if (this.btnReplayFlow) {
      this.btnReplayFlow.onclick = () => this.replayRecordedFlow();
    }
    if (this.btnClearFlowSteps) {
      this.btnClearFlowSteps.onclick = () => this.clearFlowSteps();
    }
    if (this.btnCopyReproBatch) {
      this.btnCopyReproBatch.onclick = () => this.copyReproBatch();
    }
    if (this.btnCopyPlaywright) {
      this.btnCopyPlaywright.onclick = () => this.copyPlaywrightScript();
    }
    if (this.btnResetSiteStorage) {
      this.btnResetSiteStorage.onclick = () => this.resetSiteStorage();
    }

    // Listen to messages from content script and background flow recorder
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === "FEEDBACK_MODE_CHANGED") {
        this.updateActiveState(msg.active);
      } else if (msg.action === "FEEDBACK_ITEMS_UPDATED") {
        this.items = msg.items || [];
        this.renderItemsList();
        this.refreshDiagnostics({ silent: true });
      } else if (msg.type === "FLOW_RECORDER_UPDATED") {
        this.getActiveTabId().then((activeTabId) => {
          if (!msg.tabId || !activeTabId || msg.replaying || msg.tabId === activeTabId) {
            this.applyFlowRecorderState(msg);
          }
        });
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

      const allTabs = await chrome.tabs.query({ active: true });
      const activeWeb = allTabs && allTabs.find(isWeb);
      if (activeWeb?.id) return activeWeb.id;
    } catch (_) {}

    return null;
  }

  async sendTabMessage(msg, { silent = false } = {}) {
    const tabId = await this.getActiveTabId();
    if (!tabId) {
      if (!silent) this.ui.showToast("Không tìm thấy tab web đang hoạt động!", "warning");
      return null;
    }
    return await sendTabMessageWithEnsure(tabId, msg, {
      silent,
      toastFn: (m, t) => this.ui.showToast(m, t)
    });
  }

  async refreshState({ silent = false } = {}) {
    const res = await this.sendTabMessage({ action: "get_feedback_studio_state" }, { silent });
    if (res && res.success) {
      this.updateActiveState(res.active);
      this.items = res.items || [];
      this.renderItemsList();
    }
    await this.refreshDiagnostics({ silent: true });
  }

  applyFlowRecorderState(state) {
    if (!state) return;
    this.flowRecording = Boolean(state.recording);
    this.flowReplaying = Boolean(state.replaying);
    if (Array.isArray(state.steps)) {
      this.flowSteps = state.steps;
    }
    const stepCount = this.flowSteps.length;

    if (this.qaReproStepCount) {
      this.qaReproStepCount.textContent = String(stepCount);
      this.qaReproStepCount.style.color = stepCount > 0 ? "#38bdf8" : "";
    }

    if (this.qaFlowRecordBadge) {
      if (this.flowReplaying) {
        this.qaFlowRecordBadge.textContent = "▶ Đang chạy lại";
        this.qaFlowRecordBadge.className = "card-badge badge-info";
      } else if (this.flowRecording) {
        this.qaFlowRecordBadge.textContent = "🔴 Đang ghi";
        this.qaFlowRecordBadge.className = "card-badge badge-active";
      } else {
        this.qaFlowRecordBadge.textContent = "Tự động";
        this.qaFlowRecordBadge.title = "Tự động ghi tối đa 100 bước gần nhất";
        this.qaFlowRecordBadge.className = "card-badge";
      }
    }

    if (this.btnToggleFlowRecord) {
      if (this.flowRecording) {
        this.btnToggleFlowRecord.textContent = "⏸ Dừng Ghi Kịch Bản";
        this.btnToggleFlowRecord.className = "btn btn-danger btn-sm";
      } else {
        this.btnToggleFlowRecord.textContent = "🔴 Bắt Đầu Ghi";
        this.btnToggleFlowRecord.className = "btn btn-outline btn-sm";
      }
      this.btnToggleFlowRecord.disabled = this.flowReplaying;
    }

    if (this.btnReplayFlow) {
      this.btnReplayFlow.disabled = this.flowReplaying || stepCount === 0;
      this.btnReplayFlow.textContent = this.flowReplaying ? "⏳ Đang Replay..." : `▶ Chạy Lại (${stepCount})`;
    }

    this.renderFlowTimeline(state.currentReplayStepId || null);
  }

  renderFlowTimeline(activeStepId = null) {
    if (!this.qaFlowTimelineWrap || !this.qaFlowTimeline) return;
    if (!this.flowSteps || this.flowSteps.length === 0) {
      this.qaFlowTimelineWrap.style.display = "none";
      this.qaFlowTimeline.innerHTML = "";
      return;
    }

    this.qaFlowTimelineWrap.style.display = "block";
    const rows = this.flowSteps.map((step, idx) => {
      const isCurrent = activeStepId && step.id === activeStepId;
      let icon = "🖱️";
      let color = "#e2e8f0";
      if (step.action === "navigate") {
        icon = "🌐";
        color = "#38bdf8";
      } else if (step.action === "type" || step.action === "select") {
        icon = "⌨️";
        color = "#a7f3d0";
      } else if (step.action === "press_key") {
        icon = "⏎";
        color = "#fde68a";
      }

      const bgStyle = isCurrent
        ? "background:rgba(56,189,248,0.18);border-left:2px solid #38bdf8;"
        : "border-bottom:1px solid rgba(148,163,184,0.12);";

      const subLocator = step.playwrightLocator || step.selector || step.url || "";
      return `
        <div class="flow-step-row" data-step-id="${this.escapeHtml(step.id || "")}" style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;padding:4px 4px;${bgStyle}">
          <div style="flex:1;min-width:0;word-break:break-word;">
            <div style="color:${color};line-height:1.35;">
              <strong>${idx + 1}.</strong> ${icon} ${this.escapeHtml(step.description || step.action)}
            </div>
            ${subLocator ? `<div class="font-mono" style="font-size:10px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escapeHtml(subLocator)}</div>` : ""}
          </div>
          <button class="btn btn-icon btn-xs btn-del-flow-step" data-step-id="${this.escapeHtml(step.id || "")}" title="Xóa bước này" style="padding:0 4px;font-size:11px;line-height:1;opacity:0.75;">×</button>
        </div>
      `;
    });

    this.qaFlowTimeline.innerHTML = rows.join("");
    this.qaFlowTimeline.scrollTop = this.qaFlowTimeline.scrollHeight;

    this.qaFlowTimeline.querySelectorAll(".btn-del-flow-step").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const stepId = btn.getAttribute("data-step-id");
        if (stepId) this.deleteSingleFlowStep(stepId);
      };
    });
  }

  async toggleFlowRecording() {
    const tabId = await this.getActiveTabId();
    const targetEnabled = !this.flowRecording;
    if (!tabId && !targetEnabled) {
      this.flowRecording = false;
      this.applyFlowRecorderState({ recording: false, replaying: false, steps: this.flowSteps });
      return;
    }

    let currentUrl = "";
    if (tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        currentUrl = tab?.url || "";
      } catch (_) {}
    }

    const res = await chrome.runtime.sendMessage({
      action: "set_flow_recording",
      tabId,
      enabled: targetEnabled,
      url: currentUrl
    });

    if (res && res.success) {
      this.applyFlowRecorderState(res);
      if (targetEnabled) {
        if (res.createdNewTab) {
          this.ui.showToast(`🆕 Đã tự mở Tab mới (#${res.tabId}) và bắt đầu ghi kịch bản!`);
        } else {
          this.ui.showToast("🔴 Đã bắt đầu ghi kịch bản xuyên trang! Hãy thao tác trên web.");
        }
      } else {
        this.ui.showToast(`⏸ Đã dừng ghi kịch bản (${this.flowSteps.length} bước).`);
      }
    } else {
      this.ui.showToast(`⚠️ Không thể bật ghi kịch bản: ${res?.error || "Lỗi không xác định"}`, "warning");
    }
  }

  async deleteSingleFlowStep(stepId) {
    const tabId = await this.getActiveTabId();
    const res = await chrome.runtime.sendMessage({
      action: "delete_flow_step",
      tabId,
      stepId
    });
    if (res && res.success) {
      this.applyFlowRecorderState(res);
    }
  }

  async clearFlowSteps() {
    const tabId = await this.getActiveTabId();
    if (tabId) {
      await this.sendTabMessage({ action: "get_page_diagnostics", clear: true }, { silent: true });
    }
    const res = await chrome.runtime.sendMessage({
      action: "clear_flow_steps",
      tabId
    });
    if (res && res.success) {
      this.applyFlowRecorderState(res);
      this.ui.showToast("🗑️ Đã xóa danh sách bước kịch bản.");
    }
  }

  async replayRecordedFlow() {
    if (this.flowSteps.length === 0) {
      this.ui.showToast("Chưa có bước nào được ghi nhận!", "warning");
      return;
    }

    const tabId = await this.getActiveTabId();
    if (!tabId) {
      this.ui.showToast(`🆕 Tab cũ không tồn tại — đang tự mở Tab mới và chạy Replay (${this.flowSteps.length} bước)...`);
    } else {
      this.ui.showToast(`▶ Đang chạy lại kịch bản (${this.flowSteps.length} bước)...`);
    }

    const res = await chrome.runtime.sendMessage({
      action: "replay_flow_recorder",
      tabId,
      steps: this.flowSteps
    });
    if (res && res.success) {
      if (res.createdNewTab) {
        this.ui.showToast(`🆕 Đã tự mở Tab mới (#${res.tabId}) và Replay thành công (${res.executedSteps}/${res.totalSteps} bước)!`);
      } else {
        this.ui.showToast(`✅ Hoàn tất Replay thành công (${res.executedSteps}/${res.totalSteps} bước)!`);
      }
    } else {
      this.ui.showToast(`⚠️ Replay dừng tại bước ${(res?.executedSteps || 0) + 1}: ${res?.error || "Lỗi không xác định"}`, "warning");
    }
    await this.refreshDiagnostics({ silent: true });
  }

  async refreshDiagnostics({ silent = true } = {}) {
    const tabId = await this.getActiveTabId();
    try {
      const flowRes = await chrome.runtime.sendMessage({
        action: "get_flow_recorder_state",
        tabId
      });
      if (flowRes && flowRes.success) {
        this.applyFlowRecorderState(flowRes);
      }
    } catch (_) {}

    if (!tabId) return;
    const res = await this.sendTabMessage({ action: "get_page_diagnostics" }, { silent });
    if (!res || !res.success || !res.diagnostics) return;
    const diag = res.diagnostics;
    const cCount = Array.isArray(diag.consoleErrors) ? diag.consoleErrors.length : 0;
    const nCount = Array.isArray(diag.networkErrors) ? diag.networkErrors.length : 0;
    const sCount = this.flowSteps.length || (Array.isArray(diag.reproSteps) ? diag.reproSteps.length : 0);

    if (this.qaConsoleErrCount) {
      this.qaConsoleErrCount.textContent = String(cCount);
      this.qaConsoleErrCount.style.color = cCount > 0 ? "#f87171" : "";
    }
    if (this.qaNetErrCount) {
      this.qaNetErrCount.textContent = String(nCount);
      this.qaNetErrCount.style.color = nCount > 0 ? "#fbbf24" : "";
    }
    if (this.qaReproStepCount) {
      this.qaReproStepCount.textContent = String(sCount);
      this.qaReproStepCount.style.color = sCount > 0 ? "#38bdf8" : "";
    }

    if (this.qaDiagSummaryBox) {
      const lines = [];
      if (cCount > 0) {
        diag.consoleErrors.slice(-3).forEach((err) => {
          lines.push(`<div style="color:#f87171;margin-bottom:3px;">🚨 <strong>[${this.escapeHtml(err.type || "error")}]</strong> ${this.escapeHtml(err.message.slice(0, 120))}</div>`);
        });
      }
      if (nCount > 0) {
        diag.networkErrors.slice(-3).forEach((net) => {
          lines.push(`<div style="color:#fbbf24;margin-bottom:3px;">🌐 <strong>[${this.escapeHtml(String(net.status || "ERR"))}]</strong> ${this.escapeHtml(net.method)} ${this.escapeHtml(net.url.slice(0, 90))}</div>`);
        });
      }
      if (lines.length > 0) {
        const headerHtml = `<div style="font-size:10px;font-weight:600;color:#94a3b8;margin-bottom:4px;border-bottom:1px dashed rgba(148,163,184,0.2);padding-bottom:2px;">📡 Lỗi của trang web đang mở (Website Console / Network):</div>`;
        this.qaDiagSummaryBox.innerHTML = headerHtml + lines.join("");
        this.qaDiagSummaryBox.style.display = "block";
      } else {
        this.qaDiagSummaryBox.innerHTML = "";
        this.qaDiagSummaryBox.style.display = "none";
      }
    }

    if (!silent) {
      this.ui.showToast(`🩺 Đã cập nhật: ${cCount} lỗi Console, ${nCount} lỗi mạng, ${sCount} bước kịch bản.`);
    }
  }

  async copyReproBatch() {
    const tabId = await this.getActiveTabId();
    let tabUrl = "";
    let tabTitle = "";
    if (tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        tabUrl = tab?.url || "";
        tabTitle = tab?.title || "";
      } catch (_) {}
    }

    const res = await chrome.runtime.sendMessage({
      action: "export_flow_recorder",
      tabId,
      url: tabUrl,
      title: tabTitle,
      steps: this.flowSteps
    });

    if (!res || !res.success || !res.batch || !Array.isArray(res.batch.actions) || res.batch.actions.length === 0) {
      this.ui.showToast("Chưa có bước thao tác nào để xuất kịch bản Batch JSON!", "warning");
      return;
    }
    const jsonText = JSON.stringify(res.batch, null, 2);
    try {
      await navigator.clipboard.writeText(jsonText);
      this.ui.showToast(`📋 Đã copy kịch bản Batch JSON (${res.batch.actions.length} bước) vào Clipboard!`);
    } catch (_) {
      this.ui.showToast("Không thể sao chép kịch bản vào Clipboard!", "warning");
    }
  }

  async copyPlaywrightScript() {
    const tabId = await this.getActiveTabId();
    let tabUrl = "";
    if (tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        tabUrl = tab?.url || "";
      } catch (_) {}
    }

    const res = await chrome.runtime.sendMessage({
      action: "export_flow_recorder",
      tabId,
      url: tabUrl,
      steps: this.flowSteps
    });

    if (!res || !res.success || !res.playwright || !Array.isArray(res.steps) || res.steps.length === 0) {
      this.ui.showToast("Chưa có bước thao tác nào để xuất Playwright script!", "warning");
      return;
    }
    try {
      await navigator.clipboard.writeText(res.playwright);
      this.ui.showToast(`🎭 Đã copy kịch bản Playwright (${res.steps.length} bước) vào Clipboard!`);
    } catch (_) {
      this.ui.showToast("Không thể sao chép vào Clipboard!", "warning");
    }
  }

  async resetSiteStorage() {
    const tabId = await this.getActiveTabId();
    if (!tabId) {
      this.ui.showToast("Không tìm thấy tab web đang hoạt động!", "warning");
      return;
    }
    const res = await this.sendTabMessage({
      action: "get_page_diagnostics",
      clear: true,
      clearStorage: true
    });
    await chrome.runtime.sendMessage({ action: "clear_flow_steps", tabId }).catch(() => {});
    if (res && res.success) {
      if (this.qaConsoleErrCount) this.qaConsoleErrCount.textContent = "0";
      if (this.qaNetErrCount) this.qaNetErrCount.textContent = "0";
      if (this.qaReproStepCount) this.qaReproStepCount.textContent = "0";
      try {
        await chrome.tabs.reload(tabId);
      } catch (_) {}
      setTimeout(() => {
        this.refreshDiagnostics({ silent: true });
      }, 600);
      this.ui.showToast("🧹 Đã xóa sạch Storage/Cookies của trang và tải lại phiên mới!");
    } else {
      this.ui.showToast("Không thể xóa dữ liệu trên trang này.", "warning");
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
      this.itemsList.innerHTML = this.items.map((item, idx) => {
        const safeId = this.escapeHtml(item.id);
        const mode = ["element", "region", "screen", "fullpage"].includes(item.mode) ? item.mode : "element";
        return `
        <div class="feedback-card" data-id="${safeId}">
          <div class="feedback-card-header">
            <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">
              <span class="badge-mini mode-${mode}">${mode.toUpperCase()}</span>
              <span class="feedback-card-title">#${idx + 1}. ${this.escapeHtml(item.title || "")}</span>
            </div>
            <div class="feedback-card-actions">
              <button class="btn btn-icon btn-xs btn-edit-item" data-id="${safeId}" title="Sửa ghi chú">✏️</button>
              <button class="btn btn-icon btn-xs btn-del-item" data-id="${safeId}" title="Xóa">🗑️</button>
            </div>
          </div>
          ${item.component ? `
            <div class="feedback-comp-tag">
              ⚡ <strong>${this.escapeHtml(item.component.componentName || "")}</strong>
              ${item.component.fileName ? `<span class="font-mono text-xs">(${this.escapeHtml(item.component.fileName)})</span>` : ""}
            </div>
          ` : ""}
          <div class="feedback-comment-container">
            <div class="feedback-comment-preview" id="side-comment-view-${safeId}" data-id="${safeId}" title="Bấm để sửa ghi chú">
              "${this.escapeHtml(item.comment || "Không có ghi chú")}"
            </div>
            <div class="feedback-comment-edit hidden" id="side-comment-edit-${safeId}">
              <textarea class="side-comment-textarea" rows="2" placeholder="Nhập ghi chú cần sửa...">${this.escapeHtml(item.comment || "")}</textarea>
              <div class="side-comment-actions">
                <button class="btn btn-primary btn-xs btn-save-comment" data-id="${safeId}">✓ Lưu</button>
                <button class="btn btn-outline btn-xs btn-cancel-comment" data-id="${safeId}">Hủy</button>
              </div>
            </div>
          </div>
        </div>
      `;
      }).join("");

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
          const editBox = document.getElementById("side-comment-edit-" + id);
          const textarea = editBox ? editBox.querySelector("textarea") : null;
          const newText = textarea ? textarea.value.trim() : "";
          this.updateComment(id, newText);
        };
      });
    }
  }

  escapeHtml(str) {
    return escapeHtml(str);
  }
}
