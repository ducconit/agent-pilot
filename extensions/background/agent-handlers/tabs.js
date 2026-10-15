/**
 * Agent Pilot - Agent bridge handlers: tab management
 * Each handler receives (client, params, respond) from AgentBridgeClient.handleAgentMessage.
 * Handler bodies were moved verbatim from bridge-client.js; keep behaviour identical.
 */

import {
  agentControlledTabs,
  normalizeUrl,
  EXTENSION_VERSION,
  logDebug
} from "../constants.js";
import { attachDebugger } from "../cdp-manager.js";

export const tabsHandlers = {
  ping: async (_client, _params, respond) => {
    respond({ pong: true, timestamp: Date.now(), version: EXTENSION_VERSION });
  },

  "tabs.query": async (client, params, respond) => {
    const queryParams = { ...params };
    delete queryParams.instanceId;
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

  "tabs.listAll": async (client, params, respond) => {
    try {
      const tabs = await client.getAgentGroupTabs();
      const list = (tabs || []).map((t) => ({
        tabId: t.id,
        title: t.title,
        url: t.url,
        active: t.active,
        windowId: t.windowId,
        isAgentTab: true,
        groupId: t.groupId
      }));
      respond(list);
    } catch (err) {
      respond(null, err);
    }
  },

  "tabs.getActive": async (client, params, respond) => {
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
    const url = normalizeUrl(params.url || "https://google.com");
    const makeActive = params.active === true;
    // Remember the previously active tab so a background-created tab never steals focus
    const activeTabBefore = !makeActive ? await client.getActiveTabId() : null;

    chrome.tabs.create({ url, active: makeActive }, async (tab) => {
      if (chrome.runtime.lastError) {
        respond(null, chrome.runtime.lastError);
      } else {
        if (tab && tab.id) {
          agentControlledTabs.add(tab.id);
          client.lastAgentTabId = tab.id;
          await client.assignTabToAgentGroup(tab).catch((err) => logDebug("assignTabToAgentGroup error", err));

          if (!makeActive && activeTabBefore && activeTabBefore !== tab.id) {
            const currentActive = await client.getActiveTabId();
            if (currentActive === tab.id) {
              await chrome.tabs.update(activeTabBefore, { active: true }).catch((err) => logDebug("restore active tab error", err));
            }
          }

          await attachDebugger(tab.id, client.broadcastFn).catch((err) => logDebug("attachDebugger error", err));
        }
        respond(tab);
      }
    });
  },

  "tabs.update": async (client, params, respond) => {
    let tabId;
    try {
      tabId = await client.getTargetTabId(params.tabId);
    } catch (err) {
      return respond(null, err);
    }
    if (!tabId) return respond(null, new Error("No target tab found in Agent Pilot group"));
    const updateProps = {};
    if (params.url) updateProps.url = normalizeUrl(params.url);
    if (params.active !== undefined) updateProps.active = Boolean(params.active);

    chrome.tabs.update(tabId, updateProps, async (tab) => {
      if (chrome.runtime.lastError) {
        respond(null, chrome.runtime.lastError);
      } else {
        if (tab && tab.id) {
          agentControlledTabs.add(tab.id);
          client.lastAgentTabId = tab.id;
          await client.assignTabToAgentGroup(tab).catch((err) => logDebug("assignTabToAgentGroup error", err));
          await attachDebugger(tab.id, client.broadcastFn).catch((err) => logDebug("attachDebugger error", err));
        }
        respond(tab);
      }
    });
  },

  "tabs.remove": async (client, params, respond) => {
    let tabId;
    try {
      tabId = await client.getTargetTabId(params.tabId);
    } catch (err) {
      return respond(null, err);
    }
    if (!tabId) return respond(null, new Error("No target tab found in Agent Pilot group"));
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
      else respond({ success: true });
    });
  }
};
