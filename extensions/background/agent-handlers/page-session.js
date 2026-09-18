/**
 * Agent Pilot - Agent bridge handlers: agent session/lock, dialogs
 * Moved verbatim from bridge-client.js; behaviour must stay identical.
 */

import { attachedTabs, logDebug } from "../constants.js";
import { handleJavaScriptDialog, getActiveDialog, attachDebugger } from "../cdp-manager.js";

export const pageSessionHandlers = {
  "page.handleDialog": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    if (!attachedTabs.has(tabId)) {
      await attachDebugger(tabId, client.broadcastFn);
    }
    handleJavaScriptDialog(tabId, params.accept !== false, params.promptText || "")
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "dialog.getActive": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    respond({ dialog: getActiveDialog(tabId) });
  },

  "page.setBusy": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    // session !== undefined switches to "agent session" semantics (persistent lock)
    if (params.session !== undefined) {
      const res = await client.setTabSession(tabId, params.session !== false, params.action || params.name || "");
      respond(res || { success: true, tabId, sessionActive: params.session !== false });
      return;
    }
    const res = await client.setTabLock(tabId, params.busy !== false, params.action || "");
    respond(res || { success: true });
  },

  "session.start": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    const sessionName = params.name || params.action || "Session đang hoạt động";
    const res = await client.setTabSession(tabId, true, sessionName);
    respond(res || { success: true, tabId, sessionActive: true, sessionName });
  },

  "session.end": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    const res = await client.setTabSession(tabId, false);
    respond(res || { success: true, tabId, sessionActive: false });
  },

  "session.status": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    const pingRes = await client.sendTabMessageWithRetry(tabId, { action: "ping" }).catch((err) => {
      logDebug("session.status ping error", err);
      return null;
    });
    respond({
      success: true,
      tabId,
      sessionActive: Boolean(pingRes?.isSessionActive),
      isAgentBusy: Boolean(pingRes?.isAgentBusy),
      isAgentTab: Boolean(pingRes?.isAgentTab)
    });
  }
};
