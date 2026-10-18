/**
 * Agent Pilot - Persistent Cross-Page Flow Recorder & Replay Engine
 *
 * Maintains per-tab user interaction flows across full-page reloads and MPA/SPA
 * navigations in the Background Service Worker. Supports both:
 *  - Passive Breadcrumbs mode (rolling window of last 20 steps for QA bug reports)
 *  - Active Recording mode (explicit Start/Pause recording up to 100 steps)
 *  - Live 1-click Replay on the target tab with virtual cursor & navigation wait
 *  - Export to Agent Pilot Batch JSON and Playwright (.spec.ts) test scripts
 */

import { DEFAULT_LOAD_TIMEOUT_MS, normalizeUrl } from "./constants.js";
import { ensureContentScript, markTabAsAgentControlled, sendTabMessageWithRetry } from "./tab-manager.js";

const MAX_PASSIVE_STEPS = 100;
const MAX_ACTIVE_STEPS = 100;
const STEP_DEDUPE_WINDOW_MS = 800;

/** @type {Map<number, { recording: boolean, replaying: boolean, steps: Array<object>, lastUrl: string, nextSeq: number }>} */
export const tabFlowSessions = new Map();

/**
 * Retains the most recently recorded non-empty flow so that if the original tab
 * is closed (e.g. after a test run or by the user), clicking Replay or Export
 * can still automatically open a new tab and replay/export the recorded flow.
 */
const lastRecordedFlow = {
  steps: [],
  lastUrl: ""
};

let broadcastFn = null;

export function initFlowRecorder(broadcastCallback) {
  broadcastFn = typeof broadcastCallback === "function" ? broadcastCallback : null;
}

function syncLastRecordedSnapshot(session) {
  if (!session) return;
  if (Array.isArray(session.steps) && session.steps.length > 0) {
    lastRecordedFlow.steps = session.steps.map((s) => ({ ...s }));
    lastRecordedFlow.lastUrl = session.lastUrl || session.steps.find((s) => s.url)?.url || lastRecordedFlow.lastUrl || "";
  }
}

function notifyFlowUpdate(tabId, extra = {}) {
  if (!broadcastFn) return;
  const session = tabId ? getOrCreateFlowSession(tabId) : { recording: false, replaying: false, steps: lastRecordedFlow.steps };
  syncLastRecordedSnapshot(session);
  broadcastFn({
    type: "FLOW_RECORDER_UPDATED",
    tabId,
    recording: session.recording,
    replaying: session.replaying,
    steps: (session.steps && session.steps.length > 0 ? session.steps : lastRecordedFlow.steps).slice(),
    ...extra
  });
}

export function getOrCreateFlowSession(tabId) {
  if (!tabFlowSessions.has(tabId)) {
    tabFlowSessions.set(tabId, {
      recording: false,
      replaying: false,
      steps: [],
      lastUrl: "",
      nextSeq: 1
    });
  }
  return tabFlowSessions.get(tabId);
}

export function removeFlowSession(tabId) {
  if (tabFlowSessions.has(tabId)) {
    syncLastRecordedSnapshot(tabFlowSessions.get(tabId));
    tabFlowSessions.delete(tabId);
  }
}

export function getFlowState(tabId) {
  if (!tabId) {
    return {
      recording: false,
      replaying: false,
      steps: lastRecordedFlow.steps.slice()
    };
  }
  const session = getOrCreateFlowSession(tabId);
  const steps = session.steps.length > 0 ? session.steps.slice() : lastRecordedFlow.steps.slice();
  return {
    recording: session.recording,
    replaying: session.replaying,
    steps
  };
}

