/**
 * Agent Pilot - Agent bridge handlers: Chrome DevTools Protocol control
 * Moved verbatim from bridge-client.js; behaviour must stay identical.
 */

import { attachedTabs, NO_TARGET_TAB_ERROR } from "../constants.js";
import { attachDebugger, detachDebugger, sendCdpCommand } from "../cdp-manager.js";

export const cdpHandlers = {
  "cdp.attach": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    const res = await attachDebugger(tabId, client.broadcastFn);
    respond(res);
  },

  "cdp.detach": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    const res = await detachDebugger(tabId, client.broadcastFn);
    respond(res);
  },

  "cdp.status": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    const status = await attachDebugger(tabId, client.broadcastFn).catch((err) => ({
      success: false,
      error: err && err.message ? err.message : String(err)
    }));
    if (!status || status.success === false) {
      respond({
        success: true,
        attached: false,
        tabId,
        error: (status && status.error) || "unknown",
        hint: "Close DevTools, allow the debugger permission, or use --via auto/synthetic."
      });
      return;
    }
    respond({ success: true, attached: true, tabId });
  },

  "cdp.send": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    const cdpMethod = params.cdpMethod || params.method || params.action;
    if (!cdpMethod) return respond(null, new Error("Missing CDP method (cdpMethod or method)"));
    const cdpParams = params.cdpParams || params.commandParams || params.params || {};
    if (!attachedTabs.has(tabId)) {
      const attachRes = await attachDebugger(tabId, client.broadcastFn);
      if (!attachRes || attachRes.success === false) {
        return respond(
          null,
          new Error(
            `CDP_UNAVAILABLE: ${(attachRes && attachRes.error) || "cannot attach debugger"}. Hint: close DevTools, allow the debugger permission, or use --via auto/synthetic.`
          )
        );
      }
    }
    sendCdpCommand(tabId, cdpMethod, cdpParams)
      .then(res => respond(res || { success: true }))
      .catch(err => respond(null, err));
  }
};
