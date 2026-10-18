/**
 * Agent Pilot - Background Service Worker Entry Point (Manifest V3)
 * Orchestrates extension lifecycle, message routing, CDP events, and Agent Bridge
 */

import {
  attachedTabs,
  agentControlledTabs,
  tabLockStates,
  normalizeUrl,
  getBuffer,
  DEFAULT_AGENT_PORT,
  BRIDGE,
  getSecretFilterEnabled,
  setSecretFilterEnabled,
  cleanupTabResources
} from "./background/constants.js";

import {
  attachDebugger,
  detachDebugger,
  sendCdpCommand,
  dispatchCdpMouseClick,
  initCdpEventListeners
} from "./background/cdp-manager.js";

import {
  getActiveTabId,
  markTabAsAgentControlled,
  runWithTabLock
} from "./background/tab-manager.js";

import { captureTabScreenshot } from "./background/screenshot-service.js";
import { AgentBridgeClient } from "./background/bridge-client.js";
import { sanitizeData } from "./background/secret-sanitizer.js";
import {
  initFlowRecorder,
  removeFlowSession,
  recordTabNavigation,
  getFlowState,
  appendFlowStep,
  setFlowRecording,
  deleteFlowStep,
  clearFlowSteps,
  exportFlowAsBatch,
  exportFlowAsPlaywright,
  replayRecordedFlow
} from "./background/flow-recorder.js";
// Side-effect import: exposes globalThis.__AP_FEEDBACK_ITEM_SCHEMA__ for payload validation
import "./content/feedback-studio/item-schema.js";

const feedbackItemSchema = globalThis.__AP_FEEDBACK_ITEM_SCHEMA__;

function validateFeedbackRequest(sender, payload) {
  if (!sender || sender.id !== chrome.runtime.id) {
    return { ok: false, error: "Rejected: untrusted sender" };
  }
  if (!feedbackItemSchema) {
    return { ok: false, error: "Rejected: feedback validation module unavailable" };
  }
  return { ok: true, payload: feedbackItemSchema.sanitizeFeedbackPayload(payload) };
}

const PRIVILEGED_EXTENSION_ONLY_ACTIONS = new Set([
  "set_secret_filter_status",
  "set_agent_bridge_port",
  "set_agent_bridge_api_key",
  "toggle_agent_bridge",
  "reconnect_agent_bridge",
  "attach_debugger",
  "detach_debugger",
  "close_tab",
  "new_tab",
  "navigate",
  "reload_tab",
  "set_flow_recording",
  "delete_flow_step",
  "replay_flow_recorder"
]);

// Broadcast helper for internal extension views (Side Panel / Popup) only
export function broadcastToMonitors(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// Broadcast helper for extension views and agent bridge
export function broadcastToExtension(message) {
  broadcastToMonitors(message);
  if (typeof agentBridge !== "undefined" && agentBridge && agentBridge.connected) {
    agentBridge.send(sanitizeData(message, getSecretFilterEnabled()));
  }
}

// Initialize the WebSocket bridge client
export const agentBridge = new AgentBridgeClient(broadcastToExtension);

// Initialize CDP event listeners (Console, Network, Runtime)
initCdpEventListeners(broadcastToExtension);
initFlowRecorder(broadcastToMonitors);

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
    if (tab.id && agentBridge) {
      agentBridge.sendTabMessageWithRetry(tab.id, { action: "toggle_inspector", enabled: true })
        .catch((err) => console.warn("[AgentPilot] Failed to toggle inspector via context menu:", err));
    }
  } else if (info.menuItemId === "agent_pilot_pick_color") {
    if (tab.id && agentBridge) {
      agentBridge.sendTabMessageWithRetry(tab.id, { action: "pick_color" })
        .catch((err) => console.warn("[AgentPilot] Failed to pick color via context menu:", err));
    }
  }
});

