/**
 * Agent Pilot - Screenshot Service
 * Captures high-resolution tab screenshots via CDP (background tabs) or captureVisibleTab
 */

import { attachedTabs, CDP_SCREENSHOT_TIMEOUT_MS, logDebug } from "./constants.js";
import { attachDebugger, sendCdpCommand } from "./cdp-manager.js";

/**
 * OffscreenCanvas-based image cropping utility for Service Workers
 */
export async function cropDataUrlInWorker(dataUrl, clip) {
  if (!clip || !clip.width || !clip.height || typeof OffscreenCanvas === "undefined") {
    return dataUrl;
  }
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const imgW = bitmap.width;
    const imgH = bitmap.height;

    const vpW = clip.pageWidth || clip.viewportWidth || imgW;
    const vpH = clip.pageHeight || clip.viewportHeight || imgH;
    const scaleX = imgW / vpW;
    const scaleY = imgH / vpH;

    let sx = Math.round(clip.x * scaleX);
    let sy = Math.round(clip.y * scaleY);
    let sw = Math.round(clip.width * scaleX);
    let sh = Math.round(clip.height * scaleY);

    sx = Math.max(0, Math.min(sx, imgW - 1));
    sy = Math.max(0, Math.min(sy, imgH - 1));
    sw = Math.max(1, Math.min(sw, imgW - sx));
    sh = Math.max(1, Math.min(sh, imgH - sy));

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    bitmap.close();

    const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(croppedBlob);
    });
  } catch (err) {
    logDebug("OffscreenCanvas crop", err);
    return dataUrl;
  }
}

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
      await attachDebugger(tabId).catch((err) => logDebug("attachDebugger in screenshot", err));
    }

    if (attachedTabs.has(tabId)) {
      const cdpParams = {
        format: "png",
        captureBeyondViewport: isFullPage
      };
      if (isTabActive) {
        cdpParams.fromSurface = true;
      }
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
          logDebug("CDP screenshot initial attempt note", firstErr);
          res = await sendCdpCommand(tabId, "Page.captureScreenshot", { format: "png" }, CDP_SCREENSHOT_TIMEOUT_MS);
          requiresCrop = Boolean((mode === "element" || mode === "region") && params.clip);
        }

        let resultUrl = "data:image/png;base64," + res.data;
        if (requiresCrop && params.clip) {
          resultUrl = await cropDataUrlInWorker(resultUrl, params.clip);
          requiresCrop = false;
        }

        return {
          success: true,
          tabId,
          isBackgroundTab: !isTabActive,
          dataUrl: resultUrl,
          clip: params.clip,
          requiresCrop
        };
      } catch (cdpErr) {
        logDebug(`CDP screenshot failed on tab ${tabId}`, cdpErr);
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
    chrome.tabs.captureVisibleTab(winId, { format: "png" }, async (rawUrl) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      const needsCrop = Boolean((mode === "element" || mode === "region") && params.clip);
      let finalUrl = rawUrl;
      if (needsCrop) {
        finalUrl = await cropDataUrlInWorker(rawUrl, params.clip);
      }
      resolve({
        success: true,
        tabId,
        isBackgroundTab: false,
        dataUrl: finalUrl,
        clip: params.clip,
        requiresCrop: false
      });
    });
  });
}
