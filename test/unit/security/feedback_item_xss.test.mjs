#!/usr/bin/env node
/**
 * Agent Pilot - Feedback Item Schema & XSS Hardening Verification
 * Validates that page-supplied feedback items cannot inject markup, smuggle
 * non-raster data URLs, pollute unknown keys, or blow up field sizes.
 */

import "../../../extensions/content/feedback-studio/item-schema.js";
import { escapeHtml } from "../../../extensions/sidepanel/ui-helpers.js";
import { SEPARATOR } from "../../../scripts/lib/config.mjs";
import { createRecorder } from "../../../scripts/lib/harness.mjs";

const schema = globalThis.__AP_FEEDBACK_ITEM_SCHEMA__;

console.log(SEPARATOR);
console.log("🧪 KIỂM THỬ ĐƠN VỊ: SCHEMA FEEDBACK ITEM & CHỐNG XSS ISOLATED WORLD");
console.log(`${SEPARATOR}\n`);

const recorder = createRecorder({
  summaryStyle: "compact",
  successMessage: "\n🎉 XÁC MINH THÀNH CÔNG: SCHEMA FEEDBACK ITEM CHỐNG XSS ISOLATED WORLD!",
  failureMessage: "\n❌ Có kiểm thử chưa vượt qua!"
});
const record = recorder.record;

const ALLOWED_KEYS = ["id", "mode", "comment", "timestamp", "title", "screenshotDataUrl", "dom", "component", "clip", "annotations"];