// Clean up memory when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  cleanupTabResources(tabId);
  removeFlowSession(tabId);
  if (agentBridge) {
    if (typeof agentBridge.clearAgentTab === "function") {
      agentBridge.clearAgentTab(tabId);
    } else if (agentBridge.lastAgentTabId === tabId) {
      agentBridge.lastAgentTabId = null;
    }
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
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (agentBridge && !agentBridge.connected && agentBridge.enabled) {
    agentBridge.requestReconnect();
  }
  if (changeInfo.url) {
    recordTabNavigation(tabId, changeInfo.url);
  } else if (changeInfo.status === "complete" && tab?.url) {
    recordTabNavigation(tabId, tab.url);
  }
  // If user manually ungroups a tab or moves it into a non-Agent tab group, revoke agent access
  if (changeInfo.groupId !== undefined && agentControlledTabs.has(tabId)) {
    if (changeInfo.groupId <= 0) {
      agentControlledTabs.delete(tabId);
      if (agentBridge && typeof agentBridge.clearAgentTab === "function") {
        agentBridge.clearAgentTab(tabId);
      }
    } else if (chrome.tabGroups?.get) {
      try {
        const grp = await chrome.tabGroups.get(changeInfo.groupId);
        if (!grp || (grp.title !== "🤖 Agent Pilot" && grp.title !== "Agent Pilot")) {
          agentControlledTabs.delete(tabId);
          if (agentBridge && typeof agentBridge.clearAgentTab === "function") {
            agentBridge.clearAgentTab(tabId);
          }
        }
      } catch (_) {}
    }
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

// Periodic keepalive alarm (see BRIDGE.KEEPALIVE_PERIOD_MINUTES; Chrome clamps below 0.5 min)
if (chrome.alarms) {
  chrome.alarms.create("agent_pilot_bridge_keepalive", { periodInMinutes: BRIDGE.KEEPALIVE_PERIOD_MINUTES });
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
 * Promisified chrome.tabs callback wrapper for background action handlers.
 */
function runChromeTabOp(executor) {
  return new Promise((resolve) => {
    executor((res) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res);
      }
    });
  });
}

