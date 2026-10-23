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
  beforeUnloadPolicies,
  LIMITS,
  getBuffer,
  cleanupDebuggerState,
  logDebug
} from "./constants.js";
import { sendCdpCommand } from "./cdp-connection.js";
import { clearEmulationState } from "./cdp-emulation.js";

function serializeConsoleArgs(rawArgs) {
  if (!Array.isArray(rawArgs) || rawArgs.length === 0) return undefined;
  return rawArgs.slice(0, 10).map((arg) => {
    if (!arg || typeof arg !== "object") return { value: arg };
    const item = { type: arg.type };
    if (arg.subtype) item.subtype = arg.subtype;
    if (arg.value !== undefined) item.value = arg.value;
    if (arg.description) item.description = String(arg.description).slice(0, 500);
    return item;
  });
}

function getHeaderCaseInsensitive(headers, name) {
  if (!headers || typeof headers !== "object") return undefined;
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target && v !== undefined && v !== "") {
      return String(v);
    }
  }
  return undefined;
}

export function extractPerformanceHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const cacheStatus =
    getHeaderCaseInsensitive(headers, "cf-cache-status") ||
    getHeaderCaseInsensitive(headers, "x-nextjs-cache") ||
    getHeaderCaseInsensitive(headers, "x-vercel-cache") ||
    getHeaderCaseInsensitive(headers, "x-cache");
  const contentEncoding = getHeaderCaseInsensitive(headers, "content-encoding");
  const cacheControl = getHeaderCaseInsensitive(headers, "cache-control");
  const serverTiming = getHeaderCaseInsensitive(headers, "server-timing");
  const out = {};
  if (cacheStatus) out.cacheStatus = cacheStatus;
  if (contentEncoding) out.contentEncoding = contentEncoding;
  if (cacheControl) out.cacheControl = cacheControl;
  if (serverTiming) out.serverTiming = serverTiming;
  return out;
}

/**
 * Initialize CDP event listeners for DevTools Console, Network, and Runtime events
 */
export function initCdpEventListeners(broadcastFn) {
  // Clean up when debugger detached by user or system
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source && source.tabId) {
      cleanupDebuggerState(source.tabId);
      clearEmulationState(source.tabId);
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

    // 0. Top-level frame navigation tracking (preserve logs across navigations with navigationId)
    if (method === "Page.frameNavigated") {
      if (!params?.frame?.parentId) {
        buffer.navigationId = (buffer.navigationId || 1) + 1;
      }
      return;
    }

    // 1. Console Events
    if (method === "Runtime.consoleAPICalled") {
      const textArgs = (params.args || []).map((arg) => {
        if (arg.value !== undefined) return String(arg.value);
        if (arg.description) return arg.description;
        return JSON.stringify(arg);
      }).join(" ");

      const msgid = buffer.nextConsoleMsgId++;
      const entry = {
        id: "console_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        msgid,
        navigationId: buffer.navigationId || 1,
        type: params.type || "log",
        text: textArgs || "(empty)",
        args: serializeConsoleArgs(params.args),
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
      const msgid = buffer.nextConsoleMsgId++;
      const entry = {
        id: "console_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        msgid,
        navigationId: buffer.navigationId || 1,
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
      const msgid = buffer.nextConsoleMsgId++;
      const entry = {
        id: "console_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        msgid,
        navigationId: buffer.navigationId || 1,
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

      const startTimeMs = typeof params.timestamp === "number" ? params.timestamp * 1000 : Date.now();
      const req = {
        id: params.requestId,
        navigationId: buffer.navigationId || 1,
        url: params.request.url,
        method: params.request.method,
        requestHeaders: params.request.headers,
        // Request bodies are fetched on demand by network.getRequestDetail.
        // Retaining/broadcasting them here duplicates potentially large uploads
        // in the MV3 buffer and every DevTools event payload.
        hasUserGesture: params.request.hasUserGesture,
        initiator: params.initiator,
        type: params.type || "Other",
        wallTime: params.wallTime ? params.wallTime * 1000 : Date.now(),
        startTimeMs,
        status: "pending",
        responseSize: 0,
        transferKB: 0
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
        const resp = params.response || {};
        existing.status = resp.status;
        existing.statusText = resp.statusText;
        existing.mimeType = resp.mimeType;
        if (resp.protocol) existing.protocol = resp.protocol;
        if (resp.fromDiskCache) existing.fromDiskCache = true;
        if (resp.fromServiceWorker) existing.fromServiceWorker = true;
        existing.headers = resp.headers;
        const encodedLen =
          typeof resp.encodedDataLength === "number" && resp.encodedDataLength > 0
            ? resp.encodedDataLength
            : existing.encodedDataLength || 0;
        existing.encodedDataLength = encodedLen;
        existing.responseSize = encodedLen;
        existing.transferKB = Math.round((encodedLen / 1024) * 10) / 10;
        if (typeof params.timestamp === "number" && typeof existing.startTimeMs === "number") {
          existing.durationMs = Math.max(0, Math.round(params.timestamp * 1000 - existing.startTimeMs));
        } else if (resp.timing && typeof resp.timing.receiveHeadersEnd === "number") {
          existing.durationMs = Math.max(0, Math.round(resp.timing.receiveHeadersEnd));
        }
        Object.assign(existing, extractPerformanceHeaders(resp.headers));
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
        if (typeof params.encodedDataLength === "number") {
          existing.encodedDataLength = params.encodedDataLength;
          existing.responseSize = params.encodedDataLength;
          existing.transferKB = Math.round((params.encodedDataLength / 1024) * 10) / 10;
        }
        if (typeof params.timestamp === "number" && typeof existing.startTimeMs === "number") {
          existing.durationMs = Math.max(0, Math.round(params.timestamp * 1000 - existing.startTimeMs));
        }
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
        if (typeof params.timestamp === "number" && typeof existing.startTimeMs === "number") {
          existing.durationMs = Math.max(0, Math.round(params.timestamp * 1000 - existing.startTimeMs));
        }
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
      const dialogType = params.type || "alert";
      if (dialogType === "beforeunload" && beforeUnloadPolicies.has(tabId)) {
        const policy = beforeUnloadPolicies.get(tabId);
        const accept = policy !== "decline" && policy !== false;
        sendCdpCommand(tabId, "Page.handleJavaScriptDialog", { accept }).catch((err) =>
          logDebug("auto handleBeforeUnload dialog", err)
        );
        return;
      }
      activeDialogs.set(tabId, {
        message: params.message || "",
        type: dialogType,
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
