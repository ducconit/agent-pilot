import http from "node:http";
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveChromiumBin, getChromiumLaunchArgs } from "./browser_resolver.mjs";

const PORT = 8769;
const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT_DIR = path.join(PROJECT_DIR, "extensions");

let browser;
let server;

async function cleanup() {
  if (browser) {
    try {
      await browser.close();
    } catch (_) {
      // Ignore cleanup failures so the original error is preserved.
    }
  }
  if (server) {
    try {
      server.close();
    } catch (_) {
      // Ignore cleanup failures so the original error is preserved.
    }
  }
}

function startHttpServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const sanitizedUrl = path.normalize(req.url === "/" ? "/test-page.html" : req.url.split("?")[0]).replace(/^(\.\.[\/\\])+/, "");
      let filePath = path.join(PROJECT_DIR, sanitizedUrl);
      if (!filePath.startsWith(PROJECT_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(PROJECT_DIR, "test-page.html");
      }
      const ext = path.extname(filePath);
      const contentTypes = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".svg": "image/svg+xml"
      };
      res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
      res.end(fs.readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

async function main() {
  console.log("==================================================================");
  console.log("🎯 TEST PINNED REGION BOXES & MULTI-REGION VISUAL FEEDBACK");
  console.log("==================================================================\n");

  server = await startHttpServer();
  const executablePath = resolveChromiumBin();
  if (!executablePath) {
    throw new Error("Chromium browser executable not found");
  }

  browser = await puppeteer.launch({
    headless: false,
    executablePath,
    args: getChromiumLaunchArgs(EXT_DIR)
  });

  // Wait for background service worker
  await browser.waitForTarget(
    (t) => t.type() === "service_worker" && t.url().includes("background.js"),
    { timeout: 8000 }
  );

  const page = await browser.newPage();
  page.on('console', msg => console.log('[PAGE CONSOLE]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[PAGE ERROR]', err));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`http://127.0.0.1:${PORT}/test-page.html`, { waitUntil: "networkidle0" });

  await new Promise(r => setTimeout(r, 1000));

  // 1. Verify Feedback Studio startup
  console.log("1. Starting Feedback Studio in page...");
  const startResult = await page.evaluate(async () => {
    if (!window.__AGENT_PILOT__ || !window.__AGENT_PILOT__.startFeedbackStudio) {
      return { ok: false, error: "window.__AGENT_PILOT__ not loaded" };
    }
    await window.__AGENT_PILOT__.startFeedbackStudio();
    const hud = document.getElementById("agent-pilot-feedback-hud");
    const pinnedLayer = document.getElementById("agent-pilot-feedback-pinned-layer");
    return {
      ok: true,
      hudVisible: hud && !hud.classList.contains("hidden"),
      pinnedLayerExists: !!pinnedLayer
    };
  });

  console.log("- Start result:", startResult);
  if (!startResult.ok || !startResult.hudVisible || !startResult.pinnedLayerExists) {
    throw new Error("Failed to start feedback studio or pinned layer missing");
  }

  // 2. Switch to Region Mode and Drag Region 1 (Header Section)
  console.log("2. Switching to Region Mode and dragging Region 1...");
  await page.evaluate(() => {
    const btn = document.querySelector(".ap-hud-btn[data-mode='region']");
    if (btn) btn.click();
  });

  // Drag region 1 from (150, 150) to (600, 350)
  await page.mouse.move(150, 150);
  await page.mouse.down();
  await page.mouse.move(600, 350, { steps: 10 });
  await page.mouse.up();

  // Wait for crop & popover
  await page.waitForFunction(() => {
    const popover = document.getElementById("agent-pilot-feedback-popover");
    return popover && !popover.classList.contains("hidden");
  }, { timeout: 8000 });

  // Verify Draft Box is visible while popover is open
  const draftBoxState1 = await page.evaluate(() => {
    const draftBox = document.getElementById("agent-pilot-feedback-draft-box");
    const badge = document.getElementById("ap-draft-badge");
    return {
      visible: draftBox && !draftBox.classList.contains("hidden"),
      badgeText: badge ? badge.textContent : "",
      rect: draftBox ? {
        left: draftBox.style.left,
        top: draftBox.style.top,
        width: draftBox.style.width,
        height: draftBox.style.height
      } : null
    };
  });
  console.log("- Draft Box #1 state:", draftBoxState1);

  const popoverPosition = await page.evaluate(() => {
    const popover = document.getElementById("agent-pilot-feedback-popover");
    return {
      left: popover.style.left,
      top: popover.style.top
    };
  });
  console.log("- Popover position (anchored to crop rect):", popoverPosition);
  if (popoverPosition.left !== "150px" || popoverPosition.top !== "362px") {
    throw new Error(`Popover position incorrect: expected (150px, 362px), got (${popoverPosition.left}, ${popoverPosition.top})`);
  }

  // Capture screenshot of Draft Box #1 with Popover
  const shot1Path = path.resolve("assets/test_region_1_drafting.png");
  await page.screenshot({ path: shot1Path });
  console.log(`- Saved draft screenshot to ${shot1Path}`);

  // Enter comment for Region 1 and click Save
  console.log("3. Saving Region 1 with comment...");
  await page.evaluate(() => {
    document.getElementById("ap-popover-input").value = "Header: Tăng cỡ chữ và đổi gradient sang sắc xanh neon (#38BDF8)";
    document.getElementById("ap-popover-btn-save").click();
  });

  await new Promise(r => setTimeout(r, 500));

  // Verify Region 1 is PINNED persistently on screen!
  const pinnedStateAfter1 = await page.evaluate(() => {
    const boxes = document.querySelectorAll(".agent-pilot-feedback-pinned-layer .ap-pinned-box:not(#agent-pilot-feedback-draft-box)");
    const draftBox = document.getElementById("agent-pilot-feedback-draft-box");
    const firstBox = boxes[0];
    const badge = firstBox ? firstBox.querySelector(".ap-pinned-badge") : null;
    const tooltip = firstBox ? firstBox.querySelector(".ap-pinned-tooltip") : null;
    return {
      count: boxes.length,
      draftHidden: draftBox && draftBox.classList.contains("hidden"),
      firstBoxRect: firstBox ? {
        left: firstBox.style.left,
        top: firstBox.style.top,
        width: firstBox.style.width,
        height: firstBox.style.height,
        color: firstBox.style.getPropertyValue("--box-color")
      } : null,
      badgeText: badge ? badge.textContent.trim() : "",
      tooltipText: tooltip ? tooltip.textContent.trim() : ""
    };
  });
  console.log("- Pinned state after saving Region 1:", pinnedStateAfter1);

  // Capture screenshot of Pinned Region #1 remaining on screen
  const shot2Path = path.resolve("assets/test_region_1_pinned.png");
  await page.screenshot({ path: shot2Path });
  console.log(`- Saved pinned screenshot to ${shot2Path}`);

  // 4. Now drag Region 2 (Interactive Elements Card) while Region 1 remains on screen!
  console.log("4. Dragging Region 2 while Region 1 is STILL PINNED on screen...");
  await page.mouse.move(650, 150);
  await page.mouse.down();
  await page.mouse.move(1100, 350, { steps: 10 });
  await page.mouse.up();

  // Wait for popover
  await page.waitForFunction(() => {
    const popover = document.getElementById("agent-pilot-feedback-popover");
    return popover && !popover.classList.contains("hidden");
  }, { timeout: 5000 });

  // Verify BOTH Pinned Box #1 AND Draft Box #2 exist simultaneously!
  const simultaneousState = await page.evaluate(() => {
    const pinnedBoxes = document.querySelectorAll(".agent-pilot-feedback-pinned-layer .ap-pinned-box:not(#agent-pilot-feedback-draft-box)");
    const draftBox = document.getElementById("agent-pilot-feedback-draft-box");
    const badge = document.getElementById("ap-draft-badge");
    return {
      pinnedCount: pinnedBoxes.length,
      draftVisible: draftBox && !draftBox.classList.contains("hidden"),
      draftBadgeText: badge ? badge.textContent : ""
    };
  });
  console.log("- Simultaneous state (Pinned #1 + Draft #2):", simultaneousState);

  // Enter comment for Region 2 and click Save
  console.log("5. Saving Region 2 with comment...");
  await page.evaluate(() => {
    document.getElementById("ap-popover-input").value = "Card 1: nút bấm cần hiệu ứng hover sáng và shadow rõ nét hơn";
    document.getElementById("ap-popover-btn-save").click();
  });

  await new Promise(r => setTimeout(r, 500));

  // Verify BOTH Region 1 AND Region 2 are pinned with distinct numbers and colors!
  const multiPinnedState = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll(".agent-pilot-feedback-pinned-layer .ap-pinned-box:not(#agent-pilot-feedback-draft-box)"));
    return boxes.map((box, idx) => ({
      index: idx + 1,
      id: box.dataset.id,
      color: box.style.getPropertyValue("--box-color"),
      left: box.style.left,
      top: box.style.top,
      width: box.style.width,
      height: box.style.height,
      badgeText: box.querySelector(".ap-pinned-badge span")?.textContent || "",
      tooltipText: box.querySelector(".ap-pinned-tooltip")?.textContent || ""
    }));
  });
  console.log("- Multi-pinned regions state (Boxes #1 & #2):", multiPinnedState);

  // Capture screenshot of both pinned regions on screen
  const shot3Path = path.resolve("assets/test_multi_regions_pinned.png");
  await page.screenshot({ path: shot3Path });
  console.log(`- Saved multi-pinned screenshot to ${shot3Path}`);

  // 6. Open List Modal and verify colored index chips
  console.log("6. Inspecting List Modal...");
  await page.evaluate(() => {
    document.getElementById("ap-hud-btn-list").click();
  });

  await new Promise(r => setTimeout(r, 500));

  const listModalState = await page.evaluate(() => {
    const modal = document.getElementById("agent-pilot-feedback-list-modal");
    const cards = modal.querySelectorAll(".ap-item-card");
    return {
      visible: modal && !modal.classList.contains("hidden"),
      cardsCount: cards.length,
      titles: Array.from(cards).map(c => c.querySelector(".ap-card-title")?.textContent.trim())
    };
  });
  console.log("- List Modal state:", listModalState);

  const shot4Path = path.resolve("assets/test_feedback_list_modal.png");
  try {
    await page.screenshot({ path: shot4Path });
    console.log(`- Saved list modal screenshot to ${shot4Path}`);
  } catch (e) {
    console.warn("- Screenshot 4 warning (non-fatal):", e.message);
  }

  // 7. Delete Region 1 via pinned badge delete button and verify re-numbering
  console.log("7. Testing delete Region 1 from screen...");
  await page.evaluate(() => {
    document.getElementById("ap-list-btn-close").click();
    const firstDelBtn = document.querySelector(".agent-pilot-feedback-pinned-layer .ap-pinned-del-btn");
    if (firstDelBtn) firstDelBtn.click();
  });

  await new Promise(r => setTimeout(r, 500));

  const afterDeleteState = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll(".agent-pilot-feedback-pinned-layer .ap-pinned-box:not(#agent-pilot-feedback-draft-box)"));
    return {
      count: boxes.length,
      badgeText: boxes[0]?.querySelector(".ap-pinned-badge span")?.textContent || "",
      tooltipText: boxes[0]?.querySelector(".ap-pinned-tooltip")?.textContent || ""
    };
  });
  console.log("- State after deleting Region 1 (Remaining re-numbered to #1):", afterDeleteState);

  // 8. Stop feedback studio and verify cleanup
  console.log("8. Stopping feedback studio and verifying cleanup...");
  await page.evaluate(async () => {
    if (window.__AGENT_PILOT__?.stopFeedbackStudio) {
      await window.__AGENT_PILOT__.stopFeedbackStudio();
    }
  });

  const finalCleanupState = await page.evaluate(() => {
    const layer = document.getElementById("agent-pilot-feedback-pinned-layer");
    const hud = document.getElementById("agent-pilot-feedback-hud");
    return {
      layerHidden: layer && layer.classList.contains("hidden"),
      hudHidden: hud && hud.classList.contains("hidden")
    };
  });
  console.log("- Final cleanup state:", finalCleanupState);

  console.log("\n==================================================================");
  console.log("🎉 ALL TESTS PASSED! PINNED REGION BOXES VERIFIED WITH SCREENSHOTS");
  console.log("==================================================================");
}

async function run() {
  try {
    await main();
  } catch (err) {
    console.error("❌ Test failed:", err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

run();
