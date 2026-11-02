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

function dataUrlToBlob(dataUrl) {
  const str = String(dataUrl || "");
  const commaIdx = str.indexOf(",");
  if (commaIdx < 0) {
    throw new Error("Invalid dataUrl format");
  }
  const header = str.slice(0, commaIdx);
  const base64 = str.slice(commaIdx + 1);
  const mimeMatch = header.match(/^data:([^;]+);base64$/i);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * OffscreenCanvas-based image cropping utility for Service Workers
 */
export async function cropDataUrlInWorker(dataUrl, clip, formatOpts = {}) {
  if (!clip || !clip.width || !clip.height || typeof OffscreenCanvas === "undefined") {
    return dataUrl;
  }
  let bitmap = null;
  let overlayBitmap = null;
  try {
    const blob = dataUrlToBlob(dataUrl);
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

    // Composite in-page drawing / annotation overlay if provided
    const overlayUrl = (clip && clip.overlayDataUrl) || formatOpts.overlayDataUrl;
    if (overlayUrl && typeof overlayUrl === "string" && overlayUrl.startsWith("data:image/")) {
      try {
        const overlayBlob = dataUrlToBlob(overlayUrl);
        overlayBitmap = await createImageBitmap(overlayBlob);
        ctx.drawImage(overlayBitmap, 0, 0, sw, sh);
      } catch (overlayErr) {
        logDebug("cropDataUrlInWorker overlay draw failed", overlayErr);
      }
    }

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
    if (overlayBitmap && typeof overlayBitmap.close === "function") {
      overlayBitmap.close();
    }
  }
}

async function convertDataUrlFormatInWorker(dataUrl, formatOpts = {}) {
  if (!dataUrl || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    return dataUrl;
  }
  let bitmap = null;
  try {
    const blob = dataUrlToBlob(dataUrl);
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

const ANNOTATION_PALETTE = {
  cyan: { stroke: "#0ea5e9", fill: "rgba(14, 165, 233, 0.14)", solid: "#0284c7" },
  blue: { stroke: "#3b82f6", fill: "rgba(59, 130, 246, 0.14)", solid: "#2563eb" },
  info: { stroke: "#0ea5e9", fill: "rgba(14, 165, 233, 0.14)", solid: "#0284c7" },
  red: { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.15)", solid: "#dc2626" },
  error: { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.15)", solid: "#dc2626" },
  danger: { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.15)", solid: "#dc2626" },
  green: { stroke: "#22c55e", fill: "rgba(34, 197, 94, 0.15)", solid: "#16a34a" },
  success: { stroke: "#22c55e", fill: "rgba(34, 197, 94, 0.15)", solid: "#16a34a" },
  ok: { stroke: "#22c55e", fill: "rgba(34, 197, 94, 0.15)", solid: "#16a34a" },
  amber: { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.16)", solid: "#d97706" },
  yellow: { stroke: "#eab308", fill: "rgba(234, 179, 8, 0.16)", solid: "#ca8a04" },
  warn: { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.16)", solid: "#d97706" },
  warning: { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.16)", solid: "#d97706" },
  orange: { stroke: "#f97316", fill: "rgba(249, 115, 22, 0.15)", solid: "#ea580c" },
  purple: { stroke: "#a855f7", fill: "rgba(168, 85, 247, 0.15)", solid: "#9333ea" },
  violet: { stroke: "#8b5cf6", fill: "rgba(139, 92, 246, 0.15)", solid: "#7c3aed" },
  pink: { stroke: "#ec4899", fill: "rgba(236, 72, 153, 0.15)", solid: "#db2777" },
  white: { stroke: "#f8fafc", fill: "rgba(248, 250, 252, 0.14)", solid: "#475569" }
};

function resolveColorTheme(colorStr, fallback = "cyan") {
  const raw = String(colorStr || "").trim().toLowerCase();
  if (!raw) return ANNOTATION_PALETTE[fallback] || ANNOTATION_PALETTE.cyan;
  if (ANNOTATION_PALETTE[raw]) return ANNOTATION_PALETTE[raw];
  if (raw.startsWith("#") || raw.startsWith("rgb")) {
    return { stroke: colorStr.trim(), fill: "rgba(14, 165, 233, 0.12)", solid: colorStr.trim() };
  }
  return ANNOTATION_PALETTE[fallback] || ANNOTATION_PALETTE.cyan;
}

function scaleRectToCanvas(rect, imgW, imgH) {
  if (!rect || typeof rect !== "object") return null;
  const vpW = rect.viewportWidth || (rect.devicePixelRatio ? imgW / rect.devicePixelRatio : imgW);
  const vpH = rect.viewportHeight || (rect.devicePixelRatio ? imgH / rect.devicePixelRatio : imgH);
  const scaleX = vpW > 0 ? imgW / vpW : 1;
  const rawScaleY = vpH > 0 ? imgH / vpH : scaleX;
  // On full-page screenshots imgH >> vpH while pixels remain square (scaleY === scaleX)
  const scaleY = Math.abs(rawScaleY - scaleX) > 0.25 ? scaleX : rawScaleY;
  const hx = Math.max(2, Math.round(Number(rect.x || 0) * scaleX));
  const hy = Math.max(2, Math.round(Number(rect.y || 0) * scaleY));
  const hw = Math.min(imgW - hx - 2, Math.round(Number(rect.width || 0) * scaleX));
  const hh = Math.min(imgH - hy - 2, Math.round(Number(rect.height || 0) * scaleY));
  if (!(hw > 0 && hh > 0)) return null;
  return { x: hx, y: hy, width: hw, height: hh, scaleX, scaleY };
}

function rectsOverlap(a, b, pad = 2) {
  return (
    a.x - pad < b.x + b.width &&
    a.x + a.width + pad > b.x &&
    a.y - pad < b.y + b.height &&
    a.y + a.height + pad > b.y
  );
}

function drawLabelPill(ctx, text, x, y, theme, scale, imgW, imgH, align = "left", occupiedRects = null, anchorRect = null) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  const fontPx = Math.round(14 * scale);
  const padX = Math.round(10 * scale);
  const padY = Math.round(6 * scale);
  ctx.save();
  ctx.font = `700 ${fontPx}px system-ui, -apple-system, sans-serif`;
  const maxBoxW = Math.max(120, Math.min(Math.round(360 * scale), imgW - 16));
  const lines = wrapCanvasText(ctx, clean, maxBoxW - padX * 2, 2);
  let maxLineW = 0;
  for (const line of lines) {
    const w = typeof ctx.measureText === "function" ? ctx.measureText(line).width : line.length * 8;
    if (w > maxLineW) maxLineW = w;
  }
  const lineH = Math.round(fontPx * 1.3);
  const boxW = Math.min(imgW - 8, Math.round(maxLineW + padX * 2));
  const boxH = Math.round(lines.length * lineH + padY * 2);

  let bx = align === "center" ? Math.round(x - boxW / 2) : align === "right" ? Math.round(x - boxW) : Math.round(x);
  let by = Math.round(y);
  bx = Math.max(4, Math.min(imgW - boxW - 4, bx));
  by = Math.max(4, Math.min(imgH - boxH - 4, by));

  if (Array.isArray(occupiedRects) && occupiedRects.length > 0) {
    const candidates = [{ x: bx, y: by }];
    if (anchorRect) {
      // Candidate below anchor
      candidates.push({ x: bx, y: Math.min(imgH - boxH - 4, anchorRect.y + anchorRect.height + Math.round(6 * scale)) });
      // Candidate above anchor
      candidates.push({ x: bx, y: Math.max(4, anchorRect.y - boxH - Math.round(6 * scale)) });
      // Candidate to right of anchor
      candidates.push({
        x: Math.min(imgW - boxW - 4, anchorRect.x + anchorRect.width + Math.round(8 * scale)),
        y: Math.max(4, Math.round(anchorRect.y + (anchorRect.height - boxH) / 2))
      });
    }
    candidates.push({ x: bx, y: Math.min(imgH - boxH - 4, by + boxH + Math.round(8 * scale)) });
    candidates.push({ x: bx, y: Math.max(4, by - boxH - Math.round(8 * scale)) });

    for (const cand of candidates) {
      const testRect = { x: cand.x, y: cand.y, width: boxW, height: boxH };
      if (!occupiedRects.some((occ) => occ !== anchorRect && rectsOverlap(testRect, occ, 2))) {
        bx = cand.x;
        by = cand.y;
        break;
      }
    }
  }

  ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.lineWidth = Math.max(2, Math.round(2 * scale));
  ctx.strokeStyle = theme.stroke;
  ctx.strokeRect(bx, by, boxW, boxH);

  ctx.fillStyle = "#f8fafc";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], bx + padX, by + padY + i * lineH);
  }
  ctx.restore();
  const outRect = { x: bx, y: by, width: boxW, height: boxH };
  if (Array.isArray(occupiedRects)) {
    occupiedRects.push(outRect);
  }
  return outRect;
}

