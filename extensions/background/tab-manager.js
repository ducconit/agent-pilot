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
  DEFAULT_LOAD_TIMEOUT_MS,
  normalizeUrl,
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
 * Query all active Agent Pilot Tab Group IDs across windows
 */
export async function getAgentGroupIds() {
  if (!chrome.tabGroups || !chrome.tabGroups.query) {
    return new Set();
  }
  try {
    const groups = await chrome.tabGroups.query({});
    const agentGroups = (groups || []).filter(
      (g) => g && (g.title === AGENT_GROUP_TITLE || g.title === "Agent Pilot")
    );
    return new Set(agentGroups.map((g) => g.id));
  } catch (err) {
    logDebug("getAgentGroupIds query error", err);
    return new Set();
  }
}

/**
 * Verify whether a tab belongs to an Agent Pilot tab group or is agent-controlled.
 * Foreign groups and unassigned user tabs return false.
 */
export async function isTabInAgentGroup(tabOrId) {
  if (!tabOrId) return false;
  let tab = typeof tabOrId === "object" ? tabOrId : null;
  const tid = tab ? tab.id : Number(tabOrId);
  if (!tid || isNaN(tid)) return false;

  if ((!tab || typeof tab.groupId === "undefined") && chrome.tabs?.get) {
    tab = await chrome.tabs.get(tid).catch(() => null);
  }
  if (!tab || !tab.id) return false;

  // 1. If the tab belongs to a Chrome Tab Group, verify that the group is actually '🤖 Agent Pilot'
  const hasGroup = tab.groupId !== undefined && tab.groupId !== null && tab.groupId !== -1 && tab.groupId !== chrome.tabGroups?.TAB_GROUP_ID_NONE && tab.groupId > 0;
  if (hasGroup) {
    if (chrome.tabGroups?.get) {
      try {
        const group = await chrome.tabGroups.get(tab.groupId);
        if (group && (group.title === AGENT_GROUP_TITLE || group.title === "Agent Pilot")) {
          agentControlledTabs.add(tab.id);
          return true;
        }
        agentControlledTabs.delete(tid);
        return false;
      } catch (err) {
        logDebug("isTabInAgentGroup tabGroups.get error", err);
      }
    }
    if (chrome.tabGroups?.query) {
      const agentGroupIds = await getAgentGroupIds();
      if (agentGroupIds.has(tab.groupId)) {
        agentControlledTabs.add(tab.id);
        return true;
      }
      agentControlledTabs.delete(tid);
      return false;
    }
  }

  // 2. Tab is not in any group (groupId === -1): only permit if actively created/controlled by the agent
  return agentControlledTabs.has(tid);
}

function isTabAllowedForAgent(tid, options = {}) {
  const { tabOwners = null, agentId = null } = options || {};
  if (tabOwners instanceof Map && agentId) {
    const owner = tabOwners.get(tid);
    if (owner && owner !== agentId) {
      return false;
    }
  }
  return true;
}

/**
 * Get all tabs belonging exclusively to the Agent Pilot group(s)
 */
export async function getAgentGroupTabs() {
  if (chrome.tabGroups && chrome.tabGroups.query) {
    const agentGroupIds = await getAgentGroupIds();
    const allTabs = await new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime.lastError || !tabs) resolve([]);
        else resolve(tabs);
      });
    });

    if (agentGroupIds.size > 0) {
      return (allTabs || []).filter((t) => {
        if (!t || !t.id) return false;
        if (agentGroupIds.has(t.groupId)) return true;
        if (agentControlledTabs.has(t.id) && (!t.groupId || t.groupId === -1 || t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE)) {
          return true;
        }
        return false;
      });
    }

    return (allTabs || []).filter((t) => t && t.id && agentControlledTabs.has(t.id));
  }

  // Fallback when tabGroups is not supported
  const agentTabs = [];
  for (const tid of agentControlledTabs) {
    try {
      const tab = await chrome.tabs.get(tid);
      if (tab && tab.id && (await isTabInAgentGroup(tab))) agentTabs.push(tab);
    } catch (_) {
      agentControlledTabs.delete(tid);
    }
  }
  return agentTabs;
}

