/**
 * Agent Pilot - WebSocket transport and bounded outbound queue
 *
 * This module owns connection lifecycle only. AgentBridgeClient keeps the same
 * public methods through installTransportMethods(), so existing background/UI
 * callers do not need to know whether transport is composed or inherited.
 */

import {
  BRIDGE,
  DEFAULT_AGENT_PORT,
  EXTENSION_VERSION,
  LIMITS,
  currentPlatform,
  logDebug,
  platformPromise
} from "./constants.js";

export function initializeTransport(client, broadcastFn) {
  client.port = DEFAULT_AGENT_PORT;
  client.ws = null;
  client.connected = false;
  client.reconnectTimer = null;
  client.reconnectDelay = BRIDGE.RECONNECT_BASE_MS;
  client.maxReconnectDelay = BRIDGE.RECONNECT_MAX_MS;
  client.enabled = true;
  client.lastAgentTabId = null;
  client.apiKey = "";
  client.broadcastFn = broadcastFn;
  client.outboundQueue = [];
  client.maxQueueSize = LIMITS.OUTBOUND_QUEUE_MAX;

  if (chrome.windows && chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener((windowId) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) return;
      if (client.connected && client.ws && client.ws.readyState === WebSocket.OPEN) {
        chrome.tabs.query({ active: true, windowId }, (tabs) => {
          const tab = tabs && tabs[0];
          client.send({
            type: "WINDOW_FOCUS",
            windowId,
            activeTabTitle: tab?.title || "",
            activeTabUrl: tab?.url || ""
          });
        });
      }
    });
  }

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["agent_port", "agent_bridge_enabled", "agent_bridge_api_key"], (res) => {
      if (res.agent_port) client.port = Number(res.agent_port) || DEFAULT_AGENT_PORT;
      if (res.agent_bridge_enabled !== undefined) client.enabled = !!res.agent_bridge_enabled;
      if (typeof res.agent_bridge_api_key === "string") client.apiKey = res.agent_bridge_api_key.trim();
      if (client.enabled) client.connect();
    });
  } else {
    client.connect();
  }
}

export const transportMethods = {
  setBroadcastFn(fn) {
    this.broadcastFn = fn;
  },

  getStatus() {
    return {
      connected: this.connected,
      port: this.port,
      enabled: this.enabled,
      authConfigured: Boolean(this.apiKey),
      url: `ws://127.0.0.1:${this.port}`
    };
  },

  setPort(newPort) {
    const p = Number(newPort);
    if (p > 0 && p < 65536) {
      this.port = p;
      this.reconnectDelay = BRIDGE.RECONNECT_BASE_MS;
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ agent_port: this.port });
      }
      this.reconnect();
    }
  },

  setApiKey(value) {
    this.apiKey = typeof value === "string" ? value.trim() : "";
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ agent_bridge_api_key: this.apiKey });
    }
    this.reconnect();
  },

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ agent_bridge_enabled: this.enabled });
    }
    if (this.enabled) this.connect();
    else this.disconnect();
  },

  connect() {
    if (!this.enabled) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.clearReconnect();
    if (this.ws) {
      try { this.ws.close(); } catch (err) { logDebug("WS previous connection close error", err); }
      this.ws = null;
    }

    const url = `ws://127.0.0.1:${this.port}`;
    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = async () => {
        if (this.ws !== ws) return;
        this.connected = true;
        this.reconnectDelay = BRIDGE.RECONNECT_BASE_MS;
        await platformPromise;

        const ua = navigator.userAgent || "";
        const browserName = ua.includes("Edg/") ? "Microsoft Edge"
                          : ua.includes("Brave") ? "Brave"
                          : ua.includes("Chrome") ? "Google Chrome"
                          : "Chromium";

        this.send({
          type: "HANDSHAKE",
          version: EXTENSION_VERSION,
          agent: "AgentPilot-Extension",
          ...(this.apiKey ? { apiKey: this.apiKey } : {}),
          capabilities: ["tabs", "cdp", "cursor", "type", "click", "scroll", "inspector", "eyedropper", "screenshot"],
          details: {
            browser: browserName,
            os: currentPlatform,
            windowCount: 1,
            activeTabTitle: "Active Tab",
            activeTabUrl: ""
          }
        });

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

        this.flushOutboundQueue();
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          await this.handleAgentMessage(message);
        } catch (err) {
          console.error("[AgentPilot] Error handling agent message:", err);
        }
      };

      ws.onerror = () => {};
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
  },

  disconnect() {
    this.clearReconnect();
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      this.connected = false;
      try { socket.close(); } catch (err) { logDebug("WS socket close error", err); }
      this.broadcastStatus();
    }
  },

  reconnect() {
    this.disconnect();
    this.connect();
  },

  scheduleReconnect() {
    if (!this.enabled || this.reconnectTimer) return;
    const jitter = Math.floor(this.reconnectDelay * BRIDGE.RECONNECT_JITTER_RATIO * Math.random());
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay + jitter);
  },

  requestReconnect() {
    if (!this.enabled || this.connected) return;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
    if (this.reconnectTimer) return;
    this.connect();
  },

  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  },

  trySend(data) {
    if (!this.ws || !this.connected || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn("[AgentPilot] Failed to send over websocket:", e);
      return false;
    }
  },

  send(data) {
    if (this.trySend(data)) return;

    // Bounded queue prevents async responses from disappearing during reconnect.
    if (!this.enabled) return;
    if (this.outboundQueue.length >= this.maxQueueSize) {
      this.outboundQueue.shift();
      console.warn("[AgentPilot] Outbound queue full; dropped oldest message");
    }
    this.outboundQueue.push(data);
  },

  flushOutboundQueue() {
    if (!this.outboundQueue.length) return;
    const queued = this.outboundQueue;
    this.outboundQueue = [];
    for (let index = 0; index < queued.length; index++) {
      // If the socket closes between two frames, preserve the failed frame and
      // every remaining frame in order for the next reconnect.
      if (!this.trySend(queued[index])) {
        this.outboundQueue = queued.slice(index);
        return;
      }
    }
  },

  broadcastStatus() {
    if (typeof this.broadcastFn === "function") {
      this.broadcastFn({ type: "AGENT_BRIDGE_STATUS_CHANGED", status: this.getStatus() });
    }
  }
};

export function installTransportMethods(ClientClass) {
  Object.assign(ClientClass.prototype, transportMethods);
}
