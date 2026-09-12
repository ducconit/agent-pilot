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
    this.toggleAutoCopy = document.getElementById("toggle-auto-copy-shot");

    this.latestScreenshotDataUrl = null;
    this.autoCopyEnabled = false;
    try {
      this.autoCopyEnabled = localStorage.getItem("agent_pilot_auto_copy_shot") === "true";
      if (this.toggleAutoCopy) {
        this.toggleAutoCopy.checked = this.autoCopyEnabled;
      }
    } catch (e) {}

    this.bindEvents();
  }

  bindEvents() {
    if (this.toggleAutoCopy) {
      this.toggleAutoCopy.onchange = () => {
        this.autoCopyEnabled = this.toggleAutoCopy.checked;
        try {
          localStorage.setItem("agent_pilot_auto_copy_shot", String(this.autoCopyEnabled));
        } catch (e) {}
        showToast(this.autoCopyEnabled ? "Đã bật tự động sao chép ảnh vào clipboard." : "Đã tắt tự động sao chép ảnh.");
      };
    }

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
        const activeTabId = this.getActiveTabId();
        if (!activeTabId) {
          showToast("Không tìm thấy tab hoạt động.");
          return;
        }
        chrome.tabs.sendMessage(activeTabId, { action: "start_element_snap" }, () => {
          if (chrome.runtime.lastError) {
            showToast("Vui lòng làm mới trang web trước khi chụp!");
          } else {
            showToast("📸 Di chuột và click chọn phần tử trên trang web để chụp • Esc để hủy");
          }
        });
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
      this.btnCopyShot.onclick = () => {
        this.copyCurrentScreenshotToClipboard(true);
      };
    }
  }

  async copyCurrentScreenshotToClipboard(showExplicitToast = true) {
    if (!this.latestScreenshotDataUrl) {
      if (showExplicitToast) showToast("Chưa có ảnh chụp để sao chép!");
      return false;
    }
    try {
      if (typeof window !== "undefined" && window.focus) window.focus();
      const blob = await this.getPngBlobFromDataUrl(this.latestScreenshotDataUrl);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]);
      if (showExplicitToast) {
        showToast("📋 Đã sao chép ảnh vào clipboard!");
      }
      return true;
    } catch (e) {
      console.warn("[AgentPilot] Clipboard copy attempt 1 notice:", e);
      // Secondary attempt with forced focus
      try {
        if (typeof window !== "undefined" && window.focus) window.focus();
        const blob = await this.getPngBlobFromDataUrl(this.latestScreenshotDataUrl);
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob })
        ]);
        if (showExplicitToast) {
          showToast("📋 Đã sao chép ảnh vào clipboard!");
        }
        return true;
      } catch (err2) {
        console.error("[AgentPilot] Clipboard copy failed:", err2);
        if (showExplicitToast) {
          showToast("Không thể sao chép ảnh: " + (err2.message || "Lỗi clipboard"));
        }
        return false;
      }
    }
  }

  async getPngBlobFromDataUrl(dataUrl) {
    if (dataUrl.startsWith("data:image/png;base64,")) {
      try {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        if (blob.type === "image/png") return blob;
        return new Blob([await blob.arrayBuffer()], { type: "image/png" });
      } catch (e) {
        // Fallback for extreme environments
        const base64 = dataUrl.slice("data:image/png;base64,".length);
        const binStr = atob(base64);
        const len = binStr.length;
        const u8arr = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          u8arr[i] = binStr.charCodeAt(i);
        }
        return new Blob([u8arr], { type: "image/png" });
      }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("Canvas toBlob failed"));
        }, "image/png");
      };
      img.onerror = () => reject(new Error("Không thể nạp ảnh"));
      img.src = dataUrl;
    });
  }

  captureVisibleScreenshot() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "capture_screenshot", mode: "visible" }, (res) => {
        if (res && res.success && res.dataUrl) {
          this.displayScreenshot(res.dataUrl, "Đã chụp toàn bộ khung nhìn!");
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
      if (chrome.runtime.lastError) {
        showToast("Lỗi chụp phần tử: " + chrome.runtime.lastError.message);
        return;
      }
      if (res && res.success && res.dataUrl) {
        if (res.requiresCrop && res.clip) {
          this.cropImageViaCanvas(res.dataUrl, res.clip);
        } else {
          const img = new Image();
          img.onload = () => {
            if (res.clip && (img.naturalWidth > res.clip.width * 1.5 || img.naturalHeight > res.clip.height * 1.5)) {
              this.cropImageViaCanvas(res.dataUrl, res.clip);
            } else {
              this.displayScreenshot(res.dataUrl, "Đã chụp phần tử thành công!");
            }
          };
          img.src = res.dataUrl;
        }
      } else {
        showToast("Lỗi chụp phần tử: " + (res ? res.error : ""));
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
      this.displayScreenshot(croppedDataUrl, "Đã chụp và cắt vùng thành công!");
    };
    img.src = fullDataUrl;
  }

  displayScreenshot(dataUrl, customSuccessToast = null) {
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

    // Auto-copy to clipboard if enabled
    if (this.autoCopyEnabled) {
      this.copyCurrentScreenshotToClipboard(false).then((copied) => {
        if (copied) {
          showToast("📋 Đã chụp & tự động sao chép vào clipboard!");
        } else if (customSuccessToast) {
          showToast(customSuccessToast);
        }
      });
    } else if (customSuccessToast) {
      showToast(customSuccessToast);
    }
  }
}