/**
 * Find any open tab belonging to the Agent Pilot group (re-hydrating from
 * Chrome Tab Groups if the MV3 service worker restarted).
 * When `tabOwners` and `agentId` are provided, tabs owned by a *different*
 * agent session are skipped so concurrent agents never hijack each other's tabs.
 */
export async function findAnyAgentGroupTab(options = {}) {
  const { tabOwners = null } = options || {};

  const groupTabs = await getAgentGroupTabs();
  if (groupTabs.length > 0) {
    const allowed = groupTabs.filter((t) => t && t.id && isTabAllowedForAgent(t.id, options));
    if (allowed.length > 0) {
      const activeAllowed = allowed.find((t) => t.active);
      return activeAllowed ? activeAllowed.id : allowed[allowed.length - 1].id;
    }
    return null;
  }

  for (const tid of agentControlledTabs) {
    try {
      const tab = await chrome.tabs.get(tid);
      if (tab && tab.id && (await isTabInAgentGroup(tab))) {
        if (isTabAllowedForAgent(tab.id, options)) return tab.id;
      }
    } catch (_) {
      agentControlledTabs.delete(tid);
      if (tabOwners instanceof Map) tabOwners.delete(tid);
    }
  }

  return null;
}

/**
 * Resolve target tab ID strictly within the Agent Pilot tab group.
 * Never falls back to or hijacks a user's personal active tab outside the group,
 * nor hijacks a tab owned by another concurrent agent session.
 */
export async function getTargetTabId(requestedTabId, lastAgentTabId = null, options = {}) {
  // 1. If explicit tab ID was requested by the agent
  if (requestedTabId !== undefined && requestedTabId !== null && requestedTabId !== "") {
    const numId = Number(requestedTabId);
    if (isNaN(numId) || numId <= 0) return null;

    try {
      const tab = await chrome.tabs.get(numId);
      if (!tab || !tab.id) return null;

      const isAllowed = await isTabInAgentGroup(tab);
      if (!isAllowed) {
        logDebug(`[Security] Target tab ${numId} denied: not in Agent Pilot group`);
        throw new Error(`Access denied: Tab ${numId} does not belong to the Agent Pilot tab group ('${AGENT_GROUP_TITLE}'). Operations on other tabs or groups are prohibited.`);
      }
      return tab.id;
    } catch (err) {
      if (err && err.message && err.message.startsWith("Access denied")) {
        throw err;
      }
      return null;
    }
  }

  // 2. If no tab ID requested, find the most appropriate tab strictly within the Agent Pilot group
  if (lastAgentTabId) {
    try {
      const tab = await chrome.tabs.get(lastAgentTabId);
      if (tab && tab.id && (await isTabInAgentGroup(tab)) && isTabAllowedForAgent(tab.id, options)) {
        return tab.id;
      }
    } catch (err) {
      logDebug("resolveTabId: lastAgentTabId lookup failed", err);
    }
  }

  if (options && options.allowFallback === false) {
    return null;
  }

  return await findAnyAgentGroupTab(options);
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

const contentScriptEnsures = new Map();

/**
 * Ensure content script is injected into the tab
 */
export function ensureContentScript(tabId) {
  if (!tabId) return Promise.resolve(false);
  const existing = contentScriptEnsures.get(tabId);
  if (existing) return existing;
  const task = ensureContentScriptInner(tabId).finally(() => {
    contentScriptEnsures.delete(tabId);
  });
  contentScriptEnsures.set(tabId, task);
  return task;
}

async function ensureContentScriptInner(tabId) {
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
        "content/config.js",
        "content/toast.js",
        "content/lock-shield.js",
        "content/cursor-simulator.js",
        "content/cursor-form.js",
        "content/cursor-wait.js",
        "content/selector-utils.js",
        "content/dom-inspector.js",
        "content/eyedropper.js",
        "content/feedback-studio/constants.js",
        "content/feedback-studio/item-schema.js",
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

      const mainEntry = manifest?.content_scripts?.find(cs => cs.js && cs.world === "MAIN");
      const mainFiles = mainEntry?.js || ["main-world-bridge.js"];

      if (cssFiles.length) {
        await chrome.scripting.insertCSS({ target: { tabId }, files: cssFiles }).catch((err) => {
          logDebug(`insertCSS on tab ${tabId}`, err);
        });
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: contentFiles
        });
      } catch (err) {
        logDebug(`dynamic script injection on tab ${tabId}`, err);
        return false;
      }
      if (mainFiles.length) {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          files: mainFiles
        }).catch((err) => {
          logDebug(`main world script injection on tab ${tabId}`, err);
        });
      }
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

