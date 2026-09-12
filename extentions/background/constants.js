/**
 * Agent Pilot - Background Service Worker Constants & Shared State
 */

// Track attached debugger sessions and buffered devtools events
export const attachedTabs = new Set();
export const devtoolsBuffers = new Map(); // tabId -> { console: [], network: Map, performance: {} }
export const agentControlledTabs = new Set(); // Track tabs opened or controlled by AI Agent
export const tabLockStates = new Map(); // tabId -> { manualLock: boolean, autoCount: number, unlockTimer: any, currentAction: string }

// Chrome Native Tab Group styling constants
export const AGENT_GROUP_TITLE = "🤖 Agent Pilot";
export const AGENT_GROUP_COLOR = "cyan";

// Timeout constants
export const CDP_SCREENSHOT_TIMEOUT_MS = 12000;
export const DEFAULT_LOAD_TIMEOUT_MS = 15000;
export const DEFAULT_AGENT_PORT = 58765;

export function getTabLockState(tabId) {
  if (!tabLockStates.has(tabId)) {
    tabLockStates.set(tabId, { manualLock: false, autoCount: 0, unlockTimer: null, currentAction: "" });
  }
  return tabLockStates.get(tabId);
}

/**
 * Cross-platform URL normalizer supporting Windows/Mac/Linux local file URLs
 * as well as edge://, chrome://, brave://, and standard web protocols.
 */
export function normalizeUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (/^(https?|file|chrome|edge|brave|about|data):/i.test(trimmed)) {
    return trimmed;
  }
  return "https://" + trimmed;
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
