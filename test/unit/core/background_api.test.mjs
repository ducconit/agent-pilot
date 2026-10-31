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

import fs from "node:fs";
import path from "node:path";
import { createRecorder } from "../../../scripts/lib/harness.mjs";
import * as cdpManager from "../../../extensions/background/cdp-manager.js";
import { clampCdpDragSteps } from "../../../extensions/background/cdp-input.js";
import { executeBatchActions } from "../../../extensions/background/batch-executor.js";
import { BATCH_ACTION_HANDLERS } from "../../../extensions/background/batch-actions.js";
import { AGENT_COMMAND_HANDLERS } from "../../../extensions/background/agent-handlers/index.js";
import {
  DEFAULTS,
  attachedTabs,
  devtoolsBuffers,
  activeTracingSessions,
  activeDialogs,
  agentControlledTabs,
  tabLockStates,
  memoryBaselines,
  beforeUnloadPolicies,
  cleanupTabResources
} from "../../../extensions/background/constants.js";
import { transportMethods } from "../../../extensions/background/bridge-transport.js";

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

try {
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
  "isUnsupportedHeapProfilerError",
  "takeHeapSnapshot",
  "analyzeTraceEvents",
  "parseV8HeapSnapshot"
];
const missingCdp = EXPECTED_CDP_EXPORTS.filter((name) => typeof cdpManager[name] === "undefined");
record(
  "1. cdp-manager facade re-exports the full CDP API",
  missingCdp.length === 0,
  missingCdp.length ? `missing: ${missingCdp.join(", ")}` : `${EXPECTED_CDP_EXPORTS.length} exports present`
);