function isScriptableWebUrl(url) {
  return Boolean(
    url &&
      typeof url === "string" &&
      (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://"))
  );
}

/**
 * Verify that `tabId` exists and is a scriptable web tab.
 * If the tab was closed, does not exist, or is on a restricted page (e.g. chrome://),
 * automatically create a new tab in the Agent Pilot group at `initialUrl`.
 */
export async function ensurePlayableTab(tabId, initialUrl = "") {
  let existingTab = null;
  if (tabId && chrome.tabs?.get) {
    try {
      existingTab = await chrome.tabs.get(Number(tabId));
    } catch (_) {
      existingTab = null;
    }
  }

  if (existingTab && existingTab.id && isScriptableWebUrl(existingTab.url)) {
    return {
      tabId: existingTab.id,
      createdNewTab: false,
      url: existingTab.url
    };
  }

  const targetUrl = normalizeUrl(initialUrl || lastRecordedFlow.lastUrl || "https://www.google.com");

  // If the tab exists (e.g. chrome://newtab or about:blank), only create a new tab so we never overwrite a user's personal tab
  if (!chrome.tabs?.create) {
    throw new Error("Chrome Tabs API không khả dụng để mở tab mới");
  }

  const createdTab = await new Promise((resolve, reject) => {
    chrome.tabs.create({ url: targetUrl, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.id) {
        reject(new Error(chrome.runtime.lastError?.message || "Không thể tạo tab mới để chạy kịch bản"));
      } else {
        resolve(tab);
      }
    });
  });

  await markTabAsAgentControlled(createdTab.id).catch(() => {});
  await waitForTabComplete(createdTab.id, 12000);
  await delay(300);

  return {
    tabId: createdTab.id,
    createdNewTab: true,
    url: targetUrl
  };
}

const EPHEMERAL_QUERY_PARAMS = new Set([
  "mstk",
  "mtid",
  "sxsrf",
  "ei",
  "ved",
  "iflsig",
  "gs_lp",
  "sca_esv",
  "csuir",
  "aep",
  "source",
  "oq",
  "sclient",
  "cs",
  "_",
  "ts"
]);

/**
 * Compute a canonical URL key that ignores ephemeral SPA/search tracking & streaming tokens
 * (such as Google AI Mode's `mstk`, `mtid`, `sxsrf`, `ved`, `ei`).
 */
export function getCanonicalNavKey(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  try {
    const u = new URL(rawUrl);
    const kept = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (EPHEMERAL_QUERY_PARAMS.has(k.toLowerCase())) continue;
      kept.push(`${k}=${v}`);
    }
    kept.sort();
    return `${u.origin}${u.pathname}${kept.length ? "?" + kept.join("&") : ""}`;
  } catch (_) {
    return rawUrl;
  }
}

/**
 * Append a step to the tab's flow session (with deduplication and capacity limits).
 */
