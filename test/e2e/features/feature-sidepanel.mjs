/**
 * verify_all_features - Feature section: Side Panel control-center UI
 * (subtabs, overview copy-all, guide tab reuse, 5-format eyedropper) — record 8.
 *
 * Creates the side panel page and hands it back on ctx.sidepanelPage so the later
 * CDP / screenshot / feedback sections can reuse the same tab (as the original did).
 */
export async function run(ctx) {
  const { browser, extId, record } = ctx;

  console.log("\n--- KIỂM THỬ GIAO DIỆN BẢNG ĐIỀU KHIỂN (SIDE PANEL) ---");
  const sidepanelPage = await browser.newPage();
  await sidepanelPage.goto(`chrome-extension://${extId}/sidepanel.html`);

  const sidepanelCheck = await sidepanelPage.evaluate(() => {
    // Test subtabs switching in Inspector panel
    const subtabBtns = Array.from(document.querySelectorAll("#inspector-subtabs .subtab-btn")).map(b => b.textContent.trim());
    const cssTabBtn = document.getElementById("btn-subtab-css");
    if (cssTabBtn) cssTabBtn.click();
    const isCssTabActive = document.getElementById("subtab-css")?.classList.contains("active");

    return {
      brand: document.querySelector(".brand-title")?.textContent,
      hasBetaBadge: document.querySelector(".badge-beta")?.textContent.trim() === "BETA",
      brandSub: document.querySelector(".brand-sub")?.textContent.trim(),
      hasGuideBtn: !!document.getElementById("btn-open-guide"),
      tabBtns: Array.from(document.querySelectorAll(".tab-btn")).map(b => b.textContent.trim()),
      hasAgentMonitor: !!document.getElementById("agent-activity-log"),
      hasInspectorBtn: !!document.getElementById("btn-toggle-inspector"),
      hasScreenshotBtns: !!document.getElementById("btn-capture-visible"),
      hasSelfTestBtn: !!document.getElementById("btn-self-test-agent"),
      subtabBtns,
      isCssTabActive,
      hasCssSearch: !!document.getElementById("inspector-css-search"),
      hasCopyAllCss: !!document.getElementById("btn-copy-all-css"),
      hasCopyAllOverview: !!document.getElementById("btn-copy-all-overview"),
      hasSlimScrollbar: (() => {
        const rules = Array.from(document.styleSheets).flatMap(s => {
          try { return Array.from(s.cssRules || []); } catch (_) { return []; }
        });
        return rules.some(r => r.selectorText && r.selectorText.includes("::-webkit-scrollbar"));
      })(),
      captureElementText: document.getElementById("btn-capture-element")?.textContent.replace(/\s+/g, " ").trim(),
      hasAutoCopySwitch: !!document.getElementById("toggle-auto-copy-shot"),
      colorFormats: {
        hasHex: !!document.getElementById("color-hex"),
        hasRgb: !!document.getElementById("color-rgb"),
        hasRgba: !!document.getElementById("color-rgba"),
        hasHsl: !!document.getElementById("color-hsl"),
        hasOklch: !!document.getElementById("color-oklch"),
        copyBtnsCount: document.querySelectorAll("#latest-color-box .color-copy-btn").length
      }
    };
  });

  // Test Inspector Overview click-to-copy and Copy All Overview button
  const overviewCopyTest = await sidepanelPage.evaluate(async () => {
    const details = {
      tagName: "button",
      selector: "#test-btn",
      xpath: '//*[@id="test-btn"]',
      rect: { x: 120, y: 80, width: 95, height: 36 },
      text: "Nội dung mẫu cần sao chép",
      value: "btn-sample-value"
    };
    if (window.__INSPECTOR_PANEL__) {
      window.__INSPECTOR_PANEL__.displayElementDetails(details);
    }

    const toolbar = document.getElementById("overview-toolbar");
    const copyAllBtn = document.getElementById("btn-copy-all-overview");
    const clickableRows = Array.from(document.querySelectorAll("#inspector-result-box .detail-row.clickable"));
    const copyTag = document.getElementById("copy-tag");
    const copyCoords = document.getElementById("copy-coords");
    const copyDims = document.getElementById("copy-dimensions");
    const copySel = document.getElementById("copy-selector");
    const copyXpath = document.getElementById("copy-xpath");
    const copyText = document.getElementById("copy-text");
    const copyVal = document.getElementById("copy-value");

    const allPresent = Boolean(
      toolbar && toolbar.style.display === "flex" &&
      copyAllBtn &&
      clickableRows.length >= 6 &&
      copyTag && copyCoords && copyDims && copySel && copyXpath && copyText && copyVal
    );

    // Also simulate clicking copy-text and copy-all
    if (copyText) copyText.click();
    if (copyAllBtn) copyAllBtn.click();

    return {
      success: allPresent,
      rowCount: clickableRows.length,
      toolbarVisible: toolbar?.style.display === "flex",
      hasCopyAllBtn: !!copyAllBtn
    };
  });

  // Test clicking guide button: opens GitHub Pages documentation and focuses on repeated clicks
  const guideTest = await sidepanelPage.evaluate(async () => {
    const btn = document.getElementById("btn-open-guide");
    if (!btn) return { opened: false, singleTab: false };
    const isGuideTab = t => {
      const u = t.url || t.pendingUrl || "";
      return u.includes("agent-pilot") && (u.includes("github.io") || u.includes("gnos.cloud"));
    };
    btn.click();
    await new Promise(r => setTimeout(r, 600));

    const tabs1 = await new Promise(resolve => chrome.tabs.query({}, resolve));
    const guideTabs1 = tabs1.filter(isGuideTab);
    const opened = guideTabs1.length >= 1;

    // Click again to verify existing tab is focused rather than duplicated
    btn.click();
    await new Promise(r => setTimeout(r, 600));

    const tabs2 = await new Promise(resolve => chrome.tabs.query({}, resolve));
    const guideTabs2 = tabs2.filter(isGuideTab);
    const singleTab = guideTabs2.length === 1;

    // Clean up created tab
    for (const tab of guideTabs2) {
      if (tab.id) chrome.tabs.remove(tab.id);
    }

    return {
      opened,
      singleTab,
      guideUrl: guideTabs1[0]?.url || guideTabs1[0]?.pendingUrl
    };
  });

  // Test Color Eyedropper 5 formats update and 1-click copy
  const colorFormatTest = await sidepanelPage.evaluate(async () => {
    if (!window.__INSPECTOR_PANEL__) return { success: false };
    window.__INSPECTOR_PANEL__.addColorToPalette({ hex: "#38bdf8", r: 56, g: 189, b: 248 });

    const valHex = document.getElementById("val-hex")?.textContent?.trim();
    const valRgb = document.getElementById("val-rgb")?.textContent?.trim();
    const valRgba = document.getElementById("val-rgba")?.textContent?.trim();
    const valHsl = document.getElementById("val-hsl")?.textContent?.trim();
    const valOklch = document.getElementById("val-oklch")?.textContent?.trim();

    // Test click on OKLCH row
    const oklchRow = document.getElementById("color-oklch");
    if (oklchRow) oklchRow.click();

    // Test click on RGBA row
    const rgbaRow = document.getElementById("color-rgba");
    if (rgbaRow) rgbaRow.click();

    const valid = Boolean(
      valHex && valHex.toLowerCase() === "#38bdf8" &&
      valRgb === "rgb(56, 189, 248)" &&
      valRgba === "rgba(56, 189, 248, 1)" &&
      valHsl && valHsl.startsWith("hsl(") &&
      valOklch && valOklch.startsWith("oklch(")
    );

    return {
      success: valid,
      valHex,
      valRgb,
      valRgba,
      valHsl,
      valOklch
    };
  });

  // Test Reconnect Bridge Button (#btn-reconnect-bridge): triggers loading state and disables
  const reconnectBtnTest = await sidepanelPage.evaluate(async () => {
    const btn = document.getElementById("btn-reconnect-bridge");
    if (!btn) return { exists: false, loadingTriggered: false };
    const initialText = btn.textContent.trim();
    btn.click();
    const loadingText = btn.textContent.trim();
    const isDisabled = btn.disabled;
    return {
      exists: true,
      initialText,
      loadingText,
      loadingTriggered: isDisabled === true && loadingText.includes("Đang nối")
    };
  });

  const sidepanelOk = sidepanelCheck.brand === "AGENT PILOT" &&
                      sidepanelCheck.hasBetaBadge === true &&
                      sidepanelCheck.brandSub === "Next-Gen AI Browser Companion" &&
                      sidepanelCheck.hasGuideBtn === true &&
                      sidepanelCheck.tabBtns.length === 4 &&
                      sidepanelCheck.hasAgentMonitor &&
                      sidepanelCheck.subtabBtns.length === 2 &&
                      sidepanelCheck.isCssTabActive &&
                      sidepanelCheck.hasCssSearch &&
                      sidepanelCheck.hasCopyAllOverview === true &&
                      overviewCopyTest.success === true &&
                      colorFormatTest.success === true &&
                      sidepanelCheck.colorFormats.copyBtnsCount === 5 &&
                      sidepanelCheck.hasSlimScrollbar === true &&
                      sidepanelCheck.captureElementText === "🎯 Chụp phần tử" &&
                      sidepanelCheck.hasAutoCopySwitch === true &&
                      guideTest.opened === true &&
                      guideTest.singleTab === true &&
                      reconnectBtnTest.loadingTriggered === true;
  record("8. Side Panel Control Center UI (5-Format Eyedropper, Beta Badge, Slogan, Slim Scrollbar & Overview Copy All)", sidepanelOk, `Eyedropper 5 Formats: ${colorFormatTest.success} (OKLCH: ${colorFormatTest.valOklch}), CopyBtns: ${sidepanelCheck.colorFormats.copyBtnsCount}, Slogan: "${sidepanelCheck.brandSub}", ReconnectBtnLoading: ${reconnectBtnTest.loadingTriggered}`);

  // Keep sidepanelPage open to test Extension IPC messaging in later sections.
  ctx.sidepanelPage = sidepanelPage;
}