// 2. Batch executor + handler registry
const EXPECTED_BATCH_ACTIONS = [
  "open", "open_tab", "tabs.create", "navigate", "tabs.update", "back", "forward", "reload", "close", "close_tab", "tabs.remove",
  "wait", "sleep", "wait_for", "wait_for_selector",
  "click", "page.click", "type", "page.type", "press_key", "key",
  "scroll", "page.scroll", "hover", "page.hover", "drag", "page.drag",
  "evaluate", "eval", "cdp", "devtools", "get_devtools_data",
  "performance_metrics", "metrics", "performance_trace", "trace", "heap_snapshot", "heap", "memory",
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
  "extensions.manage", "webauthn.manage", "config.getSecretFilter", "config.setSecretFilter", "extension.reload"
];
const LEGACY_ALIASES = [
  "tabs.list", "evaluate", "page.key", "page.wait", "page.upload",
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

// 7. cleanupTabResources purges all per-tab Maps/Sets and clears pending unlockTimer
const testTabId = 9999;
attachedTabs.add(testTabId);
devtoolsBuffers.set(testTabId, { console: [], network: new Map() });
activeTracingSessions.set(testTabId, { buffer: [] });
activeDialogs.set(testTabId, { type: "alert" });
agentControlledTabs.add(testTabId);
memoryBaselines.set(testTabId, { timestamp: Date.now() });
beforeUnloadPolicies.set(testTabId, "accept");
const dummyTimer = setTimeout(() => {}, 60000);
tabLockStates.set(testTabId, { manualLock: true, autoCount: 1, unlockTimer: dummyTimer });
cleanupTabResources(testTabId);
const tabCleaned =
  !attachedTabs.has(testTabId) &&
  !devtoolsBuffers.has(testTabId) &&
  !activeTracingSessions.has(testTabId) &&
  !activeDialogs.has(testTabId) &&
  !agentControlledTabs.has(testTabId) &&
  !memoryBaselines.has(testTabId) &&
  !tabLockStates.has(testTabId) &&
  !beforeUnloadPolicies.has(testTabId);
record(
  "7. cleanupTabResources clears all per-tab Maps/Sets and timers",
  tabCleaned,
  `all 8 state stores cleared=${tabCleaned}`
);

// 8. reconcileDebuggerState resets its in-flight promise after completion
let getTargetsCount = 0;
globalThis.chrome = {
  debugger: {
    getTargets: (cb) => {
      getTargetsCount++;
      cb([]);
    }
  }
};
await cdpManager.reconcileDebuggerState();
await cdpManager.reconcileDebuggerState();
record(
  "8. reconcileDebuggerState resets promise after completion",
  getTargetsCount === 2,
  `getTargets invocations=${getTargetsCount} (expected 2 across 2 sequential calls)`
);

// 9. evaluateInTab does not double-execute user script on MAIN world runtime error and unwraps undefined CDP results
const { evaluateInTab } = await import("../../../extensions/background/agent-handlers/page-input.js");
let cdpEvalCalled = 0;
globalThis.chrome = {
  scripting: {
    executeScript: async () => [{ result: { __eval_err: true, name: "ReferenceError", message: "ReferenceError: foo is not defined" } }]
  },
  debugger: {
    sendCommand: (_target, _method, _params, cb) => {
      cdpEvalCalled++;
      cb({ result: { type: "undefined" } });
    }
  }
};
let caughtEvalErr = null;
try {
  await evaluateInTab(101, "foo()");
} catch (err) {
  caughtEvalErr = err;
}
attachedTabs.add(102);
globalThis.chrome = {
  runtime: { lastError: null },
  debugger: {
    sendCommand: (_target, _method, _params, cb) => {
      cb({ result: { type: "undefined" } });
    }
  }
};
const undefinedCdpResult = await evaluateInTab(102, "void 0");
attachedTabs.delete(102);
record(
  "9. evaluateInTab avoids duplicate CDP execution on runtime error and unwraps undefined CDP result",
  Boolean(caughtEvalErr) && cdpEvalCalled === 0 && undefinedCdpResult === undefined,
  `caught=${caughtEvalErr?.message}, cdpEvalCalled=${cdpEvalCalled}, undefinedResult=${String(undefinedCdpResult)}`
);

const { getTargetTabId, isTabInAgentGroup } = await import("../../../extensions/background/tab-manager.js");
const { commandMethods } = await import("../../../extensions/background/bridge-commands.js");

// 10. Strict Tab Group Isolation: getTargetTabId must reject non-group tabs and never hijack active user tab
globalThis.chrome = {
  tabs: {
    get: async (id) => {
      if (id === 101) return { id: 101, groupId: 7 };
      if (id === 102) return { id: 102, groupId: 7 };
      if (id === 103) return { id: 103, groupId: 9 }; // Moved to user's personal tab group
      if (id === 202) return { id: 202, groupId: -1 };
      throw new Error("No tab");
    },
    query: async () => [
      { id: 202, active: true, groupId: -1 }
    ]
  },
  tabGroups: {
    get: async (gid) => {
      if (gid === 7) return { id: 7, title: "🤖 Agent Pilot" };
      if (gid === 9) return { id: 9, title: "Personal Work" };
      throw new Error("No group");
    }
  }
};
agentControlledTabs.clear();
agentControlledTabs.add(103); // Stale entry moved into Personal Work group
const inGroup101 = await isTabInAgentGroup(101);
const inGroup202 = await isTabInAgentGroup(202);
const inGroup103Moved = await isTabInAgentGroup(103);
const rejectedNonGroup = (await getTargetTabId(202, null).catch(() => null)) === null;
agentControlledTabs.clear();
const rejectedWhenNoAgentTabs = (await getTargetTabId(null, null)) === null;
const resolvedGroupTab = await getTargetTabId(101, null);
record(
  "10. Strict Tab Group Isolation (never hijacks personal tabs or foreign tab groups)",
  inGroup101 === true &&
    inGroup202 === false &&
    inGroup103Moved === false &&
    !agentControlledTabs.has(103) &&
    rejectedNonGroup &&
    rejectedWhenNoAgentTabs &&
    resolvedGroupTab === 101,
  `inGroup(101)=${inGroup101}, inGroup(202)=${inGroup202}, movedToPersonal(103)=${inGroup103Moved}, rejectedNonGroup=${rejectedNonGroup}, rejectedEmpty=${rejectedWhenNoAgentTabs}`
);

// 11. Multi-Agent Concurrent Tab Affinity & Ownership Isolation (including rehydration steal protection)
const mockBridge = Object.assign({
  lastAgentTabId: null,
  agentLastTabIds: new Map(),
  tabOwners: new Map()
}, commandMethods);
agentControlledTabs.clear();
agentControlledTabs.add(101);
agentControlledTabs.add(102);
mockBridge.recordAgentTab(101, "agent_conv_A", { isOwner: true });
mockBridge.recordAgentTab(102, "agent_conv_B", { isOwner: true });

// Attempt by Agent C to steal Agent A's Tab 101 via recordAgentTab / rehydration hint must be ignored:
mockBridge.recordAgentTab(101, "agent_conv_C", { isOwner: true });
const ownerOf101AfterStealAttempt = mockBridge.tabOwners.get(101);
const targetCAfterStealAttempt = await mockBridge.getTargetTabId(undefined, "agent_conv_C");

const targetA = await mockBridge.getTargetTabId(undefined, "agent_conv_A");
const targetB = await mockBridge.getTargetTabId(undefined, "agent_conv_B");
const explicitCrossOwnerDenied = await mockBridge.getTargetTabId(101, "agent_conv_B")
  .then(() => false)
  .catch((error) => String(error?.message || "").includes("owned by another agent"));
// Simulate Agent B closing its own tab (102), then calling an implicit command or close again:
mockBridge.clearAgentTab(102);
agentControlledTabs.delete(102);
const targetBAfterClose = await mockBridge.getTargetTabId(undefined, "agent_conv_B", { allowFallback: false });
const targetBFallbackBlocked = await mockBridge.getTargetTabId(undefined, "agent_conv_B");
const targetAStillIntact = await mockBridge.getTargetTabId(undefined, "agent_conv_A");

record(
  "11. Multi-Agent Concurrent Tab Affinity (no cross-conversation tab hijacking, steal, or accidental close)",
  ownerOf101AfterStealAttempt === "agent_conv_A" &&
    targetCAfterStealAttempt === null &&
    targetA === 101 &&
    targetB === 102 &&
    explicitCrossOwnerDenied &&
    targetBAfterClose === null &&
    targetBFallbackBlocked === null &&
    targetAStillIntact === 101,
  `owner101=${ownerOf101AfterStealAttempt}, C=${targetCAfterStealAttempt}, A=${targetA}, B=${targetB}, B_afterClose=${targetBAfterClose}, B_fallback=${targetBFallbackBlocked}, A_after=${targetAStillIntact}`
);

const {
  setFlowRecording,
  appendFlowStep,
  recordTabNavigation,
  deleteFlowStep,
  getFlowState,
  removeFlowSession,
  exportFlowAsBatch,
  exportFlowAsPlaywright,
  exportFlowAsRecorder,
  importFlow,
  editFlowStep,
  clearFlowSteps
} = await import("../../../extensions/background/flow-recorder.js");

// 12. Persistent Cross-Page Flow Recorder (navigation persistence, deduplication, Batch & Playwright export)
clearFlowSteps(101);
await setFlowRecording(101, true, "https://example.com/login", "Login flow");
appendFlowStep(101, {
  action: "type",
  tagName: "input",
  selector: "[data-testid=\"username\"]",
  playwrightLocator: "page.getByTestId(\"username\")",
  value: "tester_01",
  url: "https://example.com/login",
  description: "Nhập \"tester_01\" vào <input>"
});
// Consecutive typing on same input updates in place instead of duplicating
appendFlowStep(101, {
  action: "type",
  tagName: "input",
  selector: "[data-testid=\"username\"]",
  playwrightLocator: "page.getByTestId(\"username\")",
  value: "tester_admin",
  url: "https://example.com/login",
  description: "Nhập \"tester_admin\" vào <input>"
});
appendFlowStep(101, {
  action: "click",
  tagName: "button",
  selector: "[data-testid=\"submit-btn\"]",
  playwrightLocator: "page.getByRole(\"button\", { name: \"Đăng nhập\" })",
  label: "Đăng nhập",
  url: "https://example.com/login",
  description: "Click <button> \"Đăng nhập\""
});
// Simulate full-page navigation to /dashboard
recordTabNavigation(101, "https://example.com/dashboard");
const extraStep = appendFlowStep(101, {
  action: "click",
  tagName: "a",
  selector: "a.logout",
  url: "https://example.com/dashboard",
  description: "Click <a> \"Thoát\""
});
// Delete the accidental step
deleteFlowStep(101, extraStep.id);

const flowState = getFlowState(101);
const exportedBatch = exportFlowAsBatch(101);
const exportedPw = exportFlowAsPlaywright(101);
const exportedRecorder = exportFlowAsRecorder(101, "Login flow");
const importedFlow = importFlow(202, exportedRecorder, "Imported login flow");
const editedImportedFlow = editFlowStep(202, "replace", importedFlow.steps[1].id, { value: "edited" });

// Simulate original tab #101 closing -> flow should remain preserved in lastRecordedFlow for auto-new-tab Replay
removeFlowSession(101);
// Simulate passive click on an unrelated personal tab #999 -> must NOT overwrite the active recording snapshot!
appendFlowStep(999, {
  action: "click",
  tagName: "button",
  selector: "#unrelated-btn",
  url: "https://unrelated.example.com",
  description: "Passive click on unrelated tab"
});
const fallbackAfterClose = getFlowState(null);
const fallbackBatchAfterClose = exportFlowAsBatch(null);

record(
  "12. Persistent Cross-Page Flow Recorder (MPA navigation, deduplication, Batch & Playwright export, closed-tab survival)",
  flowState.recording === true &&
    flowState.steps.length === 4 &&
    flowState.steps[0].action === "navigate" &&
    flowState.steps[1].value === "tester_admin" &&
    flowState.steps[2].action === "click" &&
    flowState.steps[3].action === "navigate" &&
    flowState.steps[3].url === "https://example.com/dashboard" &&
    exportedBatch.actions.length === 4 &&
    exportedPw.includes("await page.goto(\"https://example.com/login\");") &&
    exportedPw.includes("await page.getByTestId(\"username\").fill(\"tester_admin\");") &&
    exportedPw.includes("await page.getByRole(\"button\", { name: \"Đăng nhập\" }).click();") &&
    exportedPw.includes("await page.goto(\"https://example.com/dashboard\");") &&
    exportedRecorder.title === "Login flow" &&
    exportedRecorder.steps.map((step) => step.type).join(",") === "navigate,change,click,navigate" &&
    editedImportedFlow.steps[1].value === "edited" &&
    fallbackAfterClose.steps.length === 4 &&
    fallbackBatchAfterClose.actions.length === 4,
  `steps=${flowState.steps.length}, batchActions=${exportedBatch.actions.length}, survivedTabClose=${fallbackAfterClose.steps.length === 4}`
);

// 13. uploadFileInput uses direct objectId on DOM.setFileInputFiles and falls back to DOM.getDocument + DOM.requestNode
attachedTabs.add(301);
const cdpCommandsCalled = [];
globalThis.chrome = {
  runtime: { lastError: null },
  tabs: {
    sendMessage: (_tabId, msg, cb) => {
      if (msg.action === "mark_upload_target") {
        cb({ success: true, marker: "ap-upload-test1" });
      } else {
        cb({ success: true });
      }
    }
  },
  debugger: {
    sendCommand: (_target, method, params, cb) => {
      cdpCommandsCalled.push({ method, params });
      if (method === "Runtime.evaluate") {
        cb({ result: { objectId: "obj-file-123" } });
      } else if (method === "DOM.setFileInputFiles") {
        cb({});
      } else if (method === "Runtime.releaseObject") {
        cb({});
      } else {
        cb({});
      }
    }
  }
};
const uploadRes = await cdpManager.uploadFileInput(301, "[xapfileselectortrigger]", ["/tmp/video.mp4"]);
attachedTabs.delete(301);
const setFilesCmd = cdpCommandsCalled.find((c) => c.method === "DOM.setFileInputFiles");
const evalCmd = cdpCommandsCalled.find((c) => c.method === "Runtime.evaluate");
record(
  "13. uploadFileInput passes objectId directly to DOM.setFileInputFiles and intercepts dynamic triggers",
  uploadRes.success === true &&
    setFilesCmd?.params?.objectId === "obj-file-123" &&
    Array.isArray(setFilesCmd?.params?.files) &&
    setFilesCmd.params.files[0] === "/tmp/video.mp4" &&
    evalCmd?.params?.expression?.includes("HTMLInputElement.prototype.click"),
  `objectId=${setFilesCmd?.params?.objectId}, files=${JSON.stringify(setFilesCmd?.params?.files)}`
);

// 14. collectDevtoolsData supports errorsOnly, excludeStatic, and omits verbose headers by default
const { collectDevtoolsData } = await import("../../../extensions/background/agent-handlers/devtools.js");
attachedTabs.add(302);
devtoolsBuffers.set(302, {
  console: [
    { id: "c1", type: "log", text: "info message" },
    { id: "c2", type: "warning", text: "warn message" },
    { id: "c3", type: "error", text: "Upload failed: 400 Bad Request" }
  ],
  network: new Map([
    ["r1", { id: "r1", url: "https://example.com/logo.png", method: "GET", type: "Image", status: 200, headers: { "cache-control": "max-age=3600" } }],
    ["r2", { id: "r2", url: "https://example.com/api/status", method: "GET", type: "Fetch", status: 200, headers: { "content-type": "application/json" } }],
    ["r3", { id: "r3", url: "https://example.com/api/upload", method: "POST", type: "Fetch", status: 500, headers: { "x-err": "1" } }]
  ])
});
globalThis.chrome = {
  runtime: { lastError: null },
  debugger: {
    sendCommand: (_target, method, _params, cb) => {
      if (method === "Performance.getMetrics") cb({ metrics: [] });
      else cb({});
    }
  }
};
const filteredDevtools = await collectDevtoolsData(302, {
  type: "all",
  errorsOnly: true,
  excludeStatic: true
});
const nonStaticDevtools = await collectDevtoolsData(302, {
  type: "network",
  excludeStatic: true,
  includeHeaders: true
});
const summaryDevtools = await collectDevtoolsData(302, {
  type: "all",
  detail: "summary",
  errorsOnly: true,
  excludeStatic: true
});
cleanupTabResources(302);
record(
  "14. collectDevtoolsData supports errorsOnly, excludeStatic, and strips verbose response headers by default",
  filteredDevtools.console.length === 1 &&
    filteredDevtools.console[0].id === "c3" &&
    filteredDevtools.network.length === 1 &&
    filteredDevtools.network[0].id === "r3" &&
    filteredDevtools.network[0].headers === undefined &&
    nonStaticDevtools.network.length === 2 &&
    nonStaticDevtools.network[0].headers?.["content-type"] === "application/json" &&
    summaryDevtools.detail === "summary" &&
    summaryDevtools.console[0].stackTrace === undefined &&
    summaryDevtools.network[0].headers === undefined &&
    summaryDevtools.performance.metrics === undefined,
  `errConsole=${filteredDevtools.console.length}, errNet=${filteredDevtools.network.length}, headersStripped=${filteredDevtools.network[0]?.headers === undefined}, nonStaticCount=${nonStaticDevtools.network.length}, summaryCompact=${summaryDevtools.detail === "summary"}`
);

// 15. runInlineWait & mergeWaitMeta support waitMs, sleepMs, waitForSelector, waitForText across handlers
const { runInlineWait, mergeWaitMeta, pageInputHandlers } = await import("../../../extensions/background/agent-handlers/page-input.js");
const inlineMessages = [];
const mockInlineClient = {
  getTargetTabId: async () => 501,
  runWithTabLock: async (_tabId, _label, fn) => await fn(),
  sendTabMessageWithRetry: async (_tabId, msg) => {
    inlineMessages.push(msg);
    if (msg.action === "wait_for") {
      return { success: true, waitedMs: 12, state: msg.state || "visible" };
    }
    return { success: true, clicked: true };
  }
};
const inlineMeta = await runInlineWait(mockInlineClient, 501, {
  waitForSelector: ".loaded-panel",
  waitMs: 20
});
const mergedClick = mergeWaitMeta({ success: true }, inlineMeta);

// Also test page.evaluate with `script` alias + inline waitMs
globalThis.chrome = {
  runtime: { lastError: null },
  scripting: {
    executeScript: async ({ args: [expr] }) => [{ result: { ok: true, value: `eval:${expr}` } }]
  }
};
const evalWithScriptAlias = await new Promise((resolve, reject) => {
  pageInputHandlers["page.evaluate"](
    mockInlineClient,
    { script: "window.__squoosh", waitMs: 10 },
    (res, err) => (err ? reject(err) : resolve(res))
  );
});
record(
  "15. runInlineWait + mergeWaitMeta & page.evaluate script alias",
  inlineMessages.length === 1 &&
    inlineMessages[0].action === "wait_for" &&
    inlineMessages[0].selector === ".loaded-panel" &&
    mergedClick.waitedMs >= 10 &&
    mergedClick.waitForResult?.success === true &&
    evalWithScriptAlias === "eval:window.__squoosh",
  `waitForSelector=${inlineMessages[0]?.selector}, waitedMs=${mergedClick.waitedMs}, evalResult=${evalWithScriptAlias}`
);

// 16. createTabWithWindowFallback automatically falls back to chrome.windows.create when no browser window is open
const { createTabWithWindowFallback } = await import("../../../extensions/background/tab-manager.js");
let windowsCreateCalled = false;
globalThis.chrome = {
  runtime: { lastError: null },
  tabs: {
    create: (_opts, cb) => {
      globalThis.chrome.runtime.lastError = { message: "No current window" };
      cb(undefined);
      globalThis.chrome.runtime.lastError = null;
    }
  },
  windows: {
    create: (opts, cb) => {
      globalThis.chrome.runtime.lastError = null;
      windowsCreateCalled = true;
      cb({ id: 1, tabs: [{ id: 777, url: opts.url, active: Boolean(opts.focused), status: "complete" }] });
    }
  }
};
const fallbackTab = await createTabWithWindowFallback("https://squoosh.app", false);
record(
  "16. createTabWithWindowFallback recovers from 'No current window' via chrome.windows.create",
  windowsCreateCalled === true && fallbackTab?.id === 777 && fallbackTab?.url === "https://squoosh.app",
  `windowsCreateCalled=${windowsCreateCalled}, tabId=${fallbackTab?.id}`
);

// 17. cursor-wait.js supports pure sleep (waitMs) and condition-less document.readyState wait
globalThis.window = globalThis.window || {};
globalThis.document = {
  readyState: "complete",
  body: { innerText: "Hello Agent Pilot" },
  querySelector: () => null
};
await import("../../../extensions/content/cursor-wait.js");
const sleepWaitRes = await globalThis.window.__AP_INTERNAL__.cursorWait.waitFor({ waitMs: 20 });
const readyStateWaitRes = await globalThis.window.__AP_INTERNAL__.cursorWait.waitFor({});
record(
  "17. cursor-wait.js supports pure sleep (waitMs) and condition-less readyState wait",
  sleepWaitRes?.success === true &&
    sleepWaitRes?.state === "slept" &&
    sleepWaitRes?.waitedMs >= 15 &&
    readyStateWaitRes?.success === true &&
    readyStateWaitRes?.state === "ready" &&
    readyStateWaitRes?.readyState === "complete",
  `sleepState=${sleepWaitRes?.state} (${sleepWaitRes?.waitedMs}ms), readyState=${readyStateWaitRes?.state}`
);

// 18. Content scripts contain zero <button> elements so document.querySelectorAll('button') is never polluted
const contentFiles = [
  "extensions/content/dom-inspector.js",
  "extensions/content/feedback-studio/hud-toolbar.js",
  "extensions/content/feedback-studio/modals.js",
  "extensions/content/feedback-studio/pinned-overlay.js"
];
const filesWithButtonTag = contentFiles.filter((rel) => {
  const src = fs.readFileSync(path.resolve(rel), "utf8");
  return /<button\b/i.test(src);
});
record(
  "18. Content scripts use <div/span role='button'> with zero <button> tag pollution",
  filesWithButtonTag.length === 0,
  filesWithButtonTag.length === 0 ? "0 <button> tags in content scripts" : `found in: ${filesWithButtonTag.join(", ")}`
);

// 19. normalizeUrl encodes HTTP Basic Auth options (including nested auth) and inline credentials with special chars (@, &&, #)
const { normalizeUrl: normUrl } = await import("../../../extensions/background/constants.js");
const authFromOpts = normUrl("https://stg.example.com/booking?step=1", {
  username: "tester",
  password: "Pass@2026&&"
});
const authFromNestedObj = normUrl("lagom.sphoton.com", {
  auth: { username: "lagom", password: "Lagom&&2026#test" }
});
const authFromInline = normUrl("https://lagom:Lagom&&2026#test@lagom.sphoton.com/booking");
record(
  "19. normalizeUrl encodes HTTP Basic Auth options and inline credentials with special characters",
  authFromOpts === "https://tester:Pass%402026%26%26@stg.example.com/booking?step=1" &&
    authFromNestedObj === "https://lagom:Lagom%26%262026%23test@lagom.sphoton.com" &&
    authFromInline === "https://lagom:Lagom%26%262026%23test@lagom.sphoton.com/booking",
  `opts=${authFromOpts}, nested=${authFromNestedObj}, inline=${authFromInline}`
);

// 20. uploadFileInput propagates real attachDebugger error with CDP_UNAVAILABLE: when via='cdp', rejects /etc/gshadow, and falls back to MAIN-world DataTransfer when via='auto'
const { uploadFileInput } = await import("../../../extensions/background/cdp-page.js");
let mainWorldSyntheticCalled = false;
globalThis.chrome = {
  runtime: { lastError: null },
  tabs: {
    sendMessage: (_tabId, msg, cb) => {
      if (msg.action === "mark_upload_target") {
        cb({ success: true, marker: "ap_m1" });
      } else {
        cb({ success: true });
      }
    }
  },
  debugger: {
    getTargets: (cb) => cb([]),
    attach: (_target, _ver, cb) => {
      globalThis.chrome.runtime.lastError = {
        message: "DevTools open"
      };
      cb();
      globalThis.chrome.runtime.lastError = null;
    }
  },
  scripting: {
    executeScript: async ({ world, args }) => {
      if (world === "MAIN" && Array.isArray(args[2]) && args[2].length === 1) {
        mainWorldSyntheticCalled = true;
        return [{ result: { __upload_ok: true, count: 1 } }];
      }
      return [{ result: { __upload_err: "unexpected args" } }];
    }
  }
};
let strictCdpErr = "";
try {
  await uploadFileInput(808, "#passport", ["/tmp/passport.jpg"], { via: "cdp" });
} catch (err) {
  strictCdpErr = err.message || String(err);
}
let gshadowErr = "";
try {
  await uploadFileInput(808, "#passport", ["/etc/gshadow"], { via: "auto" });
} catch (err) {
  gshadowErr = err.message || String(err);
}
const autoSyntheticRes = await uploadFileInput(808, "#passport", ["/tmp/passport.jpg"], {
  via: "auto",
  filePayloads: [
    {
      name: "passport.jpg",
      path: "/tmp/passport.jpg",
      mimeType: "image/jpeg",
      base64: "ffd8ffe0",
      size: 4
    }
  ]
});
record(
  "20. uploadFileInput propagates CDP_UNAVAILABLE error on via='cdp', blocks /etc/gshadow, and falls back to MAIN-world DataTransfer on via='auto'",
  strictCdpErr.startsWith("CDP_UNAVAILABLE:") &&
    strictCdpErr.includes("DevTools open") &&
    gshadowErr.includes("/etc/gshadow") &&
    mainWorldSyntheticCalled === true &&
    autoSyntheticRes?.success === true &&
    autoSyntheticRes?.via === "synthetic" &&
    autoSyntheticRes?.fallback === true,
  `strictCdpErr="${strictCdpErr}", gshadowBlocked=${gshadowErr.includes("/etc/gshadow")}, fallbackVia=${autoSyntheticRes?.via}`
);

// 21. annotateDataUrlInWorker + batch screenshotAction render step/title/description & highlight box and forward requestedPath
const { annotateDataUrlInWorker } = await import("../../../extensions/background/screenshot-service.js");
const drawOps = [];
const fillRectYs = [];
const prevOffscreen = globalThis.OffscreenCanvas;
const prevCreateBitmap = globalThis.createImageBitmap;
const prevFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })
});
globalThis.createImageBitmap = async () => ({
  width: 1280,
  height: 720,
  close: () => {}
});
globalThis.OffscreenCanvas = class MockOffscreenCanvas {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return {
      drawImage: () => drawOps.push("drawImage"),
      save: () => {},
      restore: () => {},
      fillRect: (_x, y) => {
        drawOps.push("fillRect");
        fillRectYs.push(y);
      },
      strokeRect: () => drawOps.push("strokeRect"),
      fillText: (txt) => drawOps.push(`fillText:${txt}`),
      measureText: (txt) => ({ width: String(txt).length * 8 })
    };
  }
  async convertToBlob() {
    return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  }
};
const annOut = await annotateDataUrlInWorker("data:image/png;base64,iVBORw0KGgo=", {
  step: "3/7",
  title: "Tải lên ảnh chân dung & hộ chiếu",
  description: "Kiểm tra preview ảnh sau khi upload",
  captionPosition: "header",
  highlightRect: { x: 100, y: 120, width: 300, height: 180, viewportWidth: 1280, viewportHeight: 720 }
});
globalThis.chrome = {
  runtime: { lastError: null },
  tabs: {
    get: async (id) => ({ id, active: true, width: 1280, height: 720, windowId: 1 }),
    captureVisibleTab: (_winId, _opts, cb) => cb("data:image/png;base64,iVBORw0KGgo=")
  }
};
const batchShotOut = await executeBatchActions(
  {
    tabId: 901,
    actions: [
      {
        action: "screenshot",
        path: "/tmp/step_3.png",
        step: "3/7",
        title: "Upload",
        description: "Preview"
      }
    ]
  },
  { getTargetTabId: async () => 901 }
);
globalThis.OffscreenCanvas = prevOffscreen;
globalThis.createImageBitmap = prevCreateBitmap;
globalThis.fetch = prevFetch;
const batchStep0 = batchShotOut?.results?.[0] || {};
record(
  "21. annotateDataUrlInWorker & batch screenshotAction render step/title/description + highlight box and forward requestedPath",
  annOut.annotated === true &&
    fillRectYs.includes(0) &&
    drawOps.includes("strokeRect") &&
    drawOps.some((op) => op.includes("STEP 3/7")) &&
    batchStep0.success === true &&
    batchStep0.annotated === true &&
    batchStep0.requestedPath === "/tmp/step_3.png",
  `annotated=${annOut.annotated}, headerY0=${fillRectYs.includes(0)}, requestedPath=${batchStep0.requestedPath}, ops=${drawOps.length}`
);