const BACKGROUND_ACTION_HANDLERS = {
  agent_emergency_unlocked: (_request, sender) => {
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
    return { success: true };
  },

  // 1. Tab Operations
  list_tabs: () => runChromeTabOp((done) => chrome.tabs.query({}, (tabs) => done({ tabs: tabs || [] }))),

  get_active_tab: () => runChromeTabOp((done) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    done({ tab: tabs?.[0] || null });
  })),

  new_tab: (request) => {
    const url = normalizeUrl(request.url || "https://google.com");
    return runChromeTabOp((done) => chrome.tabs.create({ url }, (tab) => done({ success: true, tab })));
  },

  navigate: (request) => {
    const url = normalizeUrl(request.url || "");
    return runChromeTabOp((done) => chrome.tabs.update(request.tabId, { url }, (tab) => done({ success: true, tab })));
  },

  reload_tab: (request) => runChromeTabOp((done) => chrome.tabs.reload(request.tabId, () => done({ success: true }))),

  close_tab: (request) => runChromeTabOp((done) => chrome.tabs.remove(request.tabId, () => done({ success: true }))),

  // 2. Debugger & CDP Operations
  attach_debugger: async (request) => {
    const res = await attachDebugger(request.tabId, broadcastToExtension);
    if (res && res.success && request.tabId) {
      await markTabAsAgentControlled(request.tabId).catch(() => {});
    }
    return res;
  },

  detach_debugger: (request) => detachDebugger(request.tabId, broadcastToExtension),

  get_debugger_status: (request) => ({ attached: attachedTabs.has(request.tabId) }),

  get_devtools_data: (request) => {
    const buffer = getBuffer(request.tabId);
    return {
      console: buffer.console,
      network: Array.from(buffer.network.values()).slice(-100),
      attached: attachedTabs.has(request.tabId)
    };
  },

  clear_console: (request) => {
    const buffer = getBuffer(request.tabId);
    buffer.console = [];
    return { success: true };
  },

  clear_network: (request) => {
    const buffer = getBuffer(request.tabId);
    buffer.network.clear();
    return { success: true };
  },

  get_performance_metrics: async (request) => {
    const tabId = request.tabId;
    if (!attachedTabs.has(tabId)) {
      return { success: false, error: "Debugger not attached" };
    }
    const res = await sendCdpCommand(tabId, "Performance.getMetrics");
    const metricsMap = {};
    (res.metrics || []).forEach((m) => {
      metricsMap[m.name] = m.value;
    });
    return { success: true, metrics: metricsMap };
  },

  // 3. Screenshot Capture Operations (Human UI: Sidepanel, Popup, Content Script)
  capture_screenshot: async (request, sender) => {
    const targetTabId = request.tabId || sender.tab?.id || (await getActiveTabId());
    if (!targetTabId) return { success: false, error: "No target tab found" };
    return await captureTabScreenshot(targetTabId, request);
  },

  // 4. Input Emulation via CDP
  cdp_mouse_click: async (request) => {
    const { tabId, x, y, button = "left" } = request;
    if (!attachedTabs.has(tabId)) {
      return { success: false, error: "CDP not attached" };
    }
    await dispatchCdpMouseClick(tabId, x, y, { button, clickCount: 1 });
    return { success: true };
  },

  // 5. Open Side Panel Programmatically
  open_sidepanel: async (request) => {
    if (!chrome.sidePanel || !chrome.sidePanel.open) {
      return { success: false, error: "Side Panel API not supported" };
    }
    await chrome.sidePanel.open({ tabId: request.tabId });
    return { success: true };
  },

  // 6. AI Agent Bridge Status & Settings
  get_agent_bridge_status: () => (agentBridge ? agentBridge.getStatus() : { connected: false, port: DEFAULT_AGENT_PORT, enabled: true }),

  set_agent_bridge_port: (request) => {
    if (agentBridge) agentBridge.setPort(request.port);
    return { success: true };
  },

  set_agent_bridge_api_key: (request) => {
    if (agentBridge) agentBridge.setApiKey(request.apiKey);
    return { success: true, authConfigured: Boolean(request.apiKey && String(request.apiKey).trim()) };
  },

  reconnect_agent_bridge: () => {
    if (agentBridge) agentBridge.reconnect();
    return { success: true };
  },

  toggle_agent_bridge: (request) => {
    if (agentBridge) agentBridge.setEnabled(request.enabled);
    return { success: true };
  },

  ensure_content_script: async (request) => {
    const targetId = request.tabId || (agentBridge ? await agentBridge.getActiveTabId() : null);
    if (!targetId) {
      return { success: false, error: "Không tìm thấy tab mục tiêu" };
    }
    const ok = agentBridge ? await agentBridge.ensureContentScript(targetId) : false;
    return { success: ok };
  },

  // 7. Secret Filter Status & Settings
  get_secret_filter_status: () => ({ enabled: getSecretFilterEnabled() }),

  set_secret_filter_status: (request) => {
    setSecretFilterEnabled(request.enabled);
    broadcastToExtension({
      type: "SECRET_FILTER_STATUS_CHANGED",
      enabled: getSecretFilterEnabled()
    });
    return { success: true, enabled: getSecretFilterEnabled() };
  },

  // 8. Visual Feedback Actions (Channel B & A)
  save_feedback_inbox: async (request, sender) => {
    const check = validateFeedbackRequest(sender, request.payload);
    if (!check.ok) return { success: false, error: check.error };
    return await agentBridge.saveFeedbackInbox(check.payload);
  },

  push_feedback_live: async (request, sender) => {
    const check = validateFeedbackRequest(sender, request.payload);
    if (!check.ok) return { success: false, error: check.error };
    return await agentBridge.pushFeedbackLive(check.payload);
  },

  // 9. Persistent Cross-Page Flow Recorder Actions
  record_flow_step: (request, sender) => {
    const tabId = sender?.tab?.id || request.tabId;
    const step = appendFlowStep(tabId, request.step);
    return { success: Boolean(step), step, state: getFlowState(tabId) };
  },

  get_flow_recorder_state: (request, sender) => {
    const tabId = sender?.tab?.id || request.tabId;
    return { success: true, ...getFlowState(tabId) };
  },

  set_flow_recording: async (request, sender) => {
    const tabId = sender?.tab?.id || request.tabId || (await getActiveTabId());
    return await setFlowRecording(tabId, request.enabled, request.url);
  },

  delete_flow_step: (request, sender) => {
    const tabId = sender?.tab?.id || request.tabId;
    return deleteFlowStep(tabId, request.stepId);
  },

  clear_flow_steps: (request, sender) => {
    const tabId = sender?.tab?.id || request.tabId;
    return clearFlowSteps(tabId);
  },

  export_flow_recorder: (request, sender) => {
    const tabId = sender?.tab?.id || request.tabId || null;
    const batch = exportFlowAsBatch(tabId, request.url, request.title, request.steps || null);
    const playwright = exportFlowAsPlaywright(tabId, request.url, request.steps || null);
    return {
      success: true,
      batch,
      playwright,
      ...getFlowState(tabId)
    };
  },

  replay_flow_recorder: async (request, sender) => {
    const tabId = sender?.tab?.id || request.tabId || (await getActiveTabId());
    const runReplay = () => replayRecordedFlow(tabId, request.steps || null);
    return tabId
      ? await runWithTabLock(tabId, "flow.replay", runReplay)
      : await runReplay();
  }
};

/**
 * Main Message Router for Sidepanel, Popup, Content Script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: "Rejected: untrusted sender" });
    return false;
  }
  const { action, type } = request || {};

  if (sender.tab && action && PRIVILEGED_EXTENSION_ONLY_ACTIONS.has(action)) {
    sendResponse({ success: false, error: `Rejected: privileged action '${action}' is not allowed from content scripts` });
    return false;
  }

  if (type === "REGION_CROP_REQUESTED" || type === "ELEMENT_SNAP_REQUESTED") {
    broadcastToExtension(request);
    sendResponse({ success: true });
    return true;
  }

  const handler = action && BACKGROUND_ACTION_HANDLERS[action];
  if (!handler) {
    sendResponse({ success: false, error: `Unknown action: ${action || type || "unnamed"}` });
    return true;
  }

  Promise.resolve()
    .then(() => handler(request, sender))
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ success: false, error: err?.message || String(err) });
    });
  return true;
});

