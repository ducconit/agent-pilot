/**
 * Agent Pilot - Agent bridge handlers: emulation, network, performance, memory,
 * extension management and runtime config.
 * Moved verbatim from bridge-client.js; behaviour must stay identical.
 */

import {
  attachedTabs,
  getBuffer,
  getSecretFilterEnabled,
  setSecretFilterEnabled,
  NO_TARGET_TAB_ERROR
} from "../constants.js";
import {
  attachDebugger,
  setEmulation,
  getNetworkRequestDetail,
  startPerformanceTrace,
  stopPerformanceTrace,
  getPerformanceMetrics,
  collectGarbage,
  takeHeapSnapshot
} from "../cdp-manager.js";

// Network request listing defaults (agent-facing cap, independent of the capture buffer)
const NETWORK_LIST_LIMIT_DEFAULT = 100;
const NETWORK_LIST_LIMIT_MAX = 1000;
// Short delay so the "reloading" response reaches the agent before the socket dies
const RELOAD_RESPONSE_DELAY_MS = 150;

export const systemHandlers = {
  "emulation.set": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    client.runWithTabLock(tabId, "emulation.set", async () => {
      if (!attachedTabs.has(tabId)) {
        await attachDebugger(tabId, client.broadcastFn);
      }
      return await setEmulation(tabId, params);
    })
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "emulation.resize": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    const width = Number(params.width);
    const height = Number(params.height);
    if (isNaN(width) || width <= 0 || isNaN(height) || height <= 0) {
      return respond(null, new Error(`Invalid dimensions: width and height must be positive numbers (got width=${params.width}, height=${params.height})`));
    }
    const scale = Number(params.deviceScaleFactor);
    client.runWithTabLock(tabId, "emulation.resize", async () => {
      if (!attachedTabs.has(tabId)) {
        await attachDebugger(tabId, client.broadcastFn);
      }
      return await setEmulation(tabId, {
        viewport: {
          width: Math.floor(width),
          height: Math.floor(height),
          deviceScaleFactor: !isNaN(scale) && scale > 0 ? scale : 1,
          mobile: !!params.mobile,
          touch: !!params.touch
        }
      });
    })
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "network.listRequests": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
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
    const limit = (!isNaN(rawLimit) && rawLimit > 0)
      ? Math.max(1, Math.min(Math.floor(rawLimit), NETWORK_LIST_LIMIT_MAX))
      : NETWORK_LIST_LIMIT_DEFAULT;
    respond({
      tabId,
      totalCaptured: buffer.network.size,
      matchingCount: requests.length,
      requests: requests.slice(-limit)
    });
  },

  "network.getResponseBody": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    if (!attachedTabs.has(tabId)) {
      await attachDebugger(tabId, client.broadcastFn);
    }
    const request = getBuffer(tabId).network.get(params.requestId) || {};
    getNetworkRequestDetail(tabId, params.requestId, params, request)
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "performance.trace": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    if (!attachedTabs.has(tabId)) {
      await attachDebugger(tabId, client.broadcastFn);
    }
    const action = (params.action || "start").toLowerCase();
    if (action === "stop" || action === "end") {
      stopPerformanceTrace(tabId).then(res => respond(res)).catch(err => respond(null, err));
    } else {
      startPerformanceTrace(tabId, params.categories).then(res => respond(res)).catch(err => respond(null, err));
    }
  },

  "performance.metrics": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    if (!attachedTabs.has(tabId)) {
      await attachDebugger(tabId, client.broadcastFn).catch(() => {});
    }
    getPerformanceMetrics(tabId, params)
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "memory.heapSnapshot": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    if (!attachedTabs.has(tabId)) {
      await attachDebugger(tabId, client.broadcastFn);
    }
    takeHeapSnapshot(tabId, params)
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "memory.collectGarbage": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    if (!attachedTabs.has(tabId)) {
      await attachDebugger(tabId, client.broadcastFn);
    }
    collectGarbage(tabId)
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "extensions.manage": async (client, params, respond) => {
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
  },

  "config.getSecretFilter": async (client, params, respond) => {
    respond({ enabled: getSecretFilterEnabled() });
  },

  "config.setSecretFilter": async (client, params, respond) => {
    if (params.enabled !== undefined) {
      setSecretFilterEnabled(Boolean(params.enabled));
      if (typeof client.broadcastFn === "function") {
        client.broadcastFn({
          type: "SECRET_FILTER_STATUS_CHANGED",
          enabled: getSecretFilterEnabled()
        });
      }
    }
    respond({ enabled: getSecretFilterEnabled() });
  },

  "extension.reload": async (client, params, respond) => {
    respond({ success: true, message: "Reloading extension..." });
    setTimeout(() => {
      chrome.runtime.reload();
    }, RELOAD_RESPONSE_DELAY_MS);
  }
};
