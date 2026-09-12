/**
 * Agent Pilot - Background Service Worker (Manifest V3)
 * Universal AI Agent Browser Controller - Antigravity First
 */

// Track attached debugger sessions and buffered devtools events
const attachedTabs = new Set();
const devtoolsBuffers = new Map(); // tabId -> { console: [], network: [], performance: {} }
const agentControlledTabs = new Set(); // Track tabs opened or controlled by AI Agent
const tabLockStates = new Map(); // tabId -> { manualLock: boolean, autoCount: number, unlockTimer: any, currentAction: string }

// Chrome Native Tab Group styling constants
const AGENT_GROUP_TITLE = "🤖 Agent Pilot";
const AGENT_GROUP_COLOR = "cyan";

function getTabLockState(tabId) {
  if (!tabLockStates.has(tabId)) {
    tabLockStates.set(tabId, { manualLock: false, autoCount: 0, unlockTimer: null, currentAction: "" });
  }
  return tabLockStates.get(tabId);
}

/**
 * Cross-platform URL normalizer supporting Windows/Mac/Linux local file URLs
 * as well as edge://, chrome://, brave://, and standard web protocols.
 */
function normalizeUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (/^(https?|file|chrome|edge|brave|about|data):/i.test(trimmed)) {
    return trimmed;
  }
  return "https://" + trimmed;
}

// Cached host platform: "win", "mac", "linux", "cros"
let currentPlatform = "unknown";
const platformPromise = (typeof chrome !== "undefined" && chrome.runtime?.getPlatformInfo)
  ? new Promise((resolve) => {
      chrome.runtime.getPlatformInfo((info) => {
        currentPlatform = info?.os || "unknown";
        resolve(currentPlatform);
      });
    })
  : Promise.resolve("unknown");

// Enable Side Panel behavior on icon click natively
function enableSidePanelBehavior() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn("Error setting panel behavior:", err);
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
        console.warn("Failed to open side panel on action click:", err);
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
        console.warn("Failed to open side panel via context menu:", err);
      }
    }
  } else if (info.menuItemId === "agent_pilot_inspect_element") {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { action: "toggle_inspector", enabled: true }).catch(() => {});
  } else if (info.menuItemId === "agent_pilot_pick_color") {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { action: "pick_color" }).catch(() => {});
  }
});

/**
 * Get or initialize devtools buffer for a tab
 */
function getBuffer(tabId) {
  if (!devtoolsBuffers.has(tabId)) {
    devtoolsBuffers.set(tabId, {
      console: [],
      network: new Map(),
      performance: { metrics: {}, timestamp: Date.now() }
    });
  }
  return devtoolsBuffers.get(tabId);
}

/**
 * Attach Chrome DevTools Protocol (CDP) to a tab
 */
async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return { success: true, message: "Already attached" };
  
  return new Promise((resolve) => {
    chrome.debugger.attach({ tabId }, "1.3", async () => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      attachedTabs.add(tabId);
      const buffer = getBuffer(tabId);

      // Enable CDP domains
      try {
        await sendCdpCommand(tabId, "Console.enable");
        await sendCdpCommand(tabId, "Runtime.enable");
        await sendCdpCommand(tabId, "Network.enable");
        await sendCdpCommand(tabId, "Performance.enable");
        await sendCdpCommand(tabId, "Page.enable");
      } catch (err) {
        console.warn("Error enabling CDP domains:", err);
      }

      broadcastToExtension({
        type: "DEBUGGER_STATUS_CHANGED",
        tabId,
        attached: true
      });

      resolve({ success: true, tabId });
    });
  });
}

/**
 * Detach CDP from tab
 */
async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return { success: true };
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      attachedTabs.delete(tabId);
      devtoolsBuffers.delete(tabId);
      broadcastToExtension({
        type: "DEBUGGER_STATUS_CHANGED",
        tabId,
        attached: false
      });
      resolve({ success: true });
    });
  });
}

/**
 * Send arbitrary command to CDP
 */
function sendCdpCommand(tabId, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!attachedTabs.has(tabId)) {
      return reject(new Error("Debugger not attached to tab " + tabId));
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (timedOut) return;
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

// Clean up when debugger detached by user or system
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source && source.tabId) {
    attachedTabs.delete(source.tabId);
    devtoolsBuffers.delete(source.tabId);
    broadcastToExtension({
      type: "DEBUGGER_STATUS_CHANGED",
      tabId: source.tabId,
      attached: false,
      reason
    });
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
  if (typeof agentBridge !== "undefined" && agentBridge && agentBridge.lastAgentTabId === tabId) {
    agentBridge.lastAgentTabId = null;
  }
});

// Re-ensure agent bridge connection on tab activation
if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener(() => {
    if (typeof agentBridge !== "undefined" && agentBridge && !agentBridge.connected && agentBridge.enabled) {
      agentBridge.connect();
    }
  });
}

