/**
 * Agent Pilot - Agent bridge handlers: DOM queries, forms, colors and screenshots.
 * Moved verbatim from bridge-client.js; behaviour must stay identical.
 */

import { LIMITS, NO_TARGET_TAB_ERROR } from "../constants.js";
import { waitForTabComplete } from "../tab-manager.js";
import { assertContentReceiverAvailable } from "../page-receiver.js";
import { runInlineWait, mergeWaitMeta } from "./page-input.js";
import {
  ensureFlowRecorderHydrated,
  getFlowState,
  setFlowRecording,
  clearFlowSteps,
  exportFlowFormats,
  importFlow,
  editFlowStep,
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
      await runInlineWait(client, tabId, { ...params, includeSnapshot: false });
      const snapRes = await client.sendTabMessageWithRetry(tabId, {
        action: "get_snapshot",
        maxElements: params.maxElements || LIMITS.SNAPSHOT_MAX_ELEMENTS_DEFAULT,
        format: params.format || "text"
      });
      const resultData = snapRes?.result !== undefined ? snapRes.result : (snapRes || null);
      if (params.includeScreenshot || params.screenshot) {
        const shotRes = await client.captureTabScreenshot(tabId, {
          mode: "visible",
          annotateInteractive: true,
          somColor: params.somColor || "amber",
          maxElements: params.maxElements || LIMITS.SNAPSHOT_MAX_ELEMENTS_DEFAULT
        });
        if (typeof resultData === "string") {
          return {
            text: resultData,
            screenshot: shotRes?.dataUrl || shotRes?.path || null,
            annotated: Boolean(shotRes?.annotated),
            interactiveCount: shotRes?.interactiveCount || 0
          };
        } else if (resultData && typeof resultData === "object") {
          return {
            ...resultData,
            screenshot: shotRes?.dataUrl || shotRes?.path || null,
            annotated: Boolean(shotRes?.annotated),
            interactiveCount: shotRes?.interactiveCount || 0
          };
        }
      }
      return resultData;
    })
      .then(res => respond(res))
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
    await ensureFlowRecorderHydrated();
    setFlowRecording(tabId || params.tabId || null, params.enabled !== false, params.url || "", params.title || params.name || "")
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
      await ensureFlowRecorderHydrated();
      let diagRes = null;
      if (tabId) {
        try {
          diagRes = await client.sendTabMessageWithRetry(tabId, { action: "get_page_diagnostics" });
        } catch (_) {}
      }
      const targetKey = tabId || params.tabId || null;
      const state = getFlowState(targetKey);
      const formats = exportFlowFormats(targetKey, diagRes?.diagnostics?.environment?.url || "", params.title || params.name || "", params.steps || null);
      respond({
        tabId: targetKey,
        ...state,
        ...formats,
        diagnostics: diagRes?.diagnostics || null
      });
    } catch (err) {
      respond(null, err);
    }
  },

  "flow.replay": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    await ensureFlowRecorderHydrated();
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
      await ensureFlowRecorderHydrated();
      if (tabId) {
        await client.sendTabMessageWithRetry(tabId, { action: "get_page_diagnostics", clear: true }).catch(() => {});
      }
      respond(clearFlowSteps(tabId || params.tabId || null));
    } catch (err) {
      respond(null, err);
    }
  },

  "flow.state": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    await ensureFlowRecorderHydrated();
    respond({ tabId: tabId || params.tabId || null, ...getFlowState(tabId || params.tabId || null) });
  },

  "flow.import": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    try {
      await ensureFlowRecorderHydrated();
      const flow = params.flow || params.recording || (Array.isArray(params.steps) ? { steps: params.steps } : null);
      respond(importFlow(tabId || params.tabId || null, flow, params.title || params.name || ""));
    } catch (err) {
      respond(null, err);
    }
  },

  "flow.edit": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId, params.agentId);
    try {
      await ensureFlowRecorderHydrated();
      respond(editFlowStep(tabId || params.tabId || null, params.operation || "replace", params.stepId, params.step || params.value, params.index));
    } catch (err) {
      respond(null, err);
    }
  }
};
