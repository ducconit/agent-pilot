/**
 * Agent Pilot - Feedback Studio Capture Service
 * Handles framework component inspection, screenshot requests, and canvas cropping.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};
  window.__AP_INTERNAL__.feedbackStudio = window.__AP_INTERNAL__.feedbackStudio || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.fsCapture) return;
  window.__AP_INTERNAL__.__guards.fsCapture = true;

  /**
   * Query React / Vue / Astro component source information via CustomEvent bridge
   */
  function queryFrameworkSource(element) {
    return new Promise((resolve) => {
      if (!element || !(element instanceof Element)) {
        return resolve(null);
      }
      const reqId = "req_" + Math.random().toString(36).substr(2, 9);
      element.setAttribute("data-ap-inspect-target", reqId);

      const timeout = setTimeout(() => {
        window.removeEventListener("__AP_INSPECT_SOURCE_RESP__", onResp);
        element.removeAttribute("data-ap-inspect-target");
        resolve(null);
      }, 250);

      function onResp(e) {
        if (e.detail && e.detail.reqId === reqId) {
          clearTimeout(timeout);
          window.removeEventListener("__AP_INSPECT_SOURCE_RESP__", onResp);
          resolve(e.detail.source || null);
        }
      }

      window.addEventListener("__AP_INSPECT_SOURCE_RESP__", onResp);
      window.dispatchEvent(new CustomEvent("__AP_INSPECT_SOURCE_REQ__", { detail: { reqId } }));
    });
  }

  /**
   * Crop high-resolution image via HTML5 Canvas with DPI awareness
   */
  function cropDataUrl(fullDataUrl, clip) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = (clip.pageWidth ? img.naturalWidth / clip.pageWidth : null) || (img.naturalWidth / window.innerWidth) || clip.devicePixelRatio || 1;
        const padding = 10; // Extra context margin around element
        const rawX = Math.max(0, clip.x - padding);
        const rawY = Math.max(0, clip.y - padding);
        const rawW = clip.width + (padding * 2);
        const rawH = clip.height + (padding * 2);

        const sx = Math.max(0, Math.min(img.naturalWidth, Math.round(rawX * scale)));
        const sy = Math.max(0, Math.min(img.naturalHeight, Math.round(rawY * scale)));
        const sw = Math.min(img.naturalWidth - sx, Math.round(rawW * scale));
        const sh = Math.min(img.naturalHeight - sy, Math.round(rawH * scale));

        if (sw <= 0 || sh <= 0) {
          return resolve(fullDataUrl);
        }

        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

        // Subtle highlight frame on cropped element
        ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
        ctx.lineWidth = Math.max(2, Math.round(2 * scale));
        ctx.strokeRect(
          Math.round(padding * scale),
          Math.round(padding * scale),
          Math.round(clip.width * scale),
          Math.round(clip.height * scale)
        );

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve(fullDataUrl);
      img.src = fullDataUrl;
    });
  }

  /**
   * Request screenshot from Chrome runtime background service worker
   */
  function requestCapture(mode = "visible", clip = null) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "capture_screenshot", mode, clip }, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.success && response.dataUrl) {
          resolve(response.dataUrl);
        } else {
          reject(new Error(response?.error || "Không thể chụp màn hình"));
        }
      });
    });
  }

  window.__AP_INTERNAL__.feedbackStudio.capture = {
    queryFrameworkSource,
    cropDataUrl,
    requestCapture
  };
})();