export function appendFlowStep(tabId, rawStep) {
  if (!tabId || !rawStep || !rawStep.action) return null;
  const session = getOrCreateFlowSession(tabId);
  if (session.replaying) return null;

  const now = Date.now();

  // In Passive Mode, ensure the very first recorded interaction preserves its exact starting page URL at index 0
  if (session.steps.length === 0 && rawStep.action !== "navigate" && rawStep.url && isScriptableWebUrl(rawStep.url)) {
    session.lastUrl = String(rawStep.url);
    session.steps.push({
      id: `step_${session.nextSeq++}`,
      action: "navigate",
      url: String(rawStep.url),
      description: `Mở trang ${rawStep.url}`,
      timestamp: now
    });
  }

  let prev = session.steps[session.steps.length - 1];

  // If user clicked a generic wrapper div/span (e.g. div.esoFne) immediately before typing into an input/textarea,
  // drop the redundant wrapper click because `type` already focuses and clicks the input/textarea.
  if (
    rawStep.action === "type" &&
    prev &&
    prev.action === "click" &&
    (prev.tagName === "div" || prev.tagName === "span" || prev.tagName === "form") &&
    !prev.label &&
    now - prev.timestamp < 5000
  ) {
    session.steps.pop();
    prev = session.steps[session.steps.length - 1];
  }

  // Deduplicate rapid identical steps (or consecutive input/change/navigate)
  if (prev && prev.action === rawStep.action) {
    if (rawStep.action === "navigate") {
      if (
        prev.url === rawStep.url ||
        getCanonicalNavKey(prev.url) === getCanonicalNavKey(rawStep.url) ||
        now - prev.timestamp < 2000
      ) {
        prev.url = rawStep.url || prev.url;
        prev.description = rawStep.description || prev.description;
        prev.timestamp = now;
        notifyFlowUpdate(tabId);
        return prev;
      }
    }
    if (
      rawStep.action !== "navigate" &&
      prev.selector === rawStep.selector &&
      getCanonicalNavKey(prev.url) === getCanonicalNavKey(rawStep.url)
    ) {
      // If user typed into the same input or double-triggered change within window, update in place
      if (
        (rawStep.action === "type" || rawStep.action === "select") ||
        (prev.value === rawStep.value && now - prev.timestamp < STEP_DEDUPE_WINDOW_MS)
      ) {
        // However, if there was a press_key(Enter) in between, `prev` would be press_key, not type.
        // So consecutive `type` events without `Enter` in between are typing characters into the same field.
        prev.value = rawStep.value;
        prev.description = rawStep.description || prev.description;
        prev.playwrightLocator = rawStep.playwrightLocator || prev.playwrightLocator;
        prev.timestamp = now;
        notifyFlowUpdate(tabId);
        return prev;
      }
    }
  }

  const maxSteps = session.recording ? MAX_ACTIVE_STEPS : MAX_PASSIVE_STEPS;
  if (session.steps.length >= maxSteps) {
    // Keep step[0] if it's the initial navigate step, and shift step[1] instead
    if (session.steps.length > 1 && session.steps[0].action === "navigate") {
      session.steps.splice(1, 1);
    } else {
      session.steps.shift();
    }
  }

  const step = {
    id: `step_${session.nextSeq++}`,
    action: String(rawStep.action),
    tagName: rawStep.tagName ? String(rawStep.tagName) : undefined,
    selector: rawStep.selector ? String(rawStep.selector) : undefined,
    playwrightLocator: rawStep.playwrightLocator ? String(rawStep.playwrightLocator) : undefined,
    label: rawStep.label ? String(rawStep.label) : undefined,
    value: rawStep.value !== undefined ? String(rawStep.value) : undefined,
    key: rawStep.key ? String(rawStep.key) : undefined,
    url: rawStep.url ? String(rawStep.url) : session.lastUrl || undefined,
    description: String(rawStep.description || `${rawStep.action} ${rawStep.selector || rawStep.url || ""}`).trim(),
    timestamp: now
  };

  if (step.url) {
    session.lastUrl = step.url;
  }

  session.steps.push(step);
  notifyFlowUpdate(tabId);
  return step;
}

/**
 * Record cross-page navigation when a tab's URL changes.
 * Ignores SPA `history.replaceState` / `pushState` tracking token updates (e.g. Google `mstk`, `mtid`, `sxsrf`).
 */
export function recordTabNavigation(tabId, newUrl) {
  if (!tabId || !newUrl) return;
  if (!isScriptableWebUrl(newUrl)) {
    return;
  }
  const session = getOrCreateFlowSession(tabId);
  if (session.replaying) return;

  if (session.lastUrl === newUrl) return;
  const prevCanonical = getCanonicalNavKey(session.lastUrl);
  const nextCanonical = getCanonicalNavKey(newUrl);
  const isFirstUrl = !session.lastUrl && session.steps.length === 0;
  session.lastUrl = newUrl;

  // Ignore pure tracking/streaming parameter updates on the same canonical URL (e.g. Google AI Mode mstk/mtid updates)
  if (prevCanonical && prevCanonical === nextCanonical) {
    return;
  }

  // Record explicit navigate step if actively recording, or if transitioning from a previous page with steps
  if (session.recording || (!isFirstUrl && session.steps.length > 0)) {
    appendFlowStep(tabId, {
      action: "navigate",
      url: newUrl,
      description: `Chuyển trang tới ${newUrl}`
    });
  }
}

/**
 * Start or pause active flow recording on a tab.
 * If starting recording when no valid web tab exists, automatically opens a new tab.
 */
