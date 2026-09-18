/**
 * Agent Pilot - Background Service Worker Entry Point (Manifest V3)
 * Orchestrates extension lifecycle, message routing, CDP events, and Agent Bridge
 */

import {
  attachedTabs,
  devtoolsBuffers,
  agentControlledTabs,
  tabLockStates,
  normalizeUrl,
  getBuffer,
  DEFAULT_AGENT_PORT,
  getSecretFilterEnabled,
  setSecretFilterEnabled
} from "./background/constants.js";

import {
  attachDebugger,
  detachDebugger,
  sendCdpCommand,
  initCdpEventListeners
} from "./background/cdp-manager.js";

import {
  getActiveTabId,
  getTargetTabId,
  ensureContentScript
} from "./background/tab-manager.js";

import { captureTabScreenshot } from "./background/screenshot-service.js";
import { AgentBridgeClient } from "./background/bridge-client.js";
import { sanitizeData } from "./background/secret-sanitizer.js";
// Side-effect import: exposes globalThis.__AP_FEEDBACK_ITEM_SCHEMA__ for payload validation
import "./content/feedback-studio/item-schema.js";

const feedbackItemSchema = globalThis.__AP_FEEDBACK_ITEM_SCHEMA__;

function validateFeedbackRequest(sender, payload) {
  if (!sender || sender.id !== chrome.runtime.id) {
    return { ok: false, error: "Rejected: untrusted sender" };
  }
  if (!sender.tab) {
    return { ok: false, error: "Rejected: feedback actions must originate from a content script" };
  }
  if (!feedbackItemSchema) {
    return { ok: false, error: "Rejected: feedback validation module unavailable" };
  }
  return { ok: true, payload: feedbackItemSchema.sanitizeFeedbackPayload(payload) };
}

// Broadcast helper for extension views and agent bridge
export function broadcastToExtension(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
  if (typeof agentBridge !== "undefined" && agentBridge && agentBridge.connected) {
    agentBridge.send(sanitizeData(message, getSecretFilterEnabled()));
  }
}

// Initialize the WebSocket bridge client
export const agentBridge = new AgentBridgeClient(broadcastToExtension);

// Initialize CDP event listeners (Console, Network, Runtime)
initCdpEventListeners(broadcastToExtension);

// Enable Side Panel behavior on icon click natively
function enableSidePanelBehavior() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn("[AgentPilot] Error setting panel behavior:", err);
    });
  }
}
enableSidePanelBehavior();

// Open Side Panel directly when action icon is clicked
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      try {
        const openOptions = (tab && tab.windowId) ? { windowId: tab.windowId } : { tabId: tab?.id };
        await chrome.sidePanel.open(openOptions);
      } catch (err) {
        console.warn("[AgentPilot] Failed to open side panel on action click:", err);
      }
    }
  });
}

// Context Menu setup for quick inspection
chrome.runtime.onInstalled.addListener(() => {
  enableSidePanelBehavior();
  chrome.contextMenus.create({
    id: "agent_pilot_open_sidepanel",
    title: "Mở Agent Pilot (Side Panel)",
    contexts: ["all"]
  });
  chrome.contextMenus.create({
    id: "agent_pilot_inspect_element",
    title: "Agent Pilot: Soi phần tử này",
    contexts: ["all"]
  });
  chrome.contextMenus.create({
    id: "agent_pilot_pick_color",
    title: "Agent Pilot: Lấy màu tại điểm này",
    contexts: ["all"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "agent_pilot_open_sidepanel") {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      try {
        const openOptions = tab.windowId ? { windowId: tab.windowId } : { tabId: tab.id };
        await chrome.sidePanel.open(openOptions);
      } catch (err) {
        console.warn("[AgentPilot] Failed to open side panel via context menu:", err);
      }
    }
  } else if (info.menuItemId === "agent_pilot_inspect_element") {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { action: "toggle_inspector", enabled: true }).catch(() => {});
  } else if (info.menuItemId === "agent_pilot_pick_color") {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { action: "pick_color" }).catch(() => {});
  }
});

// Clean up memory when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  devtoolsBuffers.delete(tabId);
  agentControlledTabs.delete(tabId);
  const state = tabLockStates.get(tabId);
  if (state && state.unlockTimer) clearTimeout(state.unlockTimer);
  tabLockStates.delete(tabId);
  if (agentBridge && agentBridge.lastAgentTabId === tabId) {
    agentBridge.lastAgentTabId = null;
  }
});

