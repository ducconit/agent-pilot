/**
 * Agent Pilot - Agent bridge handlers: tab management
 * Each handler receives (client, params, respond) from AgentBridgeClient.handleAgentMessage.
 * Handler bodies were moved verbatim from bridge-client.js; keep behaviour identical.
 */

import {
  attachedTabs,
  agentControlledTabs,
  normalizeUrl,
  EXTENSION_VERSION,
  NO_TARGET_TAB_ERROR,
  DEFAULT_LOAD_TIMEOUT_MS,
  logDebug
} from "../constants.js";
import { attachDebugger } from "../cdp-manager.js";
import { createTabWithWindowFallback, waitForTabComplete } from "../tab-manager.js";
import { getPositiveNumber } from "../batch-validation.js";
import { runInlineWait, mergeWaitMeta } from "./page-input.js";

export const tabsHandlers = {
  ping: async (_client, _params, respond) => {
    respond({ pong: true, timestamp: Date.now(), version: EXTENSION_VERSION });
  },

  "tabs.query": async (client, params, respond) => {
    const queryParams = { ...params };
    delete queryParams.instanceId;
    delete queryParams.agentId;
    delete queryParams.agentLastTabId;
    return new Promise((resolve) => {
      chrome.tabs.query(queryParams, async (tabs) => {
        if (chrome.runtime.lastError) {
          respond(null, chrome.runtime.lastError);
          return resolve();
        }
        try {
          const agentGroupIds = await client.getAgentGroupIds();
          const filtered = (tabs || []).filter((t) => {
            if (!t || !t.id) return false;
            if (agentGroupIds.size > 0 && agentGroupIds.has(t.groupId)) return true;
            return agentControlledTabs.has(t.id);
          });
          respond(filtered);
        } catch (err) {
          respond(null, err);
        }
        resolve();
      });
    });
  },

  "tabs.listAll": async (client, _params, respond) => {
    try {
      const tabs = await client.getAgentGroupTabs();
      const list = (tabs || []).map((t) => ({
        tabId: t.id,
        title: t.title,
        url: t.url,
        active: t.active,
        windowId: t.windowId,
        isAgentTab: true,
        ownerAgentId: client.tabOwners instanceof Map ? (client.tabOwners.get(t.id) || null) : null,
        groupId: t.groupId
      }));
      respond(list);
    } catch (err) {
      respond(null, err);
    }
  },

  "tabs.getActive": async (client, _params, respond) => {
    try {
      const tabId = await client.getTargetTabId(null);
      if (!tabId) {
        return respond(null);
      }
      const tab = await chrome.tabs.get(tabId);
      respond(tab || null);
    } catch (err) {
      respond(null, err);
    }
  },

  "tabs.create": async (client, params, respond) => {
    const url = normalizeUrl(params.url || "https://google.com", params);
    const makeActive = params.active === true;
    // Remember the previously active tab so a background-created tab never steals focus
    const activeTabBefore = !makeActive ? await client.getActiveTabId() : null;

    let tab;
    try {
      tab = await createTabWithWindowFallback(url, makeActive);
    } catch (err) {
      return respond(null, err);
    }

    try {
      let waitMeta = null;
      if (tab && tab.id) {
        agentControlledTabs.add(tab.id);
        if (typeof client.recordAgentTab === "function") {
          client.recordAgentTab(tab.id, params.agentId, { isOwner: true });
        } else {
          client.lastAgentTabId = tab.id;
        }
        await client.assignTabToAgentGroup(tab).catch((err) => logDebug("assignTabToAgentGroup error", err));

        if (!makeActive && activeTabBefore && activeTabBefore !== tab.id) {
          const currentActive = await client.getActiveTabId();
          if (currentActive === tab.id) {
            await chrome.tabs.update(activeTabBefore, { active: true }).catch((err) => logDebug("restore active tab error", err));
          }
        }

        await attachDebugger(tab.id, client.broadcastFn).catch((err) => logDebug("attachDebugger error", err));

        let loadWaitResult = null;
        let loadTimeout = DEFAULT_LOAD_TIMEOUT_MS;
        if (params.waitUntil !== false) {
          loadTimeout = getPositiveNumber(params.loadTimeout, params.timeoutMs, params.timeout) || DEFAULT_LOAD_TIMEOUT_MS;
          loadWaitResult = await waitForTabComplete(tab.id, loadTimeout);
          if (!attachedTabs.has(tab.id)) {
            await attachDebugger(tab.id, client.broadcastFn).catch((err) => logDebug("post-load attachDebugger error", err));
          }
        }

        waitMeta = await runInlineWait(client, tab.id, params);

        if (typeof chrome.tabs?.get === "function") {
          try {
            const refreshed = await chrome.tabs.get(tab.id);
            if (refreshed && refreshed.id) tab = refreshed;
          } catch (_) {}
        }
        if (loadWaitResult?.timedOut && tab && typeof tab === "object" && tab.status !== "complete") {
          tab = { ...tab, loadTimedOut: true, loadTimeoutMs: loadTimeout };
        }
      }
      respond(mergeWaitMeta(tab, waitMeta));
    } catch (err) {
      respond(null, err);
    }
  },

  "tabs.update": async (client, params, respond) => {
    let tabId;
    try {
      tabId = await client.getTargetTabId(params.tabId, params.agentId);
    } catch (err) {
      return respond(null, err);
    }
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    const updateProps = {};
    if (params.url) updateProps.url = normalizeUrl(params.url, params);
    if (params.active !== undefined) updateProps.active = Boolean(params.active);

    chrome.tabs.update(tabId, updateProps, async (updatedTab) => {
      if (chrome.runtime.lastError) {
        respond(null, chrome.runtime.lastError);
      } else {
        try {
          let tab = updatedTab;
          let waitMeta = null;
          if (tab && tab.id) {
            agentControlledTabs.add(tab.id);
            if (typeof client.recordAgentTab === "function") {
              client.recordAgentTab(tab.id, params.agentId);
            } else {
              client.lastAgentTabId = tab.id;
            }
            await client.assignTabToAgentGroup(tab).catch((err) => logDebug("assignTabToAgentGroup error", err));
            await attachDebugger(tab.id, client.broadcastFn).catch((err) => logDebug("attachDebugger error", err));

            let loadWaitResult = null;
            let loadTimeout = DEFAULT_LOAD_TIMEOUT_MS;
            if (params.url && params.waitUntil !== false) {
              loadTimeout = getPositiveNumber(params.loadTimeout, params.timeoutMs, params.timeout) || DEFAULT_LOAD_TIMEOUT_MS;
              loadWaitResult = await waitForTabComplete(tab.id, loadTimeout);
              if (!attachedTabs.has(tab.id)) {
                await attachDebugger(tab.id, client.broadcastFn).catch((err) => logDebug("post-load attachDebugger error", err));
              }
            }

            waitMeta = await runInlineWait(client, tab.id, params);

            if (typeof chrome.tabs?.get === "function") {
              try {
                const refreshed = await chrome.tabs.get(tab.id);
                if (refreshed && refreshed.id) tab = refreshed;
              } catch (_) {}
            }
            if (loadWaitResult?.timedOut && tab && typeof tab === "object" && tab.status !== "complete") {
              tab = { ...tab, loadTimedOut: true, loadTimeoutMs: loadTimeout };
            }
          }
          respond(mergeWaitMeta(tab, waitMeta));
        } catch (err) {
          respond(null, err);
        }
      }
    });
  },

  "tabs.remove": async (client, params, respond) => {
    const hasExplicitTab = params.tabId !== undefined && params.tabId !== null && params.tabId !== "";
    let tabId;
    try {
      tabId = await client.getTargetTabId(params.tabId, params.agentId, {
        // If an agentId is provided without an explicit tabId, only allow closing its own last tab
        allowFallback: hasExplicitTab || !params.agentId
      });
    } catch (err) {
      return respond(null, err);
    }
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        respond(null, chrome.runtime.lastError);
      } else {
        agentControlledTabs.delete(tabId);
        if (typeof client.clearAgentTab === "function") {
          client.clearAgentTab(tabId);
        } else if (client.lastAgentTabId === tabId) {
          client.lastAgentTabId = null;
        }
        respond({ success: true, closedTabId: tabId });
      }
    });
  }
};
