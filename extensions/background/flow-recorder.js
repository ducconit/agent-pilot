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

import { normalizeUrl } from "./constants.js";
import { sanitizeDataWithMeta } from "./secret-sanitizer.js";
import {
  markTabAsAgentControlled,
  sendTabMessageWithRetry,
  waitForTabComplete,
  navigateTabAndWait
} from "./tab-manager.js";

const MAX_PASSIVE_STEPS = 20;
const MAX_ACTIVE_STEPS = 100;
const STEP_DEDUPE_WINDOW_MS = 800;
const FLOW_STORAGE_KEY = "agentPilotFlowRecorderV1";
const FLOW_SNAPSHOT_STORAGE_KEY = "agentPilotFlowRecorderSnapshotV1";
const MAX_STEP_ID_LENGTH = 200;

/** @type {Map<number, { recording: boolean, replaying: boolean, steps: Array<object>, lastUrl: string, nextSeq: number }>} */
export const tabFlowSessions = new Map();

/**
 * Retains the most recently recorded non-empty flow so that if the original tab
 * is closed (e.g. after a test run or by the user), clicking Replay or Export
 * can still automatically open a new tab and replay/export the recorded flow.
 */
const lastRecordedFlow = {
  title: "Agent Pilot flow",
  steps: [],
  lastUrl: "",
  tabId: null,
  fromActiveRecording: false,
  recorderMetadata: {}
};

let broadcastFn = null;
let flowHydrationPromise = null;
let flowHydrated = false;
let persistQueue = Promise.resolve();
let persistScheduled = false;
let persistDirty = false;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function storageArea(areaName) {
  return globalThis.chrome?.storage?.[areaName] || null;
}

function storageGet(area, key) {
  if (!area?.get) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const resolveOnce = finish(resolve);
    const rejectOnce = finish(reject);
    try {
      const result = area.get(key, (items) => {
        const error = globalThis.chrome?.runtime?.lastError;
        if (error) rejectOnce(new Error(error.message));
        else resolveOnce(items?.[key] ?? null);
      });
      if (result && typeof result.then === "function") {
        result.then((items) => resolveOnce(items?.[key] ?? null), rejectOnce);
      }
    } catch (error) {
      rejectOnce(error);
    }
  });
}

function storageSet(area, values) {
  if (!area?.set) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const resolveOnce = finish(resolve);
    const rejectOnce = finish(reject);
    try {
      const result = area.set(values, () => {
        const error = globalThis.chrome?.runtime?.lastError;
        if (error) rejectOnce(new Error(error.message));
        else resolveOnce();
      });
      if (result && typeof result.then === "function") result.then(resolveOnce, rejectOnce);
    } catch (error) {
      rejectOnce(error);
    }
  });
}

function validStoredSession(value) {
  return value && Number.isInteger(Number(value.tabId)) && Number(value.tabId) > 0 && Array.isArray(value.steps) &&
    value.steps.length <= MAX_ACTIVE_STEPS;
}

function storageSafeFlow(value) {
  const copy = cloneJson(value);
  const redactSensitiveInput = (step) => {
    const clue = [step.selector, step.label, step.tagName, JSON.stringify(step.recorder || {})].filter(Boolean).join(" ");
    if (!/(?:password|passcode|secret|api[_-]?key|access[_-]?token|auth[_-]?token|credential)/i.test(clue)) return;
    if (step.value !== undefined) step.value = "[REDACTED]";
    if (step.recorder && step.recorder.value !== undefined) step.recorder.value = "[REDACTED]";
  };
  for (const session of copy.sessions || []) for (const step of session.steps || []) redactSensitiveInput(step);
  for (const step of copy.snapshot?.steps || []) redactSensitiveInput(step);
  return sanitizeDataWithMeta(copy, true).data;
}

function buildPersistedFlowState() {
  const sessions = [...tabFlowSessions.entries()].map(([tabId, session]) => ({
    tabId: Number(tabId),
    title: String(session.title || "Agent Pilot flow").slice(0, 200),
    recording: Boolean(session.recording),
    steps: session.steps.slice(-MAX_ACTIVE_STEPS).map((step) => ({ ...step })),
    lastUrl: String(session.lastUrl || ""),
    nextSeq: Math.max(1, Number(session.nextSeq) || 1),
    recorderMetadata: cloneJson(session.recorderMetadata || {})
  }));
  const snapshot = {
    ...lastRecordedFlow,
    steps: lastRecordedFlow.steps.slice(-MAX_ACTIVE_STEPS).map((step) => ({ ...step })),
    recorderMetadata: cloneJson(lastRecordedFlow.recorderMetadata || {})
  };
  return storageSafeFlow({ sessions, snapshot });
}

function queueFlowPersistence() {
  persistDirty = true;
  if (persistScheduled) return persistQueue;
  persistScheduled = true;
  const sessionArea = storageArea("session");
  const localArea = storageArea("local");
  persistQueue = persistQueue.catch(() => {}).then(async () => {
    do {
      persistDirty = false;
      const { sessions, snapshot } = buildPersistedFlowState();
      if (sessionArea) {
        await storageSet(sessionArea, {
          [FLOW_STORAGE_KEY]: sessions,
          [FLOW_SNAPSHOT_STORAGE_KEY]: snapshot
        });
      } else if (localArea) {
        await storageSet(localArea, {
          [FLOW_STORAGE_KEY]: sessions,
          [FLOW_SNAPSHOT_STORAGE_KEY]: snapshot
        });
      }
      await Promise.resolve();
    } while (persistDirty);
  }).catch((error) => {
    console.warn("[AgentPilot] Could not persist Recorder state:", error?.message || error);
  }).finally(() => {
    persistScheduled = false;
    if (persistDirty) void queueFlowPersistence();
  });
  return persistQueue;
}