// 22. cursor-form.js virtualFillForm toggles Radix UI / shadcn ARIA role='checkbox' controls
let radixClicked = 0;
let radixState = "false";
const mockRadixCheckbox = {
  tagName: "DIV",
  getBoundingClientRect: () => ({ top: 10, left: 10, bottom: 30, right: 30 }),
  focus: () => {},
  getAttribute: (attr) => {
    if (attr === "role") return "checkbox";
    if (attr === "aria-checked") return radixState;
    if (attr === "data-state") return radixState === "true" ? "checked" : "unchecked";
    return "";
  },
  click: () => {
    radixClicked++;
    radixState = radixState === "true" ? "false" : "true";
  }
};
globalThis.window = {
  innerHeight: 800,
  innerWidth: 1280,
  __AP_CONFIG__: { timeouts: { fillFieldDelayMs: 1 } },
  __AP_INTERNAL__: {
    cursor: {
      activateCursor: () => {},
      resolveElement: (sel) => (sel === "@15" ? mockRadixCheckbox : null),
      virtualClick: async () => ({ success: true }),
      dispatchKey: () => {}
    }
  }
};
await import("../../../extensions/content/cursor-form.js");
const fillRadixRes = await globalThis.window.__AP_INTERNAL__.cursorForm.virtualFillForm([
  { selector: "@15", value: true }
]);
// Calling a second time with value: true when already checked should NOT click again
await globalThis.window.__AP_INTERNAL__.cursorForm.virtualFillForm([
  { selector: "@15", value: true }
]);
record(
  "22. cursor-form.js virtualFillForm toggles ARIA role='checkbox' controls idempotently",
  fillRadixRes?.success === true &&
    fillRadixRes?.filledCount === 1 &&
    radixState === "true" &&
    radixClicked === 1,
  `filledCount=${fillRadixRes?.filledCount}, radixState=${radixState}, radixClicked=${radixClicked}`
);

// 23. takeHeapSnapshot parses V8 heap snapshot chunks, records baseline, and detects Detached DOM + listener + constructor memory leaks on diff
const buildMockV8HeapSnapshot = ({ cachedItemCount, detachedDivCount }) => {
  const strings = ["", "Object", "CachedModalState", "Detached HTMLDivElement", "HTMLButtonElement"];
  const nodes = [];
  // [type, name, id, self_size, edge_count, trace_node_id, detachedness]
  // Base Object node (type=3 "object", name=1 "Object", self_size=1024, detachedness=0)
  nodes.push(3, 1, 1, 1024, 0, 0, 0);
  // CachedModalState nodes (type=3 "object", name=2 "CachedModalState", self_size=65536 each)
  for (let i = 0; i < cachedItemCount; i++) {
    nodes.push(3, 2, 100 + i, 65536, 0, 0, 0);
  }
  // Detached HTMLDivElement nodes (type=8 "native", name=3 "Detached HTMLDivElement", self_size=2048, detachedness=2)
  for (let i = 0; i < detachedDivCount; i++) {
    nodes.push(8, 3, 500 + i, 2048, 0, 0, 2);
  }
  // Attached HTMLButtonElement with detachedness=2 (also detached via detachedness flag)
  if (detachedDivCount > 0) {
    nodes.push(8, 4, 900, 1024, 0, 0, 2);
  }
  return JSON.stringify({
    snapshot: {
      meta: {
        node_fields: ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"],
        node_types: [
          ["hidden", "array", "string", "object", "code", "closure", "regexp", "number", "native", "synthetic"]
        ]
      }
    },
    nodes,
    strings
  });
};

let heapPhase = "baseline";
let gcCollectCalls = 0;
let heapChunkListener = null;
attachedTabs.add(923);
globalThis.chrome = {
  runtime: { lastError: null },
  debugger: {
    onEvent: {
      addListener: (fn) => {
        heapChunkListener = fn;
      },
      removeListener: () => {
        heapChunkListener = null;
      }
    },
    sendCommand: (_target, method, _params, cb) => {
      if (method === "HeapProfiler.collectGarbage") {
        gcCollectCalls++;
        cb({});
        return;
      }
      if (method === "Performance.enable") {
        cb({});
        return;
      }
      if (method === "Performance.getMetrics") {
        const isDiff = heapPhase === "diff";
        cb({
          metrics: [
            { name: "JSHeapUsedSize", value: isDiff ? 28 * 1024 * 1024 : 10 * 1024 * 1024 },
            { name: "JSHeapTotalSize", value: 40 * 1024 * 1024 },
            { name: "Nodes", value: isDiff ? 1850 : 1200 },
            { name: "JSEventListeners", value: isDiff ? 410 : 120 },
            { name: "Documents", value: isDiff ? 4 : 1 }
          ]
        });
        return;
      }
      if (method === "HeapProfiler.takeHeapSnapshot") {
        const rawJson =
          heapPhase === "baseline"
            ? buildMockV8HeapSnapshot({ cachedItemCount: 2, detachedDivCount: 0 })
            : buildMockV8HeapSnapshot({ cachedItemCount: 80, detachedDivCount: 6 });
        if (heapChunkListener) {
          const mid = Math.floor(rawJson.length / 2);
          heapChunkListener({ tabId: 923 }, "HeapProfiler.addHeapSnapshotChunk", { chunk: rawJson.slice(0, mid) });
          heapChunkListener({ tabId: 923 }, "HeapProfiler.addHeapSnapshotChunk", { chunk: rawJson.slice(mid) });
        }
        cb({});
        return;
      }
      cb({});
    }
  }
};

const malformedOk =
  cdpManager.parseV8HeapSnapshot([]) === null &&
  cdpManager.parseV8HeapSnapshot(["{malformed"]) === null;
const baselineHeapRes = await cdpManager.takeHeapSnapshot(923, { action: "baseline" });
heapPhase = "diff";
const diffHeapRes = await cdpManager.takeHeapSnapshot(923, { action: "diff" });
const reBaselineRes = await cdpManager.takeHeapSnapshot(923, { action: "baseline" });
record(
  "23. takeHeapSnapshot parses V8 heap nodes/strings, stores baseline, and detects Detached DOM + listener + constructor leaks on diff",
  malformedOk &&
    baselineHeapRes.success === true &&
    baselineHeapRes.baselineRecorded === true &&
    !baselineHeapRes.leakAnalysis &&
    reBaselineRes.baselineRecorded === true &&
    !reBaselineRes.leakAnalysis &&
    diffHeapRes.success === true &&
    gcCollectCalls >= 3 &&
    diffHeapRes.heapSummary?.detachedDomNodes?.totalCount === 7 &&
    diffHeapRes.heapSummary?.detachedDomNodes?.items?.some((d) => d.name === "Detached HTMLDivElement" && d.count === 6) &&
    diffHeapRes.leakAnalysis?.leakSuspected === true &&
    diffHeapRes.leakAnalysis?.severity === "high" &&
    diffHeapRes.leakAnalysis?.deltas?.domNodes === 650 &&
    diffHeapRes.leakAnalysis?.deltas?.jsEventListeners === 290 &&
    diffHeapRes.leakAnalysis?.growingConstructors?.some((c) => c.name === "CachedModalState" && c.deltaCount === 78),
  `malformedOk=${malformedOk}, leakSuspected=${diffHeapRes.leakAnalysis?.leakSuspected}, severity=${diffHeapRes.leakAnalysis?.severity}, detachedCount=${diffHeapRes.heapSummary?.detachedDomNodes?.totalCount}, growing=${diffHeapRes.leakAnalysis?.growingConstructors?.[0]?.name}`
);

// 24. stopPerformanceTrace & analyzeTraceEvents ignore ph='M' metadata events and extract CPU breakdown, Long Tasks, Forced Reflows, and Hot Scripts
activeTracingSessions.set(924, {
  completed: true,
  startTime: Date.now() - 1500,
  buffer: [
    // Metadata event with ph='M' (must be excluded from eventsSummary!)
    { name: "process_name", cat: "__metadata", ph: "M", ts: 0, dur: 0 },
    // Long task (120ms = 120,000us)
    { name: "RunTask", cat: "disabled-by-default-devtools.timeline", ph: "X", ts: 1000000, dur: 120000 },
    // Scripting FunctionCall (90ms) attributed to app.bundle.js
    {
      name: "FunctionCall",
      cat: "devtools.timeline",
      ph: "X",
      ts: 1010000,
      dur: 90000,
      args: { data: { url: "https://example.test/app.bundle.js", functionName: "renderHeavyTable", lineNumber: 42 } }
    },
    // Synchronous Forced Layout (25ms) with stackTrace inside JS
    {
      name: "Layout",
      cat: "devtools.timeline",
      ph: "X",
      ts: 1050000,
      dur: 25000,
      args: {
        beginData: {
          dirtyObjects: 15,
          stackTrace: [{ url: "https://example.test/app.bundle.js", functionName: "measureRowHeight", lineNumber: 88 }]
        }
      }
    },
    // Paint event (12ms)
    { name: "Paint", cat: "devtools.timeline", ph: "X", ts: 1130000, dur: 12000 }
  ]
});
const traceStopRes = await cdpManager.stopPerformanceTrace(924);
record(
  "24. stopPerformanceTrace filters metadata events and reports CPU breakdown, Long Tasks, Forced Reflows, and Hot Scripts",
  traceStopRes.success === true &&
    traceStopRes.eventsSummary.every((e) => e.ph !== "M") &&
    traceStopRes.insights.breakdownMs.scriptingMs === 90 &&
    traceStopRes.insights.breakdownMs.renderingMs === 25 &&
    traceStopRes.insights.breakdownMs.paintingMs === 12 &&
    traceStopRes.insights.longTasks.count === 2 &&
    traceStopRes.insights.longTasks.maxDurationMs === 120 &&
    traceStopRes.insights.forcedReflows.length === 1 &&
    traceStopRes.insights.forcedReflows[0]?.functionName === "measureRowHeight" &&
    traceStopRes.insights.hotScripts[0]?.url === "https://example.test/app.bundle.js" &&
    Array.isArray(traceStopRes.insights.bottlenecks) &&
    traceStopRes.insights.bottlenecks.length >= 2,
  `scriptingMs=${traceStopRes.insights?.breakdownMs?.scriptingMs}, longTasks=${traceStopRes.insights?.longTasks?.count}, forcedReflows=${traceStopRes.insights?.forcedReflows?.length}`
);

