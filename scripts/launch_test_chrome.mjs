#!/usr/bin/env node
/**
 * Launch an isolated Chrome profile with the repository extension and bridge.
 * The extension is copied to a temporary directory so the selected bridge port
 * can be configured without modifying the checked-in source tree.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { resolveChromiumBin, getChromiumLaunchArgs } from "./browser_resolver.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_SOURCE = path.join(ROOT_DIR, "extensions");
const BRIDGE_BINARY = path.join(ROOT_DIR, "cli", process.platform === "win32" ? "agent-pilot.exe" : "agent-pilot");
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const HEALTH_POLL_MS = 250;
const HEALTH_REQUEST_TIMEOUT_MS = 1_000;
const CHILD_SHUTDOWN_TIMEOUT_MS = 2_000;

/**
 * Read either --name=value or --name value without splitting the value again.
 * In particular, URLs such as --url=http://localhost/test?a=1 must retain
 * everything after the first equals sign.
 */
export function readOption(args, name, fallback) {
  const inlinePrefix = `${name}=`;
  const inlineArgument = args.find((argument) => argument.startsWith(inlinePrefix));
  if (inlineArgument) {
    return inlineArgument.slice(inlinePrefix.length) || fallback;
  }

  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
    return args[index + 1];
  }
  return fallback;
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${optionName}: ${value}`);
  }
  return parsed;
}

function parsePort(value) {
  const parsed = parsePositiveInteger(value, "--port");
  if (parsed > 65535) throw new Error(`Invalid --port: ${value}`);
  return parsed;
}

export function readBuildId(buildInfo) {
  const match = buildInfo.match(/EXTENSION_BUILD_ID\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error("Could not read extension build ID from build-info.js");
  return match[1];
}

function clientMatchesProvenance(client, port, buildId) {
  return client
    && Number(client.bridgePort) === port
    && client.extensionBuildId === buildId;
}

export function readinessFromHealth(health, port, buildId) {
  if (!health || health.status !== "ok") return { ready: false, reason: "bridge health status is not ok" };
  if (Number(health.port) !== port) {
    return { ready: false, reason: `bridge reported port ${health.port || "unknown"}, expected ${port}` };
  }

  const clients = Array.isArray(health.clients) ? health.clients : [];
  const matchingClient = clients.find((client) => clientMatchesProvenance(client, port, buildId));
  if (!health.extensionConnected || !matchingClient) {
    const provenance = clients.map((client) => ({
      instanceId: client.instanceId,
      bridgePort: client.bridgePort,
      extensionVersion: client.extensionVersion,
      extensionBuildId: client.extensionBuildId
    }));
    return {
      ready: false,
      reason: health.extensionConnected
        ? `no connected client matched build ${buildId} on port ${port}`
        : "extensionConnected=false",
      clients: provenance
    };
  }

  return { ready: true, client: matchingClient };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchHealth(port) {
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS)
  });
  let body = null;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${body ? `: ${JSON.stringify(body)}` : ""}`);
  }
  return body;
}

