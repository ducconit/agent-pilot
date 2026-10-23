/**
 * Agent Pilot - CDP Manager (facade / barrel)
 *
 * This file intentionally contains no logic. It exists purely so that every
 * existing import site (`./cdp-manager.js`, `../background/cdp-manager.js`,
 * `../cdp-manager.js`) keeps resolving the complete CDP public API while the
 * implementation lives in focused, single-responsibility modules:
 *
 *   - cdp-connection.js  session lifecycle, command dispatch, reconciliation
 *   - cdp-events.js      chrome.debugger.onEvent -> devtools buffers/broadcasts
 *   - cdp-input.js       keyboard/mouse input synthesis
 *   - cdp-network.js     emulation + network response bodies
 *   - cdp-page.js        file uploads + JavaScript dialogs
 *   - cdp-performance.js traces, metrics, GC, heap snapshots
 *
 * Add new behavior to the relevant cdp-*.js module and re-export it here; do
 * not implement logic in this facade.
 */

export {
  reconcileDebuggerState,
  attachDebugger,
  detachDebugger,
  sendCdpCommand,
  ensureCdpAttached
} from "./cdp-connection.js";

export { initCdpEventListeners } from "./cdp-events.js";

export {
  dispatchCdpKeyEvent,
  dispatchCdpMouseMove,
  dispatchCdpMouseClick,
  dispatchCdpMouseDrag
} from "./cdp-input.js";

export { getNetworkResponseBody, getNetworkRequestDetail } from "./cdp-network.js";
export { setEmulation } from "./cdp-emulation.js";

export { uploadFileInput, handleJavaScriptDialog, getActiveDialog } from "./cdp-page.js";

export {
  startPerformanceTrace,
  stopPerformanceTrace,
  analyzeTraceEvents,
  getPerformanceMetrics,
  collectGarbage,
  isUnsupportedHeapProfilerError,
  parseV8HeapSnapshot,
  takeHeapSnapshot
} from "./cdp-performance.js";
