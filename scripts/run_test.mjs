#!/usr/bin/env node
/**
 * Agent Pilot - Cross-Platform Test Runner
 * Runs verification scripts seamlessly across Windows, macOS, and Linux.
 * Automatically wraps with xvfb-run on Linux only when running headless without DISPLAY.
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

if (result.error) {
  console.error(`❌ Failed to run test command: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
