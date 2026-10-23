/**
 * verify_all_features - Feature section: content-script bridge, virtual cursor
 * movement, synthetic click and human-like typing (records 2-5).
 *
 * Each section is self-contained: `run(ctx)` performs its page.evaluate work and
 * records its own result via ctx.record, exactly as the inline code did.
 */
export async function run({ page, record }) {
  // 2. Content Script Injected
  const domCheck = await page.evaluate(() => {
    return {
      cursorLayer: !!document.getElementById("agent-pilot-cursor-layer"),
      inspectorBox: !!document.getElementById("agent-pilot-inspector-box"),
      bridgeReady: !!window.__AGENT_PILOT__,
      version: window.__AGENT_PILOT__?.version
    };
  });
  record("2. Content Script Injected into Web Page", domCheck.cursorLayer && domCheck.bridgeReady, `Cursor Layer: ${domCheck.cursorLayer}, Bridge: v${domCheck.version}`);

  // 3. Virtual mouse movement
  const moveRes = await page.evaluate(async () => {
    await window.__AGENT_PILOT__.moveMouse(350, 220, 150);
    const coords = document.getElementById("agent-pilot-coords")?.textContent;
    const pos = await window.__AGENT_PILOT__.getCursorPosition();
    return { coords, pos };
  });
  const moveOk = moveRes.pos?.x === 350 && moveRes.pos?.y === 220;
  record("3. Virtual Mouse Movement & Floating Coordinates", moveOk, `Target: (350, 220) | Actual: (${moveRes.pos?.x}, ${moveRes.pos?.y}), Badge: ${moveRes.coords}`);

  // 4. Virtual mouse click on a real button
  const clickRes = await page.evaluate(async () => {
    const btn = document.getElementById("btn-sample-click");
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    await window.__AGENT_PILOT__.click(cx, cy);
    return document.getElementById("click-counter-text")?.textContent;
  });
  const clickOk = clickRes && clickRes.includes("1 lần");
  record("4. Virtual Mouse Click & Synthetic DOM Events", clickOk, clickRes);

  // 5. Human-like typing into an input
  const concurrentTypeRes = await page.evaluate(async () => {
    const first = window.__AGENT_PILOT__.type("#test-search-input", "First concurrent value", true);
    const second = window.__AGENT_PILOT__.type("#test-search-input", "Second concurrent value", true);
    const results = await Promise.all([first, second]);
    return {
      results,
      value: document.getElementById("test-search-input")?.value
    };
  });
  const concurrentTypeOk = concurrentTypeRes.value === "Second concurrent value" &&
    concurrentTypeRes.results.every(result => result?.success === true);
  record("5a. Concurrent Virtual Typing Is Serialized", concurrentTypeOk,
    `Value: "${concurrentTypeRes.value}", results: ${concurrentTypeRes.results.map(result => Boolean(result?.success)).join(",")}`);

  const typeRes = await page.evaluate(async () => {
    const result = await window.__AGENT_PILOT__.type("#test-search-input", "Agent Pilot Antigravity Verified", true);
    const val = document.getElementById("test-search-input")?.value;
    const badge = document.getElementById("typing-result-badge")?.textContent;
    return { val, badge, result };
  });
  const typeOk = typeRes.result?.success === true && typeRes.val === "Agent Pilot Antigravity Verified";
  record("5. Virtual Typing (Human-like Typing into Inputs)", typeOk, `Value: "${typeRes.val}"`);
}
