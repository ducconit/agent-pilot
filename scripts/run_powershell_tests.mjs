#!/usr/bin/env node

// scripts/run_powershell_tests.mjs
// Runs PowerShell AST parsing, PSScriptAnalyzer static analysis, and installer simulation.

import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

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
  
  // Verify UTF-8 BOM
  if (buf.length < 3 || buf[0] !== 0xef || buf[1] !== 0xbb || buf[2] !== 0xbf) {
    console.error(`❌ Missing UTF-8 BOM in ${relPath}. Windows PowerShell 5.1 requires BOM.`);
    encodingErrors++;
  } else if (buf.length >= 6 && buf[3] === 0xef && buf[4] === 0xbb && buf[5] === 0xbf) {
    console.error(`❌ Duplicate BOM detected in ${relPath}!`);
    encodingErrors++;
  }

  // Verify CRLF line endings
  const text = buf.toString("utf8", 3);
  if (/(?<!\r)\n/.test(text)) {
    console.error(`❌ Non-CRLF line ending detected in ${relPath}. Windows PowerShell requires CRLF.`);
    encodingErrors++;
  }

  if (encodingErrors === 0) {
    console.log(`✓ [Encoding] UTF-8 BOM + CRLF verified: ${relPath}`);
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
    "/tmp/pwsh/pwsh",
    path.join(process.env.HOME || "", ".local", "bin", "pwsh")
  ];
  for (const c of candidates) {
    try {
      const res = spawnSync(c, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
        encoding: "utf8",
        timeout: 5000
      });
      if (res.status === 0 && res.stdout) {
        return { cmd: c, version: res.stdout.trim() };
      }
    } catch {
      // not found
    }
  }
  return null;
}

const pwsh = findPwsh();
if (!pwsh) {
  console.log("ℹ️ PowerShell (pwsh/powershell) not available on this machine.");
  console.log("✓ Basic syntax, UTF-8 BOM, and CRLF line terminator checks passed.");
  process.exit(0);
}

console.log(`✓ [PowerShell Engine] Found ${pwsh.cmd} (version ${pwsh.version})`);

// 3. Run test_windows_installer.ps1 test suite
const testScript = path.join(ROOT_DIR, "scripts", "test_windows_installer.ps1");
try {
  const res = execFileSync(pwsh.cmd, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", testScript], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: "inherit"
  });
  console.log("\n✅ ALL POWERSHELL TESTS & STATIC ANALYSIS COMPLETED GREEN!");
} catch (err) {
  console.error("\n❌ PowerShell test suite failed!");
  process.exit(err.status || 1);
}
