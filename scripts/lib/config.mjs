/**
 * Agent Pilot - Centralized configuration for Node tooling & verification scripts (SSOT).
 *
 * Every script under scripts/ imports its ports, paths and timing constants from
 * here instead of hardcoding literals. The aggregate is deep-frozen so a stray
 * mutation in one script can never silently leak into another.
 *
 * Deliberately NOT centralized: the tiny per-step "settle" delays that live inside
 * individual assertions (e.g. "wait one animation frame for the tooltip transition").
 * Those encode step-specific UI timing, not shared configuration, and are clearer
 * left next to the assertion they support.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve from this module's location so paths stay correct regardless of cwd.
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── Paths ────────────────────────────────────────────────────────────────────
export const ROOT_DIR = path.resolve(HERE, "..", "..");
export const TEST_DIR = path.join(ROOT_DIR, "test");
export const EXTENSIONS_DIR = path.join(ROOT_DIR, "extensions");
export const ASSETS_DIR = path.join(ROOT_DIR, "assets");
export const TEST_PAGE = path.join(TEST_DIR, "test-page.html");

// ── Networking ───────────────────────────────────────────────────────────────
export const LOCAL_HOST = "127.0.0.1";
export const BRIDGE_HOST = LOCAL_HOST;

export const PORTS = Object.freeze({
  HTTP_PORT: 8765, // verify_all_features page server
  SESSION_HTTP_PORT: 8766, // verify_session_lifecycle page server
  PINNED_HTTP_PORT: 8769, // verify_pinned_regions page server
  ANNOTATOR_HTTP_PORT: 8772, // verify_annotator_tools page server
  EDIT_DELETE_HTTP_PORT: 8781, // verify_feedback_edit_delete page server
  BRIDGE_PORT: 58765 // Agent WebSocket/HTTP bridge port
});

export const {
  HTTP_PORT,
  SESSION_HTTP_PORT,
  PINNED_HTTP_PORT,
  ANNOTATOR_HTTP_PORT,
  EDIT_DELETE_HTTP_PORT,
  BRIDGE_PORT
} = PORTS;

// ── Timeouts / settle budgets (milliseconds) ─────────────────────────────────
export const TIMEOUTS = Object.freeze({
  SERVICE_WORKER_MS: 6000, // wait for the background service worker target
  SERVICE_WORKER_SLOW_MS: 8000, // heavier suites give the SW a little longer
  EXTENSION_CONNECT_MS: 15000, // wait for the extension <-> bridge handshake
  AGENT_COMMAND_MS: 15000, // default per-command agent bridge timeout
  BATCH_RUN_MS: 30000, // timeout for a full multi-step batch.run
  HTTP_PROBE_MS: 1000, // bridge /health probe budget
  BATCH_LOAD_MS: 3000, // batch "open" action load timeout
  WAIT_FOR_SELECTOR_MS: 4000, // batch "wait_for_selector" timeout
  PAGE_SETTLE_MS: 800, // settle delay after initial navigation
  CLIENT_POLL_INTERVAL_MS: 250, // live-bridge client discovery poll interval
  CLIENT_POLL_RETRIES: 40 // live-bridge client discovery attempts
});

// Puppeteer navigation strategy used by every suite's initial page.goto().
export const NAV_WAIT_UNTIL = "networkidle0";

// ── Output helpers ───────────────────────────────────────────────────────────
// The 66-char rule every suite prints around its header/summary blocks.
export const SEPARATOR = "==================================================================";

/**
 * Deep-freeze a config tree so consumers cannot mutate shared configuration.
 */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// Aggregate, deep-frozen view of the whole configuration.
export const config = deepFreeze({
  ROOT_DIR,
  TEST_DIR,
  EXTENSIONS_DIR,
  ASSETS_DIR,
  TEST_PAGE,
  LOCAL_HOST,
  BRIDGE_HOST,
  PORTS,
  TIMEOUTS,
  NAV_WAIT_UNTIL,
  SEPARATOR
});
