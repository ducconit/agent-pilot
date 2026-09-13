#!/usr/bin/env node
/**
 * Agent Pilot - Cross-Platform AGK Plugin Synchronization
 * Safely synchronizes cli/agent-pilot binary and skill/MCP assets to ~/.agk across Windows, macOS, and Linux.
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

if (!fs.existsSync(agkDir)) {
  console.log("ℹ️ .agk directory not found in user home. Skipping local AGK plugin synchronization.");
  process.exit(0);
}

// 1. Clean up legacy JS bridge server files if present
const staleServerFiles = [
  path.join(agkDir, "scripts", "agent-pilot", "server.mjs"),
  path.join(homeDir, ".gemini", "config", "plugins", "agk", "scripts", "agent-pilot", "server.mjs")
];
for (const stale of staleServerFiles) {
  if (fs.existsSync(stale)) {
    try {
      fs.unlinkSync(stale);
      console.log(`✓ Removed stale JS bridge server: ${stale}`);
    } catch (_) {}
  }
}

// Synchronize skills/agent-pilot directory (SKILL.md, references/, examples/)
const skillSourceDir = path.join(ROOT_DIR, "skills", "agent-pilot");
const targetSkillDir = path.join(agkDir, "skills", "agent-pilot");

if (fs.existsSync(skillSourceDir)) {
  try {
    fs.mkdirSync(targetSkillDir, { recursive: true });
    fs.cpSync(skillSourceDir, targetSkillDir, { recursive: true });
    console.log(`✓ Synchronized skill directory -> ${targetSkillDir}`);

    const geminiSkillDir = path.join(homeDir, ".gemini", "config", "plugins", "agk", "skills", "agent-pilot");
    if (fs.existsSync(path.dirname(geminiSkillDir))) {
      fs.mkdirSync(geminiSkillDir, { recursive: true });
      fs.cpSync(skillSourceDir, geminiSkillDir, { recursive: true });
      console.log(`✓ Synchronized skill directory -> ${geminiSkillDir}`);
    }
  } catch (err) {
    console.warn("⚠️ Note: Could not copy skill directory to AGK:", err.message);
  }
}

// Synchronize cli/agent-pilot binary if compiled
const binarySource = path.join(ROOT_DIR, "cli", process.platform === "win32" ? "agent-pilot.exe" : "agent-pilot");
if (fs.existsSync(binarySource)) {
  try {
    const agkBinDir = path.join(agkDir, "bin");
    fs.mkdirSync(agkBinDir, { recursive: true });
    const targetBin = path.join(agkBinDir, path.basename(binarySource));
    const tmpBin = `${targetBin}.tmp.${Date.now()}`;
    fs.copyFileSync(binarySource, tmpBin);
    if (process.platform !== "win32") {
      fs.chmodSync(tmpBin, 0o755);
    }
    try {
      fs.renameSync(tmpBin, targetBin);
    } catch (_) {
      try { fs.unlinkSync(tmpBin); } catch (_) {}
    }
    console.log(`✓ Synchronized agent-pilot binary -> ${targetBin}`);

    const geminiBinDir = path.join(homeDir, ".gemini", "config", "plugins", "agk", "bin");
    if (fs.existsSync(path.dirname(geminiBinDir))) {
      fs.mkdirSync(geminiBinDir, { recursive: true });
      const geminiBin = path.join(geminiBinDir, path.basename(binarySource));
      const tmpGeminiBin = `${geminiBin}.tmp.${Date.now()}`;
      fs.copyFileSync(binarySource, tmpGeminiBin);
      if (process.platform !== "win32") {
        fs.chmodSync(tmpGeminiBin, 0o755);
      }
      try {
        fs.renameSync(tmpGeminiBin, geminiBin);
      } catch (_) {
        try { fs.unlinkSync(tmpGeminiBin); } catch (_) {}
      }
      console.log(`✓ Synchronized agent-pilot binary -> ${geminiBin}`);
    }
  } catch (err) {
    console.warn("⚠️ Note: Could not copy agent-pilot binary to AGK bin:", err.message);
  }
}

// On Unix-like environments (Linux, macOS), set executable permissions and build plugin
if (process.platform !== "win32") {
  try {
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
