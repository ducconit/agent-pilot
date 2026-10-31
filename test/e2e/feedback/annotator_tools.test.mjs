/**
 * Test Suite: Verify Annotator Tool Switching (Pin & Box) and Box Dragging
 */
import path from "node:path";
import { ANNOTATOR_HTTP_PORT, ROOT_DIR, ASSETS_DIR, NAV_WAIT_UNTIL, TIMEOUTS, SEPARATOR } from "../../../scripts/lib/config.mjs";
import { startStaticServer, closeHttpServer, launchExtensionBrowser, sleep } from "../../../scripts/lib/harness.mjs";

async function run() {
  console.log(SEPARATOR);
  console.log("🎯 TEST ANNOTATOR TOOL SWITCHING & BOX DRAGGING");
  console.log(SEPARATOR);

  const server = await startStaticServer(0, ROOT_DIR);
  const httpPort = server.address().port;
  let closeBrowser = null;

  try {
    const launched = await launchExtensionBrowser({ headless: true });
    closeBrowser = launched.close;
    const browser = launched.browser;
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${httpPort}/test-page.html`, { waitUntil: NAV_WAIT_UNTIL });
    await sleep(TIMEOUTS.PAGE_SETTLE_MS);

    // 1. Start Feedback Studio
    console.log("1. Starting Feedback Studio...");
    await page.evaluate(async () => {
      await window.__AGENT_PILOT__.startFeedbackStudio();
    });

    await page.waitForFunction(() => {
      const hud = document.getElementById("agent-pilot-feedback-hud");
      return hud && !hud.classList.contains("hidden");
    }, { timeout: 5000 });

    // 2. Click Màn hình mode on HUD to trigger Annotator
    console.log("2. Clicking '🖥️ Màn hình' to open Annotator modal...");
    await page.evaluate(() => {
      const btn = document.querySelector(".ap-hud-btn[data-mode='screen']");
      if (btn) btn.click();
    });

    await page.waitForFunction(() => {
      const annotator = document.getElementById("agent-pilot-feedback-annotator");
      return annotator && !annotator.classList.contains("hidden");
    }, { timeout: 10000 });

    const annotatorInitialState = await page.evaluate(() => {
      const btnPin = document.getElementById("ap-tool-pin");
      const btnBox = document.getElementById("ap-tool-box");
      return {
        pinActive: btnPin.classList.contains("active"),
        boxActive: btnBox.classList.contains("active")
      };
    });
    console.log("- Annotator initial tools state:", annotatorInitialState);
    if (!annotatorInitialState.pinActive || annotatorInitialState.boxActive) {
      throw new Error("Expected Pin tool to be active by default");
    }

    // 3. Click '⬜ Khung' tool button
    console.log("3. Clicking '⬜ Khung' button...");
    const afterClickBox = await page.evaluate(() => {
      const btnBox = document.getElementById("ap-tool-box");
      btnBox.click();
      const btnPin = document.getElementById("ap-tool-pin");
      return {
        boxActive: btnBox.classList.contains("active"),
        pinActive: btnPin.classList.contains("active")
      };
    });
    console.log("- After clicking Khung:", afterClickBox);
    if (!afterClickBox.boxActive || afterClickBox.pinActive) {
      throw new Error("Clicking Khung failed to activate box tool");
    }

    // 4. Drag on canvas wrapper to draw a box
    console.log("4. Dragging mouse on canvas to draw Box #1...");
    const imgBounds = await page.evaluate(() => {
      const img = document.getElementById("ap-annotator-img");
      const rect = img.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });

    const boxStart = { x: Math.round(imgBounds.left + 80), y: Math.round(imgBounds.top + 80) };
    const boxEnd = { x: Math.round(imgBounds.left + 380), y: Math.round(imgBounds.top + 260) };

    await page.mouse.move(boxStart.x, boxStart.y);
    await page.mouse.down();
    await page.mouse.move(boxEnd.x, boxEnd.y, { steps: 8 });
    await page.mouse.up();

    // Verify SVG box and list entry
    const boxState = await page.evaluate(() => {
      const svg = document.getElementById("ap-annotator-svg");
      const boxSvg = svg.querySelector(".ap-svg-ann-box");
      const list = document.getElementById("ap-pins-list");
      const rows = list.querySelectorAll(".ap-pin-row");
      return {
        hasBoxSvg: Boolean(boxSvg),
        rowsCount: rows.length,
        badgeText: rows[0]?.querySelector(".ap-pin-num")?.textContent.trim(),
        placeholder: rows[0]?.querySelector(".ap-pin-input")?.placeholder
      };
    });
    console.log("- Box #1 verification:", boxState);
    if (!boxState.hasBoxSvg || boxState.rowsCount !== 1) {
      throw new Error("Box #1 was not added properly");
    }

    // Enter comment for Box #1
    await page.evaluate(() => {
      const input = document.querySelector("#ap-pins-list .ap-pin-row[data-idx='0'] .ap-pin-input");
      if (input) {
        input.value = "Khu vực này cần căn lề giữa và tăng độ tương phản";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    // 5. Switch back to '📍 Ghim điểm' and click on canvas to drop Pin #2
    console.log("5. Switching back to '📍 Ghim điểm' and clicking to drop Pin #2...");
    await page.evaluate(() => {
      document.getElementById("ap-tool-pin").click();
    });

    const pinClickPos = { x: Math.round(imgBounds.left + 480), y: Math.round(imgBounds.top + 180) };
    await page.mouse.click(pinClickPos.x, pinClickPos.y);

    const twoAnnotationsState = await page.evaluate(() => {
      const list = document.getElementById("ap-pins-list");
      const rows = list.querySelectorAll(".ap-pin-row");
      return {
        count: rows.length,
        row1Badge: rows[0]?.querySelector(".ap-pin-num")?.textContent.trim(),
        row2Badge: rows[1]?.querySelector(".ap-pin-num")?.textContent.trim()
      };
    });
    console.log("- Dual annotations state (Box #1 + Pin #2):", twoAnnotationsState);
    if (twoAnnotationsState.count !== 2) {
      throw new Error("Expected 2 annotations (1 box + 1 pin)");
    }

    // Enter comment for Pin #2
    await page.evaluate(() => {
      const input = document.querySelector("#ap-pins-list .ap-pin-row[data-idx='1'] .ap-pin-input");
      if (input) {
        input.value = "Nút bấm ở đây bị lệch icon";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    // Take screenshot of Annotator modal with both Box and Pin
    const shotPath = path.join(ASSETS_DIR, "test_annotator_box_and_pin.png");
    await page.screenshot({ path: shotPath });
    console.log(`- Saved annotator verification screenshot to ${shotPath}`);

    // 6. Save annotation and verify Markdown prompt format
    console.log("6. Saving annotator and verifying Prompt formatting...");
    await page.evaluate(() => {
      document.getElementById("ap-annotator-comment").value = "Tổng thể giao diện cần tối ưu hóa";
      document.getElementById("ap-annotator-btn-save").click();
    });

    const promptText = await page.evaluate(async () => {
      const items = await window.__AGENT_PILOT__.getFeedbackItems();
      return await window.__AGENT_PILOT__.generateFeedbackPrompt(items);
    });

    console.log("- Prompt snippet:\n", promptText.slice(promptText.indexOf("Các điểm & khung đánh dấu"), promptText.indexOf("Yêu cầu chỉnh sửa")));

    if (!promptText.includes("⬜ Khung #1") || !promptText.includes("📍 Điểm #2")) {
      throw new Error("Prompt does not format both Box and Pin correctly");
    }

    console.log(SEPARATOR);
    console.log("🎉 ALL ANNOTATOR TOOL SWITCHING & BOX TESTS PASSED (100%)!");
    console.log(SEPARATOR);
  } finally {
    // Always close the browser and server, then report via exitCode.
    if (closeBrowser) await closeBrowser();
    await closeHttpServer(server);
  }
}

run().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exitCode = 1;
});
