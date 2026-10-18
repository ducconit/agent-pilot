/**
 * Agent Pilot - Agent bridge handler: devtools.getData
 * Aggregates buffered console/network events plus live performance metrics.
 * Moved verbatim from bridge-client.js; behaviour must stay identical.
 */

import { attachedTabs, getBuffer, LIMITS } from "../constants.js";
import { attachDebugger, sendCdpCommand } from "../cdp-manager.js";

const BYTES_PER_MB = 1024 * 1024;

/**
 * Shared DevTools telemetry collector used by both `devtools.getData` and batch `devtools` steps.
 */
export async function collectDevtoolsData(tabId, params = {}, broadcastFn = null) {
  if (!attachedTabs.has(tabId)) {
    await attachDebugger(tabId, broadcastFn).catch((err) => {
      console.warn("[AgentPilot] Auto attach debugger failed:", err);
    });
  }

  const buffer = getBuffer(tabId);
  const requestedType = params.type || "all";
  const limit = Math.min(Math.max(Number(params.limit) || LIMITS.DEVTOOLS_FETCH_DEFAULT, 1), LIMITS.DEVTOOLS_FETCH_MAX);
  const filterOrigin = params.filterOrigin !== false;

  let consoleData = undefined;
  let networkData = undefined;
  let performanceData = undefined;

  if (requestedType === "all" || requestedType === "console") {
    let logs = buffer.console;
    if (filterOrigin) {
      // Hide our own logs: entries whose stack only references extension frames
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
          jsHeapUsedMB: metricsMap.JSHeapUsedSize ? +(metricsMap.JSHeapUsedSize / BYTES_PER_MB).toFixed(2) : undefined,
          jsHeapTotalMB: metricsMap.JSHeapTotalSize ? +(metricsMap.JSHeapTotalSize / BYTES_PER_MB).toFixed(2) : undefined,
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

  return responsePayload;
}

export const devtoolsHandlers = {
  "devtools.getData": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) {
      respond(null, new Error("No target tab available for DevTools"));
      return;
    }
    const payload = await collectDevtoolsData(tabId, params, client.broadcastFn);
    respond(payload);
  }
};