// 25. getPerformanceMetrics & collectDevtoolsData combine CDP metrics with Core Web Vitals, DOM/A11y health, and actionable diagnostics
attachedTabs.add(925);
devtoolsBuffers.set(925, {
  console: [{ type: "error", text: "Uncaught TypeError: Cannot read properties of null", timestamp: Date.now() }],
  errors: [{ text: "Uncaught TypeError: Cannot read properties of null", timestamp: Date.now() }],
  issues: [],
  network: new Map([
    [
      "req-1",
      {
        requestId: "req-1",
        url: "https://example.test/api/orders",
        method: "GET",
        status: 500,
        failed: true,
        errorText: "HTTP 500",
        timestamp: Date.now()
      }
    ]
  ])
});
globalThis.chrome.scripting = {
  executeScript: async () => [
    {
      result: {
        webVitals: {
          ttfbMs: 950,
          fcpMs: 2100,
          lcpMs: 4600,
          lcpElement: "img.hero-banner",
          cls: 0.32,
          clsCulprits: ["div.promo-banner"],
          totalBlockingTimeMs: 680,
          longTasksCount: 5,
          domContentLoadedMs: 2200,
          loadEventMs: 4900
        },
        resources: {
          totalCount: 42,
          totalTransferKB: 3500,
          renderBlockingCount: 4,
          renderBlockingUrls: ["https://example.test/blocking.css"],
          slowestResources: [{ url: "https://example.test/vendor.js", initiatorType: "script", durationMs: 1850, transferKB: 1200 }]
        },
        domHealth: {
          totalElements: 2100,
          maxDepth: 36,
          maxChildrenCount: 120,
          maxChildrenSelector: "div#feed",
          iframeCount: 1,
          duplicateIds: [{ id: "submit-btn", count: 2 }],
          imagesMissingAlt: 3,
          unlabelledInputs: 2
        }
      }
    }
  ]
};
const devtoolsFull = await collectDevtoolsData(925, {});
const metricsNoRes = await cdpManager.getPerformanceMetrics(925, { includeResources: false });
const diagMetrics = (devtoolsFull.performance?.diagnostics || []).map((d) => d.metric);
record(
  "25. getPerformanceMetrics & collectDevtoolsData return Core Web Vitals, DOM/A11y health, and automated diagnostics",
  devtoolsFull.performance?.webVitals?.lcpMs === 4600 &&
    devtoolsFull.performance?.webVitals?.lcpElement === "img.hero-banner" &&
    devtoolsFull.performance?.webVitals?.cls === 0.32 &&
    devtoolsFull.performance?.webVitals?.ratings?.lcp === "poor" &&
    devtoolsFull.performance?.domHealth?.totalElements === 2100 &&
    devtoolsFull.performance?.domHealth?.duplicateIds?.[0]?.id === "submit-btn" &&
    devtoolsFull.summary?.consoleErrors === 1 &&
    devtoolsFull.summary?.failedNetworkRequests === 1 &&
    devtoolsFull.summary?.lcpMs === 4600 &&
    metricsNoRes.resources === undefined &&
    metricsNoRes.webVitals?.lcpMs === 4600 &&
    diagMetrics.includes("LCP") &&
    diagMetrics.includes("CLS") &&
    diagMetrics.includes("TBT") &&
    diagMetrics.includes("DOMNodes") &&
    diagMetrics.includes("DuplicateIDs") &&
    diagMetrics.includes("DOMDepth") &&
    diagMetrics.includes("RenderBlockingResources"),
  `lcpMs=${devtoolsFull.performance?.webVitals?.lcpMs}, cls=${devtoolsFull.performance?.webVitals?.cls}, diagnostics=${diagMetrics.join(",")}`
);

// 26-28. HeapProfiler support boundary: unsupported native tabs fail clearly, available snapshots survive optional GC failure, and timeouts stay distinct
attachedTabs.add(926);
globalThis.chrome = {
  runtime: { lastError: null },
  debugger: {
    onEvent: { addListener: () => {}, removeListener: () => {} },
    sendCommand: (_target, method, _params, cb) => {
      if (method === "HeapProfiler.collectGarbage" || method === "HeapProfiler.takeHeapSnapshot") {
        globalThis.chrome.runtime.lastError = { message: "Method not found" };
        cb({});
        globalThis.chrome.runtime.lastError = null;
        return;
      }
      cb({});
    }
  }
};
let unsupportedHeapError;
try {
  await cdpManager.takeHeapSnapshot(926, { action: "diff" });
} catch (error) {
  unsupportedHeapError = error;
}
record(
  "26. unsupported HeapProfiler returns a clear error without creating a fake baseline",
  unsupportedHeapError?.code === "HEAPPROFILER_UNAVAILABLE" && !memoryBaselines.has(926),
  `code=${unsupportedHeapError?.code}, baseline=${memoryBaselines.has(926)}`
);

attachedTabs.add(927);
let snapshotChunks = null;
globalThis.chrome.debugger.onEvent = {
  addListener: (listener) => { snapshotChunks = listener; },
  removeListener: () => { snapshotChunks = null; }
};
globalThis.chrome.debugger.sendCommand = (_target, method, _params, cb) => {
  if (method === "HeapProfiler.collectGarbage") {
    globalThis.chrome.runtime.lastError = { message: "Method not found" };
    cb({});
    globalThis.chrome.runtime.lastError = null;
  } else if (method === "Performance.getMetrics") {
    cb({ metrics: [{ name: "JSHeapUsedSize", value: 8 * 1024 * 1024 }, { name: "JSHeapTotalSize", value: 16 * 1024 * 1024 }] });
  } else if (method === "HeapProfiler.takeHeapSnapshot") {
    const raw = buildMockV8HeapSnapshot({ cachedItemCount: 2, detachedDivCount: 0 });
    snapshotChunks?.({ tabId: 927 }, "HeapProfiler.addHeapSnapshotChunk", { chunk: raw });
    cb({});
  } else {
    cb({});
  }
};
const snapshotWithoutGc = await cdpManager.takeHeapSnapshot(927, { action: "baseline" });
record(
  "27. unsupported HeapProfiler GC does not prevent an available heap snapshot",
  snapshotWithoutGc.success === true &&
    snapshotWithoutGc.totalChunks === 1 &&
    snapshotWithoutGc.totalBytes > 0 &&
    snapshotWithoutGc.heapSummary &&
    snapshotWithoutGc.garbageCollected === false &&
    snapshotWithoutGc.garbageCollectionWarning,
  `chunks=${snapshotWithoutGc.totalChunks}, bytes=${snapshotWithoutGc.totalBytes}, garbageCollected=${snapshotWithoutGc.garbageCollected}`
);

record(
  "28. HeapProfiler timeout is not misclassified as unsupported",
  cdpManager.isUnsupportedHeapProfilerError(new Error("CDP command HeapProfiler.takeHeapSnapshot timed out after 15000ms")) === false &&
    cdpManager.isUnsupportedHeapProfilerError(new Error("-32601 Method not found")) === true,
  "timeout=false, methodNotFound=true"
);

// 29. getPerformanceMetrics distinguishes liveDomElements vs blinkRetainedNodes, supports pre-metrics GC, includes runtimeErrors, and flags INP / DetachedOrUncollectedNodes / RetainedDocuments / ConsoleErrors
attachedTabs.add(929);
let gcCalled929 = false;
devtoolsBuffers.set(929, {
  console: [{ type: "error", text: "RangeError: Maximum call stack size exceeded", timestamp: Date.now() }],
  errors: [{ text: "Uncaught ReferenceError: chartInstance is not defined", timestamp: Date.now() }],
  issues: [],
  network: new Map()
});
globalThis.chrome.debugger.sendCommand = (_target, method, _params, cb) => {
  if (method === "HeapProfiler.collectGarbage") {
    gcCalled929 = true;
    cb({});
    return;
  }
  if (method === "Performance.getMetrics") {
    cb({
      metrics: [
        { name: "JSHeapUsedSize", value: 42 * 1024 * 1024 },
        { name: "JSHeapTotalSize", value: 64 * 1024 * 1024 },
        { name: "Nodes", value: 1950 },
        { name: "Documents", value: 7 },
        { name: "JSEventListeners", value: 840 }
      ]
    });
    return;
  }
  cb({});
};
globalThis.chrome.scripting = {
  executeScript: async () => [
    {
      result: {
        webVitals: {
          ttfbMs: 120,
          fcpMs: 450,
          lcpMs: 1100,
          lcpElement: "main.dashboard",
          cls: 0.02,
          clsCulprits: [],
          inpMs: 640,
          slowestInteraction: { name: "click", durationMs: 640, target: "button#stress-btn" },
          totalBlockingTimeMs: 420,
          longTasksCount: 3,
          domContentLoadedMs: 500,
          loadEventMs: 900
        },
        resources: {
          totalCount: 10,
          totalTransferKB: 420,
          renderBlockingCount: 0,
          renderBlockingUrls: [],
          slowestResources: []
        },
        domHealth: {
          totalElements: 450,
          maxDepth: 14,
          maxChildrenCount: 25,
          maxChildrenSelector: "div.grid",
          iframeCount: 0,
          duplicateIds: [],
          imagesMissingAlt: 0,
          unlabelledInputs: 0
        }
      }
    }
  ]
};
const perf929 = await cdpManager.getPerformanceMetrics(929, { collectGarbage: true });
const diag929 = (perf929.diagnostics || []).map((d) => d.metric);
record(
  "29. getPerformanceMetrics separates liveDomElements vs blinkRetainedNodes, runs optional GC, surfaces runtimeErrors, and flags INP/DetachedDOM/RetainedDocuments",
  gcCalled929 === true &&
    perf929.garbageCollected === true &&
    perf929.memory?.liveDomElements === 450 &&
    perf929.memory?.blinkRetainedNodes === 1950 &&
    perf929.memory?.detachedOrUncollectedNodes === 1500 &&
    perf929.webVitals?.inpMs === 640 &&
    perf929.webVitals?.ratings?.inp === "poor" &&
    perf929.runtimeErrors?.consoleErrorCount === 1 &&
    perf929.runtimeErrors?.pageErrorCount === 1 &&
    diag929.includes("INP") &&
    diag929.includes("DetachedOrUncollectedNodes") &&
    diag929.includes("RetainedDocuments") &&
    diag929.includes("ConsoleErrors"),
  `live=${perf929.memory?.liveDomElements}, retained=${perf929.memory?.blinkRetainedNodes}, detached=${perf929.memory?.detachedOrUncollectedNodes}, diag=${diag929.join(",")}`
);

// 30. getPerformanceMetrics survives a frozen main thread when executeScript times out and emits MainThreadBlocked diagnostic
attachedTabs.add(930);
globalThis.chrome.scripting = {
  executeScript: () => new Promise(() => {})
};
const perf930 = await cdpManager.getPerformanceMetrics(930, { probeTimeoutMs: 60 });
const diag930 = (perf930.diagnostics || []).map((d) => d.metric);
record(
  "30. getPerformanceMetrics bounds executeScript probe on a frozen main thread and returns MainThreadBlocked diagnostic",
  perf930.success === true &&
    perf930.mainThreadBlocked === true &&
    perf930.domProbeTimedOut === true &&
    perf930.memory?.blinkRetainedNodes === 1950 &&
    diag930.includes("MainThreadBlocked"),
  `mainThreadBlocked=${perf930.mainThreadBlocked}, diag=${diag930.join(",")}`
);

// 31. takeHeapSnapshot falls back to runtime-counters-fallback on extension tabs when HeapProfiler is unavailable but Performance.getMetrics is present
attachedTabs.add(931);
let step931 = 0;
globalThis.chrome.debugger.sendCommand = (_target, method, _params, cb) => {
  if (method === "HeapProfiler.collectGarbage" || method === "HeapProfiler.takeHeapSnapshot") {
    globalThis.chrome.runtime.lastError = { message: "-32601 Method not found" };
    cb({});
    globalThis.chrome.runtime.lastError = null;
    return;
  }
  if (method === "Performance.getMetrics") {
    step931++;
    if (step931 === 1) {
      cb({
        metrics: [
          { name: "JSHeapUsedSize", value: 12 * 1024 * 1024 },
          { name: "JSHeapTotalSize", value: 24 * 1024 * 1024 },
          { name: "Nodes", value: 500 },
          { name: "Documents", value: 2 },
          { name: "JSEventListeners", value: 120 }
        ]
      });
    } else {
      cb({
        metrics: [
          { name: "JSHeapUsedSize", value: 22 * 1024 * 1024 },
          { name: "JSHeapTotalSize", value: 32 * 1024 * 1024 },
          { name: "Nodes", value: 1400 },
          { name: "Documents", value: 5 },
          { name: "JSEventListeners", value: 340 }
        ]
      });
    }
    return;
  }
  cb({});
};
globalThis.chrome.scripting = {
  executeScript: async () => [
    {
      result: {
        domHealth: {
          totalElements: 420,
          maxDepth: 10,
          maxChildrenCount: 15,
          maxChildrenSelector: "div.app",
          iframeCount: 0,
          duplicateIds: [],
          imagesMissingAlt: 0,
          unlabelledInputs: 0
        }
      }
    }
  ]
};
const fallbackBaseline = await cdpManager.takeHeapSnapshot(931, { action: "baseline" });
const fallbackDiff = await cdpManager.takeHeapSnapshot(931, { action: "diff" });
record(
  "31. takeHeapSnapshot falls back to runtime-counters-fallback for baseline and diff when HeapProfiler is blocked on extension tabs",
  fallbackBaseline.success === true &&
    fallbackBaseline.snapshotMode === "runtime-counters-fallback" &&
    fallbackBaseline.baselineRecorded === true &&
    fallbackDiff.success === true &&
    fallbackDiff.snapshotMode === "runtime-counters-fallback" &&
    fallbackDiff.leakAnalysis?.hasBaseline === true &&
    fallbackDiff.leakAnalysis?.leakSuspected === true &&
    fallbackDiff.leakAnalysis?.deltas?.domNodes === 900 &&
    fallbackDiff.leakAnalysis?.deltas?.documents === 3 &&
    fallbackDiff.leakAnalysis?.deltas?.jsEventListeners === 220 &&
    fallbackDiff.leakAnalysis?.deltas?.detachedOrUncollectedNodes === 900 &&
    fallbackDiff.runtimeCounters?.detachedOrUncollectedNodes === 980,
  `mode=${fallbackDiff.snapshotMode}, leakSuspected=${fallbackDiff.leakAnalysis?.leakSuspected}, deltaDom=${fallbackDiff.leakAnalysis?.deltas?.domNodes}, detachedDelta=${fallbackDiff.leakAnalysis?.deltas?.detachedOrUncollectedNodes}`
);

