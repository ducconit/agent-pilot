#!/usr/bin/env node
/**
 * Agent Pilot - Set-of-Marks (SoM) & Smart DOM Pruning Unit Tests
 *
 * Verifies:
 *  1. annotateDataUrlInWorker renders Set-of-Marks interactive badges (@1, @2...) and boxes onto OffscreenCanvas
 *  2. annotateDataUrlInWorker supports custom somColor theme (cyan)
 *  3. dom-inspector getInteractiveSnapshot produces bounds { x, y, width, height }
 *  4. dom-inspector filters out elements with pointer-events: none
 *  5. dom-inspector occlusion detection via elementFromPoint correctly filters covered elements
 */

import { createRecorder } from "../../../scripts/lib/harness.mjs";
import { annotateDataUrlInWorker } from "../../../extensions/background/screenshot-service.js";

const recorder = createRecorder({
  title: "📊 BẢNG TỔNG KẾT KIỂM THỬ SET-OF-MARKS & DOM PRUNING:",
  itemKey: "feature",
  summaryStyle: "features",
  successMessage: "\n🎉 SET-OF-MARKS & SMART DOM PRUNING ĐƯỢC XÁC MINH HOÀN HẢO!"
});

const record = recorder.record;

console.log("==================================================================");
console.log("🧪 KIỂM THỬ: SET-OF-MARKS VISUAL OVERLAY & SMART DOM PRUNING");
console.log("==================================================================\n");

