#!/usr/bin/env node
/**
 * Launch an isolated Chrome profile with the repository extension and bridge.
 * The extension is copied to a temporary directory so the selected bridge port
 * can be configured without modifying the checked-in source tree.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveChromiumBin, getChromiumLaunchArgs } from "./browser_resolver.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionSource = path.join(ROOT_DIR, "extensions");
const bridgeBinary = path.join(ROOT_DIR, "cli", process.platform === "win32" ? "agent-pilot.exe" : "agent-pilot");
const chromeBinary = resolveChromiumBin();

function readOption(args, name, fallback) {
  const index = args.findIndex(arg => arg === name || arg.startsWith(`${name}=`));
  if (index < 0) return fallback;
  const inlineValueStart = args[index].indexOf("=");
  const value = inlineValueStart >= 0 ? args[index].slice(inlineValueStart + 1) : args[index + 1];
  return value || fallback;
}

const args = process.argv.slice(2);
const port = Number(readOption(args, "--port", process.env.AGENT_PILOT_PORT || "58766"));
const profile = readOption(args, "--profile", path.join(os.tmpdir(), `agent-pilot-chrome-${port}-${Date.now()}`));
const url = readOption(args, "--url", "about:blank");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port: ${port}`);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-pilot-launch-"));
const extensionDir = path.join(tempRoot, "extensions");
await fs.cp(extensionSource, extensionDir, { recursive: true });

const constantsPath = path.join(extensionDir, "background", "constants.js");
const constants = await fs.readFile(constantsPath, "utf8");
const configuredConstants = constants.replace(
  "export const DEFAULT_AGENT_PORT = 58765;",
  `export const DEFAULT_AGENT_PORT = ${port};`
);
if (configuredConstants === constants) throw new Error("Could not configure extension bridge port");
await fs.writeFile(constantsPath, configuredConstants);

const chromeArgs = [
  ...getChromiumLaunchArgs(extensionDir),
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--new-window",
  url
];

const bridge = spawn(bridgeBinary, ["server"], {
  cwd: ROOT_DIR,
  env: { ...process.env, AGENT_PILOT_PORT: String(port) },
  stdio: "inherit"
});
const chrome = spawn(chromeBinary, chromeArgs, { stdio: "inherit" });

let shuttingDown = false;
async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!bridge.killed) bridge.kill("SIGTERM");
  if (!chrome.killed) chrome.kill("SIGTERM");
  await fs.rm(tempRoot, { recursive: true, force: true });
  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
bridge.on("error", error => {
  console.error(`[Agent Pilot] Bridge failed: ${error.message}`);
  shutdown(1);
});
chrome.on("error", error => {
  console.error(`[Agent Pilot] Chrome failed: ${error.message}`);
  shutdown(1);
});
chrome.on("exit", code => shutdown(code || 0));

console.log(`[Agent Pilot] Chrome profile: ${profile}`);
console.log(`[Agent Pilot] Extension: ${extensionSource}`);
console.log(`[Agent Pilot] Bridge: http://127.0.0.1:${port}`);
