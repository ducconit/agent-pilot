/**
 * Agent Pilot - Content Script Color Eyedropper Module
 * Extracts pixel colors from web pages with hex, rgb, and hsl conversions
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  function showToast(msg) {
    if (window.__AP_INTERNAL__.showToast) {
      window.__AP_INTERNAL__.showToast(msg);
    }
  }

  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgb(${r}, ${g}, ${b})`;
  }

  function rgbToHsl(r, g, b) {
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

  async function pickColor() {
    if (window.EyeDropper) {
      try {
        const eyeDropper = new window.EyeDropper();
        const result = await eyeDropper.open();
        const hex = result.sRGBHex;
        const rgb = hexToRgb(hex);

        // Parse RGB numbers for HSL
        const matches = rgb.match(/\d+/g);
        const hsl = matches ? rgbToHsl(parseInt(matches[0]), parseInt(matches[1]), parseInt(matches[2])) : "";

        // Copy to clipboard
        navigator.clipboard.writeText(hex).catch(() => {});

        showToast(`🎨 Đã lấy màu: <b>${hex}</b> (đã copy vào clipboard)`);

        chrome.runtime.sendMessage({
          type: "COLOR_PICKED",
          color: { hex, rgb, hsl, timestamp: Date.now() }
        }).catch(() => {});

        return { hex, rgb, hsl };
      } catch (err) {
        // User canceled picker
        return null;
      }
    } else {
      showToast("⚠️ Trình duyệt chưa hỗ trợ native EyeDropper API!");
      return null;
    }
  }

  window.__AP_INTERNAL__.eyedropper = {
    pickColor,
    hexToRgb,
    rgbToHsl
  };
})();