try {
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

  // Test 1: annotateDataUrlInWorker renders interactiveMarks onto OffscreenCanvas
  const drawOps = [];
  const filledTexts = [];

  globalThis.OffscreenCanvas = class MockOffscreenCanvas {
    constructor(w, h) {
      this.width = w;
      this.height = h;
    }
    getContext(type) {
      return {
        save: () => {},
        restore: () => {},
        drawImage: () => drawOps.push("drawImage"),
        beginPath: () => drawOps.push("beginPath"),
        roundRect: () => drawOps.push("roundRect"),
        fill: () => drawOps.push("fill"),
        stroke: () => drawOps.push("stroke"),
        fillRect: () => drawOps.push("fillRect"),
        strokeRect: () => drawOps.push("strokeRect"),
        fillText: (txt) => {
          drawOps.push(`fillText:${txt}`);
          filledTexts.push(txt);
        },
        measureText: (txt) => ({ width: String(txt).length * 8 })
      };
    }
    async convertToBlob() {
      return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    }
  };

  const somResult = await annotateDataUrlInWorker("data:image/png;base64,iVBORw0KGgo=", {
    somColor: "amber",
    interactiveMarks: [
      {
        index: 1,
        ref: "@1",
        label: "Submit Form",
        rect: { x: 100, y: 150, width: 120, height: 40, viewportWidth: 1280, viewportHeight: 720 }
      },
      {
        index: 2,
        ref: "@2",
        label: "Search Input",
        rect: { x: 300, y: 150, width: 200, height: 40, viewportWidth: 1280, viewportHeight: 720 }
      }
    ]
  });

  record(
    "1. annotateDataUrlInWorker renders Set-of-Marks badges (@1, @2) and boxes with high-contrast pills",
    somResult.annotated === true &&
      filledTexts.includes("@1") &&
      filledTexts.includes("@2") &&
      drawOps.includes("strokeRect") &&
      drawOps.includes("roundRect"),
    `annotated=${somResult.annotated}, badges=${JSON.stringify(filledTexts)}, ops=${drawOps.length}`
  );

  // Test 2: Verify custom somColor themes (e.g. cyan, green)
  const cyanOps = [];
  const cyanTexts = [];
  globalThis.OffscreenCanvas = class MockOffscreenCanvas2 {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() {
      return {
        save: () => {},
        restore: () => {},
        drawImage: () => cyanOps.push("drawImage"),
        beginPath: () => cyanOps.push("beginPath"),
        roundRect: () => cyanOps.push("roundRect"),
        fill: () => cyanOps.push("fill"),
        stroke: () => cyanOps.push("stroke"),
        fillRect: () => cyanOps.push("fillRect"),
        strokeRect: () => cyanOps.push("strokeRect"),
        fillText: (txt) => { cyanTexts.push(txt); },
        measureText: (txt) => ({ width: String(txt).length * 8 })
      };
    }
    async convertToBlob() {
      return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    }
  };

  const cyanSomRes = await annotateDataUrlInWorker("data:image/png;base64,iVBORw0KGgo=", {
    somColor: "cyan",
    interactiveMarks: [
      {
        index: 5,
        ref: "@5",
        label: "Menu Item",
        rect: { x: 50, y: 50, width: 80, height: 30, viewportWidth: 1280, viewportHeight: 720 }
      }
    ]
  });

  record(
    "2. annotateDataUrlInWorker supports custom somColor theme (cyan)",
    cyanSomRes.annotated === true && cyanTexts.includes("@5"),
    `annotated=${cyanSomRes.annotated}, badges=${JSON.stringify(cyanTexts)}`
  );

  // Restore OffscreenCanvas & fetch mocks
  globalThis.OffscreenCanvas = prevOffscreen;
  globalThis.createImageBitmap = prevCreateBitmap;
  globalThis.fetch = prevFetch;

  // Test 3: DOM Inspector Snapshot structure & occlusion logic
  const mockBackdrop = {
    tagName: "DIV",
    id: "modal-backdrop",
    className: "backdrop",
    style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800 }),
    contains: () => false,
    closest: () => null
  };

  const button1 = {
    tagName: "BUTTON",
    id: "btn-visible",
    className: "btn primary",
    innerText: "Click Me",
    style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 200, bottom: 140, width: 100, height: 40 }),
    contains: (node) => node === button1,
    closest: () => null,
    getAttribute: () => null
  };

  const buttonOccluded = {
    tagName: "BUTTON",
    id: "btn-covered",
    className: "btn secondary",
    innerText: "Covered Button",
    style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
    getBoundingClientRect: () => ({ left: 300, top: 100, right: 400, bottom: 140, width: 100, height: 40 }),
    contains: (node) => node === buttonOccluded,
    closest: () => null,
    getAttribute: () => null
  };

  const buttonPointerNone = {
    tagName: "BUTTON",
    id: "btn-disabled-pointer",
    className: "btn disabled",
    innerText: "No Pointer",
    style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "none" },
    getBoundingClientRect: () => ({ left: 500, top: 100, right: 600, bottom: 140, width: 100, height: 40 }),
    contains: (node) => node === buttonPointerNone,
    closest: () => null,
    getAttribute: () => null
  };

  // Mock document and window
  const origWindow = globalThis.window;
  const origDocument = globalThis.document;

  const mockDomRoot = {
    appendChild: () => {},
    isConnected: true
  };

  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    getComputedStyle: (el) => el.style,
    location: { href: "http://localhost/test" },
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  globalThis.document = {
    title: "Test Page",
    body: mockDomRoot,
    documentElement: { clientWidth: 1280, clientHeight: 800 },
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    createElement: (tag) => ({
      id: "",
      tagName: tag.toUpperCase(),
      style: {},
      isConnected: false,
      remove: () => {},
      querySelector: () => null,
      querySelectorAll: () => []
    }),
    querySelectorAll: (selector) => {
      if (selector.includes("button")) {
        return [button1, buttonOccluded, buttonPointerNone];
      }
      return [];
    },
    elementFromPoint: (x, y) => {
      // Over buttonOccluded region, mockBackdrop is on top!
      if (x >= 300 && x <= 400 && y >= 100 && y <= 140) {
        return mockBackdrop;
      }
      // Over button1 region, button1 itself is on top
      if (x >= 100 && x <= 200 && y >= 100 && y <= 140) {
        return button1;
      }
      return null;
    }
  };

  // Import dom-inspector module (self-registers to window.__AP_INTERNAL__.inspector)
  await import("../../../extensions/content/dom-inspector.js");

  const inspector = globalThis.window.__AP_INTERNAL__?.inspector;
  const snapshotJson = inspector.getInteractiveSnapshot(50, "json");

  record(
    "3. dom-inspector getInteractiveSnapshot returns viewport metadata and bounds {x, y, width, height}",
    snapshotJson &&
      snapshotJson.viewport?.width === 1280 &&
      snapshotJson.elements?.length > 0 &&
      snapshotJson.elements[0].bounds &&
      snapshotJson.elements[0].bounds.width === 100 &&
      snapshotJson.elements[0].bounds.height === 40,
    `total=${snapshotJson?.totalInteractive}, bounds=${JSON.stringify(snapshotJson?.elements?.[0]?.bounds)}`
  );

  record(
    "4. dom-inspector filters out elements with pointer-events: none (btn-disabled-pointer omitted)",
    snapshotJson && !snapshotJson.elements.some((el) => el.id === "btn-disabled-pointer"),
    `elements=${snapshotJson.elements.map((el) => el.id).join(", ")}`
  );

  record(
    "5. dom-inspector occlusion detection correctly skips elements fully covered by backdrops (btn-covered omitted)",
    snapshotJson &&
      !snapshotJson.elements.some((el) => el.id === "btn-covered") &&
      snapshotJson.elements.some((el) => el.id === "btn-visible"),
    `visibleElements=${snapshotJson.elements.map((el) => el.id).join(", ")}`
  );

  // Restore mocks
  if (origWindow) globalThis.window = origWindow; else delete globalThis.window;
  if (origDocument) globalThis.document = origDocument; else delete globalThis.document;

  recorder.summarize();
  recorder.exitIfFailed();

} catch (err) {
  console.error("❌ Exception during test:", err);
  process.exitCode = 1;
}
