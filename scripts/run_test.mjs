#!/usr/bin/env node
/**
 * Agent Pilot - Cross-Platform Test Runner Wrapper
 * Delegates directly to the unified test runner at test/runner.mjs.
 * Preserved for backward compatibility.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const RUNNER = path.join(ROOT_DIR, "test", "runner.mjs");

const args = process.argv.slice(2);
const result = spawnSync("node", [RUNNER, ...args], {
  cwd: ROOT_DIR,
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  console.error(`❌ Failed to run test command: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
