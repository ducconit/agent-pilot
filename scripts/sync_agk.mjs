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

// Synchronize extensions/ directory -> ~/.agk/extension
const extSourceDir = path.join(ROOT_DIR, "extensions");
const targetExtDir = path.join(agkDir, "extension");
if (fs.existsSync(extSourceDir) && fs.existsSync(targetExtDir)) {
  try {
    fs.cpSync(extSourceDir, targetExtDir, { recursive: true });
    console.log(`✓ Synchronized extension directory -> ${targetExtDir}`);
  } catch (err) {
    console.warn("⚠️ Note: Could not copy extension directory to AGK:", err.message);
  }
}

function atomicCopyExecutable(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp.${Date.now()}`;
  fs.copyFileSync(src, tmp);
  if (process.platform !== "win32") {
    fs.chmodSync(tmp, 0o755);
  }
  try {
    fs.renameSync(tmp, dest);
  } catch (_) {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

// Synchronize cli/agent-pilot binary if compiled
const binaryName = process.platform === "win32" ? "agent-pilot.exe" : "agent-pilot";
const binarySource = path.join(ROOT_DIR, "cli", binaryName);
if (fs.existsSync(binarySource)) {
  try {
    const targetBin = path.join(agkDir, "bin", binaryName);
    atomicCopyExecutable(binarySource, targetBin);
    console.log(`✓ Synchronized agent-pilot binary -> ${targetBin}`);

    const agkSkillBin = path.join(targetSkillDir, "scripts", binaryName);
    atomicCopyExecutable(binarySource, agkSkillBin);
    console.log(`✓ Synchronized skill binary -> ${agkSkillBin}`);

    const geminiBinDir = path.join(homeDir, ".gemini", "config", "plugins", "agk", "bin");
    if (fs.existsSync(path.dirname(geminiBinDir))) {
      const geminiBin = path.join(geminiBinDir, binaryName);
      atomicCopyExecutable(binarySource, geminiBin);
      console.log(`✓ Synchronized agent-pilot binary -> ${geminiBin}`);

      const geminiSkillBin = path.join(homeDir, ".gemini", "config", "plugins", "agk", "skills", "agent-pilot", "scripts", binaryName);
      atomicCopyExecutable(binarySource, geminiSkillBin);
      console.log(`✓ Synchronized skill binary -> ${geminiSkillBin}`);
    }

    const userLocalBin = path.join(homeDir, ".local", "bin", binaryName);
    try {
      if (fs.existsSync(userLocalBin)) {
        const lstat = fs.lstatSync(userLocalBin);
        if (!lstat.isSymbolicLink() || fs.realpathSync(userLocalBin) !== fs.realpathSync(targetBin)) {
          atomicCopyExecutable(binarySource, userLocalBin);
          console.log(`✓ Synchronized user PATH binary -> ${userLocalBin}`);
        }
      }
    } catch (_) {}

    const globalSkillBin = path.join(homeDir, ".gemini", "config", "skills", "agent-pilot", "scripts", binaryName);
    if (fs.existsSync(path.dirname(path.dirname(globalSkillBin)))) {
      try {
        atomicCopyExecutable(binarySource, globalSkillBin);
        console.log(`✓ Synchronized global skill binary -> ${globalSkillBin}`);
      } catch (_) {}
    }

    try {
      execSync(`"${binarySource}" service restart`, { stdio: "ignore" });
      console.log(`✓ Restarted active Agent Pilot background service with upgraded binary`);
    } catch (_) {}

    // Export & synchronize MCP tool schemas
    const mcpTargets = [
      path.join(ROOT_DIR, "mcp", "agent-pilot"),
      path.join(agkDir, "mcp", "agent-pilot"),
      path.join(homeDir, ".gemini", "antigravity", "mcp", "agent-pilot"),
      path.join(homeDir, ".gemini", "antigravity", "mcp", "agk_agent-pilot"),
    ];
    for (const mcpDir of mcpTargets) {
      if (mcpDir === path.join(ROOT_DIR, "mcp", "agent-pilot") || fs.existsSync(path.dirname(mcpDir))) {
        try {
          execSync(`"${binarySource}" export-mcp "${mcpDir}"`, { stdio: "ignore" });
          console.log(`✓ Synchronized MCP schemas -> ${mcpDir}`);
        } catch (_) {}
      }
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
