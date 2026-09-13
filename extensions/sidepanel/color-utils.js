/**
 * Agent Pilot - Color Conversion & Normalization Utilities
 * NOTE: Mathematical algorithms must be kept in sync with extensions/content/eyedropper.js
 */

export function srgbToLinear(c) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToOklch(r, g, b) {
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
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  const bigint = parseInt(clean, 16);
  if (Number.isNaN(bigint)) return { r: 0, g: 0, b: 0 };
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}

export function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => {
    const h = Math.max(0, Math.min(255, Math.round(x))).toString(16);
    return h.length === 1 ? "0" + h : h;
  }).join("").toLowerCase();
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
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
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

/**
 * Normalizes input into a comprehensive 5-format color object.
 * Fast paths already-computed IPC payloads to prevent data loss or duplicate math.
 */
export function normalizeColorData(colorObj) {
  if (!colorObj) return null;

  // Fast path: if colorObj already contains all 5 pre-calculated formats from eyedropper IPC, use directly
  if (colorObj.hex && colorObj.rgb && colorObj.rgba && colorObj.hsl && colorObj.oklch) {
    return {
      r: typeof colorObj.r === "number" ? colorObj.r : 0,
      g: typeof colorObj.g === "number" ? colorObj.g : 0,
      b: typeof colorObj.b === "number" ? colorObj.b : 0,
      hex: colorObj.hex,
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
  } else if (typeof colorObj.r === "number" && typeof colorObj.g === "number" && typeof colorObj.b === "number") {
    r = colorObj.r; g = colorObj.g; b = colorObj.b;
  } else if (colorObj.hex) {
    const nums = hexToRgbNums(colorObj.hex);
    r = nums.r; g = nums.g; b = nums.b;
  }

  const hex = colorObj.hex || rgbToHex(r, g, b);
  const rgb = colorObj.rgb || `rgb(${r}, ${g}, ${b})`;
  const rgba = colorObj.rgba || rgbToRgba(r, g, b, 1);
  const hsl = colorObj.hsl || rgbToHsl(r, g, b);
  const oklch = colorObj.oklch || rgbToOklch(r, g, b);

  return { r, g, b, hex, rgb, rgba, hsl, oklch };
}
