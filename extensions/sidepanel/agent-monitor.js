/**
 * Agent Pilot - Side Panel AI Agent Monitor Module
 * Manages WebSocket bridge indicator, activity stream, Ping, and Self-Test suite
 */

import { showToast, formatParams } from "./ui-helpers.js";

export class AgentMonitor {
  constructor(options = {}) {
    this.getActiveTabId = options.getActiveTabId || (() => null);

    // DOM Elements
    this.agentBridgeDot = document.getElementById("agent-bridge-dot");
    this.agentBridgeText = document.getElementById("agent-bridge-text");
    this.inputBridgePort = document.getElementById("input-bridge-port");
    this.btnReconnectBridge = document.getElementById("btn-reconnect-bridge");

    this.agentStatusBadge = document.getElementById("agent-status-badge");
    this.agentInfoPort = document.getElementById("agent-info-port");
    this.agentInfoTarget = document.getElementById("agent-info-target");
    this.btnPingAgent = document.getElementById("btn-ping-agent");
    this.btnSelfTestAgent = document.getElementById("btn-self-test-agent");
    this.agentTestLog = document.getElementById("agent-test-log");

    this.agentActivityLog = document.getElementById("agent-activity-log");
    this.agentActivityCount = document.getElementById("agent-activity-count");
    this.btnClearAgentLog = document.getElementById("btn-clear-agent-log");
    this.btnCopyAgentLog = document.getElementById("btn-copy-agent-log");
    this.agentEmptyHint = document.getElementById("agent-empty-hint");

    // Secret Redaction Filter Elements
    this.toggleSecretFilter = document.getElementById("toggle-secret-filter");
    this.secretFilterBadge = document.getElementById("secret-filter-badge");
    this.secretWarningModal = document.getElementById("secret-warning-modal");
    this.btnCancelSecretDisable = document.getElementById("btn-cancel-secret-disable");
    this.btnConfirmSecretDisable = document.getElementById("btn-confirm-secret-disable");

    this.agentActivityTotal = 0;
    this.rawLogs = [];

    this.bindEvents();

    // Query initial secret filter state
    chrome.runtime.sendMessage({ action: "get_secret_filter_status" }, (res) => {
      if (res && res.enabled !== undefined) {
        this.updateSecretFilterUI(res.enabled);
      }
    });
  }

  bindEvents() {
    if (this.btnClearAgentLog) {
      this.btnClearAgentLog.onclick = () => {
        if (this.agentActivityLog) {
          this.agentActivityLog.innerHTML = `<div class="empty-hint" id="agent-empty-hint">Chưa có lệnh nào. Khi AI Agent gửi lệnh qua cổng 58765, hoạt động sẽ hiển thị tại đây.</div>`;
        }
        this.rawLogs = [];
        this.agentActivityTotal = 0;
        if (this.agentActivityCount) this.agentActivityCount.textContent = "0";
        showToast("Đã xóa nhật ký lệnh Agent");
      };
    }

    if (this.btnCopyAgentLog) {
      this.btnCopyAgentLog.onclick = async () => {
        if (!this.rawLogs || this.rawLogs.length === 0) {
          showToast("Nhật ký trống, không có gì để sao chép");
          return;
        }
        const text = this.rawLogs.map((log) => {
          const time = new Date(log.timestamp || Date.now()).toLocaleTimeString("vi-VN", { hour12: false });
          const status = log.status === "error" ? "✕ LỖI" : "✓ XONG";
          const paramsStr = typeof log.params === "object" ? JSON.stringify(log.params) : String(log.params || "");
          const err = log.error ? ` | Lỗi: ${log.error}` : "";
          return `[${time}] ${status} ${log.method || "unknown"}: ${paramsStr}${err}`;
        }).join("\n");

        try {
          await navigator.clipboard.writeText(text);
          showToast(`📋 Đã sao chép ${this.rawLogs.length} mục nhật ký`);
        } catch {
          showToast("Không thể sao chép vào clipboard");
        }
      };
    }

    if (this.btnPingAgent) {
      this.btnPingAgent.onclick = () => {
        chrome.runtime.sendMessage({ action: "get_agent_bridge_status" }, (status) => {
          if (status && status.connected) {
            showToast(`✓ Đã kết nối ổn định tới AI Agent (Cổng ${status.port})`);
          } else {
            showToast(`⚪ Chưa có AI Agent kết nối tại cổng ${status?.port || 58765}`);
          }
        });
      };
    }

    if (this.btnSelfTestAgent) {
      this.btnSelfTestAgent.onclick = () => this.runSelfTest();
    }

    if (this.btnReconnectBridge) {
      this.btnReconnectBridge.onclick = () => {
        chrome.runtime.sendMessage({ action: "reconnect_agent_bridge" }, () => {
          showToast("Đang kết nối lại AI Agent bridge...");
        });
      };
    }

    if (this.inputBridgePort) {
      this.inputBridgePort.onchange = () => {
        const port = Number(this.inputBridgePort.value);
        if (port > 1024 && port < 65536) {
          chrome.runtime.sendMessage({ action: "set_agent_bridge_port", port }, () => {
            showToast(`Đã đổi cổng AI Agent sang ${port}`);
          });
        } else {
          showToast("Cổng không hợp lệ (1024 - 65535)");
        }
      };
    }

    // Secret Redaction Filter Event Listeners
    if (this.toggleSecretFilter) {
      this.toggleSecretFilter.addEventListener("change", () => {
        if (!this.toggleSecretFilter.checked) {
          // Prevent immediate disable: show warning confirmation modal
          this.toggleSecretFilter.checked = true;
          this.showSecretWarningModal();
        } else {
          this.setSecretFilter(true);
        }
      });
    }

    if (this.btnCancelSecretDisable) {
      this.btnCancelSecretDisable.addEventListener("click", () => {
        this.hideSecretWarningModal();
        if (this.toggleSecretFilter) this.toggleSecretFilter.checked = true;
        showToast("🛡️ Đã giữ nguyên chế độ bảo vệ secret");
      });
    }

    if (this.btnConfirmSecretDisable) {
      this.btnConfirmSecretDisable.addEventListener("click", () => {
        this.hideSecretWarningModal();
        if (this.toggleSecretFilter) this.toggleSecretFilter.checked = false;
        this.setSecretFilter(false);
      });
    }
  }

