#!/usr/bin/env node
/**
 * Agent Pilot - Cross-Platform AGK Plugin Synchronization
 * Safely synchronizes scripts/agent_pilot_server.mjs to ~/.agk across Windows, macOS, and Linux.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const homeDir = os.homedir();
const agkDir = path.join(homeDir, ".agk");
const serverSource = path.join(ROOT_DIR, "scripts", "agent_pilot_server.mjs");

if (!fs.existsSync(agkDir)) {
  console.log("ℹ️ .agk directory not found in user home. Skipping local AGK plugin synchronization.");
  process.exit(0);
}

if (!fs.existsSync(serverSource)) {
  console.error(`❌ Source server file not found: ${serverSource}`);
  process.exit(1);
}

const targetDir = path.join(agkDir, "scripts", "agent-pilot");
const targetServer = path.join(targetDir, "server.mjs");

try {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(serverSource, targetServer);
  console.log(`✓ Synchronized agent_pilot_server.mjs -> ${targetServer}`);

  const geminiPluginDir = path.join(homeDir, ".gemini", "config", "plugins", "agk", "scripts", "agent-pilot");
  if (fs.existsSync(path.dirname(geminiPluginDir))) {
    fs.mkdirSync(geminiPluginDir, { recursive: true });
    fs.copyFileSync(serverSource, path.join(geminiPluginDir, "server.mjs"));
    console.log(`✓ Synchronized agent_pilot_server.mjs -> ${path.join(geminiPluginDir, "server.mjs")}`);
  }
} catch (err) {
  console.error("❌ Error copying server.mjs:", err.message);
  process.exit(1);
}

// Synchronize skills/agent-pilot/SKILL.md
const skillSource = path.join(ROOT_DIR, "skills", "agent-pilot", "SKILL.md");
const targetSkillDir = path.join(agkDir, "skills", "agent-pilot");
const targetSkillFile = path.join(targetSkillDir, "SKILL.md");

if (fs.existsSync(skillSource)) {
  try {
    fs.mkdirSync(targetSkillDir, { recursive: true });
    fs.copyFileSync(skillSource, targetSkillFile);
    console.log(`✓ Synchronized SKILL.md -> ${targetSkillFile}`);

    const geminiSkillDir = path.join(homeDir, ".gemini", "config", "plugins", "agk", "skills", "agent-pilot");
    if (fs.existsSync(path.dirname(geminiSkillDir))) {
      fs.mkdirSync(geminiSkillDir, { recursive: true });
      fs.copyFileSync(skillSource, path.join(geminiSkillDir, "SKILL.md"));
      console.log(`✓ Synchronized SKILL.md -> ${path.join(geminiSkillDir, "SKILL.md")}`);
    }
  } catch (err) {
    console.warn("⚠️ Note: Could not copy SKILL.md to AGK:", err.message);
  }
}

// Synchronize cli/agent-pilot binary if compiled
const binarySource = path.join(ROOT_DIR, "cli", process.platform === "win32" ? "agent-pilot.exe" : "agent-pilot");
if (fs.existsSync(binarySource)) {
  try {
    const agkBinDir = path.join(agkDir, "bin");
    fs.mkdirSync(agkBinDir, { recursive: true });
    const targetBin = path.join(agkBinDir, path.basename(binarySource));
    fs.copyFileSync(binarySource, targetBin);
    if (process.platform !== "win32") {
      fs.chmodSync(targetBin, 0o755);
    }
    console.log(`✓ Synchronized agent-pilot binary -> ${targetBin}`);
  } catch (err) {
    console.warn("⚠️ Note: Could not copy agent-pilot binary to AGK bin:", err.message);
  }
}

// On Unix-like environments (Linux, macOS), set executable permissions and build plugin
if (process.platform !== "win32") {
  try {
    fs.chmodSync(targetServer, 0o755);
    const buildScript = path.join(agkDir, "build", "build.sh");
    const installScript = path.join(agkDir, "scripts", "install.sh");

    if (fs.existsSync(buildScript)) {
      execSync(`bash "${buildScript}"`, { stdio: "inherit" });
    }
    if (fs.existsSync(installScript)) {
      execSync(`bash "${installScript}" --app`, { stdio: "inherit" });
    }
  } catch (err) {
    console.warn("⚠️ Note: AGK build/install scripts exited with notice:", err.message);
  }
} else {
  console.log("ℹ️ Windows environment detected. Server script synchronized. Build scripts can be triggered via WSL/Git Bash if needed.");
}

console.log("✅ AGK sync completed successfully.");