function drawVectorArrow(ctx, fromX, fromY, toX, toY, theme, scale) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const angle = Math.atan2(dy, dx);
  const headLen = Math.min(Math.max(10, Math.round(15 * scale)), Math.max(8, Math.round(len * 0.55)));
  const headAngle = Math.PI / 6.2;
  const shaftEndX = toX - Math.cos(angle) * (headLen * 0.55);
  const shaftEndY = toY - Math.sin(angle) * (headLen * 0.55);
  const wing1X = toX - headLen * Math.cos(angle - headAngle);
  const wing1Y = toY - headLen * Math.sin(angle - headAngle);
  const wing2X = toX - headLen * Math.cos(angle + headAngle);
  const wing2Y = toY - headLen * Math.sin(angle + headAngle);

  ctx.save();
  // High-contrast white halo so the arrow stands out on both dark & light backgrounds
  if (typeof ctx.beginPath === "function") {
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.lineWidth = Math.max(5, Math.round(6 * scale));
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.stroke?.();

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.lineWidth = Math.max(3, Math.round(3.5 * scale));
    ctx.strokeStyle = theme.stroke;
    ctx.stroke?.();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(wing1X, wing1Y);
    ctx.lineTo(wing2X, wing2Y);
    ctx.closePath?.();
    ctx.fillStyle = theme.stroke;
    ctx.fill?.();
    ctx.lineWidth = Math.max(1.5, Math.round(1.5 * scale));
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.stroke?.();
  } else {
    ctx.fillStyle = theme.stroke;
    ctx.fillRect(Math.min(fromX, toX), Math.min(fromY, toY), Math.max(4, Math.abs(dx)), Math.max(4, Math.abs(dy)));
  }
  ctx.restore();
}

function drawVectorIcon(ctx, iconType, cx, cy, scale, customColor = "") {
  const type = String(iconType || "check").toLowerCase().trim();
  const radius = Math.max(12, Math.round(14 * scale));
  const defaultThemeKey =
    type === "error" || type === "cross" || type === "fail" || type === "x"
      ? "red"
      : type === "warn" || type === "warning" || type === "alert"
        ? "amber"
        : type === "info"
          ? "blue"
          : type === "click" || type === "cursor" || type === "pointer"
            ? "cyan"
            : "green";
  const theme = resolveColorTheme(customColor, defaultThemeKey);

  ctx.save();
  if (type === "click" || type === "cursor" || type === "pointer") {
    // Concentric ripple rings + pointer triangle
    if (typeof ctx.beginPath === "function" && typeof ctx.arc === "function") {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.25, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, Math.round(2 * scale));
      ctx.strokeStyle = theme.stroke;
      ctx.stroke?.();

      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.65, 0, Math.PI * 2);
      ctx.fillStyle = theme.fill;
      ctx.fill?.();
      ctx.stroke?.();

      // Cursor arrow tip at (cx, cy)
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.round(16 * scale), cy + Math.round(6 * scale));
      ctx.lineTo(cx + Math.round(10 * scale), cy + Math.round(10 * scale));
      ctx.lineTo(cx + Math.round(14 * scale), cy + Math.round(18 * scale));
      ctx.lineTo(cx + Math.round(10 * scale), cy + Math.round(20 * scale));
      ctx.lineTo(cx + Math.round(6 * scale), cy + Math.round(12 * scale));
      ctx.lineTo(cx + Math.round(2 * scale), cy + Math.round(16 * scale));
      ctx.closePath?.();
      ctx.fillStyle = "#ffffff";
      ctx.fill?.();
      ctx.lineWidth = Math.max(2, Math.round(2 * scale));
      ctx.strokeStyle = "#0f172a";
      ctx.stroke?.();
    } else {
      ctx.fillStyle = theme.solid;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
    ctx.restore();
    return { radius, theme };
  }

  // Circular badge backdrop
  if (typeof ctx.beginPath === "function" && typeof ctx.arc === "function") {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = theme.solid;
    ctx.fill?.();
    ctx.lineWidth = Math.max(2, Math.round(2.5 * scale));
    ctx.strokeStyle = "#ffffff";
    ctx.stroke?.();
  } else {
    ctx.fillStyle = theme.solid;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  // Inner vector glyph
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = Math.max(2.5, Math.round(2.8 * scale));
  if (typeof ctx.beginPath === "function") {
    if (type === "error" || type === "cross" || type === "fail" || type === "x") {
      const d = Math.round(radius * 0.42);
      ctx.beginPath();
      ctx.moveTo(cx - d, cy - d);
      ctx.lineTo(cx + d, cy + d);
      ctx.moveTo(cx + d, cy - d);
      ctx.lineTo(cx - d, cy + d);
      ctx.stroke?.();
    } else if (type === "warn" || type === "warning" || type === "alert") {
      ctx.beginPath();
      ctx.moveTo(cx, cy - Math.round(radius * 0.5));
      ctx.lineTo(cx, cy + Math.round(radius * 0.1));
      ctx.stroke?.();
      ctx.fillRect(cx - Math.max(1, Math.round(1.5 * scale)), cy + Math.round(radius * 0.32), Math.max(3, Math.round(3 * scale)), Math.max(3, Math.round(3 * scale)));
    } else if (type === "info") {
      ctx.fillRect(cx - Math.max(1, Math.round(1.5 * scale)), cy - Math.round(radius * 0.52), Math.max(3, Math.round(3 * scale)), Math.max(3, Math.round(3 * scale)));
      ctx.beginPath();
      ctx.moveTo(cx, cy - Math.round(radius * 0.15));
      ctx.lineTo(cx, cy + Math.round(radius * 0.52));
      ctx.stroke?.();
    } else {
      // Checkmark
      ctx.beginPath();
      ctx.moveTo(cx - Math.round(radius * 0.45), cy + Math.round(radius * 0.02));
      ctx.lineTo(cx - Math.round(radius * 0.12), cy + Math.round(radius * 0.38));
      ctx.lineTo(cx + Math.round(radius * 0.48), cy - Math.round(radius * 0.34));
      ctx.stroke?.();
    }
  }
  ctx.restore();
  return { radius, theme };
}

