#!/usr/bin/env node
/**
 * Unit/protocol-boundary verification for the isolated PWA adapter.
 * No Chrome state is changed: all calls use a deterministic fake CDP sender.
 */

import assert from "node:assert/strict";
import {
  createPwaAdapter,
  createPwaAdapterFromBrowser,
  PwaAdapterError
} from "../devtools/pwa.mjs";

const calls = [];
const adapter = createPwaAdapter({
  send: async (method, params) => {
    calls.push({ method, params });
    if (method === "PWA.getOsAppState") return { badgeCount: 0, fileHandlers: [] };
    if (method === "PWA.launch") return { targetId: "pwa-target-1" };
    return {};
  }
});

assert.deepEqual(await adapter.getOsAppState({ manifestId: "https://example.test/" }), {
  badgeCount: 0,
  fileHandlers: []
});
assert.deepEqual(await adapter.install({
  manifestId: "https://example.test/",
  installUrlOrBundleUrl: "https://example.test/app",
  displayMode: "standalone"
}), {});
assert.deepEqual(await adapter.launch({ manifestId: "https://example.test/", url: "https://example.test/inbox" }), {
  targetId: "pwa-target-1"
});
assert.deepEqual(await adapter.uninstall({ manifestId: "https://example.test/" }), {});
assert.deepEqual(calls, [
  { method: "PWA.getOsAppState", params: { manifestId: "https://example.test/" } },
  { method: "PWA.install", params: { manifestId: "https://example.test/", installUrlOrBundleUrl: "https://example.test/app" } },
  { method: "PWA.changeAppUserSettings", params: { manifestId: "https://example.test/", displayMode: "standalone" } },
  { method: "PWA.launch", params: { manifestId: "https://example.test/", url: "https://example.test/inbox" } },
  { method: "PWA.uninstall", params: { manifestId: "https://example.test/" } }
]);

await assert.rejects(
  () => adapter.install({ manifestId: "", displayMode: "standalone" }),
  error => error instanceof PwaAdapterError && error.code === "INVALID_ARGUMENT"
);
await assert.rejects(
  () => adapter.install({ manifestId: "https://example.test/", displayMode: "window" }),
  error => error instanceof PwaAdapterError && error.code === "INVALID_ARGUMENT"
);
assert.throws(
  () => createPwaAdapter({ send: async () => {}, scope: "tab" }),
  error => error instanceof PwaAdapterError && error.code === "BROWSER_SCOPE_REQUIRED"
);
assert.throws(
  () => createPwaAdapterFromBrowser({}),
  error => error instanceof PwaAdapterError && error.code === "BROWSER_CONNECTION_REQUIRED"
);

const unsupportedAdapter = createPwaAdapter({
  send: async method => {
    if (method === "Browser.getVersion") return { product: "Chrome/999.0.0.0" };
    throw new Error("Protocol error (PWA.getOsAppState): 'PWA.getOsAppState' wasn't found");
  }
});
const unsupportedProbe = await unsupportedAdapter.probe();
assert.equal(unsupportedProbe.supported, false);
assert.equal(unsupportedProbe.browser.product, "Chrome/999.0.0.0");

const backendErrorAdapter = createPwaAdapter({
  send: async method => {
    if (method === "Browser.getVersion") return { product: "Chrome/999.0.0.0" };
    throw new Error("Unknown web-app manifest id");
  }
});
const backendProbe = await backendErrorAdapter.probe({ manifestId: "https://missing.test/" });
assert.equal(backendProbe.supported, true);
assert.equal(backendProbe.state, null);
assert.match(backendProbe.probeError, /Unknown web-app manifest id/);

const browserCalls = [];
const browserAdapter = createPwaAdapterFromBrowser({
  _connection: {
    send: async (method, params) => {
      browserCalls.push({ method, params });
      return { targetId: "browser-session-target" };
    }
  }
});
assert.deepEqual(await browserAdapter.launch({ manifestId: "https://example.test/" }), {
  targetId: "browser-session-target"
});
assert.deepEqual(browserCalls, [{ method: "PWA.launch", params: { manifestId: "https://example.test/" } }]);

console.log("PWA adapter verification passed");
