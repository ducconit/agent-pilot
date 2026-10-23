/** Private line-delimited IPC host. stdout is exclusively machine-readable. */
import readline from "node:readline";
import { createRequire } from "node:module";
import { Browsers } from "./browser.mjs";
import { pageCommand, accessibilitySnapshot, inlineWait } from "./pages.mjs";
import { runAudit, analyzeAudit } from "./audits.mjs";
import { performanceTrace, analyzeInsight } from "./traces.mjs";
import { screencast, stopAllRecordings } from "./video.mjs";
import { analyzeHeapSnapshot } from "./heap-analysis.mjs";
import { createPwaAdapterFromBrowser } from "./pwa.mjs";

const require = createRequire(import.meta.url);
const extensionPending = new Map();
let sequence = 0;
const send = message => process.stdout.write(JSON.stringify(message) + "\n");
function extension(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { extensionPending.delete(id); reject(new Error(`Extension command timed out: ${method}`)); }, 120000);
    extensionPending.set(id, { resolve, reject, timer });
    send({ kind: "extensionRequest", id, method, params });
  });
}
const browsers = new Browsers(extension);
const workerSessions = new Map();

async function workers(params) {
  const context = browsers.contexts.get(params.contextId);
  if (!context || context.owner !== browsers.owner(params)) throw new Error("Context not found for this agent");
  const targets = context.context.targets().filter(t => t.type() === "service_worker");
  const action = params.action || "list";
  if (action === "list") return { workers: targets.map(t => ({ serviceWorkerId: t._targetId, url: t.url() })) };
  const target = targets.find(t => t._targetId === params.serviceWorkerId);
  if (!target) throw new Error("Service worker is no longer running; list workers again");
  const key = `${params.contextId}:${params.serviceWorkerId}`;
  if (action === "detach") { await workerSessions.get(key)?.client.detach(); workerSessions.delete(key); return { success: true }; }
  if (!workerSessions.has(key)) {
    const client = await target.createCDPSession(), events = [];
    client.on("Runtime.consoleAPICalled", params => { events.push({ method: "Runtime.consoleAPICalled", params }); if (events.length > 1000) events.shift(); });
    client.on("Runtime.exceptionThrown", params => { events.push({ method: "Runtime.exceptionThrown", params }); if (events.length > 1000) events.shift(); });
    client.on("Debugger.paused", params => { events.push({ method: "Debugger.paused", params }); if (events.length > 1000) events.shift(); });
    workerSessions.set(key, { client, events }); await client.send("Runtime.enable");
  }
  const state = workerSessions.get(key);
  if (action === "console") { const events = state.events.slice(-Math.min(1000, Math.max(1, params.limit || 100))); if (params.clear) state.events.length = 0; return { events }; }
  if (action === "send") { if (!params.cdpMethod) throw new Error("cdpMethod is required"); return state.client.send(params.cdpMethod, params.cdpParams || {}); }
  if (action !== "evaluate" || !params.expression) throw new Error("Use evaluate, console, send or detach and provide the required arguments");
  const result = await state.client.send("Runtime.evaluate", { expression: params.expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return { result: result.result.value, description: result.result.description };
}

async function dispatch(method, params) {
  if (method === "devtools.runtime") return { embedded: true, nodeVersion: process.version, lighthouseVersion: require("lighthouse/package.json").version, puppeteerVersion: require("puppeteer-core/package.json").version, systemNodeRequired: false, ffmpegRequired: false };
  if (method === "memory.analyzeSnapshot") return analyzeHeapSnapshot(params);
  if (method.startsWith("pwa.")) {
    const adapter = createPwaAdapterFromBrowser(await browsers.browser(params));
    const action = method.slice(4);
    if (action === "probe") return adapter.probe(params);
    if (action === "getOsAppState") return adapter.getOsAppState(params);
    if (action === "install") return adapter.install(params);
    if (action === "launch") return adapter.launch(params);
    if (action === "uninstall") return adapter.uninstall(params);
    throw new Error(`Unsupported PWA action: ${action}`);
  }
  if (method.startsWith("contexts.")) return browsers.context(method.slice(9), params);
  if (method === "lighthouse.analyze") return analyzeAudit(params);
  if (method === "performance.analyzeInsight") return analyzeInsight(params);
  if (method === "tabs.create") return browsers.open(params);
  if (method === "workers.debug") {
    if (!params.contextId) params = { ...params, contextId: (await browsers.get(params)).contextId };
    return workers(params);
  }
  if (method === "tabs.listAll") return [...browsers.tabs.values()].filter(t => t.owner === browsers.owner(params) && (!params.contextId || t.contextId === params.contextId)).map(t => ({ id: t.tabId, tabId: t.tabId, contextId: t.contextId, url: t.page.url() }));
  if (method === "batch.run") {
    const aliases = { click: "page.click", type: "page.type", fill_form: "page.fillForm", upload: "page.uploadFile", screenshot: "page.screenshot", snapshot: "page.snapshot", evaluate: "page.evaluate", scroll: "page.scroll", hover: "page.hover", drag: "page.drag", press_key: "page.pressKey", wait_for: "page.waitFor", wait: "page.waitFor", navigate: "tabs.update", close: "tabs.remove", open: "tabs.create", emulate: "emulation.set", metrics: "performance.metrics", trace: "performance.trace", css: "css.getStyles", lighthouse: "lighthouse.audit" };
    const results = []; let tabId = params.tabId || params.agentLastTabId;
    for (const action of params.actions || []) {
      try {
        const type = action.type || action.action;
        const target = aliases[type]; if (!target) throw new Error(`Unsupported isolated batch action: ${type}`);
        const result = await dispatch(target, { ...params, ...action, tabId: action.tabId || tabId });
        if (result?.tabId) tabId = result.tabId;
        results.push({ success: true, tabId, ...(result?.closedTabId ? { closedTabId: result.closedTabId } : {}), result });
      } catch (error) { results.push({ success: false, error: error.message }); if (params.stopOnError !== false) break; }
    }
    return { success: results.every(r => r.success), results };
  }
  const tab = await browsers.get(params);
  const key = tab.key || String(tab.tabId);
  if (method === "lighthouse.audit") {
    try { return await runAudit(tab.page, params); }
    finally {
      // Extension sessions share one chrome.debugger connection. Lighthouse
      // turns domains off on disconnect; restore Puppeteer's page lifecycle.
      if (tab.transport) {
        for (const domain of ["Page", "Runtime", "DOM", "Network"]) await tab.client.send(`${domain}.enable`, {}).catch(() => {});
        await tab.client.send("Page.setLifecycleEventsEnabled", { enabled: true }).catch(() => {});
      }
    }
  }
  if (method === "performance.trace") return performanceTrace(tab.page, key, params);
  if (method === "screencast.record") return screencast(tab.page, key, params);
  if (method === "accessibility.snapshot") return accessibilitySnapshot(tab, params);
  const result = await pageCommand(tab, method, params);
  if (["page.evaluate", "tabs.update"].includes(method)) await inlineWait(tab, params);
  return result;
}

// Browser operations are serialized; protocol replies and events stay responsive
// while a long audit runs. This also protects Chrome's global trace engine state.
let queue = Promise.resolve();
const input = readline.createInterface({ input: process.stdin });
input.on("line", line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.kind === "extensionResponse") {
    const pending = extensionPending.get(message.id);
    if (pending) { clearTimeout(pending.timer); extensionPending.delete(message.id); if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result); }
    return;
  }
  if (message.kind === "extensionEvent") { browsers.event(message.event); return; }
  queue = queue.then(async () => {
    try { send({ id: message.id, result: await dispatch(message.method, message.params || {}) }); }
    catch (error) { send({ id: message.id, error: error.message }); }
  });
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  for (const pending of extensionPending.values()) { clearTimeout(pending.timer); pending.reject(new Error("MCP server closed")); }
  extensionPending.clear();
  await stopAllRecordings(); await browsers.close();
  process.exit(0);
}
input.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
