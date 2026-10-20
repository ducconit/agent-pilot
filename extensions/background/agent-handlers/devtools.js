/**
 * Agent Pilot - Agent bridge handler: devtools.getData
 * Aggregates buffered console/network events plus live performance metrics.
 * Moved verbatim from bridge-client.js; behaviour must stay identical.
 */

import { attachedTabs, getBuffer, LIMITS, NO_TARGET_TAB_ERROR } from "../constants.js";
import { attachDebugger, getPerformanceMetrics } from "../cdp-manager.js";

const STATIC_RESOURCE_TYPES = new Set(["image", "media", "font", "stylesheet", "manifest"]);
const STATIC_URL_RE = /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|css|mp4|webm|mp3|wav)(?:[?#]|$)/i;

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
  const errorsOnly = Boolean(params.errorsOnly);
  const excludeStatic = Boolean(params.excludeStatic);
  const includeHeaders = Boolean(params.includeHeaders);

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
    if (errorsOnly) {
      logs = logs.filter(item => {
        const level = String(item.type || "").toLowerCase();
        return level === "error" || level === "assert";
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
    if (excludeStatic) {
      reqs = reqs.filter(item => {
        const rType = String(item.type || "").toLowerCase();
        if (STATIC_RESOURCE_TYPES.has(rType)) return false;
        const url = item.url || "";
        if (url.startsWith("data:") || STATIC_URL_RE.test(url)) return false;
        return true;
      });
    }
    if (errorsOnly) {
      reqs = reqs.filter(item =>
        item.status === "failed" ||
        Boolean(item.errorText) ||
        (typeof item.status === "number" && item.status >= 400)
      );
    }
    reqs = reqs.slice(-limit);
    if (!includeHeaders) {
      reqs = reqs.map(({ headers: _headers, ...rest }) => rest);
    }
    networkData = reqs;
    if (params.clear) {
      buffer.network.clear();
    }
  }

  if (requestedType === "all" || requestedType === "performance") {
    try {
      const perfDetails = await getPerformanceMetrics(tabId, params);
      const metricsMap = perfDetails.metrics || {};
      performanceData = {
        metrics: metricsMap,
        jsHeapUsedMB: perfDetails.memory?.jsHeapUsedMB,
        jsHeapTotalMB: perfDetails.memory?.jsHeapTotalMB,
        domNodes: perfDetails.memory?.domNodes,
        jsEventListeners: perfDetails.memory?.jsEventListeners,
        documents: perfDetails.memory?.documents,
        frames: perfDetails.memory?.frames,
        layoutCount: perfDetails.memory?.layoutCount,
        recalcStyleCount: perfDetails.memory?.recalcStyleCount,
        webVitals: perfDetails.webVitals,
        resources: perfDetails.resources,
        domHealth: perfDetails.domHealth,
        diagnostics: perfDetails.diagnostics,
        timestamp: perfDetails.timestamp || Date.now()
      };
    } catch (perfErr) {
      performanceData = { error: perfErr.message };
    }
  }

  const consoleErrorCount = consoleData
    ? consoleData.filter((c) => c.type === "error" || c.type === "assert").length
    : undefined;
  const failedNetworkRequests = networkData
    ? networkData.filter((r) => r.status === "failed" || Boolean(r.errorText) || (typeof r.status === "number" && r.status >= 400)).length
    : undefined;

  const responsePayload = {
    tabId,
    attached: attachedTabs.has(tabId),
    timestamp: Date.now(),
    summary: {
      consoleEntries: consoleData ? consoleData.length : 0,
      consoleErrors: consoleErrorCount,
      networkRequests: networkData ? networkData.length : 0,
      failedNetworkRequests,
      jsHeapUsedMB: performanceData?.jsHeapUsedMB,
      domNodes: performanceData?.domNodes,
      jsEventListeners: performanceData?.jsEventListeners,
      lcpMs: performanceData?.webVitals?.lcpMs,
      cls: performanceData?.webVitals?.cls,
      diagnosticsCount: Array.isArray(performanceData?.diagnostics) ? performanceData.diagnostics.length : undefined
    }
  };

  if (consoleData !== undefined) responsePayload.console = consoleData;
  if (networkData !== undefined) responsePayload.network = networkData;
  if (performanceData !== undefined) responsePayload.performance = performanceData;

  return responsePayload;
}

export const devtoolsHandlers = {
  "devtools.getData": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) {
      respond(null, new Error(NO_TARGET_TAB_ERROR));
      return;
    }
    const payload = await collectDevtoolsData(tabId, params, client.broadcastFn);
    respond(payload);
  }
};
