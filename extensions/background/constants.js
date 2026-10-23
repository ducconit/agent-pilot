/**
 * Agent Pilot - Background Service Worker Constants & Shared State
 */

import { EXTENSION_BUILD_ID } from "./build-info.js";

// Track attached debugger sessions and buffered devtools events
export const attachedTabs = new Set();
export const devtoolsBuffers = new Map(); // tabId -> { console: [], network: Map, performance: {} }
export const agentControlledTabs = new Set(); // Track tabs opened or controlled by AI Agent
export const tabLockStates = new Map(); // tabId -> { manualLock: boolean, autoCount: number, unlockTimer: any, currentAction: string, sessionActive: boolean, sessionName: string }
export const activeDialogs = new Map(); // tabId -> { type, message, defaultPrompt, url, timestamp }
export const activeTracingSessions = new Map(); // tabId -> { buffer: [], categories: string, startTime: number }
export const memoryBaselines = new Map(); // tabId -> { timestamp, metrics, heapSummary, domSummary }

// Chrome Native Tab Group styling constants
export const AGENT_GROUP_TITLE = "🤖 Agent Pilot";
export const AGENT_GROUP_COLOR = "cyan";
export const NO_TARGET_TAB_ERROR =
  `No target tab found in the '${AGENT_GROUP_TITLE}' tab group. Personal/ungrouped browser tabs are isolated for security. Call browser_open_tab (or 'agent-pilot open <url>') to open a tab in the Agent Pilot group first, or move the target tab into the '${AGENT_GROUP_TITLE}' group.`;

// Timeout & Capacity constants
export const CDP_PROTOCOL_VERSION = "1.3";
export const CDP_SCREENSHOT_TIMEOUT_MS = 4000;
export const DEFAULT_LOAD_TIMEOUT_MS = 15000;
export const DEFAULT_AGENT_PORT = 58765;
export const MAX_DEVTOOLS_CONSOLE_ENTRIES = 500;
export const MAX_DEVTOOLS_NETWORK_ENTRIES = 300;

// Extension version resolved once at module load (falls back outside extension contexts)
export const EXTENSION_VERSION = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest)
  ? (chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version)
  : "1.0.11-beta";
export { EXTENSION_BUILD_ID };

/**
 * Centralized timing configuration (milliseconds).
 * Modules must reference these instead of defining their own literals so
 * timeouts can be tuned from one place.
 */
export const TIMEOUTS = Object.freeze({
  CDP_COMMAND_MS: 15000,
  CDP_DOMAIN_ENABLE_MS: 2500,
  CDP_SESSION_PROBE_MS: 1500,
  CDP_SCREENSHOT_MS: CDP_SCREENSHOT_TIMEOUT_MS,
  TAB_MESSAGE_RETRY_DELAY_MS: 250,
  TAB_MESSAGE_RETRIES: 3,
  TAB_SCRIPT_INJECT_SETTLE_MS: 80,
  // Performance tracing: how long to wait for Tracing.end and for the final
  // Tracing.tracingComplete event before returning whatever was buffered.
  CDP_TRACING_END_MS: 5000,
  CDP_TRACE_COMPLETE_MS: 2000,
  // Synthetic mouse drag: per-step pause (~1 frame) and the hard cap on an
  // optional press-hold so a bad caller cannot keep the mouse "down" forever.
  CDP_DRAG_STEP_DELAY_MS: 16,
  CDP_DRAG_HOLD_MAX_MS: 10000,
  // Batch action defaults for content-script waits / plain sleeps.
  BATCH_WAIT_SELECTOR_MS: 5000,
  BATCH_SLEEP_MS: 1000
});

/**
 * Capacity limits shared by background modules.
 */
