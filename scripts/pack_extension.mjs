#!/usr/bin/env node
/**
 * Agent Pilot - Extension Packaging Utility
 * Packages extensions/ into a distribution-ready ZIP for GitHub Releases & Chrome Web Store
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const EXT_DIR = path.join(ROOT_DIR, "extensions");
const DIST_DIR = path.join(ROOT_DIR, "dist");

// Files never shipped in the release archive. Applied to every packaging branch.
const EXCLUDES = ["README.md", "*.map", "*.DS_Store", "Thumbs.db", "*.git*"];

// Match the exclusion patterns above against an extension-relative path.
function isExcluded(relPath) {
  const segments = relPath.split(/[\\/]/);
  const base = segments[segments.length - 1];
  if (base === "README.md" || base === "Thumbs.db") return true;
  if (base.endsWith(".map")) return true;
  if (base.endsWith(".DS_Store")) return true;
  if (segments.some((seg) => seg.includes(".git"))) return true;
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
function isBsdtar() {
  try {
    const out = execFileSync("tar", ["--version"], { encoding: "utf8" });
    return /bsdtar/i.test(out);
  } catch (_) {
    return false;
  }
}

// Copy extDir into destDir, skipping excluded files (used by the Windows PowerShell fallback).
function copyFiltered(srcDir, destDir, baseRel = "") {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    if (isExcluded(rel)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyFiltered(srcPath, destPath, rel);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Ensure every file referenced by manifest.json is present before packaging.
function validateManifestReferences(extDir, mf) {
  const refs = new Set();
  const add = (p) => {
    if (typeof p === "string" && p) refs.add(p);
  };
  if (mf.background) add(mf.background.service_worker);
  for (const cs of mf.content_scripts || []) {
    for (const f of cs.js || []) add(f);
    for (const f of cs.css || []) add(f);
  }
  if (mf.side_panel) add(mf.side_panel.default_path);
  for (const icon of Object.values(mf.icons || {})) add(icon);

  const missing = [];
  for (const rel of refs) {
    if (!fs.existsSync(path.join(extDir, rel))) missing.push(rel);
  }
  if (missing.length > 0) {
    console.error("❌ Manifest references files that are missing from extensions/:");
    for (const rel of missing) console.error(`   - ${rel}`);
    process.exit(1);
  }
  console.log(`→ Manifest validated: ${refs.size} referenced file(s) present.`);
}

// 1. Read and validate versions
const pkgPath = path.join(ROOT_DIR, "package.json");
const manifestPath = path.join(EXT_DIR, "manifest.json");

if (!fs.existsSync(pkgPath) || !fs.existsSync(manifestPath)) {
  console.error("❌ Error: Missing package.json or extensions/manifest.json");
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

// Fail fast if the manifest points at files that do not exist.
validateManifestReferences(EXT_DIR, manifest);

const manifestVer = manifest.version_name || manifest.version;

console.log("==================================================================");
console.log("📦 AGENT PILOT - PACKAGING EXTENSION FOR RELEASE");
console.log(`📌 package.json version : v${pkg.version}`);
console.log(`📌 manifest.json version: v${manifest.version}${manifest.version_name ? ` (${manifest.version_name})` : ""}`);

if (pkg.version !== manifest.version && pkg.version !== manifest.version_name) {
  console.warn(`⚠️ Warning: package.json (${pkg.version}) and manifest.json (${manifestVer}) versions do not match!`);
}

// 2. Prepare dist directory
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

const zipFileName = `agent-pilot-v${pkg.version}.zip`;
const zipFilePath = path.join(DIST_DIR, zipFileName);

// Remove existing zip if present
if (fs.existsSync(zipFilePath)) {
  fs.unlinkSync(zipFilePath);
}

// 3. Zip extensions/ contents
console.log(`→ Creating zip archive: dist/${zipFileName}...`);

function packZip(extDir, outputZip) {
  const isWindows = process.platform === "win32";
  const tarExcludes = EXCLUDES.map((pattern) => `--exclude=${pattern}`);

  if (isWindows) {
    // Strategy 1 (Windows 10 1803+ / Windows 11): tar.exe (bsdtar) with --exclude flags
    try {
      execFileSync("tar", ["-a", "-c", "-f", outputZip, ...tarExcludes, "-C", extDir, "."], { stdio: "inherit" });
      return;
    } catch (_) {}

    // Strategy 2: PowerShell Compress-Archive over a filtered staging directory
    const stageDir = path.join(os.tmpdir(), `agent-pilot-pack-${Date.now()}`);
    try {
      copyFiltered(extDir, stageDir);
      const psCmd = `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${outputZip}' -Force`;
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
    execFileSync("zip", ["-r", "-9", outputZip, ".", "-x", ...EXCLUDES], { cwd: extDir, stdio: "inherit" });
    return;
  }

  // No `zip`: GNU tar cannot create zip archives, so only accept a real bsdtar.
  if (isBsdtar()) {
    execFileSync("tar", ["-a", "-c", "-f", outputZip, ...tarExcludes, "-C", extDir, "."], { stdio: "inherit" });
    return;
  }

  console.error("❌ Cannot create a ZIP archive: the 'zip' utility is not installed and no bsdtar was found.");
  console.error("   Please install 'zip' (e.g. `sudo apt-get install zip`) and retry.");
  process.exit(1);
}

try {
  packZip(EXT_DIR, zipFilePath);
} catch (err) {
  console.error("❌ Failed to create zip archive:", err.message);
  process.exit(1);
}

// 4. Calculate SHA-256 Checksum
const fileBuffer = fs.readFileSync(zipFilePath);
const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
const stats = fs.statSync(zipFilePath);

const checksumPath = path.join(DIST_DIR, "checksums.txt");
fs.writeFileSync(checksumPath, `${hash}  ${zipFileName}\n`, "utf-8");

console.log("==================================================================");
console.log("✅ PACKAGING COMPLETED SUCCESSFULLY!");
console.log(`📁 Output File: dist/${zipFileName}`);
console.log(`📊 File Size  : ${(stats.size / 1024).toFixed(2)} KB (${stats.size} bytes)`);
console.log(`🔒 SHA-256    : ${hash}`);
console.log(`📝 Checksum   : dist/checksums.txt`);
console.log("==================================================================");
