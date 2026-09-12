/**
 * Agent Pilot - Side Panel Screenshot Suite Module
 * Manages full viewport capture, element capture, region crop via Canvas, download and copy
 */

import { showToast } from "./ui-helpers.js";

export class ScreenshotPanel {
  constructor(options = {}) {
    this.getActiveTabId = options.getActiveTabId || (() => null);
    this.getSelectedElementDetails = options.getSelectedElementDetails || (() => null);

    // Screenshot Elements
    this.btnCaptureVisible = document.getElementById("btn-capture-visible");
    this.btnCaptureRegion = document.getElementById("btn-capture-region");
    this.btnCaptureElement = document.getElementById("btn-capture-element");

    this.screenshotPreviewCard = document.getElementById("screenshot-preview-card");
    this.screenshotImg = document.getElementById("screenshot-img");
    this.shotDimensions = document.getElementById("shot-dimensions");
    this.btnDownloadShot = document.getElementById("btn-download-shot");
    this.btnCopyShot = document.getElementById("btn-copy-shot");

    this.latestScreenshotDataUrl = null;

    this.bindEvents();
  }

  bindEvents() {
    if (this.btnCaptureVisible) {
      this.btnCaptureVisible.onclick = () => this.captureVisibleScreenshot();
    }

    if (this.btnCaptureRegion) {
      this.btnCaptureRegion.onclick = () => {
        const activeTabId = this.getActiveTabId();
        if (!activeTabId) return;
        chrome.tabs.sendMessage(activeTabId, { action: "start_region_crop" }, () => {
          showToast("Kéo chuột trên trang để chọn vùng cần chụp.");
        });
      };
    }

    if (this.btnCaptureElement) {
      this.btnCaptureElement.onclick = () => {
        const selected = this.getSelectedElementDetails();
        if (!selected) {
          showToast("Vui lòng soi và chọn một phần tử trước!");
          return;
        }
        this.captureElementScreenshot(selected.rect);
      };
    }

    if (this.btnDownloadShot) {
      this.btnDownloadShot.onclick = () => {
        if (!this.latestScreenshotDataUrl) return;
        const a = document.createElement("a");
        a.href = this.latestScreenshotDataUrl;
        a.download = `agent-pilot-shot-${Date.now()}.png`;
        a.click();
        showToast("Đã tải ảnh về máy tính!");
      };
    }

    if (this.btnCopyShot) {
      this.btnCopyShot.onclick = async () => {
        if (!this.latestScreenshotDataUrl) return;
        try {
          const blob = await (await fetch(this.latestScreenshotDataUrl)).blob();
          await navigator.clipboard.write([
            new ClipboardItem({ [blob.type]: blob })
          ]);
          showToast("Đã sao chép ảnh vào clipboard!");
        } catch (e) {
          showToast("Không thể sao chép ảnh: " + e.message);
        }
      };
    }
  }

  captureVisibleScreenshot() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "capture_screenshot", mode: "visible" }, (res) => {
        if (res && res.success && res.dataUrl) {
          this.displayScreenshot(res.dataUrl);
          showToast("Đã chụp toàn bộ khung nhìn!");
          resolve(res.dataUrl);
        } else {
          showToast("Lỗi chụp ảnh: " + (res ? res.error : ""));
          resolve(null);
        }
      });
    });
  }

  captureElementScreenshot(rect) {
    const activeTabId = this.getActiveTabId();
    if (!activeTabId || !rect) return;
    chrome.runtime.sendMessage({
      action: "capture_screenshot",
      mode: "element",
      tabId: activeTabId,
      clip: rect
    }, (res) => {
      if (res && res.success) {
        if (res.requiresCrop && res.dataUrl) {
          this.cropImageViaCanvas(res.dataUrl, res.clip);
        } else if (res.dataUrl) {
          this.displayScreenshot(res.dataUrl);
          showToast("Đã chụp phần tử thành công!");
        }
      }
    });
  }

  cropImageViaCanvas(fullDataUrl, clip) {
    const img = new Image();
    img.onload = () => {
      const scaleX = img.naturalWidth / window.innerWidth;
      const scaleY = img.naturalHeight / window.innerHeight;
      const sx = clip.x * scaleX;
      const sy = clip.y * scaleY;
      const sw = clip.width * scaleX;
      const sh = clip.height * scaleY;

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      const croppedDataUrl = canvas.toDataURL("image/png");
      this.displayScreenshot(croppedDataUrl);
      showToast("Đã chụp và cắt vùng thành công!");
    };
    img.src = fullDataUrl;
  }

  displayScreenshot(dataUrl) {
    this.latestScreenshotDataUrl = dataUrl;
    if (this.screenshotPreviewCard) this.screenshotPreviewCard.style.display = "block";
    if (this.screenshotImg) this.screenshotImg.src = dataUrl;

    const img = new Image();
    img.onload = () => {
      if (this.shotDimensions) {
        this.shotDimensions.textContent = `Kích thước: ${img.naturalWidth} × ${img.naturalHeight} px`;
      }
    };
    img.src = dataUrl;

    // Switch to screenshot tab
    const tabScreenshotBtn = document.querySelector('[data-tab="tab-screenshot"]');
    if (tabScreenshotBtn) tabScreenshotBtn.click();
  }
}
