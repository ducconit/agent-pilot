/**
 * Agent Pilot - Cross-platform ZIP helper
 *
 * One implementation shared by the extension packer and the release-bundle
 * packer:
 *   - POSIX: `zip` when available, otherwise a real bsdtar (GNU tar cannot zip)
 *   - Windows: tar.exe (bsdtar) with --exclude, else Compress-Archive over a
 *     filtered staging copy
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Files never shipped in release archives (applied to every packaging branch).
export const DEFAULT_EXCLUDES = ["README.md", "*.map", "*.DS_Store", "Thumbs.db", "*.git*"];

// Match an exclusion pattern against a relative path (simple glob: name and *.ext).
export function isExcluded(relPath, excludes = DEFAULT_EXCLUDES) {
  const segments = relPath.split(/[\\/]/);
  const base = segments[segments.length - 1];
  for (const pattern of excludes) {
    if (pattern.startsWith("*.")) {
      if (base.endsWith(pattern.slice(1))) return true;
    } else if (pattern === base) {
      return true;
    }
  }
  // ".git*" / "*git*" style patterns and any dot-git directory segment
  if (segments.some((seg) => seg.includes(".git")) && excludes.some((p) => p.includes(".git"))) {
    return true;
  }
  return false;
}

function commandExists(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
    return true;
  } catch (_) {
    return false;
  }
}

// GNU tar cannot create zip archives (`tar -a` only works with bsdtar/libarchive).
export function isBsdtar() {
  try {
    const out = execFileSync("tar", ["--version"], { encoding: "utf8" });
    return /bsdtar/i.test(out);
  } catch (_) {
    return false;
  }
}

/**
 * Copy srcDir into destDir, skipping excluded files.
 * Used by the Windows PowerShell fallback (Compress-Archive has no exclude option).
 */
export function copyFiltered(srcDir, destDir, excludes = DEFAULT_EXCLUDES, baseRel = "") {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    if (isExcluded(rel, excludes)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyFiltered(srcPath, destPath, excludes, rel);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Create sourceDir as a zip archive.
 * @param {string} sourceDir directory whose contents become the archive root
 * @param {string} outputZip absolute path of the zip to create
 * @param {{excludes?: string[]}} [options]
 */
export function createZip(sourceDir, outputZip, options = {}) {
  const excludes = options.excludes ?? DEFAULT_EXCLUDES;
  const tarExcludes = excludes.map((pattern) => `--exclude=${pattern}`);

  fs.mkdirSync(path.dirname(outputZip), { recursive: true });
  if (fs.existsSync(outputZip)) fs.unlinkSync(outputZip);

  if (process.platform === "win32") {
    // Strategy 1 (Windows 10 1803+ / Windows 11): tar.exe (bsdtar) with --exclude flags
    try {
      execFileSync("tar", ["-a", "-c", "-f", outputZip, ...tarExcludes, "-C", sourceDir, "."], { stdio: "inherit" });
      return;
    } catch (_) {}

    // Strategy 2: PowerShell Compress-Archive over a filtered staging directory
    const stageDir = path.join(os.tmpdir(), `agent-pilot-pack-${Date.now()}`);
    try {
      copyFiltered(sourceDir, stageDir, excludes);
      const escapePsSingleQuoted = (s) => String(s).replace(/'/g, "''");
      const psCmd = `Compress-Archive -Path '${escapePsSingleQuoted(stageDir)}\\*' -DestinationPath '${escapePsSingleQuoted(outputZip)}' -Force`;
      execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCmd], { stdio: "inherit" });
      return;
    } catch (_) {
      // Fall through to the error below.
    } finally {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }

    throw new Error("Failed to create zip archive on Windows with tar.exe or Compress-Archive.");
  }

  // Linux & macOS: prefer the `zip` utility (with exclusions applied).
  if (commandExists("zip")) {
    const args = ["-r", "-9", outputZip, "."];
    if (excludes.length > 0) {
      args.push("-x", ...excludes);
    }
    execFileSync("zip", args, { cwd: sourceDir, stdio: "inherit" });
    return;
  }

  // No `zip`: GNU tar cannot create zip archives, so only accept a real bsdtar.
  if (isBsdtar()) {
    execFileSync("tar", ["-a", "-c", "-f", outputZip, ...tarExcludes, "-C", sourceDir, "."], { stdio: "inherit" });
    return;
  }

  console.error("❌ Cannot create a ZIP archive: the 'zip' utility is not installed and no bsdtar was found.");
  console.error("   Please install 'zip' (e.g. `sudo apt-get install zip`) and retry.");
  process.exit(1);
}
