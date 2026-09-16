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
  setSecretFilterEnabled,
  logDebug
} from "./constants.js";
import { sanitizeData } from "./secret-sanitizer.js";
import {
  attachDebugger,
  detachDebugger,
  sendCdpCommand,
  uploadFileInput,
  handleJavaScriptDialog,
  getActiveDialog,
  setEmulation,
  getNetworkResponseBody,
  startPerformanceTrace,
  stopPerformanceTrace,
  getPerformanceMetrics,
  takeHeapSnapshot,
  collectGarbage,
  dispatchCdpKeyEvent,
  dispatchCdpMouseMove
} from "./cdp-manager.js";
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

const EXTENSION_VERSION = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest)
  ? (chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version)
  : "1.0.1-beta";

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
        this.reconnectDelay = 2000;
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

  async sendTabMessageWithRetry(tabId, message, maxRetries = 3, delayMs = 250) {
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
          respond({ pong: true, timestamp: Date.now(), version: EXTENSION_VERSION });
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
                await this.assignTabToAgentGroup(tab).catch((err) => logDebug("assignTabToAgentGroup error", err));

                if (!makeActive && activeTabBefore && activeTabBefore !== tab.id) {
                  const currentActive = await this.getActiveTabId();
                  if (currentActive === tab.id) {
                    await chrome.tabs.update(activeTabBefore, { active: true }).catch((err) => logDebug("restore active tab error", err));
                  }
                }

                await attachDebugger(tab.id, this.broadcastFn).catch((err) => logDebug("attachDebugger error", err));
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
                await this.assignTabToAgentGroup(tab).catch((err) => logDebug("assignTabToAgentGroup error", err));
                await attachDebugger(tab.id, this.broadcastFn).catch((err) => logDebug("attachDebugger error", err));
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
          const cdpMethod = params.cdpMethod || params.method || params.action;
          if (!cdpMethod) return respond(null, new Error("Missing CDP method (cdpMethod or method)"));
          const cdpParams = params.cdpParams || params.commandParams || params.params || {};
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, this.broadcastFn).catch((err) => logDebug("cdp.send auto-attach error", err));
          }
          sendCdpCommand(tabId, cdpMethod, cdpParams)
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.evaluate":
        case "evaluate": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const script = params.script || params.expression || params.code || "";
          if (!script) return respond(null, new Error("Missing script or expression to evaluate"));

          this.runWithTabLock(tabId, "page.evaluate", async () => {
            // Attempt 1: Execute in MAIN world for direct window/DOM framework access
            try {
              const results = await chrome.scripting.executeScript({
                target: { tabId },
                world: "MAIN",
                func: async (code) => {
                  try {
                    const rawVal = window.eval(code);
                    const value = await Promise.resolve(rawVal);
                    return { __eval_ok: true, value };
                  } catch (e) {
                    return { __eval_err: true, message: e?.message || String(e), stack: e?.stack };
                  }
                },
                args: [script]
              });
              if (results && results[0] && results[0].result) {
                const resObj = results[0].result;
                if (resObj.__eval_err) {
                  throw new Error(resObj.message);
                }
                return resObj.value;
              }
            } catch (scriptingErr) {
              logDebug("evaluate in MAIN world fallback to CDP", scriptingErr);
            }

            // Attempt 2: Fallback to CDP Runtime.evaluate
            if (!attachedTabs.has(tabId)) {
              await attachDebugger(tabId, this.broadcastFn).catch((err) => logDebug("evaluate attachDebugger", err));
            }
            const evalRes = await sendCdpCommand(tabId, "Runtime.evaluate", {
              expression: script,
              returnByValue: true,
              awaitPromise: true
            });
            if (evalRes?.exceptionDetails) {
              throw new Error(evalRes.exceptionDetails.exception?.description || evalRes.exceptionDetails.text);
            }
            return evalRes?.result?.value ?? evalRes;
          })
            .then(res => respond(res !== undefined ? res : null))
            .catch(err => respond(null, err));
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

        case "page.hover": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.hover", async () => {
            // First locate coordinates, scroll into view and move visual cursor without dispatching duplicate DOM events
            const res = await this.sendTabMessageWithRetry(tabId, {
              action: "virtual_hover",
              selector: params.selector,
              dispatchSynthetic: false
            });
            if (res && res.coords) {
              try {
                if (!attachedTabs.has(tabId)) {
                  await attachDebugger(tabId, this.broadcastFn);
                }
                await dispatchCdpMouseMove(tabId, res.coords.x, res.coords.y);
                return res;
              } catch (cdpErr) {
                console.debug("[AgentPilot] CDP hover failed, falling back to synthetic events:", cdpErr);
                // Fallback to synthetic pointer/mouse events if CDP fails
                await this.sendTabMessageWithRetry(tabId, {
                  action: "virtual_hover",
                  selector: params.selector,
                  dispatchSynthetic: true
                });
                return res;
              }
            }
            return res || { success: true };
          })
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "page.drag": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.drag", () =>
            this.sendTabMessageWithRetry(tabId, {
              action: "virtual_drag",
              fromSelector: params.from || params.fromSelector,
              toSelector: params.to || params.toSelector,
              steps: params.steps || 8
            })
          )
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.pressKey":
        case "page.key": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.pressKey", async () => {
            try {
              if (!attachedTabs.has(tabId)) {
                await attachDebugger(tabId, this.broadcastFn);
              }
              return await dispatchCdpKeyEvent(tabId, params.key || "Enter", params.selector);
            } catch (cdpErr) {
              console.debug("[AgentPilot] CDP key event failed, falling back to synthetic event:", cdpErr);
              return await this.sendTabMessageWithRetry(tabId, {
                action: "press_key",
                key: params.key || "Enter",
                code: params.code,
                keyCode: params.keyCode,
                selector: params.selector
              });
            }
          })
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.waitFor":
        case "page.wait": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          let timeoutMs = 10000;
          let candidate = params.timeoutMs;
          if (candidate === undefined || candidate === null || candidate === "") {
            candidate = params.timeout;
          }
          if (candidate !== undefined && candidate !== null && candidate !== "") {
            const num = Number(candidate);
            if (!Number.isFinite(num) || num <= 0 || num > 2147483647) {
              return respond(null, new Error(`Invalid timeout '${candidate}': must be a positive finite number <= 2147483647ms`));
            }
            timeoutMs = num;
          }
          this.sendTabMessageWithRetry(tabId, {
            action: "wait_for",
            selector: params.selector,
            text: params.text,
            state: params.state || "visible",
            timeoutMs
          })
            .then(res => respond(res || { success: true }))
            .catch(err => respond(null, err));
          break;
        }

        case "page.uploadFile":
        case "page.upload": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, this.broadcastFn);
          }
          const files = Array.isArray(params.files) ? params.files : (params.filePath ? [params.filePath] : (params.file ? [params.file] : []));
          uploadFileInput(tabId, params.selector, files)
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "page.handleDialog":
        case "dialog.handle": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, this.broadcastFn);
          }
          handleJavaScriptDialog(tabId, params.accept !== false, params.promptText || "")
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "dialog.getActive": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          respond({ dialog: getActiveDialog(tabId) });
          break;
        }

        case "page.setBusy":
        case "agent.setBusy": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          if (params.session !== undefined) {
            const res = await this.setTabSession(tabId, params.session !== false, params.action || params.name || "");
            respond(res || { success: true, tabId, sessionActive: params.session !== false });
            break;
          }
          const res = await this.setTabLock(tabId, params.busy !== false, params.action || "");
          respond(res || { success: true });
          break;
        }

        case "session.start": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const sessionName = params.name || params.action || "Session đang hoạt động";
          const res = await this.setTabSession(tabId, true, sessionName);
          respond(res || { success: true, tabId, sessionActive: true, sessionName });
          break;
        }

        case "session.end":
        case "session.stop": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const res = await this.setTabSession(tabId, false);
          respond(res || { success: true, tabId, sessionActive: false });
          break;
        }

        case "session.status": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const pingRes = await this.sendTabMessageWithRetry(tabId, { action: "ping" }).catch((err) => {
            logDebug("session.status ping error", err);
            return null;
          });
          respond({
            success: true,
            tabId,
            sessionActive: Boolean(pingRes?.isSessionActive),
            isAgentBusy: Boolean(pingRes?.isAgentBusy),
            isAgentTab: Boolean(pingRes?.isAgentTab)
          });
          break;
        }

        case "page.getElement": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.getElement", () =>
            this.sendTabMessageWithRetry(tabId, {
              action: "get_element_info",
              selector: params.selector,
              x: params.x,
              y: params.y,
              includeStyles: Boolean(params.includeStyles)
            })
          )
            .then(res => respond(res || null))
            .catch(err => respond(null, err));
          break;
        }

        case "page.snapshot": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.snapshot", () =>
            this.sendTabMessageWithRetry(tabId, {
              action: "get_snapshot",
              maxElements: params.maxElements || 80,
              format: params.format || "text"
            })
          )
            .then(res => respond(res?.result !== undefined ? res.result : (res || null)))
            .catch(err => respond(null, err));
          break;
        }

        case "page.fillForm": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.fillForm", () =>
            this.sendTabMessageWithRetry(tabId, {
              action: "fill_form",
              fields: params.fields || [],
              submitSelector: params.submitSelector || null,
              pressEnter: Boolean(params.pressEnter)
            })
          )
            .then(res => respond(res || null))
            .catch(err => respond(null, err));
          break;
        }

        case "page.pickColor": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.pickColor", () =>
            this.sendTabMessageWithRetry(tabId, { action: "pick_color", x: params.x, y: params.y })
          )
            .then(res => respond(res || null))
            .catch(err => respond(null, err));
          break;
        }

        case "page.screenshot": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          this.runWithTabLock(tabId, "page.screenshot", () =>
            this.captureTabScreenshot(tabId, params)
          )
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "batch.run":
        case "batch.execute": {
          this.getTargetTabId(params.tabId).then(tabId => {
            if (tabId) {
              return this.runWithTabLock(tabId, "batch.run", () => this.executeBatchActions(params));
            }
            return this.executeBatchActions(params);
          })
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "devtools.getData": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) {
            respond(null, new Error("No target tab available for DevTools"));
            break;
          }

          // Auto attach debugger if not attached
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, this.broadcast).catch((err) => {
              console.warn("[AgentPilot] Auto attach debugger failed:", err);
            });
          }

          const buffer = getBuffer(tabId);
          const requestedType = params.type || "all";
          const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
          const filterOrigin = params.filterOrigin !== false;

          let consoleData = undefined;
          let networkData = undefined;
          let performanceData = undefined;

          if (requestedType === "all" || requestedType === "console") {
            let logs = buffer.console;
            if (filterOrigin) {
              logs = logs.filter(item => {
                if (item.text && item.text.includes("[Agent Pilot]")) return false;
                if (item.stackTrace && Array.isArray(item.stackTrace.callFrames) && item.stackTrace.callFrames.length > 0) {
                  const hasWebFrame = item.stackTrace.callFrames.some(f => f.url && (f.url.startsWith("http://") || f.url.startsWith("https://")));
                  const isAllExt = item.stackTrace.callFrames.every(f => !f.url || f.url.startsWith("chrome-extension://") || f.url === "");
                  if (!hasWebFrame && isAllExt) return false;
                } else if (item.url && item.url.includes("chrome-extension://")) {
                  return false;
                }
                return true;
              });
            }
            consoleData = logs.slice(-limit);
            if (params.clear) {
              buffer.console = [];
            }
          }

          if (requestedType === "all" || requestedType === "network") {
            let reqs = Array.from(buffer.network.values());
            if (filterOrigin) {
              reqs = reqs.filter(item => {
                const url = item.url || "";
                return !url.startsWith("chrome-extension://");
              });
            }
            networkData = reqs.slice(-limit);
            if (params.clear) {
              buffer.network.clear();
            }
          }

          if (requestedType === "all" || requestedType === "performance") {
            if (attachedTabs.has(tabId)) {
              try {
                const perfRes = await sendCdpCommand(tabId, "Performance.getMetrics");
                const metricsMap = {};
                (perfRes.metrics || []).forEach((m) => {
                  metricsMap[m.name] = m.value;
                });
                performanceData = {
                  metrics: metricsMap,
                  jsHeapUsedMB: metricsMap.JSHeapUsedSize ? +(metricsMap.JSHeapUsedSize / (1024 * 1024)).toFixed(2) : undefined,
                  jsHeapTotalMB: metricsMap.JSHeapTotalSize ? +(metricsMap.JSHeapTotalSize / (1024 * 1024)).toFixed(2) : undefined,
                  domNodes: metricsMap.Nodes,
                  documents: metricsMap.Documents,
                  frames: metricsMap.Frames,
                  layoutCount: metricsMap.LayoutCount,
                  recalcStyleCount: metricsMap.RecalcStyleCount,
                  timestamp: Date.now()
                };
              } catch (perfErr) {
                performanceData = { error: perfErr.message };
              }
            } else {
              performanceData = { error: "Debugger not attached to tab" };
            }
          }

          const responsePayload = {
            tabId,
            attached: attachedTabs.has(tabId),
            timestamp: Date.now(),
            summary: {
              consoleEntries: consoleData ? consoleData.length : 0,
              networkRequests: networkData ? networkData.length : 0,
              jsHeapUsedMB: performanceData?.jsHeapUsedMB,
              domNodes: performanceData?.domNodes
            }
          };

          if (consoleData !== undefined) responsePayload.console = consoleData;
          if (networkData !== undefined) responsePayload.network = networkData;
          if (performanceData !== undefined) responsePayload.performance = performanceData;

          respond(responsePayload);
          break;
        }

        case "emulation.set": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, this.broadcastFn);
          }
          setEmulation(tabId, params)
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "emulation.resize": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const width = Number(params.width);
          const height = Number(params.height);
          if (isNaN(width) || width <= 0 || isNaN(height) || height <= 0) {
            return respond(null, new Error(`Invalid dimensions: width and height must be positive numbers (got width=${params.width}, height=${params.height})`));
          }
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, this.broadcastFn);
          }
          const scale = Number(params.deviceScaleFactor);
          setEmulation(tabId, {
            viewport: {
              width: Math.floor(width),
              height: Math.floor(height),
              deviceScaleFactor: !isNaN(scale) && scale > 0 ? scale : 1,
              mobile: !!params.mobile
            }
          })
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "network.listRequests": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          const buffer = getBuffer(tabId);
          let requests = Array.from(buffer.network.values());
          if (params.filterUrl) {
            requests = requests.filter(r => r.url && r.url.includes(params.filterUrl));
          }
          if (params.method) {
            requests = requests.filter(r => r.method && r.method.toUpperCase() === params.method.toUpperCase());
          }
          if (params.resourceType) {
            requests = requests.filter(r => r.type && r.type.toLowerCase() === params.resourceType.toLowerCase());
          }
          const rawLimit = Number(params.limit);
          const limit = (!isNaN(rawLimit) && rawLimit > 0) ? Math.max(1, Math.min(Math.floor(rawLimit), 1000)) : 100;
          respond({
            tabId,
            totalCaptured: buffer.network.size,
            matchingCount: requests.length,
            requests: requests.slice(-limit)
          });
          break;
        }

        case "network.getResponseBody": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, this.broadcastFn);
          }
          getNetworkResponseBody(tabId, params.requestId)
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "performance.trace": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, this.broadcastFn);
          }
          const action = (params.action || "start").toLowerCase();
          if (action === "stop" || action === "end") {
            stopPerformanceTrace(tabId).then(res => respond(res)).catch(err => respond(null, err));
          } else {
            startPerformanceTrace(tabId, params.categories).then(res => respond(res)).catch(err => respond(null, err));
          }
          break;
        }

        case "performance.metrics": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, this.broadcastFn);
          }
          getPerformanceMetrics(tabId)
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "memory.heapSnapshot": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, this.broadcastFn);
          }
          takeHeapSnapshot(tabId)
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "memory.collectGarbage": {
          const tabId = await this.getTargetTabId(params.tabId);
          if (!tabId) return respond(null, new Error("No target tab found"));
          if (!attachedTabs.has(tabId)) {
            await attachDebugger(tabId, this.broadcastFn);
          }
          collectGarbage(tabId)
            .then(res => respond(res))
            .catch(err => respond(null, err));
          break;
        }

        case "extensions.manage": {
          if (!chrome.management) {
            return respond(null, new Error("chrome.management API is not available"));
          }
          const rawAction = (params.action || "list").toLowerCase();
          let action = rawAction;
          if (rawAction === "enable") {
            action = "setEnabled";
            params.enabled = true;
          } else if (rawAction === "disable") {
            action = "setEnabled";
            params.enabled = false;
          } else if (rawAction === "setenabled") {
            action = "setEnabled";
          }

          if (action === "list") {
            chrome.management.getAll((extList) => {
              if (chrome.runtime.lastError) return respond(null, chrome.runtime.lastError);
              const list = (extList || []).map(e => ({
                id: e.id,
                name: e.name,
                version: e.version,
                enabled: e.enabled,
                type: e.type,
                installType: e.installType
              }));
              respond({ total: list.length, extensions: list });
            });
          } else if (action === "setEnabled") {
            if (!params.extensionId) return respond(null, new Error("extensionId is required"));
            const enabled = params.enabled !== false;
            chrome.management.setEnabled(params.extensionId, enabled, () => {
              if (chrome.runtime.lastError) return respond(null, chrome.runtime.lastError);
              respond({ success: true, extensionId: params.extensionId, enabled });
            });
          } else if (action === "toggle") {
            if (!params.extensionId) return respond(null, new Error("extensionId is required"));
            chrome.management.get(params.extensionId, (info) => {
              if (chrome.runtime.lastError) return respond(null, chrome.runtime.lastError);
              const targetEnabled = !info.enabled;
              chrome.management.setEnabled(params.extensionId, targetEnabled, () => {
                if (chrome.runtime.lastError) return respond(null, chrome.runtime.lastError);
                respond({ success: true, extensionId: params.extensionId, enabled: targetEnabled });
              });
            });
          } else if (action === "uninstall") {
            if (!params.extensionId) return respond(null, new Error("extensionId is required"));
            chrome.management.uninstall(params.extensionId, { showConfirmDialog: false }, () => {
              if (chrome.runtime.lastError) return respond(null, chrome.runtime.lastError);
              respond({ success: true, extensionId: params.extensionId, uninstalled: true });
            });
          } else {
            respond(null, new Error(`Unsupported extension action: ${action}`));
          }
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

  /**
   * Save feedback session to shared filesystem inbox ~/.agent-pilot/inbox/feedback/<timestamp>/* (Channel B)
   * Falls back to chrome.storage.local if bridge server is not reachable.
   */
  async saveFeedbackInbox(payload) {
    try {
      const resp = await fetch(`http://127.0.0.1:${this.port}/api/feedback/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (data && data.success) {
        return { success: true, ...data, storage: "filesystem" };
      }
      throw new Error(data?.error || "Bridge server returned failure");
    } catch (err) {
      // Fallback to chrome.storage.local
      const timestamp = String(payload?.timestamp || Date.now());
      const key = `ap_feedback_${timestamp}`;
      await new Promise((resolve) => {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [key]: payload }, resolve);
        } else {
          resolve();
        }
      });
      return {
        success: true,
        storage: "extension_storage",
        sessionId: timestamp,
        warning: `Saved to browser extension storage (bridge server unreachable: ${err.message})`
      };
    }
  }

  /**
   * Push feedback session live to waiting agent via HTTP or WebSocket fallback (Channel A)
   */
  async pushFeedbackLive(payload) {
    try {
      const resp = await fetch(`http://127.0.0.1:${this.port}/api/feedback/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (data && data.success) {
        return { success: true, ...data, channel: "http_push" };
      }
      throw new Error(data?.error || "Push failed");
    } catch (httpErr) {
      // Fallback: If HTTP endpoint is unavailable, try WebSocket transmission
      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({
          type: "FEEDBACK_SUBMISSION",
          payload
        });
        return { success: true, channel: "ws_push", sessionId: String(payload?.timestamp || Date.now()) };
      }
      // If server is completely offline, fall back to persistent extension storage
      return await this.saveFeedbackInbox(payload);
    }
  }
}

