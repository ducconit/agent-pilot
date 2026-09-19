#!/usr/bin/env node
/**
 * Agent Pilot - Release bundle packer
 *
 * Builds one ZIP per platform (linux/darwin/windows × amd64/arm64) containing:
 *
 *   agent-pilot-v<version>-<os>-<arch>/
 *   ├── extensions/            Chrome extension (Load unpacked source)
 *   ├── agent-pilot(.exe)      Static CLI / MCP server for that platform
 *   ├── skills/agent-pilot/    Agent skill bundle
 *   └── README.md              Installation & usage guide (docs/BUNDLE_README.md)
 *
 * Usage:
 *   node scripts/pack_bundle.mjs                      # all platforms
 *   node scripts/pack_bundle.mjs --platform linux/amd64
 *   node scripts/pack_bundle.mjs --keep-stage         # keep the staging tree
 *
 * Cross-compilation is pure Go (CGO_ENABLED=0), so every target builds from the
 * current host. Zipping reuses scripts/lib/zip.mjs (zip / bsdtar / Windows tar).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createZip, copyFiltered, DEFAULT_EXCLUDES } from "./lib/zip.mjs";
import { validateManifestReferences, readExtensionManifest } from "./lib/manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const CLI_DIR = path.join(ROOT_DIR, "cli");
const EXT_DIR = path.join(ROOT_DIR, "extensions");
const SKILLS_DIR = path.join(ROOT_DIR, "skills");
const BUNDLE_README = path.join(ROOT_DIR, "docs", "BUNDLE_README.md");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const BUNDLES_DIR = path.join(DIST_DIR, "bundles");
const STAGE_DIR = path.join(BUNDLES_DIR, ".stage");

const ALL_PLATFORMS = [
  { goos: "linux", goarch: "amd64" },
  { goos: "linux", goarch: "arm64" },
  { goos: "darwin", goarch: "amd64" },
  { goos: "darwin", goarch: "arm64" },
  { goos: "windows", goarch: "amd64" },
  { goos: "windows", goarch: "arm64" }
];

function parseArgs(argv) {
  const options = { platforms: [], keepStage: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep-stage") {
      options.keepStage = true;
    } else if (arg === "--platform") {
      options.platforms.push(argv[++i]);
    } else if (arg.startsWith("--platform=")) {
      options.platforms.push(arg.slice("--platform=".length));
    } else {
      console.error(`❌ Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return options;
}

function platformLabel(platform) {
  return `${platform.goos}-${platform.goarch}`;
}

function binaryName(platform) {
  return platform.goos === "windows" ? "agent-pilot.exe" : "agent-pilot";
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8"));
  const manifestPath = path.join(EXT_DIR, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const manifestVersion = manifest.version_name || manifest.version;
  if (pkg.version !== manifest.version && pkg.version !== manifestVersion) {
    console.error(`❌ Version mismatch: package.json (${pkg.version}) vs manifest.json (${manifestVersion})`);
    process.exit(1);
  }
  return pkg.version;
}

function checkPrerequisites() {
  if (!fs.existsSync(path.join(EXT_DIR, "manifest.json"))) {
    console.error("❌ extensions/manifest.json not found — run from the repository root.");
    process.exit(1);
  }
  // Same manifest-reference gate as pack_extension: never ship a broken extension
  const { refs, missing } = validateManifestReferences(EXT_DIR, readExtensionManifest(EXT_DIR));
  if (missing.length > 0) {
    console.error("❌ Manifest references files that are missing from extensions/:");
    for (const rel of missing) console.error(`   - ${rel}`);
    process.exit(1);
  }
  console.log(`→ Manifest validated: ${refs} referenced file(s) present.`);
  if (!fs.existsSync(path.join(SKILLS_DIR, "agent-pilot", "SKILL.md"))) {
    console.error("❌ skills/agent-pilot/SKILL.md not found.");
    process.exit(1);
  }
  if (!fs.existsSync(BUNDLE_README)) {
    console.error(`❌ Bundle README not found: ${path.relative(ROOT_DIR, BUNDLE_README)}`);
    process.exit(1);
  }
  try {
    execFileSync("go", ["version"], { stdio: "ignore" });
  } catch (_) {
    console.error("❌ Go toolchain not found on PATH (required to build the CLI binaries).");
    process.exit(1);
  }
}

function renderBundleReadme(version, platform) {
  return fs
    .readFileSync(BUNDLE_README, "utf-8")
    .replaceAll("{{VERSION}}", `v${version}`)
    .replaceAll("{{PLATFORM}}", platformLabel(platform))
    .replaceAll("{{BINARY_NAME}}", binaryName(platform));
}

function buildBinary(platform, outputPath) {
  execFileSync("go", ["build", "-ldflags=-s -w", "-o", outputPath, "."], {
    cwd: CLI_DIR,
    stdio: "inherit",
    env: { ...process.env, CGO_ENABLED: "0", GOOS: platform.goos, GOARCH: platform.goarch }
  });
  if (platform.goos !== "windows") {
    fs.chmodSync(outputPath, 0o755);
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const options = parseArgs(process.argv.slice(2));
const version = readVersion();
checkPrerequisites();

const platforms = options.platforms.length
  ? ALL_PLATFORMS.filter((p) => options.platforms.includes(platformLabel(p)))
  : ALL_PLATFORMS;

if (platforms.length === 0) {
  console.error(`❌ No matching platform. Known: ${ALL_PLATFORMS.map(platformLabel).join(", ")}`);
  process.exit(1);
}

console.log("==================================================================");
console.log("📦 AGENT PILOT - PACKAGING RELEASE BUNDLES");
console.log(`📌 Version  : v${version}`);
console.log(`📌 Platforms: ${platforms.map(platformLabel).join(", ")}`);
console.log("==================================================================");

fs.mkdirSync(BUNDLES_DIR, { recursive: true });
fs.rmSync(STAGE_DIR, { recursive: true, force: true });

const bundleResults = [];

for (const platform of platforms) {
  const label = platformLabel(platform);
  const folderName = `agent-pilot-v${version}-${label}`;
  const stageBase = path.join(STAGE_DIR, label);
  const bundleRoot = path.join(stageBase, folderName);

  console.log(`\n→ [${label}] Building CLI binary...`);
  fs.mkdirSync(bundleRoot, { recursive: true });

  // 1. Extension (same excludes as the Chrome Web Store archive)
  copyFiltered(EXT_DIR, path.join(bundleRoot, "extensions"), DEFAULT_EXCLUDES);

  // 2. Platform binary
  buildBinary(platform, path.join(bundleRoot, binaryName(platform)));

  // 3. Skills bundle
  fs.cpSync(SKILLS_DIR, path.join(bundleRoot, "skills"), { recursive: true });

  // 4. Installation & usage guide
  fs.writeFileSync(path.join(bundleRoot, "README.md"), renderBundleReadme(version, platform), "utf-8");

  // 5. Zip the bundle folder (stageBase contains only this platform's folder)
  const zipPath = path.join(BUNDLES_DIR, `${folderName}.zip`);
  console.log(`→ [${label}] Creating ${path.relative(ROOT_DIR, zipPath)}...`);
  createZip(stageBase, zipPath, { excludes: [] });

  const stats = fs.statSync(zipPath);
  bundleResults.push({ label, zipName: path.basename(zipPath), size: stats.size, sha256: sha256File(zipPath) });
}

// Checksums for every bundle
const checksumLines = bundleResults.map((b) => `${b.sha256}  ${b.zipName}`).join("\n") + "\n";
const checksumPath = path.join(BUNDLES_DIR, "checksums.txt");
fs.writeFileSync(checksumPath, checksumLines, "utf-8");

if (!options.keepStage) {
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
}

console.log("\n==================================================================");
console.log("✅ BUNDLE PACKAGING COMPLETED SUCCESSFULLY!");
for (const bundle of bundleResults) {
  console.log(`📁 dist/bundles/${bundle.zipName}  (${(bundle.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`   sha256: ${bundle.sha256}`);
}
console.log(`📝 Checksums: dist/bundles/checksums.txt`);
console.log("==================================================================");