// 32. collectPageWebVitalsAndDomProbe in-page function filters out #agent-pilot-* / .agent-pilot-* / .ap-* elements and collects buffered PerformanceObserver Web Vitals
let capturedPageProbeFunc = null;
attachedTabs.add(932);
globalThis.chrome.scripting = {
  executeScript: async ({ func }) => {
    capturedPageProbeFunc = func;
    return [{ result: null }];
  }
};
await cdpManager.getPerformanceMetrics(932, {});
let inPageProbeResult = null;
if (typeof capturedPageProbeFunc === "function") {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevPerformance = globalThis.performance;
  const prevPerformanceObserver = globalThis.PerformanceObserver;
  try {
    const dupBtn1 = { id: "dup-btn", tagName: "BUTTON", className: "btn", children: [], getAttribute: () => null };
    const dupBtn2 = { id: "dup-btn", tagName: "BUTTON", className: "btn", children: [], getAttribute: () => null };
    const appMain = {
      id: "app-main",
      tagName: "MAIN",
      className: "dashboard-shell",
      children: [dupBtn1, dupBtn2],
      getAttribute: () => null
    };
    const injectedRing = { id: "agent-pilot-cursor-ring", tagName: "DIV", className: "", children: [], getAttribute: () => null };
    const injectedCursor1 = {
      id: "agent-pilot-cursor-layer",
      tagName: "DIV",
      className: "",
      children: [injectedRing],
      getAttribute: () => null
    };
    const injectedCursor2 = {
      id: "agent-pilot-cursor-layer",
      tagName: "DIV",
      className: "",
      children: [],
      getAttribute: () => null
    };
    const injectedBadge = {
      id: "",
      tagName: "SPAN",
      className: "ap-badge",
      children: [],
      getAttribute: () => null
    };
    const bodyEl = {
      id: "",
      tagName: "BODY",
      className: "",
      children: [appMain, injectedCursor1, injectedCursor2, injectedBadge],
      getAttribute: () => null
    };
    const htmlEl = {
      id: "",
      tagName: "HTML",
      className: "",
      children: [bodyEl],
      getAttribute: () => null
    };
    const allSyntheticElements = [htmlEl, bodyEl, appMain, dupBtn1, dupBtn2, injectedCursor1, injectedRing, injectedCursor2, injectedBadge];
    globalThis.window = {};
    globalThis.document = {
      documentElement: htmlEl,
      body: bodyEl,
      title: "Synthetic Dashboard",
      readyState: "complete",
      querySelectorAll: (sel) => (sel === "*" ? allSyntheticElements : []),
      getElementById: () => null
    };
    globalThis.performance = {
      getEntriesByType: (type) => {
        if (type === "navigation") {
          return [{ responseStart: 90, requestStart: 10, domInteractive: 210, domContentLoadedEventEnd: 320, loadEventEnd: 610, transferSize: 12345, encodedBodySize: 12000, decodedBodySize: 28000 }];
        }
        if (type === "paint") {
          return [{ name: "first-paint", startTime: 180 }, { name: "first-contentful-paint", startTime: 240 }];
        }
        if (type === "resource") {
          return [];
        }
        return [];
      }
    };
    globalThis.PerformanceObserver = class {
      constructor(cb) {
        this.cb = cb;
      }
      observe({ type }) {
        if (type === "largest-contentful-paint") {
          this.cb({
            getEntries: () => [{ startTime: 820, size: 48000, element: { tagName: "MAIN", id: "app-main", className: "dashboard-shell" } }]
          });
        } else if (type === "layout-shift") {
          this.cb({
            getEntries: () => [{ value: 0.04, hadRecentInput: false, sources: [{ node: { tagName: "DIV", id: "banner", className: "" } }] }]
          });
        } else if (type === "longtask") {
          this.cb({
            getEntries: () => [{ startTime: 300, duration: 130 }]
          });
        } else if (type === "event") {
          this.cb({
            getEntries: () => [{ name: "click", duration: 280, startTime: 400, interactionId: 7, target: { tagName: "BUTTON", id: "dup-btn", className: "btn" } }]
          });
        }
      }
      disconnect() {}
    };
    inPageProbeResult = await capturedPageProbeFunc();
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    globalThis.performance = prevPerformance;
    globalThis.PerformanceObserver = prevPerformanceObserver;
  }
}
record(
  "32. in-page probe excludes #agent-pilot-* / .ap-* overlays from domHealth and collects buffered PerformanceObserver LCP/CLS/INP/LongTasks",
  inPageProbeResult?.domHealth?.totalElements === 5 &&
    inPageProbeResult?.domHealth?.duplicateIds?.length === 1 &&
    inPageProbeResult?.domHealth?.duplicateIds?.[0]?.id === "dup-btn" &&
    inPageProbeResult?.webVitals?.lcpMs === 820 &&
    inPageProbeResult?.webVitals?.lcpElement === "main#app-main.dashboard-shell" &&
    inPageProbeResult?.webVitals?.cls === 0.04 &&
    inPageProbeResult?.webVitals?.inpMs === 280 &&
    inPageProbeResult?.webVitals?.slowestInteraction?.target === "button#dup-btn.btn" &&
    inPageProbeResult?.webVitals?.longTasksCount === 1 &&
    inPageProbeResult?.webVitals?.totalBlockingTimeMs === 80,
  `totalElements=${inPageProbeResult?.domHealth?.totalElements}, dupIds=${JSON.stringify(inPageProbeResult?.domHealth?.duplicateIds)}, lcp=${inPageProbeResult?.webVitals?.lcpMs}, inp=${inPageProbeResult?.webVitals?.inpMs}, tbt=${inPageProbeResult?.webVitals?.totalBlockingTimeMs}`
);

// 33. Background tab paint starvation (visibilityState='hidden') & late-foreground LCP inflation detection + bringToFront support
attachedTabs.add(933);
let bringToFrontCdpCalls = 0;
let bringToFrontTabUpdates = 0;
globalThis.chrome.tabs = {
  update: async (_tid, props) => {
    if (props?.active === true) bringToFrontTabUpdates++;
    return { id: 933, active: true };
  }
};
globalThis.chrome.debugger.sendCommand = (_target, method, _params, cb) => {
  globalThis.chrome.runtime.lastError = null;
  if (method === "Page.bringToFront") {
    bringToFrontCdpCalls++;
    cb({});
    return;
  }
  if (method === "Performance.getMetrics") {
    cb({
      metrics: [
        { name: "JSHeapUsedSize", value: 18 * 1024 * 1024 },
        { name: "JSHeapTotalSize", value: 32 * 1024 * 1024 },
        { name: "Nodes", value: 380 },
        { name: "Documents", value: 1 }
      ]
    });
    return;
  }
  cb({});
};
let probeMode933 = "hidden";
globalThis.chrome.scripting = {
  executeScript: async () => {
    if (probeMode933 === "hidden") {
      return [
        {
          result: {
            webVitals: {
              ttfbMs: 12,
              fcpMs: undefined,
              lcpMs: undefined,
              cls: 0,
              clsCulprits: [],
              domInteractiveMs: 85,
              domContentLoadedMs: 120,
              loadEventMs: 368,
              visibilityState: "hidden",
              wasHiddenBeforePaint: true,
              backgroundTabPaintDeferred: true,
              longTasksCount: 0,
              totalBlockingTimeMs: 0,
              maxLongTaskMs: 0,
              topLongTasks: []
            },
            domHealth: { totalElements: 376, maxDepth: 11, maxChildrenCount: 8, iframeCount: 0, duplicateIds: [] }
          }
        }
      ];
    }
    return [
      {
        result: {
          webVitals: {
            ttfbMs: 12,
            fcpMs: 34008,
            lcpMs: 34008,
            lcpElement: "h1.hero-title",
            cls: 0,
            clsCulprits: [],
            domInteractiveMs: 85,
            domContentLoadedMs: 120,
            loadEventMs: 368,
            visibilityState: "visible",
            wasHiddenBeforePaint: true,
            lateForegroundPaint: true,
            backgroundDwellEstimateMs: 33640,
            longTasksCount: 0,
            totalBlockingTimeMs: 0,
            maxLongTaskMs: 0,
            topLongTasks: []
          },
          domHealth: { totalElements: 376, maxDepth: 11, maxChildrenCount: 8, iframeCount: 0, duplicateIds: [] }
        }
      }
    ];
  }
};
const hiddenMetrics = await cdpManager.getPerformanceMetrics(933, {});
probeMode933 = "late-foreground";
const lateForegroundMetrics = await cdpManager.getPerformanceMetrics(933, { bringToFront: true });
record(
  "33. getPerformanceMetrics flags BackgroundTabPaintDeferred & LateForegroundPaintInflation without false-positive Slow LCP and supports bringToFront",
  hiddenMetrics.webVitals?.ratings?.fcp === "deferred-background-tab" &&
    hiddenMetrics.webVitals?.ratings?.lcp === "deferred-background-tab" &&
    hiddenMetrics.diagnostics.some((d) => d.metric === "BackgroundTabPaintDeferred") &&
    !hiddenMetrics.diagnostics.some((d) => d.metric === "LCP") &&
    lateForegroundMetrics.broughtToFront === true &&
    bringToFrontCdpCalls === 1 &&
    bringToFrontTabUpdates === 1 &&
    lateForegroundMetrics.webVitals?.ratings?.lcp === "deferred-background-tab" &&
    lateForegroundMetrics.diagnostics.some((d) => d.metric === "LateForegroundPaintInflation" && d.backgroundDwellEstimateMs === 33640) &&
    !lateForegroundMetrics.diagnostics.some((d) => d.metric === "LCP"),
  `hiddenDiag=${JSON.stringify(hiddenMetrics.diagnostics.map((d) => d.metric))}, lateDiag=${JSON.stringify(lateForegroundMetrics.diagnostics.map((d) => d.metric))}, broughtToFront=${lateForegroundMetrics.broughtToFront}`
);

// 34. evaluateInTab bounds wedged MAIN-world executeScript with fast timeout and passes timeout to CDP Runtime.evaluate (or throws MAIN_THREAD_BLOCKED)
attachedTabs.add(934);
let cdpRuntimeEvalParams = null;
let cdpEvalShouldFail = false;
globalThis.chrome.scripting = {
  executeScript: () => new Promise(() => {}) // Simulate infinite loop on main thread
};
globalThis.chrome.debugger.sendCommand = (_target, method, params, cb) => {
  globalThis.chrome.runtime.lastError = null;
  if (method === "Runtime.evaluate") {
    cdpRuntimeEvalParams = params;
    if (cdpEvalShouldFail) {
      globalThis.chrome.runtime.lastError = { message: "Execution was terminated" };
      cb({});
      return;
    }
    cb({ result: { type: "string", value: "fallback-ok" } });
    return;
  }
  cb({});
};
const evalFallbackVal = await evaluateInTab(934, "document.title", null, { timeoutMs: 150 });
cdpEvalShouldFail = true;
let evalBlockedErr = null;
try {
  await evaluateInTab(934, "while(true){}", null, { timeoutMs: 120 });
} catch (err) {
  evalBlockedErr = err;
}
record(
  "34. evaluateInTab times out wedged executeScript quickly, passes V8 timeout to CDP Runtime.evaluate, and reports MAIN_THREAD_BLOCKED when wedged",
  evalFallbackVal === "fallback-ok" &&
    cdpRuntimeEvalParams?.timeout === 120 &&
    Boolean(evalBlockedErr && String(evalBlockedErr.message).includes("MAIN_THREAD_BLOCKED")),
  `evalFallbackVal=${evalFallbackVal}, cdpTimeout=${cdpRuntimeEvalParams?.timeout}, blockedErr=${evalBlockedErr?.message}`
);

// 35. collectDevtoolsData infers requestedType='console' when console=true & network=false, and network.listRequests strips bulky headers while enriching cacheStatus/contentEncoding/transferKB/summary
const { systemHandlers } = await import("../../../extensions/background/agent-handlers/system.js");
attachedTabs.add(935);
devtoolsBuffers.set(935, {
  console: [
    { id: "c1", type: "log", text: "boot ok", timestamp: 1000 },
    { id: "c2", type: "error", text: "failed chunk load", timestamp: 1005 }
  ],
  network: new Map([
    [
      "n1",
      {
        id: "n1",
        url: "https://lagom.sphoton.com/vi",
        method: "GET",
        type: "Document",
        status: 200,
        encodedDataLength: 31800,
        durationMs: 16268,
        requestHeaders: { "user-agent": "Mozilla/5.0", cookie: "sid=123" },
        headers: {
          "cf-cache-status": "DYNAMIC",
          "x-nextjs-cache": "MISS",
          "content-encoding": "zstd",
          "cache-control": "private, no-cache, no-store"
        }
      }
    ],
    [
      "n2",
      {
        id: "n2",
        url: "https://lagom.sphoton.com/_next/static/chunks/main.js",
        method: "GET",
        type: "Script",
        status: 200,
        encodedDataLength: 102400,
        durationMs: 85,
        requestHeaders: { "user-agent": "Mozilla/5.0" },
        headers: {
          "cf-cache-status": "HIT",
          "content-encoding": "br"
        }
      }
    ]
  ])
});
const consoleOnlyPayload = await collectDevtoolsData(935, { console: true, network: false });
const netListCompact = await new Promise((resolve, reject) => {
  systemHandlers["network.listRequests"](
    { getTargetTabId: async () => 935 },
    { tabId: 935 },
    (res, err) => (err ? reject(err) : resolve(res))
  );
});
const netListWithHeaders = await new Promise((resolve, reject) => {
  systemHandlers["network.listRequests"](
    { getTargetTabId: async () => 935 },
    { tabId: 935, includeHeaders: true },
    (res, err) => (err ? reject(err) : resolve(res))
  );
});
cleanupTabResources(935);
record(
  "35. collectDevtoolsData isolates console-only requests & network.listRequests strips raw headers while enriching cacheStatus/contentEncoding/summary",
  Array.isArray(consoleOnlyPayload.console) &&
    consoleOnlyPayload.console.length === 2 &&
    consoleOnlyPayload.network === undefined &&
    consoleOnlyPayload.performance === undefined &&
    netListCompact.summary?.returnedCount === 2 &&
    netListCompact.summary?.totalTransferKB === 131.1 &&
    netListCompact.summary?.byType?.Document?.count === 1 &&
    netListCompact.summary?.byType?.Script?.count === 1 &&
    netListCompact.requests[0].headers === undefined &&
    netListCompact.requests[0].requestHeaders === undefined &&
    netListCompact.requests[0].cacheStatus === "DYNAMIC" &&
    netListCompact.requests[0].contentEncoding === "zstd" &&
    netListCompact.requests[0].transferKB === 31.1 &&
    netListWithHeaders.requests[0].headers?.["cf-cache-status"] === "DYNAMIC" &&
    netListWithHeaders.requests[0].requestHeaders?.["user-agent"] === "Mozilla/5.0",
  `consoleOnlyHasPerf=${consoleOnlyPayload.performance !== undefined}, compactHeaders=${netListCompact.requests[0]?.headers}, cacheStatus=${netListCompact.requests[0]?.cacheStatus}, totalKB=${netListCompact.summary?.totalTransferKB}`
);

