/**
 * Agent Pilot - Tab & Lock Manager
 * Handles tab resolution, grouping, human input lock shields, and content script injection
 */

import {
  agentControlledTabs,
  tabLockStates,
  getTabLockState,
  AGENT_GROUP_TITLE,
  AGENT_GROUP_COLOR,
  logDebug
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
    } catch (err) {
      logDebug("resolveTabId: lastAgentTabId lookup failed", err);
    }
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
export async function assignTabToAgentGroup(tabOrId) {
  if (!chrome.tabs || !chrome.tabs.group || !tabOrId) return;
  try {
    let tab = typeof tabOrId === "object" ? tabOrId : null;
    if (!tab || !tab.id || !tab.windowId) {
      const tid = typeof tabOrId === "number" ? tabOrId : tabOrId.id;
      if (!tid) return;
      tab = await chrome.tabs.get(tid).catch((err) => {
        logDebug("assignTabToAgentGroup get tab", err);
        return null;
      });
    }
    if (!tab || !tab.id) return;
    if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:"))) {
      return;
    }

    const windowId = tab.windowId;
    let targetGroupId = null;

    if (chrome.tabGroups && chrome.tabGroups.query) {
      try {
        const groups = await chrome.tabGroups.query({ windowId });
        const existing = groups.find((g) => g.title === AGENT_GROUP_TITLE || g.title === "Agent Pilot");
        if (existing) targetGroupId = existing.id;
      } catch (err) {
        logDebug("assignTabToAgentGroup tabGroups.query error", err);
      }
    }

    const groupId = await chrome.tabs.group({
      tabIds: [tab.id],
      groupId: targetGroupId || undefined
    });

    if (chrome.tabGroups && chrome.tabGroups.update && (!targetGroupId || groupId !== targetGroupId)) {
      await chrome.tabGroups.update(groupId, {
        title: AGENT_GROUP_TITLE,
        color: AGENT_GROUP_COLOR
      }).catch((err) => logDebug("tabGroups.update error", err));
    }

    // Display AI badge on extension toolbar icon for this tab
    if (chrome.action && chrome.action.setBadgeText) {
      chrome.action.setBadgeText({ text: "AI", tabId: tab.id }).catch((err) => logDebug("setBadgeText error", err));
      chrome.action.setBadgeBackgroundColor({ color: "#10b981", tabId: tab.id }).catch((err) => logDebug("setBadgeBackgroundColor error", err));
      chrome.action.setTitle({ title: "🤖 Tab đang được AI Agent điều khiển", tabId: tab.id }).catch((err) => logDebug("action.setTitle error", err));
    }
  } catch (err) {
    console.warn("[AgentPilot] Tab grouping note:", err?.message || err);
  }
}

/**
 * Mark a tab as actively controlled by Agent and ensure Chrome Tab Grouping & toolbar badge
 */
export async function markTabAsAgentControlled(tabId) {
  if (!tabId) return;
  agentControlledTabs.add(tabId);
  await assignTabToAgentGroup(tabId).catch((err) => logDebug("markTabAsAgentControlled assignTabToAgentGroup error", err));
}

/**
 * Ensure content script is injected into the tab
 */
export async function ensureContentScript(tabId) {
  if (!tabId) return false;
  try {
    const tab = await chrome.tabs.get(tabId).catch((err) => {
      logDebug(`probe tab ${tabId}`, err);
      return null;
    });
    if (!tab || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:") || tab.url.startsWith("edge://")) {
      return false;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__AGENT_PILOT__)
    }).catch((err) => {
      logDebug(`probe __AGENT_PILOT__ on tab ${tabId}`, err);
      return null;
    });

    if (!results || !results[0] || !results[0].result) {
      // Dynamically extract content script & css files from manifest.json (Single Source of Truth)
      const manifest = (typeof chrome !== "undefined" && chrome.runtime?.getManifest) ? chrome.runtime.getManifest() : null;
      const isolatedEntry = manifest?.content_scripts?.find(cs => cs.js && (!cs.world || cs.world === "ISOLATED"));
      const contentFiles = isolatedEntry?.js || [
        "content/toast.js",
        "content/lock-shield.js",
        "content/cursor-simulator.js",
        "content/dom-inspector.js",
        "content/eyedropper.js",
        "content/feedback-studio/constants.js",
        "content/feedback-studio/state.js",
        "content/feedback-studio/capture-service.js",
        "content/feedback-studio/pinned-overlay.js",
        "content/feedback-studio/hud-toolbar.js",
        "content/feedback-studio/modals.js",
        "content/feedback-studio/selection-modes.js",
        "content/feedback-studio/export-channels.js",
        "content/feedback-studio/index.js",
        "content.js"
      ];
      const cssFiles = isolatedEntry?.css || ["content.css"];

      if (cssFiles.length) {
        await chrome.scripting.insertCSS({ target: { tabId }, files: cssFiles }).catch((err) => {
          logDebug(`insertCSS on tab ${tabId}`, err);
        });
      }
      await chrome.scripting.executeScript({
        target: { tabId },
        files: contentFiles
      }).catch((err) => {
        logDebug(`dynamic script injection on tab ${tabId}`, err);
      });
      await new Promise(r => setTimeout(r, 80));
    }
    return true;
  } catch (e) {
    logDebug(`ensureContentScript(${tabId})`, e);
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
 * Set persistent session mode on a tab
 */
export async function setTabSession(tabId, active, sessionName = "") {
  if (!tabId) return false;
  await markTabAsAgentControlled(tabId);
  const state = getTabLockState(tabId);
  state.sessionActive = Boolean(active);
  state.sessionName = sessionName || (state.sessionActive ? "Session đang hoạt động" : "");
  if (state.unlockTimer) {
    clearTimeout(state.unlockTimer);
    state.unlockTimer = null;
  }

  return await sendTabMessageWithRetry(tabId, {
    action: "set_agent_session",
    active: state.sessionActive,
    sessionName: state.sessionName
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

  const wasBusy = state.sessionActive || state.manualLock || state.autoCount > 0;
  state.autoCount++;
  state.currentAction = actionName;

  // Always notify content script so action description updates live on each step
  await sendTabMessageWithRetry(tabId, {
    action: "set_agent_busy",
    busy: true,
    currentAction: actionName
  }).catch((err) => logDebug("runWithTabLock set_agent_busy error", err));

  try {
    return await runner();
  } finally {
    state.autoCount = Math.max(0, state.autoCount - 1);
    if (state.sessionActive) {
      // During active session, do not hide shield or cursor! Revert to session standby.
      sendTabMessageWithRetry(tabId, {
        action: "set_agent_busy",
        busy: false,
        currentAction: state.sessionName || "Session đang hoạt động (Sẵn sàng)"
      }).catch((err) => logDebug("runWithTabLock session revert error", err));
    } else if (!state.manualLock && state.autoCount === 0) {
      state.unlockTimer = setTimeout(() => {
        state.unlockTimer = null;
        if (!state.sessionActive && !state.manualLock && state.autoCount === 0) {
          sendTabMessageWithRetry(tabId, { action: "set_agent_busy", busy: false }).catch((err) => logDebug("runWithTabLock auto-unlock error", err));
        }
      }, 1200);
    }
  }
}
