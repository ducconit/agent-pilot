#!/usr/bin/env node
/**
 * Agent Pilot - Export MCP tool schemas (Single Source of Truth)
 * Writes the generated schemas to the repo SSOT folder and to the user's
 * Antigravity MCP config directory, without relying on shell `~` expansion.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const BINARY_NAME = process.platform === "win32" ? "agent-pilot.exe" : "agent-pilot";
const binaryPath = path.join(ROOT_DIR, "cli", BINARY_NAME);

if (!fs.existsSync(binaryPath)) {
  console.log(`→ CLI binary not found at ${binaryPath}. Running build:cli first...`);
  const buildRes = spawnSync(process.execPath, [path.join(ROOT_DIR, "scripts", "build_cli.mjs")], {
    cwd: ROOT_DIR,
    stdio: "inherit"
  });
  if (buildRes.error || (buildRes.status ?? 1) !== 0 || !fs.existsSync(binaryPath)) {
    console.error(`❌ Failed to build CLI binary for export.`);
    process.exit(1);
  }
}

const targets = [
  path.join(ROOT_DIR, "mcp", "agent-pilot"),
  path.join(os.homedir(), ".gemini", "antigravity", "mcp", "agent-pilot")
];

let failed = false;
for (const target of targets) {
  const res = spawnSync(binaryPath, ["export-mcp", target], { stdio: "inherit" });
  if (res.error || (res.status ?? 1) !== 0) {
    console.error(`❌ Failed to export MCP schemas to ${target}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
