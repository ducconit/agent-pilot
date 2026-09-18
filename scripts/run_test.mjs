#!/usr/bin/env node
/**
 * Agent Pilot - Cross-Platform Test Runner
 * Runs verification scripts seamlessly across Windows, macOS, and Linux.
 * Automatically wraps with xvfb-run on Linux only when running headless without DISPLAY.
 *
 * Exit-code contract: this wrapper MUST propagate a non-zero status whenever the
 * child fails OR cannot be spawned at all. Historically a missing/failed spawn left
 * result.status === null and callers treated "no status" as success, producing a
 * false-green CI run — so we explicitly exit 1 on a spawn error below.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const scriptArg = process.argv[2];
if (!scriptArg) {
  console.error("❌ Usage: node scripts/run_test.mjs <path-to-test-script> [...args]");
  process.exit(1);
}

const targetScript = path.isAbsolute(scriptArg) ? scriptArg : path.resolve(ROOT_DIR, scriptArg);

if (!fs.existsSync(targetScript)) {
  console.error(`❌ Test script not found: ${targetScript}`);
  process.exit(1);
}

const extraArgs = process.argv.slice(3);
const platform = process.platform;

let cmd = "node";
let args = [targetScript, ...extraArgs];

// Linux CI/containers have no X server, but these suites launch headful Chromium
// (headless:false) so the unpacked extension can load — which needs a display. When
// DISPLAY is unset we transparently wrap the run in `xvfb-run -a` (auto-pick a free
// display number). macOS/Windows always have a display, and if DISPLAY is already set
// (a real desktop or a caller-managed Xvfb) we leave it alone so we never double-wrap.
if (platform === "linux") {
  // Check if a display is already available
  const hasDisplay = Boolean(process.env.DISPLAY);

  if (!hasDisplay) {
    // Check if xvfb-run is installed
    let hasXvfb = false;
    try {
      const check = spawnSync("which", ["xvfb-run"], { stdio: "ignore" });
      hasXvfb = check.status === 0;
    } catch (_) {}

    if (hasXvfb) {
      cmd = "xvfb-run";
      args = ["-a", "node", targetScript, ...extraArgs];
    }
  }
}

const result = spawnSync(cmd, args, {
  cwd: ROOT_DIR,
  stdio: "inherit",
  env: process.env
});

// A spawn-level failure (xvfb-run/node missing, ENOENT, EACCES…) sets result.error
// and leaves result.status null. Bailing out with exit 1 here is what prevents the
// false-green history: "no status" must never be read as success.
if (result.error) {
  console.error(`❌ Failed to run test command: ${result.error.message}`);
  process.exit(1);
}
// Propagate the real exit code; `?? 1` covers the signal-kill case (status null).
process.exit(result.status ?? 1);
