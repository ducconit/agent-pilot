#!/usr/bin/env node

// test/platform/powershell.test.mjs
// Runs PowerShell AST parsing, PSScriptAnalyzer static analysis, and installer simulation.

import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");

const PS_SCRIPTS = [
  path.join(ROOT_DIR, "scripts", "bundles", "install-windows.ps1"),
  path.join(ROOT_DIR, "scripts", "install_windows_service.ps1")
];

console.log("==================================================================");
console.log("🔍 CHECKING POWERSHELL SCRIPTS INTEGRITY & SYNTAX");
console.log("==================================================================");

// 1. Check Encoding, BOM, and CRLF (Windows PowerShell 5.1 compatibility)
let encodingErrors = 0;
for (const file of PS_SCRIPTS) {
  const relPath = path.relative(ROOT_DIR, file);
  const buf = fs.readFileSync(file);

  let fileErrors = 0;
  // Verify UTF-8 BOM
  if (buf.length < 3 || buf[0] !== 0xef || buf[1] !== 0xbb || buf[2] !== 0xbf) {
    console.error(`❌ Missing UTF-8 BOM in ${relPath}. Windows PowerShell 5.1 requires BOM.`);
    fileErrors++;
  } else if (buf.length >= 6 && buf[3] === 0xef && buf[4] === 0xbb && buf[5] === 0xbf) {
    console.error(`❌ Duplicate BOM detected in ${relPath}!`);
    fileErrors++;
  }

  // Verify CRLF line endings
  const text = buf.toString("utf8", 3);
  if (/(?<!\r)\n/.test(text)) {
    console.error(`❌ Non-CRLF line ending detected in ${relPath}. Windows PowerShell requires CRLF.`);
    fileErrors++;
  }

  if (fileErrors === 0) {
    console.log(`✓ [Encoding] UTF-8 BOM + CRLF verified: ${relPath}`);
  } else {
    encodingErrors += fileErrors;
  }
}

if (encodingErrors > 0) {
  console.error(`\n❌ Failed encoding validation: ${encodingErrors} errors.`);
  process.exit(1);
}

// 2. Discover PowerShell executable (pwsh, powershell, or /tmp/pwsh/pwsh)
function findPwsh() {
  const candidates = [
    "pwsh",
    "powershell",
    "/tmp/pwsh/pwsh"
  ];
  for (const cmd of candidates) {
    try {
      const res = spawnSync(cmd, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
        encoding: "utf8"
      });
      if (res.status === 0 && res.stdout) {
        return { cmd, version: res.stdout.trim() };
      }
    } catch (_) {}
  }
  return null;
}

const pwsh = findPwsh();
if (!pwsh) {
  console.log("⚠️ No PowerShell runtime (pwsh) found in environment. Skipping AST and simulation tests.");
  console.log("✅ File encoding checks passed.");
  process.exit(0);
}

console.log(`✓ Using PowerShell runtime: ${pwsh.cmd} (v${pwsh.version})`);

// 3. Run Parser AST Check & Simulation Test
let simScript = path.join(ROOT_DIR, "test", "platform", "test_windows_installer.ps1");
if (!fs.existsSync(simScript)) {
  simScript = path.join(ROOT_DIR, "scripts", "test_windows_installer.ps1");
}

try {
  console.log("\n▶ Running test_windows_installer.ps1...");
  execFileSync(pwsh.cmd, ["-NoProfile", "-NonInteractive", "-File", simScript], {
    stdio: "inherit"
  });
  console.log("\n✅ All PowerShell verification tests passed!");
} catch (err) {
  console.error(`\n❌ PowerShell test failed with code ${err.status}`);
  process.exit(err.status || 1);
}
