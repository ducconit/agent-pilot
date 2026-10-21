/** Release gate: exercise the actual MCP binary with no Node/npm on PATH. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { ROOT_DIR } from "./lib/config.mjs";
import { resolveChromiumBin } from "./browser_resolver.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "agent-pilot-packaged-test-"));
const emptyPath = path.join(temporary, "empty-path"); await fs.mkdir(emptyPath);
const probe = net.createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
let browserBinary = resolveChromiumBin();
// Linux's launcher is a shell wrapper; use the actual installed Chrome binary
// so its shell utilities do not need to be available on the empty test PATH.
if (process.platform === "linux") {
  const actual = await fs.realpath(browserBinary);
  const sibling = path.join(path.dirname(actual), "chrome");
  if (await fs.stat(sibling).catch(() => null)) browserBinary = sibling;
}
const environment = { ...process.env, PATH: emptyPath, CHROME_BIN: browserBinary, XDG_CACHE_HOME: path.join(temporary, "cache"), AGENT_PILOT_PORT: String(port), AGENT_PILOT_ARTIFACT_DIR: path.join(temporary, "artifacts"), AGENT_PILOT_TEST_NO_SANDBOX: "1", NODE_OPTIONS: "--import=/must-not-be-loaded-by-the-private-runtime.mjs" };
assert(spawnSync("node", ["--version"], { env: environment }).error, "Node must not be discoverable on test PATH");
assert(spawnSync("npm", ["--version"], { env: environment }).error, "npm must not be discoverable on test PATH");
const binary = path.join(ROOT_DIR, "cli", process.platform === "win32" ? "agent-pilot.exe" : "agent-pilot");
const child = spawn(binary, ["mcp"], { cwd: temporary, env: environment, stdio: ["pipe", "pipe", "inherit"] });
let sequence = 0;
const pending = new Map();
readline.createInterface({ input: child.stdout }).on("line", line => {
  const message = JSON.parse(line); const request = pending.get(message.id);
  if (request) { clearTimeout(request.timer); pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); }
});
function rpc(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Packaged MCP timeout: ${method}`)), 180000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
async function tool(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  const text = result.content?.filter(c => c.type === "text").map(c => c.text).join("\n");
  assert(!result.isError, text);
  return JSON.parse(text);
}
try {
  await rpc("initialize", { protocolVersion: "2024-11-05", clientInfo: { name: "packaged-test", version: "1" }, capabilities: {} });
  const list = await rpc("tools/list"); assert.equal(list.tools.length, 48);
  const status = await tool("browser_devtools_status");
  assert(status.embedded); assert.equal(status.systemNodeRequired, false); assert.equal(status.ffmpegRequired, false);
  console.log("PASS packaged MCP starts its embedded runtime with Node/npm absent from PATH");
  const a = await tool("browser_create_context", { name: "A", headless: true });
  const b = await tool("browser_create_context", { name: "B", headless: true });
  const markup = "data:text/html," + encodeURIComponent('<!doctype html><html lang="en"><head><title>Packaged test</title></head><body><main><h1>Packaged MCP</h1><button id="test">Click</button><img src="bad"></main></body></html>');
  const tab = await tool("browser_open_tab", { contextId: a.contextId, url: markup });
  assert(tab.tabId < 0);
  assert.equal(await tool("browser_evaluate", { expression: "document.title" }), "Packaged test");
  const snapshot = await tool("browser_accessibility_snapshot"); assert(snapshot.nodes.some(n => n.name === "Packaged MCP"));
  const button = snapshot.nodes.find(n => n.role === "button");
  const styles = await tool("browser_get_css_styles", { backendNodeId: button.backendNodeId }); assert(styles.computed.display);
  console.log("PASS isolated tabs, MCP affinity, CSS and AX tree run from the embedded payload");
  const audit = await tool("browser_lighthouse_audit", { mode: "snapshot", categories: ["accessibility"] });
  assert.equal(typeof audit.scores.accessibility, "number");
  const details = await tool("browser_lighthouse_analyze_audit", { filePath: audit.jsonPath }); assert(details.audits.length);
  console.log("PASS real Lighthouse and audit drill-down need no external runtime or install");
  await tool("browser_screencast_start", { fps: 5 });
  await tool("browser_evaluate", { expression: "new Promise(r=>setTimeout(()=>{document.body.style.background='red';r(true)},500))" });
  const video = await tool("browser_screencast_stop"); assert(video.bytes > 0);
  console.log("PASS packaged video records an MP4 without FFmpeg");
  await tool("browser_close_context", { contextId: a.contextId });
  await tool("browser_close_context", { contextId: b.contextId });
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  child.stdin.end();
  await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000))]);
  await fs.rm(temporary, { recursive: true, force: true });
}
