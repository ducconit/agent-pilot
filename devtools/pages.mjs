import fs from "node:fs/promises";
import { applyEmulation } from "../extensions/background/cdp-emulation.js";
import { collectCssStyles } from "../extensions/background/cdp-css.js";
import { outputPath, writeArtifact } from "./artifacts.mjs";
import { normalizeUrl } from "../extensions/background/constants.js";
import { executeWebMcpTool, listWebMcpTools } from "./webmcp.mjs";

export async function element(tab, selector) {
  if (!selector) throw new Error("selector is required");
  const handle = /^@\d+$/.test(selector)
    ? (tab.refs.has(selector) ? await tab.page.mainFrame().mainRealm().adoptBackendNode(tab.refs.get(selector)) : null)
    : await tab.page.$(selector);
  if (!handle) throw new Error(`Element not found or snapshot reference expired: ${selector}`);
  return handle;
}
export async function accessibilitySnapshot(tab, params) {
  const { nodes } = await tab.client.send("Accessibility.getFullAXTree");
  tab.refs.clear();
  const result = [];
  const limit = Math.min(10000, Math.max(1, params.maxElements || 1000));
  for (const node of nodes) {
    if (node.ignored && !params.verbose) continue;
    const ref = node.backendDOMNodeId ? `@${tab.refs.size + 1}` : undefined;
    if (ref) tab.refs.set(ref, node.backendDOMNodeId);
    result.push({ ref, nodeId: node.nodeId, parentId: node.parentId, childIds: node.childIds, role: node.role?.value, name: node.name?.value, value: node.value?.value, description: node.description?.value, properties: node.properties, backendNodeId: node.backendDOMNodeId });
    if (result.length >= limit) break;
  }
  return { tabId: tab.tabId, nodes: result, truncated: result.length < nodes.filter(n => params.verbose || !n.ignored).length };
}
export async function inlineWait(tab, params) {
  if (params.waitForSelector) { const handle = await tab.page.waitForSelector(params.waitForSelector, { timeout: params.timeoutMs || 10000 }); await handle?.dispose(); }
  if (params.waitForText) await tab.page.waitForFunction(text => document.body?.innerText.includes(text), { timeout: params.timeoutMs || 10000 }, params.waitForText);
  const ms = Number(params.waitMs ?? params.sleepMs ?? params.ms) || 0;
  if (ms > 0) await new Promise(resolve => setTimeout(resolve, Math.min(ms, 120000)));
}