  showSecretWarningModal() {
    if (this.secretWarningModal) this.secretWarningModal.style.display = "flex";
  }

  hideSecretWarningModal() {
    if (this.secretWarningModal) this.secretWarningModal.style.display = "none";
  }

  setSecretFilter(enabled) {
    chrome.runtime.sendMessage({ action: "set_secret_filter_status", enabled }, (res) => {
      const isEnabled = res && res.enabled !== undefined ? res.enabled : enabled;
      this.updateSecretFilterUI(isEnabled);
      if (isEnabled) {
        showToast("🛡️ Đã kích hoạt lớp lọc bảo vệ secret & API key");
      } else {
        showToast("⚠️ Đã TẮT lọc secret theo xác nhận của bạn");
      }
    });
  }

  updateSecretFilterUI(enabled) {
    const isEnabled = Boolean(enabled);
    if (this.toggleSecretFilter) {
      this.toggleSecretFilter.checked = isEnabled;
    }
    if (this.secretFilterBadge) {
      this.secretFilterBadge.textContent = isEnabled ? "Đang bảo vệ" : "Đã tắt";
      if (isEnabled) {
        this.secretFilterBadge.className = "card-badge badge-success";
      } else {
        this.secretFilterBadge.className = "card-badge badge-warning";
      }
    }
  }

  updateBridgeUI(status) {
    if (!status) return;
    if (this.agentBridgeDot && this.agentBridgeText) {
      if (status.connected) {
        this.agentBridgeDot.className = "status-dot connected";
        this.agentBridgeText.textContent = "AI Agent: Đã kết nối";
        this.agentBridgeText.style.color = "var(--accent-green)";
      } else {
        this.agentBridgeDot.className = "status-dot disconnected";
        this.agentBridgeText.textContent = "AI Agent: Chờ kết nối";
        this.agentBridgeText.style.color = "var(--text-secondary)";
      }
    }
    if (this.agentStatusBadge) {
      this.agentStatusBadge.textContent = status.connected ? "Đã kết nối" : "Chờ kết nối";
      this.agentStatusBadge.style.color = status.connected ? "var(--accent-green)" : "var(--text-muted)";
    }
    if (this.agentInfoPort && status.port) {
      this.agentInfoPort.textContent = `ws://127.0.0.1:${status.port}`;
    }
    if (this.inputBridgePort && status.port) {
      this.inputBridgePort.value = status.port;
    }
  }

  updateTargetTabDisplay(tab) {
    if (!this.agentInfoTarget || !tab) return;
    this.agentInfoTarget.textContent = `Tab ${tab.id}: ${tab.title || tab.url || "Untitled"}`;
  }

