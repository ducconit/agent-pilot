#!/usr/bin/env node
/**
 * Agent Pilot - Background API / structural verification
 *
 * Guards the refactor seams that unit tests elsewhere cannot see:
 *  - the cdp-manager facade still re-exports the complete CDP public API
 *  - the batch executor exposes its handler registry with the expected actions
 *  - the agent command registry keeps every method + legacy alias
 *  - the CDP drag step clamp never yields NaN (regression: missing default)
 */

import { createRecorder } from "./lib/harness.mjs";
import * as cdpManager from "../extensions/background/cdp-manager.js";
import { clampCdpDragSteps } from "../extensions/background/cdp-input.js";
import { executeBatchActions } from "../extensions/background/batch-executor.js";
import { BATCH_ACTION_HANDLERS } from "../extensions/background/batch-actions.js";
import { AGENT_COMMAND_HANDLERS } from "../extensions/background/agent-handlers/index.js";
import { DEFAULTS } from "../extensions/background/constants.js";
import { transportMethods } from "../extensions/background/bridge-transport.js";

const recorder = createRecorder({
  title: "📊 BẢNG TỔNG KẾT KIỂM THỬ BACKGROUND API:",
  itemKey: "feature",
  summaryStyle: "features",
  successMessage: "\n🎉 BACKGROUND API & REGISTRY ĐƯỢC XÁC MINH HOÀN HẢO!"
});

const record = recorder.record;

console.log("==================================================================");
console.log("🧪 KIỂM THỬ CẤU TRÚC: CDP FACADE, BATCH REGISTRY, AGENT HANDLERS");
console.log("==================================================================\n");

// 1. CDP facade re-exports the full public API (no import site left broken)
const EXPECTED_CDP_EXPORTS = [
  "reconcileDebuggerState",
  "attachDebugger",
  "detachDebugger",
  "sendCdpCommand",
  "ensureCdpAttached",
  "initCdpEventListeners",
  "dispatchCdpKeyEvent",
  "dispatchCdpMouseMove",
  "dispatchCdpMouseClick",
  "dispatchCdpMouseDrag",
  "setEmulation",
  "getNetworkResponseBody",
  "uploadFileInput",
  "handleJavaScriptDialog",
  "getActiveDialog",
  "startPerformanceTrace",
  "stopPerformanceTrace",
  "getPerformanceMetrics",
  "collectGarbage",
  "takeHeapSnapshot"
];
const missingCdp = EXPECTED_CDP_EXPORTS.filter((name) => typeof cdpManager[name] === "undefined");
record(
  "1. cdp-manager facade re-exports the full CDP API",
  missingCdp.length === 0,
  missingCdp.length ? `missing: ${missingCdp.join(", ")}` : `${EXPECTED_CDP_EXPORTS.length} exports present`
);

// 2. Batch executor + handler registry
const EXPECTED_BATCH_ACTIONS = [
  "open", "open_tab", "tabs.create", "navigate", "tabs.update", "close", "close_tab", "tabs.remove",
  "wait", "sleep", "wait_for", "wait_for_selector",
  "click", "page.click", "type", "page.type", "press_key", "key",
  "scroll", "page.scroll", "hover", "page.hover", "drag", "page.drag",
  "evaluate", "eval", "cdp", "devtools", "get_devtools_data",
  "screenshot", "page.screenshot", "snapshot", "page.snapshot",
  "fill_form", "fill", "page.fillform", "get_element", "upload", "upload_file",
  "dialog", "handle_dialog", "scroll_into_view"
];
const missingBatch = EXPECTED_BATCH_ACTIONS.filter((name) => typeof BATCH_ACTION_HANDLERS[name] !== "function");
const batchHandlerCount = Object.keys(BATCH_ACTION_HANDLERS).length;
record(
  "2. batch handler registry exposes expected actions",
  typeof executeBatchActions === "function" && missingBatch.length === 0 && batchHandlerCount >= 40,
  missingBatch.length
    ? `missing: ${missingBatch.join(", ")}`
    : `${batchHandlerCount} handlers registered`
);