export async function setFlowRecording(tabId, enabled, initialUrl = "") {
  let activeTabId = tabId;
  let createdNewTab = false;
  let currentUrl = initialUrl;

  if (enabled) {
    try {
      const resolved = await ensurePlayableTab(tabId, initialUrl);
      activeTabId = resolved.tabId;
      createdNewTab = resolved.createdNewTab;
      if (!currentUrl) currentUrl = resolved.url;
    } catch (err) {
      if (!activeTabId) {
        return { success: false, error: err?.message || "Missing tabId" };
      }
    }
  } else if (!activeTabId) {
    return { success: false, error: "Missing tabId" };
  }

  const session = getOrCreateFlowSession(activeTabId);
  const wasRecording = session.recording;
  session.recording = Boolean(enabled);

  if (!currentUrl && chrome.tabs?.get) {
    try {
      const tab = await chrome.tabs.get(activeTabId);
      currentUrl = tab?.url || "";
    } catch (_) {}
  }

  if (session.recording && !wasRecording) {
    // Starting a new explicit recording: clear old passive breadcrumb steps so we start cleanly from `currentUrl`
    session.steps = [];
    session.nextSeq = 1;
    if (currentUrl) {
      session.lastUrl = currentUrl;
      session.steps.push({
        id: `step_${session.nextSeq++}`,
        action: "navigate",
        url: currentUrl,
        description: `Mở trang ${currentUrl}`,
        timestamp: Date.now()
      });
    }
  }

  notifyFlowUpdate(activeTabId);
  return {
    success: true,
    tabId: activeTabId,
    createdNewTab,
    recording: session.recording,
    replaying: session.replaying,
    steps: session.steps.slice()
  };
}

/**
 * Delete a single step by ID.
 */
export function deleteFlowStep(tabId, stepId) {
  if (!stepId) return { success: false, error: "Missing stepId" };
  if (tabId && tabFlowSessions.has(tabId)) {
    const session = getOrCreateFlowSession(tabId);
    session.steps = session.steps.filter((s) => s.id !== stepId);
    lastRecordedFlow.steps = lastRecordedFlow.steps.filter((s) => s.id !== stepId);
    notifyFlowUpdate(tabId);
    return {
      success: true,
      recording: session.recording,
      steps: session.steps.slice()
    };
  }
  lastRecordedFlow.steps = lastRecordedFlow.steps.filter((s) => s.id !== stepId);
  return {
    success: true,
    recording: false,
    steps: lastRecordedFlow.steps.slice()
  };
}

export function clearFlowSteps(tabId) {
  lastRecordedFlow.steps = [];
  lastRecordedFlow.lastUrl = "";
  if (!tabId) {
    return { success: true, recording: false, steps: [] };
  }
  const session = getOrCreateFlowSession(tabId);
  session.steps = [];
  notifyFlowUpdate(tabId);
  return {
    success: true,
    recording: session.recording,
    steps: []
  };
}

function resolveStepsForExportOrReplay(tabId, fallbackSteps = null) {
  if (tabId && tabFlowSessions.has(tabId)) {
    const session = tabFlowSessions.get(tabId);
    if (session.steps.length > 0) {
      return { steps: session.steps.slice(), lastUrl: session.lastUrl };
    }
  }
  if (Array.isArray(fallbackSteps) && fallbackSteps.length > 0) {
    return {
      steps: fallbackSteps.slice(),
      lastUrl: fallbackSteps.find((s) => s.url)?.url || lastRecordedFlow.lastUrl
    };
  }
  return {
    steps: lastRecordedFlow.steps.slice(),
    lastUrl: lastRecordedFlow.lastUrl
  };
}

/**
 * Convert recorded steps into Agent Pilot Batch JSON format.
 */
