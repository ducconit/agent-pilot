#!/usr/bin/env node

import assert from "node:assert/strict";
import { readBuildId, readOption, readinessFromHealth } from "../../../scripts/launch_test_chrome.mjs";

assert.equal(
  readOption(["--url=http://localhost/test?a=1&b=2"], "--url", "about:blank"),
  "http://localhost/test?a=1&b=2"
);
assert.equal(
  readOption(["--url", "http://localhost/test?a=1"], "--url", "about:blank"),
  "http://localhost/test?a=1"
);
assert.equal(readBuildId('export const EXTENSION_BUILD_ID = "sha256:test";'), "sha256:test");
assert.throws(() => readBuildId("export const BUILD = 'missing';"), /build ID/);

const ready = readinessFromHealth({
  status: "ok",
  port: 58766,
  extensionConnected: true,
  clients: [{
    instanceId: "browser-test",
    bridgePort: 58766,
    extensionBuildId: "sha256:test"
  }]
}, 58766, "sha256:test");
assert.equal(ready.ready, true);
assert.equal(ready.client.instanceId, "browser-test");

assert.equal(
  readinessFromHealth({
    status: "ok",
    port: 58765,
    extensionConnected: true,
    clients: []
  }, 58766, "sha256:test").ready,
  false
);
assert.equal(
  readinessFromHealth({
    status: "ok",
    port: 58766,
    extensionConnected: true,
    clients: [{ bridgePort: 58766, extensionBuildId: "sha256:old" }]
  }, 58766, "sha256:test").ready,
  false
);

console.log("✅ launch_test_chrome helpers passed");
