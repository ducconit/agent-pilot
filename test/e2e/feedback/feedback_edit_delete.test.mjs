import path from "node:path";
import { EDIT_DELETE_HTTP_PORT, ROOT_DIR, ASSETS_DIR, NAV_WAIT_UNTIL, TIMEOUTS, SEPARATOR } from "../../../scripts/lib/config.mjs";
import {
  startStaticServer,
  closeHttpServer,
  launchExtensionBrowser,
  waitForServiceWorker,
  extensionIdFromTarget,
  sleep
} from "../../../scripts/lib/harness.mjs";

async function run() {
  console.log(SEPARATOR);
  console.log("🎯 TEST FEEDBACK ITEM EDIT & DELETE (IN-PAGE & SIDE PANEL)");
  console.log(SEPARATOR);

  const server = await startStaticServer(0, ROOT_DIR);
  const httpPort = server.address().port;
  let closeBrowser = null;

  try {
    const launched = await launchExtensionBrowser();
    closeBrowser = launched.close;
    const browser = launched.browser;
    const swTarget = await waitForServiceWorker(browser, { timeoutMs: TIMEOUTS.SERVICE_WORKER_MS });
    if (!swTarget) throw new Error("Timed out waiting for the extension service worker");
    const extId = extensionIdFromTarget(swTarget);
    console.log("Extension ID:", extId);

    // 1. Open Web Page
    const page = await browser.newPage();
    page.on("console", msg => console.log("[Page console]", msg.text()));
    await page.goto(`http://127.0.0.1:${httpPort}/test-page.html`, { waitUntil: NAV_WAIT_UNTIL });
    await page.setViewport({ width: 1200, height: 800 });

    // 2. Open Sidepanel
    const sidepanelPage = await browser.newPage();
    sidepanelPage.on("console", msg => console.log("[Sidepanel console]", msg.text()));
    await sidepanelPage.setViewport({ width: 360, height: 750 });
    await sidepanelPage.goto(`chrome-extension://${extId}/sidepanel.html`);

    // Bring web page to focus
    await page.bringToFront();

    // 3. Start Feedback Studio in page
    console.log("1. Starting Feedback Studio on page...");
    await page.evaluate(async () => {
      await window.__AGENT_PILOT__.startFeedbackStudio();
    });
    await page.waitForFunction(() => {
      const hud = document.getElementById("agent-pilot-feedback-hud");
      return hud && !hud.classList.contains("hidden");
    }, { timeout: 5000 });

    // 4. Select an element on page
    console.log("2. Selecting Element on page (#btn-sample-click)...");
    const targetBox = await page.$eval("#btn-sample-click", el => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

    await page.mouse.click(targetBox.x, targetBox.y);
    await page.waitForSelector("#agent-pilot-feedback-popover:not(.hidden)", { timeout: 5000 });

    // Verify popover is visible
    const popoverVisible = await page.$eval("#agent-pilot-feedback-popover", el => !el.classList.contains("hidden"));
    console.log("- Comment popover visible:", popoverVisible);
    if (!popoverVisible) throw new Error("Comment popover should be visible after clicking element!");

    // Type comment 1
    await page.type("#ap-popover-input", "Ban dau: nut bi lech can giua");
    await page.click("#ap-popover-btn-save");
    await page.waitForSelector(".ap-pinned-box:not(.draft)", { timeout: 5000 });

    // 5. Verify pinned box & badge on page
    const pinnedState = await page.evaluate(() => {
      const box = document.querySelector(".ap-pinned-box:not(.draft)");
      const badge = box?.querySelector(".ap-pinned-badge");
      const editBtn = badge?.querySelector(".ap-pinned-edit-btn");
      const delBtn = badge?.querySelector(".ap-pinned-del-btn");
      const tooltip = badge?.querySelector(".ap-pinned-tooltip");
      return {
        hasBox: !!box,
        hasBadge: !!badge,
        hasEditBtn: !!editBtn,
        hasDelBtn: !!delBtn,
        tooltipText: tooltip?.textContent || ""
      };
    });
    console.log("- Pinned state on page after save:", pinnedState);
    if (!pinnedState.hasEditBtn || !pinnedState.hasDelBtn) {
      throw new Error("Pinned badge must have edit and delete buttons!");
    }

    // 6. Test In-Page Edit: click ✏️ on pinned badge
    console.log("3. Testing In-Page Edit via pinned badge ✏️ button...");
    await page.click(".ap-pinned-edit-btn");
    await page.waitForSelector("#agent-pilot-feedback-popover:not(.hidden)", { timeout: 5000 });

    const editPopoverState = await page.$eval("#agent-pilot-feedback-popover", el => ({
      visible: !el.classList.contains("hidden"),
      title: el.querySelector("#ap-popover-title")?.textContent,
      val: el.querySelector("#ap-popover-input")?.value
    }));
    console.log("- Edit popover state:", editPopoverState);
    if (!editPopoverState.visible || editPopoverState.val !== "Ban dau: nut bi lech can giua") {
      throw new Error("Edit popover should open with existing comment!");
    }

    // Change comment
    await page.evaluate(() => {
      document.getElementById("ap-popover-input").value = "";
    });
    await page.type("#ap-popover-input", "Cap nhat 1: nut da can giua thanh cong");
    await page.click("#ap-popover-btn-save");
    await page.waitForFunction(() => document.querySelector(".ap-pinned-tooltip")?.textContent.includes("Cap nhat 1: nut da can giua thanh cong"), { timeout: 5000 });

    const updatedTooltip = await page.$eval(".ap-pinned-tooltip", el => el.textContent);
    console.log("- Updated tooltip text on page:", updatedTooltip);
    if (!updatedTooltip.includes("Cap nhat 1: nut da can giua thanh cong")) {
      throw new Error("Tooltip must reflect updated comment!");
    }

    // 7. Test Side Panel Sync & Side Panel Edit
    console.log("4. Testing Side Panel sync and inline edit...");
    await sidepanelPage.bringToFront();
    await sidepanelPage.click("button[data-tab=\"tab-feedback\"]");
    await sidepanelPage.waitForSelector(".feedback-card", { timeout: 5000 });

    const sidepanelItem = await sidepanelPage.evaluate(() => {
      const card = document.querySelector(".feedback-card");
      const preview = card?.querySelector(".feedback-comment-preview")?.textContent.trim();
      const hasEditBtn = !!card?.querySelector(".btn-edit-item");
      const hasDelBtn = !!card?.querySelector(".btn-del-item");
      return { hasCard: !!card, preview, hasEditBtn, hasDelBtn };
    });
    console.log("- Sidepanel item state:", sidepanelItem);
    if (!sidepanelItem.hasEditBtn || !sidepanelItem.hasDelBtn) {
      throw new Error("Sidepanel card must have edit and delete buttons!");
    }

    // Click ✏️ on sidepanel card
    await sidepanelPage.click(".btn-edit-item");
    await sidepanelPage.waitForSelector(".feedback-comment-edit:not(.hidden)", { timeout: 5000 });

    const isEditFormVisible = await sidepanelPage.$eval(".feedback-comment-edit", el => !el.classList.contains("hidden"));
    console.log("- Sidepanel edit textarea visible:", isEditFormVisible);
    if (!isEditFormVisible) throw new Error("Sidepanel edit form should be visible!");

    // Edit in sidepanel
    await sidepanelPage.evaluate(() => {
      const ta = document.querySelector(".side-comment-textarea");
      ta.value = "Cap nhat 2: sua truc tiep tu Sidepanel";
    });
    await sidepanelPage.click(".btn-save-comment");
    await sidepanelPage.waitForFunction(() => document.querySelector(".feedback-comment-preview")?.textContent.includes("Cap nhat 2"), { timeout: 5000 });

    const sidepanelNewText = await sidepanelPage.$eval(".feedback-comment-preview", el => el.textContent.trim());
    console.log("- Sidepanel saved text:", sidepanelNewText);
    if (!sidepanelNewText.includes("Cap nhat 2: sua truc tiep tu Sidepanel")) {
      throw new Error("Sidepanel comment must be updated!");
    }

    // 8. Test Delete from Sidepanel
    console.log("5. Testing Delete from Sidepanel...");
    await sidepanelPage.click(".btn-del-item");
    await sidepanelPage.waitForFunction(() => document.getElementById("feedback-items-counter")?.textContent.trim() === "0", { timeout: 5000 });

    const sidepanelCountAfterDel = await sidepanelPage.$eval("#feedback-items-counter", el => el.textContent.trim());
    console.log("- Sidepanel counter after delete:", sidepanelCountAfterDel);
    const pageStateAfterSidepanelDelete = await page.evaluate(() => ({
      boxes: [...document.querySelectorAll(".ap-pinned-box:not(.draft)")].map(box => box.dataset.id || null),
      feedbackCoordinatorInitialized: Boolean(window.__AP_INTERNAL__?.__guards?.fsIndex)
    }));
    console.log("- Page state after Side Panel delete:", pageStateAfterSidepanelDelete);
    if (sidepanelCountAfterDel !== "0") throw new Error("Counter should be 0 after delete!");
    if (pageStateAfterSidepanelDelete.boxes.length !== 0) {
      throw new Error(`Side Panel delete left pinned boxes rendered on the source page: ${JSON.stringify(pageStateAfterSidepanelDelete.boxes)}`);
    }

    // 6. Test In-Page Delete via .ap-pinned-del-btn
    console.log("6. Testing In-Page Delete via pinned badge ✕ button...");
    await page.bringToFront();
    await sleep(300);
    // Add another item
    const counterBox = await page.$eval("#btn-sample-counter", el => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(counterBox.x, counterBox.y);
    await page.waitForSelector("#agent-pilot-feedback-popover:not(.hidden)", { timeout: 5000 });
    await page.type("#ap-popover-input", "Vi tri can xoa bang nut X");
    await page.click("#ap-popover-btn-save");
    await page.waitForSelector(".ap-pinned-box:not(.draft)", { timeout: 5000 });

    const pageBoxCountBefore = await page.$$eval(".ap-pinned-box:not(.draft)", els => els.length);
    const pageStateBeforeInPageDelete = await page.evaluate(() => ({
      boxes: [...document.querySelectorAll(".ap-pinned-box:not(.draft)")].map(box => box.dataset.id || null),
      feedbackCoordinatorInitialized: Boolean(window.__AP_INTERNAL__?.__guards?.fsIndex)
    }));
    console.log("- Page state before in-page delete:", pageStateBeforeInPageDelete);
    console.log("- Page boxes before in-page delete:", pageBoxCountBefore);
    if (pageBoxCountBefore !== 1) throw new Error("Should have 1 box before delete!");

    // Click ✕ on the pinned badge
    await page.click(".ap-pinned-del-btn");
    await page.waitForFunction(() => document.querySelectorAll(".ap-pinned-box:not(.draft)").length === 0, { timeout: 5000 });

    const pageBoxCountAfter = await page.$$eval(".ap-pinned-box:not(.draft)", els => els.length);
    console.log("- Page boxes after in-page delete:", pageBoxCountAfter);
    if (pageBoxCountAfter !== 0) throw new Error("Pinned box should be removed after clicking ✕!");

    // Verify Sidepanel also synced to 0
    await sidepanelPage.bringToFront();
    await sidepanelPage.waitForFunction(() => document.getElementById("feedback-items-counter")?.textContent.trim() === "0", { timeout: 5000 });
    const sidepanelCountSynced = await sidepanelPage.$eval("#feedback-items-counter", el => el.textContent.trim());
    console.log("- Sidepanel counter after in-page delete sync:", sidepanelCountSynced);
    if (sidepanelCountSynced !== "0") throw new Error("Sidepanel should sync to 0 items!");

    // 7. Take verified screenshot
    try {
      await sidepanelPage.screenshot({ path: path.join(ASSETS_DIR, "test_feedback_edit_delete_verified.png") });
    } catch (e) {
      console.warn("Screenshot warning (non-fatal):", e.message);
    }

    console.log(SEPARATOR);
    console.log("🎉 ALL FEEDBACK EDIT & DELETE TESTS PASSED (100%)!");
    console.log(SEPARATOR);
  } finally {
    // Browser + server are always released, and the run reports via exitCode.
    if (closeBrowser) await closeBrowser();
    await closeHttpServer(server);
  }
}

run().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exitCode = 1;
});