/** Hydrate persisted Recorder state before handling commands or content events. */
export function ensureFlowRecorderHydrated() {
  if (flowHydrated) return Promise.resolve();
  if (flowHydrationPromise) return flowHydrationPromise;
  flowHydrationPromise = (async () => {
    const sessionArea = storageArea("session");
    const localArea = storageArea("local");
    let storedSessions = null;
    let storedSnapshot = null;
    try {
      storedSessions = await storageGet(sessionArea || localArea, FLOW_STORAGE_KEY);
      storedSnapshot = await storageGet(sessionArea || localArea, FLOW_SNAPSHOT_STORAGE_KEY);
      if (!storedSnapshot && sessionArea && localArea) {
        storedSnapshot = await storageGet(localArea, FLOW_SNAPSHOT_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("[AgentPilot] Could not hydrate Recorder state:", error?.message || error);
    }
    if (Array.isArray(storedSessions)) {
      for (const stored of storedSessions) {
        if (!validStoredSession(stored)) continue;
        try {
          const tabId = Number(stored.tabId);
          const steps = normalizeFlowSteps(stored.steps).slice(-MAX_ACTIVE_STEPS);
          validateFlowSteps(steps);
          tabFlowSessions.set(tabId, {
            title: String(stored.title || "Agent Pilot flow").slice(0, 200),
            recording: Boolean(stored.recording),
            replaying: false,
            steps,
            lastUrl: String(stored.lastUrl || ""),
            nextSeq: Math.max(Number(stored.nextSeq) || 1, steps.length + 1),
            recorderMetadata: stored.recorderMetadata && typeof stored.recorderMetadata === "object" ? cloneJson(stored.recorderMetadata) : {}
          });
        } catch (error) {
          console.warn("[AgentPilot] Ignoring invalid persisted Recorder session:", error?.message || error);
        }
      }
    }
    if (storedSnapshot && Array.isArray(storedSnapshot.steps) && storedSnapshot.steps.length <= MAX_ACTIVE_STEPS) {
      lastRecordedFlow.title = String(storedSnapshot.title || "Agent Pilot flow").slice(0, 200);
      try {
        lastRecordedFlow.steps = normalizeFlowSteps(storedSnapshot.steps);
        validateFlowSteps(lastRecordedFlow.steps);
      } catch (error) {
        lastRecordedFlow.steps = [];
        console.warn("[AgentPilot] Ignoring invalid persisted Recorder snapshot:", error?.message || error);
      }
      lastRecordedFlow.lastUrl = String(storedSnapshot.lastUrl || "");
      lastRecordedFlow.tabId = Number.isInteger(Number(storedSnapshot.tabId)) && Number(storedSnapshot.tabId) > 0 ? Number(storedSnapshot.tabId) : null;
      lastRecordedFlow.fromActiveRecording = Boolean(storedSnapshot.fromActiveRecording);
      lastRecordedFlow.recorderMetadata = storedSnapshot.recorderMetadata && typeof storedSnapshot.recorderMetadata === "object" ? cloneJson(storedSnapshot.recorderMetadata) : {};
    }
    flowHydrated = true;
  })().finally(() => {
    flowHydrationPromise = null;
  });
  return flowHydrationPromise;
}

export function initFlowRecorder(broadcastCallback) {
  broadcastFn = typeof broadcastCallback === "function" ? broadcastCallback : null;
  void ensureFlowRecorderHydrated();
}

function syncLastRecordedSnapshot(session) {
  if (!session) return;
  if (Array.isArray(session.steps) && session.steps.length > 0) {
    // Do not let passive breadcrumb steps from an unrelated tab overwrite an active recording snapshot
    if (lastRecordedFlow.fromActiveRecording && !session.recording) {
      return;
    }
    lastRecordedFlow.steps = session.steps.map((s) => ({ ...s }));
    lastRecordedFlow.tabId = Number(session.tabId) || null;
    lastRecordedFlow.recorderMetadata = cloneJson(session.recorderMetadata || {});
    if (session.title) lastRecordedFlow.title = session.title;
    lastRecordedFlow.lastUrl = session.lastUrl || session.steps.find((s) => s.url)?.url || lastRecordedFlow.lastUrl || "";
    if (session.recording) {
      lastRecordedFlow.fromActiveRecording = true;
    }
  }
}

function notifyFlowUpdate(tabId, extra = {}) {
  const session = tabId ? getOrCreateFlowSession(tabId) : { recording: false, replaying: false, steps: lastRecordedFlow.steps };
  const replayTelemetryOnly = Object.hasOwn(extra, "replayStepIndex");
  if (tabId && !replayTelemetryOnly) syncLastRecordedSnapshot({ ...session, tabId: Number(tabId) });
  if (!replayTelemetryOnly) void queueFlowPersistence();
  if (!broadcastFn) return;
  broadcastFn({
    type: "FLOW_RECORDER_UPDATED",
    tabId,
    recording: session.recording,
    replaying: session.replaying,
    steps: (session.steps || []).slice(),
    ...extra
  });
}

export function getOrCreateFlowSession(tabId) {
  tabId = Number(tabId);
  if (!tabFlowSessions.has(tabId)) {
    tabFlowSessions.set(tabId, {
      title: "Agent Pilot flow",
      recording: false,
      replaying: false,
      steps: [],
      lastUrl: "",
      nextSeq: 1,
      recorderMetadata: {}
    });
  }
  return tabFlowSessions.get(tabId);
}

export function removeFlowSession(tabId) {
  tabId = Number(tabId);
  if (tabFlowSessions.has(tabId)) {
    syncLastRecordedSnapshot(tabFlowSessions.get(tabId));
    tabFlowSessions.delete(tabId);
    void queueFlowPersistence();
  }
}

export function getFlowState(tabId) {
  if (!tabId) {
    return {
      title: lastRecordedFlow.title,
      recording: false,
      replaying: false,
      steps: lastRecordedFlow.steps.slice()
    };
  }
  tabId = Number(tabId);
  const session = getOrCreateFlowSession(tabId);
  return {
    title: session.title || "Agent Pilot flow",
    recording: session.recording,
    replaying: session.replaying,
    steps: session.steps.slice()
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
  if (!Number.isInteger(Number(tabId)) || Number(tabId) <= 0 || !rawStep || typeof rawStep.action !== "string" || !rawStep.action) return null;
  const supportedActions = new Set(["navigate", "click", "doubleClick", "hover", "scroll", "waitForElement", "waitForExpression", "setViewport", "type", "select", "press_key", "keyDown", "keyUp"]);
  if (!supportedActions.has(rawStep.action)) return null;
  tabId = Number(tabId);
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
      if (rawStep.action === "scroll") {
        if (Number(prev.x) === (Number(rawStep.x) || 0) && Number(prev.y) === (Number(rawStep.y) || 0)) {
          prev.timestamp = now;
          notifyFlowUpdate(tabId);
          return prev;
        }
      } else if (
        (rawStep.action === "type" || rawStep.action === "select") ||
        (prev.value === rawStep.value && now - prev.timestamp < STEP_DEDUPE_WINDOW_MS)
      ) {
        // Consecutive typing into the same field is one final-value step.
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

  const requestedId = rawStep.id === undefined ? "" : String(rawStep.id);
  if (requestedId.length > MAX_STEP_ID_LENGTH) return null;
  const stepId = requestedId || `step_${session.nextSeq++}`;
  if (session.steps.some((item) => item.id === stepId)) return null;
  const step = {
    id: stepId,
    action: String(rawStep.action),
    tagName: rawStep.tagName ? String(rawStep.tagName) : undefined,
    selector: rawStep.selector ? String(rawStep.selector) : undefined,
    playwrightLocator: rawStep.playwrightLocator ? String(rawStep.playwrightLocator) : undefined,
    label: rawStep.label ? String(rawStep.label) : undefined,
    value: rawStep.value !== undefined ? String(rawStep.value) : undefined,
    key: rawStep.key ? String(rawStep.key) : undefined,
    x: rawStep.x !== undefined ? Number(rawStep.x) || 0 : undefined,
    y: rawStep.y !== undefined ? Number(rawStep.y) || 0 : undefined,
    timeout: rawStep.timeout !== undefined ? Number(rawStep.timeout) || 5000 : undefined,
    expression: rawStep.expression ? String(rawStep.expression) : undefined,
    width: rawStep.width !== undefined ? Number(rawStep.width) || 0 : undefined,
    height: rawStep.height !== undefined ? Number(rawStep.height) || 0 : undefined,
    recorder: rawStep.recorder && typeof rawStep.recorder === "object" ? cloneJson(rawStep.recorder) : undefined,
    button: rawStep.button !== undefined ? String(rawStep.button) : undefined,
    offset: rawStep.offset && typeof rawStep.offset === "object" ? cloneJson(rawStep.offset) : undefined,
    target: rawStep.target !== undefined ? String(rawStep.target) : undefined,
    frame: rawStep.frame !== undefined ? cloneJson(rawStep.frame) : undefined,
    url: rawStep.url ? String(rawStep.url) : session.lastUrl || undefined,
    description: String(rawStep.description || `${rawStep.action} ${rawStep.selector || rawStep.url || ""}`).trim(),
    timestamp: now
  };

  if (step.url) {
    session.lastUrl = step.url;
  }

  session.steps.push(step);
  session.tabId = tabId;
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
  void queueFlowPersistence();

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
export async function setFlowRecording(tabId, enabled, initialUrl = "", title = "") {
  await ensureFlowRecorderHydrated();
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
  if (title) {
    session.title = String(title).slice(0, 200);
  }
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
    session.recorderMetadata = {};
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

  if (!session.recording && wasRecording) {
    session.replaying = false;
  }
  notifyFlowUpdate(activeTabId);
  return {
    success: true,
    tabId: activeTabId,
    title: session.title || lastRecordedFlow.title,
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
  tabId = tabId ? Number(tabId) : null;
  if (tabId && tabFlowSessions.has(tabId)) {
    const session = getOrCreateFlowSession(tabId);
    session.steps = session.steps.filter((s) => s.id !== stepId);
    if (Number(lastRecordedFlow.tabId) === Number(tabId)) {
      lastRecordedFlow.steps = lastRecordedFlow.steps.filter((s) => s.id !== stepId);
    }
    notifyFlowUpdate(tabId);
    return {
      success: true,
      recording: session.recording,
      steps: session.steps.slice()
    };
  }
  if (!tabId) lastRecordedFlow.steps = lastRecordedFlow.steps.filter((s) => s.id !== stepId);
  void queueFlowPersistence();
  return {
    success: true,
    recording: false,
    steps: tabId ? [] : lastRecordedFlow.steps.slice()
  };
}

export function clearFlowSteps(tabId) {
  if (!tabId) {
    lastRecordedFlow.steps = [];
    lastRecordedFlow.lastUrl = "";
    lastRecordedFlow.tabId = null;
    lastRecordedFlow.fromActiveRecording = false;
    void queueFlowPersistence();
    return { success: true, recording: false, steps: [] };
  }
  tabId = Number(tabId);
  const session = getOrCreateFlowSession(tabId);
  session.steps = [];
  session.lastUrl = "";
  if (Number(lastRecordedFlow.tabId) === Number(tabId)) {
    lastRecordedFlow.steps = [];
    lastRecordedFlow.lastUrl = "";
    lastRecordedFlow.fromActiveRecording = false;
  }
  notifyFlowUpdate(tabId);
  return {
    success: true,
    recording: session.recording,
    steps: []
  };
}

function selectorFromRecorderStep(step) {
  if (typeof step.selector === "string") return step.selector;
  if (!Array.isArray(step.selectors)) return "";
  for (const group of step.selectors) {
    if (Array.isArray(group) && typeof group[0] === "string" && group[0]) return group[0];
    if (typeof group === "string" && group) return group;
  }
  return "";
}

function recorderSelectors(selector) {
  return selector ? [[selector]] : [];
}

function recorderStepFromInternal(step) {
  if (step.recorder && typeof step.recorder === "object") {
    const raw = cloneJson(step.recorder);
    if (raw.type === "navigate" && step.url) raw.url = step.url;
    if (raw.type === "change" && step.value !== undefined) {
      raw.value = step.value === "checked" ? true : step.value === "unchecked" ? false : step.value;
    }
    if ((raw.type === "keyDown" || raw.type === "keyUp") && step.key) raw.key = step.key;
    if (raw.type === "scroll") {
      if (step.x !== undefined) raw.x = step.x;
      if (step.y !== undefined) raw.y = step.y;
    }
    if (raw.type === "waitForExpression" && step.expression !== undefined) raw.expression = step.expression;
    if ((raw.type === "waitForElement" || raw.type === "waitForExpression") && step.timeout !== undefined) {
      if (Object.prototype.hasOwnProperty.call(raw, "timeout") || Number(step.timeout) !== 5000) raw.timeout = step.timeout;
      else delete raw.timeout;
    }
    if (raw.type === "setViewport") {
      if (step.width !== undefined) raw.width = step.width;
      if (step.height !== undefined) raw.height = step.height;
    }
    applyRecorderPatch(raw, step.recorderPatch);
    return raw;
  }
  const selector = step.selector || "";
  const common = {
    ...(selector ? { selectors: recorderSelectors(selector) } : {}),
    ...(step.target ? { target: step.target } : {}),
    ...(step.frame !== undefined ? { frame: cloneJson(step.frame) } : {}),
    ...(step.assertedEvents ? { assertedEvents: cloneJson(step.assertedEvents) } : {})
  };
  const clickMetadata = {
    ...(step.button ? { button: step.button } : {}),
    ...(step.offset ? { offset: cloneJson(step.offset) } : {})
  };
  if (step.action === "navigate") return { type: "navigate", url: step.url || "" };
  if (step.action === "click") return { type: "click", target: "main", ...common, ...clickMetadata };
  if (step.action === "doubleClick") return { type: "doubleClick", target: "main", ...common, ...clickMetadata };
  if (step.action === "hover") return { type: "hover", target: "main", ...common };
  if (step.action === "select") return { type: "change", target: "main", value: step.value || "", ...common };
  if (step.action === "type") {
    const value = step.value === "checked" ? true : step.value === "unchecked" ? false : (step.value || "");
    return { type: "change", target: "main", value, ...common };
  }
  if (step.action === "press_key" || step.action === "keyDown" || step.action === "keyUp") {
    return { type: step.action === "press_key" ? "keyDown" : step.action, target: "main", key: step.key || "Enter", ...common };
  }
  if (step.action === "scroll") {
    return { type: "scroll", target: "main", x: Number(step.x) || 0, y: Number(step.y) || 0 };
  }
  if (step.action === "waitForElement") {
    return { type: "waitForElement", selectors: recorderSelectors(selector), timeout: Number(step.timeout) || 5000, ...(step.visible !== undefined ? { visible: step.visible } : {}), ...(step.operator ? { operator: step.operator } : {}), ...(step.count !== undefined ? { count: step.count } : {}) };
  }
  if (step.action === "waitForExpression") {
    return { type: "waitForExpression", expression: step.expression || "true", timeout: Number(step.timeout) || 5000 };
  }
  if (step.action === "setViewport") {
    return { type: "setViewport", width: Number(step.width) || 0, height: Number(step.height) || 0 };
  }
  throw new Error(`Unsupported Chrome Recorder step action: ${step.action || "unknown"}`);
}

function applyRecorderPatch(raw, patch = {}) {
  if (!patch || typeof patch !== "object") return;
  if (Object.prototype.hasOwnProperty.call(patch, "selector")) {
    const selector = patch.selector ? String(patch.selector) : "";
    if (!selector) {
      raw.selectors = [];
    } else if (Array.isArray(raw.selectors) && raw.selectors.length > 0) {
      const selectors = cloneJson(raw.selectors);
      const first = selectors[0];
      if (Array.isArray(first)) {
        selectors[0] = first.length > 0 ? [selector, ...first.slice(1)] : [selector];
      } else {
        selectors[0] = [selector];
      }
      raw.selectors = selectors;
    } else {
      raw.selectors = [[selector]];
    }
  }
  const directFields = [
    "url", "key", "x", "y", "expression", "width", "height", "timeout", "visible", "operator", "count",
    "button", "offset", "offsetX", "offsetY", "target", "frame", "assertedEvents", "deviceScaleFactor", "isMobile", "selectors"
  ];
  for (const field of directFields) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) raw[field] = cloneJson(patch[field]);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "action")) {
    raw.type = patch.action === "press_key" ? "keyDown" : (patch.action === "type" || patch.action === "select") ? "change" : patch.action;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "value")) {
    const value = patch.value;
    raw.value = raw.type === "change" && (value === "checked" || value === "unchecked")
      ? value === "checked"
      : value;
  }
}

function internalStepFromRecorder(step, index) {
  if (!step || typeof step !== "object") throw new Error(`Invalid Recorder step at index ${index}`);
  if (step.id !== undefined && (typeof step.id !== "string" || step.id.length > MAX_STEP_ID_LENGTH)) {
    throw new Error(`Invalid Chrome Recorder step ID at index ${index}`);
  }
  const type = String(step.type || step.action || "");
  const selector = selectorFromRecorderStep(step) || undefined;
  const base = {
    id: typeof step.id === "string" ? step.id : `step_${index + 1}`,
    selector,
    url: step.url ? String(step.url) : undefined,
    timestamp: Date.now(),
    recorder: cloneJson(step),
    button: step.button !== undefined ? String(step.button) : undefined,
    offset: step.offset && typeof step.offset === "object" ? cloneJson(step.offset) : undefined,
    target: step.target !== undefined ? String(step.target) : undefined,
    frame: step.frame !== undefined ? cloneJson(step.frame) : undefined,
    assertedEvents: Array.isArray(step.assertedEvents) ? cloneJson(step.assertedEvents) : undefined
  };
  if (type === "navigate") return { ...base, action: "navigate", description: `Navigate to ${step.url || ""}` };
  if (type === "click" || type === "doubleClick" || type === "hover") {
    return { ...base, action: type, description: `${type} ${selector || ""}`.trim() };
  }
  if (type === "change") {
    const value = typeof step.value === "boolean" ? (step.value ? "checked" : "unchecked") : String(step.value ?? "");
    return { ...base, action: "type", value, description: `Change ${selector || ""}`.trim() };
  }
  if (type === "keyDown" || type === "keyUp") {
    return { ...base, action: type, key: String(step.key || "Enter"), description: `${type} ${step.key || "Enter"}` };
  }
  if (type === "scroll") {
    return { ...base, action: "scroll", x: Number(step.x) || 0, y: Number(step.y) || 0, description: `Scroll to ${Number(step.x) || 0},${Number(step.y) || 0}` };
  }
  if (type === "waitForElement") {
    return {
      ...base,
      action: "waitForElement",
      timeout: Number(step.timeout) || 5000,
      visible: step.visible,
      operator: step.operator,
      count: step.count,
      description: `Wait for ${selector || "element"}`
    };
  }
  if (type === "waitForExpression") {
    return { ...base, action: "waitForExpression", expression: String(step.expression || "true"), timeout: Number(step.timeout) || 5000, description: "Wait for expression" };
  }
  if (type === "setViewport") return { ...base, action: "setViewport", width: Number(step.width) || 0, height: Number(step.height) || 0, description: "Set viewport" };
  throw new Error(`Unsupported Chrome Recorder step type: ${type || "unknown"}`);
}

function recorderFlowFromSteps(title, steps, metadata = {}) {
  return {
    ...cloneJson(metadata || {}),
    title: String(title || "Agent Pilot flow").slice(0, 200),
    steps: steps.map((step) => recorderStepFromInternal(step))
  };
}

function normalizeFlowSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((step, index) => (
    step?.type ? internalStepFromRecorder(step, index) : { ...step }
  ));
}

function validateFlowSteps(steps) {
  if (!Array.isArray(steps)) throw new Error("Flow steps must be an array");
  if (steps.length > MAX_ACTIVE_STEPS) throw new Error(`Flow cannot exceed ${MAX_ACTIVE_STEPS} steps`);
  const ids = new Set();
  for (const [index, step] of steps.entries()) {
    if (!step || typeof step !== "object" || !String(step.action || "")) {
      throw new Error(`Invalid flow step at index ${index}`);
    }
    if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid flow step index: ${index}`);
    const id = String(step.id || `step_${index + 1}`);
    if (step.id !== undefined && typeof step.id !== "string") throw new Error(`Flow step ID at index ${index} must be a string`);
    if (id.length > MAX_STEP_ID_LENGTH) throw new Error(`Flow step ID exceeds ${MAX_STEP_ID_LENGTH} characters`);
    if (ids.has(id)) throw new Error(`Duplicate flow step ID: ${id}`);
    ids.add(id);
  }
}

export function exportFlowAsRecorder(tabId, fallbackTitle = "", fallbackSteps = null) {
  const { steps } = resolveStepsForExportOrReplay(tabId, fallbackSteps);
  const session = tabId ? tabFlowSessions.get(Number(tabId)) : null;
  const title = fallbackTitle || session?.title || (!tabId ? lastRecordedFlow.title : "Agent Pilot flow");
  const metadata = session?.recorderMetadata || (!tabId ? lastRecordedFlow.recorderMetadata : {});
  return recorderFlowFromSteps(title, steps, metadata);
}

/** Keep the lossless Recorder export available when a derived format cannot represent a step. */
export function exportFlowFormats(tabId, fallbackUrl = "", fallbackTitle = "", fallbackSteps = null) {
  const recorder = exportFlowAsRecorder(tabId, fallbackTitle, fallbackSteps);
  const result = { recorder, batch: null, playwright: null, exportErrors: {} };
  try {
    result.batch = exportFlowAsBatch(tabId, fallbackUrl, fallbackTitle, fallbackSteps);
  } catch (error) {
    result.exportErrors.batch = error?.message || String(error);
  }
  try {
    result.playwright = exportFlowAsPlaywright(tabId, fallbackUrl, fallbackSteps);
  } catch (error) {
    result.exportErrors.playwright = error?.message || String(error);
  }
  return result;
}

export function importFlow(tabId, flow, title = "") {
  if (tabId !== null && tabId !== undefined && (!Number.isInteger(Number(tabId)) || Number(tabId) <= 0)) {
    throw new Error("Invalid tabId for Chrome Recorder flow");
  }
  const raw = Array.isArray(flow) ? { steps: flow } : flow;
  if (!raw || !Array.isArray(raw.steps)) throw new Error("Chrome Recorder flow must contain a steps array");
  if (raw.steps.length > MAX_ACTIVE_STEPS) throw new Error(`Chrome Recorder flow cannot exceed ${MAX_ACTIVE_STEPS} steps`);
  const steps = raw.steps.map((step, index) => internalStepFromRecorder(step, index));
  validateFlowSteps(steps);
  const session = tabId ? getOrCreateFlowSession(Number(tabId)) : null;
  const flowTitle = String(title || raw.title || session?.title || (!tabId ? lastRecordedFlow.title : "Agent Pilot flow")).slice(0, 200);
  if (session) {
    session.title = flowTitle;
    session.steps = steps;
    session.nextSeq = steps.length + 1;
    session.lastUrl = steps.find((step) => step.url)?.url || "";
    session.recorderMetadata = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "title" && key !== "steps"));
  }
  lastRecordedFlow.title = flowTitle;
  lastRecordedFlow.steps = steps.map((step) => ({ ...step }));
  lastRecordedFlow.lastUrl = session?.lastUrl || steps.find((step) => step.url)?.url || "";
  lastRecordedFlow.tabId = session ? Number(tabId) : null;
  lastRecordedFlow.fromActiveRecording = true;
  lastRecordedFlow.recorderMetadata = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "title" && key !== "steps"));
  void queueFlowPersistence();
  notifyFlowUpdate(session ? Number(tabId) : null);
  return { success: true, tabId, ...getFlowState(tabId) };
}

export function editFlowStep(tabId, operation, stepId, step, index) {
  const session = tabId ? getOrCreateFlowSession(Number(tabId)) : null;
  const steps = session ? session.steps.slice() : lastRecordedFlow.steps.slice();
  if (operation === "replace" || operation === "update") {
    const at = steps.findIndex((item) => item.id === stepId);
    if (at < 0) throw new Error(`Flow step not found: ${stepId}`);
    const current = steps[at];
    if (step?.type) {
      steps[at] = { ...internalStepFromRecorder(step, at), id: current.id };
    } else if (step?.action && operation === "replace") {
      const replacement = { ...step, id: current.id };
      delete replacement.recorder;
      delete replacement.recorderPatch;
      steps[at] = replacement;
    } else if (step?.recorder) {
      steps[at] = { ...internalStepFromRecorder(step.recorder, at), ...step, id: current.id };
    } else if (step && typeof step === "object") {
      const recorderPatch = { ...(current.recorderPatch || {}), ...step };
      steps[at] = { ...current, ...step, recorderPatch, id: current.id };
    } else {
      throw new Error("Flow step update requires a step object");
    }
  } else if (operation === "insert") {
    const at = index === undefined ? steps.findIndex((item) => item.id === stepId) : Number(index);
    if (index !== undefined && (!Number.isInteger(at) || at < 0 || at > steps.length)) throw new Error("Invalid insertion index");
    const insertionIndex = at < 0 ? steps.length : at;
    const next = internalStepFromRecorder(step, insertionIndex);
    if (step?.id !== undefined && steps.some((item) => item.id === next.id)) throw new Error(`Duplicate flow step ID: ${next.id}`);
    steps.splice(insertionIndex, 0, next);
  } else if (operation === "delete") {
    const at = steps.findIndex((item) => item.id === stepId);
    if (at < 0) throw new Error(`Flow step not found: ${stepId}`);
    steps.splice(at, 1);
  } else if (operation === "set") {
    if (!Array.isArray(step)) throw new Error("set requires a steps array");
    if (step.length > MAX_ACTIVE_STEPS) throw new Error(`Flow cannot exceed ${MAX_ACTIVE_STEPS} steps`);
    steps.splice(0, steps.length, ...step.map((item, itemIndex) => internalStepFromRecorder(item, itemIndex)));
  } else {
    throw new Error(`Unsupported flow edit operation: ${operation}`);
  }
  validateFlowSteps(steps);
  if (session) {
    session.steps = steps;
    session.nextSeq = steps.length + 1;
  }
  lastRecordedFlow.steps = steps.map((item) => ({ ...item }));
  lastRecordedFlow.title = session?.title || lastRecordedFlow.title;
  lastRecordedFlow.lastUrl = session?.lastUrl || steps.find((item) => item.url)?.url || "";
  lastRecordedFlow.tabId = session ? Number(tabId) : null;
  if (session) lastRecordedFlow.recorderMetadata = cloneJson(session.recorderMetadata || {});
  void queueFlowPersistence();
  notifyFlowUpdate(session ? Number(tabId) : null);
  return { success: true, tabId, ...getFlowState(tabId) };
}

function resolveStepsForExportOrReplay(tabId, fallbackSteps = null) {
  if (Array.isArray(fallbackSteps) && fallbackSteps.length > 0) {
    const steps = normalizeFlowSteps(fallbackSteps);
    validateFlowSteps(steps);
    const session = tabId ? tabFlowSessions.get(Number(tabId)) : null;
    return {
      steps,
      lastUrl: steps.find((s) => s.url)?.url || session?.lastUrl || (!tabId ? lastRecordedFlow.lastUrl : "")
    };
  }
  if (tabId && tabFlowSessions.has(Number(tabId))) {
    const session = tabFlowSessions.get(Number(tabId));
    return { steps: session.steps.slice(), lastUrl: session.lastUrl };
  }
  if (!tabId) return { steps: lastRecordedFlow.steps.slice(), lastUrl: lastRecordedFlow.lastUrl };
  return { steps: [], lastUrl: "" };
}

/**
 * Convert recorded steps into Agent Pilot Batch JSON format.
 */
export function exportFlowAsBatch(tabId, fallbackUrl = "", fallbackTitle = "", fallbackSteps = null) {
  const { steps, lastUrl } = resolveStepsForExportOrReplay(tabId, fallbackSteps);
  const actions = steps.map((step) => {
    assertMainFrameStep(step, "Batch");
    if ((step.action === "click" || step.action === "doubleClick") && hasUnsupportedClickDetails(step)) {
      throw new Error("Batch export does not support Recorder button/offset click details");
    }
    if (step.action === "navigate") {
      return {
        action: "navigate",
        url: step.url
      };
    }
    if (step.action === "type") {
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
    if (step.action === "select") {
      throw new Error("Batch export does not support select/change steps; use Recorder JSON or Playwright export");
    }
    if (step.action === "scroll") {
      return {
        action: "evaluate",
        expression: `window.scrollTo(${Number(step.x) || 0}, ${Number(step.y) || 0})`
      };
    }
    if (step.action === "hover") {
      return { action: "hover", selector: step.selector };
    }
    if (step.action === "waitForElement") {
      if (step.visible === false || step.operator || step.count !== undefined || step.recorder?.assertedEvents?.length) {
        throw new Error("Batch export does not support waitForElement visibility/count/assertedEvents conditions");
      }
      return { action: "wait_for_selector", selector: step.selector, timeout: Number(step.timeout) || 5000 };
    }
    if (step.action === "click" || step.action === "doubleClick") {
      return { action: "click", selector: step.selector, ...(step.action === "doubleClick" ? { clickCount: 2 } : {}) };
    }
    throw new Error(`Batch export does not support Recorder step: ${step.action}`);
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
    assertMainFrameStep(step, "Playwright");
    const locatorExpr = step.playwrightLocator || (step.selector ? `page.locator(${JSON.stringify(step.selector)})` : "page");
    if (step.action === "navigate" && step.url) {
      lines.push(`  await page.goto(${JSON.stringify(step.url)});`);
    } else if (step.action === "click") {
      const options = playwrightClickOptions(step);
      lines.push(options ? `  await ${locatorExpr}.click(${options});` : `  await ${locatorExpr}.click();`);
    } else if (step.action === "doubleClick") {
      const options = playwrightClickOptions(step);
      lines.push(options ? `  await ${locatorExpr}.dblclick(${options});` : `  await ${locatorExpr}.dblclick();`);
    } else if (step.action === "hover") {
      lines.push(`  await ${locatorExpr}.hover();`);
    } else if (step.action === "scroll") {
      lines.push(`  await page.evaluate(({ x, y }) => window.scrollTo(x, y), ${JSON.stringify({ x: Number(step.x) || 0, y: Number(step.y) || 0 })});`);
    } else if (step.action === "waitForElement") {
      if (step.operator || step.count !== undefined || step.recorder?.assertedEvents?.length) {
        throw new Error("Playwright export does not support waitForElement count/assertedEvents conditions");
      }
      const state = step.visible === false ? "hidden" : "visible";
      lines.push(`  await ${locatorExpr}.waitFor({ state: ${JSON.stringify(state)}, timeout: ${Number(step.timeout) || 5000} });`);
    } else if (step.action === "waitForExpression") {
      lines.push(`  await page.waitForFunction(() => (${step.expression || "true"}), null, { timeout: ${Number(step.timeout) || 5000} });`);
    } else if (step.action === "setViewport") {
      if (!(Number(step.width) > 0 && Number(step.height) > 0)) throw new Error("Playwright export requires positive viewport width and height");
      lines.push(`  await page.setViewportSize(${JSON.stringify({ width: Number(step.width), height: Number(step.height) })});`);
    } else if (step.action === "keyDown" || step.action === "keyUp") {
      if (step.selector) lines.push(`  await ${locatorExpr}.focus();`);
      lines.push(`  await page.keyboard.${step.action === "keyDown" ? "down" : "up"}(${JSON.stringify(step.key || "Enter")});`);
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
    } else {
      throw new Error(`Playwright export does not support Recorder step: ${step.action}`);
    }
  }

  lines.push("});");
  return lines.join("\n");
}

function assertMainFrameStep(step, format) {
  const recorder = step.recorder || {};
  const target = step.target || recorder.target;
  const frame = step.frame !== undefined ? step.frame : recorder.frame;
  const assertedEvents = step.assertedEvents || recorder.assertedEvents;
  if (target && target !== "main") {
    throw new Error(`${format} export does not support Recorder target: ${target}`);
  }
  if (!isMainFrameDescriptor(frame)) {
    throw new Error(`${format} export does not support Recorder frame targeting`);
  }
  if (assertedEvents?.length) {
    throw new Error(`${format} export does not support Recorder assertedEvents`);
  }
}

function recorderClickDetails(step) {
  const recorder = step.recorder || {};
  const button = step.button || recorder.button || "primary";
  const offset = step.offset || recorder.offset || (
    recorder.offsetX !== undefined || recorder.offsetY !== undefined
      ? { x: recorder.offsetX, y: recorder.offsetY }
      : null
  );
  return { button, offset };
}

function hasUnsupportedClickDetails(step) {
  const { button, offset } = recorderClickDetails(step);
  return !["primary", "left"].includes(button) || Boolean(offset);
}

function playwrightClickOptions(step) {
  const { button, offset } = recorderClickDetails(step);
  const mappedButton = button === "primary" ? "left" : button === "secondary" ? "right" : button === "auxiliary" ? "middle" : button;
  if (!["left", "right", "middle"].includes(mappedButton)) {
    throw new Error(`Playwright export does not support Recorder button: ${button}`);
  }
  const options = {};
  if (mappedButton !== "left") options.button = mappedButton;
  if (offset) {
    const x = Number(offset.x ?? offset.offsetX);
    const y = Number(offset.y ?? offset.offsetY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Recorder click offset must contain finite x and y values");
    options.position = { x, y };
  }
  return Object.keys(options).length ? JSON.stringify(options) : "";
}

function isMainFrameDescriptor(frame) {
  return frame === undefined || frame === null || frame === "" || (Array.isArray(frame) && frame.length === 0);
}

function assertReplaySupported(step) {
  const supported = new Set(["navigate", "click", "doubleClick", "hover", "scroll", "waitForElement", "waitForExpression", "type", "select", "press_key", "keyDown", "keyUp"]);
  if (!supported.has(step.action)) {
    throw new Error(`Recorder replay does not support step: ${step.action || "unknown"}`);
  }
  const recorder = step.recorder || {};
  const target = step.target || recorder.target;
  const frame = step.frame !== undefined ? step.frame : recorder.frame;
  const assertedEvents = step.assertedEvents || recorder.assertedEvents;
  if (target && target !== "main") {
    throw new Error(`Recorder replay does not support target: ${target}`);
  }
  if (!isMainFrameDescriptor(frame)) {
    throw new Error("Recorder replay does not support frame targeting");
  }
  if (assertedEvents?.length) {
    throw new Error("Recorder replay does not support assertedEvents");
  }
  if ((step.action === "click" || step.action === "doubleClick") &&
      ((step.button && !["left", "primary"].includes(step.button)) ||
       (recorder.button && !["left", "primary"].includes(recorder.button)) ||
       step.offset || recorder.offset || recorder.offsetX !== undefined || recorder.offsetY !== undefined)) {
    throw new Error("Recorder replay does not yet support non-primary button or offset clicks");
  }
  if (step.action === "waitForElement" && (step.visible === false || step.operator || step.count !== undefined)) {
    throw new Error("Recorder replay does not support waitForElement visibility/count conditions");
  }
  if (step.action === "waitForExpression" && !String(step.expression || "true").trim()) {
    throw new Error("Recorder waitForExpression requires a non-empty expression");
  }
  if (step.action === "navigate" && !step.url) throw new Error("Recorder navigate step is missing its URL");
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function raceWithTimeout(promise, timeoutMs, timeoutValue) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
    })
  ]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

/**
 * Send a step message to the content script, polling up to `maxWaitMs` if the element
 * is still being rendered asynchronously by a SPA (e.g. Google AI Mode).
 */
async function sendStepMessageWithAutoWait(tabId, payload, maxWaitMs = 4500) {
  const start = Date.now();
  let lastRes = null;
  while (Date.now() - start < maxWaitMs) {
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
  await ensureFlowRecorderHydrated();
  const resolvedFlow = resolveStepsForExportOrReplay(tabId, fallbackSteps);
  const steps = resolvedFlow.steps;
  if (steps.length === 0) {
    return { success: false, error: "Chưa có bước thao tác nào để chạy Replay" };
  }
  validateFlowSteps(steps);
  for (const step of steps) assertReplaySupported(step);

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
          await navigateTabAndWait(activeTabId, targetUrl, 12000, { requireNewLoad: true });
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
        const res = await sendStepMessageWithAutoWait(
          activeTabId,
          {
            action: "click_cursor",
            selector: step.selector,
            button: step.button || step.recorder?.button,
            offset: step.offset || step.recorder?.offset,
            fallbackHints
          },
          3500
        );
        if (!res || !res.success) {
          throw new Error(res?.error || `Không tìm thấy phần tử để click: ${step.selector}`);
        }
        executed++;
        await delay(400);
      } else if (step.action === "doubleClick") {
        const res = await sendStepMessageWithAutoWait(
          activeTabId,
          { action: "click_cursor", selector: step.selector, clickCount: 2, button: step.button || step.recorder?.button, offset: step.offset || step.recorder?.offset, fallbackHints },
          3500
        );
        if (!res || !res.success) throw new Error(res?.error || `Không tìm thấy phần tử để double click: ${step.selector}`);
        executed++;
        await delay(400);
      } else if (step.action === "hover") {
        const res = await sendStepMessageWithAutoWait(
          activeTabId,
          { action: "virtual_hover", selector: step.selector, fallbackHints },
          3500
        );
        if (!res || !res.success) throw new Error(res?.error || `Không tìm thấy phần tử để hover: ${step.selector}`);
        executed++;
        await delay(250);
      } else if (step.action === "scroll") {
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: (x, y) => window.scrollTo(x, y),
          args: [Number(step.x) || 0, Number(step.y) || 0]
        });
        executed++;
        await delay(250);
      } else if (step.action === "waitForElement") {
        const res = await sendStepMessageWithAutoWait(
          activeTabId,
          { action: "wait_for", selector: step.selector, timeoutMs: Number(step.timeout) || 5000 },
          Number(step.timeout) || 5000
        );
        if (!res || res.success === false) throw new Error(res?.error || `Timed out waiting for: ${step.selector}`);
        executed++;
      } else if (step.action === "waitForExpression") {
        const deadline = Date.now() + (Number(step.timeout) || 5000);
        let matched = false;
        while (Date.now() < deadline) {
          const remainingMs = Math.max(1, deadline - Date.now());
          const execution = chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            world: "MAIN",
            func: async (expression, timeoutMs) => {
              let timer = null;
              try {
                return Boolean(await Promise.race([
                  Promise.resolve(window.eval(expression)).then(Boolean),
                  new Promise((resolve) => {
                    timer = setTimeout(() => resolve(false), timeoutMs);
                  })
                ]));
              } finally {
                if (timer !== null) clearTimeout(timer);
              }
            },
            args: [step.expression || "true", remainingMs]
          }).catch(() => []);
          const timeoutMarker = {};
          const result = await raceWithTimeout(execution, remainingMs, timeoutMarker);
          if (result === timeoutMarker) break;
          if (result[0]?.result === true) {
            matched = true;
            break;
          }
          await delay(100);
        }
        if (!matched) throw new Error(`Timed out waiting for expression: ${step.expression}`);
        executed++;
      } else if (step.action === "setViewport") {
        throw new Error("Recorder setViewport replay is unsupported in extension tabs; export to Playwright or use a CDP-controlled context");
      } else if (step.action === "type" || step.action === "select") {
        const textVal = step.value || step.text || "";
        if (textVal === "[REDACTED]" || textVal === "<SENSITIVE_VALUE>") {
          throw new Error(`Cannot replay redacted input for ${step.selector || "target"}`);
        }

        const res = await sendStepMessageWithAutoWait(
          activeTabId,
          {
            action: "type_text",
            selector: step.selector,
            text: textVal,
            clear: true,
            pressEnter: false,
            fallbackHints
          },
          4500
        );
        if (!res || !res.success) {
          throw new Error(res?.error || `Không thể nhập dữ liệu vào: ${step.selector}`);
        }
        executed++;
        await delay(300);
      } else if (step.action === "press_key") {
        const key = step.key || "Enter";
        if (key === "Enter") {
          const res = await sendStepMessageWithAutoWait(
            activeTabId,
            { action: "type_text", selector: step.selector, text: "", pressEnter: true, fallbackHints },
            3500
          );
          if (!res || !res.success) throw new Error(res?.error || `Không thể nhấn phím ${key} tại: ${step.selector}`);
        } else {
          for (const eventType of ["keyDown", "keyUp"]) {
            const res = await sendStepMessageWithAutoWait(
              activeTabId,
              { action: "dispatch_key", eventType, key, selector: step.selector, fallbackHints },
              3500
            );
            if (!res || !res.success) throw new Error(res?.error || `Không thể nhấn phím ${key} tại: ${step.selector}`);
          }
        }
        executed++;
        await delay(1000);
      } else if (step.action === "keyDown" || step.action === "keyUp") {
        const res = await sendStepMessageWithAutoWait(
          activeTabId,
          {
            action: "dispatch_key",
            eventType: step.action,
            key: step.key || "Enter",
            selector: step.selector,
            fallbackHints
          },
          3500
        );
        if (!res || !res.success) throw new Error(res?.error || `Could not dispatch ${step.action} for ${step.key || "Enter"}`);
        executed++;
      } else {
        throw new Error(`Recorder replay does not support step: ${step.action || "unknown"}`);
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
