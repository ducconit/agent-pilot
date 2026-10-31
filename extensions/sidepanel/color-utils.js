/**
 * Agent Pilot - Color Conversion & Normalization Utilities
 * NOTE: Mathematical algorithms must be kept in sync with extensions/content/eyedropper.js
 * (rgbToHex output is UPPERCASE in both modules to stay aligned).
 */

function clampRgb(v) {
  return Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
}

export function srgbToLinear(c) {
  c = clampRgb(c) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToOklch(r, g, b) {
  r = clampRgb(r);
  g = clampRgb(g);
  b = clampRgb(b);
  const rLin = srgbToLinear(r);
  const gLin = srgbToLinear(g);
  const bLin = srgbToLinear(b);

  const l = 0.4122214708 * rLin + 0.5363325363 * gLin + 0.0514459929 * bLin;
  const m = 0.2119034982 * rLin + 0.6806995451 * gLin + 0.1073969566 * bLin;
  const s = 0.0883024619 * rLin + 0.2817188376 * gLin + 0.6299787005 * bLin;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  const C = Math.sqrt(a * a + b_ * b_);
  let H = (Math.atan2(b_, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  if (C < 0.0001) H = 0;

  const L_pct = (Math.round(L * 1000) / 10).toFixed(1);
  const C_val = (Math.round(C * 1000) / 1000).toFixed(3);
  const H_val = (Math.round(H * 10) / 10).toFixed(1);
  return `oklch(${L_pct}% ${C_val} ${H_val})`;
}

export function hexToRgbNums(hex) {
  if (!hex || typeof hex !== "string") return { r: 0, g: 0, b: 0 };
  const clean = hex.replace("#", "").trim();
  if (![3, 4, 6, 8].includes(clean.length) || !/^[0-9a-f]+$/i.test(clean)) {
    return { r: 0, g: 0, b: 0 };
  }
  const expanded = (clean.length === 3 || clean.length === 4)
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16)
  };
}

export function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => {
    const num = Number.isFinite(x) ? x : 0;
    const h = Math.max(0, Math.min(255, Math.round(num))).toString(16);
    return h.length === 1 ? "0" + h : h;
  }).join("").toUpperCase();
}

export function rgbToHsl(r, g, b) {
  r = clampRgb(r) / 255;
  g = clampRgb(g) / 255;
  b = clampRgb(b) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

export function rgbToRgba(r, g, b, a = 1) {
  const rClamped = clampRgb(r);
  const gClamped = clampRgb(g);
  const bClamped = clampRgb(b);
  const aClamped = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
  return `rgba(${rClamped}, ${gClamped}, ${bClamped}, ${aClamped})`;
}

/**
 * Normalizes input into a comprehensive 5-format color object.
 * Fast paths already-computed IPC payloads to prevent data loss or duplicate math.
 */
export function normalizeColorData(colorObj) {
  if (!colorObj) return null;

  // Fast path: if colorObj already contains all 5 pre-calculated formats from eyedropper IPC, use directly
  if (colorObj.hex && colorObj.rgb && colorObj.rgba && colorObj.hsl && colorObj.oklch) {
    let { r, g, b } = colorObj;
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      const nums = hexToRgbNums(colorObj.hex);
      r = nums.r; g = nums.g; b = nums.b;
    }
    return {
      r,
      g,
      b,
      hex: colorObj.hex.toUpperCase(),
      rgb: colorObj.rgb,
      rgba: colorObj.rgba,
      hsl: colorObj.hsl,
      oklch: colorObj.oklch
    };
  }

  let r = 0, g = 0, b = 0;
  if (typeof colorObj === "string") {
    const nums = hexToRgbNums(colorObj);
    r = nums.r; g = nums.g; b = nums.b;
  } else if (Number.isFinite(colorObj.r) && Number.isFinite(colorObj.g) && Number.isFinite(colorObj.b)) {
    r = Math.max(0, Math.min(255, Math.round(colorObj.r)));
    g = Math.max(0, Math.min(255, Math.round(colorObj.g)));
    b = Math.max(0, Math.min(255, Math.round(colorObj.b)));
  } else if (colorObj.hex) {
    const nums = hexToRgbNums(colorObj.hex);
    r = nums.r; g = nums.g; b = nums.b;
  }

  const hex = colorObj.hex ? colorObj.hex.toUpperCase() : rgbToHex(r, g, b);
  const rgb = colorObj.rgb || `rgb(${r}, ${g}, ${b})`;
  const rgba = colorObj.rgba || rgbToRgba(r, g, b, 1);
  const hsl = colorObj.hsl || rgbToHsl(r, g, b);
  const oklch = colorObj.oklch || rgbToOklch(r, g, b);

  return { r, g, b, hex, rgb, rgba, hsl, oklch };
}
