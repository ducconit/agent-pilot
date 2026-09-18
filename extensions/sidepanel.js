/**
 * Agent Pilot - Side Panel Logic Controller (Modular Coordinator)
 * Coordinates AI Agent Monitor, DOM Inspector, and Screenshot Studio
 */

import { showToast } from "./sidepanel/ui-helpers.js";
import { AgentMonitor } from "./sidepanel/agent-monitor.js";
import { InspectorPanel } from "./sidepanel/inspector-panel.js";
import { ScreenshotPanel } from "./sidepanel/screenshot-panel.js";
import { FeedbackPanel } from "./sidepanel/feedback-panel.js";

(function () {
  let activeTabId = null;
  let isCdpAttached = false;
  let activeTabRequestSeq = 0;

  // Header DOM Elements
  const cdpStatusDot = document.getElementById("cdp-status-dot");
  const btnToggleCdp = document.getElementById("btn-toggle-cdp");

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

  const feedbackPanel = new FeedbackPanel({
    getActiveTabId: () => activeTabId,
    showToast
  });

  window.__INSPECTOR_PANEL__ = inspectorPanel;
  window.__SCREENSHOT_PANEL__ = screenshotPanel;
  window.__AGENT_MONITOR__ = agentMonitor;
  window.__FEEDBACK_PANEL__ = feedbackPanel;

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
      if (targetId === "tab-feedback") {
        feedbackPanel.refreshState();
      }
    });
  });

  async function updateActiveTab() {
    const seq = ++activeTabRequestSeq;
    chrome.runtime.sendMessage({ action: "get_active_tab" }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn("[AgentPilot] get_active_tab error:", chrome.runtime.lastError.message);
        return;
      }
      if (seq !== activeTabRequestSeq) return;
      if (res && res.tab) {
        activeTabId = res.tab.id;
        agentMonitor.updateTargetTabDisplay(res.tab);
        feedbackPanel.refreshState({ silent: true });
        checkCdpStatus();
      }
    });
  }

  // Sync when user changes tabs in Chrome
  chrome.tabs.onActivated.addListener(updateActiveTab);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === activeTabId && changeInfo.title) {
      agentMonitor.updateTargetTabDisplay({ id: tabId, title: changeInfo.title });
    }
  });

  // =========================================================================
  // 2. CDP Debugger State Management
  // =========================================================================

  function checkCdpStatus() {
    if (!activeTabId) return;
    chrome.runtime.sendMessage({ action: "get_debugger_status", tabId: activeTabId }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn("[AgentPilot] get_debugger_status error:", chrome.runtime.lastError.message);
        return;
      }
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
          if (chrome.runtime.lastError) {
            showToast("Lỗi ngắt CDP: " + chrome.runtime.lastError.message);
            return;
          }
          setCdpState(false);
          showToast("Đã ngắt kết nối CDP.");
        });
      } else {
        chrome.runtime.sendMessage({ action: "attach_debugger", tabId: activeTabId }, (res) => {
          if (chrome.runtime.lastError) {
            showToast("Lỗi gắn CDP: " + chrome.runtime.lastError.message);
            return;
          }
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

  // Open / Focus Application Guide Page
  const btnOpenGuide = document.getElementById("btn-open-guide");
  if (btnOpenGuide) {
    btnOpenGuide.onclick = () => {
      const guideUrl = chrome.runtime.getURL("guide.html");
      chrome.tabs.query({}, (tabs) => {
        const existingTab = tabs.find(t => t.url && t.url.startsWith(guideUrl));
        if (existingTab && existingTab.id) {
          chrome.tabs.update(existingTab.id, { active: true });
          if (existingTab.windowId) {
            chrome.windows.update(existingTab.windowId, { focused: true });
          }
        } else {
          chrome.tabs.create({ url: guideUrl, active: true });
        }
      });
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

    if (msg.type === "INSPECTOR_STATUS_CHANGED" && msg.enabled !== undefined) {
      inspectorPanel.setInspectorActiveState(msg.enabled);
    }

    if (msg.type === "COLOR_PICKED" && msg.color) {
      inspectorPanel.addColorToPalette(msg.color);
      const inspectorTabBtn = document.querySelector('[data-tab="tab-inspector"]');
      if (inspectorTabBtn) inspectorTabBtn.click();
    }

    if (msg.type === "EYEDROPPER_STATUS_CHANGED" && msg.active !== undefined) {
      inspectorPanel.setEyedropperActiveState(msg.active);
    }

    if (msg.type === "REGION_CROP_REQUESTED" && msg.clip) {
      chrome.runtime.sendMessage({
        action: "capture_screenshot",
        mode: "region",
        tabId: activeTabId,
        clip: msg.clip
      }, (res) => {
        if (chrome.runtime.lastError) {
          showToast("Lỗi chụp vùng: " + chrome.runtime.lastError.message);
          return;
        }
        if (res && res.success && res.dataUrl) {
          if (res.requiresCrop && res.clip) {
            screenshotPanel.cropImageViaCanvas(res.dataUrl, res.clip);
          } else {
            screenshotPanel.displayScreenshot(res.dataUrl, "Đã chụp và cắt vùng thành công!");
          }
        } else {
          showToast("Lỗi chụp vùng: " + (res ? res.error : ""));
        }
      });
      const tabScreenshotBtn = document.querySelector('[data-tab="tab-screenshot"]');
      if (tabScreenshotBtn) tabScreenshotBtn.click();
    }

    if (msg.type === "ELEMENT_SNAP_REQUESTED" && msg.rect) {
      screenshotPanel.captureElementScreenshot(msg.rect);
      const tabScreenshotBtn = document.querySelector('[data-tab="tab-screenshot"]');
      if (tabScreenshotBtn) tabScreenshotBtn.click();
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
    if (chrome.runtime.lastError) {
      console.warn("[AgentPilot] get_agent_bridge_status error:", chrome.runtime.lastError.message);
      return;
    }
    if (res) agentMonitor.updateBridgeUI(res);
  });
})();
