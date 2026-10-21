/** Attach to service-worker targets without relying on a remote-debugging port. */
const workers = new Map();
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const state = workers.get(source.targetId);
    if (!state) return;
    if (method.startsWith("Runtime.") || method.startsWith("Debugger.")) {
      state.events.push({ method, params, timestamp: Date.now() });
      if (state.events.length > 1000) state.events.shift();
    }
  });
  chrome.debugger.onDetach.addListener(source => workers.delete(source.targetId));
}

export const serviceWorkerHandlers = {
  "workers.debug": async (client, params, respond) => {
    try {
      listen();
      // chrome.debugger calls service-worker targets "worker" on some Chrome
      // versions; CDP/Puppeteer call the same targets "service_worker".
      const targets = (await chrome.debugger.getTargets()).filter(t => ["service_worker", "worker", "shared_worker"].includes(t.type) && !t.url?.startsWith(chrome.runtime.getURL("")));
      const action = params.action || "list";
      if (action === "list") return respond({ workers: targets.map(t => ({ serviceWorkerId: t.id, type: t.type, url: t.url, title: t.title, attached: workers.has(t.id) })) });
      const targetId = params.serviceWorkerId;
      const target = targets.find(t => t.id === targetId);
      if (!target) throw new Error("Service worker target not found or no longer running; list workers again");
      const debuggee = { targetId };
      if (action === "detach") {
        if (workers.has(targetId)) await chrome.debugger.detach(debuggee);
        workers.delete(targetId);
        return respond({ success: true, serviceWorkerId: targetId });
      }
      if (!["evaluate", "console", "send"].includes(action)) throw new Error(`Unknown worker action: ${action}`);
      if (!workers.has(targetId)) {
        await chrome.debugger.attach(debuggee, "1.3");
        workers.set(targetId, { events: [] });
        await chrome.debugger.sendCommand(debuggee, "Runtime.enable", {});
      }
      if (action === "console") {
        const events = workers.get(targetId).events;
        const result = events.slice(-Math.min(1000, Math.max(1, Number(params.limit) || 100)));
        if (params.clear) events.length = 0;
        return respond({ serviceWorkerId: targetId, events: result });
      }
      if (action === "send") {
        if (!params.cdpMethod) throw new Error("cdpMethod is required");
        return respond(await chrome.debugger.sendCommand(debuggee, params.cdpMethod, params.cdpParams || {}));
      }
      if (!params.expression) throw new Error("expression is required");
      const result = await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", { expression: params.expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      respond({ serviceWorkerId: targetId, result: result.result.value, description: result.result.description });
    } catch (error) { respond(null, error); }
  }
};