async function evaluateInTab(tab, expression) {
  if (!tab.transport) return tab.page.evaluate(expression);
  const result = await tab.client.send("Runtime.evaluate", {
    expression: String(expression),
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Page evaluation failed");
  }
  return result.result?.value;
}

async function discoverPageDeveloperTools(tab) {
  return evaluateInTab(tab, `(() => {
    const groups = [];
    const event = new Event("devtoolstooldiscovery");
    Object.defineProperty(event, "respondWith", { value: group => groups.push(group) });
    window.dispatchEvent(event);
    return groups.map(group => ({
      name: group?.name,
      description: group?.description,
      tools: (group?.tools || []).map(tool => ({
        name: tool?.name,
        description: tool?.description,
        inputSchema: tool?.inputSchema
      }))
    }));
  })()`);
}

async function executePageDeveloperTool(tab, params) {
  if (!params.toolName) throw new Error("toolName is required");
  let input = params.input ?? params.params ?? {};
  if (typeof input === "string") {
    try { input = JSON.parse(input || "{}"); }
    catch (error) { throw new Error(`input must be valid JSON: ${error.message}`); }
  }
  const payload = JSON.stringify({ toolName: params.toolName, input });
  return evaluateInTab(tab, `(async ({ toolName, input }) => {
    const groups = [];
    const event = new Event("devtoolstooldiscovery");
    Object.defineProperty(event, "respondWith", { value: group => groups.push(group) });
    window.dispatchEvent(event);
    const tool = groups.flatMap(group => group?.tools || []).find(candidate => candidate?.name === toolName);
    if (!tool || typeof tool.execute !== "function") throw new Error('Page developer tool not found: ' + toolName);
    return await tool.execute(input);
  })(${payload})`);
}

export async function pageCommand(tab, method, p) {
  const { page, client } = tab;
  switch (method) {
    case "page.evaluate": return evaluateInTab(tab, p.expression || p.script || p.code);
    case "webmcp.list": return listWebMcpTools(page);
    case "webmcp.execute": return executeWebMcpTool(page, p);
    case "developerTools.list": return { tools: await discoverPageDeveloperTools(tab) };
    case "developerTools.execute": return { toolName: p.toolName, result: await executePageDeveloperTool(tab, p) };
    case "tabs.update":
      tab.refs.clear();
      if (p.username !== undefined) await page.authenticate({ username: String(p.username), password: String(p.password || "") });
      if (p.url) await page.goto(normalizeUrl(p.url), { waitUntil: "load", timeout: p.timeoutMs || 30000 });
      if (p.active) await page.bringToFront();
      return { tabId: tab.tabId, id: tab.tabId, url: page.url() };
    case "tabs.remove": await page.close(); return { success: true, closedTabId: tab.tabId };
    case "page.snapshot": return accessibilitySnapshot(tab, { ...p, maxElements: p.maxElements || 80 });
    case "page.click": {
      if (p.selector) { const handle = await element(tab, p.selector); try { await handle.click({ clickCount: p.dblClick ? 2 : 1 }); } finally { await handle.dispose(); } }
      else await page.mouse.click(Number(p.x), Number(p.y));
      break;
    }
    case "page.hover": { const handle = await element(tab, p.selector); try { await handle.hover(); } finally { await handle.dispose(); } break; }
    case "page.type": {
      if (p.selector) { const handle = await element(tab, p.selector); try { await handle.focus(); } finally { await handle.dispose(); } }
      if (p.clear) { await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control"); await page.keyboard.press("Backspace"); }
      await page.keyboard.type(String(p.text || ""));
      if (p.pressEnter) await page.keyboard.press("Enter");
      break;
    }
    case "page.fillForm":
      for (const field of p.fields || []) {
        const handle = await element(tab, field.selector);
        try {
          const kind = await handle.evaluate(el => ({ tag: el.tagName, type: el.type }));
          if (kind.tag === "SELECT") await handle.select(String(field.value));
          else if (["checkbox", "radio"].includes(kind.type)) {
            if (await handle.evaluate(el => el.checked) !== Boolean(field.value)) await handle.click();
          } else {
            await handle.evaluate(el => { const setter = Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set; if (setter) setter.call(el, ""); else el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); });
            await handle.type(String(field.value));
          }
        } finally { await handle.dispose(); }
      }
      if (p.submitSelector) { const handle = await element(tab, p.submitSelector); try { await handle.click(); } finally { await handle.dispose(); } }
      else if (p.pressEnter) await page.keyboard.press("Enter");
      break;
    case "page.pressKey": {
      if (p.selector) { const handle = await element(tab, p.selector); try { await handle.focus(); } finally { await handle.dispose(); } }
      const keys = String(p.key).split("+");
      try { for (const key of keys.slice(0, -1)) await page.keyboard.down(key); await page.keyboard.press(keys.at(-1)); }
      finally { for (const key of keys.slice(0, -1).reverse()) await page.keyboard.up(key); }
      break;
    }
    case "page.scroll": await page.mouse.wheel({ deltaX: Number(p.deltaX) || 0, deltaY: Number(p.deltaY) || 0 }); break;
    case "page.drag": {
      let from = { x: p.fromX, y: p.fromY }, to = { x: p.toX, y: p.toY };
      for (const [key, selector] of [["from", p.from], ["to", p.to]]) if (selector) {
        const handle = await element(tab, selector);
        try { const box = await handle.boundingBox(); if (!box) throw new Error(`Element is not visible: ${selector}`); const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }; if (key === "from") from = point; else to = point; }
        finally { await handle.dispose(); }
      }
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      try { await page.mouse.move(to.x, to.y, { steps: Math.min(120, Math.max(2, p.steps || 12)) }); }
      finally { await page.mouse.up(); }
      break;
    }
    case "page.waitFor":
      if (p.selector) await page.waitForSelector(p.selector, { visible: p.state !== "attached" && p.state !== "hidden", hidden: p.state === "hidden", timeout: p.timeoutMs || 10000 });
      else if (p.text) await page.waitForFunction((text, hidden) => !!document.body?.innerText.includes(text) !== hidden, { timeout: p.timeoutMs || 10000 }, p.text, p.state === "hidden");
      break;
    case "page.handleDialog":
      if (!tab.dialog) throw new Error("No pending dialog");
      if (p.accept === false || p.action === "dismiss") await tab.dialog.dismiss(); else await tab.dialog.accept(p.promptText);
      tab.dialog = null; break;
    case "page.uploadFile": {
      const handle = await element(tab, p.selector);
      try { const isInput = await handle.evaluate(el => el.tagName === "INPUT" && el.type === "file");
        if (isInput) await handle.uploadFile(...p.files);
        else { const chooser = page.waitForFileChooser(); await handle.click(); await (await chooser).accept(p.files); }
      } finally { await handle.dispose(); }
      break;
    }
    case "page.screenshot": {
      await inlineWait(tab, p);
      let data;
      if (p.selector) { const handle = await element(tab, p.selector); try { data = await handle.screenshot({ type: "png" }); } finally { await handle.dispose(); } }
      else data = await page.screenshot({ type: "png", fullPage: p.mode === "full", ...(p.clip ? { clip: p.clip } : {}) });
      if (p.base64 && !p.path) return { dataUrl: `data:image/png;base64,${Buffer.from(data).toString("base64")}` };
      return writeArtifact(await outputPath(p.path || p.savePath, ".png", "screenshot"), data);
    }
    case "page.getElement": {
      const handle = await element(tab, p.selector);
      try { return await handle.evaluate((el, includeStyles) => { const rect = el.getBoundingClientRect(); return { tagName: el.tagName.toLowerCase(), text: el.textContent, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, ...(includeStyles ? { computedStyles: Object.fromEntries([...getComputedStyle(el)].map(k => [k, getComputedStyle(el).getPropertyValue(k)])) } : {}) }; }, p.includeStyles); }
      finally { await handle.dispose(); }
    }
    case "emulation.set": {
      const merged = { ...tab.emulation, ...p };
      const result = await applyEmulation((m, args) => client.send(m, args), merged);
      tab.emulation = merged; return result;
    }
    case "emulation.resize": return pageCommand(tab, "emulation.set", { viewport: { width: p.width, height: p.height, deviceScaleFactor: p.deviceScaleFactor || 1, mobile: !!p.mobile, touch: !!p.touch } });
    case "css.getStyles": {
      if (/^@\d+$/.test(p.selector || "")) p = { ...p, selector: undefined, backendNodeId: tab.refs.get(p.selector) };
      if (!tab.styleHeaders) {
        tab.styleHeaders = new Map();
        client.on("CSS.styleSheetAdded", e => tab.styleHeaders.set(e.header.styleSheetId, e.header));
        client.on("CSS.styleSheetRemoved", e => tab.styleHeaders.delete(e.styleSheetId));
      }
      return collectCssStyles((m, values) => client.send(m, values), p, tab.styleHeaders);
    }
    case "network.listRequests": {
      const requests = [...tab.requests.values()].filter(r => (!p.filterUrl || r.url.includes(p.filterUrl)) && (!p.method || r.method.toLowerCase() === p.method.toLowerCase()) && (!p.resourceType || r.type?.toLowerCase() === p.resourceType.toLowerCase()));
      return { requests: requests.slice(-Math.min(1000, p.limit || 100)), totalCaptured: tab.requests.size, matchingCount: requests.length };
    }
    case "network.getResponseBody": {
      let request = tab.requests?.get(p.requestId);
      if (!request && tab.transport?.request) {
        const captured = await tab.transport.request("network.listRequests", { tabId: tab.tabId, limit: 1000 }).catch(() => null);
        request = captured?.requests?.find(item => item.id === p.requestId);
      }
      request ||= { id: p.requestId };
      const detail = { ...request };
      if (p.includeRequestBody !== false && !detail.postData) {
        detail.postData = (await client.send("Network.getRequestPostData", { requestId: p.requestId }).catch(() => ({}))).postData;
      }
      if (p.includeResponseBody !== false) {
        const response = await client.send("Network.getResponseBody", { requestId: p.requestId });
        detail.responseBody = response.body;
        detail.base64Encoded = Boolean(response.base64Encoded);
      }
      if (p.requestFilePath && detail.postData !== undefined) {
        detail.requestFilePath = (await writeArtifact(await outputPath(p.requestFilePath, ".network-request", "network-request"), Buffer.from(String(detail.postData)))).path;
      }
      if (p.responseFilePath && detail.responseBody !== undefined) {
        const responseText = detail.base64Encoded ? Buffer.from(detail.responseBody, "base64") : Buffer.from(String(detail.responseBody));
        detail.responseFilePath = (await writeArtifact(await outputPath(p.responseFilePath, ".network-response", "network-response"), responseText)).path;
      }
      return detail;
    }
    case "devtools.getData": return { tabId: tab.tabId, console: tab.console.slice(-(p.limit || 100)), network: [...tab.requests.values()].slice(-(p.limit || 100)) };
    case "performance.metrics": await client.send("Performance.enable"); return { metrics: Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value])) };
    case "memory.collectGarbage": await client.send("HeapProfiler.collectGarbage"); break;
    case "memory.heapSnapshot": {
      if (!p.filePath) throw new Error("Provide filePath to save an isolated tab's .heapsnapshot");
      const filePath = await outputPath(p.filePath, ".heapsnapshot", "heap");
      const file = await fs.open(filePath, "wx", 0o600); let writes = Promise.resolve();
      const listener = e => { writes = writes.then(() => file.write(e.chunk)); };
      client.on("HeapProfiler.addHeapSnapshotChunk", listener);
      let garbageCollected = false;
      let garbageCollectionWarning;
      try {
        if (p.collectGarbage !== false) {
          try { await client.send("HeapProfiler.collectGarbage"); garbageCollected = true; }
          catch (error) {
            if (!/timed out|timeout|deadline exceeded/i.test(String(error?.message || error)) && /-32601|unknown method|method not found|not found|not supported|unsupported/i.test(String(error?.message || error))) {
              garbageCollectionWarning = "HeapProfiler.collectGarbage is unavailable; captured the snapshot without forced garbage collection.";
            } else throw error;
          }
        }
        try { await client.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false }); }
        catch (error) {
          const message = String(error?.message || error);
          if (/-32601|unknown method|method not found|not found|not supported|unsupported/i.test(message) && !/timed out|timeout|deadline exceeded/i.test(message)) {
            throw new Error("HEAPPROFILER_UNAVAILABLE: HeapProfiler.takeHeapSnapshot is not supported by this DevTools target");
          }
          throw error;
        }
        await writes;
      }
      finally { client.off("HeapProfiler.addHeapSnapshotChunk", listener); await file.close(); }
      return { path: filePath, bytes: (await fs.stat(filePath)).size, garbageCollected, ...(garbageCollectionWarning ? { garbageCollectionWarning } : {}) };
    }
    case "session.start": case "page.setBusy": return { success: true, tabId: tab.tabId };
    case "session.end": if (p.closeTab) await page.close(); return { success: true, tabId: tab.tabId };
    default: throw new Error(`Command not supported in an isolated context: ${method}`);
  }
  await inlineWait(tab, p);
  return { success: true, tabId: tab.tabId };
}