// Clean up agentControlledTabs when tabs are ungrouped
if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.groupId !== undefined && changeInfo.groupId === -1) {
      agentControlledTabs.delete(tabId);
    }
  });
}

/**
 * Create a tab via chrome.tabs.create, automatically falling back to
 * chrome.windows.create when Chrome has no open browser window ("No current window").
 */
export function createTabWithWindowFallback(url, makeActive = false) {
  return new Promise((resolve, reject) => {
    const tryWindowCreate = (originalErr) => {
      if (typeof chrome === "undefined" || !chrome.windows || typeof chrome.windows.create !== "function") {
        reject(originalErr instanceof Error ? originalErr : new Error(originalErr?.message || String(originalErr)));
        return;
      }
      chrome.windows.create({ url, focused: Boolean(makeActive) }, (win) => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const firstTab = win && Array.isArray(win.tabs) && win.tabs.length > 0 ? win.tabs[0] : null;
        if (firstTab) {
          resolve(firstTab);
        } else {
          reject(originalErr instanceof Error ? originalErr : new Error(originalErr?.message || "Failed to create tab in new window"));
        }
      });
    };

    chrome.tabs.create({ url, active: Boolean(makeActive) }, (tab) => {
      if (chrome.runtime?.lastError) {
        const msg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
        if (/no current window|no last-focused window/i.test(msg)) {
          tryWindowCreate(new Error(msg));
          return;
        }
        reject(new Error(msg));
        return;
      }
      resolve(tab);
    });
  });
}

/**
 * Wait until the given tab reports status === "complete" or timeout elapses.
 */
export function waitForTabComplete(tabId, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.tabs?.onUpdated?.addListener) {
      resolve();
      return;
    }
    let finished = false;
    const isTabLoaded = (tab) => {
      if (!tab) return false;
      if (tab.status === undefined) return true;
      if (tab.status !== "complete") return false;
      if (tab.pendingUrl && (!tab.url || tab.url === "about:blank")) return false;
      return true;
    };
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (chrome.tabs?.onUpdated?.removeListener) {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      }
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const onUpdated = (tId, changeInfo, tab) => {
      if (tId === tabId && changeInfo.status === "complete") {
        if (!tab || !tab.pendingUrl || (tab.url && tab.url !== "about:blank")) {
          done();
        }
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    if (chrome.tabs?.get) {
      try {
        const maybePromise = chrome.tabs.get(tabId, (tab) => {
          if (!chrome.runtime?.lastError && isTabLoaded(tab)) {
            done();
          }
        });
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then((tab) => {
            if (isTabLoaded(tab)) {
              done();
            }
          }).catch(() => {});
        }
      } catch (_) {
        done();
      }
    } else {
      done();
    }
  });
}

/**
 * Navigate tabId to targetUrl via chrome.tabs.update and wait for load completion.
 */
export function navigateTabAndWait(tabId, targetUrl, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS, { requireNewLoad = false } = {}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let sawLoading = false;
    const done = (err = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (chrome.tabs?.onUpdated) {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      }
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => done(), timeoutMs);
    const onUpdated = (tId, changeInfo, tab) => {
      if (tId !== tabId) return;
      if (changeInfo.status === "loading") {
        sawLoading = true;
      }
      if (changeInfo.status === "complete") {
        if (!requireNewLoad || sawLoading || !tab?.url || normalizeUrl(tab.url) === normalizeUrl(targetUrl)) {
          done();
        }
      }
    };
    if (chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener(onUpdated);
    }
    chrome.tabs.update(tabId, { url: targetUrl }, (t) => {
      if (chrome.runtime.lastError) {
        done(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!requireNewLoad && t && t.status === "complete") {
        done();
      }
    });
  });
}
