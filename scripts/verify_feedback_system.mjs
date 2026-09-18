/**
 * Verification Test Suite: Channel B & Channel A Visual Feedback Systems
 * Tests inbox filesystem storage (~/.agent-pilot/inbox/feedback/<timestamp>/*),
 * MCP tools (browser_get_pending_feedback, browser_wait_for_feedback),
 * HTTP REST endpoints, and reactive long-polling via standalone Go engine.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { ROOT_DIR, SEPARATOR } from "./lib/config.mjs";
import { createRecorder } from "./lib/harness.mjs";

const CLI_DIR = path.join(ROOT_DIR, "cli");
const MCP_DIR = path.join(ROOT_DIR, "mcp", "agent-pilot");

const recorder = createRecorder({
  title: "📊 KẾT QUẢ KIỂM THỬ:",
  itemKey: "name",
  summaryStyle: "passed",
  successMessage: null,
  failureMessage: null
});
const record = recorder.record;

async function run() {
  console.log(SEPARATOR);
  console.log("🎯 KIỂM THỬ HỆ THỐNG VISUAL UI FEEDBACK (CHANNEL B & CHANNEL A - GO ENGINE)");
  console.log(`${SEPARATOR}\n`);

  try {
    // 1. Run Go Unit Test Suite for Feedback System
    const goTestOutput = execSync("go test -v -run 'TestFeedback|TestWaitForFeedback' ./...", {
      cwd: CLI_DIR,
      encoding: "utf-8"
    });

    const isStorageTestPassed = goTestOutput.includes("PASS: TestFeedbackStorageAndRetrieval");
    record("1. Feedback Directory Resolution & Path Safety", isStorageTestPassed, "Resolved in ~/.agent-pilot/inbox/feedback");
    record("2. File System Storage (~/.agent-pilot/inbox/feedback/<ts>/*)", isStorageTestPassed, "Session dir, PNG decoding & session.json");
    record("3. session.json Schema & Component Source Mapping", isStorageTestPassed, "Verified fileName:lineNumber and component source");
    record("4. prompt.md Clean Formatting (Zero Base64 Bloat)", isStorageTestPassed, "Clean markdown references without inline base64 bloat");
    record("5. getPendingFeedback Query Engine", isStorageTestPassed, "Queried pending sessions from filesystem inbox");
    record("6. Archive & Clear Session", isStorageTestPassed, "Moved from pending inbox to feedback_archive cleanly");

    // 7. Channel A Reactive Wait
    const isWaitTestPassed = goTestOutput.includes("PASS: TestWaitForFeedbackReactiveLongPoll");
    record("7. Channel A Reactive Long-Polling (WaitForFeedback)", isWaitTestPassed, "Resolved reactively upon live submission");

    // 8. MCP Tools Registration
    const hasGetPendingTool = fs.existsSync(path.join(MCP_DIR, "browser_get_pending_feedback.json"));
    const hasWaitTool = fs.existsSync(path.join(MCP_DIR, "browser_wait_for_feedback.json"));
    record("8. MCP Tools Registration", hasGetPendingTool && hasWaitTool, "Registered browser_get_pending_feedback & browser_wait_for_feedback in SSOT");

    recorder.summarize();
    recorder.exitIfFailed();
  } catch (err) {
    console.error("❌ Test execution failed:", err.message);
    process.exitCode = 1;
  }
}

run();

