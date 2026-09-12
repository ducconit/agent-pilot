#!/usr/bin/env node
/**
 * Agent Pilot - Extension Packaging Utility
 * Packages extensions/ into a distribution-ready ZIP for GitHub Releases & Chrome Web Store
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const EXT_DIR = path.join(ROOT_DIR, "extensions");
const DIST_DIR = path.join(ROOT_DIR, "dist");

// 1. Read and validate versions
const pkgPath = path.join(ROOT_DIR, "package.json");
const manifestPath = path.join(EXT_DIR, "manifest.json");

if (!fs.existsSync(pkgPath) || !fs.existsSync(manifestPath)) {
  console.error("❌ Error: Missing package.json or extensions/manifest.json");
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

console.log("==================================================================");
console.log("📦 AGENT PILOT - PACKAGING EXTENSION FOR RELEASE");
console.log(`📌 package.json version : v${pkg.version}`);
console.log(`📌 manifest.json version: v${manifest.version}`);

if (pkg.version !== manifest.version) {
  console.warn(`⚠️ Warning: package.json (${pkg.version}) and manifest.json (${manifest.version}) versions do not match!`);
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

  if (isWindows) {
    // Strategy 1 (Windows 10 1803+ / Windows 11): tar.exe with auto-compression
    try {
      execSync(`tar -a -c -f "${outputZip}" -C "${extDir}" .`, { stdio: "inherit" });
      return;
    } catch (_) {}

    // Strategy 2: PowerShell Compress-Archive
    try {
      const psCmd = `powershell -NoProfile -NonInteractive -Command "Compress-Archive -Path '${extDir}\\*' -DestinationPath '${outputZip}' -Force"`;
      execSync(psCmd, { stdio: "inherit" });
      return;
    } catch (_) {}
  }

  // Linux & macOS: Standard zip utility
  try {
    execSync(`cd "${extDir}" && zip -r -9 "${outputZip}" . -x "*.DS_Store" "*Thumbs.db" "*.git*"`, {
      stdio: "inherit"
    });
    return;
  } catch (_) {}

  // Fallback to tar with auto-compression
  try {
    execSync(`tar -a -c -f "${outputZip}" -C "${extDir}" .`, { stdio: "inherit" });
    return;
  } catch (err) {
    throw new Error(`Failed to create zip archive with zip or tar: ${err.message}`);
  }
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
