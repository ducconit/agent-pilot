/**
 * Agent Pilot - AI Agent WebSocket Bridge Client
 * Connects to ws://127.0.0.1:<PORT> to receive commands from AI Agents (Antigravity)
 */

import {
  DEFAULT_AGENT_PORT,
  agentControlledTabs,
  normalizeUrl,
  currentPlatform,
  platformPromise,
  getBuffer,
  attachedTabs,
  getSecretFilterEnabled,
  setSecretFilterEnabled
} from "./constants.js";
import { sanitizeData } from "./secret-sanitizer.js";
import { attachDebugger, detachDebugger, sendCdpCommand } from "./cdp-manager.js";
import {
  getActiveTabId,
  getTargetTabId,
  assignTabToAgentGroup,
  ensureContentScript,
  sendTabMessageWithRetry,
  setTabLock,
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
    this.reconnectDelay = 2000;
    this.maxReconnectDelay = 20000;
    this.enabled = true;
    this.lastAgentTabId = null;
    this.broadcastFn = broadcastFn;

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

  setBroadcastFn(fn) {
    this.broadcastFn = fn;
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
    return await getTargetTabId(requestedTabId, this.lastAgentTabId);
  }

  async ensureContentScript(tabId) {
    return await ensureContentScript(tabId);
  }

  async sendTabMessageWithRetry(tabId, message, maxRetries = 3, delayMs = 250) {
    return await sendTabMessageWithRetry(tabId, message, maxRetries, delayMs);
  }

  async assignTabToAgentGroup(tab) {
    return await assignTabToAgentGroup(tab);
  }

  async setTabLock(tabId, busy, action = "") {
    return await setTabLock(tabId, busy, action);
  }

  async runWithTabLock(tabId, actionName, runner) {
    return await runWithTabLock(tabId, actionName, runner);
  }

  async captureTabScreenshot(tabId, params = {}) {
    return await captureTabScreenshot(tabId, params);
  }

  async executeBatchActions(params) {
    return await executeBatchActions(params, this);
  }

  async handleAgentMessage(msg) {
    const { id, method, params = {} } = msg;

    const respond = (result, error = null) => {
      if (!id) return;
      const isFilterActive = getSecretFilterEnabled();
      const sanitizedResult = (error || result === undefined || result === null)
        ? result
        : sanitizeData(result, isFilterActive);

      this.send({
        id,
        result: error ? undefined : sanitizedResult,
        error: error ? (error.message || String(error)) : null,
        secretFilterEnabled: isFilterActive
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

                if (!makeActive && activeTabBefore && activeTabBefore !== tab.id) {
                  const currentActive = await this.getActiveTabId();
                  if (currentActive === tab.id) {
                    await chrome.tabs.update(activeTabBefore, { active: true }).catch(() => {});
                  }
                }

                await attachDebugger(tab.id, this.broadcastFn).catch(() => {});
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
                await attachDebugger(tab.id, this.broadcastFn).catch(() => {});
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
          const res = await attachDebugger(tabId, this.broadcastFn);
          respond(res);
          break;
        }

        case "cdp.detach": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const res = await detachDebugger(tabId, this.broadcastFn);
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

        case "config.getSecretFilter": {
          respond({ enabled: getSecretFilterEnabled() });
          break;
        }

        case "config.setSecretFilter": {
          if (params.enabled !== undefined) {
            setSecretFilterEnabled(Boolean(params.enabled));
          }
          respond({ enabled: getSecretFilterEnabled() });
          break;
        }

        case "extension.reload":
        case "runtime.reload": {
          respond({ success: true, message: "Reloading extension..." });
          setTimeout(() => {
            chrome.runtime.reload();
          }, 150);
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
