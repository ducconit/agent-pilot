/**
 * Agent Pilot - Background Service Worker (Manifest V3)
 * Universal AI Agent Browser Controller - Antigravity First
 */

// Track attached debugger sessions and buffered devtools events
const attachedTabs = new Set();
const devtoolsBuffers = new Map(); // tabId -> { console: [], network: [], performance: {} }

// Enable Side Panel behavior on icon click if supported
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

// Context Menu setup for quick inspection
chrome.runtime.onInstalled.addListener(() => {
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId === "agent_pilot_open_sidepanel") {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ tabId: tab.id });
    }
  } else if (info.menuItemId === "agent_pilot_inspect_element") {
    chrome.tabs.sendMessage(tab.id, { action: "toggle_inspector", enabled: true }).catch(() => {});
  } else if (info.menuItemId === "agent_pilot_pick_color") {
    chrome.tabs.sendMessage(tab.id, { action: "pick_color" }).catch(() => {});
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
function sendCdpCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!attachedTabs.has(tabId)) {
      return reject(new Error("Debugger not attached to tab " + tabId));
    }
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
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
    let url = request.url || "https://google.com";
    if (url && !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("chrome://")) {
      url = "https://" + url;
    }
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
    let url = request.url || "";
    if (url && !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("chrome://")) {
      url = "https://" + url;
    }
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
    const { mode, tabId, clip } = request; // mode: "visible" | "region" | "element"

    if (mode === "visible") {
      // If CDP is attached to tabId, use Page.captureScreenshot directly
      if (tabId && attachedTabs.has(tabId)) {
        sendCdpCommand(tabId, "Page.captureScreenshot", { format: "png" })
          .then((res) => {
            sendResponse({ success: true, dataUrl: "data:image/png;base64," + res.data });
          })
          .catch((err) => {
            // Fallback to captureVisibleTab
            chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
              if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
              } else {
                sendResponse({ success: true, dataUrl });
              }
            });
          });
        return true;
      }

      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, dataUrl });
        }
      });
      return true;
    }

    if (mode === "element" || mode === "region") {
      // If CDP is attached, we can use CDP Page.captureScreenshot with clip
      if (attachedTabs.has(tabId) && clip) {
        sendCdpCommand(tabId, "Page.captureScreenshot", {
          format: "png",
          clip: {
            x: clip.x,
            y: clip.y,
            width: clip.width,
            height: clip.height,
            scale: 1
          },
          captureBeyondViewport: false
        })
          .then((res) => {
            const dataUrl = "data:image/png;base64," + res.data;
            sendResponse({ success: true, dataUrl });
          })
          .catch(() => {
            // Fallback to visible tab + crop via content/sidepanel
            chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
              if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
              } else {
                sendResponse({ success: true, dataUrl, requiresCrop: true, clip });
              }
            });
          });
      } else {
        // Capture visible tab and forward clip info for canvas cropping
        chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, dataUrl, requiresCrop: true, clip });
          }
        });
      }
      return true;
    }
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
    if (!this.enabled || this.ws) return;
    this.clearReconnect();

    const url = `ws://127.0.0.1:${this.port}`;
    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.connected = true;
        this.reconnectDelay = 2000;
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

  sendTabMessageWithRetry(tabId, message, maxRetries = 4, delayMs = 300) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      function attempt() {
        attempts++;
        chrome.tabs.sendMessage(tabId, message, (res) => {
          if (chrome.runtime.lastError) {
            if (attempts < maxRetries) {
              setTimeout(attempt, delayMs);
            } else {
              reject(new Error(chrome.runtime.lastError.message));
            }
          } else {
            resolve(res);
          }
        });
      }
      attempt();
    });
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
    };

    try {
      switch (method) {
        case "ping":
          respond({ pong: true, timestamp: Date.now(), version: "1.0.0" });
          break;

        case "tabs.query": {
          chrome.tabs.query(params, (tabs) => {
            if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
            else respond(tabs);
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
          let url = params.url || "https://google.com";
          if (url && !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("chrome://")) {
            url = "https://" + url;
          }
          chrome.tabs.create({ url, active: params.active !== false }, (tab) => {
            if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
            else respond(tab);
          });
          break;
        }

        case "tabs.update": {
          const tabId = params.tabId || (await this.getActiveTabId());
          if (!tabId) return respond(null, new Error("No target tab found"));
          let url = params.url || "";
          if (url && !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("chrome://")) {
            url = "https://" + url;
          }
          chrome.tabs.update(tabId, { url }, (tab) => {
            if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
            else respond(tab);
          });
          break;
        }

        case "tabs.remove": {
          const tabId = params.tabId || (await this.getActiveTabId());
          if (!tabId) return respond(null, new Error("No target tab found"));
          chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
            else respond({ success: true });
          });
          break;
        }

        case "cdp.attach": {
          const tabId = params.tabId || (await this.getActiveTabId());
          if (!tabId) return respond(null, new Error("No target tab found"));
          const res = await attachDebugger(tabId);
          respond(res);
          break;
        }

        case "cdp.detach": {
          const tabId = params.tabId || (await this.getActiveTabId());
          if (!tabId) return respond(null, new Error("No target tab found"));
          const res = await detachDebugger(tabId);
          respond(res);
          break;
        }

        case "cdp.send": {
          const tabId = params.tabId || (await this.getActiveTabId());
          if (!tabId) return respond(null, new Error("No target tab found"));
          const res = await sendCdpCommand(tabId, params.cdpMethod, params.cdpParams || {});
          respond(res);
          break;
        }

        case "page.moveMouse": {
          const tabId = params.tabId || (await this.getActiveTabId());
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.sendTabMessageWithRetry(tabId, {
            action: "move_cursor",
            x: params.x,
            y: params.y,
            duration: params.duration || 300
          })
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.click": {
          const tabId = params.tabId || (await this.getActiveTabId());
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.sendTabMessageWithRetry(tabId, {
            action: "click_cursor",
            x: params.x,
            y: params.y,
            selector: params.selector
          })
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.type": {
          const tabId = params.tabId || (await this.getActiveTabId());
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.sendTabMessageWithRetry(tabId, {
            action: "type_text",
            selector: params.selector,
            text: params.text,
            delay: params.delay || 50
          })
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.scroll": {
          const tabId = params.tabId || (await this.getActiveTabId());
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.sendTabMessageWithRetry(tabId, {
            action: "scroll_page",
            deltaX: params.deltaX || 0,
            deltaY: params.deltaY || 0,
            smooth: params.smooth !== false
          })
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.getElement": {
          const tabId = params.tabId || (await this.getActiveTabId());
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
          const tabId = params.tabId || (await this.getActiveTabId());
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.sendTabMessageWithRetry(tabId, { action: "pick_color" })
            .then(res => respond(res || null))
            .catch(err => respond(null, err));
          break;
        }

        case "page.screenshot": {
          const mode = params.mode || "visible";
          const tabId = params.tabId || (await this.getActiveTabId());
          if (mode === "visible") {
            if (tabId && attachedTabs.has(tabId)) {
              sendCdpCommand(tabId, "Page.captureScreenshot", { format: "png" })
                .then((r) => respond({ success: true, dataUrl: "data:image/png;base64," + r.data }))
                .catch(() => {
                  chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
                    if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
                    else respond({ success: true, dataUrl });
                  });
                });
            } else {
              chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
                if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
                else respond({ success: true, dataUrl });
              });
            }
          } else {
            chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
              if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
              else respond({ success: true, dataUrl, clip: params.clip });
            });
          }
          break;
        }

        case "devtools.getData": {
          const tabId = params.tabId || (await this.getActiveTabId());
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

