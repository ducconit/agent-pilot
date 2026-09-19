/**
 * Agent Pilot - AI Agent WebSocket Bridge Client
 * Connects to ws://127.0.0.1:<PORT> to receive commands from AI Agents (Antigravity)
 */

import {
  DEFAULT_AGENT_PORT,
  BRIDGE,
  TIMEOUTS,
  LIMITS,
  currentPlatform,
  platformPromise,
  getSecretFilterEnabled,
  logDebug,
  EXTENSION_VERSION
} from "./constants.js";
import { sanitizeData, sanitizeDataWithMeta, AGENT_SECURITY_NOTICE } from "./secret-sanitizer.js";
import { AGENT_COMMAND_HANDLERS } from "./agent-handlers/index.js";
import { saveFeedbackInbox, pushFeedbackLive } from "./feedback-client.js";
import {
  getActiveTabId,
  getTargetTabId,
  assignTabToAgentGroup,
  markTabAsAgentControlled,
  ensureContentScript,
  sendTabMessageWithRetry,
  setTabLock,
  setTabSession,
  runWithTabLock
} from "./tab-manager.js";
import { captureTabScreenshot } from "./screenshot-service.js";
import { executeBatchActions } from "./batch-executor.js";

export class AgentBridgeClient {
  constructor(broadcastFn = null) {
    this.port = DEFAULT_AGENT_PORT;
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.reconnectDelay = BRIDGE.RECONNECT_BASE_MS;
    this.maxReconnectDelay = BRIDGE.RECONNECT_MAX_MS;
    this.enabled = true;
    this.lastAgentTabId = null;
    this.apiKey = "";
    this.broadcastFn = broadcastFn;
    this.outboundQueue = [];
    this.maxQueueSize = LIMITS.OUTBOUND_QUEUE_MAX;

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
      chrome.storage.local.get(["agent_port", "agent_bridge_enabled", "agent_bridge_api_key"], (res) => {
        if (res.agent_port) this.port = Number(res.agent_port) || DEFAULT_AGENT_PORT;
        if (res.agent_bridge_enabled !== undefined) this.enabled = !!res.agent_bridge_enabled;
        if (typeof res.agent_bridge_api_key === "string") this.apiKey = res.agent_bridge_api_key.trim();
        if (this.enabled) this.connect();
      });
    } else {
      this.connect();
    }
  }

  setBroadcastFn(fn) {
    this.broadcastFn = fn;
  }

  getStatus() {
    return {
      connected: this.connected,
      port: this.port,
      enabled: this.enabled,
      authConfigured: Boolean(this.apiKey),
      url: `ws://127.0.0.1:${this.port}`
    };
  }

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
  }

  setApiKey(value) {
    this.apiKey = typeof value === "string" ? value.trim() : "";
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ agent_bridge_api_key: this.apiKey });
    }
    this.reconnect();
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
  }

  disconnect() {
    this.clearReconnect();
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      this.connected = false;
      try { socket.close(); } catch (err) { logDebug("WS socket close error", err); }
      this.broadcastStatus();
    }
  }

  reconnect() {
    this.disconnect();
    this.connect();
  }

  scheduleReconnect() {
    if (!this.enabled || this.reconnectTimer) return;
    const jitter = Math.floor(this.reconnectDelay * BRIDGE.RECONNECT_JITTER_RATIO * Math.random());
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay + jitter);
  }

  /**
   * Reconnect request coming from tab lifecycle events: respects any pending
   * backoff timer instead of cancelling it, so tab activity cannot storm the bridge.
   */
  requestReconnect() {
    if (!this.enabled || this.connected) return;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
    if (this.reconnectTimer) return;
    this.connect();
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
      return;
    }

    // Socket not ready: keep a bounded queue so async responses are not silently lost
    if (!this.enabled) return;
    if (this.outboundQueue.length >= this.maxQueueSize) {
      this.outboundQueue.shift();
      console.warn("[AgentPilot] Outbound queue full; dropped oldest message");
    }
    this.outboundQueue.push(data);
  }

  flushOutboundQueue() {
    if (!this.outboundQueue.length) return;
    const queued = this.outboundQueue;
    this.outboundQueue = [];
    for (const item of queued) {
      this.send(item);
    }
  }

  broadcastStatus() {
    if (typeof this.broadcastFn === "function") {
      this.broadcastFn({
        type: "AGENT_BRIDGE_STATUS_CHANGED",
        status: this.getStatus()
      });
    }
  }

  async getActiveTabId() {
    return await getActiveTabId();
  }

  async getTargetTabId(requestedTabId) {
    const tabId = await getTargetTabId(requestedTabId, this.lastAgentTabId);
    if (tabId) {
      this.markTabAsAgentControlled(tabId).catch((err) => logDebug("markTabAsAgentControlled error", err));
    }
    return tabId;
  }

  async markTabAsAgentControlled(tabId) {
    if (!tabId) return;
    this.lastAgentTabId = tabId;
    return await markTabAsAgentControlled(tabId);
  }

  async ensureContentScript(tabId) {
    return await ensureContentScript(tabId);
  }

  async sendTabMessageWithRetry(tabId, message, maxRetries = TIMEOUTS.TAB_MESSAGE_RETRIES, delayMs = TIMEOUTS.TAB_MESSAGE_RETRY_DELAY_MS) {
    return await sendTabMessageWithRetry(tabId, message, maxRetries, delayMs);
  }

  async assignTabToAgentGroup(tab) {
    return await assignTabToAgentGroup(tab);
  }

  async setTabLock(tabId, busy, action = "") {
    return await setTabLock(tabId, busy, action);
  }

  async setTabSession(tabId, active, sessionName = "") {
    return await setTabSession(tabId, active, sessionName);
  }

  async runWithTabLock(tabId, actionName, runner) {
    return await runWithTabLock(tabId, actionName, runner);
  }

  async captureTabScreenshot(tabId, params = {}) {
    return await captureTabScreenshot(tabId, params);
  }

  /**
   * Normalize the input backend: synthetic (default, unchanged behavior), cdp (trusted) or auto (cdp with synthetic fallback).
   */
  normalizeVia(params) {
    const via = String((params && params.via) || "synthetic").toLowerCase();
    return via === "cdp" || via === "auto" ? via : "synthetic";
  }

  /**
   * Resolve a viewport point for trusted CDP input from explicit coordinates or a CSS selector.
   */
  async resolveCdpPoint(tabId, params, label = "point") {
    const hasX = params.x !== undefined && params.x !== null && params.x !== "";
    const hasY = params.y !== undefined && params.y !== null && params.y !== "";
    if (hasX && hasY) {
      return { x: Number(params.x), y: Number(params.y) };
    }
    if (!params.selector) {
      throw new Error(`Cannot resolve ${label}: provide x/y coordinates or a selector`);
    }
    const res = await this.sendTabMessageWithRetry(tabId, {
      action: "virtual_hover",
      selector: params.selector,
      dispatchSynthetic: false
    });
    const coords = res && (res.coords || (res.x !== undefined && res.y !== undefined ? { x: res.x, y: res.y } : null));
    if (!coords || !Number.isFinite(Number(coords.x)) || !Number.isFinite(Number(coords.y))) {
      throw new Error(`Cannot resolve ${label} coordinates for selector: ${params.selector}`);
    }
    return { x: Number(coords.x), y: Number(coords.y) };
  }

  async executeBatchActions(params) {
    return await executeBatchActions(params, this);
  }

  /**
   * Dispatch an agent command to its registered handler (see agent-handlers/).
   * The responder closure owns sanitization and activity broadcasting, so each
   * handler only implements its own domain logic.
   */
  async handleAgentMessage(msg) {
    const { id, method, params = {} } = msg;
    const respond = this.createResponder(id, method, params);

    const handler = AGENT_COMMAND_HANDLERS[method];
    if (!handler) {
      respond(null, new Error(`Unknown method: ${method}`));
      return;
    }

    try {
      await handler(this, params, respond);
    } catch (err) {
      respond(null, err);
    }
  }

  /**
   * Build the response callback for one agent request:
   * - masks secrets when the filter is enabled and reports masking metadata in the
   *   response envelope (array results lose attached properties through JSON.stringify)
   * - emits a sanitized AGENT_ACTION_LOG broadcast for the side-panel activity list
   */
  createResponder(id, method, params) {
    return (result, error = null) => {
      if (!id) return;
      const isFilterActive = getSecretFilterEnabled();
      let sanitizedResult = result;
      let maskedCount = 0;
      let maskedTypes = [];

      if (result !== undefined && result !== null) {
        const sanitized = sanitizeDataWithMeta(result, isFilterActive);
        sanitizedResult = sanitized.data;
        maskedCount = sanitized.maskedCount;
        maskedTypes = sanitized.types;
      }

      let sanitizedError = error ? (error.message || String(error)) : null;
      if (sanitizedError && isFilterActive) {
        const sanitizedErr = sanitizeDataWithMeta(sanitizedError, true);
        if (typeof sanitizedErr.data === "string") {
          sanitizedError = sanitizedErr.data;
        }
      }

      this.send({
        id,
        result: error ? undefined : sanitizedResult,
        error: sanitizedError,
        secretFilterEnabled: isFilterActive,
        ...(maskedCount > 0 ? {
          securityNotice: AGENT_SECURITY_NOTICE,
          maskedCount,
          maskedTypes
        } : {})
      });

      if (typeof this.broadcastFn === "function") {
        this.broadcastFn({
          type: "AGENT_ACTION_LOG",
          log: {
            id,
            method,
            params: sanitizeData(params, isFilterActive),
            timestamp: Date.now(),
            status: error ? "error" : "success",
            error: error ? (error.message || String(error)) : null
          }
        });
      }
    };
  }

  /**
   * Save feedback session to shared filesystem inbox ~/.agent-pilot/inbox/feedback/<timestamp>/* (Channel B)
   * Falls back to chrome.storage.local if bridge server is not reachable.
   */
  async saveFeedbackInbox(payload) {
    return await saveFeedbackInbox(this, payload);
  }

  /**
   * Push feedback session live to waiting agent via HTTP or WebSocket fallback (Channel A)
   */
  async pushFeedbackLive(payload) {
    return await pushFeedbackLive(this, payload);
  }
}