// Accept keep-alive port connections from content scripts or sidepanel
if (chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "agent-pilot-keepalive") {
      if (typeof agentBridge !== "undefined" && agentBridge && !agentBridge.connected && agentBridge.enabled) {
        agentBridge.connect();
      }
      port.onDisconnect.addListener(() => {});
    }
  });
}

// Re-notify agent tabs and restore lock state when navigation completes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (typeof agentBridge !== "undefined" && agentBridge && !agentBridge.connected && agentBridge.enabled) {
    agentBridge.connect();
  }
  if (changeInfo.status === "complete") {
    // Restore lock state if tab was locked during navigation (Finding 2)
    const lockState = tabLockStates.get(tabId);
    if (lockState && (lockState.manualLock || lockState.autoCount > 0)) {
      if (typeof agentBridge !== "undefined" && agentBridge && typeof agentBridge.sendTabMessageWithRetry === "function") {
        agentBridge.sendTabMessageWithRetry(tabId, {
          action: "set_agent_busy",
          busy: true,
          currentAction: lockState.currentAction || "AI Agent đang thao tác..."
        }).catch(() => {});
      }
    }
  }
});

// Listen for CDP events (Console, Network, Runtime)
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!tabId) return;
  const buffer = getBuffer(tabId);

  // 1. Console Events
  if (method === "Runtime.consoleAPICalled") {
    const textArgs = (params.args || []).map((arg) => {
      if (arg.value !== undefined) return String(arg.value);
      if (arg.description) return arg.description;
      return JSON.stringify(arg);
    }).join(" ");

    const entry = {
      id: "console_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
      type: params.type || "log",
      text: textArgs || "(empty)",
      timestamp: params.timestamp || Date.now(),
      stackTrace: params.stackTrace
    };

    buffer.console.push(entry);
    if (buffer.console.length > 500) buffer.console.shift();

    broadcastToExtension({
      type: "DEVTOOLS_CONSOLE_EVENT",
      tabId,
      entry
    });
  } else if (method === "Console.messageAdded") {
    const msg = params.message;
    const entry = {
      id: "console_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
      type: msg.level || "log",
      text: msg.text || "",
      url: msg.url,
      line: msg.line,
      timestamp: Date.now()
    };
    buffer.console.push(entry);
    if (buffer.console.length > 500) buffer.console.shift();

    broadcastToExtension({
      type: "DEVTOOLS_CONSOLE_EVENT",
      tabId,
      entry
    });
  }

  // 2. Network Events
  else if (method === "Network.requestWillBeSent") {
    // Truncate network buffer to prevent memory leaks
    if (buffer.network.size >= 300) {
      const oldestKey = buffer.network.keys().next().value;
      buffer.network.delete(oldestKey);
    }

    const req = {
      id: params.requestId,
      url: params.request.url,
      method: params.request.method,
      type: params.type || "Other",
      wallTime: params.wallTime ? params.wallTime * 1000 : Date.now(),
      status: "pending",
      responseSize: 0
    };
    buffer.network.set(params.requestId, req);
    broadcastToExtension({
      type: "DEVTOOLS_NETWORK_EVENT",
      tabId,
      request: req
    });
  } else if (method === "Network.responseReceived") {
    const existing = buffer.network.get(params.requestId);
    if (existing) {
      existing.status = params.response.status;
      existing.statusText = params.response.statusText;
      existing.mimeType = params.response.mimeType;
      existing.headers = params.response.headers;
      existing.encodedDataLength = params.response.encodedDataLength;
      broadcastToExtension({
        type: "DEVTOOLS_NETWORK_EVENT",
        tabId,
        request: existing
      });
    }
  } else if (method === "Network.loadingFinished") {
    const existing = buffer.network.get(params.requestId);
    if (existing) {
      existing.encodedDataLength = params.encodedDataLength;
      existing.finished = true;
      broadcastToExtension({
        type: "DEVTOOLS_NETWORK_EVENT",
        tabId,
        request: existing
      });
    }
  } else if (method === "Network.loadingFailed") {
    const existing = buffer.network.get(params.requestId);
    if (existing) {
      existing.status = "failed";
      existing.errorText = params.errorText;
      broadcastToExtension({
        type: "DEVTOOLS_NETWORK_EVENT",
        tabId,
        request: existing
      });
    }
  }
});

/**
 * Broadcast message to popup, sidepanel, and active views
 */
function broadcastToExtension(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Suppress errors when no extension view is open
  });
  if (typeof agentBridge !== "undefined" && agentBridge && agentBridge.connected) {
    agentBridge.send(message);
  }
}

