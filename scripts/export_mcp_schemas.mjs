/**
 * Agent Pilot - Export & Synchronize MCP Tool Schemas
 * Source of Truth: cli/agent-pilot (mcpTools)
 * Targets:
 *   1. Repository Directory: mcp/agent-pilot/
 *   2. Antigravity MCP Directory: ~/.gemini/antigravity/mcp/agent-pilot/
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, "..");

const binaryPath = path.join(PROJECT_DIR, "cli", process.platform === "win32" ? "agent-pilot.exe" : "agent-pilot");
const REPO_MCP_DIR = path.join(PROJECT_DIR, "mcp", "agent-pilot");
const HOME_DIR = os.homedir();
const ANTIGRAVITY_MCP_DIR = path.join(HOME_DIR, ".gemini", "antigravity", "mcp", "agent-pilot");

console.log("==================================================================");
console.log("📦 AGENT PILOT - EXPORTING MCP TOOL SCHEMAS (SSOT)");
console.log(`📌 Source Binary: ${binaryPath}`);
console.log(`📁 Repo Target  : ${REPO_MCP_DIR}`);
console.log(`📁 User Target  : ${ANTIGRAVITY_MCP_DIR}`);
console.log("==================================================================");

if (!fs.existsSync(binaryPath)) {
  console.log("→ Building cli/agent-pilot binary first...");
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "package.json"), "utf-8"));
  const ldflags = `-s -w -X github.com/ducconit/agent-pilot-extension/cli/version.Version=${pkg.version}`;
  execSync(`go build -ldflags "${ldflags}" -o cli/agent-pilot ./cli/cmd/agent-pilot`, {
    cwd: PROJECT_DIR,
    stdio: "inherit",
    env: { ...process.env, CGO_ENABLED: "0" }
  });
}

execSync(`"${binaryPath}" export-mcp "${REPO_MCP_DIR}"`, { stdio: "inherit" });
execSync(`"${binaryPath}" export-mcp "${ANTIGRAVITY_MCP_DIR}"`, { stdio: "inherit" });

console.log("==================================================================");
console.log("✅ Successfully exported & synced all MCP tool schemas!");
console.log("   Repo is 100% Single Source of Truth.");
console.log("==================================================================");
