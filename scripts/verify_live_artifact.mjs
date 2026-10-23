#!/usr/bin/env node
/**
 * Live contract smoke test. Run this after rebuilding/reloading the unpacked
 * extension to catch a stale Chrome artifact that source-only tests cannot see.
 *
 *   AGENT_PILOT_PORT=58766 node scripts/verify_live_artifact.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const port = Number(process.env.AGENT_PILOT_PORT || 58766);
const base = `http://127.0.0.1:${port}`;

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  assert.equal(response.ok, true, `${url} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const health = await json(`${base}/health`);
assert.equal(health.status, "ok");
assert.equal(health.extensionConnected, true, `No extension connected on bridge ${port}`);
assert(health.clients?.length, "Health response did not include a connected client");
const client = health.clients.find(item => item.isActive) || health.clients[0];
const buildInfo = await fs.readFile(new URL("../extensions/background/build-info.js", import.meta.url), "utf8");
const expectedBuildId = buildInfo.match(/EXTENSION_BUILD_ID\s*=\s*["']([^"']+)/)?.[1];
assert(expectedBuildId, "Could not read expected extension build ID");
assert.equal(client.bridgePort, port, `Extension is attached to port ${client.bridgePort}, expected ${port}`);
assert.equal(client.extensionBuildId, expectedBuildId, `Stale extension artifact: ${client.extensionBuildId} != ${expectedBuildId}`);

const tabs = await json(`${base}/api`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ method: "tabs.list", params: {} })
});
assert.equal(tabs.success, true);
const tab = (tabs.result || []).find(item => item.isAgentTab) || tabs.result?.[0];
assert(tab?.tabId || tab?.id, "No tab available for live batch smoke test");
const tabId = tab.tabId || tab.id;

const batch = await json(`${base}/api`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    method: "batch.run",
    params: {
      tabId,
      actions: [
        { type: "metrics" },
        { type: "performance_metrics" },
        { type: "trace", action: "start" },
        { type: "performance_trace", action: "stop" }
      ]
    }
  })
});
assert.equal(batch.success, true, JSON.stringify(batch));
const results = batch.result?.results || [];
assert.equal(results.length, 4, JSON.stringify(results));
assert(results.every(step => step.success), JSON.stringify(results));
assert(!results.some(step => /unsupported batch action/i.test(step.error || "")), JSON.stringify(results));

const heap = await json(`${base}/api`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ method: "batch.run", params: { tabId, stopOnError: false, actions: [{ type: "heap_snapshot" }] } })
});
const heapStep = heap.result?.results?.[0];
assert(heapStep, JSON.stringify(heap));
assert(!/Unsupported batch action type/i.test(heapStep.error || ""), JSON.stringify(heapStep));
assert(heapStep.success || /HEAPPROFILER_UNAVAILABLE/i.test(heapStep.error || ""), JSON.stringify(heapStep));

console.log(JSON.stringify({
  ok: true,
  bridgePort: port,
  extensionVersion: client.extensionVersion,
  extensionBuildId: client.extensionBuildId,
  tabId,
  batchActions: results.map(step => step.type),
  heapResult: heapStep.success ? "supported" : "HEAPPROFILER_UNAVAILABLE"
}, null, 2));
