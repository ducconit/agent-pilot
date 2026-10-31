#!/usr/bin/env node
/**
 * Agent Pilot - Unified Test Runner (Group-Aware)
 *
 * Supports running tests by group, individual file, or full suite:
 *
 * Groups:
 *   - node test/runner.mjs unit              # All 7 unit test files
 *   - node test/runner.mjs unit:security     # Secret sanitizer & XSS schema
 *   - node test/runner.mjs unit:core         # Background API, color utils, recorder
 *   - node test/runner.mjs unit:harness      # Launch Chrome & harness cleanup
 *   - node test/runner.mjs core              # Core browser control & lifecycle (E2E)
 *   - node test/runner.mjs bridge            # AI Agent WebSocket bridge (E2E)
 *   - node test/runner.mjs feedback          # Feedback Studio & annotations (E2E)
 *   - node test/runner.mjs devtools          # DevTools, heap profiler & packaged runtime (E2E)
 *   - node test/runner.mjs protocols         # WebMCP & PWA adapter (E2E)
 *   - node test/runner.mjs platform          # PowerShell installer verification
 *
 * Suites:
 *   - node test/runner.mjs e2e               # 16-feature core E2E suite
 *   - node test/runner.mjs all               # Go CLI + Unit + Core E2E
 *   - node test/runner.mjs <path-to-test>    # Single test file
 *
 * Automatically wraps headful browser tests in `xvfb-run -a` on Linux when running
 * in a headless/CI environment without DISPLAY.
 * Propagates non-zero exit codes immediately upon failure.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const TEST_DIR = path.resolve(ROOT_DIR, "test");

const SEPARATOR = "==================================================================";

const TEST_GROUPS = Object.freeze({
  "unit:security": [
    "test/unit/security/secret_sanitizer.test.mjs",
    "test/unit/security/feedback_item_xss.test.mjs"
  ],
  "unit:core": [
    "test/unit/core/background_api.test.mjs",
    "test/unit/core/color_utils.test.mjs",
    "test/unit/core/recorder_regressions.test.mjs"
  ],
  "unit:harness": [
    "test/unit/harness/launch_chrome.test.mjs",
    "test/unit/harness/harness_cleanup.test.mjs"
  ],
  get unit() {
    return [
      ...this["unit:security"],
      ...this["unit:core"],
      ...this["unit:harness"]
    ];
  },
  core: [
    "test/e2e/core/all_features.test.mjs",
    "test/e2e/core/extension_lifecycle.test.mjs",
    "test/e2e/core/tab_group_isolation.test.mjs",
    "test/e2e/core/session_lifecycle.test.mjs"
  ],
  bridge: [
    "test/e2e/bridge/agent_connection.test.mjs",
    "test/e2e/bridge/live_artifact.test.mjs"
  ],
  feedback: [
    "test/e2e/feedback/feedback_system.test.mjs",
    "test/e2e/feedback/annotator_tools.test.mjs",
    "test/e2e/feedback/pinned_regions.test.mjs",
    "test/e2e/feedback/feedback_edit_delete.test.mjs"
  ],
  devtools: [
    "test/e2e/devtools/devtools.test.mjs",
    "test/e2e/devtools/heap_analysis.test.mjs",
    "test/e2e/devtools/packaged_devtools.test.mjs"
  ],
  protocols: [
    "test/e2e/protocols/webmcp.test.mjs",
    "test/e2e/protocols/pwa_adapter.test.mjs"
  ],
  platform: [
    "test/platform/powershell.test.mjs"
  ]
});

const E2E_CORE = "test/e2e/core/all_features.test.mjs";

function resolveScriptPath(rawArg) {
  let resolved;
  if (path.isAbsolute(rawArg)) {
    resolved = path.normalize(rawArg);
  } else {
    const fromRoot = path.resolve(ROOT_DIR, rawArg);
    if (fs.existsSync(fromRoot)) {
      resolved = fromRoot;
    } else {
      const fromTest = path.resolve(TEST_DIR, rawArg);
      resolved = fs.existsSync(fromTest) ? fromTest : fromRoot;
    }
  }

  // Security Guard: Prevent path traversal outside project root
  const relative = path.relative(ROOT_DIR, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    console.error(`❌ Security Violation: Path traversal outside project root is prohibited: ${rawArg}`);
    return null;
  }
  return resolved;
}

function runCommand(cmd, args, { stdio = "inherit", env = process.env } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT_DIR,
    stdio,
    env
  });
  if (result.error) {
    console.error(`❌ Failed to execute ${cmd} ${args.join(" ")}: ${result.error.message}`);
    return 1;
  }
  if (result.signal) {
    const sigMap = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
    return sigMap[result.signal] || 1;
  }
  return result.status ?? 0;
}

function runSingleTest(scriptPath, extraArgs = []) {
  const absPath = resolveScriptPath(scriptPath);
  if (!absPath) {
    return 1;
  }
  if (!fs.existsSync(absPath)) {
    console.error(`❌ Test script not found: ${absPath}`);
    return 1;
  }

  const isUnitTest = absPath.includes(path.sep + "unit" + path.sep) ||
    /verify_(secret_sanitizer|feedback_item_xss|background_api|color_utils|recorder_regressions)\.mjs$/.test(absPath);
  const isPlatformTest = absPath.includes(path.sep + "platform" + path.sep) ||
    absPath.endsWith("run_powershell_tests.mjs") ||
    absPath.endsWith("test_harness_cleanup.mjs") ||
    absPath.endsWith("test_launch_test_chrome.mjs");
  const isBrowserTest = !isUnitTest && !isPlatformTest && (absPath.includes(path.sep + "e2e" + path.sep) || absPath.includes("verify_"));
  const isNodeTest = absPath.endsWith("recorder_regressions.test.mjs") || absPath.endsWith("verify_recorder_regressions.mjs");

  let cmd = "node";
  let args = isNodeTest ? ["--test", absPath, ...extraArgs] : [absPath, ...extraArgs];

  // Wrap with xvfb-run on Linux only when headless and running an e2e/browser test
  if (process.platform === "linux" && isBrowserTest && !process.env.DISPLAY) {
    let hasXvfb = false;
    try {
      const check = spawnSync("command -v xvfb-run", { shell: true, stdio: "ignore" });
      hasXvfb = check.status === 0;
    } catch (_) {}

    if (hasXvfb) {
      cmd = "xvfb-run";
      args = ["-a", "node", ...(isNodeTest ? ["--test"] : []), absPath, ...extraArgs];
    }
  }

  return runCommand(cmd, args);
}

function runTestGroup(groupName, fileList, extraArgs = [], { bail = true, filter = null } = {}) {
  let targetFiles = fileList;
  if (filter) {
    targetFiles = fileList.filter(f => f.toLowerCase().includes(filter.toLowerCase()));
    if (targetFiles.length === 0) {
      console.warn(`⚠️ Không có file nào trong nhóm [${groupName}] khớp filter: "${filter}"`);
      return 0;
    }
  }

  console.log(SEPARATOR);
  console.log(`📦 CHẠY NHÓM KIỂM THỬ: [${groupName.toUpperCase()}] (${targetFiles.length} files)`);
  console.log(`${SEPARATOR}\n`);

  let passed = 0;
  let failed = 0;
  let lastFailCode = 0;

  for (let i = 0; i < targetFiles.length; i++) {
    const fileRel = targetFiles[i];
    const fileName = path.basename(fileRel);
    console.log(`\n▶ [${i + 1}/${targetFiles.length}] Đang chạy: ${fileRel}...`);
    const status = runSingleTest(fileRel, extraArgs);
    if (status !== 0) {
      console.error(`\n❌ THẤT BẠI: ${fileName} kết thúc với mã lỗi ${status}`);
      failed++;
      lastFailCode = status;
      if (bail) {
        return status;
      }
    } else {
      passed++;
    }
  }

  console.log(`\n${SEPARATOR}`);
  if (failed === 0) {
    console.log(`📊 TỔNG KẾT NHÓM [${groupName.toUpperCase()}]: ${passed}/${targetFiles.length} files passed (100%)`);
  } else {
    console.error(`📊 TỔNG KẾT NHÓM [${groupName.toUpperCase()}]: ${passed} passed, ${failed} failed (${targetFiles.length} files)`);
  }
  console.log(SEPARATOR);
  return failed > 0 ? lastFailCode : 0;
}

function printHelp() {
  console.log(`
Agent Pilot Unified Test Runner
Usage:
  node test/runner.mjs [target] [options...]

Targets:
  (omitted)          Run the default Core E2E verification suite
  all                Run complete test matrix (Go CLI + JS Unit + Core E2E)
  <group>            Run a predefined group of test suites:
                     • unit            All 7 unit and security test suites
                     • unit:security   Security filters (secret sanitizer & XSS)
                     • unit:core       Core modules (background API, color utils, recorder)
                     • unit:harness    Harness lifecycle & cleanup
                     • core            Core E2E (all features, session & tab isolation)
                     • bridge          AI Agent bridge & WebSocket port 58765
                     • feedback        Visual UI feedback studio & annotations
                     • devtools        DevTools CDP, heap analysis & packaged runtime
                     • protocols       WebMCP & PWA adapter
                     • platform        PowerShell scripts syntax & encoding
  <file_path>        Run an individual test script by relative or absolute path

Options:
  --group <name>     Specify target test group explicitly
  --filter <str>     Filter test files in group matching substring
  --bail             Stop on first failed test (default)
  --no-bail          Continue running all tests in group despite failures
  --help, -h         Show this help message and exit
`);
}

// Trap signals for clean exit codes
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    const code = 128 + (sig === "SIGINT" ? 2 : sig === "SIGTERM" ? 15 : 1);
    process.exit(code);
  });
}

// CLI argument parsing
let target = null;
let bail = true;
let filter = null;
const extraArgs = [];

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--help" || arg === "-h" || arg === "help") {
    printHelp();
    process.exit(0);
  } else if (arg === "--bail") {
    bail = true;
  } else if (arg === "--no-bail") {
    bail = false;
  } else if (arg === "--filter") {
    filter = process.argv[++i];
  } else if (arg.startsWith("--filter=")) {
    filter = arg.slice(9);
  } else if (arg === "--group") {
    target = process.argv[++i];
  } else if (arg.startsWith("--group=")) {
    target = arg.slice(8);
  } else if (!target && !arg.startsWith("-")) {
    target = arg;
  } else {
    extraArgs.push(arg);
  }
}

if (!target) {
  // Default: core 16-feature suite
  const exitCode = runSingleTest(E2E_CORE, extraArgs);
  process.exit(exitCode);
} else if (target === "e2e") {
  const exitCode = runSingleTest(E2E_CORE, extraArgs);
  process.exit(exitCode);
} else if (target === "all") {
  console.log("\n🚀 Bắt đầu chạy toàn bộ test suites (CLI + Unit + Core E2E)...\n");

  console.log("1. Chạy Go CLI Unit Tests...");
  const goStatus = runCommand("go", ["test", "-race", "-v", "./..."]);
  if (goStatus !== 0) {
    console.error("❌ Go CLI tests failed");
    process.exit(goStatus);
  }

  console.log("\n2. Chạy JavaScript Unit Tests...");
  const unitStatus = runTestGroup("unit", TEST_GROUPS.unit, extraArgs, { bail, filter });
  if (unitStatus !== 0) process.exit(unitStatus);

  console.log("\n3. Chạy Core E2E Verification Suite...");
  const e2eStatus = runSingleTest(E2E_CORE, extraArgs);
  process.exit(e2eStatus);
} else if (Object.hasOwn(TEST_GROUPS, target)) {
  // Group name matched
  const exitCode = runTestGroup(target, TEST_GROUPS[target], extraArgs, { bail, filter });
  process.exit(exitCode);
} else {
  // Single test script path
  const exitCode = runSingleTest(target, extraArgs);
  process.exit(exitCode);
}
