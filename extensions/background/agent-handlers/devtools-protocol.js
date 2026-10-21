/** Raw CDP relay for the embedded Puppeteer/Lighthouse host; no debugging port. */
import { ensureCdpAttached, sendCdpCommand } from "../cdp-connection.js";
import { collectCssStyles } from "../cdp-css.js";
import { NO_TARGET_TAB_ERROR } from "../constants.js";

const relays = new Map();
const styleHeaders = new Map();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method === "CSS.styleSheetAdded") {
      if (!styleHeaders.has(source.tabId)) styleHeaders.set(source.tabId, new Map());
      styleHeaders.get(source.tabId).set(params.header.styleSheetId, params.header);
    }
    if (method === "CSS.styleSheetRemoved") styleHeaders.get(source.tabId)?.delete(params.styleSheetId);
    const relay = relays.get(source.tabId);
    if (relay) relay.broadcastFn({ type: "DEVTOOLS_PROTOCOL_EVENT", tabId: source.tabId, source, method, params });
  });
  chrome.debugger.onDetach.addListener(source => {
    const relay = relays.get(source.tabId);
    if (relay) relay.broadcastFn({ type: "DEVTOOLS_PROTOCOL_CLOSED", tabId: source.tabId });
    relays.delete(source.tabId);
    styleHeaders.delete(source.tabId);
  });
}

export const devtoolsProtocolHandlers = {
  "css.getStyles": async (client, params, respond) => {
    try {
      const tabId = await client.getTargetTabId(params.tabId, params.agentId);
      if (!tabId) throw new Error(NO_TARGET_TAB_ERROR);
      listen();
      await ensureCdpAttached(tabId, client.broadcastFn);
      if (!styleHeaders.has(tabId)) styleHeaders.set(tabId, new Map());
      if (/^@\d+$/.test(params.selector || "")) {
        const info = await client.sendTabMessageWithRetry(tabId, { action: "get_element_info", selector: params.selector });
        const selector = (info.details || info)?.selector;
        if (!selector) throw new Error(`Snapshot reference not found: ${params.selector}`);
        params = { ...params, selector };
      }
      const result = await client.runWithTabLock(tabId, "css.getStyles", () => collectCssStyles((method, values) => sendCdpCommand(tabId, method, values), params, styleHeaders.get(tabId)));
      respond({ tabId, ...result });
    } catch (error) { respond(null, error); }
  },
  "devtools.protocol.open": async (client, params, respond) => {
    try {
      const tabId = await client.getTargetTabId(params.tabId, params.agentId);
      if (!tabId) throw new Error(NO_TARGET_TAB_ERROR);
      listen();
      await ensureCdpAttached(tabId, client.broadcastFn);
      relays.set(tabId, client);
      const tab = await chrome.tabs.get(tabId);
      respond({ tabId, url: tab.url, title: tab.title, userAgent: navigator.userAgent });
    } catch (error) { respond(null, error); }
  },
  "devtools.protocol.send": async (client, params, respond) => {
    try {
      const tabId = await client.getTargetTabId(params.tabId, params.agentId);
      if (!tabId || !relays.has(tabId)) throw new Error("DevTools relay is not open");
      const target = { tabId, ...(params.sessionId ? { sessionId: params.sessionId } : {}) };
      const result = await chrome.debugger.sendCommand(target, params.cdpMethod, params.cdpParams || {});
      respond(result || {});
    } catch (error) { respond(null, error); }
  },
  "devtools.protocol.close": async (client, params, respond) => {
    const tabId = Number(params.tabId);
    relays.delete(tabId);
    // Lighthouse disables domains on cleanup. Restore native telemetry.
    await Promise.all(["Runtime", "Network", "Page", "DOM", "Performance"].map(domain => sendCdpCommand(tabId, `${domain}.enable`, {}).catch(() => {})));
    respond({ success: true });
  }
};
