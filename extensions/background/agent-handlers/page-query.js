/**
 * Agent Pilot - Agent bridge handlers: DOM queries, forms, colors and screenshots.
 * Moved verbatim from bridge-client.js; behaviour must stay identical.
 */

import { LIMITS, NO_TARGET_TAB_ERROR } from "../constants.js";
import { waitForTabComplete } from "../tab-manager.js";
import { assertContentReceiverAvailable } from "../page-receiver.js";
import { runInlineWait, mergeWaitMeta } from "./page-input.js";
import {
  getFlowState,
  setFlowRecording,
  clearFlowSteps,
  exportFlowAsBatch,
  exportFlowAsPlaywright,
  replayRecordedFlow
} from "../flow-recorder.js";

export const pageQueryHandlers = {
  "page.getElement": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    client.runWithTabLock(tabId, "page.getElement", () =>
      client.sendTabMessageWithRetry(tabId, {
        action: "get_element_info",
        selector: params.selector,
        x: params.x,
        y: params.y,
        includeStyles: Boolean(params.includeStyles)
      })
    )
      .then(res => respond(res || null))
      .catch(err => respond(null, err));
  },

  "page.snapshot": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    client.runWithTabLock(tabId, "page.snapshot", async () => {
      await assertContentReceiverAvailable(tabId, "page.snapshot");
      if (params.waitUntil !== false) {
        await waitForTabComplete(tabId, 5000);
      }
      await runInlineWait(client, tabId, params);
      return await client.sendTabMessageWithRetry(tabId, {
        action: "get_snapshot",
        maxElements: params.maxElements || LIMITS.SNAPSHOT_MAX_ELEMENTS_DEFAULT,
        format: params.format || "text"
      });
    })
      .then(res => respond(res?.result !== undefined ? res.result : (res || null)))
      .catch(err => respond(null, err));
  },

  "page.fillForm": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    client.runWithTabLock(tabId, "page.fillForm", async () => {
      const res = await client.sendTabMessageWithRetry(tabId, {
        action: "fill_form",
        fields: params.fields || [],
        submitSelector: params.submitSelector || null,
        pressEnter: Boolean(params.pressEnter)
      });
      const waitMeta = await runInlineWait(client, tabId, params);
      return mergeWaitMeta(res || null, waitMeta);
    })
      .then(res => respond(res || null))
      .catch(err => respond(null, err));
  },

  "page.pickColor": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    client.runWithTabLock(tabId, "page.pickColor", () =>
      client.sendTabMessageWithRetry(tabId, { action: "pick_color", x: params.x, y: params.y })
    )
      .then(res => respond(res || null))
      .catch(err => respond(null, err));
  },

  "page.screenshot": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    if (!tabId) return respond(null, new Error(NO_TARGET_TAB_ERROR));
    client.runWithTabLock(tabId, "page.screenshot", async () => {
      await assertContentReceiverAvailable(tabId, "page.screenshot");
      await runInlineWait(client, tabId, params);
      return await client.captureTabScreenshot(tabId, params);
    })
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "batch.run": async (client, params, respond) => {
    // Batch actions run inside the tab lock when a target tab can be resolved,
    // so a batch cannot interleave with a concurrent single-step command.
    client.getTargetTabId(params.tabId, params.agentId).then(tabId => {
      if (tabId) {
        return client.runWithTabLock(tabId, "batch.run", () => client.executeBatchActions(params));
      }
      return client.executeBatchActions(params);
    })
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "flow.record": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    setFlowRecording(tabId || params.tabId || null, params.enabled !== false, params.url || "")
      .then((res) => {
        if (res?.tabId && typeof client.registerAgentTab === "function") {
          client.registerAgentTab(res.tabId, params.agentId);
        }
        respond(res);
      })
      .catch(err => respond(null, err));
  },

  "flow.export": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    try {
      let diagRes = null;
      if (tabId) {
        try {
          diagRes = await client.sendTabMessageWithRetry(tabId, { action: "get_page_diagnostics" });
        } catch (_) {}
      }
      const targetKey = tabId || params.tabId || null;
      const state = getFlowState(targetKey);
      const batch = exportFlowAsBatch(targetKey, diagRes?.diagnostics?.environment?.url || "", "", params.steps || null);
      const playwright = exportFlowAsPlaywright(targetKey, diagRes?.diagnostics?.environment?.url || "", params.steps || null);
      respond({
        tabId: targetKey,
        ...state,
        batch,
        playwright,
        diagnostics: diagRes?.diagnostics || null
      });
    } catch (err) {
      respond(null, err);
    }
  },

  "flow.replay": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    const runReplay = () => replayRecordedFlow(tabId || params.tabId || null, params.steps || null);
    const promise = tabId
      ? client.runWithTabLock(tabId, "flow.replay", runReplay)
      : runReplay();
    promise
      .then((res) => {
        if (res?.tabId && typeof client.registerAgentTab === "function") {
          client.registerAgentTab(res.tabId, params.agentId);
        }
        respond(res);
      })
      .catch(err => respond(null, err));
  },

  "flow.clear": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    try {
      if (tabId) {
        await client.sendTabMessageWithRetry(tabId, { action: "get_page_diagnostics", clear: true }).catch(() => {});
      }
      respond(clearFlowSteps(tabId || params.tabId || null));
    } catch (err) {
      respond(null, err);
    }
  }
};
