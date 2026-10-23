/** Real Chrome integration coverage for the extension relay and private host. */
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { launchExtensionBrowser, waitForServiceWorker } from "./lib/harness.mjs";
import { applyEmulation } from "../extensions/background/cdp-emulation.js";
import { pageCommand } from "../devtools/pages.mjs";
import { ROOT_DIR } from "./lib/config.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "agent-pilot-devtools-test-"));
let child, browserHandle, socket, sequence = 0;
const pending = new Map(), hostPending = new Map();
const server = http.createServer((req, res) => {
  if (req.url === "/worker.js") {
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end("self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.testValue=42;"); return;
  }
  if (req.url === "/echo") { let body = ""; req.on("data", chunk => { body += chunk; }); req.on("end", () => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ custom: req.headers["x-ap-test"], cookie: req.headers.cookie, body })); }); return; }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html lang="en"><head><title>DevTools fixture</title><meta name="viewport" content="width=device-width"><style>
    @layer base, theme; @layer base { #target { color: red; margin: 4px } } @layer theme { #target { color: blue } }
    body { font-family: sans-serif; background: white; color: #444 } #target { color: green !important } .unused { color: purple }
    </style></head><body><main><h1>DevTools fixture</h1><p id="target">Inspectable content</p><label for="name">Name</label><input id="name"><button id="go" onclick="document.querySelector('#target').textContent='Clicked'">Go</button><img src="/missing.png"></main>
    <script>
      window.addEventListener('devtoolstooldiscovery', event => event.respondWith({
        name: 'Fixture developer tools',
        description: 'Tools exposed only by this test page',
        tools: [{
          name: 'count_buttons',
          description: 'Count buttons in the fixture',
          inputSchema: { type: 'object' },
          execute: () => document.querySelectorAll('button').length
        }, {
          name: 'echo_input',
          description: 'Return the supplied input',
          inputSchema: { type: 'object' },
          execute: input => ({ input })
        }]
      }));
      navigator.serviceWorker.register('/worker.js');
    </script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise(resolve => wss.once("listening", resolve));
let connected;
const connection = new Promise(resolve => { connected = resolve; });
wss.on("connection", ws => {
  socket = ws;
  ws.on("message", raw => {
    const message = JSON.parse(String(raw));
    if (message.type === "HANDSHAKE") connected();
    if (message.type?.startsWith("DEVTOOLS_PROTOCOL_")) child?.stdin.write(JSON.stringify({ kind: "extensionEvent", event: { ...message, instanceId: "test" } }) + "\n");
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result); }
  });
});
function extension(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Extension timeout: ${method}`)); }, 90000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
function host(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { hostPending.delete(id); reject(new Error(`Host timeout: ${method}`)); }, 150000);
    hostPending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params: { agentId: "test-agent", instanceId: "test", ...params } }) + "\n");
  });
}
let checks = 0;
async function test(name, work) { await work(); checks++; console.log(`PASS ${name}`); }

try {
  // Validate requests atomically before changing any emulation state.
  await test("invalid emulation does not partially apply settings", async () => {
    const sent = [];
    await assert.rejects(applyEmulation((...args) => sent.push(args), { cpuThrottlingRate: 4, geolocation: "200,0" }), /geolocation/);
    assert.equal(sent.length, 0);
  });
  // Give this temporary extension its own default port before it starts, so a
  // user's running bridge is never selected or affected by the test browser.
  const extensionsDir = path.join(temporary, "extensions");
  await fs.cp(path.join(ROOT_DIR, "extensions"), extensionsDir, { recursive: true });
  const constantsPath = path.join(extensionsDir, "background", "constants.js");
  const constants = await fs.readFile(constantsPath, "utf8");
  await fs.writeFile(constantsPath, constants.replace("export const DEFAULT_AGENT_PORT = 58765;", `export const DEFAULT_AGENT_PORT = ${wss.address().port};`));
  browserHandle = await launchExtensionBrowser({ extensionsDir });
  const target = await waitForServiceWorker(browserHandle.browser);
  if (!target) {
    const diagnostics = await browserHandle.browser.newPage(); await diagnostics.goto("chrome://extensions");
    console.error(await diagnostics.evaluate(async () => chrome.developerPrivate ? chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }) : document.body.innerText));
    throw new Error("Extension service worker did not load");
  }
  await Promise.race([connection, new Promise((_, reject) => setTimeout(() => reject(new Error("Extension did not connect")), 20000))]);
  child = spawn(process.execPath, ["devtools/runner.mjs"], { env: { ...process.env, AGENT_PILOT_ARTIFACT_DIR: temporary, AGENT_PILOT_TEST_NO_SANDBOX: "1" }, stdio: ["pipe", "pipe", "inherit"] });
  readline.createInterface({ input: child.stdout }).on("line", async line => {
    const message = JSON.parse(line);
    if (message.kind === "extensionRequest") {
      try { child.stdin.write(JSON.stringify({ kind: "extensionResponse", id: message.id, result: await extension(message.method, message.params) }) + "\n"); }
      catch (error) { child.stdin.write(JSON.stringify({ kind: "extensionResponse", id: message.id, error: error.message }) + "\n"); }
      return;
    }
    const request = hostPending.get(message.id);
    if (request) { hostPending.delete(message.id); clearTimeout(request.timer); if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result); }
  });
  const opened = await extension("tabs.create", { url, agentId: "test-agent" });
  const tabId = opened.id;
  await test("CSS summary is compact and reports direct/inherited sources", async () => {
    const result = await extension("css.getStyles", { tabId, selector: "#target" });
    assert.equal(result.detail, "summary");
    assert(result.computed.display);
    assert(result.matchedRules.direct >= 1);
    assert(Array.isArray(result.inheritance.inheritedSources));
    assert(!result.computed["--agent-pilot-nonexistent"]);
  });
  await test("matched CSS includes cascade, source lines and Chrome computed values", async () => {
    const result = await extension("css.getStyles", { tabId, selector: "#target", detail: "full", pageSize: 100 });
    assert.equal(result.computed.color, "rgb(0, 128, 0)");
    assert(result.rules.some(r => r.declarations.some(p => p.name === "color" && p.important)));
    assert(result.rules.some(r => r.line > 0));
    assert(result.rules.some(r => r.layer));
  });
  await test("extended emulation applies and preserves media settings", async () => {
    await extension("emulation.set", { tabId, colorScheme: "dark", prefersReducedMotion: "reduce", networkConditions: "fast-4g", geolocation: "13.75,100.5", extraHttpHeaders: { "X-AP-Test": "present" } });
    await extension("emulation.set", { tabId, prefersContrast: "more" });
    const result = await extension("page.evaluate", { tabId, expression: "({dark:matchMedia('(prefers-color-scheme: dark)').matches,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,contrast:matchMedia('(prefers-contrast: more)').matches})" });
    assert.deepEqual(result, { dark: true, reduced: true, contrast: true });
    const echo = await extension("page.evaluate", { tabId, expression: "fetch('/echo').then(r=>r.json())" });
    assert.equal(echo.custom, "present");
    await extension("emulation.set", { tabId, colorScheme: "auto", prefersReducedMotion: "auto", prefersContrast: "auto", networkConditions: "none", geolocation: null, extraHttpHeaders: {} });
  });
  await test("relay reads Chrome's actual accessibility tree", async () => {
    const tree = await host("accessibility.snapshot", { tabId });
    assert(tree.nodes.some(n => n.role === "heading" && n.name === "DevTools fixture"));
    assert(tree.nodes.some(n => n.backendNodeId));
    const button = tree.nodes.find(n => n.role === "button");
    const styles = await extension("css.getStyles", { tabId, backendNodeId: button.backendNodeId, detail: "computed", groups: ["layout"] });
    assert(styles.computed.display);
  });
  await test("page developer tools are discoverable and executable", async () => {
    const discovered = await host("developerTools.list", { tabId });
    const tools = discovered.tools.flatMap(group => group.tools || []);
    assert(tools.some(tool => tool.name === "count_buttons"));
    const executed = await host("developerTools.execute", { tabId, toolName: "echo_input", input: { value: "ok" } });
    assert.deepEqual(executed.result, { input: { value: "ok" } });
  });
  await test("network detail returns request and response bodies and writes artifacts", async () => {
    await extension("page.evaluate", { tabId, expression: "fetch('/echo',{method:'POST',headers:{'Content-Type':'text/plain'},body:'hello'}).then(r=>r.text())" });
    const captured = await extension("network.listRequests", { tabId, method: "POST", resourceType: "Fetch", limit: 20 });
    const request = captured.requests.find(item => item.url.endsWith("/echo"));
    assert(request, JSON.stringify(captured));
    assert.equal(request.postData, undefined, "network list should not retain or relay request bodies");
    const detail = await host("network.getResponseBody", {
      tabId,
      requestId: request.id,
      requestFilePath: path.join(temporary, "request.network-request"),
      responseFilePath: path.join(temporary, "response.network-response")
    });
    assert.equal(detail.postData, "hello");
    assert.equal(JSON.parse(detail.responseBody).body, "hello");
    assert.equal(await fs.readFile(detail.requestFilePath, "utf8"), "hello");
    assert.equal(JSON.parse(await fs.readFile(detail.responseFilePath, "utf8")).body, "hello");
  });
  let audit;
  await test("Lighthouse audits the existing tab and saves real HTML/JSON reports", async () => {
    audit = await host("lighthouse.audit", { tabId, mode: "snapshot", device: "desktop" });
    assert.equal(typeof audit.scores.accessibility, "number");
    assert((await fs.readFile(audit.htmlPath, "utf8")).includes("Lighthouse"));
    const report = JSON.parse(await fs.readFile(audit.jsonPath));
    assert(report.lighthouseVersion && report.audits);
  });
  await test("Lighthouse drill-down resolves audit nodes and saved reports", async () => {
    const failures = await host("lighthouse.analyze", { reportId: audit.reportId, pageSize: 100 });
    assert(failures.audits.length > 0);
    const details = await host("lighthouse.analyze", { filePath: audit.jsonPath, auditId: failures.audits[0].id, pageSize: 1 });
    assert.equal(details.id, failures.audits[0].id);
    assert(details.description);
  });
  await test("complete trace exceeds 2,000 events and supports DevTools insight drill-down", async () => {
    await host("performance.trace", { tabId, action: "start", reload: true });
    await extension("page.evaluate", { tabId, expression: "(()=>{for(let i=0;i<3000;i++){document.body.style.paddingLeft=(i%5)+'px';void document.body.offsetHeight;}return true})()" });
    const trace = await host("performance.trace", { tabId, action: "stop" });
    assert(trace.totalEvents > 2000, `Expected >2,000 events, got ${trace.totalEvents}`);
    assert.equal(trace.truncated, false);
    assert(!trace.analysisError, trace.analysisError);
    assert(trace.insightSets.length > 0);
    const set = trace.insightSets[0];
    const insight = await host("performance.analyzeInsight", { traceId: trace.traceId, insightSetId: set.insightSetId, insightName: set.insights[0].name });
    assert(insight.model);
  });
  await test("MP4 recording uses Chrome directly without FFmpeg", async () => {
    await host("screencast.record", { tabId, action: "start", fps: 10 });
    await extension("page.evaluate", { tabId, expression: "new Promise(r=>{let n=0;let t=setInterval(()=>{document.body.style.backgroundColor=(n++%2?'red':'white');if(n>8){clearInterval(t);r(true)}},100)})" });
    const video = await host("screencast.record", { tabId, action: "stop" });
    assert(video.bytes > 1000);
    assert((await fs.readFile(video.path)).subarray(0, 32).includes(Buffer.from("ftyp")));
  });
  await test("native service-worker debugging captures async evaluation and console", async () => {
    await extension("page.evaluate", { tabId, expression: "navigator.serviceWorker.ready.then(r=>{r.active.postMessage('wake');return true})" });
    const list = await extension("workers.debug", { action: "list" });
    const worker = list.workers.find(w => w.url === url + "worker.js"); assert(worker, JSON.stringify(list));
    const result = await extension("workers.debug", { action: "evaluate", serviceWorkerId: worker.serviceWorkerId, expression: "console.log('worker-debug-test');Promise.resolve(self.testValue)" });
    assert.equal(result.result, 42);
    const logs = await extension("workers.debug", { action: "console", serviceWorkerId: worker.serviceWorkerId });
    assert(logs.events.some(e => e.method === "Runtime.consoleAPICalled"));
    await extension("workers.debug", { action: "detach", serviceWorkerId: worker.serviceWorkerId });
  });
  const a = await host("contexts.create", { name: "A", headless: true });
  const b = await host("contexts.create", { name: "B", headless: true });
  const ta = await host("tabs.create", { contextId: a.contextId, url });
  const tb = await host("tabs.create", { contextId: b.contextId, url });
  await test("embedded runtime lists requests without bodies and loads them only on detail", async () => {
    await host("page.evaluate", { tabId: ta.tabId, expression: "fetch('/echo',{method:'POST',headers:{'Content-Type':'text/plain'},body:'isolated-body'}).then(r=>r.text())" });
    const captured = await host("network.listRequests", { tabId: ta.tabId, method: "POST", resourceType: "Fetch", limit: 20 });
    const request = captured.requests.find(item => item.url.endsWith("/echo"));
    assert(request, JSON.stringify(captured));
    assert.equal(request.postData, undefined, "isolated network listing should not retain request bodies");
    const detail = await host("network.getResponseBody", { tabId: ta.tabId, requestId: request.id, includeResponseBody: false });
    assert.equal(detail.postData, "isolated-body");
    assert.equal(detail.responseBody, undefined);
    const metadataOnly = await host("network.getResponseBody", { tabId: ta.tabId, requestId: request.id, includeRequestBody: false, includeResponseBody: false });
    assert.equal(metadataOnly.postData, undefined, "includeRequestBody=false must avoid the CDP body request");
  });
  await test("contexts truly isolate cookies, localStorage and IndexedDB", async () => {
    await host("page.evaluate", { tabId: ta.tabId, expression: "document.cookie='login=alice';localStorage.setItem('login','alice');new Promise(r=>{const q=indexedDB.open('alice-db',1);q.onsuccess=()=>{q.result.close();r(true)}})" });
    const result = await host("page.evaluate", { tabId: tb.tabId, expression: "indexedDB.databases().then(dbs=>({cookie:document.cookie,storage:localStorage.getItem('login'),databases:dbs.map(d=>d.name)}))" });
    assert.equal(result.cookie, ""); assert.equal(result.storage, null); assert(!result.databases.includes("alice-db"));
    assert.equal(await host("page.evaluate", { tabId: ta.tabId, expression: "localStorage.getItem('login')" }), "alice");
  });
  await test("isolated context supports input and AX references", async () => {
    await host("page.fillForm", { tabId: ta.tabId, fields: [{ selector: "#name", value: "Alice" }] });
    const tree = await host("page.snapshot", { tabId: ta.tabId });
    const button = tree.nodes.find(n => n.role === "button" && n.name === "Go"); assert(button?.ref);
    await host("page.click", { tabId: ta.tabId, selector: button.ref });
    assert.equal(await host("page.evaluate", { tabId: ta.tabId, expression: "document.querySelector('#target').textContent" }), "Clicked");
    await assert.rejects(host("page.evaluate", { tabId: ta.tabId, agentId: "other-agent", expression: "document.cookie" }), /not found/);
  });
  await test("isolated heap capability is probed and real snapshots support baseline, diff and analysis", async () => {
    const capability = await host("memory.heapCapability", { tabId: ta.tabId });
    assert.equal(capability.supported, true, JSON.stringify(capability));
    assert.equal(capability.target, "isolated-devtools");
    const baselinePath = path.join(temporary, "heap-baseline.heapsnapshot");
    const currentPath = path.join(temporary, "heap-current.heapsnapshot");
    const baseline = await host("memory.heapSnapshot", { tabId: ta.tabId, action: "baseline", filePath: baselinePath });
    assert.equal(baseline.baselineRecorded, true, JSON.stringify(baseline));
    await host("page.evaluate", { tabId: ta.tabId, expression: "window.__heapRegression = Array.from({length:1200},(_,i)=>({index:i,payload:'retained-'+i}))" });
    const current = await host("memory.heapSnapshot", { tabId: ta.tabId, action: "diff", filePath: currentPath });
    assert.equal(current.leakAnalysis.baseline, baselinePath, JSON.stringify(current));
    assert(current.bytes > 0 && current.leakAnalysis.constructors.length > 0);
    const summary = await host("memory.analyzeSnapshot", { action: "summary", filePath: currentPath });
    assert(summary.nodeCount > 0, JSON.stringify(summary));
    const comparison = await host("memory.analyzeSnapshot", { action: "compare", baseFilePath: baselinePath, currentFilePath: currentPath });
    assert(comparison.totalChanged > 0, JSON.stringify(comparison));
  });
  await test("unsupported HeapProfiler targets report false and remove incomplete snapshot files", async () => {
    const client = {
      send: async method => { throw new Error(`Protocol error (${method}): -32601 Method not found`); },
      on() {},
      off() {}
    };
    const fakeTab = { page: {}, client, tabId: -999, contextId: "unsupported-heap-test" };
    const capability = await pageCommand(fakeTab, "memory.heapCapability", {});
    assert.equal(capability.supported, false);
    assert.equal(capability.code, "HEAPPROFILER_UNAVAILABLE");
    const incompletePath = path.join(temporary, "unsupported.heapsnapshot");
    await assert.rejects(pageCommand(fakeTab, "memory.heapSnapshot", { filePath: incompletePath }), /HEAPPROFILER_UNAVAILABLE/);
    await assert.rejects(fs.stat(incompletePath), { code: "ENOENT" });
  });
  await test("data URLs can be inspected through isolated DevTools page evaluation", async () => {
    const dataTab = await host("tabs.create", { contextId: a.contextId, url: "data:text/html,%3Ctitle%3EData%20target%3C%2Ftitle%3E%3Cmain%3EReady%3C%2Fmain%3E" });
    assert.deepEqual(await host("page.evaluate", { tabId: dataTab.tabId, expression: "({title:document.title,text:document.querySelector('main').textContent})" }), { title: "Data target", text: "Ready" });
  });
  await host("contexts.close", { contextId: a.contextId }); await host("contexts.close", { contextId: b.contextId });
  console.log(`${checks} DevTools integration checks passed`);
} finally {
  for (const request of [...pending.values(), ...hostPending.values()]) clearTimeout(request.timer);
  if (child) { child.stdin.end(); await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000))]); }
  await browserHandle?.close();
  for (const ws of wss.clients) ws.terminate();
  await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
