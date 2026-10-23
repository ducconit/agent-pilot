import assert from "node:assert/strict";
import { closeHttpServer, startStaticServer } from "./lib/harness.mjs";

const first = await startStaticServer(0);
const port = first.address().port;
await closeHttpServer(first);
assert.equal(first.listening, false, "closeHttpServer must wait for the listening socket to close");

const second = await startStaticServer(port);
try {
  const response = await fetch(`http://127.0.0.1:${port}/test-page.html`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<!doctype html/i);
} finally {
  await closeHttpServer(second);
}

console.log("✅ harness server cleanup releases and reuses the port");