export const LIMITS = Object.freeze({
  OUTBOUND_QUEUE_MAX: 100,
  FALLBACK_FEEDBACK_SESSIONS: 10,
  DEVTOOLS_CONSOLE_MAX: MAX_DEVTOOLS_CONSOLE_ENTRIES,
  DEVTOOLS_NETWORK_MAX: MAX_DEVTOOLS_NETWORK_ENTRIES,
  DEVTOOLS_FETCH_DEFAULT: 50,
  DEVTOOLS_FETCH_MAX: 200,
  // Cap on Tracing.dataCollected events buffered per performance trace.
  CDP_TRACE_BUFFER_MAX: 2000,
  // Synthetic mouse drag interpolation bounds (see cdp-input.js).
  CDP_DRAG_MIN_STEPS: 2,
  CDP_DRAG_MAX_STEPS: 120,
  // Default element cap for batch page snapshot when the caller omits one.
  SNAPSHOT_MAX_ELEMENTS_DEFAULT: 80
});

/**
 * Behavioural defaults for agent commands. MAX_TIMER_DELAY_MS is the largest
 * delay a browser timer accepts (32-bit signed) — larger values wrap/clamp to 1ms.
 */
export const DEFAULTS = Object.freeze({
  MOVE_DURATION_MS: 300,
  TYPE_DELAY_MS: 50,
  DRAG_STEPS: 8,
  DRAG_STEPS_CDP: 10,
  WAIT_FOR_TIMEOUT_MS: 10000,
  MAX_TIMER_DELAY_MS: 2147483647
});

/**
 * Agent bridge connection policy.
 * NOTE: Chrome clamps alarms below 0.5 minutes, so the keepalive cannot run faster.
 */
export const BRIDGE = Object.freeze({
  PORT: DEFAULT_AGENT_PORT,
  RECONNECT_BASE_MS: 2000,
  RECONNECT_MAX_MS: 20000,
  RECONNECT_JITTER_RATIO: 0.2,
  KEEPALIVE_PERIOD_MINUTES: 0.5
});

export function getTabLockState(tabId) {
  if (!tabLockStates.has(tabId)) {
    tabLockStates.set(tabId, {
      manualLock: false,
      autoCount: 0,
      unlockTimer: null,
      currentAction: "",
      sessionActive: false,
      sessionName: ""
    });
  }
  return tabLockStates.get(tabId);
}

/**
 * Drop per-tab CDP session state (attached flag, devtools buffer, active trace, active dialog, memory baseline).
 */
export function cleanupDebuggerState(tabId) {
  attachedTabs.delete(tabId);
  devtoolsBuffers.delete(tabId);
  activeTracingSessions.delete(tabId);
  activeDialogs.delete(tabId);
  memoryBaselines.delete(tabId);
}

/**
 * Drop all per-tab state when a tab is closed.
 */
export function cleanupTabResources(tabId) {
  cleanupDebuggerState(tabId);
  agentControlledTabs.delete(tabId);
  const lockState = tabLockStates.get(tabId);
  if (lockState && lockState.unlockTimer) {
    clearTimeout(lockState.unlockTimer);
  }
  tabLockStates.delete(tabId);
}

function safeEncodeAuthComponent(val) {
  const str = String(val ?? "");
  if (!str) return "";
  try {
    return encodeURIComponent(decodeURIComponent(str));
  } catch (_) {
    return encodeURIComponent(str);
  }
}

/**
 * Cross-platform URL normalizer supporting Windows/Mac/Linux local file URLs
 * as well as edge://, chrome://, brave://, and standard web protocols.
 * Also normalizes HTTP Basic Auth credentials passed via authOptions
 * ({ username/user, password/pass }) or inline in https://user:pass@host URLs
 * where passwords contain special characters like '@', '&', or '#'.
 */