export function exportFlowAsBatch(tabId, fallbackUrl = "", fallbackTitle = "", fallbackSteps = null) {
  const { steps, lastUrl } = resolveStepsForExportOrReplay(tabId, fallbackSteps);
  const actions = steps.map((step) => {
    if (step.action === "navigate") {
      return {
        action: "navigate",
        url: step.url
      };
    }
    if (step.action === "type" || step.action === "select") {
      return {
        action: "type",
        selector: step.selector,
        text: step.value === "[REDACTED]" ? "<SENSITIVE_VALUE>" : (step.value || ""),
        clear: true
      };
    }
    if (step.action === "press_key") {
      return {
        action: "press_key",
        selector: step.selector,
        key: step.key || "Enter"
      };
    }
    return {
      action: "click",
      selector: step.selector
    };
  });

  const startUrl = steps.find((s) => s.url)?.url || lastUrl || fallbackUrl;
  return {
    url: startUrl,
    title: fallbackTitle || undefined,
    generatedAt: new Date().toISOString(),
    actions
  };
}

/**
 * Convert recorded steps into a ready-to-run Playwright (.spec.ts) test script.
 */
export function exportFlowAsPlaywright(tabId, fallbackUrl = "", fallbackSteps = null) {
  const { steps, lastUrl } = resolveStepsForExportOrReplay(tabId, fallbackSteps);
  const lines = [
    "import { test, expect } from '@playwright/test';",
    "",
    "test('Recorded QA Flow', async ({ page }) => {"
  ];

  const firstStep = steps[0];
  const initialUrl = (firstStep && firstStep.url) || lastUrl || fallbackUrl;
  if (initialUrl && (!firstStep || firstStep.action !== "navigate")) {
    lines.push(`  await page.goto(${JSON.stringify(initialUrl)});`);
  }

  for (const step of steps) {
    const locatorExpr = step.playwrightLocator || (step.selector ? `page.locator(${JSON.stringify(step.selector)})` : "page");
    if (step.action === "navigate" && step.url) {
      lines.push(`  await page.goto(${JSON.stringify(step.url)});`);
    } else if (step.action === "click") {
      lines.push(`  await ${locatorExpr}.click();`);
    } else if (step.action === "select") {
      const val = step.value === "[REDACTED]" ? "<SENSITIVE_VALUE>" : (step.value || "");
      lines.push(`  await ${locatorExpr}.selectOption(${JSON.stringify(val)});`);
    } else if (step.action === "type") {
      const val = step.value === "[REDACTED]" ? "<SENSITIVE_VALUE>" : (step.value || "");
      if (val === "checked") {
        lines.push(`  await ${locatorExpr}.check();`);
      } else if (val === "unchecked") {
        lines.push(`  await ${locatorExpr}.uncheck();`);
      } else {
        lines.push(`  await ${locatorExpr}.fill(${JSON.stringify(val)});`);
      }
    } else if (step.action === "press_key") {
      const key = step.key || "Enter";
      lines.push(`  await ${locatorExpr}.press(${JSON.stringify(key)});`);
    }
  }

  lines.push("});");
  return lines.join("\n");
}

function navigateAndWaitForComplete(tabId, targetUrl, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS) {
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
      if (changeInfo.status === "complete" && (sawLoading || !tab?.url || normalizeUrl(tab.url) === normalizeUrl(targetUrl))) {
        done();
      }
    };
    if (chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener(onUpdated);
    }
    chrome.tabs.update(tabId, { url: targetUrl }, () => {
      if (chrome.runtime.lastError) {
        done(new Error(chrome.runtime.lastError.message));
      }
    });
  });
}

