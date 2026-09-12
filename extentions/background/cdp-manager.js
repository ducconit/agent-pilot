/**
 * Agent Pilot - CDP (Chrome DevTools Protocol) Manager
 * Controls debugger attachment, command sending, and DevTools event listeners
 */

import {
  attachedTabs,
  devtoolsBuffers,
  getBuffer,
  CDP_PROTOCOL_VERSION,
  MAX_DEVTOOLS_CONSOLE_ENTRIES,
  MAX_DEVTOOLS_NETWORK_ENTRIES
} from "./constants.js";

/**
 * Attach Chrome DevTools Protocol (CDP) to a tab
 */
export async function attachDebugger(tabId, broadcastFn = null) {
  if (attachedTabs.has(tabId)) return { success: true, message: "Already attached" };

  return new Promise((resolve) => {
    chrome.debugger.attach({ tabId }, CDP_PROTOCOL_VERSION, async () => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      attachedTabs.add(tabId);
      getBuffer(tabId);

      // Enable CDP domains
      try {
        await sendCdpCommand(tabId, "Console.enable");
        await sendCdpCommand(tabId, "Runtime.enable");
        await sendCdpCommand(tabId, "Network.enable");
        await sendCdpCommand(tabId, "Performance.enable");
        await sendCdpCommand(tabId, "Page.enable");
      } catch (err) {
        console.warn("[AgentPilot] Error enabling CDP domains:", err);
      }

      if (typeof broadcastFn === "function") {
        broadcastFn({
          type: "DEBUGGER_STATUS_CHANGED",
          tabId,
          attached: true
        });
      }

      resolve({ success: true, tabId });
    });
  });
}

/**
 * Detach CDP from tab
 */
export async function detachDebugger(tabId, broadcastFn = null) {
  if (!attachedTabs.has(tabId)) return { success: true };
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      attachedTabs.delete(tabId);
      devtoolsBuffers.delete(tabId);
      if (typeof broadcastFn === "function") {
        broadcastFn({
          type: "DEBUGGER_STATUS_CHANGED",
          tabId,
          attached: false
        });
      }
      resolve({ success: true });
    });
  });
}

/**
 * Send arbitrary command to CDP
 */
export function sendCdpCommand(tabId, method, params = {}, timeoutMs = 15000) {
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

/**
 * Initialize CDP event listeners for DevTools Console, Network, and Runtime events
 */
export function initCdpEventListeners(broadcastFn) {
  // Clean up when debugger detached by user or system
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source && source.tabId) {
      attachedTabs.delete(source.tabId);
      devtoolsBuffers.delete(source.tabId);
      if (typeof broadcastFn === "function") {
        broadcastFn({
          type: "DEBUGGER_STATUS_CHANGED",
          tabId: source.tabId,
          attached: false,
          reason
        });
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
      if (buffer.console.length > MAX_DEVTOOLS_CONSOLE_ENTRIES) buffer.console.shift();

      if (typeof broadcastFn === "function") {
        broadcastFn({
          type: "DEVTOOLS_CONSOLE_EVENT",
          tabId,
          entry
        });
      }
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
      if (buffer.console.length > MAX_DEVTOOLS_CONSOLE_ENTRIES) buffer.console.shift();

      if (typeof broadcastFn === "function") {
        broadcastFn({
          type: "DEVTOOLS_CONSOLE_EVENT",
          tabId,
          entry
        });
      }
    }

    // 2. Network Events
    else if (method === "Network.requestWillBeSent") {
      // Truncate network buffer to prevent memory leaks
      if (buffer.network.size >= MAX_DEVTOOLS_NETWORK_ENTRIES) {
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
      if (typeof broadcastFn === "function") {
        broadcastFn({
          type: "DEVTOOLS_NETWORK_EVENT",
          tabId,
          request: req
        });
      }
    } else if (method === "Network.responseReceived") {
      const existing = buffer.network.get(params.requestId);
      if (existing) {
        existing.status = params.response.status;
        existing.statusText = params.response.statusText;
        existing.mimeType = params.response.mimeType;
        existing.headers = params.response.headers;
        existing.encodedDataLength = params.response.encodedDataLength;
        if (typeof broadcastFn === "function") {
          broadcastFn({
            type: "DEVTOOLS_NETWORK_EVENT",
            tabId,
            request: existing
          });
        }
      }
    } else if (method === "Network.loadingFinished") {
      const existing = buffer.network.get(params.requestId);
      if (existing) {
        existing.encodedDataLength = params.encodedDataLength;
        existing.finished = true;
        if (typeof broadcastFn === "function") {
          broadcastFn({
            type: "DEVTOOLS_NETWORK_EVENT",
            tabId,
            request: existing
          });
        }
      }
    } else if (method === "Network.loadingFailed") {
      const existing = buffer.network.get(params.requestId);
      if (existing) {
        existing.status = "failed";
        existing.errorText = params.errorText;
        if (typeof broadcastFn === "function") {
          broadcastFn({
            type: "DEVTOOLS_NETWORK_EVENT",
            tabId,
            request: existing
          });
        }
      }
    }
  });
}