/**
 * Main Message Router for Sidepanel, Popup, Content Script, and AI Agents
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;

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
    attachDebugger(request.tabId).then(sendResponse);
    return true;
  }

  if (action === "detach_debugger") {
    detachDebugger(request.tabId).then(sendResponse);
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
    const { mode = "visible", tabId: requestedTabId, clip } = request; // mode: "visible" | "region" | "element"

    (async () => {
      try {
        const targetTabId = requestedTabId || (agentBridge ? await agentBridge.getTargetTabId() : null);
        let targetTab = null;
        if (targetTabId) {
          targetTab = await chrome.tabs.get(targetTabId).catch(() => null);
        }
        const isTabActive = Boolean(targetTab && targetTab.active);

        // If targetTab is running in background, or CDP is already attached, capture via CDP Page.captureScreenshot
        if (targetTabId && (!isTabActive || attachedTabs.has(targetTabId))) {
          if (!attachedTabs.has(targetTabId)) {
            await attachDebugger(targetTabId).catch(() => {});
          }

          if (attachedTabs.has(targetTabId)) {
            const cdpParams = {
              format: "png",
              fromSurface: true,
              captureBeyondViewport: false
            };
            if ((mode === "element" || mode === "region") && clip) {
              cdpParams.clip = {
                x: clip.x,
                y: clip.y,
                width: clip.width,
                height: clip.height,
                scale: 1
              };
            }
            try {
              const res = await sendCdpCommand(targetTabId, "Page.captureScreenshot", cdpParams);
              return sendResponse({
                success: true,
                tabId: targetTabId,
                isBackgroundTab: !isTabActive,
                dataUrl: "data:image/png;base64," + res.data
              });
            } catch (err) {
              console.warn("[AgentPilot] CDP runtime screenshot failed on tab " + targetTabId + ":", err);
              if (!isTabActive) {
                return sendResponse({
                  success: false,
                  error: `CDP screenshot failed on background tab ${targetTabId}: ${err?.message || err}`
                });
              }
            }
          } else if (!isTabActive) {
            return sendResponse({
              success: false,
              error: `Cannot capture background tab ${targetTabId}: CDP debugger attachment failed`
            });
          }
        }

        if (!isTabActive) {
          return sendResponse({
            success: false,
            error: `Cannot capture background tab ${targetTabId} without active CDP`
          });
        }

        // Fallback to captureVisibleTab (captures active tab in the window)
        const windowId = targetTab?.windowId || null;
        chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({
              success: true,
              tabId: targetTab?.id || null,
              isBackgroundTab: false,
              dataUrl,
              requiresCrop: (mode === "element" || mode === "region"),
              clip
            });
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  // 4. Input Emulation via CDP (Alternative to Content Script DOM simulation)
  if (action === "cdp_mouse_click") {
    const { tabId, x, y, button = "left" } = request;
    if (!attachedTabs.has(tabId)) {
      sendResponse({ success: false, error: "CDP not attached" });
      return true;
    }

    (async () => {
      try {
        await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y
        });
        await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button,
          clickCount: 1
        });
        await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button,
          clickCount: 1
        });
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
});

/**
 * Agent Pilot - AI Agent WebSocket Bridge Client
 * Connects to ws://127.0.0.1:<PORT> (default 58765) to receive commands from AI Agents (Antigravity)
 */
const DEFAULT_AGENT_PORT = 58765;

class AgentBridgeClient {
  constructor() {
    this.port = DEFAULT_AGENT_PORT;
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.reconnectDelay = 2000;
    this.maxReconnectDelay = 20000;
    this.enabled = true;
    this.lastAgentTabId = null;

    // Listen for window focus changes to update active target in multi-window setups
    if (chrome.windows && chrome.windows.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener((windowId) => {
        if (windowId === chrome.windows.WINDOW_ID_NONE) return;
        if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
          chrome.tabs.query({ active: true, windowId }, (tabs) => {
            const tab = tabs && tabs[0];
            this.send({
              type: "WINDOW_FOCUS",
              windowId,
              activeTabTitle: tab?.title || "",
              activeTabUrl: tab?.url || ""
            });
          });
        }
      });
    }

