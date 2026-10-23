#!/usr/bin/env node
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendFlowStep,
  clearFlowSteps,
  editFlowStep,
  exportFlowFormats,
  exportFlowAsRecorder,
  getFlowState,
  importFlow
} from "../extensions/background/flow-recorder.js";

test("explicit steps and title export without a stored tab flow", () => {
  const recorder = exportFlowAsRecorder(null, "Direct flow", [
    { type: "navigate", url: "https://example.com/direct" }
  ]);
  assert.equal(recorder.title, "Direct flow");
  assert.deepEqual(recorder.steps, [{ type: "navigate", url: "https://example.com/direct" }]);
});

test("clearing one tab does not expose another tab's recording", () => {
  importFlow(901, { title: "A", steps: [{ type: "click", selectors: [["#a"]] }] });
  clearFlowSteps(901);
  importFlow(902, { title: "B", steps: [{ type: "click", selectors: [["#b"]] }] });
  assert.deepEqual(getFlowState(901).steps, []);
  assert.deepEqual(exportFlowAsRecorder(901).steps, []);
  assert.equal(getFlowState(902).steps[0].selector, "#b");
});

test("recorded scroll keeps the final position", () => {
  appendFlowStep(903, { action: "scroll", url: "https://example.com/long", x: 0, y: 100 });
  appendFlowStep(903, { action: "scroll", url: "https://example.com/long", x: 0, y: 900 });
  const scrolls = getFlowState(903).steps.filter((step) => step.action === "scroll");
  assert.equal(scrolls.at(-1)?.y, 900);
});

test("Recorder JSON retains selectors and execution properties across import/export", () => {
  const original = {
    title: "Detailed flow",
    steps: [
      {
        type: "click",
        target: "main",
        selectors: [["#primary"], ["#fallback"]],
        frame: [1, 0],
        button: "secondary",
        offsetX: 12,
        offsetY: 13,
        assertedEvents: [{ type: "navigation" }]
      },
      {
        type: "waitForElement",
        selectors: [["#gone"]],
        operator: "<=",
        count: 0,
        visible: false
      },
      {
        type: "setViewport",
        width: 800,
        height: 600,
        deviceScaleFactor: 2,
        isMobile: true
      },
      { type: "keyDown", target: "main", key: "Shift" },
      { type: "keyUp", target: "main", key: "Shift" }
    ]
  };
  importFlow(904, original);
  const exported = exportFlowAsRecorder(904);
  assert.equal(exported.title, original.title);
  assert.deepEqual(exported.steps, original.steps);
});

test("editing an imported value preserves its selector fallbacks and frame metadata", () => {
  const imported = importFlow(906, {
    title: "Edited flow",
    steps: [{
      type: "change",
      target: "main",
      selectors: [["#primary"], ["#fallback"]],
      frame: [1],
      value: "before"
    }]
  });
  editFlowStep(906, "update", imported.steps[0].id, { value: "after" });
  assert.deepEqual(exportFlowAsRecorder(906).steps[0], {
    type: "change",
    target: "main",
    selectors: [["#primary"], ["#fallback"]],
    frame: [1],
    value: "after"
  });
});

test("Recorder JSON export survives unsupported derived formats", () => {
  const original = { title: "Viewport", steps: [{ type: "setViewport", width: 800, height: 600 }] };
  importFlow(907, original);
  const formats = exportFlowFormats(907);
  assert.deepEqual(formats.recorder, original);
  assert.equal(formats.batch, null);
  assert.match(formats.exportErrors.batch, /does not support Recorder step: setViewport/);
  assert.match(formats.playwright, /setViewportSize/);
});

test("recording survives a fresh service worker module instance", async () => {
  const previousChrome = globalThis.chrome;
  const sessionItems = new Map();
  const localItems = new Map();
  const storageArea = (items) => ({
    get: async (key) => ({ [key]: structuredClone(items.get(key)) }),
    set: async (values) => {
      for (const [key, value] of Object.entries(values)) items.set(key, structuredClone(value));
    }
  });
  globalThis.chrome = {
    runtime: {},
    storage: { session: storageArea(sessionItems), local: storageArea(localItems) }
  };
  try {
    const firstWorker = await import("../extensions/background/flow-recorder.js?recorder-worker=first");
    await firstWorker.ensureFlowRecorderHydrated();
    firstWorker.importFlow(905, {
      title: "Retained flow",
      steps: [{ type: "click", selectors: [["#retained"]] }]
    });
    for (let attempt = 0; attempt < 50 && !sessionItems.has("agentPilotFlowRecorderV1"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(sessionItems.has("agentPilotFlowRecorderV1"), "Recorder session was never stored");

    const secondWorker = await import("../extensions/background/flow-recorder.js?recorder-worker=second");
    await secondWorker.ensureFlowRecorderHydrated();
    const state = secondWorker.getFlowState(905);
    assert.equal(state.title, "Retained flow");
    assert.equal(state.steps[0]?.selector, "#retained");
  } finally {
    globalThis.chrome = previousChrome;
  }
});
