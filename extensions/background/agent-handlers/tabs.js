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
    chrome.tabs.query(queryParams, (tabs) => {
      if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
      else respond(tabs);
    });
  },

  "tabs.listAll": async (client, params, respond) => {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError) {
        return respond(null, chrome.runtime.lastError);
      }
      const list = (tabs || []).map((t) => ({
        tabId: t.id,
        title: t.title,
        url: t.url,
        active: t.active,
        windowId: t.windowId,
        isAgentTab: agentControlledTabs.has(t.id),
        groupId: t.groupId
      }));
      respond(list);
    });
  },

  "tabs.getActive": async (client, params, respond) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
      else respond(tabs[0] || null);
    });
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
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
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
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) respond(null, chrome.runtime.lastError);
      else respond({ success: true });
    });
  }
};
