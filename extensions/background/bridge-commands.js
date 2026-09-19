/**
 * Agent Pilot - command/client delegation methods
 *
 * This module keeps tab-management, lock/session, batch and CDP-point helpers
 * out of the WebSocket transport. They remain methods on AgentBridgeClient so
 * existing agent handlers and background callers keep the same contract.
 */

import { getActiveTabId, getTargetTabId, assignTabToAgentGroup, markTabAsAgentControlled, ensureContentScript, sendTabMessageWithRetry, setTabLock, setTabSession, runWithTabLock } from "./tab-manager.js";
import { captureTabScreenshot } from "./screenshot-service.js";
import { executeBatchActions } from "./batch-executor.js";

export const commandMethods = {
  async getActiveTabId() {
    return await getActiveTabId();
  },

  async getTargetTabId(requestedTabId) {
    const tabId = await getTargetTabId(requestedTabId, this.lastAgentTabId);
    if (tabId) {
      this.markTabAsAgentControlled(tabId).catch((err) => console.debug("[AgentPilot] markTabAsAgentControlled error", err));
    }
    return tabId;
  },

  async markTabAsAgentControlled(tabId) {
    if (!tabId) return;
    this.lastAgentTabId = tabId;
    return await markTabAsAgentControlled(tabId);
  },

  async ensureContentScript(tabId) {
    return await ensureContentScript(tabId);
  },

  async sendTabMessageWithRetry(tabId, message, maxRetries, delayMs) {
    return await sendTabMessageWithRetry(tabId, message, maxRetries, delayMs);
  },

  async assignTabToAgentGroup(tab) {
    return await assignTabToAgentGroup(tab);
  },

  async setTabLock(tabId, busy, action = "") {
    return await setTabLock(tabId, busy, action);
  },

  async setTabSession(tabId, active, sessionName = "") {
    return await setTabSession(tabId, active, sessionName);
  },

  async runWithTabLock(tabId, actionName, runner) {
    return await runWithTabLock(tabId, actionName, runner);
  },

  async captureTabScreenshot(tabId, params = {}) {
    return await captureTabScreenshot(tabId, params);
  },

  normalizeVia(params) {
    const via = String((params && params.via) || "synthetic").toLowerCase();
    return via === "cdp" || via === "auto" ? via : "synthetic";
  },

  async resolveCdpPoint(tabId, params, label = "point") {
    const hasX = params.x !== undefined && params.x !== null && params.x !== "";
    const hasY = params.y !== undefined && params.y !== null && params.y !== "";
    if (hasX && hasY) {
      return { x: Number(params.x), y: Number(params.y) };
    }
    if (!params.selector) {
      throw new Error(`Cannot resolve ${label}: provide x/y coordinates or a selector`);
    }
    const res = await this.sendTabMessageWithRetry(tabId, {
      action: "virtual_hover",
      selector: params.selector,
      dispatchSynthetic: false
    });
    const coords = res && (res.coords || (res.x !== undefined && res.y !== undefined ? { x: res.x, y: res.y } : null));
    if (!coords || !Number.isFinite(Number(coords.x)) || !Number.isFinite(Number(coords.y))) {
      throw new Error(`Cannot resolve ${label} coordinates for selector: ${params.selector}`);
    }
    return { x: Number(coords.x), y: Number(coords.y) };
  },

  async executeBatchActions(params) {
    return await executeBatchActions(params, this);
  }
};

export function installCommandMethods(ClientClass) {
  Object.assign(ClientClass.prototype, commandMethods);
}
