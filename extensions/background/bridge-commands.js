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

  getAgentLastTabId(agentId = null) {
    if (agentId && typeof agentId === "string" && this.agentLastTabIds instanceof Map) {
      return this.agentLastTabIds.get(agentId) || null;
    }
    return this.lastAgentTabId || null;
  },

  recordAgentTab(tabId, agentId = null, { isOwner = false } = {}) {
    if (!tabId) return;
    if (!(this.agentLastTabIds instanceof Map)) this.agentLastTabIds = new Map();
    if (!(this.tabOwners instanceof Map)) this.tabOwners = new Map();

    if (agentId && typeof agentId === "string") {
      const existingOwner = this.tabOwners.get(tabId);
      if (existingOwner && existingOwner !== agentId) {
        // Tab is already owned by another active agent; do not overwrite ownership or hijack its affinity
        return;
      }
      this.agentLastTabIds.set(agentId, tabId);
      if (isOwner || !existingOwner) {
        this.tabOwners.set(tabId, agentId);
      }
      const currentGlobalOwner = this.lastAgentTabId ? this.tabOwners.get(this.lastAgentTabId) : null;
      if (!this.lastAgentTabId || !currentGlobalOwner || currentGlobalOwner === agentId) {
        this.lastAgentTabId = tabId;
      }
    } else {
      this.lastAgentTabId = tabId;
    }
  },

  clearAgentTab(tabId) {
    if (!tabId) return;
    if (this.lastAgentTabId === tabId) {
      this.lastAgentTabId = null;
    }
    if (this.tabOwners instanceof Map) {
      this.tabOwners.delete(tabId);
    }
    if (this.agentLastTabIds instanceof Map) {
      for (const [aid, tid] of this.agentLastTabIds.entries()) {
        if (tid === tabId) {
          this.agentLastTabIds.delete(aid);
        }
      }
    }
  },

  async getTargetTabId(requestedTabId, agentId = null, options = {}) {
    const effectiveLastTabId = this.getAgentLastTabId(agentId);
    const tabId = await getTargetTabId(requestedTabId, effectiveLastTabId, {
      ...options,
      tabOwners: this.tabOwners,
      agentId
    });
    if (tabId) {
      this.markTabAsAgentControlled(tabId, agentId).catch((err) => console.debug("[AgentPilot] markTabAsAgentControlled error", err));
    }
    return tabId;
  },

  async markTabAsAgentControlled(tabId, agentId = null, options = {}) {
    if (!tabId) return;
    this.recordAgentTab(tabId, agentId, options);
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