// Re-ensure agent bridge connection on tab activation
if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener(() => {
    if (agentBridge && !agentBridge.connected && agentBridge.enabled) {
      agentBridge.requestReconnect();
    }
  });
}

// Accept keep-alive port connections from content scripts or sidepanel
if (chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "agent-pilot-keepalive") {
      if (agentBridge && !agentBridge.connected && agentBridge.enabled) {
        agentBridge.requestReconnect();
      }
      port.onDisconnect.addListener(() => {});
    }
  });
}

// Re-notify agent tabs and restore lock state when navigation completes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (agentBridge && !agentBridge.connected && agentBridge.enabled) {
    agentBridge.requestReconnect();
  }
  if (changeInfo.status === "complete") {
    const lockState = tabLockStates.get(tabId);
    if (lockState && (lockState.manualLock || lockState.autoCount > 0)) {
      if (agentBridge && typeof agentBridge.sendTabMessageWithRetry === "function") {
        agentBridge.sendTabMessageWithRetry(tabId, {
          action: "set_agent_busy",
          busy: true,
          currentAction: lockState.currentAction || "AI Agent đang thao tác..."
        }).catch(() => {});
      }
    }
  }
});

// Periodic keepalive alarm (0.5 min = 30s, the minimum period Chrome allows) to wake up service worker
if (chrome.alarms) {
  chrome.alarms.create("agent_pilot_bridge_keepalive", { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "agent_pilot_bridge_keepalive") {
      if (agentBridge) {
        if (!agentBridge.connected && agentBridge.enabled) {
          agentBridge.requestReconnect();
        } else if (agentBridge.connected) {
          agentBridge.send({ type: "HEARTBEAT", timestamp: Date.now() });
        }
      }
    }
  });
}

