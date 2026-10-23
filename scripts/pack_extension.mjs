#!/usr/bin/env node
/**
 * Agent Pilot - Extension Packaging Utility
 *
 * Packages extensions/ into a distribution-ready ZIP (Chrome Web Store upload
 * and the extension-only asset on GitHub Releases). The full release bundle
 * (extension + CLI binary + skills + README) lives in pack_bundle.mjs.
 *
 * Zip creation is delegated to scripts/lib/zip.mjs so every packaging path
 * (POSIX zip, bsdtar, Windows tar.exe/PowerShell) behaves identically.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createZip, DEFAULT_EXCLUDES } from "./lib/zip.mjs";
import { validateManifestReferences } from "./lib/manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const EXT_DIR = path.join(ROOT_DIR, "extensions");
const DIST_DIR = path.join(ROOT_DIR, "dist");

execFileSync(process.execPath, [path.join(ROOT_DIR, "scripts", "update_extension_build_id.mjs")], { cwd: ROOT_DIR, stdio: "inherit" });

// Fail fast when the manifest points at files that do not exist.
function assertManifestReferences(extDir, manifest) {
  const { refs, missing } = validateManifestReferences(extDir, manifest);
  if (missing.length > 0) {
    console.error("❌ Manifest references files that are missing from extensions/:");
    for (const rel of missing) console.error(`   - ${rel}`);
    process.exit(1);
  }
  console.log(`→ Manifest validated: ${refs} referenced file(s) present.`);
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
assertManifestReferences(EXT_DIR, manifest);

const manifestVer = manifest.version_name || manifest.version;

console.log("==================================================================");
console.log("📦 AGENT PILOT - PACKAGING EXTENSION FOR RELEASE");
console.log(`📌 package.json version : v${pkg.version}`);
console.log(`📌 manifest.json version: v${manifest.version}${manifest.version_name ? ` (${manifest.version_name})` : ""}`);

if (pkg.version !== manifest.version && pkg.version !== manifest.version_name) {
  console.warn(`⚠️ Warning: package.json (${pkg.version}) and manifest.json (${manifestVer}) versions do not match!`);
}

// 2. Prepare dist directory
fs.mkdirSync(DIST_DIR, { recursive: true });

const zipFileName = `agent-pilot-v${pkg.version}.zip`;
const zipFilePath = path.join(DIST_DIR, zipFileName);

// 3. Zip extensions/ contents
console.log(`→ Creating zip archive: dist/${zipFileName}...`);
try {
  createZip(EXT_DIR, zipFilePath, { excludes: DEFAULT_EXCLUDES });
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