    // Load saved port/enabled state from storage
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["agent_port", "agent_bridge_enabled"], (res) => {
        if (res.agent_port) this.port = Number(res.agent_port) || DEFAULT_AGENT_PORT;
        if (res.agent_bridge_enabled !== undefined) this.enabled = !!res.agent_bridge_enabled;
        if (this.enabled) this.connect();
      });
    } else {
      this.connect();
    }
  }

  getStatus() {
    return {
      connected: this.connected,
      port: this.port,
      enabled: this.enabled,
      url: `ws://127.0.0.1:${this.port}`
    };
  }

  setPort(newPort) {
    const p = Number(newPort);
    if (p > 0 && p < 65536) {
      this.port = p;
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ agent_port: this.port });
      }
      this.reconnect();
    }
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ agent_bridge_enabled: this.enabled });
    }
    if (this.enabled) {
      this.connect();
    } else {
      this.disconnect();
    }
  }

  connect() {
    if (!this.enabled) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.clearReconnect();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    const url = `ws://127.0.0.1:${this.port}`;
    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = async () => {
        if (this.ws !== ws) return;
        this.connected = true;
        this.reconnectDelay = 2000;
        await platformPromise;
        // Send enriched handshake info immediately
        const ua = navigator.userAgent || "";
        const browserName = ua.includes("Edg/") ? "Microsoft Edge"
                          : ua.includes("Brave") ? "Brave"
                          : ua.includes("Chrome") ? "Google Chrome"
                          : "Chromium";

        this.send({
          type: "HANDSHAKE",
          version: "1.0.0",
          agent: "AgentPilot-Extension",
          capabilities: ["tabs", "cdp", "cursor", "type", "click", "scroll", "inspector", "eyedropper", "screenshot"],
          details: {
            browser: browserName,
            os: currentPlatform,
            windowCount: 1,
            activeTabTitle: "Active Tab",
            activeTabUrl: ""
          }
        });

        // Asynchronously update with active tab & window info
        if (chrome.tabs && chrome.tabs.query) {
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, (activeTabs) => {
            const currentTab = activeTabs && activeTabs[0];
            if (chrome.windows && chrome.windows.getAll) {
              chrome.windows.getAll((windows) => {
                this.send({
                  type: "WINDOW_FOCUS",
                  activeTabTitle: currentTab?.title || "Active Tab",
                  activeTabUrl: currentTab?.url || "",
                  windowCount: windows ? windows.length : 1
                });
              });
            }
          });
        }
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          await this.handleAgentMessage(message);
        } catch (err) {
          console.error("[AgentPilot] Error handling agent message:", err);
        }
      };

      ws.onerror = () => {
        // Handled in onclose
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          this.connected = false;
          this.broadcastStatus();
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      this.ws = null;
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  disconnect() {
    this.clearReconnect();
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      this.connected = false;
      try { socket.close(); } catch {}
      this.broadcastStatus();
    }
  }

  reconnect() {
    this.disconnect();
    this.connect();
  }

  scheduleReconnect() {
    if (!this.enabled || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  send(data) {
    if (this.ws && this.connected && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (e) {
        console.warn("[AgentPilot] Failed to send over websocket:", e);
      }
    }
  }

  broadcastStatus() {
    broadcastToExtension({
      type: "AGENT_BRIDGE_STATUS_CHANGED",
      status: this.getStatus()
    });
  }

  async getActiveTabId() {
    return new Promise((resolve) => {
      // Prioritize the tab in the last focused window (the window user is looking at or working on)
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (!chrome.runtime.lastError && tabs && tabs.length > 0 && tabs[0]?.id) {
          return resolve(tabs[0].id);
        }
        // Fallback to active tab across any window
        chrome.tabs.query({ active: true }, (allActive) => {
          resolve(allActive && allActive.length > 0 ? allActive[0].id : null);
        });
      });
    });
  }

  async getTargetTabId(requestedTabId) {
    if (requestedTabId !== undefined && requestedTabId !== null) {
      const numId = Number(requestedTabId);
      if (isNaN(numId)) return null;
      try {
        const tab = await chrome.tabs.get(numId);
        return tab?.id || null;
      } catch (_) {
        return null; // Explicitly requested tab not found, never silently fallback
      }
    }
    // If agent previously opened or navigated a tab, prioritize that tab
    if (this.lastAgentTabId) {
      try {
        const tab = await chrome.tabs.get(this.lastAgentTabId);
        if (tab && tab.id) return tab.id;
      } catch (_) {
        this.lastAgentTabId = null;
      }
    }
    // Check any other agent-controlled tab that is still valid
    for (const tid of agentControlledTabs) {
      try {
        const tab = await chrome.tabs.get(tid);
        if (tab && tab.id) {
          this.lastAgentTabId = tab.id;
          return tab.id;
        }
      } catch (_) {
        agentControlledTabs.delete(tid);
      }
    }
    // Fallback to active tab in focused window
    return await this.getActiveTabId();
  }

  async ensureContentScript(tabId) {
    if (!tabId) return false;
    try {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:") || tab.url.startsWith("edge://")) {
        return false;
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => Boolean(window.__AGENT_PILOT__)
      }).catch(() => null);

      if (!results || !results[0] || !results[0].result) {
        await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] }).catch(() => {});
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
        await new Promise(r => setTimeout(r, 80));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async sendTabMessageWithRetry(tabId, message, maxRetries = 3, delayMs = 250) {
    await this.ensureContentScript(tabId);

    return new Promise((resolve, reject) => {
      let attempts = 0;
      const attempt = () => {
        attempts++;
        chrome.tabs.sendMessage(tabId, message, async (res) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message;
            if (attempts < maxRetries) {
              if (errMsg && errMsg.includes("Receiving end does not exist")) {
                await this.ensureContentScript(tabId);
              }
              setTimeout(attempt, delayMs);
            } else {
              reject(new Error(errMsg));
            }
          } else {
            resolve(res);
          }
        });
      };
      attempt();
    });
  }

  async assignTabToAgentGroup(tab) {
    if (!chrome.tabs || !chrome.tabs.group || !tab || !tab.id) return;
    try {
      const windowId = tab.windowId;
      let targetGroupId = null;

      if (chrome.tabGroups && chrome.tabGroups.query) {
        try {
          const groups = await chrome.tabGroups.query({ windowId });
          const existing = groups.find((g) => g.title === AGENT_GROUP_TITLE || g.title === "Agent Pilot");
          if (existing) targetGroupId = existing.id;
        } catch (_) {}
      }

      const groupId = await chrome.tabs.group({
        tabIds: [tab.id],
        groupId: targetGroupId || undefined
      });

      if (chrome.tabGroups && chrome.tabGroups.update && (!targetGroupId || groupId !== targetGroupId)) {
        await chrome.tabGroups.update(groupId, {
          title: AGENT_GROUP_TITLE,
          color: AGENT_GROUP_COLOR
        }).catch(() => {});
      }
    } catch (err) {
      console.warn("[AgentPilot] Tab grouping note:", err?.message || err);
    }
  }

  async setTabLock(tabId, busy, action = "") {
    if (!tabId) return false;
    const state = getTabLockState(tabId);
    state.manualLock = Boolean(busy);
    state.currentAction = action;
    if (state.unlockTimer) {
      clearTimeout(state.unlockTimer);
      state.unlockTimer = null;
    }

    if (busy) {
      return await this.sendTabMessageWithRetry(tabId, {
        action: "set_agent_busy",
        busy: true,
        currentAction: action || "AI Agent đang thao tác..."
      });
    } else {
      if (state.autoCount === 0) {
        return await this.sendTabMessageWithRetry(tabId, { action: "set_agent_busy", busy: false });
      }
      return { success: true, pendingAutoCount: state.autoCount };
    }
  }

  async runWithTabLock(tabId, actionName, runner) {
    if (!tabId) return await runner();

    const state = getTabLockState(tabId);
    if (state.unlockTimer) {
      clearTimeout(state.unlockTimer);
      state.unlockTimer = null;
    }

    const wasBusy = state.manualLock || state.autoCount > 0;
    state.autoCount++;
    state.currentAction = actionName;

    if (!wasBusy) {
      await this.sendTabMessageWithRetry(tabId, {
        action: "set_agent_busy",
        busy: true,
        currentAction: actionName
      }).catch(() => {});
    }

    try {
      return await runner();
    } finally {
      state.autoCount = Math.max(0, state.autoCount - 1);
      if (!state.manualLock && state.autoCount === 0) {
        state.unlockTimer = setTimeout(() => {
          state.unlockTimer = null;
          if (!state.manualLock && state.autoCount === 0) {
            this.sendTabMessageWithRetry(tabId, { action: "set_agent_busy", busy: false }).catch(() => {});
          }
        }, 150);
      }
    }
  }

  async captureTabScreenshot(tabId, params = {}) {
    const mode = params.mode || "visible";
    let targetTab = null;
    try {
      targetTab = await chrome.tabs.get(tabId);
    } catch (e) {
      throw new Error(`Target tab ${tabId} not found: ${e.message}`);
    }

    const isTabActive = Boolean(targetTab && targetTab.active);

    if (!isTabActive || attachedTabs.has(tabId)) {
      if (!attachedTabs.has(tabId)) {
        await attachDebugger(tabId).catch(() => {});
      }

      if (attachedTabs.has(tabId)) {
        const cdpParams = {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false
        };
        if ((mode === "element" || mode === "region") && params.clip) {
          cdpParams.clip = {
            x: params.clip.x,
            y: params.clip.y,
            width: params.clip.width,
            height: params.clip.height,
            scale: 1
          };
        }
        try {
          let res;
          try {
            res = await sendCdpCommand(tabId, "Page.captureScreenshot", cdpParams, 12000);
          } catch (firstErr) {
            console.warn("[AgentPilot] CDP screenshot initial attempt note:", firstErr?.message || firstErr);
            res = await sendCdpCommand(tabId, "Page.captureScreenshot", { format: "png" }, 12000);
          }
          return {
            success: true,
            tabId,
            isBackgroundTab: !isTabActive,
            dataUrl: "data:image/png;base64," + res.data,
            clip: params.clip
          };
        } catch (cdpErr) {
          console.warn("[AgentPilot] CDP screenshot failed on tab " + tabId + ":", cdpErr?.message || cdpErr);
          if (!isTabActive) {
            throw new Error(`CDP screenshot failed on background tab ${tabId}: ${cdpErr?.message || cdpErr}`);
          }
        }
      } else if (!isTabActive) {
        throw new Error(`Cannot capture background tab ${tabId}: CDP debugger attachment failed`);
      }
    }

    if (!isTabActive) {
      throw new Error(`Cannot capture background tab ${tabId} without active CDP`);
    }

    const winId = targetTab?.windowId || null;
    return new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(winId, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve({
          success: true,
          tabId,
          isBackgroundTab: false,
          dataUrl,
          clip: params.clip
        });
      });
    });
  }

  async executeBatchActions(params) {
    const actions = Array.isArray(params.actions) ? params.actions : [];
    const stopOnError = params.stopOnError !== false;
    let currentTabId = params.tabId ? await this.getTargetTabId(params.tabId) : (this.lastAgentTabId || (await this.getActiveTabId()));
    const results = [];
    const startTime = Date.now();

    for (let i = 0; i < actions.length; i++) {
      const act = actions[i];
      const stepNum = i + 1;
      const type = (act.type || act.action || "").toLowerCase();
      const stepResult = { step: stepNum, type, success: false };

      try {
        switch (type) {
          case "open":
          case "open_tab":
          case "tabs.create": {
            const url = normalizeUrl(act.url || "https://google.com");
            const makeActive = act.active === true;
            const activeTabBefore = !makeActive ? await this.getActiveTabId() : null;

            const tab = await new Promise((resolve, reject) => {
              chrome.tabs.create({ url, active: makeActive }, (t) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                resolve(t);
              });
            });

            currentTabId = tab.id;
            this.lastAgentTabId = tab.id;
            agentControlledTabs.add(tab.id);
            await this.assignTabToAgentGroup(tab).catch(() => {});

            if (!makeActive && activeTabBefore && activeTabBefore !== tab.id) {
              const curActive = await this.getActiveTabId();
              if (curActive === tab.id) {
                await chrome.tabs.update(activeTabBefore, { active: true }).catch(() => {});
              }
            }

            await attachDebugger(tab.id).catch(() => {});

            // Wait for tab load completion if requested (default true)
            if (act.waitUntil !== false) {
              await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                  chrome.tabs.onUpdated.removeListener(onUpdated);
                  resolve();
                }, Number(act.loadTimeout || 15000));

                const onUpdated = (tId, changeInfo) => {
                  if (tId === tab.id && changeInfo.status === "complete") {
                    clearTimeout(timeout);
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    resolve();
                  }
                };
                chrome.tabs.onUpdated.addListener(onUpdated);
                chrome.tabs.get(tab.id, (t) => {
                  if (t && t.status === "complete") {
                    clearTimeout(timeout);
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    resolve();
                  }
                });
              });
            }

            stepResult.success = true;
            stepResult.tabId = tab.id;
            stepResult.url = tab.url || tab.pendingUrl || url;
            break;
          }

          case "navigate":
          case "tabs.update": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for navigate");
            const url = normalizeUrl(act.url);
            await new Promise((resolve, reject) => {
              chrome.tabs.update(targetTabId, { url }, (t) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                resolve(t);
              });
            });

            if (act.waitUntil !== false) {
              await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                  chrome.tabs.onUpdated.removeListener(onUpdated);
                  resolve();
                }, Number(act.loadTimeout || 15000));

                const onUpdated = (tId, changeInfo) => {
                  if (tId === targetTabId && changeInfo.status === "complete") {
                    clearTimeout(timeout);
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    resolve();
                  }
                };
                chrome.tabs.onUpdated.addListener(onUpdated);
              });
            }

            stepResult.success = true;
            stepResult.tabId = targetTabId;
            stepResult.url = url;
            break;
          }

          case "close":
          case "close_tab":
          case "tabs.remove": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab to close");
            await new Promise((resolve, reject) => {
              chrome.tabs.remove(targetTabId, () => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                resolve();
              });
            });
            agentControlledTabs.delete(targetTabId);
            if (currentTabId === targetTabId) {
              currentTabId = null;
            }
            stepResult.success = true;
            stepResult.closedTabId = targetTabId;
            break;
          }

          case "wait_for_selector": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for wait_for_selector");
            await this.ensureContentScript(targetTabId);
            const res = await this.sendTabMessageWithRetry(targetTabId, {
              action: "wait_for_selector",
              selector: act.selector,
              timeoutMs: act.timeoutMs || act.timeout || 5000
            });
            if (!res || !res.success) throw new Error(res?.error || `Selector '${act.selector}' not found within timeout`);
            stepResult.success = true;
            stepResult.found = true;
            stepResult.details = res.details;
            break;
          }

          case "scroll_into_view": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for scroll_into_view");
            await this.ensureContentScript(targetTabId);
            const res = await this.sendTabMessageWithRetry(targetTabId, {
              action: "scroll_into_view",
              selector: act.selector,
              behavior: act.behavior || "auto"
            });
            if (!res || !res.success) throw new Error(res?.error || `Failed to scroll into view: ${act.selector}`);
            stepResult.success = true;
            stepResult.rect = res.rect;
            break;
          }

          case "click":
          case "page.click": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for click");
            await this.ensureContentScript(targetTabId);
            const res = await this.sendTabMessageWithRetry(targetTabId, {
              action: "click_cursor",
              selector: act.selector,
              x: act.x,
              y: act.y
            });
            if (!res || !res.success) throw new Error(res?.error || "Click failed");
            stepResult.success = true;
            stepResult.element = res.element;
            break;
          }

          case "type":
          case "page.type": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for type");
            await this.ensureContentScript(targetTabId);
            const res = await this.sendTabMessageWithRetry(targetTabId, {
              action: "type_text",
              selector: act.selector,
              text: act.text,
              clear: Boolean(act.clear),
              pressEnter: Boolean(act.pressEnter)
            });
            if (!res || !res.success) throw new Error(res?.error || "Type failed");
            stepResult.success = true;
            stepResult.textEntered = res.textEntered;
            break;
          }

          case "press_key":
          case "key": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for press_key");
            await this.ensureContentScript(targetTabId);
            const res = await this.sendTabMessageWithRetry(targetTabId, {
              action: "press_key",
              key: act.key || "Enter",
              selector: act.selector
            });
            stepResult.success = true;
            stepResult.key = act.key || "Enter";
            break;
          }

          case "scroll":
          case "page.scroll": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for scroll");
            await this.ensureContentScript(targetTabId);
            const res = await this.sendTabMessageWithRetry(targetTabId, {
              action: "scroll_page",
              deltaX: act.deltaX || 0,
              deltaY: act.deltaY || 0
            });
            stepResult.success = true;
            stepResult.scroll = res;
            break;
          }

          case "sleep":
          case "wait": {
            const ms = Number(act.ms || act.duration || 1000);
            await new Promise(r => setTimeout(r, ms));
            stepResult.success = true;
            stepResult.ms = ms;
            break;
          }

          case "screenshot":
          case "page.screenshot": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for screenshot");
            const shotRes = await this.captureTabScreenshot(targetTabId, act);
            stepResult.success = true;
            stepResult.dataUrl = shotRes.dataUrl;
            stepResult.label = act.label || act.name || `step_${stepNum}`;
            break;
          }

          case "get_element":
          case "page.getelement": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for get_element");
            await this.ensureContentScript(targetTabId);
            const res = await this.sendTabMessageWithRetry(targetTabId, {
              action: "get_element_info",
              selector: act.selector,
              x: act.x,
              y: act.y
            });
            if (!res || !res.success) throw new Error(res?.error || `Element not found: ${act.selector}`);
            stepResult.success = true;
            stepResult.element = res.details || res;
            break;
          }

          case "evaluate":
          case "eval": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for evaluate");
            await attachDebugger(targetTabId).catch(() => {});
            const evalRes = await sendCdpCommand(targetTabId, "Runtime.evaluate", {
              expression: act.expression,
              returnByValue: true,
              awaitPromise: true
            });
            stepResult.success = true;
            stepResult.value = evalRes?.result?.value;
            break;
          }

          case "cdp": {
            const targetTabId = act.tabId ? await this.getTargetTabId(act.tabId) : currentTabId;
            if (!targetTabId) throw new Error("No active tab for cdp");
            await attachDebugger(targetTabId).catch(() => {});
            const cdpRes = await sendCdpCommand(targetTabId, act.cdpMethod || act.method, act.cdpParams || act.params || {});
            stepResult.success = true;
            stepResult.result = cdpRes;
            break;
          }

          default:
            throw new Error(`Unsupported batch action type: ${type}`);
        }

        results.push(stepResult);
      } catch (stepErr) {
        stepResult.success = false;
        stepResult.error = stepErr.message || String(stepErr);
        results.push(stepResult);

        if (stopOnError) {
          return {
            success: false,
            error: `Batch execution halted at step ${stepNum} (${type}): ${stepErr.message || stepErr}`,
            failedStep: stepNum,
            totalActions: actions.length,
            executedActions: results.length,
            durationMs: Date.now() - startTime,
            results
          };
        }
      }
    }

    return {
      success: results.every(r => r.success),
      totalActions: actions.length,
      executedActions: results.length,
      durationMs: Date.now() - startTime,
      results
    };
  }

  async handleAgentMessage(msg) {
    const { id, method, params = {} } = msg;

    const respond = (result, error = null) => {
      if (!id) return;
      this.send({
        id,
        result: error ? undefined : result,
        error: error ? (error.message || String(error)) : null
      });

      // Broadcast real-time action log to extension sidepanel
      broadcastToExtension({
        type: "AGENT_ACTION_LOG",
        log: {
          id,
          method,
          params,
          timestamp: Date.now(),
          status: error ? "error" : "success",
          error: error ? (error.message || String(error)) : null
        }
      });
    };

    try {
      switch (method) {
        case "ping":
          respond({ pong: true, timestamp: Date.now(), version: "1.0.0" });
          break;

        case "tabs.query": {
          const queryParams = { ...params };
          delete queryParams.instanceId;
          chrome.tabs.query(queryParams, (tabs) => {
            if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
            else respond(tabs);
          });
          break;
        }

        case "tabs.listAll": {
          chrome.tabs.query({}, (tabs) => {
            if (chrome.runtime.lastError) {
              return respond(null, chrome.runtime.lastError);
            }
            const list = (tabs || []).map((t) => ({
              tabId: t.id,
              title: t.title,
              url: t.url,
              active: t.active,
              windowId: t.windowId,
              isAgentTab: agentControlledTabs.has(t.id),
              groupId: t.groupId
            }));
            respond(list);
          });
          break;
        }

        case "tabs.getActive": {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
            else respond(tabs[0] || null);
          });
          break;
        }

        case "tabs.create": {
          const url = normalizeUrl(params.url || "https://google.com");
          // Never steal focus from user unless explicitly specified active === true
          const makeActive = params.active === true;
          const activeTabBefore = !makeActive ? await this.getActiveTabId() : null;

          chrome.tabs.create({ url, active: makeActive }, async (tab) => {
            if (chrome.runtime.lastError) {
              respond(null, chrome.runtime.lastError);
            } else {
              if (tab && tab.id) {
                agentControlledTabs.add(tab.id);
                this.lastAgentTabId = tab.id;
                await this.assignTabToAgentGroup(tab).catch(() => {});

                // Safeguard: Only restore focus if the newly created tab itself accidentally stole focus.
                // Never yank focus away if the user is working on or switched to another tab.
                if (!makeActive && activeTabBefore && activeTabBefore !== tab.id) {
                  const currentActive = await this.getActiveTabId();
                  if (currentActive === tab.id) {
                    await chrome.tabs.update(activeTabBefore, { active: true }).catch(() => {});
                  }
                }

                // Auto-attach CDP for background capture & DevTools inspection
                await attachDebugger(tab.id).catch(() => {});
              }
              respond(tab);
            }
          });
          break;
        }

        case "tabs.update": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const updateProps = {};
          if (params.url) updateProps.url = normalizeUrl(params.url);
          if (params.active !== undefined) updateProps.active = Boolean(params.active);

          chrome.tabs.update(tabId, updateProps, async (tab) => {
            if (chrome.runtime.lastError) {
              respond(null, chrome.runtime.lastError);
            } else {
              if (tab && tab.id) {
                agentControlledTabs.add(tab.id);
                this.lastAgentTabId = tab.id;
                await this.assignTabToAgentGroup(tab).catch(() => {});
                await attachDebugger(tab.id).catch(() => {});
              }
              respond(tab);
            }
          });
          break;
        }

        case "tabs.remove": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
            else respond({ success: true });
          });
          break;
        }

        case "cdp.attach": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const res = await attachDebugger(tabId);
          respond(res);
          break;
        }

        case "cdp.detach": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const res = await detachDebugger(tabId);
          respond(res);
          break;
        }

        case "cdp.send": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const res = await sendCdpCommand(tabId, params.cdpMethod, params.cdpParams || {});
          respond(res);
          break;
        }

        case "page.moveMouse": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.moveMouse", () =>
            this.sendTabMessageWithRetry(tabId, {
              action: "move_cursor",
              x: params.x,
              y: params.y,
              duration: params.duration || 300
            })
          )
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.click": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.click", () =>
            this.sendTabMessageWithRetry(tabId, {
              action: "click_cursor",
              x: params.x,
              y: params.y,
              selector: params.selector
            })
          )
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.type": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.type", () =>
            this.sendTabMessageWithRetry(tabId, {
              action: "type_text",
              selector: params.selector,
              text: params.text,
              delay: params.delay || 50
            })
          )
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.scroll": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.scroll", () =>
            this.sendTabMessageWithRetry(tabId, {
              action: "scroll_page",
              deltaX: params.deltaX || 0,
              deltaY: params.deltaY || 0,
              smooth: params.smooth !== false
            })
          )
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.setBusy":
        case "agent.setBusy": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const res = await this.setTabLock(tabId, params.busy !== false, params.action || "");
          respond(res || { success: true });
          break;
        }

        case "page.getElement": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.sendTabMessageWithRetry(tabId, {
            action: "get_element_info",
            selector: params.selector,
            x: params.x,
            y: params.y
          })
            .then(res => respond(res || null))
            .catch(err => respond(null, err));
          break;
        }

        case "page.pickColor": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.sendTabMessageWithRetry(tabId, { action: "pick_color" })
            .then(res => respond(res || null))
            .catch(err => respond(null, err));
          break;
        }

        case "page.screenshot": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.captureTabScreenshot(tabId, params)
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "batch.run":
        case "batch.execute": {
          this.executeBatchActions(params)
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "devtools.getData": {
          const tabId = await this.getTargetTabId(params.tabId);
          const buffer = getBuffer(tabId);
          respond({
            console: buffer.console,
            network: Array.from(buffer.network.values()).slice(-100),
            attached: attachedTabs.has(tabId)
          });
          break;
        }

        default:
          respond(null, new Error(`Unknown method: ${method}`));
      }
    } catch (err) {
      respond(null, err);
    }
  }
}

// Initialize the WebSocket bridge client
const agentBridge = new AgentBridgeClient();

// Periodic keepalive alarm (every ~24s = 0.4 min) to wake up and keep connection active
if (chrome.alarms) {
  chrome.alarms.create("agent_pilot_bridge_keepalive", { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "agent_pilot_bridge_keepalive") {
      if (typeof agentBridge !== "undefined" && agentBridge) {
        if (!agentBridge.connected && agentBridge.enabled) {
          agentBridge.connect();
        } else if (agentBridge.connected) {
          agentBridge.send({ type: "HEARTBEAT", timestamp: Date.now() });
        }
      }
    }
  });
}

