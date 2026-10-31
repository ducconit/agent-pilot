/**
 * verify_all_features - Feature section: Visual UI Feedback Studio & Channel C
 * clipboard prompt export (in-page HUD, multi-mode, source detection, XSS-safe
 * prompt export) — record 15. Runs only when a test-page tab was found.
 */
export async function run({ page, record }) {
  console.log("\n--- KIỂM THỬ GIAO DIỆN PHẢN HỒI TRỰC QUAN (FEEDBACK STUDIO & CHANNEL C) ---");

  const feedbackTest = await page.evaluate(async () => {
    // Start feedback studio
    await window.__AGENT_PILOT__.startFeedbackStudio();
    await new Promise(r => setTimeout(r, 100));

    const hud = document.getElementById("agent-pilot-feedback-hud");
    const hudVisible = hud && !hud.classList.contains("hidden");
    const isActive = await window.__AGENT_PILOT__.isFeedbackStudioActive();

    // Check mode buttons
    const modeBtns = Array.from(hud ? hud.querySelectorAll(".ap-hud-btn") : []).map(b => b.dataset.mode);

    // Switch mode to region
    const regionBtn = hud?.querySelector('.ap-hud-btn[data-mode="region"]');
    if (regionBtn) regionBtn.click();
    const activeBtn = hud?.querySelector('.ap-hud-btn.active')?.dataset.mode;

    // Add a mock feedback item directly via __AGENT_PILOT__
    await window.__AGENT_PILOT__.clearFeedbackItems();
    const mockItem = {
      id: "fb_test_123",
      mode: "element",
      title: "Button: Gửi phản hồi",
      comment: "Nút này cần đổi màu nền thành cyan và thêm icon tên lửa",
      dom: {
        selector: "#submit-btn",
        xpath: '//*[@id="submit-btn"]',
        tagName: "button",
        text: "Gửi phản hồi",
        rect: { x: 100, y: 200, width: 140, height: 40 }
      },
      component: {
        framework: "React",
        componentName: "SubmitButton",
        fileName: "src/components/FeedbackModal.tsx",
        lineNumber: 48,
        hierarchy: "App > FeedbackModal > SubmitButton"
      },
      screenshotDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      timestamp: new Date().toISOString()
    };

    const addRes = await window.__AGENT_PILOT__.addFeedbackItem(mockItem);
    const items = await window.__AGENT_PILOT__.getFeedbackItems();

    // Generate prompt
    const prompt = await window.__AGENT_PILOT__.generateFeedbackPrompt([mockItem]);
    const hasComponent = prompt && prompt.includes("src/components/FeedbackModal.tsx:48");
    const hasComment = prompt && prompt.includes("Nút này cần đổi màu nền thành cyan");
    const hasSelector = prompt && prompt.includes("#submit-btn");

    // Security regression: crafted item must not inject markup or smuggle a remote image URL.
    // DOM is shared between the isolated and main worlds, so the marker is observable here.
    const maliciousItem = {
      id: '"><img src=x onerror="document.documentElement.setAttribute(\'data-ap-xss\',\'1\')">',
      mode: '</span><img src=x onerror="document.documentElement.setAttribute(\'data-ap-xss\',\'2\')">',
      title: '<img src=x onerror="document.documentElement.setAttribute(\'data-ap-xss\',\'3\')">',
      comment: '<img src=x onerror="document.documentElement.setAttribute(\'data-ap-xss\',\'4\')">',
      screenshotDataUrl: "https://evil.example/xss.png",
      extraEvilKey: { nested: true }
    };
    await window.__AGENT_PILOT__.addFeedbackItem(maliciousItem);
    const listButton = document.getElementById("ap-hud-btn-list");
    if (listButton) listButton.click();
    await new Promise(r => setTimeout(r, 150));
    const xssTriggered = document.documentElement.getAttribute("data-ap-xss") !== null;
    const storedMalicious = (await window.__AGENT_PILOT__.getFeedbackItems())
      .find((it) => typeof it.title === "string" && it.title.includes("data-ap-xss"));
    const maliciousSanitized = Boolean(storedMalicious) &&
      storedMalicious.mode === "element" &&
      storedMalicious.screenshotDataUrl === undefined &&
      !storedMalicious.id.includes("<") &&
      !storedMalicious.id.includes('"') &&
      storedMalicious.extraEvilKey === undefined;
    await window.__AGENT_PILOT__.clearFeedbackItems();
    if (listButton) document.getElementById("ap-list-btn-close")?.click();

    // Test HUD stays active until explicitly stopped
    const stillActive = await window.__AGENT_PILOT__.isFeedbackStudioActive();
    await window.__AGENT_PILOT__.stopFeedbackStudio();
    const stoppedActive = await window.__AGENT_PILOT__.isFeedbackStudioActive();
    const hudHidden = hud?.classList.contains("hidden");

    return {
      hudVisible,
      isActive,
      modeBtns,
      activeModeSwitched: activeBtn === "region",
      hasComponent: Boolean(hasComponent),
      hasComment: Boolean(hasComment),
      hasSelector: Boolean(hasSelector),
      xssTriggered,
      maliciousSanitized,
      stillActive,
      stoppedActive: !stoppedActive && hudHidden
    };
  });

  const feedbackOk = feedbackTest.hudVisible &&
                     feedbackTest.isActive &&
                     feedbackTest.modeBtns.includes("element") &&
                     feedbackTest.modeBtns.includes("region") &&
                     feedbackTest.modeBtns.includes("screen") &&
                     feedbackTest.modeBtns.includes("fullpage") &&
                     feedbackTest.activeModeSwitched &&
                     feedbackTest.hasComponent &&
                     feedbackTest.hasComment &&
                     feedbackTest.hasSelector &&
                     feedbackTest.xssTriggered === false &&
                     feedbackTest.maliciousSanitized === true &&
                     feedbackTest.stillActive &&
                     feedbackTest.stoppedActive;

  record(
    "15. Visual UI Feedback Studio & Channel C Prompt (In-Page HUD, Multi-Mode, Source Detection & XSS-Safe Prompt Export)",
    feedbackOk,
    `HUD: ${feedbackTest.hudVisible}, Modes: [${feedbackTest.modeBtns?.join(",")}], Component: ${feedbackTest.hasComponent}, Prompt: ${feedbackTest.hasComment}, XSS Blocked: ${feedbackTest.xssTriggered === false && feedbackTest.maliciousSanitized === true}, Persistent: ${feedbackTest.stillActive}`
  );
}
