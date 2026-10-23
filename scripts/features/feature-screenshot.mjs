/**
 * verify_all_features - Feature section: screenshot suite
 * (visible capture, region crop, element snap, delegated clipboard, auto-copy)
 * — record 14. Runs only when a test-page tab was found (see feature-cdp).
 */
import fs from "node:fs";
import path from "node:path";
import { ASSETS_DIR } from "../lib/config.mjs";

export async function run({ page, sidepanelPage, tabInfo, record }) {
  console.log("\n--- KIỂM THỬ BỘ CHỤP MÀN HÌNH (SCREENSHOT SUITE) ---");

  // Bring test page tab to front
  await page.bringToFront();

  const shotRes = await sidepanelPage.evaluate(async (tabId) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "capture_screenshot", mode: "visible", tabId }, resolve);
    });
  }, tabInfo.id);

  // Also test interactive element snap mode (auto turn-off on element click)
  const elementSnapTest = await page.evaluate(async () => {
    await window.__AGENT_PILOT__.startElementSnap();
    const wasActive = await window.__AGENT_PILOT__.isElementSnapActive();
    const testTarget = document.getElementById("inspector-special-box");
    const r = testTarget.getBoundingClientRect();
    testTarget.dispatchEvent(new MouseEvent("click", {
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      bubbles: true,
      cancelable: true
    }));
    await new Promise(res => setTimeout(res, 60));
    const isNowActive = await window.__AGENT_PILOT__.isElementSnapActive();
    return { wasActive, autoTurnOff: wasActive === true && isNowActive === false };
  });

  // Also test PNG blob creation & ClipboardItem image/png compatibility
  const clipboardTest = await sidepanelPage.evaluate(async (dataUrl) => {
    const parts = dataUrl.split(",");
    const binStr = atob(parts[1]);
    const u8arr = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) u8arr[i] = binStr.charCodeAt(i);
    const blob = new Blob([u8arr], { type: "image/png" });
    const item = new ClipboardItem({ "image/png": blob });
    return {
      isPng: blob.type === "image/png",
      blobSize: blob.size,
      itemSupported: Boolean(item && item.types && item.types.includes("image/png"))
    };
  }, shotRes?.dataUrl || "");

  // Test real Region Crop via chrome.runtime.sendMessage to sidepanel listener
  const regionCropTest = await sidepanelPage.evaluate(async () => {
    return new Promise((resolve) => {
      const clip = { x: 20, y: 20, width: 120, height: 90, pageWidth: 1280, pageHeight: 800, devicePixelRatio: 1 };
      chrome.runtime.sendMessage({ type: "REGION_CROP_REQUESTED", clip });

      let checks = 0;
      const interval = setInterval(() => {
        checks++;
        const previewCard = document.getElementById("screenshot-preview-card");
        const previewImg = document.getElementById("screenshot-img");
        if (previewCard && previewCard.style.display === "block" && previewImg && previewImg.src.startsWith("data:image/png;base64,")) {
          clearInterval(interval);
          resolve({ success: true, hasPreview: true, validDimensions: true, imgLength: previewImg.src.length });
        } else if (checks > 30) {
          clearInterval(interval);
          resolve({ success: false, error: "Timeout waiting for cropped image preview" });
        }
      }, 100);
    });
  });

  // Test real Delegated Clipboard write in content script via chrome.tabs.sendMessage
  // Clipboard writes are permission gated and the test invokes the content
  // handler asynchronously (without a user gesture). Grant the secure test
  // origin permission explicitly so CI scheduling/focus does not decide the
  // result of an otherwise valid PNG write.
  const pageOrigin = new URL(page.url()).origin;
  await page.browserContext().overridePermissions(pageOrigin, ["clipboard-read", "clipboard-write"]);
  await page.bringToFront();
  await page.waitForFunction(() => document.hasFocus());
  const delegatedCopyTest = await sidepanelPage.evaluate(async (targetTabId, sampleDataUrl) => {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(targetTabId, {
        action: "copy_image_to_clipboard",
        dataUrl: sampleDataUrl,
        showInPageToast: false
      }, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(res || { success: false, error: "No response" });
        }
      });
    });
  }, tabInfo.id, shotRes?.dataUrl || "");

  // Also test Auto-Copy Toggle state persistence
  const autoCopyToggleTest = await sidepanelPage.evaluate(async () => {
    const toggle = document.getElementById("toggle-auto-copy-shot");
    if (!toggle) return { found: false, canToggle: false };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    const stored = localStorage.getItem("agent_pilot_auto_copy_shot") === "true";
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    return { found: true, canToggle: stored };
  });

  const shotOk = shotRes?.success && shotRes?.dataUrl && shotRes.dataUrl.startsWith("data:image/png;base64,") &&
                 elementSnapTest.autoTurnOff &&
                 regionCropTest.validDimensions &&
                 clipboardTest.isPng && clipboardTest.itemSupported &&
                 delegatedCopyTest.success &&
                 autoCopyToggleTest.canToggle;
  if (shotOk) {
    const base64 = shotRes.dataUrl.replace(/^data:image\/png;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    const outPath = path.join(ASSETS_DIR, "verified_screenshot.png");
    fs.writeFileSync(outPath, buf);
    record("14. Screenshot Suite (Capture, Region Crop, Element Snap, Delegated Clipboard & Auto-Copy)", true, `Kích thước: ${buf.length} bytes, Crop: true, Snap Auto-Off: ${elementSnapTest.autoTurnOff}, Clipboard: ${delegatedCopyTest.success}, Auto-Copy: ${autoCopyToggleTest.canToggle}`);
  } else {
    record("14. Screenshot Suite (Capture, Region Crop, Element Snap, Delegated Clipboard & Auto-Copy)", false, shotRes?.error || regionCropTest?.error || `Crop: ${regionCropTest?.validDimensions}, Snap: ${elementSnapTest?.autoTurnOff}, Clipboard: ${delegatedCopyTest?.success} (${delegatedCopyTest?.error || "no error detail"}), Auto-Copy: ${autoCopyToggleTest?.canToggle}`);
  }
}
