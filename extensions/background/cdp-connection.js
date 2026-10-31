/**
 * Agent Pilot - CDP Connection & Session Lifecycle
 *
 * Owns the single chrome.debugger session used to drive a tab: raw command
 * dispatch, domain enablement, attach/detach, and the reconciliation pass that
 * recovers our in-memory bookkeeping after a service-worker (SW) restart.
 *
 * All higher-level CDP features (input, network, page, performance, events)
 * live in sibling modules and build on `sendCdpCommand`.
 */

import {
  attachedTabs,
  CDP_PROTOCOL_VERSION,
  TIMEOUTS,
  logDebug,
  getBuffer,
  cleanupDebuggerState
} from "./constants.js";

/**
 * Best-effort enablement of the CDP domains the extension listens to.
 * Enables run in parallel and each failure is swallowed individually: some
 * domains/methods are unavailable on certain targets, and one failing enable
 * must not tear down the session we just attached.
 * Note: `Console.enable` is intentionally omitted because `Runtime.enable`
 * already emits `Runtime.consoleAPICalled` (enabling both duplicates every log).
 */
async function enableCdpDomains(tabId) {
  try {
    await Promise.all([
      sendCdpCommand(tabId, "Runtime.enable", {}, TIMEOUTS.CDP_DOMAIN_ENABLE_MS).catch((e) => logDebug("Runtime.enable", e)),
      sendCdpCommand(tabId, "Network.enable", {}, TIMEOUTS.CDP_DOMAIN_ENABLE_MS).catch((e) => logDebug("Network.enable", e)),
      sendCdpCommand(tabId, "Performance.enable", {}, TIMEOUTS.CDP_DOMAIN_ENABLE_MS).catch((e) => logDebug("Performance.enable", e)),
      sendCdpCommand(tabId, "Page.enable", {}, TIMEOUTS.CDP_DOMAIN_ENABLE_MS).catch((e) => logDebug("Page.enable", e)),
      sendCdpCommand(tabId, "DOM.enable", {}, TIMEOUTS.CDP_DOMAIN_ENABLE_MS).catch((e) => logDebug("DOM.enable", e)),
      sendCdpCommand(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }, TIMEOUTS.CDP_DOMAIN_ENABLE_MS).catch((e) => logDebug("Emulation.setFocusEmulationEnabled", e))
    ]);
  } catch (err) {
    console.warn("[AgentPilot] Error enabling CDP domains:", err);
  }
}

/**
 * Raw probe that deliberately bypasses the attachedTabs guard.
 *
 * A debugger session can outlive our service worker: after an SW restart
 * `attachedTabs` is empty, yet chrome.debugger is still attached and busy, so a
 * fresh attach fails with "Another debugger is already attached". This probe
 * asks the browser directly (a throwaway Runtime.evaluate) whether THIS
 * extension still owns a live session — the only reliable signal — which is why
 * it cannot consult `attachedTabs`. Resolves true on success, false on error or
 * once `timeoutMs` elapses.
 */
function probeOwnedDebuggerSession(tabId, timeoutMs = TIMEOUTS.CDP_SESSION_PROBE_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (owned) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(owned);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", { expression: "1", returnByValue: true }, () => {
        finish(!chrome.runtime.lastError);
      });
    } catch (_) {
      finish(false);
    }
  });
}

let reconcilePromise = null;

/**
 * Reconcile in-memory CDP bookkeeping with the browser after a service-worker restart.
 * Attached sessions survive SW eviction, but our maps do not, which previously made
 * re-attach fail with "Another debugger is already attached" indefinitely.
 *
 * Strategy: enumerate the browser's debugger targets, and for every attached tab
 * we do not already know about, PROBE whether the session is ours; if it is,
 * ADOPT it by re-registering it in `attachedTabs` and re-enabling the domains.
 * Concurrent callers share a single in-flight pass via `reconcilePromise`, so a
 * burst of attaches does not trigger repeated chrome.debugger enumerations.
 */
export async function reconcileDebuggerState() {
  if (reconcilePromise) return reconcilePromise;
  reconcilePromise = (async () => {
    try {
      const targets = await new Promise((resolve) => {
        try {
          chrome.debugger.getTargets((result) => resolve(Array.isArray(result) ? result : []));
        } catch (_) {
          resolve([]);
        }
      });
      for (const target of targets) {
        if (!target || !target.attached) continue;
        if (target.tabId === undefined || target.tabId === null || target.tabId < 0) continue;
        if (attachedTabs.has(target.tabId)) continue;
        const owned = await probeOwnedDebuggerSession(target.tabId);
        if (owned) {
          attachedTabs.add(target.tabId);
          getBuffer(target.tabId);
          await enableCdpDomains(target.tabId);
          logDebug("reconcileDebuggerState adopted tab", target.tabId);
        }
      }
    } catch (err) {
      logDebug("reconcileDebuggerState", err);
    } finally {
      reconcilePromise = null;
    }
  })();
  return reconcilePromise;
}

const inFlightAttaches = new Map();
const inFlightDetaches = new Map();