/**
 * OffscreenCanvas-based screenshot annotation utility for Service Workers.
 * Draws optional redactions, spotlight dimming, highlight boxes, circles,
 * arrows, callouts, numbered step badges, vector status icons, and a
 * step/title/description banner directly onto the image without mutating page DOM.
 */
export async function annotateDataUrlInWorker(dataUrl, annotation = {}, formatOpts = {}) {
  if (!dataUrl || !annotation || typeof annotation !== "object") {
    return { dataUrl, annotated: false };
  }
  const title = String(annotation.title || annotation.caption || annotation.text || "").trim();
  const description = String(annotation.description || annotation.subtitle || "").trim();
  const step =
    annotation.step !== undefined && annotation.step !== null && String(annotation.step).trim() !== ""
      ? String(annotation.step).trim()
      : "";
  const rawPos = String(annotation.captionPosition || annotation.position || "bottom").toLowerCase().trim();
  const position = rawPos === "top" || rawPos === "header" ? "top" : "bottom";
  const highlightRect =
    annotation.highlightRect &&
    typeof annotation.highlightRect === "object" &&
    Number(annotation.highlightRect.width) > 0 &&
    Number(annotation.highlightRect.height) > 0
      ? annotation.highlightRect
      : null;

  const boxes = Array.isArray(annotation.boxes) ? annotation.boxes : [];
  const circles = Array.isArray(annotation.circles) ? annotation.circles : [];
  const arrows = Array.isArray(annotation.arrows) ? annotation.arrows : [];
  const callouts = Array.isArray(annotation.callouts) ? annotation.callouts : [];
  const badges = Array.isArray(annotation.badges) ? annotation.badges : [];
  const icons = Array.isArray(annotation.icons) ? annotation.icons : [];
  const redactRects = Array.isArray(annotation.redactRects) ? annotation.redactRects : [];
  const interactiveMarks = Array.isArray(annotation.interactiveMarks) ? annotation.interactiveMarks : [];
  const somColor = annotation.somColor || "amber";
  const spotlight = Boolean(annotation.spotlight);

  const hasBanner = Boolean(title || description || step);
  const hasRichOverlays =
    Boolean(highlightRect) ||
    boxes.length > 0 ||
    circles.length > 0 ||
    arrows.length > 0 ||
    callouts.length > 0 ||
    badges.length > 0 ||
    icons.length > 0 ||
    redactRects.length > 0 ||
    interactiveMarks.length > 0;

  if (!hasBanner && !hasRichOverlays) {
    return { dataUrl, annotated: false };
  }
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    return { dataUrl, annotated: false };
  }

  let bitmap = null;
  try {
    const blob = dataUrlToBlob(dataUrl);
    bitmap = await createImageBitmap(blob);
    const imgW = bitmap.width;
    const imgH = bitmap.height;
    const scale = Math.max(1, Math.min(2.2, imgW / 1280));

    const canvas = new OffscreenCanvas(imgW, imgH);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, imgW, imgH);

    // 0. Redact sensitive regions first (permanently masks underlying pixels)
    for (const rItem of redactRects) {
      const sr = scaleRectToCanvas(rItem.rect || rItem, imgW, imgH);
      if (!sr) continue;
      ctx.save();
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(sr.x, sr.y, sr.width, sr.height);
      ctx.lineWidth = Math.max(2, Math.round(2 * scale));
      ctx.strokeStyle = "#475569";
      ctx.strokeRect(sr.x, sr.y, sr.width, sr.height);
      if (sr.width >= 60 && sr.height >= 18) {
        const label = rItem.label || "REDACTED";
        ctx.font = `700 ${Math.max(10, Math.round(11 * scale))}px monospace`;
        ctx.fillStyle = "#94a3b8";
        ctx.textBaseline = "middle";
        const tw = typeof ctx.measureText === "function" ? ctx.measureText(label).width : label.length * 7;
        ctx.fillText(label, sr.x + Math.max(4, Math.round((sr.width - tw) / 2)), sr.y + Math.round(sr.height / 2));
      }
      ctx.restore();
    }

    const focusRects = [];
    if (highlightRect) {
      const sr = scaleRectToCanvas(highlightRect, imgW, imgH);
      if (sr) focusRects.push(sr);
    }
    for (const list of [boxes, circles, badges, callouts, icons]) {
      for (const item of list) {
        const sr = scaleRectToCanvas(item.rect, imgW, imgH);
        if (sr) focusRects.push(sr);
      }
    }
    for (const item of arrows) {
      const toSr = scaleRectToCanvas(item.toRect || item.rect, imgW, imgH);
      if (toSr) focusRects.push(toSr);
      const fromSr = scaleRectToCanvas(item.fromRect, imgW, imgH);
      if (fromSr) focusRects.push(fromSr);
    }

    // Track occupied regions so labels and callouts never overlap elements, badges, or other labels
    const occupiedRects = [...focusRects];

    // 0b. Optional Spotlight dimming outside target rects
    if (spotlight && focusRects.length > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(15, 23, 42, 0.56)";
      if (typeof ctx.beginPath === "function" && typeof ctx.rect === "function" && typeof ctx.clip === "function") {
        ctx.beginPath();
        ctx.rect(0, 0, imgW, imgH);
        for (const fr of focusRects) {
          ctx.rect(Math.max(0, fr.x), Math.max(0, fr.y), Math.min(imgW, fr.width), Math.min(imgH, fr.height));
        }
        ctx.clip("evenodd");
        ctx.fillRect(0, 0, imgW, imgH);
      } else {
        // Fallback 4-band dim around the primary focus rect
        const fr = focusRects[0];
        if (fr.y > 0) ctx.fillRect(0, 0, imgW, fr.y);
        if (fr.y + fr.height < imgH) ctx.fillRect(0, fr.y + fr.height, imgW, imgH - (fr.y + fr.height));
        if (fr.x > 0) ctx.fillRect(0, fr.y, fr.x, fr.height);
        if (fr.x + fr.width < imgW) ctx.fillRect(fr.x + fr.width, fr.y, imgW - (fr.x + fr.width), fr.height);
      }
      ctx.restore();
    }

    // 0c. Set-of-Marks (SoM) Interactive Badges & Bounding Boxes
    if (interactiveMarks.length > 0) {
      const somTheme = resolveColorTheme(somColor, "amber");
      for (const mark of interactiveMarks) {
        const sr = scaleRectToCanvas(mark.rect, imgW, imgH);
        if (!sr || sr.width <= 0 || sr.height <= 0) continue;

        ctx.save();
        // 1. Subtle bounding box border & fill
        ctx.fillStyle = somTheme.fill || "rgba(245, 158, 11, 0.12)";
        ctx.fillRect(sr.x, sr.y, sr.width, sr.height);
        ctx.lineWidth = Math.max(1.5, Math.round(1.5 * scale));
        ctx.strokeStyle = somTheme.stroke || "#f59e0b";
        ctx.strokeRect(sr.x, sr.y, sr.width, sr.height);

        // 2. High-contrast compact badge pill at top-left
        const badgeText = String(mark.ref || `@${mark.index}`);
        const fontSize = Math.max(10, Math.round(11 * scale));
        ctx.font = `700 ${fontSize}px monospace, system-ui, sans-serif`;
        const textMetrics = typeof ctx.measureText === "function" ? ctx.measureText(badgeText) : { width: badgeText.length * 7 };
        const textWidth = Math.round(textMetrics.width || badgeText.length * 7);
        const padX = Math.max(3, Math.round(4 * scale));
        const padY = Math.max(1, Math.round(2 * scale));
        const pillW = textWidth + padX * 2;
        const pillH = fontSize + padY * 2 + 1;

        // Position at top-left of element bounding box
        let pillX = sr.x;
        let pillY = sr.y - pillH;
        if (pillY < 2) {
          pillY = sr.y;
        }
        if (pillX + pillW > imgW - 2) {
          pillX = Math.max(2, imgW - pillW - 2);
        }

        // Draw pill background
        ctx.fillStyle = somTheme.solid || "#f59e0b";
        if (typeof ctx.beginPath === "function" && typeof ctx.roundRect === "function") {
          ctx.beginPath();
          ctx.roundRect(pillX, pillY, pillW, pillH, Math.max(2, Math.round(3 * scale)));
          ctx.fill?.();
          ctx.lineWidth = 1;
          ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
          ctx.stroke?.();
        } else {
          ctx.fillRect(pillX, pillY, pillW, pillH);
        }

        // Draw badge text with high-contrast dark font on solid bright badge
        ctx.fillStyle = "#0f172a";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeText, pillX + padX, pillY + Math.round(pillH / 2));
        ctx.restore();

        occupiedRects.push({ x: pillX, y: pillY, width: pillW, height: pillH });
      }
    }

    // 1. Primary target element highlight box
    if (highlightRect) {
      const sr = scaleRectToCanvas(highlightRect, imgW, imgH);
      if (sr) {
        ctx.save();
        ctx.fillStyle = "rgba(56, 189, 248, 0.14)";
        ctx.fillRect(sr.x, sr.y, sr.width, sr.height);
        ctx.lineWidth = Math.max(3, Math.round(3 * sr.scaleX));
        ctx.strokeStyle = "#0ea5e9";
        ctx.strokeRect(sr.x, sr.y, sr.width, sr.height);
        ctx.restore();
      }
    }

    // 2. Numbered Step Badges (--badge)
    for (let i = 0; i < badges.length; i++) {
      const badge = badges[i];
      const sr = scaleRectToCanvas(badge.rect, imgW, imgH);
      if (!sr) continue;
      const theme = resolveColorTheme(badge.color, "cyan");
      const numText = String(badge.number ?? badge.badge ?? (i + 1)).trim();
      const radius = Math.max(13, Math.round(15 * scale));

      if (sr.width > 8 && sr.height > 8) {
        ctx.save();
        ctx.fillStyle = theme.fill;
        ctx.fillRect(sr.x, sr.y, sr.width, sr.height);
        ctx.lineWidth = Math.max(2, Math.round(2.5 * scale));
        ctx.strokeStyle = theme.stroke;
        ctx.strokeRect(sr.x, sr.y, sr.width, sr.height);
        ctx.restore();
      }

      const bx = Math.max(radius + 2, Math.min(imgW - radius - 2, sr.x));
      const by = Math.max(radius + 2, Math.min(imgH - radius - 2, sr.y));
      occupiedRects.push({ x: bx - radius, y: by - radius, width: radius * 2, height: radius * 2 });

      ctx.save();
      if (typeof ctx.beginPath === "function" && typeof ctx.arc === "function") {
        ctx.beginPath();
        ctx.arc(bx, by, radius, 0, Math.PI * 2);
        ctx.fillStyle = theme.solid;
        ctx.fill?.();
        ctx.lineWidth = Math.max(2, Math.round(2.5 * scale));
        ctx.strokeStyle = "#ffffff";
        ctx.stroke?.();
      } else {
        ctx.fillStyle = theme.solid;
        ctx.fillRect(bx - radius, by - radius, radius * 2, radius * 2);
      }
      ctx.font = `700 ${Math.round(14 * scale)}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      const tw = typeof ctx.measureText === "function" ? ctx.measureText(numText).width : numText.length * 8;
      ctx.fillText(numText, Math.round(bx - tw / 2), by);
      ctx.restore();

      if (badge.label) {
        const labelY = sr.y >= Math.round(34 * scale) ? sr.y - Math.round(30 * scale) : sr.y + sr.height + Math.round(4 * scale);
        drawLabelPill(ctx, badge.label, bx + radius + Math.round(6 * scale), labelY, theme, scale, imgW, imgH, "left", occupiedRects, sr);
      }
    }

    // 3. Vector Status Icons (--icon)
    for (const icon of icons) {
      const sr = scaleRectToCanvas(icon.rect, imgW, imgH);
      if (!sr) continue;
      const type = String(icon.type || icon.icon || "check").toLowerCase().trim();
      const isClick = type === "click" || type === "cursor" || type === "pointer";
      const ix = isClick ? Math.round(sr.x + sr.width / 2) : Math.min(imgW - 18, Math.max(18, sr.x + sr.width - Math.round(4 * scale)));
      const iy = isClick ? Math.round(sr.y + sr.height / 2) : Math.max(18, sr.y + Math.round(4 * scale));
      const { radius, theme } = drawVectorIcon(ctx, type, ix, iy, scale, icon.color);
      occupiedRects.push({ x: ix - radius, y: iy - radius, width: radius * 2, height: radius * 2 });
      if (icon.label) {
        const labelY = iy >= Math.round(34 * scale) ? iy - radius - Math.round(28 * scale) : iy + radius + Math.round(6 * scale);
        drawLabelPill(ctx, icon.label, ix + radius + Math.round(6 * scale), labelY, theme, scale, imgW, imgH, "left", occupiedRects, sr);
      }
    }

    // 4. Custom Boxes (--box)
    for (const box of boxes) {
      const sr = scaleRectToCanvas(box.rect, imgW, imgH);
      if (!sr) continue;
      const theme = resolveColorTheme(box.color, "cyan");
      ctx.save();
      ctx.fillStyle = theme.fill;
      ctx.fillRect(sr.x, sr.y, sr.width, sr.height);
      if (box.dashed && typeof ctx.setLineDash === "function") {
        ctx.setLineDash([Math.round(8 * scale), Math.round(5 * scale)]);
      }
      ctx.lineWidth = Math.max(3, Math.round(3 * sr.scaleX));
      ctx.strokeStyle = theme.stroke;
      ctx.strokeRect(sr.x, sr.y, sr.width, sr.height);
      ctx.restore();
      if (box.label) {
        const labelY = sr.y >= Math.round(34 * scale) ? sr.y - Math.round(30 * scale) : sr.y + sr.height + Math.round(4 * scale);
        drawLabelPill(ctx, box.label, sr.x, labelY, theme, scale, imgW, imgH, "left", occupiedRects, sr);
      }
    }

    // 5. Circles / Ellipses (--circle)
    for (const circle of circles) {
      const sr = scaleRectToCanvas(circle.rect, imgW, imgH);
      if (!sr) continue;
      const theme = resolveColorTheme(circle.color, "red");
      const cx = Math.round(sr.x + sr.width / 2);
      const cy = Math.round(sr.y + sr.height / 2);
      const rx = Math.max(12, Math.round(sr.width / 2 + 8 * scale));
      const ry = Math.max(12, Math.round(sr.height / 2 + 8 * scale));
      const ellipseBounds = { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
      occupiedRects.push(ellipseBounds);
      ctx.save();
      if (circle.dashed && typeof ctx.setLineDash === "function") {
        ctx.setLineDash([Math.round(8 * scale), Math.round(5 * scale)]);
      }
      if (typeof ctx.beginPath === "function" && typeof ctx.ellipse === "function") {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = theme.fill;
        ctx.fill?.();
        ctx.lineWidth = Math.max(3, Math.round(3 * scale));
        ctx.strokeStyle = theme.stroke;
        ctx.stroke?.();
      } else {
        ctx.strokeStyle = theme.stroke;
        ctx.lineWidth = Math.max(3, Math.round(3 * scale));
        ctx.strokeRect(cx - rx, cy - ry, rx * 2, ry * 2);
      }
      ctx.restore();
      if (circle.label) {
        const labelY = cy - ry >= Math.round(36 * scale) ? cy - ry - Math.round(32 * scale) : cy + ry + Math.round(6 * scale);
        drawLabelPill(ctx, circle.label, cx, labelY, theme, scale, imgW, imgH, "center", occupiedRects, ellipseBounds);
      }
    }

    // 6. Arrows (--arrow) & Callouts (--callout)
    const allArrows = [
      ...arrows.map((a) => ({ ...a, isCallout: false })),
      ...callouts.map((c) => ({ ...c, isCallout: true }))
    ];
    for (const item of allArrows) {
      const theme = resolveColorTheme(item.color, item.isCallout ? "amber" : "red");
      const toSr = scaleRectToCanvas(item.toRect || item.rect, imgW, imgH);
      const fromSr = scaleRectToCanvas(item.fromRect, imgW, imgH);
      if (!toSr) continue;

      // Subtle outline around target element when it has an actual area
      if (toSr.width > 8 && toSr.height > 8) {
        ctx.save();
        ctx.lineWidth = Math.max(2, Math.round(2.5 * scale));
        ctx.strokeStyle = theme.stroke;
        ctx.strokeRect(toSr.x, toSr.y, toSr.width, toSr.height);
        ctx.restore();
      }

      const targetCenterX = Math.round(toSr.x + toSr.width / 2);
      const targetCenterY = Math.round(toSr.y + toSr.height / 2);
      let fromX, fromY, toX, toY;
      const offsetDist = Math.round(52 * scale);
      let dir = String(item.position || item.direction || "").toLowerCase();

      if (!fromSr && !dir) {
        // Choose 'bottom' if there are occupied elements above toSr, otherwise 'top' if space allows
        const topZone = {
          x: toSr.x - Math.round(40 * scale),
          y: Math.max(0, toSr.y - Math.round(130 * scale)),
          width: toSr.width + Math.round(80 * scale),
          height: Math.round(126 * scale)
        };
        const bottomZone = {
          x: toSr.x - Math.round(40 * scale),
          y: toSr.y + toSr.height + 4,
          width: toSr.width + Math.round(80 * scale),
          height: Math.round(110 * scale)
        };
        const topBusy = occupiedRects.some((occ) => occ !== toSr && rectsOverlap(topZone, occ, 0));
        const bottomBusy = occupiedRects.some((occ) => occ !== toSr && rectsOverlap(bottomZone, occ, 0));
        if (topBusy && !bottomBusy && toSr.y + toSr.height + offsetDist + 60 < imgH) {
          dir = "bottom";
        } else if (!topBusy && toSr.y > offsetDist + 48) {
          dir = "top";
        } else if (toSr.y + toSr.height + offsetDist + 60 < imgH) {
          dir = "bottom";
        }
      }

      if (fromSr) {
        const fromCenterX = Math.round(fromSr.x + fromSr.width / 2);
        const fromCenterY = Math.round(fromSr.y + fromSr.height / 2);
        const fHalfW = Math.max(2, fromSr.width / 2);
        const fHalfH = Math.max(2, fromSr.height / 2);
        const fvx = targetCenterX - fromCenterX;
        const fvy = targetCenterY - fromCenterY;
        if (fromSr.width > 8 && fromSr.height > 8 && (Math.abs(fvx) > fHalfW || Math.abs(fvy) > fHalfH)) {
          const ftx = fvx !== 0 ? Math.abs(fHalfW / fvx) : Infinity;
          const fty = fvy !== 0 ? Math.abs(fHalfH / fvy) : Infinity;
          const ft = Math.min(1, Math.min(ftx, fty));
          fromX = Math.round(fromCenterX + fvx * ft);
          fromY = Math.round(fromCenterY + fvy * ft);
        } else {
          fromX = fromCenterX;
          fromY = fromCenterY;
        }
      } else if (dir === "top") {
        fromX = Math.max(40, Math.min(imgW - 40, targetCenterX - Math.round(32 * scale)));
        fromY = Math.max(24, toSr.y - offsetDist);
      } else if (dir === "bottom") {
        fromX = Math.max(40, Math.min(imgW - 40, targetCenterX + Math.round(28 * scale)));
        fromY = Math.min(imgH - 24, toSr.y + toSr.height + offsetDist);
      } else if (dir === "left" || targetCenterX > imgW / 2) {
        fromX = Math.max(24, toSr.x - offsetDist);
        fromY = targetCenterY;
      } else {
        fromX = Math.min(imgW - 24, toSr.x + toSr.width + offsetDist);
        fromY = targetCenterY;
      }

      // Snap arrowhead to the nearest point on the target bounding box so it doesn't cover inner text
      const halfW = Math.max(2, toSr.width / 2);
      const halfH = Math.max(2, toSr.height / 2);
      const vx = fromX - targetCenterX;
      const vy = fromY - targetCenterY;
      if (Math.abs(vx) <= halfW && Math.abs(vy) <= halfH) {
        toX = targetCenterX;
        toY = targetCenterY;
      } else {
        const tx = vx !== 0 ? Math.abs(halfW / vx) : Infinity;
        const ty = vy !== 0 ? Math.abs(halfH / vy) : Infinity;
        const t = Math.min(1, Math.min(tx, ty));
        toX = Math.round(targetCenterX + vx * t);
        toY = Math.round(targetCenterY + vy * t);
      }

      drawVectorArrow(ctx, fromX, fromY, toX, toY, theme, scale);
      if (item.label || item.text) {
        if (fromSr) {
          const midX = Math.round((fromX + toX) / 2);
          const isHorizontal = Math.abs(toX - fromX) >= Math.abs(toY - fromY);
          const belowY = Math.max(fromSr.y + fromSr.height, toSr.y + toSr.height) + Math.round(6 * scale);
          const midY = isHorizontal ? belowY : Math.round((fromY + toY) / 2) - Math.round(14 * scale);
          drawLabelPill(ctx, item.label || item.text, midX, midY, theme, scale, imgW, imgH, "center", occupiedRects);
        } else {
          const labelY = fromY <= toY ? Math.max(4, fromY - Math.round(32 * scale)) : Math.min(imgH - 36, fromY + Math.round(4 * scale));
          drawLabelPill(ctx, item.label || item.text, fromX, labelY, theme, scale, imgW, imgH, "center", occupiedRects);
        }
      }
    }

    // 7. Optional step / title / description banner
    if (hasBanner) {
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

function parseCoordinateTarget(rawTarget) {
  if (!rawTarget || typeof rawTarget !== "string") return null;
  const nums = rawTarget.split(",").map((s) => Number(s.trim()));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums.length === 2) {
    return { x: nums[0], y: nums[1], width: 4, height: 4 };
  }
  if (nums.length === 3) {
    const r = Math.max(4, nums[2]);
    return { x: nums[0] - r, y: nums[1] - r, width: r * 2, height: r * 2 };
  }
  if (nums.length === 4 && nums[2] > 0 && nums[3] > 0) {
    return { x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
  }
  return null;
}

const CSS_PSEUDO_PREFIX_RE = /^(nth-[a-z-]+|first-(?:child|of-type)|last-(?:child|of-type)|only-(?:child|of-type)|not|has|is|where|hover|focus(?:-[a-z]+)?|active|checked|disabled|enabled|empty|root|visited|link|target|required|optional|valid|invalid|read-only|read-write|placeholder-shown)\b/i;

function splitTargetAndLabel(str) {
  // Scan left-to-right, skipping CSS pseudo-classes/elements (:nth-child(1), :not(...), :first-child, ::after)
  // and splitting at the FIRST non-pseudo colon so labels containing ':' or '()' stay intact.
  const s = String(str || "").trim();
  let i = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "[") {
      bracketDepth++;
      i++;
      continue;
    }
    if (ch === "]" && bracketDepth > 0) {
      bracketDepth--;
      i++;
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === ")" && parenDepth > 0) {
      parenDepth--;
      i++;
      continue;
    }
    if (ch === ":" && parenDepth === 0 && bracketDepth === 0) {
      if (s[i + 1] === ":") {
        // Skip ::pseudo-element
        i += 2;
        while (i < s.length && /[a-zA-Z0-9_-]/.test(s[i])) i++;
        continue;
      }
      const rest = s.slice(i + 1);
      const pseudoMatch = rest.match(CSS_PSEUDO_PREFIX_RE);
      if (pseudoMatch) {
        i += 1 + pseudoMatch[0].length;
        if (s[i] === "(") {
          let depth = 0;
          while (i < s.length) {
            if (s[i] === "(") depth++;
            else if (s[i] === ")") {
              depth--;
              if (depth === 0) {
                i++;
                break;
              }
            }
            i++;
          }
        }
        continue;
      }
      return {
        targetPart: s.slice(0, i).trim(),
        labelPart: s.slice(i + 1).trim()
      };
    }
    i++;
  }
  return { targetPart: s, labelPart: "" };
}

function parseStyleModifiers(rawStr) {
  const parts = String(rawStr || "").split("|").map((p) => p.trim()).filter(Boolean);
  const head = parts.shift() || "";
  let color = "";
  let dashed = false;
  let position = "";
  for (const mod of parts) {
    const lower = mod.toLowerCase();
    if (lower === "dashed" || lower === "dash") dashed = true;
    else if (lower === "top" || lower === "bottom" || lower === "left" || lower === "right") position = lower;
    else if (!color) color = mod;
  }
  return { head, color, dashed, position };
}

/**
 * Parse shorthand CLI string or object into normalized annotation item before DOM lookup.
 */
export function parseAnnotationSpecItem(kind, rawItem, index = 0) {
  if (!rawItem) return null;
  if (typeof rawItem === "object") return { ...rawItem };
  const str = String(rawItem).trim();
  if (!str) return null;

  if (kind === "redact") {
    const { targetPart, labelPart } = splitTargetAndLabel(str);
    const { head: selector } = parseStyleModifiers(targetPart);
    const labelMods = parseStyleModifiers(labelPart);
    return { selector, ...(labelMods.head ? { label: labelMods.head } : {}) };
  }

  if (kind === "box" || kind === "circle") {
    const { targetPart, labelPart } = splitTargetAndLabel(str);
    const { head: selector, color, dashed } = parseStyleModifiers(targetPart);
    const labelMods = parseStyleModifiers(labelPart);
    return {
      selector,
      label: labelMods.head,
      color: color || labelMods.color,
      dashed: dashed || labelMods.dashed
    };
  }

  if (kind === "arrow") {
    const { targetPart, labelPart } = splitTargetAndLabel(str);
    const { head: arrowTarget, color, position } = parseStyleModifiers(targetPart);
    const labelMods = parseStyleModifiers(labelPart);
    if (arrowTarget.includes("->")) {
      const [rawFrom, rawTo] = arrowTarget.split("->").map((s) => s.trim());
      const fromMods = parseStyleModifiers(rawFrom);
      const toMods = parseStyleModifiers(rawTo);
      return {
        from: fromMods.head,
        to: toMods.head,
        label: labelMods.head,
        color: color || toMods.color || fromMods.color || labelMods.color,
        position: position || toMods.position || fromMods.position || labelMods.position
      };
    }
    return {
      to: arrowTarget,
      label: labelMods.head,
      color: color || labelMods.color,
      position: position || labelMods.position
    };
  }

  if (kind === "callout") {
    const { targetPart, labelPart } = splitTargetAndLabel(str);
    const { head: selector, color, position } = parseStyleModifiers(targetPart);
    const labelMods = parseStyleModifiers(labelPart);
    return {
      selector,
      text: labelMods.head,
      label: labelMods.head,
      color: color || labelMods.color,
      position: position || labelMods.position
    };
  }

  if (kind === "badge") {
    const firstColon = str.indexOf(":");
    if (firstColon > 0) {
      const firstMods = parseStyleModifiers(str.slice(0, firstColon).trim());
      if (/^\d+[a-zA-Z]?$/.test(firstMods.head)) {
        const number = firstMods.head;
        const rest = str.slice(firstColon + 1).trim();
        const { targetPart, labelPart } = splitTargetAndLabel(rest);
        const { head: selector, color } = parseStyleModifiers(targetPart);
        const labelMods = parseStyleModifiers(labelPart);
        return {
          number,
          selector,
          label: labelMods.head,
          color: firstMods.color || color || labelMods.color
        };
      }
    }
    const { targetPart, labelPart } = splitTargetAndLabel(str);
    const { head: selector, color } = parseStyleModifiers(targetPart);
    const labelMods = parseStyleModifiers(labelPart);
    return {
      number: String(index + 1),
      selector,
      label: labelMods.head,
      color: color || labelMods.color
    };
  }

  if (kind === "icon") {
    const firstColon = str.indexOf(":");
    if (firstColon > 0) {
      const firstMods = parseStyleModifiers(str.slice(0, firstColon).trim());
      const typeCandidate = firstMods.head.toLowerCase();
      if (["check", "success", "ok", "pass", "error", "cross", "fail", "x", "warn", "warning", "alert", "info", "click", "cursor", "pointer"].includes(typeCandidate)) {
        const rest = str.slice(firstColon + 1).trim();
        const { targetPart, labelPart } = splitTargetAndLabel(rest);
        const { head: selector, color } = parseStyleModifiers(targetPart);
        const labelMods = parseStyleModifiers(labelPart);
        return {
          type: typeCandidate,
          selector,
          label: labelMods.head,
          color: firstMods.color || color || labelMods.color
        };
      }
    }
    const { targetPart, labelPart } = splitTargetAndLabel(str);
    const { head: selector, color } = parseStyleModifiers(targetPart);
    const labelMods = parseStyleModifiers(labelPart);
    return {
      type: "check",
      selector,
      label: labelMods.head,
      color: color || labelMods.color
    };
  }

  return null;
}

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

async function resolveAnnotationOptions(tabId, params, targetTab, clip, mode) {
  if (!params || typeof params !== "object") return null;
  const title = params.title || params.caption || params.text || "";
  const description = params.description || params.subtitle || "";
  const step = params.step;
  const captionPosition = params.captionPosition || params.position || "bottom";
  const highlightSelector = params.highlightSelector || params.highlight || "";
  const spotlight = Boolean(params.spotlight);
  let highlightRect = params.highlightBox && typeof params.highlightBox === "object"
    ? { ...params.highlightBox }
    : null;

  const isFullPage = mode === "full" || mode === "fullpage";
  const selectorCache = new Map();
  const resolveTargetRect = async (targetSpec, explicitRect = null) => {
    if (explicitRect && typeof explicitRect === "object" && Number(explicitRect.width) > 0 && Number(explicitRect.height) > 0) {
      return { ...explicitRect };
    }
    if (!targetSpec) return null;
    if (typeof targetSpec === "object" && Number(targetSpec.width) > 0 && Number(targetSpec.height) > 0) {
      return { ...targetSpec };
    }
    if (typeof targetSpec === "object" && Number.isFinite(Number(targetSpec.x)) && Number.isFinite(Number(targetSpec.y))) {
      return {
        x: Number(targetSpec.x),
        y: Number(targetSpec.y),
        width: Number(targetSpec.width) || 4,
        height: Number(targetSpec.height) || 4
      };
    }
    const str = String(targetSpec).trim();
    if (!str) return null;
    const coordRect = parseCoordinateTarget(str);
    if (coordRect) {
      return {
        ...coordRect,
        viewportWidth: clip ? clip.width : targetTab?.width,
        viewportHeight: clip ? clip.height : targetTab?.height
      };
    }
    if (selectorCache.has(str)) {
      const cached = selectorCache.get(str);
      return cached ? { ...cached } : null;
    }
    try {
      const elRes = await sendTabMessageWithRetry(tabId, {
        action: "get_element_info",
        selector: str,
        scrollIntoView: false
      });
      if (elRes && elRes.success && elRes.rect && elRes.rect.width > 0 && elRes.rect.height > 0) {
        const rectObj = {
          x: elRes.rect.x + (isFullPage ? Number(elRes.viewport?.scrollX || 0) : 0),
          y: elRes.rect.y + (isFullPage ? Number(elRes.viewport?.scrollY || 0) : 0),
          width: elRes.rect.width,
          height: elRes.rect.height,
          viewportWidth: elRes.viewport?.width || targetTab?.width,
          viewportHeight: elRes.viewport?.height || targetTab?.height,
          devicePixelRatio: elRes.viewport?.devicePixelRatio
        };
        if ((mode === "element" || mode === "region") && clip) {
          rectObj.x = Math.max(0, rectObj.x - clip.x);
          rectObj.y = Math.max(0, rectObj.y - clip.y);
          rectObj.viewportWidth = clip.width;
          rectObj.viewportHeight = clip.height;
        }
        selectorCache.set(str, rectObj);
        return { ...rectObj };
      }
    } catch (err) {
      logDebug("annotation selector lookup", err);
    }
    selectorCache.set(str, null);
    return null;
  };

  if (highlightSelector && !highlightRect) {
    highlightRect = await resolveTargetRect(highlightSelector);
  }

  const boxes = [];
  for (const raw of toArray(params.boxes || params.box)) {
    const parsed = parseAnnotationSpecItem("box", raw);
    if (!parsed) continue;
    const rect = await resolveTargetRect(parsed.selector || parsed.target, parsed.rect || parsed.box);
    if (rect) boxes.push({ ...parsed, rect });
  }

  const circles = [];
  for (const raw of toArray(params.circles || params.circle)) {
    const parsed = parseAnnotationSpecItem("circle", raw);
    if (!parsed) continue;
    const rect = await resolveTargetRect(parsed.selector || parsed.target, parsed.rect);
    if (rect) circles.push({ ...parsed, rect });
  }

  const arrows = [];
  for (const raw of toArray(params.arrows || params.arrow)) {
    const parsed = parseAnnotationSpecItem("arrow", raw);
    if (!parsed) continue;
    const toRect = await resolveTargetRect(parsed.to || parsed.selector || parsed.target, parsed.toRect || parsed.rect);
    const fromRect = parsed.from || parsed.fromRect ? await resolveTargetRect(parsed.from, parsed.fromRect) : null;
    if (toRect) arrows.push({ ...parsed, toRect, fromRect });
  }

  const callouts = [];
  for (const raw of toArray(params.callouts || params.callout)) {
    const parsed = parseAnnotationSpecItem("callout", raw);
    if (!parsed) continue;
    const rect = await resolveTargetRect(parsed.selector || parsed.to || parsed.target, parsed.rect);
    if (rect) callouts.push({ ...parsed, rect });
  }

  const rawBadges = toArray(params.badges || params.badge);
  const badges = [];
  for (let i = 0; i < rawBadges.length; i++) {
    const parsed = parseAnnotationSpecItem("badge", rawBadges[i], i);
    if (!parsed) continue;
    const rect = await resolveTargetRect(parsed.selector || parsed.target, parsed.rect);
    if (rect) badges.push({ ...parsed, rect });
  }

  const icons = [];
  for (const raw of toArray(params.icons || params.icon)) {
    const parsed = parseAnnotationSpecItem("icon", raw);
    if (!parsed) continue;
    const rect = await resolveTargetRect(parsed.selector || parsed.target, parsed.rect);
    if (rect) icons.push({ ...parsed, rect });
  }

  const redactRects = [];
  for (const raw of toArray(params.redact || params.redactions)) {
    const parsed = parseAnnotationSpecItem("redact", raw);
    if (!parsed) continue;
    const rect = await resolveTargetRect(parsed.selector || parsed.target, parsed.rect);
    if (rect) redactRects.push({ ...parsed, rect });
  }

  const annotateInteractive = Boolean(
    params.annotateInteractive ||
    params.interactive ||
    params.setOfMarks ||
    params.som ||
    params.labels
  );
  const somColor = params.somColor || params.somTheme || "amber";
  const interactiveMarks = [];

  if (annotateInteractive) {
    try {
      const snapRes = await sendTabMessageWithRetry(tabId, {
        action: "get_snapshot",
        maxElements: Math.min(Number(params.maxInteractiveElements || params.maxElements) || 80, 200),
        format: "json"
      });
      if (snapRes && Array.isArray(snapRes.elements)) {
        const vpW = snapRes.viewport?.width || targetTab?.width || 1280;
        const vpH = snapRes.viewport?.height || targetTab?.height || 800;
        const dpr = snapRes.viewport?.devicePixelRatio || 1;
        const scrollX = isFullPage ? Number(snapRes.scrollX || 0) : 0;
        const scrollY = isFullPage ? Number(snapRes.scrollY || 0) : 0;

        for (const it of snapRes.elements) {
          const bx = it.bounds ? it.bounds.x : (it.rect ? it.rect.x - Math.round(it.rect.width / 2) : 0);
          const by = it.bounds ? it.bounds.y : (it.rect ? it.rect.y - Math.round(it.rect.height / 2) : 0);
          const bw = it.bounds ? it.bounds.width : (it.rect ? it.rect.width : 0);
          const bh = it.bounds ? it.bounds.height : (it.rect ? it.rect.height : 0);

          if (bw <= 0 || bh <= 0) continue;

          // In visible mode, skip elements completely outside the current viewport
          if (!isFullPage) {
            if (by + bh <= 0 || by >= vpH || bx + bw <= 0 || bx >= vpW) {
              continue;
            }
          }

          const rectObj = {
            x: bx + scrollX,
            y: by + scrollY,
            width: bw,
            height: bh,
            viewportWidth: vpW,
            viewportHeight: vpH,
            devicePixelRatio: dpr
          };

          if ((mode === "element" || mode === "region") && clip) {
            rectObj.x = Math.max(0, rectObj.x - clip.x);
            rectObj.y = Math.max(0, rectObj.y - clip.y);
            rectObj.viewportWidth = clip.width;
            rectObj.viewportHeight = clip.height;
          }

          interactiveMarks.push({
            index: it.index,
            ref: it.ref || `@${it.index}`,
            label: it.label || "",
            rect: rectObj
          });
        }
      }
    } catch (snapErr) {
      logDebug("Set-of-Marks snapshot lookup error", snapErr);
    }
  }

  const hasAny =
    Boolean(title) ||
    Boolean(description) ||
    (step !== undefined && step !== null && String(step).trim() !== "") ||
    Boolean(highlightRect) ||
    boxes.length > 0 ||
    circles.length > 0 ||
    arrows.length > 0 ||
    callouts.length > 0 ||
    badges.length > 0 ||
    icons.length > 0 ||
    redactRects.length > 0 ||
    interactiveMarks.length > 0;

  if (!hasAny) {
    return null;
  }
  return {
    title,
    description,
    step,
    captionPosition,
    highlightRect,
    boxes,
    circles,
    arrows,
    callouts,
    badges,
    icons,
    redactRects,
    spotlight,
    interactiveMarks,
    somColor
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
    let attachRes = null;
    if (!attachedTabs.has(tabId)) {
      attachRes = await attachDebugger(tabId).catch((err) => ({
        success: false,
        error: err && err.message ? err.message : String(err)
      }));
      if (!attachedTabs.has(tabId)) {
        // Allow transient debugger detach/attach transition to settle
        await new Promise((r) => setTimeout(r, 200));
        attachRes = await attachDebugger(tabId).catch((err) => ({
          success: false,
          error: err && err.message ? err.message : String(err)
        }));
      }
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
        const overlayUrl = params.overlayDataUrl || (clip && clip.overlayDataUrl) || undefined;
        if (requiresCrop && clip) {
          const cropOpts = { ...formatOpts, ...(overlayUrl ? { overlayDataUrl: overlayUrl } : {}) };
          resultUrl = await cropDataUrlInWorker(resultUrl, clip, cropOpts);
          requiresCrop = false;
        } else if (overlayUrl) {
          const compClip = {
            x: 0,
            y: 0,
            width: clip ? clip.width : (targetTab?.width || 1280),
            height: clip ? clip.height : (targetTab?.height || 800),
            pageWidth: clip ? clip.width : (targetTab?.width || 1280),
            pageHeight: clip ? clip.height : (targetTab?.height || 800),
            overlayDataUrl: overlayUrl
          };
          resultUrl = await cropDataUrlInWorker(resultUrl, compClip, { ...formatOpts, overlayDataUrl: overlayUrl });
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
          ...(annotated ? { annotated: true } : {}),
          ...(annotationOpts?.interactiveMarks?.length ? { interactiveCount: annotationOpts.interactiveMarks.length } : {})
        };
      } catch (cdpErr) {
        logDebug(`CDP screenshot failed on tab ${tabId}`, cdpErr);
        if (!isTabActive) {
          throw new Error(`CDP screenshot failed on background tab ${tabId}: ${cdpErr?.message || cdpErr}`);
        }
      }
    } else if (!isTabActive) {
      throw new Error(`Cannot capture background tab ${tabId}: CDP debugger attachment failed${attachRes?.error ? ` (${attachRes.error})` : ""}`);
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
      const overlayUrl = params.overlayDataUrl || (clip && clip.overlayDataUrl) || undefined;
      const cropOpts = {
        ...formatOpts,
        ...(overlayUrl ? { overlayDataUrl: overlayUrl } : {})
      };
      let finalUrl = rawUrl;
      if (needsCrop) {
        finalUrl = await cropDataUrlInWorker(rawUrl, clip, cropOpts);
      } else if (overlayUrl) {
        const fullClip = {
          x: 0,
          y: 0,
          width: targetTab?.width || 1280,
          height: targetTab?.height || 800,
          pageWidth: targetTab?.width || 1280,
          pageHeight: targetTab?.height || 800,
          overlayDataUrl: overlayUrl
        };
        finalUrl = await cropDataUrlInWorker(rawUrl, fullClip, cropOpts);
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
        ...(annotated ? { annotated: true } : {}),
        ...(annotationOpts?.interactiveMarks?.length ? { interactiveCount: annotationOpts.interactiveMarks.length } : {})
      });
    });
  });
}