/**
 * Main Message Router for Sidepanel, Popup, Content Script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, type } = request;

  if (type === "REGION_CROP_REQUESTED" || type === "ELEMENT_SNAP_REQUESTED") {
    broadcastToExtension(request);
    sendResponse({ success: true });
    return true;
  }

  if (action === "agent_emergency_unlocked") {
    const tabId = sender?.tab?.id;
    if (tabId && tabLockStates.has(tabId)) {
      const state = tabLockStates.get(tabId);
      if (state.unlockTimer) {
        clearTimeout(state.unlockTimer);
        state.unlockTimer = null;
      }
      state.manualLock = false;
      state.autoCount = 0;
      state.currentAction = "";
    }
    broadcastToExtension({
      type: "AGENT_ACTION_LOG",
      action: "EMERGENCY_UNLOCK",
      status: "warning",
      details: `Người dùng đã chiếm quyền điều khiển trên Tab ${tabId || ""}`,
      timestamp: Date.now()
    });
    sendResponse({ success: true });
    return true;
  }

  // 1. Tab Operations
  if (action === "list_tabs") {
    chrome.tabs.query({}, (tabs) => sendResponse({ tabs }));
    return true;
  }

  if (action === "get_active_tab") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ tab: tabs[0] || null });
    });
    return true;
  }

  if (action === "new_tab") {
    const url = normalizeUrl(request.url || "https://google.com");
    chrome.tabs.create({ url }, (tab) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, tab });
      }
    });
    return true;
  }

  if (action === "navigate") {
    const tabId = request.tabId;
    const url = normalizeUrl(request.url || "");
    chrome.tabs.update(tabId, { url }, (tab) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, tab });
      }
    });
    return true;
  }

  if (action === "reload_tab") {
    chrome.tabs.reload(request.tabId, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }

  if (action === "close_tab") {
    chrome.tabs.remove(request.tabId, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }

  // 2. Debugger & CDP Operations
  if (action === "attach_debugger") {
    attachDebugger(request.tabId, broadcastToExtension).then(sendResponse);
    return true;
  }

  if (action === "detach_debugger") {
    detachDebugger(request.tabId, broadcastToExtension).then(sendResponse);
    return true;
  }

  if (action === "get_debugger_status") {
    sendResponse({ attached: attachedTabs.has(request.tabId) });
    return true;
  }

  if (action === "get_devtools_data") {
    const buffer = getBuffer(request.tabId);
    sendResponse({
      console: buffer.console,
      network: Array.from(buffer.network.values()).slice(-100),
      attached: attachedTabs.has(request.tabId)
    });
    return true;
  }

  if (action === "clear_console") {
    const buffer = getBuffer(request.tabId);
    buffer.console = [];
    sendResponse({ success: true });
    return true;
  }

  if (action === "clear_network") {
    const buffer = getBuffer(request.tabId);
    buffer.network.clear();
    sendResponse({ success: true });
    return true;
  }

  if (action === "get_performance_metrics") {
    const tabId = request.tabId;
    if (!attachedTabs.has(tabId)) {
      sendResponse({ success: false, error: "Debugger not attached" });
      return true;
    }
    sendCdpCommand(tabId, "Performance.getMetrics")
      .then((res) => {
        const metricsMap = {};
        (res.metrics || []).forEach((m) => {
          metricsMap[m.name] = m.value;
        });
        sendResponse({ success: true, metrics: metricsMap });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 3. Screenshot Capture Operations
  if (action === "capture_screenshot") {
    (async () => {
      try {
        const targetTabId = request.tabId || sender.tab?.id || (agentBridge ? await agentBridge.getTargetTabId() : null);
        if (!targetTabId) return sendResponse({ success: false, error: "No target tab found" });
        const res = await captureTabScreenshot(targetTabId, request);
        sendResponse(res);
      } catch (err) {
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  // 4. Input Emulation via CDP
  if (action === "cdp_mouse_click") {
    const { tabId, x, y, button = "left" } = request;
    if (!attachedTabs.has(tabId)) {
      sendResponse({ success: false, error: "CDP not attached" });
      return true;
    }

    (async () => {
      try {
        await sendCdpCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await sendCdpCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
        await sendCdpCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 5. Open Side Panel Programmatically
  if (action === "open_sidepanel") {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ tabId: request.tabId }).then(() => {
        sendResponse({ success: true });
      }).catch((err) => sendResponse({ success: false, error: err.message }));
    } else {
      sendResponse({ success: false, error: "Side Panel API not supported" });
    }
    return true;
  }

  // 6. AI Agent Bridge Status & Settings
  if (action === "get_agent_bridge_status") {
    sendResponse(agentBridge ? agentBridge.getStatus() : { connected: false, port: DEFAULT_AGENT_PORT, enabled: true });
    return true;
  }

  if (action === "set_agent_bridge_port") {
    if (agentBridge) agentBridge.setPort(request.port);
    sendResponse({ success: true });
    return true;
  }

  if (action === "reconnect_agent_bridge") {
    if (agentBridge) agentBridge.reconnect();
    sendResponse({ success: true });
    return true;
  }

  if (action === "toggle_agent_bridge") {
    if (agentBridge) agentBridge.setEnabled(request.enabled);
    sendResponse({ success: true });
    return true;
  }

  if (action === "ensure_content_script") {
    (async () => {
      const targetId = request.tabId || (agentBridge ? await agentBridge.getActiveTabId() : null);
      if (!targetId) {
        return sendResponse({ success: false, error: "Không tìm thấy tab mục tiêu" });
      }
      const ok = agentBridge ? await agentBridge.ensureContentScript(targetId) : false;
      sendResponse({ success: ok });
    })();
    return true;
  }

  // 7. Secret Filter Status & Settings
  if (action === "get_secret_filter_status") {
    sendResponse({ enabled: getSecretFilterEnabled() });
    return true;
  }

  if (action === "set_secret_filter_status") {
    setSecretFilterEnabled(request.enabled);
    broadcastToExtension({
      type: "SECRET_FILTER_STATUS_CHANGED",
      enabled: getSecretFilterEnabled()
    });
    sendResponse({ success: true, enabled: getSecretFilterEnabled() });
    return true;
  }

  // 8. Visual Feedback Actions (Channel B & A)
  if (action === "save_feedback_inbox") {
    const check = validateFeedbackRequest(sender, request.payload);
    if (!check.ok) {
      sendResponse({ success: false, error: check.error });
      return true;
    }
    (async () => {
      try {
        const res = await agentBridge.saveFeedbackInbox(check.payload);
        sendResponse(res);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (action === "push_feedback_live") {
    const check = validateFeedbackRequest(sender, request.payload);
    if (!check.ok) {
      sendResponse({ success: false, error: check.error });
      return true;
    }
    (async () => {
      try {
        const res = await agentBridge.pushFeedbackLive(check.payload);
        sendResponse(res);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  sendResponse({ success: false, error: `Unknown action: ${action || type || "unnamed"}` });
  return true;
});

