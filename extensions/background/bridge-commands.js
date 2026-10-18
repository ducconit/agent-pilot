/**
 * Agent Pilot - command/client delegation methods
 *
 * This module keeps tab-management, lock/session, batch and CDP-point helpers
 * out of the WebSocket transport. They remain methods on AgentBridgeClient so
 * existing agent handlers and background callers keep the same contract.
 */

import {
  getActiveTabId,
  getTargetTabId,
  getAgentGroupIds,
  isTabInAgentGroup,
  getAgentGroupTabs,
  assignTabToAgentGroup,
  markTabAsAgentControlled,
  ensureContentScript,
  sendTabMessageWithRetry,
  setTabLock,
  setTabSession,
  runWithTabLock
} from "./tab-manager.js";
import { captureTabScreenshot } from "./screenshot-service.js";
import { executeBatchActions } from "./batch-executor.js";
import { normalizeVia, resolvePoint } from "./batch-validation.js";

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

  async isTabInAgentGroup(tab) {
    return await isTabInAgentGroup(tab);
  },

  async getAgentGroupIds() {
    return await getAgentGroupIds();
  },

  async getAgentGroupTabs() {
    return await getAgentGroupTabs();
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
    return normalizeVia(params);
  },

  async resolveCdpPoint(tabId, params = {}, label = "point") {
    return await resolvePoint(tabId, params.x, params.y, params.selector, label);
  },

  async executeBatchActions(params) {
    return await executeBatchActions(params, this);
  }
};

export function installCommandMethods(ClientClass) {
  Object.assign(ClientClass.prototype, commandMethods);
}
