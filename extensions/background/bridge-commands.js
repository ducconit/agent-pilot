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

  async getTargetTabId(requestedTabId) {
    const tabId = await getTargetTabId(requestedTabId, this.lastAgentTabId);
    if (tabId) {
      this.lastAgentTabId = tabId;
      this.markTabAsAgentControlled(tabId).catch((err) => console.debug("[AgentPilot] markTabAsAgentControlled error", err));
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
