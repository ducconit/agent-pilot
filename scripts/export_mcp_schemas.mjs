/**
 * Agent Pilot - Export & Synchronize MCP Tool Schemas
 * Source of Truth: scripts/agent_pilot_server.mjs (MCP_TOOLS)
 * Targets:
 *   1. Repository Directory: mcp/agent-pilot/
 *   2. Antigravity MCP Directory: ~/.gemini/antigravity/mcp/agent-pilot/
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { MCP_TOOLS } from "./agent_pilot_server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, "..");

const SERVER_FILE = path.join(PROJECT_DIR, "scripts", "agent_pilot_server.mjs");
const REPO_MCP_DIR = path.join(PROJECT_DIR, "mcp", "agent-pilot");
const HOME_DIR = os.homedir();
const ANTIGRAVITY_MCP_DIR = path.join(HOME_DIR, ".gemini", "antigravity", "mcp", "agent-pilot");

console.log("==================================================================");
console.log("📦 AGENT PILOT - EXPORTING MCP TOOL SCHEMAS (SSOT)");
console.log(`📌 Source Module: ${SERVER_FILE}`);
console.log(`📁 Repo Target  : ${REPO_MCP_DIR}`);
console.log(`📁 User Target  : ${ANTIGRAVITY_MCP_DIR}`);
console.log("==================================================================");

if (!Array.isArray(MCP_TOOLS) || MCP_TOOLS.length === 0) {
  console.error("❌ No tools found in MCP_TOOLS export");
  process.exit(1);
}
console.log(`✓ Loaded ${MCP_TOOLS.length} tool definitions from server module`);

// Ensure directories exist
fs.mkdirSync(REPO_MCP_DIR, { recursive: true });
fs.mkdirSync(ANTIGRAVITY_MCP_DIR, { recursive: true });

// Clean up stale JSON files to prevent ghost/orphaned tools
function cleanDirectory(dir) {
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.endsWith(".json")) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
  }
}
cleanDirectory(REPO_MCP_DIR);
cleanDirectory(ANTIGRAVITY_MCP_DIR);
console.log("✓ Cleaned target directories of stale schemas");

// Export each tool schema
let count = 0;
for (const tool of MCP_TOOLS) {
  const schema = {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema
  };

  const jsonContent = JSON.stringify(schema, null, 2) + "\n";
  const repoFilePath = path.join(REPO_MCP_DIR, `${tool.name}.json`);
  const userFilePath = path.join(ANTIGRAVITY_MCP_DIR, `${tool.name}.json`);

  fs.writeFileSync(repoFilePath, jsonContent, "utf8");
  fs.writeFileSync(userFilePath, jsonContent, "utf8");
  count++;
  console.log(`  ✓ Exported: ${tool.name}.json`);
}

console.log("==================================================================");
console.log(`✅ Successfully exported & synced ${count} MCP schemas!`);
console.log("   Repo is 100% Single Source of Truth.");
console.log("==================================================================");
