/**
 * Agent Pilot - Side Panel Logic Controller (Modular Coordinator)
 * Coordinates AI Agent Monitor, DOM Inspector, and Screenshot Studio
 */

import { showToast } from "./sidepanel/ui-helpers.js";
import { AgentMonitor } from "./sidepanel/agent-monitor.js";
import { InspectorPanel } from "./sidepanel/inspector-panel.js";
import { ScreenshotPanel } from "./sidepanel/screenshot-panel.js";

(function () {
  let activeTabId = null;
  let isCdpAttached = false;

  // Header & Navigation DOM Elements
  const cdpStatusDot = document.getElementById("cdp-status-dot");
  const btnToggleCdp = document.getElementById("btn-toggle-cdp");
  const activeTabTitle = document.getElementById("active-tab-title");
  const inputUrl = document.getElementById("input-url");
  const btnNavigate = document.getElementById("btn-navigate");

  // Main Tabs Nav
  const tabBtns = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".panel");

  // Initialize Subsystem Panels
  const agentMonitor = new AgentMonitor({
    getActiveTabId: () => activeTabId
  });

  let inspectorPanel;
  const screenshotPanel = new ScreenshotPanel({
    getActiveTabId: () => activeTabId,
    getSelectedElementDetails: () => (inspectorPanel ? inspectorPanel.getSelectedElementDetails() : null)
  });

  inspectorPanel = new InspectorPanel({
    getActiveTabId: () => activeTabId,
    onCaptureElement: (rect) => screenshotPanel.captureElementScreenshot(rect)
  });

  // =========================================================================
  // 1. Tab & Navigation Handling
  // =========================================================================

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add("active");
    });
  });

  async function updateActiveTab() {
    chrome.runtime.sendMessage({ action: "get_active_tab" }, (res) => {
      if (res && res.tab) {
        activeTabId = res.tab.id;
        if (activeTabTitle) activeTabTitle.textContent = res.tab.title || "Tab không tên";
        if (inputUrl) inputUrl.value = res.tab.url || "";
        agentMonitor.updateTargetTabDisplay(res.tab);
        checkCdpStatus();
      }
    });
  }

  // Sync when user changes tabs in Chrome
  chrome.tabs.onActivated.addListener(updateActiveTab);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === activeTabId && changeInfo.title && activeTabTitle) {
      activeTabTitle.textContent = changeInfo.title;
    }
  });

  if (btnNavigate) {
    btnNavigate.onclick = () => {
      if (!activeTabId || !inputUrl || !inputUrl.value) return;
      chrome.runtime.sendMessage({ action: "navigate", tabId: activeTabId, url: inputUrl.value }, () => {
        showToast("Đang điều hướng...");
      });
    };
  }

  if (inputUrl) {
    inputUrl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && btnNavigate) btnNavigate.click();
    });
  }

  // =========================================================================
  // 2. CDP Debugger State Management
  // =========================================================================

  function checkCdpStatus() {
    if (!activeTabId) return;
    chrome.runtime.sendMessage({ action: "get_debugger_status", tabId: activeTabId }, (res) => {
      setCdpState(res && res.attached);
    });
  }

  function setCdpState(attached) {
    isCdpAttached = !!attached;
    if (isCdpAttached) {
      if (cdpStatusDot) cdpStatusDot.classList.add("connected");
      if (btnToggleCdp) {
        btnToggleCdp.textContent = "Ngắt CDP";
        btnToggleCdp.classList.add("btn-danger");
        btnToggleCdp.classList.remove("btn-outline");
      }
    } else {
      if (cdpStatusDot) cdpStatusDot.classList.remove("connected");
      if (btnToggleCdp) {
        btnToggleCdp.textContent = "Gắn CDP";
        btnToggleCdp.classList.remove("btn-danger");
        btnToggleCdp.classList.add("btn-outline");
      }
    }
  }

  if (btnToggleCdp) {
    btnToggleCdp.onclick = () => {
      if (!activeTabId) return;
      if (isCdpAttached) {
        chrome.runtime.sendMessage({ action: "detach_debugger", tabId: activeTabId }, () => {
          setCdpState(false);
          showToast("Đã ngắt kết nối CDP.");
        });
      } else {
        chrome.runtime.sendMessage({ action: "attach_debugger", tabId: activeTabId }, (res) => {
          if (res && res.success) {
            setCdpState(true);
            showToast("Đã gắn kết nối CDP (Sẵn sàng điều khiển qua Agent)!");
          } else {
            showToast("Lỗi gắn CDP: " + (res ? res.error : "Không xác định"));
          }
        });
      }
    };
  }

  // =========================================================================
  // 3. Global Messages Router
  // =========================================================================

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "DEBUGGER_STATUS_CHANGED") {
      if (msg.tabId === activeTabId) {
        setCdpState(msg.attached);
      }
    }

    if (msg.type === "ELEMENT_SELECTED" && msg.details) {
      inspectorPanel.displayElementDetails(msg.details);
      const inspectorTabBtn = document.querySelector('[data-tab="tab-inspector"]');
      if (inspectorTabBtn) inspectorTabBtn.click();
    }

    if (msg.type === "COLOR_PICKED" && msg.color) {
      inspectorPanel.addColorToPalette(msg.color);
      const inspectorTabBtn = document.querySelector('[data-tab="tab-inspector"]');
      if (inspectorTabBtn) inspectorTabBtn.click();
    }

    if (msg.type === "REGION_CROP_REQUESTED" && msg.clip) {
      chrome.runtime.sendMessage({ action: "capture_screenshot", mode: "visible" }, (res) => {
        if (res && res.success && res.dataUrl) {
          screenshotPanel.cropImageViaCanvas(res.dataUrl, msg.clip);
        }
      });
    }

    if (msg.type === "AGENT_BRIDGE_STATUS_CHANGED" && msg.status) {
      agentMonitor.updateBridgeUI(msg.status);
    }

    if (msg.type === "AGENT_ACTION_LOG" && msg.log) {
      agentMonitor.addAgentActivityLog(msg.log);
    }

    if (msg.type === "SECRET_FILTER_STATUS_CHANGED" && msg.enabled !== undefined) {
      agentMonitor.updateSecretFilterUI(msg.enabled);
    }
  });

  // =========================================================================
  // 4. Initial Bootstrap
  // =========================================================================

  updateActiveTab();
  chrome.runtime.sendMessage({ action: "get_agent_bridge_status" }, (res) => {
    if (res) agentMonitor.updateBridgeUI(res);
  });
})();
