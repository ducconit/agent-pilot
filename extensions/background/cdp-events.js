/**
 * Agent Pilot - CDP Event Listeners (DevTools telemetry)
 *
 * Translates chrome.debugger.onEvent notifications into the in-memory devtools
 * buffers and broadcast messages the extension exposes to the UI/agent.
 * Session lifecycle (attach/detach/command) lives in cdp-connection.js.
 *
 * KNOWN LIMITATION: the console/network buffers are in-memory only. They live in
 * the MV3 service-worker memory and are therefore reset whenever the SW restarts
 * (idle eviction, update, browser restart). Callers must not assume history
 * survives across SW lifetimes.
 */

import {
  activeTracingSessions,
  activeDialogs,
  LIMITS,
  getBuffer,
  cleanupDebuggerState
} from "./constants.js";

/**
 * Initialize CDP event listeners for DevTools Console, Network, and Runtime events
 */
export function initCdpEventListeners(broadcastFn) {
  // Clean up when debugger detached by user or system
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source && source.tabId) {
      cleanupDebuggerState(source.tabId);
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
      if (buffer.console.length > LIMITS.DEVTOOLS_CONSOLE_MAX) buffer.console.shift();

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
      if (buffer.console.length > LIMITS.DEVTOOLS_CONSOLE_MAX) buffer.console.shift();

      if (typeof broadcastFn === "function") {
        broadcastFn({
          type: "DEVTOOLS_CONSOLE_EVENT",
          tabId,
          entry
        });
      }
    } else if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails || {};
      const excDesc = details.exception?.description || details.exception?.value || "";
      const baseText = details.text || "Uncaught exception";
      const text = excDesc && ! String(excDesc).startsWith(baseText)
        ? `${baseText}: ${excDesc}`
        : (excDesc || baseText);
      const entry = {
        id: "console_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        type: "error",
        text,
        url: details.url,
        line: details.lineNumber,
        stackTrace: details.stackTrace,
        timestamp: details.timestamp || Date.now()
      };
      buffer.console.push(entry);
      if (buffer.console.length > LIMITS.DEVTOOLS_CONSOLE_MAX) buffer.console.shift();

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
      if (buffer.network.size >= LIMITS.DEVTOOLS_NETWORK_MAX) {
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

    // 3. JavaScript Dialog Events
    else if (method === "Page.javascriptDialogOpening") {
      activeDialogs.set(tabId, {
        message: params.message || "",
        type: params.type || "alert",
        defaultPrompt: params.defaultPrompt || "",
        url: params.url || "",
        timestamp: Date.now()
      });
      if (typeof broadcastFn === "function") {
        broadcastFn({
          type: "DIALOG_OPENED",
          tabId,
          dialog: activeDialogs.get(tabId)
        });
      }
    } else if (method === "Page.javascriptDialogClosed") {
      activeDialogs.delete(tabId);
      if (typeof broadcastFn === "function") {
        broadcastFn({
          type: "DIALOG_CLOSED",
          tabId
        });
      }
    }

    // 4. Performance Tracing Events
    else if (method === "Tracing.dataCollected") {
      const trace = activeTracingSessions.get(tabId);
      if (trace && Array.isArray(params.value)) {
        if (trace.buffer.length < LIMITS.CDP_TRACE_BUFFER_MAX) {
          trace.buffer.push(...params.value.slice(0, LIMITS.CDP_TRACE_BUFFER_MAX - trace.buffer.length));
        }
      }
    } else if (method === "Tracing.tracingComplete") {
      const trace = activeTracingSessions.get(tabId);
      if (trace) {
        trace.completed = true;
        if (typeof trace.onComplete === "function") {
          trace.onComplete();
          trace.onComplete = null;
        }
      }
    }
  });
}