/**
 * Attach Chrome DevTools Protocol (CDP) to a tab.
 * Resolves (never rejects) with { success:false, error } on failure so callers
 * such as ensureCdpAttached can translate it into a CDP_UNAVAILABLE error.
 */
export async function attachDebugger(tabId, broadcastFn = null) {
  if (inFlightAttaches.has(tabId)) return inFlightAttaches.get(tabId);
  if (inFlightDetaches.has(tabId)) {
    try { await inFlightDetaches.get(tabId); } catch (_) {}
  }

  const attachPromise = (async () => {
    if (attachedTabs.has(tabId)) return { success: true, message: "Already attached" };

    // Guard: reject attaching to restricted internal schemes
    try {
      if (typeof chrome !== "undefined" && chrome.tabs?.get) {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.url && /^(?:chrome|chrome-extension|devtools|edge|brave):/i.test(tab.url)) {
          return { success: false, error: `Cannot attach debugger to restricted internal page (${tab.url})` };
        }
      }
    } catch (_) {}

    await reconcileDebuggerState();
    if (attachedTabs.has(tabId)) {
      return { success: true, message: "Reconciled existing session", reconciled: true };
    }

    return await new Promise((resolve) => {
      chrome.debugger.attach({ tabId }, CDP_PROTOCOL_VERSION, async () => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message || "Failed to attach debugger";
          if (/already attached/i.test(errorMessage)) {
            // Might be our own session surviving a service-worker restart
            const owned = await probeOwnedDebuggerSession(tabId);
            if (owned) {
              attachedTabs.add(tabId);
              getBuffer(tabId);
              await enableCdpDomains(tabId);
              if (typeof broadcastFn === "function") {
                broadcastFn({ type: "DEBUGGER_STATUS_CHANGED", tabId, attached: true, reconciled: true });
              }
              resolve({ success: true, tabId, reconciled: true });
              return;
            }
          }
          resolve({ success: false, error: errorMessage });
          return;
        }

        attachedTabs.add(tabId);
        getBuffer(tabId);
        await enableCdpDomains(tabId);

        if (typeof broadcastFn === "function") {
          broadcastFn({
            type: "DEBUGGER_STATUS_CHANGED",
            tabId,
            attached: true
          });
        }

        resolve({ success: true, tabId });
      });
    });
  })();

  inFlightAttaches.set(tabId, attachPromise);
  attachPromise.finally(() => {
    if (inFlightAttaches.get(tabId) === attachPromise) {
      inFlightAttaches.delete(tabId);
    }
  });
  return attachPromise;
}

/**
 * Detach CDP from tab.
 * Treats "not attached"/"no debugger" as an already-detached success so callers
 * stay idempotent, then clears local state and notifies listeners.
 */
export async function detachDebugger(tabId, broadcastFn = null) {
  if (inFlightDetaches.has(tabId)) return inFlightDetaches.get(tabId);
  if (inFlightAttaches.has(tabId)) {
    try { await inFlightAttaches.get(tabId); } catch (_) {}
  }

  const detachPromise = (async () => {
    if (!attachedTabs.has(tabId)) return { success: true };
    return await new Promise((resolve) => {
      chrome.debugger.detach({ tabId }, () => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message || "Failed to detach debugger";
          if (!/not attached|no debugger/i.test(errorMessage)) {
            resolve({ success: false, error: errorMessage });
            return;
          }
        }
        cleanupDebuggerState(tabId);
        if (typeof broadcastFn === "function") {
          broadcastFn({
            type: "DEBUGGER_STATUS_CHANGED",
            tabId,
            attached: false
          });
        }
        resolve({ success: true });
      });
    });
  })();

  inFlightDetaches.set(tabId, detachPromise);
  detachPromise.finally(() => {
    if (inFlightDetaches.get(tabId) === detachPromise) {
      inFlightDetaches.delete(tabId);
    }
  });
  return detachPromise;
}

/**
 * Send arbitrary command to CDP.
 * Rejects immediately when the tab is not attached, and rejects (rather than
 * hangs) if the browser never answers within `timeoutMs`.
 */
export function sendCdpCommand(tabId, method, params = {}, timeoutMs = TIMEOUTS.CDP_COMMAND_MS) {
  return new Promise((resolve, reject) => {
    if (!attachedTabs.has(tabId)) {
      return reject(new Error("Debugger not attached to tab " + tabId));
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (timedOut) return;
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Ensure the debugger is attached, throwing a clear CDP_UNAVAILABLE error otherwise.
 * attachDebugger resolves (never rejects) with { success:false, error } on failure.
 */
export async function ensureCdpAttached(tabId, broadcastFn = null) {
  const res = await attachDebugger(tabId, broadcastFn);
  if (!res || res.success === false) {
    const reason = res && res.error ? res.error : "cannot attach debugger";
    const err = new Error(
      `CDP_UNAVAILABLE: ${reason}. Hint: close DevTools, allow the debugger permission, or retry with --via auto/synthetic.`
    );
    err.code = "CDP_UNAVAILABLE";
    throw err;
  }
  return res;
}
