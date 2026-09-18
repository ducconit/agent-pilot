#!/usr/bin/env node
/**
 * Agent Pilot - Cross-platform Go CLI build
 * Sets CGO_ENABLED=0 and builds the static binary, working identically on
 * POSIX shells and Windows cmd.exe (env-var prefixes do not work there).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_DIR = path.resolve(__dirname, "..", "cli");
const OUTPUT_NAME = process.platform === "win32" ? "agent-pilot.exe" : "agent-pilot";

const result = spawnSync("go", ["build", "-ldflags=-s -w", "-o", OUTPUT_NAME, "."], {
  cwd: CLI_DIR,
  stdio: "inherit",
  env: { ...process.env, CGO_ENABLED: "0" }
});

if (result.error) {
  console.error(`❌ Failed to run go build: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
