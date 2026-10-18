/**
 * Agent Pilot - Batch action handlers: navigation (open / navigate / close)
 *
 * Pure moves from the original batch-actions.js switch (behaviour unchanged).
 * Handlers receive the shared ctx { bridgeClient, currentTabId, params, stepResult, stepNum }
 * and mutate only ctx / shared browser bookkeeping.
 */

import {
  normalizeUrl,
  DEFAULT_LOAD_TIMEOUT_MS,
  agentControlledTabs,
  logDebug
} from "./constants.js";
import { attachDebugger } from "./cdp-manager.js";
import {
  getActiveTabId,
  getTargetTabId,
  assignTabToAgentGroup
} from "./tab-manager.js";
import { getPositiveNumber } from "./batch-validation.js";

export const navigationHandlers = { open: openAction, navigate: navigateAction, close: closeAction };



/**
 * open / open_tab / tabs.create — create a tab (optionally background), attach
 * the debugger and wait for load completion.
 */
async function openAction(ctx, act) {
  const { bridgeClient } = ctx;
  const url = normalizeUrl(act.url || "https://google.com");
  const makeActive = act.active === true;
  const activeTabBefore = !makeActive ? await getActiveTabId() : null;

  const tab = await new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: makeActive }, (t) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(t);
    });
  });

  ctx.currentTabId = tab.id;
  const agentId = act.agentId || ctx.params?.agentId || null;
  if (bridgeClient) {
    if (typeof bridgeClient.recordAgentTab === "function") {
      bridgeClient.recordAgentTab(tab.id, agentId, { isOwner: true });
    } else {
      bridgeClient.lastAgentTabId = tab.id;
    }
  }
  agentControlledTabs.add(tab.id);
  await assignTabToAgentGroup(tab).catch((err) => logDebug("batch assignTabToAgentGroup", err));

  if (!makeActive && activeTabBefore && activeTabBefore !== tab.id) {
    const curActive = await getActiveTabId();
    if (curActive === tab.id) {
      await chrome.tabs.update(activeTabBefore, { active: true }).catch((err) => logDebug("batch restore active tab", err));
    }
  }

  await attachDebugger(tab.id).catch((err) => logDebug("batch attachDebugger", err));

  // Wait for tab load completion if requested (default true)
  if (act.waitUntil !== false) {
    const loadTimeout = getPositiveNumber(act.loadTimeout, act.timeoutMs, act.timeout) || DEFAULT_LOAD_TIMEOUT_MS;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };

      const timeout = setTimeout(finish, loadTimeout);

      const onUpdated = (tId, changeInfo) => {
        if (tId === tab.id && changeInfo.status === "complete") {
          finish();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);

      chrome.tabs.get(tab.id, (cur) => {
        if (!chrome.runtime.lastError && cur && cur.status === "complete") {
          finish();
        }
      });
    });
  }

  ctx.stepResult.success = true;
  ctx.stepResult.tabId = tab.id;
  ctx.stepResult.url = tab.url || tab.pendingUrl || url;
}

/**
 * navigate / tabs.update — navigate an explicit or current tab, optionally
 * waiting for load completion.
 */
async function navigateAction(ctx, act) {
  const { bridgeClient } = ctx;
  const agentId = act.agentId || ctx.params?.agentId || null;
  const targetTabId = act.tabId
    ? (bridgeClient && typeof bridgeClient.getTargetTabId === "function"
        ? await bridgeClient.getTargetTabId(act.tabId, agentId)
        : await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId, { tabOwners: bridgeClient?.tabOwners, agentId }))
    : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab for navigate");
  const url = normalizeUrl(act.url);

  if (act.waitUntil !== false) {
    const loadTimeout = getPositiveNumber(act.loadTimeout, act.timeoutMs, act.timeout) || DEFAULT_LOAD_TIMEOUT_MS;
    await new Promise((resolve, reject) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      };

      const timeout = setTimeout(done, loadTimeout);

      const onUpdated = (tId, changeInfo) => {
        if (tId === targetTabId && changeInfo.status === "complete") {
          done();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);

      chrome.tabs.update(targetTabId, { url }, (t) => {
        if (chrome.runtime.lastError) {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (t && t.status === "complete") {
          done();
        }
      });
    });
  } else {
    await new Promise((resolve, reject) => {
      chrome.tabs.update(targetTabId, { url }, (t) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(t);
      });
    });
  }

  ctx.stepResult.success = true;
  ctx.stepResult.tabId = targetTabId;
  ctx.stepResult.url = url;
}

/**
 * close / close_tab / tabs.remove — close a tab and clear any agent bookkeeping
 * that pointed at it.
 */
async function closeAction(ctx, act) {
  const { bridgeClient } = ctx;
  const agentId = act.agentId || ctx.params?.agentId || null;
  const targetTabId = act.tabId
    ? (bridgeClient && typeof bridgeClient.getTargetTabId === "function"
        ? await bridgeClient.getTargetTabId(act.tabId, agentId)
        : await getTargetTabId(act.tabId, bridgeClient?.lastAgentTabId, { tabOwners: bridgeClient?.tabOwners, agentId }))
    : ctx.currentTabId;
  if (!targetTabId) throw new Error("No active tab to close");
  await new Promise((resolve, reject) => {
    chrome.tabs.remove(targetTabId, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve();
    });
  });
  agentControlledTabs.delete(targetTabId);
  if (ctx.currentTabId === targetTabId) {
    ctx.currentTabId = null;
  }
  if (bridgeClient) {
    if (typeof bridgeClient.clearAgentTab === "function") {
      bridgeClient.clearAgentTab(targetTabId);
    } else if (bridgeClient.lastAgentTabId === targetTabId) {
      bridgeClient.lastAgentTabId = null;
    }
  }
  ctx.stepResult.success = true;
  ctx.stepResult.closedTabId = targetTabId;
}