function waitForTabComplete(tabId, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (chrome.tabs?.onUpdated) {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      }
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const onUpdated = (tId, changeInfo) => {
      if (tId === tabId && changeInfo.status === "complete") {
        done();
      }
    };
    if (chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener(onUpdated);
    }
    if (chrome.tabs?.get) {
      chrome.tabs.get(tabId, (tab) => {
        if (!chrome.runtime.lastError && tab && tab.status === "complete") {
          done();
        }
      });
    } else {
      done();
    }
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Send a step message to the content script, polling up to `maxWaitMs` if the element
 * is still being rendered asynchronously by a SPA (e.g. Google AI Mode).
 */
async function sendStepMessageWithAutoWait(tabId, payload, maxWaitMs = 4500) {
  const start = Date.now();
  let lastRes = null;
  while (Date.now() - start < maxWaitMs) {
    await ensureContentScript(tabId);
    lastRes = await sendTabMessageWithRetry(tabId, payload);
    if (lastRes && lastRes.success) {
      return lastRes;
    }
    const errText = String(lastRes?.error || "");
    if (!errText.includes("not found") && !errText.includes("No element")) {
      break;
    }
    await delay(300);
  }
  return lastRes;
}

/**
 * Replay all recorded steps sequentially on the target tab with visual virtual cursor.
 * If `tabId` is missing, closed, or on a non-web page, automatically creates a new tab
 * in the '🤖 Agent Pilot' group at the flow's starting URL and replays there.
 */
export async function replayRecordedFlow(tabId, fallbackSteps = null) {
  const resolvedFlow = resolveStepsForExportOrReplay(tabId, fallbackSteps);
  const steps = resolvedFlow.steps;
  if (steps.length === 0) {
    return { success: false, error: "Chưa có bước thao tác nào để chạy Replay" };
  }

  const startUrl = steps.find((s) => s.url)?.url || resolvedFlow.lastUrl || "https://www.google.com";
  let activeTabId = tabId;
  let createdNewTab = false;

  try {
    const ensured = await ensurePlayableTab(tabId, startUrl);
    activeTabId = ensured.tabId;
    createdNewTab = ensured.createdNewTab;
  } catch (err) {
    return {
      success: false,
      error: err?.message || "Không thể mở tab mới để chạy Replay",
      executedSteps: 0,
      totalSteps: steps.length
    };
  }

  const session = getOrCreateFlowSession(activeTabId);
  if (session.replaying) {
    return { success: false, error: "Kịch bản đang được chạy Replay trên tab này" };
  }
  if (session.steps.length === 0) {
    session.steps = steps.slice();
    session.lastUrl = startUrl;
  }

  session.replaying = true;
  notifyFlowUpdate(activeTabId, { replayStepIndex: 0 });

  let executed = 0;
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Ensure tab wasn't closed mid-replay; if it was, re-create it automatically
      const liveTabEnsure = await ensurePlayableTab(activeTabId, step.url || startUrl);
      if (liveTabEnsure.tabId !== activeTabId) {
        session.replaying = false;
        activeTabId = liveTabEnsure.tabId;
        createdNewTab = true;
        const newSession = getOrCreateFlowSession(activeTabId);
        newSession.steps = steps.slice();
        newSession.lastUrl = step.url || startUrl;
        newSession.replaying = true;
      }

      notifyFlowUpdate(activeTabId, { replayStepIndex: i, currentReplayStepId: step.id });

      if (step.action === "navigate" && step.url) {
        const targetUrl = normalizeUrl(step.url);
        let currentTab = null;
        try {
          currentTab = await chrome.tabs.get(activeTabId);
        } catch (_) {}

        let currentUrl = normalizeUrl(currentTab?.url || "");
        let sameCanonical = currentUrl && getCanonicalNavKey(currentUrl) === getCanonicalNavKey(targetUrl);

        // If preceded by a click (e.g. clicking an <a href="..."> SPA link), give the SPA router up to 1.2s to transition naturally without forcing a full browser reload
        if (!sameCanonical && i > 0 && steps[i - 1]?.action === "click" && chrome.tabs?.get) {
          const waitStart = Date.now();
          while (Date.now() - waitStart < 1200) {
            await delay(150);
            try {
              currentTab = await chrome.tabs.get(activeTabId);
              currentUrl = normalizeUrl(currentTab?.url || "");
              if (currentUrl && getCanonicalNavKey(currentUrl) === getCanonicalNavKey(targetUrl)) {
                sameCanonical = true;
                break;
              }
            } catch (_) {
              break;
            }
          }
        }

        const alreadyLoadedOnNewTab = createdNewTab && i === 0 && sameCanonical;

        // Skip redundant SPA query-token or link-triggered navigations if the page already reached targetUrl
        if (!alreadyLoadedOnNewTab && (!sameCanonical || (i === 0 && !createdNewTab && currentUrl !== targetUrl))) {
          await navigateAndWaitForComplete(activeTabId, targetUrl, 12000);
          await delay(350);
        } else {
          await delay(250);
        }
        executed++;
        continue;
      }

      await waitForTabComplete(activeTabId, 8000);

      const fallbackHints = {
        label: step.label || "",
        tagName: step.tagName || "",
        action: step.action || ""
      };

      if (step.action === "click") {
        // Skip wrapper div/span clicks without label if the next non-navigate step is a type step
        const nextActionStep = steps.slice(i + 1).find((s) => s.action !== "navigate");
        if (
          (step.tagName === "div" || step.tagName === "span") &&
          !step.label &&
          nextActionStep &&
          nextActionStep.action === "type"
        ) {
          executed++;
          continue;
        }

        const res = await sendStepMessageWithAutoWait(
          activeTabId,
          {
            action: "click_cursor",
            selector: step.selector,
            fallbackHints
          },
          3500
        );
        if (!res || !res.success) {
          // If there are remaining steps and this was an obfuscated intermediate click, continue gracefully
          if (i < steps.length - 1) {
            executed++;
            continue;
          }
          throw new Error(res?.error || `Không tìm thấy phần tử để click: ${step.selector}`);
        }
        executed++;
        await delay(400);
      } else if (step.action === "type" || step.action === "select") {
        const textVal = step.value || step.text || "";
        if (textVal === "[REDACTED]" || textVal === "<SENSITIVE_VALUE>") {
          executed++;
          continue;
        }

        // Check if this `type` step should auto-press Enter (e.g. when consecutive `type` steps target the same chat/search box without an explicit press_key step)
        const nextInteractive = steps.slice(i + 1).find((s) => s.action !== "navigate");
        const isSearchOrChatBox =
          step.tagName === "textarea" ||
          /ask anything|search|tìm kiếm|name="q"/i.test( `${step.selector || ""} ${step.label || ""}`);
        const autoPressEnter =
          step.action === "type" &&
          (!nextInteractive ||
            (nextInteractive.action === "type" && nextInteractive.selector === step.selector)) &&
          isSearchOrChatBox &&
          steps[i + 1]?.action !== "press_key";

        const res = await sendStepMessageWithAutoWait(
          activeTabId,
          {
            action: "type_text",
            selector: step.selector,
            text: textVal,
            clear: true,
            pressEnter: autoPressEnter,
            fallbackHints
          },
          4500
        );
        if (!res || !res.success) {
          throw new Error(res?.error || `Không thể nhập dữ liệu vào: ${step.selector}`);
        }
        executed++;
        await delay(autoPressEnter ? 1200 : 300);
      } else if (step.action === "press_key") {
        const res = await sendStepMessageWithAutoWait(
          activeTabId,
          {
            action: "type_text",
            selector: step.selector,
            text: "",
            pressEnter: (step.key || "Enter") === "Enter",
            fallbackHints
          },
          3500
        );
        if (!res || !res.success) {
          throw new Error(res?.error || `Không thể nhấn phím ${step.key || "Enter"} tại: ${step.selector}`);
        }
        executed++;
        await delay(1000);
      }
    }

    return {
      success: true,
      tabId: activeTabId,
      createdNewTab,
      executedSteps: executed,
      totalSteps: steps.length
    };
  } catch (err) {
    return {
      success: false,
      tabId: activeTabId,
      createdNewTab,
      error: err?.message || String(err),
      executedSteps: executed,
      totalSteps: steps.length
    };
  } finally {
    const finalSession = getOrCreateFlowSession(activeTabId);
    finalSession.replaying = false;
    notifyFlowUpdate(activeTabId, { replayStepIndex: -1, currentReplayStepId: null });
  }
}
