/**
 * Agent Pilot - Screenshot Service
 * Captures high-resolution tab screenshots via CDP (background tabs) or captureVisibleTab
 */

import { attachedTabs, CDP_SCREENSHOT_TIMEOUT_MS } from "./constants.js";
import { attachDebugger, sendCdpCommand } from "./cdp-manager.js";

/**
 * Capture screenshot of a tab (supports background tabs without stealing focus)
 */
export async function captureTabScreenshot(tabId, params = {}) {
  const mode = params.mode || "visible";
  let targetTab = null;
  try {
    targetTab = await chrome.tabs.get(tabId);
  } catch (e) {
    throw new Error(`Target tab ${tabId} not found: ${e.message}`);
  }

  const isTabActive = Boolean(targetTab && targetTab.active);

  const isFullPage = mode === "full" || mode === "fullpage";

  // If targetTab is running in background or CDP is attached or full page requested, capture via CDP
  if (!isTabActive || attachedTabs.has(tabId) || isFullPage) {
    if (!attachedTabs.has(tabId)) {
      await attachDebugger(tabId).catch(() => {});
    }

    if (attachedTabs.has(tabId)) {
      const cdpParams = {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: isFullPage
      };
      if ((mode === "element" || mode === "region") && params.clip) {
        cdpParams.clip = {
          x: params.clip.x,
          y: params.clip.y,
          width: params.clip.width,
          height: params.clip.height,
          scale: 1
        };
      }
      try {
        let res;
        let requiresCrop = false;
        try {
          res = await sendCdpCommand(tabId, "Page.captureScreenshot", cdpParams, CDP_SCREENSHOT_TIMEOUT_MS);
        } catch (firstErr) {
          console.warn("[AgentPilot] CDP screenshot initial attempt note:", firstErr?.message || firstErr);
          res = await sendCdpCommand(tabId, "Page.captureScreenshot", { format: "png" }, CDP_SCREENSHOT_TIMEOUT_MS);
          requiresCrop = Boolean((mode === "element" || mode === "region") && params.clip);
        }
        return {
          success: true,
          tabId,
          isBackgroundTab: !isTabActive,
          dataUrl: "data:image/png;base64," + res.data,
          clip: params.clip,
          requiresCrop
        };
      } catch (cdpErr) {
        console.warn("[AgentPilot] CDP screenshot failed on tab " + tabId + ":", cdpErr?.message || cdpErr);
        if (!isTabActive) {
          throw new Error(`CDP screenshot failed on background tab ${tabId}: ${cdpErr?.message || cdpErr}`);
        }
      }
    } else if (!isTabActive) {
      throw new Error(`Cannot capture background tab ${tabId}: CDP debugger attachment failed`);
    }
  }

  if (!isTabActive) {
    throw new Error(`Cannot capture background tab ${tabId} without active CDP`);
  }

  // Fallback to captureVisibleTab (captures active tab in the window)
  const winId = targetTab?.windowId || null;
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(winId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve({
        success: true,
        tabId,
        isBackgroundTab: false,
        dataUrl,
        clip: params.clip,
        requiresCrop: Boolean((mode === "element" || mode === "region") && params.clip)
      });
    });
  });
}
