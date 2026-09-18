/**
 * Agent Pilot - Full End-to-End Automated Verification Test
 * Tests all features in real Chromium under Xvfb with Puppeteer.
 *
 * Per-feature assertions live in scripts/features/feature-*.mjs; this entry point
 * wires up the shared harness (static server, browser launch, service-worker wait)
 * and runs the numbered sections in their original order.
 */

import { resolveChromiumBin } from "./browser_resolver.mjs";
import { HTTP_PORT, ROOT_DIR, NAV_WAIT_UNTIL, TIMEOUTS, SEPARATOR } from "./lib/config.mjs";
import {
  createRecorder,
  startStaticServer,
  launchExtensionBrowser,
  waitForServiceWorker,
  extensionIdFromTarget
} from "./lib/harness.mjs";

import * as basicInput from "./features/feature-basic-input.mjs";
import * as inspector from "./features/feature-inspector.mjs";
import * as sidepanel from "./features/feature-sidepanel.mjs";
import * as cdp from "./features/feature-cdp.mjs";
import * as screenshot from "./features/feature-screenshot.mjs";
import * as feedback from "./features/feature-feedback.mjs";

async function run() {
  console.log(SEPARATOR);
  console.log("🧪 BẮT ĐẦU XÁC THỰC TOÀN BỘ CÁC CHỨC NĂNG CỦA AGENT PILOT EXTENSION");
  console.log(`${SEPARATOR}\n`);

  const server = await startStaticServer(HTTP_PORT, ROOT_DIR);
  console.log(`[HTTP Server] Listening on http://127.0.0.1:${HTTP_PORT}`);

  const recorder = createRecorder({
    title: "📊 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ HOẠT ĐỘNG THỰC TẾ:",
    successMessage: "\n🎉 HOÀN TOÀN XÁC MINH: TẤT CẢ CÁC CHỨC NĂNG ĐÃ CHẠY THÀNH CÔNG RỰC RỠ TRÊN TRÌNH DUYỆT THẬT!",
    failureMessage: "\n❌ Có chức năng chưa vượt qua kiểm thử!"
  });
  const record = recorder.record;

  let closeBrowser = null;
  try {
    console.log(`[Chromium] Launching binary: ${resolveChromiumBin()}`);
    const launched = await launchExtensionBrowser();
    closeBrowser = launched.close;

    // 1. Verify Extension Background Service Worker Loaded
    const swTarget = await waitForServiceWorker(launched.browser, { timeoutMs: TIMEOUTS.SERVICE_WORKER_MS });

    const extLoaded = !!swTarget;
    const extId = extensionIdFromTarget(swTarget);
    record("1. Extension Service Worker", extLoaded, `ID: ${extId}, URL: ${swTarget?.url()}`);

    if (!extLoaded) {
      throw new Error("Service Worker not found!");
    }

    // Connect to Service Worker execution context
    const sw = await swTarget.worker();

    const page = await launched.browser.newPage();
    await page.goto(`http://127.0.0.1:${HTTP_PORT}/test-page.html`, { waitUntil: NAV_WAIT_UNTIL });

    // Shared context threaded through the feature sections (page, worker, recorder…).
    const ctx = { browser: launched.browser, sw, page, extId, recorder, record, httpPort: HTTP_PORT };

    await basicInput.run(ctx);
    await inspector.run(ctx);
    await sidepanel.run(ctx);
    await cdp.run(ctx);
    // Screenshot + feedback sections only run when a test-page tab was found.
    if (ctx.tabInfo) {
      await screenshot.run(ctx);
      await feedback.run(ctx);
      await ctx.sidepanelPage.close();
    }

    recorder.summarize();
    recorder.exitIfFailed();
  } catch (err) {
    console.error("\n[LỖI]:", err);
    process.exitCode = 1;
  } finally {
    // Cleanup lives in `finally` and sets process.exitCode (never process.exit) so
    // the browser and server are always torn down, even after a failed assertion.
    if (closeBrowser) await closeBrowser();
    server.close();
  }
}

run();