// 36. getPerformanceMetrics exposes navigationTiming breakdown, resources.byType, and emits PageLoadIncomplete diagnostic when readyState !== 'complete'
attachedTabs.add(936);
globalThis.chrome.scripting = {
  executeScript: async () => [
    {
      result: {
        webVitals: {
          ttfbMs: 16188,
          fcpMs: 16472,
          lcpMs: 16472,
          cls: 0,
          clsCulprits: [],
          domInteractiveMs: 16349,
          domContentLoadedMs: 16418,
          loadEventMs: undefined,
          readyState: "interactive",
          visibilityState: "visible",
          navigationTiming: {
            type: "navigate",
            protocol: "h2",
            responseStatus: 200,
            redirectCount: 1,
            dnsMs: 15,
            tcpMs: 28,
            tlsMs: 19,
            ttfbMs: 16188,
            responseDownloadMs: 80,
            domInteractiveMs: 16349,
            domContentLoadedMs: 16418,
            loadEventMs: undefined,
            transferKB: 31.1,
            encodedBodyKB: 30.8,
            decodedBodyKB: 183.7
          },
          longTasksCount: 1,
          totalBlockingTimeMs: 42,
          maxLongTaskMs: 92,
          topLongTasks: []
        },
        resources: {
          totalCount: 3,
          totalTransferKB: 145.5,
          byType: {
            script: { count: 2, transferKB: 120.5, maxDurationMs: 140 },
            img: { count: 1, transferKB: 25, maxDurationMs: 65 }
          },
          renderBlockingCount: 0,
          renderBlockingUrls: [],
          slowestResources: []
        },
        domHealth: { totalElements: 520, maxDepth: 12, maxChildrenCount: 10, iframeCount: 0, duplicateIds: [] }
      }
    }
  ]
};
const perf936 = await cdpManager.getPerformanceMetrics(936, {});
const diag936 = (perf936.diagnostics || []).map((d) => d.metric);
cleanupTabResources(936);
record(
  "36. getPerformanceMetrics includes navigationTiming, resources.byType, and emits PageLoadIncomplete when readyState !== 'complete'",
  perf936.navigationTiming?.protocol === "h2" &&
    perf936.navigationTiming?.ttfbMs === 16188 &&
    perf936.navigationTiming?.decodedBodyKB === 183.7 &&
    perf936.resources?.byType?.script?.count === 2 &&
    perf936.resources?.byType?.img?.transferKB === 25 &&
    diag936.includes("PageLoadIncomplete") &&
    inPageProbeResult?.webVitals?.navigationTiming?.ttfbMs === 80 &&
    inPageProbeResult?.webVitals?.readyState === "complete",
  `protocol=${perf936.navigationTiming?.protocol}, ttfb=${perf936.navigationTiming?.ttfbMs}, byType=${JSON.stringify(perf936.resources?.byType)}, diag=${diag936.join(",")}`
);

// 37. waitForTabComplete & tabs.create surface loadTimedOut=true when initial page load exceeds loadTimeout while status is still 'loading'
const { waitForTabComplete } = await import("../../../extensions/background/tab-manager.js");
const { tabsHandlers } = await import("../../../extensions/background/agent-handlers/tabs.js");
globalThis.chrome = {
  runtime: { lastError: null },
  tabs: {
    create: (opts, cb) => cb({ id: 937, url: opts.url, status: "loading", active: true, windowId: 1 }),
    get: async (id) => ({ id, url: "https://lagom.sphoton.com/vi", status: "loading", active: true, windowId: 1 }),
    onUpdated: {
      addListener: () => {},
      removeListener: () => {}
    }
  },
  debugger: {
    getTargets: (cb) => cb([]),
    attach: (_t, _v, cb) => cb(),
    sendCommand: (_t, _m, _p, cb) => cb({})
  }
};
const rawWaitTimeout = await waitForTabComplete(937, 25);
const createdSlowTab = await new Promise((resolve, reject) => {
  tabsHandlers["tabs.create"](
    {
      getActiveTabId: async () => 937,
      recordAgentTab: () => {},
      assignTabToAgentGroup: async () => {},
      broadcastFn: null
    },
    { url: "https://lagom.sphoton.com/vi", active: true, timeoutMs: 25 },
    (res, err) => (err ? reject(err) : resolve(res))
  );
});
cleanupTabResources(937);
record(
  "37. waitForTabComplete & tabs.create surface loadTimedOut=true when page load exceeds timeout while still loading",
  rawWaitTimeout?.completed === false &&
    rawWaitTimeout?.timedOut === true &&
    createdSlowTab?.status === "loading" &&
    createdSlowTab?.loadTimedOut === true &&
    createdSlowTab?.loadTimeoutMs === 25,
  `waitResult=${JSON.stringify(rawWaitTimeout)}, tabStatus=${createdSlowTab?.status}, loadTimedOut=${createdSlowTab?.loadTimedOut}`
);

// 38. dispatchCdpMouseClick with dblClick: true dispatches clickCount 1 then 2
attachedTabs.add(938);
const clickEvents38 = [];
globalThis.chrome.debugger.sendCommand = (_target, method, params, cb) => {
  if (method === "Input.dispatchMouseEvent") {
    clickEvents38.push({ type: params.type, clickCount: params.clickCount });
  }
  cb({});
};
await cdpManager.dispatchCdpMouseClick(938, 200, 150, { dblClick: true });
cleanupTabResources(938);
record(
  "38. dispatchCdpMouseClick with dblClick: true dispatches clickCount 1 then 2",
  clickEvents38.filter((e) => e.type === "mousePressed").map((e) => e.clickCount).join(",") === "1,2" &&
    clickEvents38.filter((e) => e.type === "mouseReleased").map((e) => e.clickCount).join(",") === "1,2",
  `events=${JSON.stringify(clickEvents38.filter((e) => e.type !== "mouseMoved"))}`
);

// 39. evaluateInTab resolves @ref/selector args, cleans up marker attributes, and invokes user function in MAIN world
let markedArgs39 = null;
let unmarkedPrefix39 = null;
let mainWorldExec39 = null;
globalThis.chrome.tabs = {
  get: async (id) => ({ id, url: "https://example.test", status: "complete" }),
  sendMessage: (_tabId, msg, cb) => {
    if (msg.action === "mark_eval_targets") {
      markedArgs39 = msg.args;
      cb({
        success: true,
        prefix: "eval_1_0",
        descriptors: [
          { kind: "element", attr: "data-ap-eval-arg-0", token: "eval_1_0" },
          { kind: "value", value: "extra-val" }
        ]
      });
      return;
    }
    if (msg.action === "unmark_eval_targets") {
      unmarkedPrefix39 = msg.prefix;
      cb({ success: true });
      return;
    }
    cb({ status: "ok", success: true });
  }
};
globalThis.chrome.scripting = {
  executeScript: async (opts) => {
    if (opts.world === "MAIN" && Array.isArray(opts.args)) {
      mainWorldExec39 = opts;
    }
    return [{ result: { ok: true, value: "btn-1:extra-val" } }];
  }
};
const evalRes39 = await evaluateInTab(
  939,
  "(el, label) => el.id + ':' + label",
  () => {},
  ["@1", "extra-val"]
);
cleanupTabResources(939);
record(
  "39. evaluateInTab resolves @ref/selector args, passes descriptors to MAIN world, and cleans up markers",
  evalRes39 === "btn-1:extra-val" &&
    Array.isArray(markedArgs39) &&
    markedArgs39.length === 2 &&
    markedArgs39[0] === "@1" &&
    unmarkedPrefix39 === "eval_1_0" &&
    mainWorldExec39?.world === "MAIN" &&
    Array.isArray(mainWorldExec39?.args?.[1]) &&
    mainWorldExec39.args[1].length === 2,
  `result=${evalRes39}, marked=${JSON.stringify(markedArgs39)}, unmarked=${unmarkedPrefix39}`
);

// 40. tabs.update supports action="reload", ignoreCache=true, initScript, handleBeforeUnload="accept", and includeSnapshot=true
const invokeHandler = (method, client, params) =>
  new Promise((resolve, reject) => {
    AGENT_COMMAND_HANDLERS[method](client, params, (res, err) => {
      if (err) reject(err);
      else resolve(res);
    });
  });

attachedTabs.add(940);
const cdpCalls40 = [];
globalThis.chrome.debugger.sendCommand = (_target, method, params, cb) => {
  cdpCalls40.push({ method, params });
  if (method === "Page.addScriptToEvaluateOnNewDocument") {
    cb({ identifier: "script-1" });
    return;
  }
  cb({});
};
globalThis.chrome.tabs = {
  get: async (id) => ({ id, url: "https://example.test/dashboard", title: "Dashboard", status: "complete", active: true }),
  sendMessage: (_tabId, msg, cb) => {
    if (msg.action === "get_interactive_snapshot") {
      cb({ elements: [{ ref: "@1", tag: "button", text: "Refresh" }], count: 1 });
      return;
    }
    if (msg.action === "ping") {
      cb({ status: "ok" });
      return;
    }
    cb({ success: true });
  },
  onUpdated: { addListener: () => {}, removeListener: () => {} }
};
const navRes40 = await invokeHandler(
  "tabs.update",
  {
    getTargetTabId: async () => 940,
    assignTabToAgentGroup: async () => {},
    sendTabMessageWithRetry: async (_tabId, msg) => {
      if (msg.action === "get_snapshot" || msg.action === "get_interactive_snapshot") {
        return { elements: [{ ref: "@1", tag: "button", text: "Refresh" }], count: 1 };
      }
      return { success: true };
    },
    broadcastFn: () => {}
  },
  {
    tabId: 940,
    action: "reload",
    ignoreCache: true,
    initScript: "window.__TEST_INIT__ = 1;",
    handleBeforeUnload: "accept",
    includeSnapshot: true
  }
);
cleanupTabResources(940);
record(
  "40. tabs.update supports action='reload', ignoreCache, initScript, handleBeforeUnload, and includeSnapshot",
  navRes40.navigationAction === "reload" &&
    navRes40.initScriptIdentifier === "script-1" &&
    navRes40.snapshot?.count === 1 &&
    cdpCalls40.some((c) => c.method === "Page.reload" && c.params?.ignoreCache === true) &&
    cdpCalls40.some((c) => c.method === "Page.addScriptToEvaluateOnNewDocument"),
  `action=${navRes40.navigationAction}, initScriptId=${navRes40.initScriptIdentifier}, snapshotCount=${navRes40.snapshot?.count}`
);

// 41. captureTabScreenshot supports format="webp" and quality=80
const { captureTabScreenshot } = await import("../../../extensions/background/screenshot-service.js");
let convertedMime41 = null;
let convertedQuality41 = null;
const prevOffscreen41 = globalThis.OffscreenCanvas;
const prevCreateBitmap41 = globalThis.createImageBitmap;
const prevFetch41 = globalThis.fetch;
globalThis.fetch = async () => ({
  blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })
});
globalThis.createImageBitmap = async () => ({
  width: 800,
  height: 600,
  close: () => {}
});
globalThis.OffscreenCanvas = class MockWebpCanvas {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return { drawImage: () => {} };
  }
  async convertToBlob(opts) {
    convertedMime41 = opts?.type;
    convertedQuality41 = opts?.quality;
    return new Blob([new Uint8Array([82, 73, 70, 70])], { type: opts?.type || "image/webp" });
  }
};
globalThis.chrome.tabs = {
  get: async (id) => ({ id, active: true, width: 800, height: 600, windowId: 1 }),
  captureVisibleTab: (_winId, _opts, cb) => cb("data:image/png;base64,iVBORw0KGgo=")
};
const shotWebp41 = await captureTabScreenshot(941, { format: "webp", quality: 80 });
globalThis.OffscreenCanvas = prevOffscreen41;
globalThis.createImageBitmap = prevCreateBitmap41;
globalThis.fetch = prevFetch41;
cleanupTabResources(941);
record(
  "41. captureTabScreenshot supports format='webp' and quality=80",
  shotWebp41.format === "webp" &&
    convertedMime41 === "image/webp" &&
    Math.abs(convertedQuality41 - 0.8) < 0.001 &&
    typeof shotWebp41.dataUrl === "string" &&
    shotWebp41.dataUrl.startsWith("data:image/webp;base64,"),
  `format=${shotWebp41.format}, mime=${convertedMime41}, quality=${convertedQuality41}`
);

