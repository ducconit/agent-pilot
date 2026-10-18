/**
 * Agent Pilot - Screenshot Service
 * Captures high-resolution tab screenshots via CDP (background tabs) or captureVisibleTab
 */

import { attachedTabs, CDP_SCREENSHOT_TIMEOUT_MS, logDebug } from "./constants.js";
import { attachDebugger, sendCdpCommand } from "./cdp-manager.js";
import { sendTabMessageWithRetry } from "./tab-manager.js";

/**
 * OffscreenCanvas-based image cropping utility for Service Workers
 */
export async function cropDataUrlInWorker(dataUrl, clip) {
  if (!clip || !clip.width || !clip.height || typeof OffscreenCanvas === "undefined") {
    return dataUrl;
  }
  let bitmap = null;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    bitmap = await createImageBitmap(blob);
    const imgW = bitmap.width;
    const imgH = bitmap.height;

    const vpW = clip.pageWidth || clip.viewportWidth || (clip.devicePixelRatio ? imgW / clip.devicePixelRatio : imgW);
    const vpH = clip.pageHeight || clip.viewportHeight || (clip.devicePixelRatio ? imgH / clip.devicePixelRatio : imgH);
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
  } finally {
    if (bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
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

  let clip = null;
  if (params.clip && typeof params.clip === "object") {
    clip = {
      ...params.clip,
      x: Number(params.clip.x),
      y: Number(params.clip.y),
      width: Number(params.clip.width),
      height: Number(params.clip.height)
    };
  }

  if (mode === "region") {
    if (!clip && params.x !== undefined && params.y !== undefined && params.width !== undefined && params.height !== undefined) {
      clip = {
        x: Math.round(Number(params.x)),
        y: Math.round(Number(params.y)),
        width: Math.round(Number(params.width)),
        height: Math.round(Number(params.height))
      };
    }
    if (!clip || typeof clip.x !== "number" || typeof clip.y !== "number" || isNaN(clip.x) || isNaN(clip.y) || isNaN(clip.width) || isNaN(clip.height) || clip.width <= 0 || clip.height <= 0) {
      throw new Error(`Screenshot mode 'region' requires valid coordinates: clip { x, y, width, height } or flat x, y, width, height`);
    }
  } else if (mode === "element" && !clip) {
    if (!params.selector) {
      throw new Error(`Screenshot mode 'element' requires a 'selector' parameter`);
    }
    const elRes = await sendTabMessageWithRetry(tabId, {
      action: "get_element_info",
      selector: params.selector,
      scrollIntoView: true
    });
    if (!elRes || !elRes.success || !elRes.rect) {
      throw new Error(`Element not found for selector: ${params.selector}`);
    }
    const rect = elRes.rect;
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error(`Element has zero dimensions (${rect.width}x${rect.height}) for selector: ${params.selector}`);
    }
    clip = {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      width: rect.width,
      height: rect.height
    };
    if (elRes.viewport) {
      clip.viewportWidth = elRes.viewport.width;
      clip.viewportHeight = elRes.viewport.height;
      clip.devicePixelRatio = elRes.viewport.devicePixelRatio;
    }
    // Allow small pause for render tree to settle after scrolling
    await new Promise(r => setTimeout(r, 60));
  }

  if (clip && !clip.viewportWidth && targetTab?.width && targetTab?.height) {
    clip.viewportWidth = targetTab.width;
    clip.viewportHeight = targetTab.height;
  }

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
      if ((mode === "element" || mode === "region") && clip) {
        cdpParams.clip = {
          x: Math.max(0, clip.x),
          y: Math.max(0, clip.y),
          width: Math.max(1, clip.width),
          height: Math.max(1, clip.height),
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
          requiresCrop = Boolean((mode === "element" || mode === "region") && clip);
        }

        let resultUrl = "data:image/png;base64," + res.data;
        if (requiresCrop && clip) {
          resultUrl = await cropDataUrlInWorker(resultUrl, clip);
          requiresCrop = false;
        }

        return {
          success: true,
          tabId,
          isBackgroundTab: !isTabActive,
          dataUrl: resultUrl,
          clip: clip,
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
      const needsCrop = Boolean((mode === "element" || mode === "region") && clip);
      let finalUrl = rawUrl;
      if (needsCrop) {
        finalUrl = await cropDataUrlInWorker(rawUrl, clip);
      }
      resolve({
        success: true,
        tabId,
        isBackgroundTab: false,
        dataUrl: finalUrl,
        clip: clip,
        requiresCrop: false
      });
    });
  });
}
