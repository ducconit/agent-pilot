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
import {
  DEFAULTS,
  attachedTabs,
  devtoolsBuffers,
  activeTracingSessions,
  activeDialogs,
  agentControlledTabs,
  tabLockStates,
  cleanupTabResources
} from "../extensions/background/constants.js";
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
const dummyTimer = setTimeout(() => {}, 60000);
tabLockStates.set(testTabId, { manualLock: true, autoCount: 1, unlockTimer: dummyTimer });
cleanupTabResources(testTabId);
const tabCleaned =
  !attachedTabs.has(testTabId) &&
  !devtoolsBuffers.has(testTabId) &&
  !activeTracingSessions.has(testTabId) &&
  !activeDialogs.has(testTabId) &&
  !agentControlledTabs.has(testTabId) &&
  !tabLockStates.has(testTabId);
record(
  "7. cleanupTabResources clears all per-tab Maps/Sets and timers",
  tabCleaned,
  `all 6 state stores cleared=${tabCleaned}`
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
const { evaluateInTab } = await import("../extensions/background/agent-handlers/page-input.js");
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

const { getTargetTabId, isTabInAgentGroup } = await import("../extensions/background/tab-manager.js");
const { commandMethods } = await import("../extensions/background/bridge-commands.js");

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
  clearFlowSteps
} = await import("../extensions/background/flow-recorder.js");

// 12. Persistent Cross-Page Flow Recorder (navigation persistence, deduplication, Batch & Playwright export)
clearFlowSteps(101);
await setFlowRecording(101, true, "https://example.com/login");
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
const { collectDevtoolsData } = await import("../extensions/background/agent-handlers/devtools.js");
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
cleanupTabResources(302);
record(
  "14. collectDevtoolsData supports errorsOnly, excludeStatic, and strips verbose response headers by default",
  filteredDevtools.console.length === 1 &&
    filteredDevtools.console[0].id === "c3" &&
    filteredDevtools.network.length === 1 &&
    filteredDevtools.network[0].id === "r3" &&
    filteredDevtools.network[0].headers === undefined &&
    nonStaticDevtools.network.length === 2 &&
    nonStaticDevtools.network[0].headers?.["content-type"] === "application/json",
  `errConsole=${filteredDevtools.console.length}, errNet=${filteredDevtools.network.length}, headersStripped=${filteredDevtools.network[0]?.headers === undefined}, nonStaticCount=${nonStaticDevtools.network.length}`
);

// 15. runInlineWait & mergeWaitMeta support waitMs, sleepMs, waitForSelector, waitForText across handlers
const { runInlineWait, mergeWaitMeta, pageInputHandlers } = await import("../extensions/background/agent-handlers/page-input.js");
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
  waitMs: 15
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
    mergedClick.waitedMs >= 15 &&
    mergedClick.waitForResult?.success === true &&
    evalWithScriptAlias === "eval:window.__squoosh",
  `waitForSelector=${inlineMessages[0]?.selector}, waitedMs=${mergedClick.waitedMs}, evalResult=${evalWithScriptAlias}`
);

// 16. createTabWithWindowFallback automatically falls back to chrome.windows.create when no browser window is open
const { createTabWithWindowFallback } = await import("../extensions/background/tab-manager.js");
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
await import("../extensions/content/cursor-wait.js");
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
import fs from "node:fs";
import path from "node:path";
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
const { normalizeUrl: normUrl } = await import("../extensions/background/constants.js");
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
const { uploadFileInput } = await import("../extensions/background/cdp-page.js");
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
const { annotateDataUrlInWorker } = await import("../extensions/background/screenshot-service.js");
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
await import("../extensions/content/cursor-form.js");
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

recorder.summarize();
recorder.exitIfFailed();