// 42. Navigation-aware Console/Network buffers & msgid single-message lookup
const { getBuffer } = await import("../../../extensions/background/constants.js");
devtoolsBuffers.delete(942);
const buf42 = getBuffer(942);
buf42.console.push(
  { msgid: 1, navigationId: 1, type: "log", text: "old nav log", args: ["old nav log"], timestamp: 1000 },
  { msgid: 2, navigationId: 2, type: "error", text: "current nav error", args: ["current nav error", { code: 500 }], timestamp: 2000 }
);
buf42.navigationId = 2;
buf42.nextConsoleMsgId = 3;
buf42.network.set("r1", { requestId: "r1", navigationId: 1, url: "https://example.test/old", method: "GET", status: 200 });
buf42.network.set("r2", { requestId: "r2", navigationId: 2, url: "https://example.test/new", method: "POST", status: 201 });

const currentNavDevtools = await collectDevtoolsData(942, { type: "console", includePreserved: false });
const allNavDevtools = await collectDevtoolsData(942, { type: "console", includePreserved: true });
const msgLookup42 = await collectDevtoolsData(942, { msgid: 2 });
const netCurrentNav42 = await invokeHandler(
  "network.listRequests",
  { getTargetTabId: async () => 942 },
  { tabId: 942, includePreserved: false }
);
cleanupTabResources(942);
record(
  "42. Navigation-aware Console/Network buffers filter by includePreserved/navigationId and inspect by msgid",
  currentNavDevtools.console?.length === 1 &&
    currentNavDevtools.console[0].msgid === 2 &&
    allNavDevtools.console?.length === 2 &&
    msgLookup42.message?.msgid === 2 &&
    msgLookup42.message?.args?.[1]?.code === 500 &&
    netCurrentNav42.matchingCount === 1 &&
    netCurrentNav42.navigationId === 2 &&
    netCurrentNav42.requests?.[0]?.requestId === "r2",
  `currentConsole=${currentNavDevtools.console?.length}, allConsole=${allNavDevtools.console?.length}, msgId=${msgLookup42.message?.msgid}, netCurrent=${netCurrentNav42.matchingCount}`
);

// 43. webauthn.manage supports virtual authenticator lifecycle over tab-scoped CDP
attachedTabs.add(943);
const webauthnCdp43 = [];
globalThis.chrome.debugger.sendCommand = (_target, method, params, cb) => {
  webauthnCdp43.push({ method, params });
  if (method === "WebAuthn.addVirtualAuthenticator") {
    cb({ authenticatorId: "auth-virtual-1" });
    return;
  }
  if (method === "WebAuthn.getCredentials") {
    cb({ credentials: [{ credentialId: "cred-1", rpId: "example.test", signCount: 1 }] });
    return;
  }
  cb({});
};
const webauthnClient43 = {
  getTargetTabId: async () => 943,
  runWithTabLock: async (_tabId, _op, fn) => fn(),
  broadcastFn: () => {}
};
const addAuthRes43 = await invokeHandler("webauthn.manage", webauthnClient43, {
  tabId: 943,
  action: "addAuthenticator",
  protocol: "ctap2",
  transport: "internal"
});
const getCredsRes43 = await invokeHandler("webauthn.manage", webauthnClient43, {
  tabId: 943,
  action: "credentials",
  authenticatorId: "auth-virtual-1"
});
const verifyRes43 = await invokeHandler("webauthn.manage", webauthnClient43, {
  tabId: 943,
  action: "verify",
  authenticatorId: "auth-virtual-1",
  isUserVerified: true
});
const clearRes43 = await invokeHandler("webauthn.manage", webauthnClient43, {
  tabId: 943,
  action: "clear",
  authenticatorId: "auth-virtual-1"
});
const disableAuthRes43 = await invokeHandler("webauthn.manage", webauthnClient43, {
  tabId: 943,
  action: "disable"
});
cleanupTabResources(943);
record(
  "43. webauthn.manage manages virtual authenticators and credentials via WebAuthn CDP domain",
  addAuthRes43.authenticatorId === "auth-virtual-1" &&
    getCredsRes43.credentials?.length === 1 &&
    getCredsRes43.credentials?.[0]?.credentialId === "cred-1" &&
    verifyRes43.action === "setUserVerified" &&
    clearRes43.action === "clearCredentials" &&
    disableAuthRes43.success === true &&
    webauthnCdp43.some((c) => c.method === "WebAuthn.enable") &&
    webauthnCdp43.some((c) => c.method === "WebAuthn.addVirtualAuthenticator") &&
    webauthnCdp43.some((c) => c.method === "WebAuthn.getCredentials") &&
    webauthnCdp43.some((c) => c.method === "WebAuthn.setUserVerified") &&
    webauthnCdp43.some((c) => c.method === "WebAuthn.clearCredentials") &&
    webauthnCdp43.some((c) => c.method === "WebAuthn.disable"),
  `authId=${addAuthRes43.authenticatorId}, creds=${getCredsRes43.credentials?.length}, cdpCalls=${webauthnCdp43.map((c) => c.method).join(",")}`
);

// 44. evaluateInTab honors large timeoutMs without 4000ms clamping and fails fast on async Promise timeout without double-executing via CDP
attachedTabs.add(944);
let cdpEvalCount44 = 0;
let passedBudget44 = null;
globalThis.window = {
  eval: (code) => {
    if (code === "async_slow_never_resolves") {
      return new Promise(() => {});
    }
    return Promise.resolve("async-ok-45000");
  }
};
globalThis.chrome.scripting = {
  executeScript: async (opts) => {
    passedBudget44 = opts.args?.[2];
    const res = await opts.func(...opts.args);
    return [{ result: res }];
  }
};
globalThis.chrome.debugger.sendCommand = (_target, method, _params, cb) => {
  if (method === "Runtime.evaluate") {
    cdpEvalCount44++;
  }
  cb({ result: { type: "string", value: "should-not-run-cdp" } });
};
const evalLargeTimeoutVal44 = await evaluateInTab(944, "async_ok", null, { timeoutMs: 45000 });
const savedBudget44 = passedBudget44;
await evaluateInTab(944, "async_ok", null, { timeoutMs: 9999999 });
const clampedBudget44 = passedBudget44;
let asyncTimeoutErr44 = null;
try {
  await evaluateInTab(944, "async_slow_never_resolves", null, { timeoutMs: 220 });
} catch (err) {
  asyncTimeoutErr44 = err;
}
cleanupTabResources(944);
record(
  "44. evaluateInTab honors timeoutMs > 4000ms, clamps ceiling at 120000ms, and throws EVAL_ASYNC_TIMEOUT without re-running script via CDP",
  evalLargeTimeoutVal44 === "async-ok-45000" &&
    savedBudget44 === 45000 &&
    clampedBudget44 === 120000 &&
    cdpEvalCount44 === 0 &&
    Boolean(asyncTimeoutErr44 && String(asyncTimeoutErr44.message).includes("EVAL_ASYNC_TIMEOUT")),
  `val=${evalLargeTimeoutVal44}, budget=${savedBudget44}, clamped=${clampedBudget44}, cdpEvalCount=${cdpEvalCount44}, err=${asyncTimeoutErr44?.message}`
);

// 45. dispatchCdpKeyEvent & page.pressKey support multi-key sequences, native editing commands (selectAll/paste/copy/cut/undo/redo), F1-F12, and Ctrl++
const { dispatchCdpKeyEvent, parseCdpKeyCombo } = await import("../../../extensions/background/cdp-input.js");
attachedTabs.add(945);
const cdpKeyEvents45 = [];
globalThis.chrome.debugger.sendCommand = (_target, method, params, cb) => {
  if (method === "Input.dispatchKeyEvent") {
    cdpKeyEvents45.push(params);
  }
  cb({});
};
const comboCtrlPlus = parseCdpKeyCombo("Ctrl++");
const comboF5 = parseCdpKeyCombo("F5");
const keySeqRes45 = await dispatchCdpKeyEvent(945, ["Ctrl+a", "Ctrl+v", "1", "2", "3", "Enter"], null, { delayMs: 0 });
const rawDownEvents45 = cdpKeyEvents45.filter((e) => e.type === "rawKeyDown");
const charEvents45 = cdpKeyEvents45.filter((e) => e.type === "char");
cleanupTabResources(945);
record(
  "45. dispatchCdpKeyEvent supports multi-key sequence, attaches native editing commands (selectAll/paste), and maps F1-F12 & Ctrl++",
  keySeqRes45.count === 6 &&
    rawDownEvents45.length === 6 &&
    rawDownEvents45[0].commands?.[0] === "selectAll" &&
    rawDownEvents45[1].commands?.[0] === "paste" &&
    charEvents45.map((e) => e.text).join("") === "123\r" &&
    comboCtrlPlus.modifiers === 10 &&
    comboCtrlPlus.keyInfo.code === "Equal" &&
    comboCtrlPlus.keyInfo.key === "+" &&
    comboF5.keyInfo.code === "F5" &&
    comboF5.keyInfo.keyCode === 116,
  `count=${keySeqRes45.count}, cmds=${rawDownEvents45.slice(0, 2).map((e) => e.commands?.[0]).join(",")}, chars=${JSON.stringify(charEvents45.map((e) => e.text).join(""))}, f5=${comboF5.keyInfo.keyCode}`
);

// 46. parseAnnotationSpecItem & annotateDataUrlInWorker render arrows, callouts, numbered badges, dashed boxes, circles, vector icons, redactions, and spotlight
const { parseAnnotationSpecItem } = await import("../../../extensions/background/screenshot-service.js");
const parsedArrow46 = parseAnnotationSpecItem("arrow", "@1->@2|red:Chuyển bước");
const parsedCallout46 = parseAnnotationSpecItem("callout", "ul > li:nth-child(2):Bước 3: Bấm Đăng nhập (CTA)|green|top");
const parsedBadge46 = parseAnnotationSpecItem("badge", "1:@1:Nhập Email: user@test.com|cyan");
const parsedBox46 = parseAnnotationSpecItem("box", "#err:not(:disabled)|red|dashed:Lỗi: dữ liệu (bắt buộc)");
const parsedIcon46 = parseAnnotationSpecItem("icon", "check:@1:Hợp lệ");

const richOps46 = [];
const prevOffscreen46 = globalThis.OffscreenCanvas;
const prevBitmap46 = globalThis.createImageBitmap;
const prevFetch46 = globalThis.fetch;
globalThis.fetch = async () => ({
  blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })
});
globalThis.createImageBitmap = async () => ({ width: 1280, height: 720, close: () => {} });
globalThis.OffscreenCanvas = class MockRichOffscreenCanvas {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return {
      drawImage: () => richOps46.push("drawImage"),
      save: () => {},
      restore: () => {},
      beginPath: () => richOps46.push("beginPath"),
      moveTo: () => richOps46.push("moveTo"),
      lineTo: () => richOps46.push("lineTo"),
      closePath: () => richOps46.push("closePath"),
      arc: () => richOps46.push("arc"),
      ellipse: () => richOps46.push("ellipse"),
      rect: () => richOps46.push("rect"),
      clip: (rule) => richOps46.push(`clip:${rule}`),
      fill: () => richOps46.push("fill"),
      stroke: () => richOps46.push("stroke"),
      setLineDash: () => richOps46.push("setLineDash"),
      fillRect: () => richOps46.push("fillRect"),
      strokeRect: () => richOps46.push("strokeRect"),
      fillText: (txt) => richOps46.push(`fillText:${txt}`),
      measureText: (txt) => ({ width: String(txt).length * 8 })
    };
  }
  async convertToBlob() {
    return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  }
};
const richAnnRes46 = await annotateDataUrlInWorker("data:image/png;base64,iVBORw0KGgo=", {
  spotlight: true,
  redactRects: [{ rect: { x: 20, y: 20, width: 140, height: 30 } }],
  boxes: [{ rect: { x: 100, y: 100, width: 200, height: 50 }, color: "red", dashed: true, label: "Lỗi dữ liệu" }],
  circles: [{ rect: { x: 400, y: 100, width: 48, height: 48 }, color: "amber", label: "Chuông" }],
  arrows: [{ fromRect: { x: 100, y: 100, width: 200, height: 50 }, toRect: { x: 100, y: 220, width: 200, height: 50 }, color: "cyan", label: "Tiếp" }],
  callouts: [{ rect: { x: 100, y: 340, width: 180, height: 48 }, text: "Bấm Đăng nhập", color: "green", position: "top" }],
  badges: [{ number: "1", rect: { x: 100, y: 100, width: 200, height: 50 }, label: "Nhập Email", color: "cyan" }],
  icons: [
    { type: "check", rect: { x: 100, y: 100, width: 200, height: 50 }, label: "Hợp lệ" },
    { type: "click", rect: { x: 100, y: 340, width: 180, height: 48 } }
  ]
});
globalThis.OffscreenCanvas = prevOffscreen46;
globalThis.createImageBitmap = prevBitmap46;
globalThis.fetch = prevFetch46;
record(
  "46. Screenshot annotation engine parses and renders arrows, callouts, badges, dashed boxes, circles, vector icons, redactions, and spotlight",
  richAnnRes46.annotated === true &&
    parsedArrow46.from === "@1" &&
    parsedArrow46.to === "@2" &&
    parsedArrow46.color === "red" &&
    parsedArrow46.label === "Chuyển bước" &&
    parsedCallout46.selector === "ul > li:nth-child(2)" &&
    parsedCallout46.text === "Bước 3: Bấm Đăng nhập (CTA)" &&
    parsedCallout46.position === "top" &&
    parsedBadge46.number === "1" &&
    parsedBadge46.selector === "@1" &&
    parsedBadge46.label === "Nhập Email: user@test.com" &&
    parsedBox46.selector === "#err:not(:disabled)" &&
    parsedBox46.label === "Lỗi: dữ liệu (bắt buộc)" &&
    parsedBox46.dashed === true &&
    parsedIcon46.type === "check" &&
    richOps46.includes("clip:evenodd") &&
    richOps46.includes("setLineDash") &&
    richOps46.includes("ellipse") &&
    richOps46.includes("arc") &&
    richOps46.includes("fillText:REDACTED") &&
    richOps46.includes("fillText:Bấm Đăng nhập"),
  `annotated=${richAnnRes46.annotated}, ops=${richOps46.length}, hasClip=${richOps46.includes("clip:evenodd")}, hasEllipse=${richOps46.includes("ellipse")}`
);

