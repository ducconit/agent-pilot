/**
 * Agent Pilot - Tab & Lock Manager
 * Handles tab resolution, grouping, human input lock shields, and content script injection
 */

import {
  agentControlledTabs,
  tabLockStates,
  getTabLockState,
  AGENT_GROUP_TITLE,
  AGENT_GROUP_COLOR
} from "./constants.js";

/**
 * Get active tab ID in last focused window or any window
 */
export async function getActiveTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (!chrome.runtime.lastError && tabs && tabs.length > 0 && tabs[0]?.id) {
        return resolve(tabs[0].id);
      }
      chrome.tabs.query({ active: true }, (allActive) => {
        resolve(allActive && allActive.length > 0 ? allActive[0].id : null);
      });
    });
  });
}

/**
 * Resolve target tab ID based on requested ID, agent-controlled tabs, or focused window
 */
export async function getTargetTabId(requestedTabId, lastAgentTabId = null) {
  if (requestedTabId !== undefined && requestedTabId !== null) {
    const numId = Number(requestedTabId);
    if (isNaN(numId)) return null;
    try {
      const tab = await chrome.tabs.get(numId);
      return tab?.id || null;
    } catch (_) {
      return null;
    }
  }

  if (lastAgentTabId) {
    try {
      const tab = await chrome.tabs.get(lastAgentTabId);
      if (tab && tab.id) return tab.id;
    } catch (_) {}
  }

  for (const tid of agentControlledTabs) {
    try {
      const tab = await chrome.tabs.get(tid);
      if (tab && tab.id) return tab.id;
    } catch (_) {
      agentControlledTabs.delete(tid);
    }
  }

  return await getActiveTabId();
}

/**
 * Automatically assign tab to native Chrome Tab Group '🤖 Agent Pilot'
 */
export async function assignTabToAgentGroup(tab) {
  if (!chrome.tabs || !chrome.tabs.group || !tab || !tab.id) return;
  try {
    const windowId = tab.windowId;
    let targetGroupId = null;

    if (chrome.tabGroups && chrome.tabGroups.query) {
      try {
        const groups = await chrome.tabGroups.query({ windowId });
        const existing = groups.find((g) => g.title === AGENT_GROUP_TITLE || g.title === "Agent Pilot");
        if (existing) targetGroupId = existing.id;
      } catch (_) {}
    }

    const groupId = await chrome.tabs.group({
      tabIds: [tab.id],
      groupId: targetGroupId || undefined
    });

    if (chrome.tabGroups && chrome.tabGroups.update && (!targetGroupId || groupId !== targetGroupId)) {
      await chrome.tabGroups.update(groupId, {
        title: AGENT_GROUP_TITLE,
        color: AGENT_GROUP_COLOR
      }).catch(() => {});
    }
  } catch (err) {
    console.warn("[AgentPilot] Tab grouping note:", err?.message || err);
  }
}

/**
 * Ensure content script is injected into the tab
 */
export async function ensureContentScript(tabId) {
  if (!tabId) return false;
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:") || tab.url.startsWith("edge://")) {
      return false;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__AGENT_PILOT__)
    }).catch(() => null);

    if (!results || !results[0] || !results[0].result) {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] }).catch(() => {});
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
      await new Promise(r => setTimeout(r, 80));
    }
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Send message to tab with automatic retry and script re-injection
 */
export async function sendTabMessageWithRetry(tabId, message, maxRetries = 3, delayMs = 250) {
  await ensureContentScript(tabId);

  return new Promise((resolve, reject) => {
    let attempts = 0;
    const attempt = () => {
      attempts++;
      chrome.tabs.sendMessage(tabId, message, async (res) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message;
          if (attempts < maxRetries) {
            if (errMsg && errMsg.includes("Receiving end does not exist")) {
              await ensureContentScript(tabId);
            }
            setTimeout(attempt, delayMs);
          } else {
            reject(new Error(errMsg));
          }
        } else {
          resolve(res);
        }
      });
    };
    attempt();
  });
}

/**
 * Explicit human input locking on tab
 */
export async function setTabLock(tabId, busy, action = "") {
  if (!tabId) return false;
  const state = getTabLockState(tabId);
  state.manualLock = Boolean(busy);
  state.currentAction = action;
  if (state.unlockTimer) {
    clearTimeout(state.unlockTimer);
    state.unlockTimer = null;
  }

  if (busy) {
    return await sendTabMessageWithRetry(tabId, {
      action: "set_agent_busy",
      busy: true,
      currentAction: action || "AI Agent đang thao tác..."
    });
  } else {
    if (state.autoCount === 0) {
      return await sendTabMessageWithRetry(tabId, { action: "set_agent_busy", busy: false });
    }
    return { success: true, pendingAutoCount: state.autoCount };
  }
}

/**
 * Wrap an action in temporary lock shield during execution
 */
export async function runWithTabLock(tabId, actionName, runner) {
  if (!tabId) return await runner();

  const state = getTabLockState(tabId);
  if (state.unlockTimer) {
    clearTimeout(state.unlockTimer);
    state.unlockTimer = null;
  }

  const wasBusy = state.manualLock || state.autoCount > 0;
  state.autoCount++;
  state.currentAction = actionName;

  if (!wasBusy) {
    await sendTabMessageWithRetry(tabId, {
      action: "set_agent_busy",
      busy: true,
      currentAction: actionName
    }).catch(() => {});
  }

  try {
    return await runner();
  } finally {
    state.autoCount = Math.max(0, state.autoCount - 1);
    if (!state.manualLock && state.autoCount === 0) {
      state.unlockTimer = setTimeout(() => {
        state.unlockTimer = null;
        if (!state.manualLock && state.autoCount === 0) {
          sendTabMessageWithRetry(tabId, { action: "set_agent_busy", busy: false }).catch(() => {});
        }
      }, 150);
    }
  }
}
