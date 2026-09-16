/**
 * Agent Pilot - CDP (Chrome DevTools Protocol) Manager
 * Controls debugger attachment, command sending, and DevTools event listeners
 */

import {
  attachedTabs,
  devtoolsBuffers,
  getBuffer,
  activeDialogs,
  activeTracingSessions,
  CDP_PROTOCOL_VERSION,
  MAX_DEVTOOLS_CONSOLE_ENTRIES,
  MAX_DEVTOOLS_NETWORK_ENTRIES,
  logDebug
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

      // Enable CDP domains concurrently
      try {
        await Promise.all([
          sendCdpCommand(tabId, "Console.enable", {}, 2500).catch((e) => logDebug("Console.enable", e)),
          sendCdpCommand(tabId, "Runtime.enable", {}, 2500).catch((e) => logDebug("Runtime.enable", e)),
          sendCdpCommand(tabId, "Network.enable", {}, 2500).catch((e) => logDebug("Network.enable", e)),
          sendCdpCommand(tabId, "Performance.enable", {}, 2500).catch((e) => logDebug("Performance.enable", e)),
          sendCdpCommand(tabId, "Page.enable", {}, 2500).catch((e) => logDebug("Page.enable", e)),
          sendCdpCommand(tabId, "DOM.enable", {}, 2500).catch((e) => logDebug("DOM.enable", e))
        ]);
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
      activeTracingSessions.delete(tabId);
      activeDialogs.delete(tabId);
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
      activeTracingSessions.delete(source.tabId);
      activeDialogs.delete(source.tabId);
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

  if (chrome.tabs && chrome.tabs.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      attachedTabs.delete(tabId);
      devtoolsBuffers.delete(tabId);
      activeTracingSessions.delete(tabId);
      activeDialogs.delete(tabId);
    });
  }

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
        if (trace.buffer.length < 2000) {
          trace.buffer.push(...params.value.slice(0, 2000 - trace.buffer.length));
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

/**
 * Handle JavaScript dialog (alert, confirm, prompt)
 */
export async function handleJavaScriptDialog(tabId, accept = true, promptText = "") {
  const params = { accept: !!accept };
  if (typeof promptText === "string" && promptText.length > 0) {
    params.promptText = promptText;
  }
  await sendCdpCommand(tabId, "Page.handleJavaScriptDialog", params);
  activeDialogs.delete(tabId);
  return { success: true, accept: !!accept, promptText };
}

/**
 * Get active dialog on a tab
 */
export function getActiveDialog(tabId) {
  return activeDialogs.get(tabId) || null;
}

/**
 * Upload files to an <input type="file"> element via CDP DOM.setFileInputFiles
 */
export async function uploadFileInput(tabId, selector, filePaths) {
  if (!selector) {
    throw new Error("selector is required for uploadFileInput");
  }
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error("filePaths must be a non-empty array of file paths");
  }

  // 1. Ask isolated content script to resolve selector/@ref and tag the element with a temporary data marker
  let resolvedSelector = selector;
  let marker = null;
  try {
    const markRes = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: "mark_upload_target", selector }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });
    if (markRes && markRes.success && markRes.marker) {
      marker = markRes.marker;
      resolvedSelector = `[data-agent-pilot-upload="${marker}"]`;
    }
  } catch (err) {
    console.debug("[AgentPilot] Could not mark upload target via content script:", err);
  }

  // 2. Locate element via CDP Runtime.evaluate
  const evalScript = `(() => {
    const el = document.querySelector(${JSON.stringify(resolvedSelector)});
    if (!el) throw new Error("Element not found for selector: " + ${JSON.stringify(selector)});
    if (el.tagName !== 'INPUT' || (el.type && el.type.toLowerCase() !== 'file')) {
      const fileInput = el.querySelector ? el.querySelector('input[type=file]') : null;
      if (fileInput) return fileInput;
    }
    return el;
  })()`;

  const evalResult = await sendCdpCommand(tabId, "Runtime.evaluate", {
    expression: evalScript,
    returnByValue: false
  });

  if (evalResult && evalResult.exceptionDetails) {
    const desc = evalResult.exceptionDetails.exception?.description || evalResult.exceptionDetails.text || "Failed to find element";
    throw new Error(desc);
  }

  const objectId = evalResult.result?.objectId;
  if (!objectId) {
    throw new Error("Failed to obtain remote object ID for selector: " + selector);
  }

  try {
    const nodeResult = await sendCdpCommand(tabId, "DOM.requestNode", { objectId });
    if (!nodeResult || !nodeResult.nodeId) {
      throw new Error("Failed to resolve DOM nodeId for file input element");
    }

    await sendCdpCommand(tabId, "DOM.setFileInputFiles", {
      files: filePaths,
      nodeId: nodeResult.nodeId
    });

    return {
      success: true,
      selector,
      files: filePaths,
      message: `Successfully set ${filePaths.length} file(s) on ${selector}`
    };
  } finally {
    if (objectId) {
      sendCdpCommand(tabId, "Runtime.releaseObject", { objectId }).catch((err) => {
        console.debug("[AgentPilot] Runtime.releaseObject cleanup error ignored:", err);
      });
    }
    if (marker) {
      chrome.tabs.sendMessage(tabId, { action: "unmark_upload_target", marker }, () => {
        if (chrome.runtime.lastError) {
          console.debug("[AgentPilot] unmark_upload_target cleanup error ignored:", chrome.runtime.lastError);
        }
      });
    }
  }
}

