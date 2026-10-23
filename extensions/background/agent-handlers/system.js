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
import { sendCdpCommand } from "../cdp-manager.js";
import {
  extensionProtocolUnavailable,
  isSelfExtension,
  normalizeExtensionAction,
  selectTabTargetId,
  validateExtensionId,
  validateUnpackedExtensionPath
} from "../extension-lifecycle.js";

// Network request listing defaults (agent-facing cap, independent of the capture buffer)
const NETWORK_LIST_LIMIT_DEFAULT = 100;
const NETWORK_LIST_LIMIT_MAX = 1000;
// Short delay so the "reloading" response reaches the agent before the socket dies
const RELOAD_RESPONSE_DELAY_MS = 150;

function invokeManagement(method, ...args) {
  const api = chrome.management?.[method];
  if (typeof api !== "function") {
    throw new Error(`chrome.management.${method} API is not available`);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      const lastError = chrome.runtime?.lastError;
      if (lastError) reject(new Error(lastError.message || `chrome.management.${method} failed`));
      else callback(value);
    };
    const callback = (value) => finish(resolve, value);
    try {
      const result = api.call(chrome.management, ...args, callback);
      if (result && typeof result.then === "function") {
        result.then(value => finish(resolve, value), error => finish(reject, error));
      }
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function withExtensionProtocolTarget(client, params, action, operation) {
  const tabId = await client.getTargetTabId(params.tabId, params.agentId);
  if (!tabId) throw new Error(NO_TARGET_TAB_ERROR);
  const attached = await attachDebugger(tabId, client.broadcastFn);
  if (!attached || attached.success === false) {
    throw new Error(`Extension lifecycle action "${action}" requires a debugger target: ${attached?.error || "attach failed"}`);
  }
  return client.runWithTabLock(tabId, `extensions.${action}`, () => operation(tabId));
}

async function sendExtensionProtocol(tabId, action, method, params = {}) {
  try {
    return await sendCdpCommand(tabId, method, params);
  } catch (error) {
    throw extensionProtocolUnavailable(action, method, error);
  }
}

async function extensionTabTargetIdForTab(tabId, action) {
  const response = await sendExtensionProtocol(tabId, action, "Target.getTargets", {
    filter: [{ type: "tab", exclude: false }]
  });
  const targetInfos = response?.targetInfos || [];
  try {
    return selectTabTargetId(targetInfos);
  } catch (error) {
    if (!chrome.tabs?.get || !Array.isArray(targetInfos) || targetInfos.filter(target => target?.type === "tab").length < 2) throw error;
    const tab = await chrome.tabs.get(tabId);
    return selectTabTargetId(targetInfos, { url: tab?.url, title: tab?.title });
  }
}

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
    const currentNavId = buffer.navigationId || 1;
    const targetNavId =
      params.navigationId !== undefined && params.navigationId !== null && params.navigationId !== ""
        ? Number(params.navigationId)
        : params.includePreserved === false || params.currentNavigationOnly === true
          ? currentNavId
          : null;
    let requests = Array.from(buffer.network.values());
    if (targetNavId !== null && !Number.isNaN(targetNavId)) {
      requests = requests.filter(r => (r.navigationId || 1) === targetNavId);
    }
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
      navigationId: currentNavId,
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

  "memory.heapCapability": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    respond({
      supported: false,
      target: "extension-debugger",
      snapshot: false,
      baseline: false,
      diff: false,
      collectGarbage: false,
      code: "HEAPPROFILER_UNAVAILABLE",
      tabId,
      message: "Chrome's extension debugger does not expose HeapProfiler for this tab. Create an isolated DevTools context and pass its negative tabId for real heap snapshot/baseline/diff support."
    });
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
    const rawAction = params.action || "list";
    const action = normalizeExtensionAction(rawAction);
    if (String(rawAction).toLowerCase() === "enable") {
      params.enabled = true;
    } else if (String(rawAction).toLowerCase() === "disable") {
      params.enabled = false;
    }

    if (action === "list") {
      invokeManagement("getAll")
        .then(extList => {
          const list = (extList || []).map(e => ({
          id: e.id,
          name: e.name,
          version: e.version,
          enabled: e.enabled,
          type: e.type,
          installType: e.installType,
          mayDisable: e.mayDisable,
          mayEnable: e.mayEnable
          }));
          respond({ total: list.length, extensions: list });
        })
        .catch(error => respond(null, error));
    } else if (action === "setEnabled") {
      let extensionId;
      try { extensionId = validateExtensionId(params.extensionId); } catch (error) { return respond(null, error); }
      const enabled = params.enabled !== false;
      invokeManagement("setEnabled", extensionId, enabled)
        .then(() => respond({ success: true, extensionId, enabled }))
        .catch(error => respond(null, error));
    } else if (action === "toggle") {
      let extensionId;
      try { extensionId = validateExtensionId(params.extensionId); } catch (error) { return respond(null, error); }
      invokeManagement("get", extensionId).then(info => {
        const targetEnabled = !info.enabled;
        return invokeManagement("setEnabled", extensionId, targetEnabled)
          .then(() => respond({ success: true, extensionId, enabled: targetEnabled }));
      }).catch(error => respond(null, error));
    } else if (action === "uninstall") {
      let extensionId;
      try { extensionId = validateExtensionId(params.extensionId); } catch (error) { return respond(null, error); }
      if (isSelfExtension(extensionId, chrome.runtime?.id) && params.confirmSelf !== true) {
        return respond(null, new Error("Refusing to uninstall Agent Pilot itself; pass confirmSelf=true to confirm"));
      }
      invokeManagement("get", extensionId)
        .then(info => {
          if (info?.mayDisable === false) {
            throw new Error(`Extension ${extensionId} cannot be uninstalled in this Chrome profile (managed or policy-controlled)`);
          }
          return invokeManagement("uninstall", extensionId, { showConfirmDialog: false });
        })
        .then(() => respond({ success: true, extensionId, uninstalled: true }))
        .catch(error => respond(null, error));
    } else if (action === "install") {
      let extensionPath;
      try { extensionPath = validateUnpackedExtensionPath(params.path); } catch (error) { return respond(null, error); }
      withExtensionProtocolTarget(client, params, action, tabId => sendExtensionProtocol(
        tabId,
        action,
        "Extensions.loadUnpacked",
        { path: extensionPath, ...(params.enableInIncognito !== undefined ? { enableInIncognito: Boolean(params.enableInIncognito) } : {}) }
      ))
        .then(result => respond({ success: true, action, path: extensionPath, extensionId: result?.id, protocol: "Extensions.loadUnpacked" }))
        .catch(error => respond(null, error));
    } else if (action === "reload") {
      let extensionId;
      try { extensionId = validateExtensionId(params.extensionId); } catch (error) { return respond(null, error); }
      if (isSelfExtension(extensionId, chrome.runtime?.id)) {
        respond({ success: true, action, extensionId, reloading: true, protocol: "chrome.runtime.reload" });
        setTimeout(() => chrome.runtime.reload(), RELOAD_RESPONSE_DELAY_MS);
        return;
      }
      withExtensionProtocolTarget(client, params, action, async tabId => {
        const extensions = await sendExtensionProtocol(tabId, action, "Extensions.getExtensions");
        const extension = (extensions?.extensions || []).find(item => item.id === extensionId);
        if (!extension?.path) {
          throw new Error(`UNSUPPORTED_EXTENSION_API: reload only supports unpacked extensions exposed by Extensions.getExtensions (${extensionId})`);
        }
        await sendExtensionProtocol(tabId, action, "Extensions.uninstall", { id: extensionId });
        const installed = await sendExtensionProtocol(tabId, action, "Extensions.loadUnpacked", { path: extension.path });
        return { path: extension.path, extensionId: installed?.id || extensionId };
      })
        .then(result => respond({ success: true, action, extensionId: result.extensionId, path: result.path, reloaded: true, protocol: "Extensions.uninstall+Extensions.loadUnpacked" }))
        .catch(error => respond(null, error));
    } else if (action === "triggerAction") {
      let extensionId;
      try { extensionId = validateExtensionId(params.extensionId); } catch (error) { return respond(null, error); }
      withExtensionProtocolTarget(client, params, action, async tabId => {
        const targetId = await extensionTabTargetIdForTab(tabId, action);
        await sendExtensionProtocol(tabId, action, "Extensions.triggerAction", { id: extensionId, targetId });
        return { targetId };
      })
        .then(result => respond({ success: true, action, extensionId, targetId: result.targetId, triggered: true, protocol: "Extensions.triggerAction" }))
        .catch(error => respond(null, error));
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
  },

  "webauthn.manage": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    const rawAction = String(params.action || "enable").trim();
    const lower = rawAction.toLowerCase();

    client.runWithTabLock(tabId, `webauthn.${rawAction}`, async () => {
      if (!attachedTabs.has(tabId)) {
        await attachDebugger(tabId, client.broadcastFn);
      }

      if (lower === "enable") {
        const enableUI = Boolean(params.enableUI);
        await sendCdpCommand(tabId, "WebAuthn.enable", { enableUI });
        return { success: true, tabId, action: "enable", enableUI };
      }

      if (lower === "disable") {
        await sendCdpCommand(tabId, "WebAuthn.disable", {});
        return { success: true, tabId, action: "disable" };
      }

      if (lower === "addauthenticator" || lower === "addvirtualauthenticator" || lower === "add_authenticator" || lower === "add") {
        await sendCdpCommand(tabId, "WebAuthn.enable", { enableUI: Boolean(params.enableUI) }).catch(() => {});
        const options =
          params.options && typeof params.options === "object" && !Array.isArray(params.options)
            ? params.options
            : {
                protocol: params.protocol || "ctap2",
                transport: params.transport || "internal",
                hasResidentKey: params.hasResidentKey !== undefined ? Boolean(params.hasResidentKey) : true,
                hasUserVerification: params.hasUserVerification !== undefined ? Boolean(params.hasUserVerification) : true,
                isUserVerified: params.isUserVerified !== undefined ? Boolean(params.isUserVerified) : true,
                automaticPresenceSimulation:
                  params.automaticPresenceSimulation !== undefined ? Boolean(params.automaticPresenceSimulation) : true
              };
        const res = await sendCdpCommand(tabId, "WebAuthn.addVirtualAuthenticator", { options });
        return {
          success: true,
          tabId,
          action: "addAuthenticator",
          authenticatorId: res?.authenticatorId || null,
          options
        };
      }

      const authenticatorId = typeof params.authenticatorId === "string" ? params.authenticatorId.trim() : "";
      if (!authenticatorId) {
        throw new Error(`authenticatorId is required for WebAuthn action '${rawAction}'`);
      }

      if (lower === "removeauthenticator" || lower === "removevirtualauthenticator" || lower === "remove_authenticator" || lower === "remove") {
        await sendCdpCommand(tabId, "WebAuthn.removeVirtualAuthenticator", { authenticatorId });
        return { success: true, tabId, action: "removeAuthenticator", authenticatorId };
      }

      if (lower === "getcredentials" || lower === "get_credentials" || lower === "listcredentials" || lower === "credentials") {
        const res = await sendCdpCommand(tabId, "WebAuthn.getCredentials", { authenticatorId });
        return {
          success: true,
          tabId,
          action: "getCredentials",
          authenticatorId,
          credentials: res?.credentials || []
        };
      }

      if (lower === "clearcredentials" || lower === "clear_credentials" || lower === "clear") {
        await sendCdpCommand(tabId, "WebAuthn.clearCredentials", { authenticatorId });
        return { success: true, tabId, action: "clearCredentials", authenticatorId };
      }

      if (lower === "setuserverified" || lower === "set_user_verified" || lower === "verify") {
        const isUserVerified = params.isUserVerified !== false;
        await sendCdpCommand(tabId, "WebAuthn.setUserVerified", { authenticatorId, isUserVerified });
        return { success: true, tabId, action: "setUserVerified", authenticatorId, isUserVerified };
      }

      throw new Error(`Unsupported WebAuthn action: ${rawAction}`);
    })
      .then((res) => respond(res))
      .catch((err) => respond(null, err));
  }
};
