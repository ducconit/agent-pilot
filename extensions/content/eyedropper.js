/**
 * Agent Pilot - Content Script Color Eyedropper Module
 * Interactive Magnifying Loupe with Realtime Pixel Grid, Live Color Badge, and Auto Turn-Off
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.eyedropper) return;
  window.__AP_INTERNAL__.__guards.eyedropper = true;

  function showToast(msg) {
    if (window.__AP_INTERNAL__.showToast) {
      window.__AP_INTERNAL__.showToast(msg);
    }
  }

  // NOTE: Keep mathematical conversion algorithms in sync with extensions/sidepanel/color-utils.js
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((x) => {
      const h = Math.max(0, Math.min(255, Math.round(x))).toString(16);
      return h.length === 1 ? "0" + h : h;
    }).join("").toUpperCase();
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

  function rgbToRgba(r, g, b, a = 1) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
  }

  function srgbToLinear(c) {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function rgbToOklch(r, g, b) {
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

  // Eyedropper & Loupe Geometry Constants
  //
  // Grid -> canvas mapping: we sample an 11x11 block of source pixels centred on the
  // cursor (GRID_RADIUS = 5 => offsets -5..+5) and blow every single source pixel up to
  // a PIXEL_ZOOM x PIXEL_ZOOM square on the loupe canvas. Hence the canvas side is
  // GRID_COUNT * PIXEL_ZOOM = 11 * 12 = 132px, and the centre (targeted) pixel occupies
  // the cell starting at GRID_RADIUS * PIXEL_ZOOM = 60px — that is what RETICLE_CENTER
  // below frames with the crosshair reticle.
  const GRID_RADIUS = 5; // 11x11 grid (-5 to +5)
  const GRID_COUNT = 11;
  const PIXEL_ZOOM = 12; // Each screen pixel enlarged to 12x12px
  const LOUPE_CANVAS_SIZE = 132; // 11 * 12 = 132px
  const LOUPE_WIDTH = 144;
  const LOUPE_HEIGHT = 180;
  const OFFSET_X = 22;
  const OFFSET_Y_TOP = 170;
  const OFFSET_Y_BOTTOM = 24;
  const EDGE_MARGIN = 12;
  const RETICLE_CENTER = 60; // Center pixel starts at 60px (5 * 12)

  // Shared config with local fallbacks (see content/config.js).
  const T = (window.__AP_CONFIG__ && window.__AP_CONFIG__.timeouts) || {};
  const SNAPSHOT_REFRESH_DEBOUNCE_MS = T.snapshotRefreshDebounceMs || 120;

  // State Management
  let isActive = false;
  let activeResolve = null;

  // DOM Elements
  let loupeEl = null;
  let loupeCanvas = null;
  let loupeCtx = null;
  let loupeSwatch = null;
  let loupeHex = null;
  let loupeRgb = null;

  // Snapshot State
  let snapshotCanvas = null;
  let snapshotCtx = null;
  let snapshotScaleX = 1;
  let snapshotScaleY = 1;
  let isSnapshotReady = false;
  let currentSample = null;
  let lastClientX = null;
  let lastClientY = null;
  let scrollDebounce = null;

  function initLoupeUI() {
    if (window.__AP_INTERNAL__.isHtmlDocument && !window.__AP_INTERNAL__.isHtmlDocument()) {
      return;
    }
    if (loupeEl && document.getElementById("agent-pilot-eyedropper-loupe")) {
      return;
    }

    loupeEl = document.getElementById("agent-pilot-eyedropper-loupe");
    if (!loupeEl) {
      loupeEl = document.createElement("div");
      loupeEl.id = "agent-pilot-eyedropper-loupe";
      loupeEl.className = "agent-pilot-loupe-container";
      loupeEl.style.display = "none";
      loupeEl.innerHTML = `
        <div class="agent-pilot-loupe-lens">
          <canvas id="agent-pilot-loupe-canvas" width="132" height="132"></canvas>
        </div>
        <div class="agent-pilot-loupe-badge">
          <div class="agent-pilot-loupe-color-row">
            <span class="agent-pilot-loupe-swatch" id="agent-pilot-loupe-swatch"></span>
            <span class="agent-pilot-loupe-hex" id="agent-pilot-loupe-hex">#38BDF8</span>
          </div>
          <div class="agent-pilot-loupe-rgb" id="agent-pilot-loupe-rgb">rgb(56, 189, 248)</div>
          <div class="agent-pilot-loupe-hint">Click để chọn • Esc để hủy</div>
        </div>
      `;
      (document.body || document.documentElement).appendChild(loupeEl);
    }

    loupeCanvas = document.getElementById("agent-pilot-loupe-canvas");
    if (loupeCanvas) {
      loupeCtx = loupeCanvas.getContext("2d");
    }
    loupeSwatch = document.getElementById("agent-pilot-loupe-swatch");
    loupeHex = document.getElementById("agent-pilot-loupe-hex");
    loupeRgb = document.getElementById("agent-pilot-loupe-rgb");
  }

  async function refreshSnapshot() {
    isSnapshotReady = false;
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "capture_screenshot", mode: "visible" }, resolve);
      });

      if (res && res.success && res.dataUrl) {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            if (!snapshotCanvas) {
              snapshotCanvas = document.createElement("canvas");
            }
            snapshotCanvas.width = img.naturalWidth;
            snapshotCanvas.height = img.naturalHeight;
            snapshotCtx = snapshotCanvas.getContext("2d", { willReadFrequently: true });
            snapshotCtx.drawImage(img, 0, 0);

            snapshotScaleX = snapshotCanvas.width / Math.max(1, window.innerWidth);
            snapshotScaleY = snapshotCanvas.height / Math.max(1, window.innerHeight);
            isSnapshotReady = true;
            resolve();
          };
          img.onerror = resolve;
          img.src = res.dataUrl;
        });
      }
    } catch (err) {
      console.warn("[AgentPilot] Eyedropper snapshot notice:", err);
    }
  }

  function buildColorSample(r, g, b, sx = 0, sy = 0, fromFallback = false) {
    return {
      r,
      g,
      b,
      hex: rgbToHex(r, g, b),
      rgb: `rgb(${r}, ${g}, ${b})`,
      rgba: rgbToRgba(r, g, b, 1),
      hsl: rgbToHsl(r, g, b),
      oklch: rgbToOklch(r, g, b),
      sx,
      sy,
      fromFallback
    };
  }

  function sampleFallbackColor(clientX, clientY) {
    let color = "rgb(255, 255, 255)";
    try {
      const el = document.elementFromPoint(clientX, clientY);
      if (el) {
        let curr = el;
        while (curr && curr !== document.documentElement) {
          const bg = window.getComputedStyle(curr).backgroundColor;
          if (bg && bg !== "transparent" && !bg.startsWith("rgba(0, 0, 0, 0)")) {
            color = bg;
            break;
          }
          curr = curr.parentElement;
        }
      }
    } catch (_) {}

    const match = color.match(/\d+/g);
    const r = match ? parseInt(match[0], 10) : 255;
    const g = match ? parseInt(match[1], 10) : 255;
    const b = match ? parseInt(match[2], 10) : 255;
    return buildColorSample(r, g, b, 0, 0, true);
  }

  function samplePixelAt(clientX, clientY) {
    if (isSnapshotReady && snapshotCtx && snapshotCanvas) {
      const sx = Math.max(0, Math.min(snapshotCanvas.width - 1, Math.round(clientX * snapshotScaleX)));
      const sy = Math.max(0, Math.min(snapshotCanvas.height - 1, Math.round(clientY * snapshotScaleY)));
      try {
        const pixel = snapshotCtx.getImageData(sx, sy, 1, 1).data;
        return buildColorSample(pixel[0], pixel[1], pixel[2], sx, sy, false);
      } catch (_) {}
    }
    return sampleFallbackColor(clientX, clientY);
  }

  function renderLoupe(clientX, clientY, sampled) {
    if (!loupeEl || !loupeCtx) return;

    // 1. Position loupe around cursor with edge collision avoidance
    let posX = clientX + OFFSET_X;
    let posY = clientY - OFFSET_Y_TOP;

    // If too close to top, position below cursor
    if (posY < EDGE_MARGIN) {
      posY = clientY + OFFSET_Y_BOTTOM;
    }
    // If too close to right, position to left of cursor
    if (posX + LOUPE_WIDTH > window.innerWidth - EDGE_MARGIN) {
      posX = clientX - LOUPE_WIDTH - OFFSET_X;
    }
    // Clamp inside viewport
    posX = Math.max(8, Math.min(window.innerWidth - LOUPE_WIDTH - 8, posX));
    posY = Math.max(8, Math.min(window.innerHeight - LOUPE_HEIGHT - 8, posY));

    loupeEl.style.transform = `translate(${posX}px, ${posY}px)`;
    loupeEl.style.display = "block";

    // 2. Draw zoomed 11x11 pixel slice
    loupeCtx.clearRect(0, 0, LOUPE_CANVAS_SIZE, LOUPE_CANVAS_SIZE);

    if (isSnapshotReady && snapshotCtx && snapshotCanvas && !sampled.fromFallback) {
      const sw = snapshotCanvas.width;
      const sh = snapshotCanvas.height;
      const minX = Math.max(0, sampled.sx - GRID_RADIUS);
      const minY = Math.max(0, sampled.sy - GRID_RADIUS);
      const maxX = Math.min(sw, sampled.sx + GRID_RADIUS + 1);
      const maxY = Math.min(sh, sampled.sy + GRID_RADIUS + 1);
      const width = maxX - minX;
      const height = maxY - minY;

      // Base background for out-of-bounds pixels
      loupeCtx.fillStyle = "#0f172a";
      loupeCtx.fillRect(0, 0, LOUPE_CANVAS_SIZE, LOUPE_CANVAS_SIZE);

      if (width > 0 && height > 0) {
        try {
          const imgData = snapshotCtx.getImageData(minX, minY, width, height);
          const data = imgData.data;

          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const idx = (y * width + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];

              const gridX = (minX + x) - (sampled.sx - GRID_RADIUS);
              const gridY = (minY + y) - (sampled.sy - GRID_RADIUS);

              loupeCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
              loupeCtx.fillRect(gridX * PIXEL_ZOOM, gridY * PIXEL_ZOOM, PIXEL_ZOOM, PIXEL_ZOOM);
            }
          }
        } catch (_) {
          loupeCtx.fillStyle = sampled.hex || "#38bdf8";
          loupeCtx.fillRect(0, 0, LOUPE_CANVAS_SIZE, LOUPE_CANVAS_SIZE);
        }
      }
    } else {
      loupeCtx.fillStyle = sampled.hex || "#38bdf8";
      loupeCtx.fillRect(0, 0, LOUPE_CANVAS_SIZE, LOUPE_CANVAS_SIZE);
    }

    // 3. Draw grid lines separating individual magnified pixels
    loupeCtx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    loupeCtx.lineWidth = 1;
    for (let i = 1; i < GRID_COUNT; i++) {
      const p = i * PIXEL_ZOOM;
      loupeCtx.beginPath();
      loupeCtx.moveTo(p, 0);
      loupeCtx.lineTo(p, LOUPE_CANVAS_SIZE);
      loupeCtx.stroke();

      loupeCtx.beginPath();
      loupeCtx.moveTo(0, p);
      loupeCtx.lineTo(LOUPE_CANVAS_SIZE, p);
      loupeCtx.stroke();
    }

    // 4. Center reticle/target box over the exact targeted pixel.
    // RETICLE_CENTER (=60) is the top-left corner, in canvas px, of the centre source
    // cell (GRID_RADIUS * PIXEL_ZOOM). A PIXEL_ZOOM-sized box there frames the sampled
    // pixel exactly. A dark border is drawn slightly outside it for contrast on light
    // pixels, and a cyan border just inside for contrast on dark pixels.
    loupeCtx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    loupeCtx.lineWidth = 2.5;
    loupeCtx.strokeRect(RETICLE_CENTER - 0.5, RETICLE_CENTER - 0.5, PIXEL_ZOOM + 1, PIXEL_ZOOM + 1);
    // Inner vibrant cyan border for contrast on dark pixels
    loupeCtx.strokeStyle = "#38bdf8";
    loupeCtx.lineWidth = 1.5;
    loupeCtx.strokeRect(RETICLE_CENTER, RETICLE_CENTER, PIXEL_ZOOM, PIXEL_ZOOM);

    // Reticle crosshair ticks
    const centerPoint = RETICLE_CENTER + (PIXEL_ZOOM / 2);
    loupeCtx.strokeStyle = "#ffffff";
    loupeCtx.lineWidth = 1.5;
    loupeCtx.beginPath();
    loupeCtx.moveTo(centerPoint, RETICLE_CENTER - 12); loupeCtx.lineTo(centerPoint, RETICLE_CENTER - 2); // Top tick
    loupeCtx.moveTo(centerPoint, RETICLE_CENTER + PIXEL_ZOOM + 2); loupeCtx.lineTo(centerPoint, RETICLE_CENTER + PIXEL_ZOOM + 12); // Bottom tick
    loupeCtx.moveTo(RETICLE_CENTER - 12, centerPoint); loupeCtx.lineTo(RETICLE_CENTER - 2, centerPoint); // Left tick
    loupeCtx.moveTo(RETICLE_CENTER + PIXEL_ZOOM + 2, centerPoint); loupeCtx.lineTo(RETICLE_CENTER + PIXEL_ZOOM + 12, centerPoint); // Right tick
    loupeCtx.stroke();

    // 5. Update live color badge
    if (loupeSwatch) loupeSwatch.style.backgroundColor = sampled.hex;
    if (loupeHex) loupeHex.textContent = sampled.hex;
    if (loupeRgb) loupeRgb.textContent = sampled.rgb;
  }

  function onMouseMove(e) {
    if (!isActive) return;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    currentSample = samplePixelAt(e.clientX, e.clientY);
    renderLoupe(e.clientX, e.clientY, currentSample);
  }

  function onClick(e) {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();

    const sample = samplePixelAt(e.clientX, e.clientY);
    selectAndFinish(sample);
  }

  function onKeyDown(e) {
    if (!isActive) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelAndFinish();
    }
  }

  function onScroll() {
    if (!isActive) return;
    clearTimeout(scrollDebounce);
    // Re-grab the screenshot only after the user stops scrolling, otherwise we would
    // request a full-screen capture on every scroll tick.
    scrollDebounce = setTimeout(() => {
      if (isActive) {
        refreshSnapshot().then(() => {
          if (isActive && lastClientX !== null && lastClientY !== null) {
            currentSample = samplePixelAt(lastClientX, lastClientY);
            renderLoupe(lastClientX, lastClientY, currentSample);
          }
        });
      }
    }, SNAPSHOT_REFRESH_DEBOUNCE_MS);
  }

  function emitPickedColor(sample) {
    try {
      navigator.clipboard.writeText(sample.hex).catch(() => {});
    } catch (_) {}

    chrome.runtime.sendMessage({
      type: "COLOR_PICKED",
      color: {
        hex: sample.hex,
        rgb: sample.rgb,
        rgba: sample.rgba,
        hsl: sample.hsl,
        oklch: sample.oklch,
        timestamp: Date.now()
      }
    }).catch((err) => {
      console.debug("[AgentPilot Eyedropper] notify color picked error:", err);
    });
  }

  function selectAndFinish(sample) {
    const finalSample = sample || currentSample || sampleFallbackColor(0, 0);

    emitPickedColor(finalSample);
    showToast(`🎨 Đã chọn màu: <b>${finalSample.hex}</b> (đã copy vào clipboard)`);

    chrome.runtime.sendMessage({
      type: "EYEDROPPER_STATUS_CHANGED",
      active: false
    }).catch((err) => {
      console.debug("[AgentPilot Eyedropper] notify status error:", err);
    });

    stopEyedropper(finalSample);
  }

  function cancelAndFinish() {
    showToast("Đã hủy chế độ lấy mã màu");

    chrome.runtime.sendMessage({
      type: "EYEDROPPER_STATUS_CHANGED",
      active: false
    }).catch((err) => {
      console.debug("[AgentPilot Eyedropper] notify status error:", err);
    });

    stopEyedropper(null);
  }

  function stopEyedropper(result = null) {
    if (!isActive) return;
    isActive = false;

    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onScroll, true);

    if (scrollDebounce) {
      clearTimeout(scrollDebounce);
      scrollDebounce = null;
    }

    if (loupeEl) {
      loupeEl.style.display = "none";
    }
    loupeEl = null;
    snapshotCanvas = null;
    snapshotCtx = null;
    isSnapshotReady = false;
    document.documentElement.classList.remove("agent-pilot-eyedropper-active");

    if (activeResolve) {
      const resolve = activeResolve;
      activeResolve = null;
      resolve(result);
    }
  }

  async function pickColor(x, y) {
    // 1. Direct one-shot coordinate sampling (Automated AI Agent call)
    if (typeof x === "number" && typeof y === "number") {
      await refreshSnapshot();
      const sample = samplePixelAt(x, y);
      emitPickedColor(sample);
      return { hex: sample.hex, rgb: sample.rgb, rgba: sample.rgba, hsl: sample.hsl, oklch: sample.oklch };
    }

    // 2. Interactive user loupe mode
    if (isActive) {
      stopEyedropper(null);
    }

    initLoupeUI();
    isActive = true;
    document.documentElement.classList.add("agent-pilot-eyedropper-active");

    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);

    chrome.runtime.sendMessage({
      type: "EYEDROPPER_STATUS_CHANGED",
      active: true
    }).catch(() => {});

    // Initial snapshot in background
    refreshSnapshot().then(() => {
      if (isActive && lastClientX !== null && lastClientY !== null) {
        currentSample = samplePixelAt(lastClientX, lastClientY);
        renderLoupe(lastClientX, lastClientY, currentSample);
      }
    });

    return new Promise((resolve) => {
      activeResolve = resolve;
    });
  }

  window.__AP_INTERNAL__.eyedropper = {
    pickColor,
    stopEyedropper,
    isEyedropperActive: () => isActive,
    hexToRgb,
    rgbToHsl,
    rgbToHex
  };
})();
