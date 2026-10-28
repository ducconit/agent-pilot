#!/usr/bin/env node
/**
 * Agent Pilot - Release bundle packer (3 OS editions: Ubuntu/Linux, macOS, Windows)
 *
 * Builds 3 OS ZIP archives (linux, macos, windows) containing:
 *
 *   agent-pilot-v<version>-<os>/
 *   ├── extensions/            Chrome extension (Load unpacked source)
 *   ├── install.sh / .ps1      One-step OS-specific installer script
 *   ├── skills/agent-pilot/    Agent skill bundle + native scripts/ binary
 *   └── README.md              OS-specific installation & MCP guide (docs/bundles/README.<os>.md)
 *
 * Usage:
 *   node scripts/pack_bundle.mjs                      # all 3 OSes (linux, macos, windows)
 *   node scripts/pack_bundle.mjs --os ubuntu          # Ubuntu/Linux only (linux-amd64)
 *   node scripts/pack_bundle.mjs --os macos           # macOS only (darwin-arm64)
 *   node scripts/pack_bundle.mjs --os windows         # Windows only (windows-amd64)
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
import { prepareDevtoolsRuntime } from "./build_devtools_runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const EXT_DIR = path.join(ROOT_DIR, "extensions");
const SKILLS_DIR = path.join(ROOT_DIR, "skills");
const DOCS_BUNDLES_DIR = path.join(ROOT_DIR, "docs", "bundles");
const SCRIPTS_BUNDLES_DIR = path.join(ROOT_DIR, "scripts", "bundles");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const BUNDLES_DIR = path.join(DIST_DIR, "bundles");
const STAGE_DIR = path.join(BUNDLES_DIR, ".stage");

const ALL_PLATFORMS = [
  { osId: "linux", goos: "linux", goarch: "amd64" },
  { osId: "macos", goos: "darwin", goarch: "arm64" },
  { osId: "windows", goos: "windows", goarch: "amd64" }
];

const OS_EDITION_ASSETS = {
  linux: {
    editionName: "Ubuntu / Linux",
    readmeTemplate: path.join(DOCS_BUNDLES_DIR, "README.ubuntu.md"),
    installerSrc: path.join(SCRIPTS_BUNDLES_DIR, "install-ubuntu.sh"),
    installerDest: "install.sh",
    executable: true
  },
  darwin: {
    editionName: "macOS",
    readmeTemplate: path.join(DOCS_BUNDLES_DIR, "README.macos.md"),
    installerSrc: path.join(SCRIPTS_BUNDLES_DIR, "install-macos.sh"),
    installerDest: "install.sh",
    executable: true
  },
  windows: {
    editionName: "Windows",
    readmeTemplate: path.join(DOCS_BUNDLES_DIR, "README.windows.md"),
    installerSrc: path.join(SCRIPTS_BUNDLES_DIR, "install-windows.ps1"),
    installerDest: "install.ps1",
    executable: false
  }
};

function normalizeOSAlias(raw) {
  const val = String(raw || "").trim().toLowerCase();
  if (val === "ubuntu" || val === "debian" || val === "linux") return "linux";
  if (val === "macos" || val === "mac" || val === "osx" || val === "darwin") return "darwin";
  if (val === "windows" || val === "win" || val === "win32") return "windows";
  return val;
}

function normalizePlatformToken(raw) {
  const token = String(raw || "").trim().toLowerCase().replace("/", "-");
  if (token === "linux" || token === "ubuntu" || token === "linux-amd64") return "linux";
  if (token === "macos" || token === "darwin" || token === "darwin-arm64") return "macos";
  if (token === "windows" || token === "win" || token === "windows-amd64") return "windows";
  return token;
}

function parseArgs(argv) {
  const options = { platforms: [], osList: [], keepStage: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep-stage") {
      options.keepStage = true;
    } else if (arg === "--platform") {
      options.platforms.push(normalizePlatformToken(argv[++i]));
    } else if (arg.startsWith("--platform=")) {
      options.platforms.push(normalizePlatformToken(arg.slice("--platform=".length)));
    } else if (arg === "--os") {
      options.osList.push(normalizeOSAlias(argv[++i]));
    } else if (arg.startsWith("--os=")) {
      options.osList.push(normalizeOSAlias(arg.slice("--os=".length)));
    } else {
      console.error(`❌ Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return options;
}

function platformLabel(platform) {
  return platform.osId;
}

function archLabel(platform) {
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
  for (const [goos, assets] of Object.entries(OS_EDITION_ASSETS)) {
    if (!fs.existsSync(assets.readmeTemplate)) {
      console.error(`❌ OS Bundle README not found for ${goos}: ${path.relative(ROOT_DIR, assets.readmeTemplate)}`);
      process.exit(1);
    }
    if (!fs.existsSync(assets.installerSrc)) {
      console.error(`❌ OS Bundle installer not found for ${goos}: ${path.relative(ROOT_DIR, assets.installerSrc)}`);
      process.exit(1);
    }
  }
  try {
    execFileSync("go", ["version"], { stdio: "ignore" });
  } catch (_) {
    console.error("❌ Go toolchain not found on PATH (required to build the CLI binaries).");
    process.exit(1);
  }
}

function renderBundleReadme(version, platform) {
  const assets = OS_EDITION_ASSETS[platform.goos];
  return fs
    .readFileSync(assets.readmeTemplate, "utf-8")
    .replaceAll("{{VERSION}}", `v${version}`)
    .replaceAll("{{PLATFORM}}", platformLabel(platform))
    .replaceAll("{{ARCH}}", platform.goarch)
    .replaceAll("{{BINARY_NAME}}", binaryName(platform));
}

function copyOSInstaller(platform, bundleRoot) {
  const assets = OS_EDITION_ASSETS[platform.goos];
  const destPath = path.join(bundleRoot, assets.installerDest);
  fs.copyFileSync(assets.installerSrc, destPath);
  if (assets.executable) {
    fs.chmodSync(destPath, 0o755);
  }
}

async function buildBinary(platform, outputPath) {
  await prepareDevtoolsRuntime({ ...platform, release: true });
  // -X flags inject the build metadata; package.json stays the version source
  const ldflags = [
    "-s",
    "-w",
    `-X github.com/ducconit/agent-pilot-extension/cli/version.Version=${version}`,
    `-X github.com/ducconit/agent-pilot-extension/cli/version.Commit=${commit}`,
    `-X github.com/ducconit/agent-pilot-extension/cli/version.Date=${buildDate}`
  ].join(" ");
  execFileSync("go", ["build", "-ldflags", ldflags, "-o", outputPath, "./cli/cmd/agent-pilot"], {
    cwd: ROOT_DIR,
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
execFileSync(process.execPath, [path.join(ROOT_DIR, "scripts", "update_extension_build_id.mjs")], { cwd: ROOT_DIR, stdio: "inherit" });
const version = readVersion();
checkPrerequisites();

// Build metadata injected into every binary (-ldflags -X); package.json is the
// single source of truth for the version.
function gitValue(args, fallback = "") {
  try {
    return execFileSync("git", args, { cwd: ROOT_DIR, encoding: "utf8" }).trim() || fallback;
  } catch (_) {
    return fallback;
  }
}
const commit = gitValue(["rev-parse", "--short", "HEAD"], "unknown");
const buildDate = new Date().toISOString();

const platforms = ALL_PLATFORMS.filter((p) => {
  const matchPlatform = options.platforms.length === 0 || options.platforms.includes(platformLabel(p));
  const matchOS = options.osList.length === 0 || options.osList.includes(p.goos);
  return matchPlatform && matchOS;
});

if (platforms.length === 0) {
  console.error(
    `❌ No matching platform. Known platforms: ${ALL_PLATFORMS.map(platformLabel).join(", ")} | Known --os: ubuntu, macos, windows`
  );
  process.exit(1);
}

console.log("==================================================================");
console.log("📦 AGENT PILOT - PACKAGING OS-SPECIFIC RELEASE BUNDLES");
console.log(`📌 Version  : v${version}`);
console.log(`📌 Platforms: ${platforms.map((p) => `${platformLabel(p)} (${archLabel(p)})`).join(", ")}`);
console.log("==================================================================");

fs.mkdirSync(BUNDLES_DIR, { recursive: true });
fs.rmSync(STAGE_DIR, { recursive: true, force: true });
if (platforms.length === ALL_PLATFORMS.length) {
  for (const entry of fs.readdirSync(BUNDLES_DIR)) {
    if (entry.endsWith(".zip")) {
      fs.rmSync(path.join(BUNDLES_DIR, entry), { force: true });
    }
  }
}

const bundleResults = [];

for (const platform of platforms) {
  const label = platformLabel(platform);
  const assets = OS_EDITION_ASSETS[platform.goos];
  const folderName = `agent-pilot-v${version}-${label}`;
  const stageBase = path.join(STAGE_DIR, label);
  const bundleRoot = path.join(stageBase, folderName);

  console.log(`\n→ [${label}] (${assets.editionName} - ${archLabel(platform)}) Building CLI binary & OS bundle...`);
  fs.mkdirSync(bundleRoot, { recursive: true });

  // 1. Extension (same excludes as the Chrome Web Store archive)
  copyFiltered(EXT_DIR, path.join(bundleRoot, "extensions"), DEFAULT_EXCLUDES);

  // 2. Skills bundle and its platform-native CLI/MCP binary
  fs.cpSync(SKILLS_DIR, path.join(bundleRoot, "skills"), { recursive: true });
  const skillScriptsDir = path.join(bundleRoot, "skills", "agent-pilot", "scripts");
  fs.mkdirSync(skillScriptsDir, { recursive: true });
  for (const staleBin of ["agent-pilot", "agent-pilot.exe"]) {
    fs.rmSync(path.join(skillScriptsDir, staleBin), { force: true });
  }
  const skillBinaryPath = path.join(skillScriptsDir, binaryName(platform));
  await buildBinary(platform, skillBinaryPath);
  if (platform.goos !== "windows") {
    fs.chmodSync(skillBinaryPath, 0o755);
  }

  // 3. OS-specific 1-step installer script (install.sh or install.ps1)
  copyOSInstaller(platform, bundleRoot);

  // 4. OS-specific installation & MCP server guide
  fs.writeFileSync(path.join(bundleRoot, "README.md"), renderBundleReadme(version, platform), "utf-8");

  // 6. Zip the bundle folder (stageBase contains only this platform's folder)
  const zipPath = path.join(BUNDLES_DIR, `${folderName}.zip`);
  console.log(`→ [${label}] Creating ${path.relative(ROOT_DIR, zipPath)}...`);
  createZip(stageBase, zipPath, { excludes: [] });

  const stats = fs.statSync(zipPath);
  bundleResults.push({
    label,
    editionName: assets.editionName,
    zipName: path.basename(zipPath),
    size: stats.size,
    sha256: sha256File(zipPath)
  });
}

// Checksums for every bundle
const checksumLines = bundleResults.map((b) => `${b.sha256}  ${b.zipName}`).join("\n") + "\n";
const checksumPath = path.join(BUNDLES_DIR, "checksums.txt");
fs.writeFileSync(checksumPath, checksumLines, "utf-8");
fs.writeFileSync(path.join(DIST_DIR, "checksums.txt"), checksumLines, "utf-8");

if (!options.keepStage) {
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
}

console.log("\n==================================================================");
console.log("✅ BUNDLE PACKAGING COMPLETED SUCCESSFULLY!");
for (const bundle of bundleResults) {
  console.log(`📁 [${bundle.editionName}] dist/bundles/${bundle.zipName}  (${(bundle.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`   sha256: ${bundle.sha256}`);
}
console.log(`📝 Checksums: dist/bundles/checksums.txt`);
console.log("==================================================================");