export function normalizeUrl(url, authOptions = null) {
  if (!url) return "";
  const trimmed = String(url).trim();
  const withScheme = /^(https?|file|chrome|edge|brave|about|data):/i.test(trimmed)
    ? trimmed
    : "https://" + trimmed;

  const schemeMatch = withScheme.match(/^(https?:\/\/)(.*)$/i);
  if (!schemeMatch) {
    return withScheme;
  }

  const schemePrefix = schemeMatch[1];
  const remainder = schemeMatch[2];
  const slashIdx = remainder.indexOf("/");
  const beforeSlash = slashIdx !== -1 ? remainder.slice(0, slashIdx) : remainder;
  const lastAtBeforeSlash = beforeSlash.lastIndexOf("@");
  const searchStart = lastAtBeforeSlash !== -1 ? lastAtBeforeSlash + 1 : 0;

  let authorityEnd = slashIdx !== -1 ? slashIdx : remainder.length;
  for (const sep of ["?", "#"]) {
    const idx = remainder.indexOf(sep, searchStart);
    if (idx !== -1 && idx < authorityEnd) {
      authorityEnd = idx;
    }
  }

  const authority = remainder.slice(0, authorityEnd);
  const pathAndMore = remainder.slice(authorityEnd);

  const nestedAuth =
    authOptions && typeof authOptions === "object" && authOptions.auth && typeof authOptions.auth === "object"
      ? authOptions.auth
      : null;
  const optUser = authOptions && typeof authOptions === "object"
    ? (authOptions.username ?? authOptions.user ?? nestedAuth?.username ?? nestedAuth?.user ?? "")
    : "";
  const optPass = authOptions && typeof authOptions === "object"
    ? (authOptions.password ?? authOptions.pass ?? nestedAuth?.password ?? nestedAuth?.pass ?? "")
    : "";

  const atIdx = authority.lastIndexOf("@");
  if (atIdx === -1 && !optUser && !optPass) {
    return withScheme;
  }

  let hostPort = authority;
  let rawUser = "";
  let rawPass = "";
  if (atIdx !== -1) {
    const userInfo = authority.slice(0, atIdx);
    hostPort = authority.slice(atIdx + 1);
    const colonIdx = userInfo.indexOf(":");
    if (colonIdx === -1) {
      rawUser = userInfo;
    } else {
      rawUser = userInfo.slice(0, colonIdx);
      rawPass = userInfo.slice(colonIdx + 1);
    }
  }

  const finalUser = optUser ? encodeURIComponent(String(optUser)) : safeEncodeAuthComponent(rawUser);
  const finalPass = optPass ? encodeURIComponent(String(optPass)) : safeEncodeAuthComponent(rawPass);

  if (!finalUser && !finalPass) {
    return `${schemePrefix}${hostPort}${pathAndMore}`;
  }
  const authPart = finalPass ? `${finalUser}:${finalPass}@` : `${finalUser}@`;
  return `${schemePrefix}${authPart}${hostPort}${pathAndMore}`;
}

// Cached host platform: "win", "mac", "linux", "cros"
export let currentPlatform = "unknown";
export const platformPromise = (typeof chrome !== "undefined" && chrome.runtime?.getPlatformInfo)
  ? new Promise((resolve) => {
      chrome.runtime.getPlatformInfo((info) => {
        currentPlatform = info?.os || "unknown";
        resolve(currentPlatform);
      });
    })
  : Promise.resolve("unknown");

/**
 * Get or initialize devtools buffer for a tab
 */
export function getBuffer(tabId) {
  if (!devtoolsBuffers.has(tabId)) {
    devtoolsBuffers.set(tabId, {
      console: [],
      network: new Map(),
      performance: { metrics: {}, timestamp: Date.now() }
    });
  }
  return devtoolsBuffers.get(tabId);
}

// Secret & Private Key Masking Configuration (Default: true)
export const STORAGE_KEY_SECRET_FILTER = "agent_pilot_filter_secrets";
let isSecretFilterEnabled = true;

if (typeof chrome !== "undefined" && chrome.storage?.local) {
  chrome.storage.local.get([STORAGE_KEY_SECRET_FILTER], (res) => {
    if (res && res[STORAGE_KEY_SECRET_FILTER] !== undefined) {
      isSecretFilterEnabled = Boolean(res[STORAGE_KEY_SECRET_FILTER]);
    }
  });
}

export function getSecretFilterEnabled() {
  return isSecretFilterEnabled;
}

export function setSecretFilterEnabled(val) {
  isSecretFilterEnabled = Boolean(val);
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.set({ [STORAGE_KEY_SECRET_FILTER]: isSecretFilterEnabled });
  }
}

/**
 * Safe debug logger for background operations
 */
export function logDebug(context, error) {
  if (typeof console !== "undefined" && console.debug) {
    const msg = error?.message || String(error || "");
    console.debug(`[AgentPilot:DEBUG] ${context}:`, msg);
  }
}
