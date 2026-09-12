/**
 * Agent Pilot - Export & Synchronize MCP Tool Schemas
 * Source of Truth: scripts/agent_pilot_server.mjs
 * Targets:
 *   1. Repository Directory: mcp/agent-pilot/
 *   2. Antigravity MCP Directory: ~/.gemini/antigravity/mcp/agent-pilot/
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, "..");

const SERVER_FILE = path.join(PROJECT_DIR, "scripts", "agent_pilot_server.mjs");
const REPO_MCP_DIR = path.join(PROJECT_DIR, "mcp", "agent-pilot");
const HOME_DIR = os.homedir();
const ANTIGRAVITY_MCP_DIR = path.join(HOME_DIR, ".gemini", "antigravity", "mcp", "agent-pilot");

console.log("==================================================================");
console.log("📦 AGENT PILOT - EXPORTING MCP TOOL SCHEMAS (SSOT)");
console.log(`📌 Source File: ${SERVER_FILE}`);
console.log(`📁 Repo Target: ${REPO_MCP_DIR}`);
console.log(`📁 User Target: ${ANTIGRAVITY_MCP_DIR}`);
console.log("==================================================================");

// 1. Read and extract MCP_TOOLS from server.mjs
const serverContent = fs.readFileSync(SERVER_FILE, "utf8");
const match = serverContent.match(/const MCP_TOOLS = (\[[\s\S]*?\]);\n\nasync function handleMcpToolCall/);

if (!match) {
  console.error("❌ Failed to parse MCP_TOOLS definition from server.mjs");
  process.exit(1);
}

const tools = eval(match[1]);
console.log(`✓ Parsed ${tools.length} tool definitions from server.mjs`);

// 2. Ensure directories exist
fs.mkdirSync(REPO_MCP_DIR, { recursive: true });
fs.mkdirSync(ANTIGRAVITY_MCP_DIR, { recursive: true });

// 3. Export each tool schema
let count = 0;
for (const tool of tools) {
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