async function waitForBridgeReady({ port, buildId, bridge, chrome, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastReason = "no health response";

  while (Date.now() < deadline) {
    if (bridge?.exitCode !== null && bridge?.exitCode !== undefined) {
      throw new Error(`Bridge exited with code ${bridge.exitCode} before becoming ready`);
    }
    if (chrome?.exitCode !== null && chrome?.exitCode !== undefined) {
      throw new Error(`Chrome exited with code ${chrome.exitCode} before becoming ready`);
    }

    try {
      const health = await fetchHealth(port);
      const readiness = readinessFromHealth(health, port, buildId);
      if (readiness.ready) return { health, client: readiness.client };
      lastReason = readiness.clients?.length
        ? `${readiness.reason}; clients=${JSON.stringify(readiness.clients)}`
        : readiness.reason;
    } catch (error) {
      lastReason = error.message;
    }
    await sleep(Math.min(HEALTH_POLL_MS, Math.max(0, deadline - Date.now())));
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for bridge readiness: ${lastReason}`);
}

function terminateChild(child, label) {
  if (!child || (child.exitCode !== null && child.exitCode !== undefined)) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    let forceKillTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      resolve();
    };
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null || child.exitCode === undefined) {
        console.error(`[Agent Pilot] ${label} did not stop after SIGTERM; forcing shutdown.`);
        try { child.kill("SIGKILL"); } catch (_) {}
      }
      finish();
    }, CHILD_SHUTDOWN_TIMEOUT_MS);

    child.once("exit", finish);
    try {
      child.kill("SIGTERM");
    } catch (_) {
      finish();
    }
  });
}

const args = process.argv.slice(2);
const port = parsePort(
  readOption(args, "--port", process.env.AGENT_PILOT_PORT || "58766"),
  "--port"
);
const profile = readOption(args, "--profile", path.join(os.tmpdir(), `agent-pilot-chrome-${port}-${Date.now()}`));
const url = readOption(args, "--url", "about:blank");
const readyTimeoutMs = parsePositiveInteger(
  readOption(args, "--ready-timeout", process.env.AGENT_PILOT_READY_TIMEOUT_MS || String(DEFAULT_READY_TIMEOUT_MS)),
  "--ready-timeout"
);

let tempRoot = null;
let bridge = null;
let chrome = null;
let chromeBrowser = null;
let ready = false;
let shuttingDown = false;
let shutdownPromise = null;

async function cleanup() {
  await chromeBrowser?.close().catch(() => {});
  chromeBrowser = null;
  await terminateChild(chrome, "Chrome");
  await terminateChild(bridge, "Bridge");
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
}

function requestShutdown(exitCode) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = cleanup()
    .catch((error) => console.error(`[Agent Pilot] Cleanup failed: ${error.message}`))
    .finally(() => {
      process.exitCode = exitCode;
    });
  return shutdownPromise;
}

async function main() {
  process.once("SIGINT", () => requestShutdown(0));
  process.once("SIGTERM", () => requestShutdown(0));

  try {
    // Keep browser resolution inside the guarded startup path. A missing Chrome
    // binary must still remove the temporary extension directory.
    const chromeBinary = resolveChromiumBin();

    execFileSync(process.execPath, [path.join(ROOT_DIR, "scripts", "update_extension_build_id.mjs")], {
      cwd: ROOT_DIR,
      stdio: "inherit"
    });

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-pilot-launch-"));
    const extensionDir = path.join(tempRoot, "extensions");
    await fs.cp(EXTENSION_SOURCE, extensionDir, { recursive: true });

    const constantsPath = path.join(extensionDir, "background", "constants.js");
    const constants = await fs.readFile(constantsPath, "utf8");
    const configuredConstants = constants.replace(
      "export const DEFAULT_AGENT_PORT = 58765;",
      `export const DEFAULT_AGENT_PORT = ${port};`
    );
    if (configuredConstants === constants) throw new Error("Could not configure extension bridge port");
    await fs.writeFile(constantsPath, configuredConstants);

    const buildInfo = await fs.readFile(path.join(extensionDir, "background", "build-info.js"), "utf8");
    const expectedBuildId = readBuildId(buildInfo);
    bridge = spawn(BRIDGE_BINARY, ["server"], {
      cwd: ROOT_DIR,
      env: { ...process.env, AGENT_PILOT_PORT: String(port) },
      stdio: "inherit"
    });
    bridge.on("error", (error) => {
      console.error(`[Agent Pilot] Bridge failed: ${error.message}`);
      if (!shuttingDown) requestShutdown(1);
    });
    bridge.on("exit", (code, signal) => {
      if (!shuttingDown) {
        const phase = ready ? "after readiness" : "before readiness";
        console.error(`[Agent Pilot] Bridge exited ${phase} (code=${code ?? "null"}, signal=${signal || "none"}).`);
        requestShutdown(1);
      }
    });

    // Google Chrome 153+ rejects --load-extension and --disable-extensions-except
    // on the command line. Puppeteer's installExtension uses Chrome's supported
    // extension installation path and works for both Chrome and Chromium.
    chromeBrowser = await puppeteer.launch({
      executablePath: chromeBinary,
      headless: false,
      pipe: true,
      enableExtensions: true,
      userDataDir: profile,
      defaultViewport: null,
      args: getChromiumLaunchArgs(extensionDir).filter((argument) => (
        !argument.startsWith("--load-extension") &&
        !argument.startsWith("--disable-extensions-except")
      ))
    });
    await chromeBrowser.installExtension(extensionDir);
    const pages = await chromeBrowser.pages();
    const page = pages[0] || await chromeBrowser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((error) => {
      console.warn(`[Agent Pilot] Initial URL did not finish loading: ${error.message}`);
    });
    chrome = chromeBrowser.process();
    chrome.on("error", (error) => {
      console.error(`[Agent Pilot] Chrome failed: ${error.message}`);
      if (!shuttingDown) requestShutdown(1);
    });
    chrome.on("exit", (code, signal) => {
      if (!shuttingDown) {
        if (!ready) {
          console.error(`[Agent Pilot] Chrome exited before extension readiness (code=${code ?? "null"}, signal=${signal || "none"}).`);
        }
        requestShutdown(code ?? 1);
      }
      else if (signal) console.error(`[Agent Pilot] Chrome stopped (${signal}).`);
    });

    const readiness = await waitForBridgeReady({
      port,
      buildId: expectedBuildId,
      bridge,
      chrome,
      timeoutMs: readyTimeoutMs
    });

    ready = true;

    console.log(`[Agent Pilot] Chrome profile: ${profile}`);
    console.log(`[Agent Pilot] Extension: ${extensionDir}`);
    console.log(`[Agent Pilot] Bridge: http://127.0.0.1:${port}`);
    console.log(`[Agent Pilot] Ready: extensionConnected=true build=${readiness.client.extensionBuildId}`);
  } catch (error) {
    console.error(`[Agent Pilot] Startup failed: ${error.message}`);
    await requestShutdown(1);
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) await main();
