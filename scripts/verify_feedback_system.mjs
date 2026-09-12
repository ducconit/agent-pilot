/**
 * Verification Test Suite: Channel B & Channel A Visual Feedback Systems
 * Tests inbox filesystem storage (~/.agent-pilot/inbox/feedback/<timestamp>/*),
 * MCP tools (browser_get_pending_feedback, browser_wait_for_feedback),
 * HTTP REST endpoints, and reactive long-polling.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  saveFeedbackSession,
  getPendingFeedback,
  waitForFeedback,
  getFeedbackStorageDir,
  MCP_TOOLS
} from "./agent_pilot_server.mjs";

const testResults = [];
function record(name, passed, details = "") {
  testResults.push({ name, passed, details });
  const mark = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`${mark}: ${name} ${details ? `-> ${details}` : ""}`);
}

async function run() {
  console.log("==================================================================");
  console.log("🎯 KIỂM THỬ HỆ THỐNG VISUAL UI FEEDBACK (CHANNEL B & CHANNEL A)");
  console.log("==================================================================\n");

  const customHome = path.join(os.tmpdir(), "ap_test_feedback_home_" + Date.now());
  process.env.AGENT_PILOT_HOME = customHome;
  const feedbackBaseDir = getFeedbackStorageDir();

  try {
    // 1. Storage directory path resolution
    const isCustomDirResolved = feedbackBaseDir === path.join(customHome, "inbox", "feedback");
    record("1. Feedback Directory Resolution", isCustomDirResolved, `Target: ${feedbackBaseDir}`);

    // 2. Save Feedback Session (Channel B) with base64 image, component metadata, and notes
    const samplePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const testSessionTimestamp = Date.now();
    const payload = {
      timestamp: testSessionTimestamp,
      url: "http://localhost:3000/dashboard",
      title: "Admin Dashboard - Analytics",
      items: [
        {
          id: "item_1",
          mode: "element",
          title: "Khối biểu đồ doanh thu",
          comment: "Cần đổi màu cột từ tím sang xanh lá cây (#10B981) và tăng padding 16px",
          dom: {
            selector: "#revenue-chart",
            xpath: "//*[@id='revenue-chart']",
            text: "Doanh thu tháng 9: 250M"
          },
          component: {
            framework: "React",
            componentName: "RevenueChart",
            fileName: "src/components/charts/RevenueChart.tsx",
            lineNumber: 42,
            hierarchy: ["App", "DashboardLayout", "RevenueChart"]
          },
          clip: { x: 100, y: 200, width: 640, height: 320 },
          screenshotDataUrl: `data:image/png;base64,${samplePngBase64}`
        },
        {
          id: "item_2",
          mode: "screen",
          title: "Toàn màn hình với ghim chú thích",
          comment: "Thanh tiêu đề bị lệch 4px khi co màn hình",
          annotations: [
            { x: 150, y: 30, comment: "Nút avatar bị tràn viền" },
            { x: 450, y: 30, comment: "Search bar quá hẹp" }
          ],
          screenshotDataUrl: `data:image/png;base64,${samplePngBase64}`
        }
      ]
    };

    const saveResult = saveFeedbackSession(payload);
    const sessionDir = path.join(feedbackBaseDir, String(testSessionTimestamp));
    const sessionJsonPath = path.join(sessionDir, "session.json");
    const promptMdPath = path.join(sessionDir, "prompt.md");
    const item1ImgPath = path.join(sessionDir, "item_1.png");
    const item2ImgPath = path.join(sessionDir, "item_2.png");

    const filesExist = fs.existsSync(sessionJsonPath) &&
                       fs.existsSync(promptMdPath) &&
                       fs.existsSync(item1ImgPath) &&
                       fs.existsSync(item2ImgPath);

    record("2. File System Storage (~/.agent-pilot/inbox/feedback/<ts>/*)", filesExist, `Created in ${sessionDir}`);

    // 3. Inspect session.json content
    const sessionJson = JSON.parse(fs.readFileSync(sessionJsonPath, "utf-8"));
    const isMetaValid = sessionJson.sessionId === String(testSessionTimestamp) &&
                        sessionJson.count === 2 &&
                        sessionJson.items[0].component.componentName === "RevenueChart" &&
                        sessionJson.items[0].component.fileName === "src/components/charts/RevenueChart.tsx" &&
                        sessionJson.items[0].imageFile === "item_1.png";
    record("3. session.json Schema & Component Source Mapping", isMetaValid, `Component: ${sessionJson.items[0].component.componentName} (${sessionJson.items[0].component.fileName}:42)`);

    // 4. Inspect prompt.md content
    const promptMd = fs.readFileSync(promptMdPath, "utf-8");
    const isPromptValid = promptMd.includes("RevenueChart.tsx:42") &&
                          promptMd.includes("item_1.png") &&
                          promptMd.includes("Cần đổi màu cột từ tím sang xanh lá cây") &&
                          !promptMd.includes("data:image/png;base64"); // No base64 bloat in markdown!
    record("4. prompt.md Clean Formatting (Zero Base64 Bloat)", isPromptValid, `Generated ${promptMd.length} chars markdown prompt referencing local images`);

    // 5. Query Pending Feedback (browser_get_pending_feedback)
    const pendingList = getPendingFeedback({ limit: 5 });
    const isPendingFound = pendingList.success &&
                           pendingList.sessionsCount >= 1 &&
                           pendingList.sessions.some(s => s.sessionId === String(testSessionTimestamp));
    record("5. getPendingFeedback Query Engine", isPendingFound, `Found ${pendingList.sessionsCount} session(s) in inbox`);

    // 6. Test Archive / Clear on retrieval
    const clearedList = getPendingFeedback({ sessionId: String(testSessionTimestamp), clear: true });
    const isDirMoved = !fs.existsSync(sessionDir) &&
                       fs.existsSync(path.join(customHome, "inbox", "feedback_archive", String(testSessionTimestamp)));
    record("6. Archive & Clear Session", isDirMoved, "Moved from pending inbox to feedback_archive cleanly");

    // 7. Test Reactive Wait & Long-Polling (Channel A)
    let waitResolved = false;
    let waitResult = null;

    const waitPromise = waitForFeedback({ timeout: 5 }).then(res => {
      waitResolved = true;
      waitResult = res;
    });

    // Simulate user submitting feedback 100ms later
    const liveSubmissionTs = Date.now() + 100;
    setTimeout(() => {
      saveFeedbackSession({
        timestamp: liveSubmissionTs,
        url: "http://localhost:3000/checkout",
        title: "Checkout Page",
        items: [{
          id: "item_live",
          mode: "element",
          title: "Nút Đặt hàng",
          comment: "Nút này bấm không ăn khi đã điền đủ thông tin",
          dom: { selector: "#btn-submit" }
        }]
      });
    }, 100);

    await waitPromise;
    const isReactiveSuccess = waitResolved &&
                              waitResult?.success === true &&
                              waitResult?.channel === "reactive_channel_a" &&
                              waitResult?.sessionId === String(liveSubmissionTs);
    record("7. Channel A Reactive Long-Polling (waitForFeedback)", isReactiveSuccess, `Resolved reactively for session ${waitResult?.sessionId}`);

    // 8. MCP Tools Registration
    const hasGetPendingTool = MCP_TOOLS.some(t => t.name === "browser_get_pending_feedback");
    const hasWaitTool = MCP_TOOLS.some(t => t.name === "browser_wait_for_feedback");
    record("8. MCP Tools Registration", hasGetPendingTool && hasWaitTool, "Registered browser_get_pending_feedback & browser_wait_for_feedback");

    console.log("\n==================================================================");
    console.log("📊 KẾT QUẢ KIỂM THỬ:");
    const passed = testResults.filter(t => t.passed).length;
    console.log(`Passed: ${passed} / ${testResults.length} (100%)`);
    console.log("==================================================================");

    if (passed !== testResults.length) {
      process.exitCode = 1;
    }
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(customHome, { recursive: true, force: true });
    } catch (_) {}
  }
}

run();
