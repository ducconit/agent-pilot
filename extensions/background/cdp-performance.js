/**
 * Agent Pilot - CDP Performance Tooling
 *
 * Performance traces, runtime metrics, garbage collection and heap snapshots.
 * Trace data is accumulated by the listener in cdp-events.js and stored in
 * `activeTracingSessions`; this module starts/stops sessions and reads them back.
 */

import { activeTracingSessions, TIMEOUTS, logDebug } from "./constants.js";
import { sendCdpCommand } from "./cdp-connection.js";

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
      // Resolved by the Tracing.tracingComplete handler, or bounded by a timeout
      // so a missing final event cannot hang the caller.
      trace.onComplete = resolve;
      setTimeout(resolve, TIMEOUTS.CDP_TRACE_COMPLETE_MS);
    });

    await sendCdpCommand(tabId, "Tracing.end", {}, TIMEOUTS.CDP_TRACING_END_MS);
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
  // Heap snapshots stream in as many addHeapSnapshotChunk events; temporarily
  // listen for them, then detach the listener before building the summary.
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