  addAgentActivityLog(item) {
    if (!this.agentActivityLog) return;
    const emptyHint = document.getElementById("agent-empty-hint");
    if (emptyHint) emptyHint.style.display = "none";

    this.rawLogs.unshift(item);
    if (this.rawLogs.length > 500) this.rawLogs.pop();

    this.agentActivityTotal++;
    if (this.agentActivityCount) this.agentActivityCount.textContent = this.agentActivityTotal;

    const row = document.createElement("div");
    row.className = "agent-activity-item";

    const timeStr = new Date(item.timestamp || Date.now()).toLocaleTimeString("vi-VN", { hour12: false });
    const isError = item.status === "error";

    const header = document.createElement("div");
    header.className = "agent-activity-header";

    const timeSpan = document.createElement("span");
    timeSpan.className = "agent-activity-time";
    timeSpan.textContent = timeStr;

    const methodSpan = document.createElement("span");
    methodSpan.className = "agent-activity-method";
    methodSpan.textContent = item.method || "unknown";

    const statusBadge = document.createElement("span");
    statusBadge.className = `agent-activity-status ${isError ? 'error' : 'success'}`;
    statusBadge.textContent = isError ? "✕ Lỗi" : "✓ Xong";

    header.appendChild(timeSpan);
    header.appendChild(methodSpan);
    header.appendChild(statusBadge);
    row.appendChild(header);

    const detail = document.createElement("div");
    detail.className = "agent-activity-detail";
    detail.textContent = formatParams(item.params);
    row.appendChild(detail);

    if (isError && item.error) {
      const errDetail = document.createElement("div");
      errDetail.style.color = "var(--accent-red)";
      errDetail.style.fontSize = "10px";
      errDetail.style.marginTop = "2px";
      errDetail.textContent = `Chi tiết lỗi: ${item.error}`;
      row.appendChild(errDetail);
    }

    this.agentActivityLog.prepend(row);
  }

  async runSelfTest() {
    if (!this.agentTestLog) return;
    this.agentTestLog.style.display = "block";
    this.agentTestLog.innerHTML = `<div style="color:var(--accent-cyan);font-weight:600;margin-bottom:4px;">🚀 Bắt đầu tự kiểm tra khả năng hoạt động của AI Agent...</div>`;

    const activeTabId = this.getActiveTabId();

    const steps = [
      {
        name: "1. Kiểm tra quyền truy cập tab đang mở",
        run: async () => {
          if (!activeTabId) throw new Error("Chưa xác định được tab. Vui lòng mở một trang web bình thường.");
          const tab = await chrome.tabs.get(activeTabId).catch(() => null);
          if (!tab) throw new Error("Không thể truy vấn thông tin tab.");
          if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:"))) {
            throw new Error("Không thể thao tác trên trang hệ thống nội bộ của trình duyệt. Hãy mở trang web bình thường.");
          }
          return `Tab ID: ${tab.id} - ${tab.title || tab.url}`;
        }
      },
      {
        name: "2. Kiểm tra nạp Content Script & API Chuột/Phím",
        run: async () => {
          const res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: "ensure_content_script", tabId: activeTabId }, resolve);
          });
          if (!res || !res.success) {
            throw new Error(res?.error || "Không thể nạp Content Script vào trang web.");
          }
          return "Content Script & Bridge API sẵn sàng";
        }
      },
      {
        name: "3. Kiểm tra kết nối Máy chủ Bridge (Port 58765)",
        run: async () => {
          const status = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: "get_agent_bridge_status" }, resolve);
          });
          if (!status || !status.connected) {
            throw new Error(`Máy chủ chưa kết nối. Hãy đảm bảo đã khởi chạy agent-pilot server trên cổng ${status?.port || 58765}.`);
          }
          return `Kết nối WebSocket mở tại ws://127.0.0.1:${status.port}`;
        }
      }
    ];

    let hasError = false;
    let failedReason = "";

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const logLine = document.createElement("div");
      logLine.style.fontSize = "11px";
      logLine.style.padding = "2px 0";
      logLine.textContent = `${step.name}...`;
      this.agentTestLog.appendChild(logLine);

      try {
        const detail = await step.run();
        logLine.textContent += ` ✓ Thành công (${detail})`;
        logLine.style.color = "var(--accent-green)";
      } catch (err) {
        hasError = true;
        failedReason = err.message;
        logLine.textContent += ` ✕ Lỗi: ${err.message}`;
        logLine.style.color = "var(--accent-red)";
        break; // Stop immediately upon error
      }
    }

    const summaryLine = document.createElement("div");
    summaryLine.style.marginTop = "6px";
    summaryLine.style.fontWeight = "bold";

    if (hasError) {
      summaryLine.style.color = "var(--accent-red)";
      summaryLine.textContent = `❌ Kiểm tra thất bại: ${failedReason}`;
    } else {
      summaryLine.style.color = "var(--accent-green)";
      summaryLine.textContent = "🎉 Toàn bộ hệ thống sẵn sàng 100% cho AI Agent thao tác!";
    }

    this.agentTestLog.appendChild(summaryLine);
    this.agentTestLog.scrollTop = this.agentTestLog.scrollHeight;
  }
}