/**
 * Configure environment emulation: CPU, network throttling, color scheme, viewport
 */
export async function setEmulation(tabId, options = {}) {
  const applied = {};

  // 1. CPU Throttling
  if (options.cpuThrottlingRate !== undefined) {
    const rate = Number(options.cpuThrottlingRate) || 1;
    await sendCdpCommand(tabId, "Emulation.setCPUThrottlingRate", { rate });
    applied.cpuThrottlingRate = rate;
  }

  // 2. Network Conditions
  if (options.networkConditions !== undefined) {
    let netParams;
    const cond = options.networkConditions;
    if (typeof cond === "string") {
      const lower = cond.toLowerCase();
      if (lower === "offline") {
        netParams = { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 };
      } else if (lower === "slow-3g" || lower === "slow3g") {
        netParams = { offline: false, latency: 400, downloadThroughput: Math.round((500 * 1024) / 8), uploadThroughput: Math.round((500 * 1024) / 8) };
      } else if (lower === "fast-3g" || lower === "fast3g") {
        netParams = { offline: false, latency: 100, downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8), uploadThroughput: Math.round((750 * 1024) / 8) };
      } else {
        netParams = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
      }
    } else if (typeof cond === "object" && cond !== null) {
      netParams = {
        offline: !!cond.offline,
        latency: cond.latency || 0,
        downloadThroughput: cond.downloadThroughput !== undefined ? cond.downloadThroughput : -1,
        uploadThroughput: cond.uploadThroughput !== undefined ? cond.uploadThroughput : -1
      };
    }
    if (netParams) {
      await sendCdpCommand(tabId, "Network.emulateNetworkConditions", netParams);
      applied.networkConditions = netParams;
    }
  }

  // 3. Color Scheme
  if (options.colorScheme !== undefined) {
    const scheme = String(options.colorScheme).toLowerCase();
    const validScheme = scheme === "dark" || scheme === "light" ? scheme : "";
    await sendCdpCommand(tabId, "Emulation.setEmulatedMedia", {
      media: "",
      features: validScheme ? [{ name: "prefers-color-scheme", value: validScheme }] : []
    });
    applied.colorScheme = validScheme || "default";
  }

  // 4. Viewport / Device Metrics
  if (options.viewport) {
    const vp = options.viewport;
    await sendCdpCommand(tabId, "Emulation.setDeviceMetricsOverride", {
      width: Number(vp.width) || 1280,
      height: Number(vp.height) || 800,
      deviceScaleFactor: Number(vp.deviceScaleFactor) || 1,
      mobile: !!vp.mobile
    });
    applied.viewport = vp;
  }

  return { success: true, applied };
}

/**
 * Get response body for a specific network request
 */
