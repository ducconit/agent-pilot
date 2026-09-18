/**
 * Agent Pilot - Agent bridge handlers: DOM queries, forms, colors and screenshots.
 * Moved verbatim from bridge-client.js; behaviour must stay identical.
 */

import { LIMITS } from "../constants.js";

export const pageQueryHandlers = {
  "page.getElement": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
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
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    client.runWithTabLock(tabId, "page.snapshot", () =>
      client.sendTabMessageWithRetry(tabId, {
        action: "get_snapshot",
        maxElements: params.maxElements || LIMITS.SNAPSHOT_MAX_ELEMENTS_DEFAULT,
        format: params.format || "text"
      })
    )
      .then(res => respond(res?.result !== undefined ? res.result : (res || null)))
      .catch(err => respond(null, err));
  },

  "page.fillForm": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    client.runWithTabLock(tabId, "page.fillForm", () =>
      client.sendTabMessageWithRetry(tabId, {
        action: "fill_form",
        fields: params.fields || [],
        submitSelector: params.submitSelector || null,
        pressEnter: Boolean(params.pressEnter)
      })
    )
      .then(res => respond(res || null))
      .catch(err => respond(null, err));
  },

  "page.pickColor": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    client.runWithTabLock(tabId, "page.pickColor", () =>
      client.sendTabMessageWithRetry(tabId, { action: "pick_color", x: params.x, y: params.y })
    )
      .then(res => respond(res || null))
      .catch(err => respond(null, err));
  },

  "page.screenshot": async (client, params, respond) => {
    const tabId = await client.getTargetTabId(params.tabId);
    if (!tabId) return respond(null, new Error("No target tab found"));
    client.runWithTabLock(tabId, "page.screenshot", () =>
      client.captureTabScreenshot(tabId, params)
    )
      .then(res => respond(res))
      .catch(err => respond(null, err));
  },

  "batch.run": async (client, params, respond) => {
    // Batch actions run inside the tab lock when a target tab can be resolved,
    // so a batch cannot interleave with a concurrent single-step command.
    client.getTargetTabId(params.tabId).then(tabId => {
      if (tabId) {
        return client.runWithTabLock(tabId, "batch.run", () => client.executeBatchActions(params));
      }
      return client.executeBatchActions(params);
    })
      .then(res => respond(res))
      .catch(err => respond(null, err));
  }
};
