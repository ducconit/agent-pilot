#!/usr/bin/env node
/**
 * Agent Pilot - Cross-platform Go CLI build
 *
 * Builds ./cli from the repository root with CGO_ENABLED=0 (static binary) and
 * injects the build metadata with -ldflags -X, so package.json stays the single
 * source of truth for the version:
 *   -X github.com/ducconit/agent-pilot-extension/cli/version.Version=<pkg.version>
 *   -X github.com/ducconit/agent-pilot-extension/cli/version.Commit=<short sha>
 *   -X github.com/ducconit/agent-pilot-extension/cli/version.Date=<RFC3339 UTC>
 *
 * Works identically on POSIX shells and Windows cmd.exe (env-var prefixes do not).
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_NAME = process.platform === "win32" ? "agent-pilot.exe" : "agent-pilot";
const OUTPUT_PATH = path.join("cli", OUTPUT_NAME);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8"));

function gitValue(args, fallback = "") {
  try {
    return execFileSync("git", args, { cwd: ROOT_DIR, encoding: "utf8" }).trim() || fallback;
  } catch (_) {
    return fallback;
  }
}

const version = pkg.version;
const commit = gitValue(["rev-parse", "--short", "HEAD"], "unknown");
const date = new Date().toISOString();

const ldflags = [
  "-s",
  "-w",
  `-X github.com/ducconit/agent-pilot-extension/cli/version.Version=${version}`,
  `-X github.com/ducconit/agent-pilot-extension/cli/version.Commit=${commit}`,
  `-X github.com/ducconit/agent-pilot-extension/cli/version.Date=${date}`
].join(" ");

const result = spawnSync("go", ["build", "-ldflags", ldflags, "-o", OUTPUT_PATH, "./cli/cmd/agent-pilot"], {
  cwd: ROOT_DIR,
  stdio: "inherit",
  env: { ...process.env, CGO_ENABLED: "0" }
});

if (result.error) {
  console.error(`❌ Failed to run go build: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