// 3. Agent command registry includes methods and legacy aliases
const EXPECTED_AGENT_METHODS = [
  "ping", "tabs.query", "tabs.listAll", "tabs.getActive", "tabs.create", "tabs.update", "tabs.remove",
  "cdp.attach", "cdp.detach", "cdp.status", "cdp.send",
  "page.evaluate", "page.click", "page.type", "page.screenshot", "page.getElement", "page.snapshot",
  "page.fillForm", "page.pickColor", "page.handleDialog", "dialog.getActive",
  "page.setBusy", "session.start", "session.end", "session.status",
  "batch.run", "devtools.getData",
  "emulation.set", "emulation.resize",
  "network.listRequests", "network.getResponseBody",
  "performance.trace", "performance.metrics",
  "memory.heapSnapshot", "memory.collectGarbage",
  "extensions.manage", "config.getSecretFilter", "config.setSecretFilter", "extension.reload"
];
const LEGACY_ALIASES = [
  "evaluate", "page.key", "page.wait", "page.upload",
  "dialog.handle", "agent.setBusy", "session.stop", "batch.execute", "runtime.reload"
];
const missingMethods = EXPECTED_AGENT_METHODS.filter((name) => typeof AGENT_COMMAND_HANDLERS[name] !== "function");
const missingAliases = LEGACY_ALIASES.filter((name) => typeof AGENT_COMMAND_HANDLERS[name] !== "function");
record(
  "3. agent command registry keeps methods + legacy aliases",
  missingMethods.length === 0 && missingAliases.length === 0,
  missingMethods.length || missingAliases.length
    ? `missing methods: [${missingMethods.join(", ")}], aliases: [${missingAliases.join(", ")}]`
    : `${EXPECTED_AGENT_METHODS.length} methods + ${LEGACY_ALIASES.length} aliases`
);

// 4. CDP drag step clamp (regression: a removed constant produced NaN and skipped the move loop)
const clampCases = [
  { input: undefined, want: DEFAULTS.DRAG_STEPS_CDP },
  { input: "", want: DEFAULTS.DRAG_STEPS_CDP },
  { input: "abc", want: DEFAULTS.DRAG_STEPS_CDP },
  { input: 0, want: DEFAULTS.DRAG_STEPS_CDP },
  { input: -5, want: DEFAULTS.DRAG_STEPS_CDP },
  { input: 1, want: 2 },
  { input: 5, want: 5 },
  { input: "40", want: 40 },
  { input: 500, want: 120 }
];
const clampFailures = clampCases.filter(({ input, want }) => {
  const got = clampCdpDragSteps(input);
  return !Number.isFinite(got) || got !== want;
});
record(
  "4. clampCdpDragSteps always returns a finite, clamped value",
  clampFailures.length === 0,
  clampFailures.length
    ? clampFailures.map(({ input, want }) => `clamp(${JSON.stringify(input)}) != ${want}`).join("; ")
    : `${clampCases.length} cases verified`
);

// 5. Drag defaults agree across the two code paths that build CDP drags
record(
  "5. Drag defaults are consistent (single source of truth)",
  DEFAULTS.DRAG_STEPS_CDP === 10 && DEFAULTS.DRAG_STEPS === 8,
  `CDP=${DEFAULTS.DRAG_STEPS_CDP}, synthetic=${DEFAULTS.DRAG_STEPS}`
);

// 6. A send failure during reconnect must preserve the failed and remaining frames
// in order instead of losing them after the queue is cleared.
globalThis.WebSocket = { OPEN: 1 };
const transportClient = {
  ws: { readyState: 1, send: () => { throw new Error("socket closed during flush"); } },
  connected: true,
  enabled: true,
  outboundQueue: [{ id: 1 }, { id: 2 }],
  maxQueueSize: 10
};
Object.assign(transportClient, transportMethods);
const originalWarn = console.warn;
console.warn = () => {};
transportClient.flushOutboundQueue();
console.warn = originalWarn;
const preservedAfterFailure = transportClient.outboundQueue.map((item) => item.id).join(",") === "1,2";
transportClient.ws = {
  readyState: 1,
  send: (payload) => {
    transportClient.sent = transportClient.sent || [];
    transportClient.sent.push(JSON.parse(payload).id);
  }
};
transportClient.flushOutboundQueue();
record(
  "6. Outbound queue preserves frames across send failure",
  preservedAfterFailure && transportClient.outboundQueue.length === 0 && transportClient.sent.join(",") === "1,2",
  `preserved=${preservedAfterFailure}, sent=${transportClient.sent.join(",")}`
);

recorder.summarize();
recorder.exitIfFailed();