try {
  if (!schema) {
    throw new Error("item-schema module did not register on globalThis");
  }

  // 1-5. Malicious item from the page-facing bridge
  const xssItem = schema.validateFeedbackItem({
    id: '"><img src=x onerror=window.__AP_XSS__=1>',
    mode: '</span><img src=x onerror=window.__AP_XSS__=2>',
    title: "<script>alert(3)</script>",
    comment: '<img src=x onerror=window.__AP_XSS__=4>',
    screenshotDataUrl: 'x" onerror="window.__AP_XSS__=5',
    evilExtra: { nested: true }
  });

  record(
    "1. Malicious id is regenerated",
    schema.ID_PATTERN.test(xssItem.id) && !xssItem.id.includes("<") && !xssItem.id.includes('"'),
    `id=${xssItem.id}`
  );
  record(
    "2. Malicious mode is whitelisted",
    xssItem.mode === "element",
    `mode=${xssItem.mode}`
  );
  record(
    "3. Invalid screenshot data URL is dropped",
    xssItem.screenshotDataUrl === undefined,
    "Attribute-breakout payload removed"
  );
  record(
    "4. Unknown keys are stripped",
    xssItem.evilExtra === undefined && Object.keys(xssItem).every((key) => ALLOWED_KEYS.includes(key)),
    `keys=[${Object.keys(xssItem).join(", ")}]`
  );
  const escapedComment = escapeHtml(xssItem.comment);
  record(
    "5. Comment stays an inert string & escapes safely via escapeHtml",
    typeof xssItem.comment === "string" &&
    xssItem.comment.includes("onerror") &&
    escapedComment.includes("&lt;img") &&
    escapedComment.includes("&gt;") &&
    !escapedComment.includes("<img") &&
    !escapedComment.includes(">"),
    "Markup characters are stored as inert data and safely escaped when rendering"
  );

  // 6-9. Legitimate items survive validation
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const okItem = schema.validateFeedbackItem({
    id: "fb_test_123",
    mode: "region",
    title: "Nút gửi",
    comment: "Đổi màu nền",
    screenshotDataUrl: png,
    component: { framework: "React", componentName: "SubmitButton", fileName: "src/App.tsx", lineNumber: 48, hierarchy: "App > SubmitButton" },
    dom: { selector: "#submit", xpath: '//*[@id="submit"]', tagName: "button", text: "Gửi", rect: { x: 1, y: 2, width: 3, height: 4 } },
    clip: { x: 10, y: 20, width: 100, height: 50, devicePixelRatio: 2, pageWidth: 1440, pageHeight: 900 },
    annotations: [
      { type: "box", x: 1, y: 1, width: 10, height: 10, comment: "box note" },
      { type: "pin", x: 2, y: 2, comment: "" }
    ]
  });

  record("6. Valid PNG data URL preserved", okItem.screenshotDataUrl === png);
  record("7. Component fields preserved", okItem.component.componentName === "SubmitButton" && okItem.component.lineNumber === 48);
  record("8. Component hierarchy (string form) preserved", okItem.component.hierarchy === "App > SubmitButton");
  record("9. dom.rect preserved", okItem.dom.rect.width === 3 && okItem.dom.selector === "#submit");
  record("10. Annotations sanitized", okItem.annotations.length === 2 && okItem.annotations[0].type === "box" && okItem.annotations[1].type === "pin");
  record("11. Clip geometry preserved", okItem.clip.devicePixelRatio === 2 && okItem.clip.pageWidth === 1440);

  // 12-13. Size caps
  const longItem = schema.validateFeedbackItem({ comment: "a".repeat(9000), title: "t".repeat(500) });
  record(
    "12. Oversized fields capped",
    longItem.comment.length === 5000 && longItem.title.length === 300,
    `comment=${longItem.comment.length}, title=${longItem.title.length}`
  );

  const floodItem = schema.validateFeedbackItem({
    annotations: Array.from({ length: 250 }, (_, i) => ({ type: "pin", x: i, y: i, comment: "x".repeat(3000) }))
  });
  record(
    "13. Annotation flood capped",
    floodItem.annotations.length === 100 && floodItem.annotations[0].comment.length === 1000,
    `annotations=${floodItem.annotations.length}`
  );

  // 14. Payload-level caps
  const payload = schema.sanitizeFeedbackPayload({
    url: "https://example.test/page",
    title: "T",
    items: Array.from({ length: 80 }, (_, i) => ({ mode: "element", comment: `c${i}` })),
    prompt: "prompt-body"
  });
  record(
    "14. Payload items capped at 50",
    payload.items.length === 50 && payload.url === "https://example.test/page" && payload.prompt === "prompt-body",
    `items=${payload.items.length}`
  );

  // 15. Data URL smuggling variants rejected
  const smuggled = [
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+",
    png + "\"><img src=x onerror=alert(1)>"
  ];
  record(
    "15. Non-raster / smuggled data URLs rejected",
    smuggled.every((value) => schema.validateFeedbackItem({ screenshotDataUrl: value }).screenshotDataUrl === undefined),
    "Only base64 raster images pass"
  );

  // 16. QA DOM fields (Playwright locator, Test ID, selectorMatches, WCAG a11y) preserved
  const qaItem = schema.validateFeedbackItem({
    mode: "element",
    dom: {
      selector: '[data-testid="checkout-btn"]',
      selectorMatches: 1,
      playwrightLocator: 'page.getByTestId("checkout-btn")',
      testId: "checkout-btn",
      testIdAttr: "data-testid",
      role: "button",
      accessibleName: "Thanh toán",
      a11y: {
        contrastRatio: 7.42,
        wcagLevel: "AAA",
        warnings: ["Kích thước vùng bấm nhỏ"]
      }
    }
  });
  record(
    "16. QA DOM locators & WCAG a11y preserved",
    qaItem.dom.playwrightLocator === 'page.getByTestId("checkout-btn")'
      && qaItem.dom.testId === "checkout-btn"
      && qaItem.dom.selectorMatches === 1
      && qaItem.dom.a11y.contrastRatio === 7.42
      && qaItem.dom.a11y.wcagLevel === "AAA"
      && qaItem.dom.a11y.warnings.length === 1,
    `locator=${qaItem.dom.playwrightLocator}, contrast=${qaItem.dom.a11y.contrastRatio}`
  );

  // 17. Payload QA diagnostics (environment, consoleErrors, networkErrors, reproSteps) sanitized
  const diagPayload = schema.sanitizeFeedbackPayload({
    url: "https://example.test/checkout",
    title: "Checkout",
    items: [],
    diagnostics: {
      environment: { viewport: "1440×900", devicePixelRatio: 2, language: "vi-VN" },
      consoleErrors: [{ type: "uncaught_error", message: "TypeError: Cannot read x", count: 2 }],
      networkErrors: [{ method: "POST", url: "https://example.test/api/pay", status: 500, statusText: "Internal Server Error", durationMs: 120 }],
      reproSteps: [{ action: "click", selector: "#pay", description: 'Click <button> "Pay" (`#pay`)' }]
    }
  });
  record(
    "17. Payload QA diagnostics sanitized & preserved",
    diagPayload.diagnostics.environment.viewport === "1440×900"
      && diagPayload.diagnostics.consoleErrors.length === 1
      && diagPayload.diagnostics.networkErrors[0].status === 500
      && diagPayload.diagnostics.reproSteps.length === 1,
    `console=${diagPayload.diagnostics.consoleErrors.length}, net=${diagPayload.diagnostics.networkErrors.length}, steps=${diagPayload.diagnostics.reproSteps.length}`
  );

  // 18. Boundary inputs (null, undefined, primitives) yield strict default items
  const nullItem = schema.validateFeedbackItem(null);
  const undefinedItem = schema.validateFeedbackItem(undefined);
  const numberItem = schema.validateFeedbackItem(12345);
  record(
    "18. Boundary inputs (null, undefined, numbers) return safe default items",
    nullItem && typeof nullItem.id === "string" && nullItem.mode === "element" && nullItem.comment === "" &&
    undefinedItem && typeof undefinedItem.id === "string" && undefinedItem.mode === "element" &&
    numberItem && typeof numberItem.id === "string" && numberItem.mode === "element",
    "Nullish and non-object inputs safely coerced to default item structure"
  );

  // 19. Oversized (>15MB) and non-raster data URLs are rejected by isValidDataUrl
  const oversizedDataUrl = "data:image/png;base64," + "A".repeat(15 * 1024 * 1024 + 16);
  const isOversizedValid = schema.isValidDataUrl(oversizedDataUrl);
  const isNullUrlValid = schema.isValidDataUrl(null);
  const isUndefinedUrlValid = schema.isValidDataUrl(undefined);
  const isHtmlDataUrlValid = schema.isValidDataUrl("data:text/html;base64,PHNjcmlwdD4=");
  record(
    "19. Oversized (>15MB) and non-raster data URLs strictly rejected",
    isOversizedValid === false &&
    isNullUrlValid === false &&
    isUndefinedUrlValid === false &&
    isHtmlDataUrlValid === false,
    "Payload size guard and MIME whitelist block oversized or dangerous data URLs"
  );

  // 20. Prototype pollution attempts via __proto__, constructor, prototype are neutralized
  const pollutionPayload = JSON.parse('{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"injected": "yes"}}}');
  const sanitizedItem = schema.validateFeedbackItem(pollutionPayload);
  const isPrototypeClean = ({})["polluted"] === undefined && ({})["injected"] === undefined && sanitizedItem["polluted"] === undefined;
  record(
    "20. Prototype pollution attempts (__proto__, constructor) strictly neutralized",
    isPrototypeClean,
    "Object.prototype remains uncontaminated by untrusted feedback items"
  );

  recorder.summarize();
  recorder.exitIfFailed();
} catch (err) {
  console.error("❌ Exception during test:", err);
  process.exitCode = 1;
}