export async function getNetworkResponseBody(tabId, requestId) {
  if (!requestId) {
    throw new Error("requestId is required to get network response body");
  }
  const result = await sendCdpCommand(tabId, "Network.getResponseBody", { requestId });
  let body = result.body;
  if (!result.base64Encoded && typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (parseErr) {
      console.debug("[AgentPilot] Response body is plain text, not JSON:", parseErr);
    }
  }
  return {
    requestId,
    body,
    base64Encoded: !!result.base64Encoded
  };
}

/**
 * Start performance trace recording
 */
export async function startPerformanceTrace(tabId, categories = null) {
  const cats = categories || "devtools.timeline,blink.user_timing,v8.execute";
  activeTracingSessions.set(tabId, {
    buffer: [],
    startTime: Date.now(),
    categories: cats,
    completed: false
  });

  await sendCdpCommand(tabId, "Tracing.start", {
    categories: cats,
    transferMode: "ReportEvents"
  });

  return {
    success: true,
    tabId,
    message: "Performance tracing started",
    categories: cats
  };
}

/**
 * Stop performance trace recording and return summary
 */
export async function stopPerformanceTrace(tabId) {
  const trace = activeTracingSessions.get(tabId);
  try {
    const completePromise = new Promise((resolve) => {
      if (!trace || trace.completed) {
        resolve();
        return;
      }
      trace.onComplete = resolve;
      setTimeout(resolve, 2000);
    });

    await sendCdpCommand(tabId, "Tracing.end", {}, 5000);
    await completePromise;
  } catch (err) {
    logDebug("Tracing.end error", err);
  }

  const events = trace?.buffer || [];
  activeTracingSessions.delete(tabId);

  const durationMs = trace ? Date.now() - trace.startTime : 0;
  return {
    success: true,
    tabId,
    durationMs,
    totalEvents: events.length,
    eventsSummary: events.slice(0, 50)
  };
}

/**
 * Get runtime performance metrics (JSHeap, DOM Nodes, Layouts...)
 */
export async function getPerformanceMetrics(tabId) {
  const result = await sendCdpCommand(tabId, "Performance.getMetrics");
  const metricsMap = {};
  if (result && Array.isArray(result.metrics)) {
    for (const m of result.metrics) {
      metricsMap[m.name] = m.value;
    }
  }
  return {
    success: true,
    tabId,
    metrics: metricsMap,
    timestamp: Date.now()
  };
}

/**
 * Collect garbage via CDP HeapProfiler
 */
export async function collectGarbage(tabId) {
  await sendCdpCommand(tabId, "HeapProfiler.collectGarbage");
  return { success: true, message: "Garbage collection completed" };
}

/**
 * Take heap snapshot via CDP HeapProfiler
 */
