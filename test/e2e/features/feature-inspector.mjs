/**
 * verify_all_features - Feature section: element inspector and the color
 * eyedropper subsystem (records 6-7).
 */
export async function run({ page, record }) {
  // 6. Element Inspector (selector, XPath, bounding rect & auto turn-off)
  const inspectRes = await page.evaluate(async () => {
    const elDetails = await window.__AGENT_PILOT__.getElement("#inspector-special-box", true);
    await window.__AGENT_PILOT__.toggleInspector(true);
    const wasActive = await window.__AGENT_PILOT__.isInspectorActive();
    const boxEl = document.getElementById("inspector-special-box");
    const r = boxEl.getBoundingClientRect();
    boxEl.dispatchEvent(new MouseEvent("click", {
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      bubbles: true,
      cancelable: true
    }));
    // Wait tiny tick for event handling
    await new Promise(res => setTimeout(res, 50));
    const isNowActive = await window.__AGENT_PILOT__.isInspectorActive();
    const autoTurnOff = wasActive === true && isNowActive === false;
    return { ...elDetails, autoTurnOff };
  });
  const inspectOk = inspectRes &&
                    inspectRes.rect?.width > 0 &&
                    inspectRes.selector?.includes("inspector-special-box") &&
                    inspectRes.autoTurnOff &&
                    Boolean(inspectRes.computedStyles?.display);
  record("6. Element Inspector (Bounding Rect, Selector, XPath, Computed CSS, Auto Turn-Off)", inspectOk, `Selector: ${inspectRes?.selector}, CSS display: ${inspectRes?.computedStyles?.display}, Auto Turn-Off: ${inspectRes?.autoTurnOff}`);

  // 7. Color eyedropper subsystem (magnifying loupe, pixel grid & auto turn-off)
  const colorCheck = await page.evaluate(async () => {
    if (typeof window.__AGENT_PILOT__.pickColor !== "function") return null;

    // Launch interactive eyedropper mode
    const pickPromise = window.__AGENT_PILOT__.pickColor();
    const wasActive = await window.__AGENT_PILOT__.isEyedropperActive();
    const loupeEl = document.getElementById("agent-pilot-eyedropper-loupe");
    const canvasEl = document.getElementById("agent-pilot-loupe-canvas");

    // Dispatch mousemove to render loupe
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 200, clientY: 200 }));
    await new Promise((r) => setTimeout(r, 60));

    // Simulate user clicking on screen to pick color
    window.dispatchEvent(new MouseEvent("click", { clientX: 200, clientY: 200, bubbles: true, cancelable: true }));
    const pickedColor = await pickPromise;
    const isNowActive = await window.__AGENT_PILOT__.isEyedropperActive();

    return {
      hasApi: true,
      wasActive,
      hasLoupe: Boolean(loupeEl && canvasEl),
      pickedColor,
      autoTurnOff: wasActive === true && isNowActive === false
    };
  });
  const colorOk = colorCheck && colorCheck.wasActive && colorCheck.hasLoupe && colorCheck.pickedColor?.hex && colorCheck.autoTurnOff;
  record("7. Color Eyedropper (Interactive Loupe, Pixel Sampling, Auto Turn-Off)", colorOk, `Hex: ${colorCheck?.pickedColor?.hex}, Loupe: ${colorCheck?.hasLoupe}, Auto Turn-Off: ${colorCheck?.autoTurnOff}`);
}