// 47. Content scripts do NOT inject UI overlays at initial page load, block raw non-HTML roots (<note>), and support Feedback Studio & overlays on Chrome XML Viewer (text/xml with <html> root) via XHTML factory
const fsNode = await import("node:fs");
const vmNode = await import("node:vm");
const pathNode = await import("node:path");
const contentRoot47 = pathNode.join(process.cwd(), "extensions");

function runContentModulesInSandbox({ contentType = "text/xml", xmlVersion = null, rootTag = "HTML" } = {}) {
  const appendedRootChildren = [];
  const appendedBodyChildren = [];
  const isXmlDoc = Boolean(xmlVersion);

  const makeNode = (tag, { isHtmlNamespace = true } = {}) => {
    const children = [];
    const classes = new Set();
    const attrs = {};
    let html = "";
    const node = {
      tagName: String(tag || "div").toUpperCase(),
      namespaceURI: isHtmlNamespace ? "http://www.w3.org/1999/xhtml" : null,
      id: "",
      // In a real XMLDocument, document.createElement() produces an XML Element with .style === undefined
      style: isHtmlNamespace ? { display: "", setProperty: () => {} } : undefined,
      dataset: {},
      isConnected: false,
      parentNode: null,
      children,
      childNodes: children,
      get firstElementChild() {
        return children[0] || null;
      },
      get className() {
        return [...classes].join(" ");
      },
      set className(val) {
        classes.clear();
        String(val || "").split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
      },
      classList: {
        add: (...cs) => cs.forEach((c) => classes.add(c)),
        remove: (...cs) => cs.forEach((c) => classes.delete(c)),
        toggle: (c, force) => {
          const next = force !== undefined ? Boolean(force) : !classes.has(c);
          if (next) classes.add(c);
          else classes.delete(c);
          return next;
        },
        contains: (c) => classes.has(c)
      },
      get innerHTML() {
        return html;
      },
      set innerHTML(val) {
        const str = String(val || "");
        // Simulate Chrome's strict XML fragment parser when setting innerHTML directly on a node in an XMLDocument
        if (node._inXmlDoc && /<(img|input|br)\b[^/>]*>/i.test(str)) {
          throw new Error("DOMException: Failed to set the 'innerHTML' property on 'Element': The provided markup is invalid XML");
        }
        html = str;
        children.length = 0;
        if (str) {
          const parsedChild = makeNode("div", { isHtmlNamespace: true });
          parsedChild._rawHtml = str;
          children.push(parsedChild);
        }
      },
      replaceChildren: (...newChildren) => {
        children.length = 0;
        newChildren.forEach((c) => {
          c.parentNode = node;
          children.push(c);
        });
      },
      setAttribute: (k, v) => { attrs[k] = String(v); },
      getAttribute: (k) => attrs[k] ?? null,
      appendChild: (child) => {
        child.isConnected = true;
        child.parentNode = node;
        children.push(child);
        return child;
      },
      remove: () => {
        node.isConnected = false;
        node.parentNode = null;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      focus: () => {},
      select: () => {},
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 30, bottom: 40, right: 110 }),
      querySelector: () => makeNode("div", { isHtmlNamespace: true }),
      querySelectorAll: () => []
    };
    return node;
  };
  const docEl = makeNode(rootTag, { isHtmlNamespace: true });
  docEl.appendChild = (child) => {
    child.isConnected = true;
    child.parentNode = docEl;
    appendedRootChildren.push(child);
    return child;
  };
  const bodyEl = rootTag.toLowerCase() === "html" ? makeNode("BODY", { isHtmlNamespace: true }) : null;
  if (bodyEl) {
    bodyEl.appendChild = (child) => {
      child.isConnected = true;
      child.parentNode = bodyEl;
      appendedBodyChildren.push(child);
      return child;
    };
  }
  const sandbox = {
    window: null,
    document: {
      contentType,
      xmlVersion,
      hidden: false,
      documentElement: docEl,
      body: bodyEl,
      createElement: (tag) => {
        const n = makeNode(tag, { isHtmlNamespace: !isXmlDoc });
        n._inXmlDoc = isXmlDoc;
        return n;
      },
      adoptNode: (node) => {
        node._inXmlDoc = isXmlDoc;
        return node;
      },
      implementation: {
        createHTMLDocument: () => ({
          createElement: (tag) => makeNode(tag, { isHtmlNamespace: true })
        })
      },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve({ success: true })
      }
    },
    Element: function Element() {},
    HTMLTextAreaElement: function HTMLTextAreaElement() {},
    HTMLInputElement: function HTMLInputElement() {},
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
    performance: { now: () => 0 },
    requestAnimationFrame: (cb) => setTimeout(() => cb(16), 0),
    setTimeout,
    clearTimeout,
    console
  };
  sandbox.window = sandbox;
  sandbox.window.innerWidth = 1280;
  sandbox.window.innerHeight = 800;
  sandbox.window.scrollX = 0;
  sandbox.window.scrollY = 0;
  sandbox.window.addEventListener = () => {};
  sandbox.window.removeEventListener = () => {};
  sandbox.window.dispatchEvent = () => {};

  const files = [
    "content/config.js",
    "content/toast.js",
    "content/lock-shield.js",
    "content/cursor-simulator.js",
    "content/selector-utils.js",
    "content/dom-inspector.js",
    "content/eyedropper.js",
    "content/feedback-studio/constants.js",
    "content/feedback-studio/item-schema.js",
    "content/feedback-studio/state.js",
    "content/feedback-studio/pinned-overlay.js",
    "content/feedback-studio/hud-toolbar.js",
    "content/feedback-studio/modals.js",
    "content/feedback-studio/selection-modes.js",
    "content/feedback-studio/index.js"
  ];
  for (const rel of files) {
    const code = fsNode.readFileSync(pathNode.join(contentRoot47, rel), "utf8");
    vmNode.runInNewContext(code, sandbox, { filename: rel });
  }
  return { sandbox, appendedRootChildren, appendedBodyChildren };
}

// 47a. Raw non-HTML root (<note>) -> isHtmlDocument() === false, 0 overlays injected
const rawXmlRun47 = runContentModulesInSandbox({ contentType: "text/xml", xmlVersion: "1.0", rootTag: "note" });
const rawXmlIsHtml = rawXmlRun47.sandbox.window.__AP_INTERNAL__.isHtmlDocument();
rawXmlRun47.sandbox.window.__AP_INTERNAL__.cursor.activateCursor();
rawXmlRun47.sandbox.window.__AP_INTERNAL__.feedback.start();
rawXmlRun47.sandbox.window.__AP_INTERNAL__.inspector.toggleInspector(true);
const rawXmlTotalInjected = rawXmlRun47.appendedRootChildren.length + rawXmlRun47.appendedBodyChildren.length;

// 47b. Chrome XML Viewer (text/xml, xmlVersion="1.0", rootTag="HTML" like w3schools note.xml) ->
// 0 elements at initial load, and Feedback Studio + Popover + Annotator + Cursor mount cleanly in XHTML namespace when activated
const xmlViewerRun47 = runContentModulesInSandbox({ contentType: "text/xml", xmlVersion: "1.0", rootTag: "HTML" });
const xmlViewerIsHtml = xmlViewerRun47.sandbox.window.__AP_INTERNAL__.isHtmlDocument();
const xmlViewerInitialInjected = xmlViewerRun47.appendedRootChildren.length + xmlViewerRun47.appendedBodyChildren.length;
xmlViewerRun47.sandbox.window.__AP_INTERNAL__.feedback.start();
xmlViewerRun47.sandbox.window.__AP_INTERNAL__.feedbackStudio.modals.openCommentPopover(
  { mode: "element", screenshotDataUrl: "data:image/png;base64,iVBORw0KGgo=", dom: { tagName: "note", selector: "note" } },
  { left: 20, top: 20, bottom: 50 }
);
xmlViewerRun47.sandbox.window.__AP_INTERNAL__.cursor.activateCursor(0);
const xmlViewerAfterActivate = xmlViewerRun47.appendedRootChildren.length + xmlViewerRun47.appendedBodyChildren.length;
const xmlViewerAllHaveXhtmlNamespace = [...xmlViewerRun47.appendedRootChildren, ...xmlViewerRun47.appendedBodyChildren].every(
  (el) => el.namespaceURI === "http://www.w3.org/1999/xhtml" && el.style !== undefined
);

// 47c. Normal HTML page -> 0 elements at initial load, lazy-mounted on demand
const htmlRun47 = runContentModulesInSandbox({ contentType: "text/html", xmlVersion: null, rootTag: "HTML" });
const htmlIsHtml = htmlRun47.sandbox.window.__AP_INTERNAL__.isHtmlDocument();
const htmlInitialInjected = htmlRun47.appendedRootChildren.length + htmlRun47.appendedBodyChildren.length;
const cursorSvgMarkup = htmlRun47.sandbox.window.__AP_INTERNAL__.cursor.getCursorLayer().children[0]?.innerHTML || "";
htmlRun47.sandbox.window.__AP_INTERNAL__.cursor.activateCursor(0);
const htmlAfterCursorInjected = htmlRun47.appendedRootChildren.length + htmlRun47.appendedBodyChildren.length;
htmlRun47.sandbox.window.__AP_INTERNAL__.feedback.start();
const htmlAfterFeedbackInjected = htmlRun47.appendedRootChildren.length + htmlRun47.appendedBodyChildren.length;

record(
  "47. Content scripts mount 0 overlays at initial load, skip raw <note> roots, and mount XHTML overlays cleanly when Feedback Studio is activated on Chrome XML Viewer (text/xml)",
  rawXmlIsHtml === false &&
    rawXmlTotalInjected === 0 &&
    xmlViewerIsHtml === true &&
    xmlViewerInitialInjected === 0 &&
    xmlViewerAfterActivate > 1 &&
    xmlViewerAllHaveXhtmlNamespace === true &&
    htmlIsHtml === true &&
    htmlInitialInjected === 0 &&
    htmlAfterCursorInjected === 1 &&
    htmlAfterFeedbackInjected > 1 &&
    cursorSvgMarkup.includes('width="28" height="28"'),
  `rawXml=${rawXmlIsHtml}(${rawXmlTotalInjected}), xmlViewer=${xmlViewerIsHtml}(init=${xmlViewerInitialInjected},active=${xmlViewerAfterActivate},xhtml=${xmlViewerAllHaveXhtmlNamespace}), htmlInit=${htmlInitialInjected}`
);

// 48. Agent bridge transport broadcasts AGENT_BRIDGE_STATUS_CHANGED on ws.onopen and ws.onclose
const broadcastEvents = [];
const mockWsClient = {
  port: 58765,
  enabled: true,
  connected: false,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  outboundQueue: [],
  maxQueueSize: 100,
  ws: null,
  clearReconnect: () => {},
  scheduleReconnect: () => {}
};
Object.assign(mockWsClient, transportMethods);
mockWsClient.setBroadcastFn((ev) => broadcastEvents.push(ev));

let createdMockWs = null;
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    createdMockWs = this;
  }
  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose();
  }
}
MockWebSocket.OPEN = 1;
MockWebSocket.CONNECTING = 0;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;
globalThis.WebSocket = MockWebSocket;

mockWsClient.connect();
const connectCreatedWs = createdMockWs !== null && mockWsClient.ws === createdMockWs;

let openBroadcastReceived = false;
if (createdMockWs && createdMockWs.onopen) {
  createdMockWs.readyState = 1;
  createdMockWs.onopen();
  openBroadcastReceived = broadcastEvents.some(
    (e) => e.type === "AGENT_BRIDGE_STATUS_CHANGED" && e.status?.connected === true && e.status?.port === 58765
  );
}

let closeBroadcastReceived = false;
if (createdMockWs && createdMockWs.onclose) {
  createdMockWs.readyState = 3;
  createdMockWs.onclose();
  closeBroadcastReceived = broadcastEvents.some(
    (e) => e.type === "AGENT_BRIDGE_STATUS_CHANGED" && e.status?.connected === false
  );
}

record(
  "48. Agent bridge transport broadcasts AGENT_BRIDGE_STATUS_CHANGED on ws.onopen (connected: true) and ws.onclose (connected: false)",
  connectCreatedWs && openBroadcastReceived && closeBroadcastReceived,
  `createdWs=${connectCreatedWs}, openBroadcast=${openBroadcastReceived}, closeBroadcast=${closeBroadcastReceived}, events=${broadcastEvents.length}`
);

// Cleanup mock client to prevent any reconnect timers from holding Node event loop
mockWsClient.enabled = false;
mockWsClient.clearReconnect();

} catch (err) {
  console.error("❌ Exception during test:", err);
  process.exitCode = 1;
} finally {
  // Clean up global mock objects and shared in-memory structures to prevent leakage across tests
  try {
    cleanupTabResources(901);
    cleanupTabResources(902);
  } catch (_) {}
  attachedTabs.clear();
  devtoolsBuffers.clear();
  agentControlledTabs.clear();
  tabLockStates.clear();
  activeDialogs.clear();
  activeTracingSessions.clear();
  memoryBaselines.clear();
  beforeUnloadPolicies.clear();
  delete globalThis.chrome;
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.WebSocket;
  delete globalThis.OffscreenCanvas;
  delete globalThis.createImageBitmap;

  recorder.summarize();
  recorder.exitIfFailed();
}