export async function takeHeapSnapshot(tabId) {
  const chunks = [];
  const chunkListener = (source, method, params) => {
    if (source.tabId === tabId && method === "HeapProfiler.addHeapSnapshotChunk") {
      chunks.push(params.chunk);
    }
  };
  chrome.debugger.onEvent.addListener(chunkListener);

  try {
    await sendCdpCommand(tabId, "HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  } finally {
    chrome.debugger.onEvent.removeListener(chunkListener);
  }

  const totalLength = chunks.reduce((acc, c) => acc + (c ? c.length : 0), 0);
  return {
    success: true,
    tabId,
    totalChunks: chunks.length,
    totalBytes: totalLength,
    message: `Heap snapshot captured (${totalLength} bytes across ${chunks.length} chunks)`
  };
}

const CDP_KEY_MAP = {
  "enter": { code: "Enter", keyCode: 13, key: "Enter", text: "\r" },
  "tab": { code: "Tab", keyCode: 9, key: "Tab" },
  "backspace": { code: "Backspace", keyCode: 8, key: "Backspace" },
  "escape": { code: "Escape", keyCode: 27, key: "Escape" },
  "esc": { code: "Escape", keyCode: 27, key: "Escape" },
  "space": { code: "Space", keyCode: 32, key: " ", text: " " },
  "arrowup": { code: "ArrowUp", keyCode: 38, key: "ArrowUp" },
  "up": { code: "ArrowUp", keyCode: 38, key: "ArrowUp" },
  "arrowdown": { code: "ArrowDown", keyCode: 40, key: "ArrowDown" },
  "down": { code: "ArrowDown", keyCode: 40, key: "ArrowDown" },
  "arrowleft": { code: "ArrowLeft", keyCode: 37, key: "ArrowLeft" },
  "left": { code: "ArrowLeft", keyCode: 37, key: "ArrowLeft" },
  "arrowright": { code: "ArrowRight", keyCode: 39, key: "ArrowRight" },
  "right": { code: "ArrowRight", keyCode: 39, key: "ArrowRight" },
  "delete": { code: "Delete", keyCode: 46, key: "Delete" },
  "home": { code: "Home", keyCode: 36, key: "Home" },
  "end": { code: "End", keyCode: 35, key: "End" },
  "pageup": { code: "PageUp", keyCode: 33, key: "PageUp" },
  "pagedown": { code: "PageDown", keyCode: 34, key: "PageDown" }
};

/**
 * Dispatch real, trusted keyboard events via CDP Input.dispatchKeyEvent
 */
export async function dispatchCdpKeyEvent(tabId, keyCombo, selector = null) {
  if (!keyCombo) throw new Error("key is required");

  // Focus element first if selector provided
  if (selector) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "focus_element", selector });
    } catch (err) {
      console.debug("[AgentPilot] focus_element message failed:", err);
    }
  }

  const parts = keyCombo.split("+").map(s => s.trim()).filter(Boolean);
  let modifiers = 0;
  let mainKey = "";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const lower = p.toLowerCase();
    if (lower === "ctrl" || lower === "control") {
      modifiers |= 2;
    } else if (lower === "alt" || lower === "option") {
      modifiers |= 1;
    } else if (lower === "shift") {
      modifiers |= 8;
    } else if (lower === "meta" || lower === "cmd" || lower === "command" || lower === "win") {
      modifiers |= 4;
    } else {
      mainKey = p;
    }
  }

  if (!mainKey && parts.length > 0) {
    mainKey = parts[parts.length - 1];
  }

  const lowerKey = mainKey.toLowerCase();
  let keyInfo = CDP_KEY_MAP[lowerKey];

  if (!keyInfo) {
    if (mainKey.length === 1) {
      const isAlpha = /[a-zA-Z]/.test(mainKey);
      const isDigit = /[0-9]/.test(mainKey);
      const upper = mainKey.toUpperCase();
      const code = isAlpha ? `Key${upper}` : isDigit ? `Digit${mainKey}` : mainKey;
      keyInfo = {
        code,
        keyCode: upper.charCodeAt(0),
        key: modifiers & 8 ? upper : mainKey,
        text: (modifiers & 2 || modifiers & 4) ? "" : mainKey
      };
    } else {
      keyInfo = { code: mainKey, keyCode: 0, key: mainKey };
    }
  }

  // 1. rawKeyDown
  await sendCdpCommand(tabId, "Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    modifiers,
    key: keyInfo.key,
    code: keyInfo.code,
    windowsVirtualKeyCode: keyInfo.keyCode
  });

  // 2. char (for character input when not a shortcut)
  if (keyInfo.text && !(modifiers & 2) && !(modifiers & 4)) {
    await sendCdpCommand(tabId, "Input.dispatchKeyEvent", {
      type: "char",
      modifiers,
      text: keyInfo.text,
      unmodifiedText: keyInfo.text
    });
  }

  // 3. keyUp
  await sendCdpCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers,
    key: keyInfo.key,
    code: keyInfo.code,
    windowsVirtualKeyCode: keyInfo.keyCode
  });

  return { success: true, key: keyCombo, selector, trusted: true };
}

/**
 * Dispatch real, trusted mouse move via CDP Input.dispatchMouseEvent
 */
export async function dispatchCdpMouseMove(tabId, x, y) {
  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(x),
    y: Math.round(y)
  });
  return { success: true, x: Math.round(x), y: Math.round(y) };
}
