/**
 * Agent Pilot - Screenshot Service
 * Captures high-resolution tab screenshots via CDP (background tabs) or captureVisibleTab
 */

import { attachedTabs, CDP_SCREENSHOT_TIMEOUT_MS, logDebug } from "./constants.js";
import { attachDebugger, sendCdpCommand } from "./cdp-manager.js";
import { sendTabMessageWithRetry } from "./tab-manager.js";

/**
 * Normalize screenshot format ("png" | "jpeg" | "webp") and quality (1..100).
 */
export function normalizeScreenshotFormat(rawFormat, rawQuality) {
  const lower = String(rawFormat || "png").toLowerCase().trim();
  const format = lower === "jpg" || lower === "jpeg" ? "jpeg" : lower === "webp" ? "webp" : "png";
  const mimeType = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
  let quality = undefined;
  if (format === "jpeg" || format === "webp") {
    const parsed = Number(rawQuality);
    quality = Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.min(100, Math.round(parsed))) : 85;
  }
  return {
    format,
    mimeType,
    quality,
    canvasQuality: quality !== undefined ? quality / 100 : undefined
  };
}

/**
 * OffscreenCanvas-based image cropping utility for Service Workers
 */
export async function cropDataUrlInWorker(dataUrl, clip, formatOpts = {}) {
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

    const croppedBlob = await canvas.convertToBlob({
      type: formatOpts.mimeType || "image/png",
      ...(formatOpts.canvasQuality !== undefined ? { quality: formatOpts.canvasQuality } : {})
    });
    return await blobToDataUrl(croppedBlob);
  } catch (err) {
    logDebug("OffscreenCanvas crop", err);
    return dataUrl;
  } finally {
    if (bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

async function convertDataUrlFormatInWorker(dataUrl, formatOpts = {}) {
  if (!dataUrl || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    return dataUrl;
  }
  let bitmap = null;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
    const convertedBlob = await canvas.convertToBlob({
      type: formatOpts.mimeType || "image/png",
      ...(formatOpts.canvasQuality !== undefined ? { quality: formatOpts.canvasQuality } : {})
    });
    return await blobToDataUrl(convertedBlob);
  } catch (err) {
    logDebug("OffscreenCanvas format convert", err);
    return dataUrl;
  } finally {
    if (bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

async function blobToDataUrl(blob) {
  if (typeof FileReader !== "undefined") {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

function wrapCanvasText(ctx, text, maxWidth, maxLines = 3) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const measure = (s) => (typeof ctx.measureText === "function" ? ctx.measureText(s).width : s.length * 8);
  const words = raw.split(/\s+/);
  const lines = [];
  let current = "";
  let truncated = false;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) > maxWidth && current) {
      if (lines.length >= maxLines - 1) {
        truncated = true;
        break;
      }
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) {
    if (truncated) {
      let clamped = `${current}…`;
      while (clamped.length > 2 && measure(clamped) > maxWidth) {
        clamped = `${clamped.slice(0, -2).trimEnd()}…`;
      }
      lines.push(clamped);
    } else {
      lines.push(current);
    }
  }
  return lines.slice(0, maxLines);
}

/**
 * OffscreenCanvas-based screenshot annotation utility for Service Workers.
 * Draws an optional highlight box and/or a non-intrusive step/title/description
 * banner directly onto the PNG image without mutating the page DOM.
 */
export async function annotateDataUrlInWorker(dataUrl, annotation = {}, formatOpts = {}) {
  if (!dataUrl || !annotation || typeof annotation !== "object") {
    return { dataUrl, annotated: false };
  }
  const title = String(annotation.title || annotation.caption || "").trim();
  const description = String(annotation.description || annotation.subtitle || "").trim();
  const step =
    annotation.step !== undefined && annotation.step !== null && String(annotation.step).trim() !== ""
      ? String(annotation.step).trim()
      : "";
  const rawPos = String(annotation.captionPosition || "bottom").toLowerCase().trim();
  const position = rawPos === "top" || rawPos === "header" ? "top" : "bottom";
  const highlightRect =
    annotation.highlightRect &&
    typeof annotation.highlightRect === "object" &&
    Number(annotation.highlightRect.width) > 0 &&
    Number(annotation.highlightRect.height) > 0
      ? annotation.highlightRect
      : null;

  const hasBanner = Boolean(title || description || step);
  if (!hasBanner && !highlightRect) {
    return { dataUrl, annotated: false };
  }
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    return { dataUrl, annotated: false };
  }

  let bitmap = null;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    bitmap = await createImageBitmap(blob);
    const imgW = bitmap.width;
    const imgH = bitmap.height;

    const canvas = new OffscreenCanvas(imgW, imgH);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, imgW, imgH);

    // 1. Optional target element highlight box
    if (highlightRect) {
      const vpW =
        highlightRect.viewportWidth ||
        (highlightRect.devicePixelRatio ? imgW / highlightRect.devicePixelRatio : imgW);
      const vpH =
        highlightRect.viewportHeight ||
        (highlightRect.devicePixelRatio ? imgH / highlightRect.devicePixelRatio : imgH);
      const scaleX = vpW > 0 ? imgW / vpW : 1;
      const scaleY = vpH > 0 ? imgH / vpH : 1;

      const hx = Math.max(2, Math.round(Number(highlightRect.x) * scaleX));
      const hy = Math.max(2, Math.round(Number(highlightRect.y) * scaleY));
      const hw = Math.min(imgW - hx - 2, Math.round(Number(highlightRect.width) * scaleX));
      const hh = Math.min(imgH - hy - 2, Math.round(Number(highlightRect.height) * scaleY));

      if (hw > 0 && hh > 0) {
        ctx.save();
        ctx.fillStyle = "rgba(56, 189, 248, 0.14)";
        ctx.fillRect(hx, hy, hw, hh);
        ctx.lineWidth = Math.max(3, Math.round(3 * scaleX));
        ctx.strokeStyle = "#0ea5e9";
        ctx.strokeRect(hx, hy, hw, hh);
        ctx.restore();
      }
    }

    // 2. Optional step / title / description banner
    if (hasBanner) {
      const scale = Math.max(1, Math.min(2.2, imgW / 1280));
      const padX = Math.round(24 * scale);
      const padY = Math.round(16 * scale);
      const titleFontPx = Math.round(20 * scale);
      const descFontPx = Math.round(15 * scale);
      const badgeFontPx = Math.round(14 * scale);
      const lineGap = Math.round(6 * scale);

      ctx.save();
      ctx.font = `600 ${descFontPx}px system-ui, -apple-system, sans-serif`;
      const descLines = description ? wrapCanvasText(ctx, description, imgW - padX * 2 - Math.round(16 * scale), 3) : [];

      const headerLineHeight = (step || title) ? Math.round(titleFontPx * 1.35) : 0;
      const descBlockHeight = descLines.length > 0
        ? descLines.length * Math.round(descFontPx * 1.35) + (headerLineHeight > 0 ? lineGap : 0)
        : 0;
      const bannerH = Math.min(imgH, padY * 2 + headerLineHeight + descBlockHeight);
      const bannerY = position === "top" ? 0 : Math.max(0, imgH - bannerH);

      // Dark translucent backdrop + top/bottom cyan accent border
      ctx.fillStyle = "rgba(15, 23, 42, 0.90)";
      ctx.fillRect(0, bannerY, imgW, bannerH);

      const accentH = Math.max(3, Math.round(4 * scale));
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(0, position === "top" ? bannerH - accentH : bannerY, imgW, accentH);

      let cursorX = padX;
      let cursorY = bannerY + padY;

      if (step) {
        const badgeLabel = /^step\b/i.test(step) ? step.toUpperCase() : `STEP ${step}`;
        ctx.font = `700 ${badgeFontPx}px system-ui, -apple-system, sans-serif`;
        const textW = typeof ctx.measureText === "function" ? ctx.measureText(badgeLabel).width : badgeLabel.length * 9;
        const badgeW = Math.round(textW + 20 * scale);
        const badgeH = Math.round(titleFontPx * 1.25);

        ctx.fillStyle = "#0284c7";
        ctx.fillRect(cursorX, cursorY, badgeW, badgeH);
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeLabel, cursorX + Math.round(10 * scale), cursorY + Math.round(badgeH / 2));
        cursorX += badgeW + Math.round(12 * scale);
      }

      if (title) {
        ctx.font = `700 ${titleFontPx}px system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = "#f8fafc";
        ctx.textBaseline = "top";
        ctx.fillText(title, cursorX, cursorY + Math.round(2 * scale));
      }

      if (headerLineHeight > 0) {
        cursorY += headerLineHeight + lineGap;
      }

      if (descLines.length > 0) {
        ctx.font = `400 ${descFontPx}px system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = "#cbd5e1";
        ctx.textBaseline = "top";
        const singleDescH = Math.round(descFontPx * 1.35);
        for (const line of descLines) {
          ctx.fillText(line, padX, cursorY);
          cursorY += singleDescH;
        }
      }
      ctx.restore();
    }

    const outBlob = await canvas.convertToBlob({
      type: formatOpts.mimeType || "image/png",
      ...(formatOpts.canvasQuality !== undefined ? { quality: formatOpts.canvasQuality } : {})
    });
    const annotatedUrl = await blobToDataUrl(outBlob);
    return { dataUrl: annotatedUrl, annotated: true };
  } catch (err) {
    logDebug("OffscreenCanvas annotate", err);
    return { dataUrl, annotated: false };
  } finally {
    if (bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

async function resolveAnnotationOptions(tabId, params, targetTab, clip, mode) {
  if (!params || typeof params !== "object") return null;
  const title = params.title || params.caption || "";
  const description = params.description || params.subtitle || "";
  const step = params.step;
  const captionPosition = params.captionPosition || "bottom";
  const highlightSelector = params.highlightSelector || params.highlight || "";
  let highlightRect = params.highlightBox && typeof params.highlightBox === "object"
    ? { ...params.highlightBox }
    : null;

  if (highlightSelector && !highlightRect) {
    try {
      const elRes = await sendTabMessageWithRetry(tabId, {
        action: "get_element_info",
        selector: highlightSelector,
        scrollIntoView: false
      });
      if (elRes && elRes.success && elRes.rect && elRes.rect.width > 0 && elRes.rect.height > 0) {
        highlightRect = {
          x: elRes.rect.x,
          y: elRes.rect.y,
          width: elRes.rect.width,
          height: elRes.rect.height,
          viewportWidth: elRes.viewport?.width || targetTab?.width,
          viewportHeight: elRes.viewport?.height || targetTab?.height,
          devicePixelRatio: elRes.viewport?.devicePixelRatio
        };
        if ((mode === "element" || mode === "region") && clip) {
          highlightRect.x = Math.max(0, highlightRect.x - clip.x);
          highlightRect.y = Math.max(0, highlightRect.y - clip.y);
          highlightRect.viewportWidth = clip.width;
          highlightRect.viewportHeight = clip.height;
        }
      }
    } catch (err) {
      logDebug("highlightSelector lookup", err);
    }
  }

  if (!title && !description && (step === undefined || step === null || String(step).trim() === "") && !highlightRect) {
    return null;
  }
  return {
    title,
    description,
    step,
    captionPosition,
    highlightRect
  };
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

  const annotationOpts = await resolveAnnotationOptions(tabId, params, targetTab, clip, mode);
  const formatOpts = normalizeScreenshotFormat(params.format, params.quality);

  // If targetTab is running in background or CDP is attached or full page requested, capture via CDP
  if (!isTabActive || attachedTabs.has(tabId) || isFullPage) {
    if (!attachedTabs.has(tabId)) {
      await attachDebugger(tabId).catch((err) => logDebug("attachDebugger in screenshot", err));
    }

    if (attachedTabs.has(tabId)) {
      const cdpParams = {
        format: formatOpts.format,
        ...(formatOpts.quality !== undefined ? { quality: formatOpts.quality } : {}),
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
          res = await sendCdpCommand(
            tabId,
            "Page.captureScreenshot",
            {
              format: formatOpts.format,
              ...(formatOpts.quality !== undefined ? { quality: formatOpts.quality } : {})
            },
            CDP_SCREENSHOT_TIMEOUT_MS
          );
          requiresCrop = Boolean((mode === "element" || mode === "region") && clip);
        }

        let resultUrl = `data:${formatOpts.mimeType};base64,` + res.data;
        if (requiresCrop && clip) {
          resultUrl = await cropDataUrlInWorker(resultUrl, clip, formatOpts);
          requiresCrop = false;
        }
        let annotated = false;
        if (annotationOpts) {
          const annRes = await annotateDataUrlInWorker(resultUrl, annotationOpts, formatOpts);
          resultUrl = annRes.dataUrl;
          annotated = annRes.annotated;
        }

        return {
          success: true,
          tabId,
          format: formatOpts.format,
          isBackgroundTab: !isTabActive,
          dataUrl: resultUrl,
          clip: clip,
          requiresCrop,
          ...(annotated ? { annotated: true } : {})
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
  const visibleFormat = formatOpts.format === "jpeg" ? "jpeg" : "png";
  const visibleOpts = {
    format: visibleFormat,
    ...(visibleFormat === "jpeg" && formatOpts.quality !== undefined ? { quality: formatOpts.quality } : {})
  };
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(winId, visibleOpts, async (rawUrl) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      const needsCrop = Boolean((mode === "element" || mode === "region") && clip);
      let finalUrl = rawUrl;
      if (needsCrop) {
        finalUrl = await cropDataUrlInWorker(rawUrl, clip, formatOpts);
      }
      let annotated = false;
      if (annotationOpts) {
        const annRes = await annotateDataUrlInWorker(finalUrl, annotationOpts, formatOpts);
        finalUrl = annRes.dataUrl;
        annotated = annRes.annotated;
      }
      if (!needsCrop && !annotated && visibleFormat !== formatOpts.format) {
        finalUrl = await convertDataUrlFormatInWorker(finalUrl, formatOpts);
      }
      resolve({
        success: true,
        tabId,
        format: formatOpts.format,
        isBackgroundTab: false,
        dataUrl: finalUrl,
        clip: clip,
        requiresCrop: false,
        ...(annotated ? { annotated: true } : {})
      });
    });
  });
}
