/**
 * Agent Pilot - Side Panel DOM Inspector & Color Picker Module
 * Manages element inspection, coordinates, selector copying, and color palette
 */

import { showToast, escapeHtml } from "./ui-helpers.js";

export class InspectorPanel {
  constructor(options = {}) {
    this.getActiveTabId = options.getActiveTabId || (() => null);
    this.onCaptureElement = options.onCaptureElement || (() => {});

    // Inspector Elements
    this.btnToggleInspector = document.getElementById("btn-toggle-inspector");
    this.inspectorResultBox = document.getElementById("inspector-result-box");
    this.elementActions = document.getElementById("element-actions");
    this.btnMoveToElement = document.getElementById("btn-move-to-element");
    this.btnClickElement = document.getElementById("btn-click-element");
    this.btnSnapElement = document.getElementById("btn-snap-element");

    // Color Eyedropper Elements
    this.btnPickColor = document.getElementById("btn-pick-color");
    this.colorSwatchCurrent = document.getElementById("color-swatch-current");
    this.colorHex = document.getElementById("color-hex");
    this.colorRgb = document.getElementById("color-rgb");
    this.colorHsl = document.getElementById("color-hsl");
    this.paletteChips = document.getElementById("palette-chips");

    this.isInspectorActive = false;
    this.selectedElementDetails = null;
    this.colorHistory = [];

    this.bindEvents();
    this.loadColorHistory();
  }

  bindEvents() {
    if (this.btnToggleInspector) {
      this.btnToggleInspector.onclick = () => {
        const activeTabId = this.getActiveTabId();
        if (!activeTabId) return;
        this.isInspectorActive = !this.isInspectorActive;
        chrome.tabs.sendMessage(activeTabId, { action: "toggle_inspector", enabled: this.isInspectorActive }, () => {
          this.updateInspectorButton();
        });
      };
    }

    if (this.btnMoveToElement) {
      this.btnMoveToElement.onclick = () => {
        const activeTabId = this.getActiveTabId();
        if (!this.selectedElementDetails || !activeTabId) return;
        const cx = this.selectedElementDetails.rect.x + Math.round(this.selectedElementDetails.rect.width / 2);
        const cy = this.selectedElementDetails.rect.y + Math.round(this.selectedElementDetails.rect.height / 2);
        chrome.tabs.sendMessage(activeTabId, { action: "virtual_mouse_move", x: cx, y: cy });
        showToast(`Chuột ảo đang bay tới phần tử (${cx}, ${cy})`);
      };
    }

    if (this.btnClickElement) {
      this.btnClickElement.onclick = () => {
        const activeTabId = this.getActiveTabId();
        if (!this.selectedElementDetails || !activeTabId) return;
        const cx = this.selectedElementDetails.rect.x + Math.round(this.selectedElementDetails.rect.width / 2);
        const cy = this.selectedElementDetails.rect.y + Math.round(this.selectedElementDetails.rect.height / 2);
        chrome.tabs.sendMessage(activeTabId, { action: "virtual_mouse_click", x: cx, y: cy });
        showToast(`Đã click phần tử tại (${cx}, ${cy})`);
      };
    }

    if (this.btnSnapElement) {
      this.btnSnapElement.onclick = () => {
        if (!this.selectedElementDetails) return;
        this.onCaptureElement(this.selectedElementDetails.rect);
      };
    }

    if (this.btnPickColor) {
      this.btnPickColor.onclick = () => {
        const activeTabId = this.getActiveTabId();
        if (!activeTabId) return;
        chrome.tabs.sendMessage(activeTabId, { action: "pick_color" });
      };
    }
  }

  updateInspectorButton(showToastNotice = true) {
    if (!this.btnToggleInspector) return;
    if (this.isInspectorActive) {
      this.btnToggleInspector.textContent = "Tắt Soi Phần tử";
      this.btnToggleInspector.classList.replace("btn-primary", "btn-secondary");
      if (showToastNotice) showToast("Đã BẬT soi phần tử. Hãy di chuột qua trang web.");
    } else {
      this.btnToggleInspector.textContent = "Bật Soi Phần tử";
      this.btnToggleInspector.classList.replace("btn-secondary", "btn-primary");
      if (showToastNotice) showToast("Đã TẮT soi phần tử.");
    }
  }

  setInspectorActiveState(enabled) {
    this.isInspectorActive = Boolean(enabled);
    this.updateInspectorButton(false);
  }

  displayElementDetails(details) {
    this.selectedElementDetails = details;
    this.isInspectorActive = false;
    this.updateInspectorButton(false);
    if (this.elementActions) {
      this.elementActions.style.display = "flex";
      this.elementActions.style.gap = "6px";
      this.elementActions.style.flexWrap = "wrap";
    }

    if (this.inspectorResultBox) {
      this.inspectorResultBox.innerHTML = `
        <div class="detail-row">
          <span class="detail-key">Tag Name:</span>
          <span class="detail-val" style="color:#f43f5e; font-weight:700;">&lt;${escapeHtml(details.tagName)}&gt;</span>
        </div>
        <div class="detail-row">
          <span class="detail-key">Tọa độ:</span>
          <span class="detail-val">X: ${details.rect.x}px, Y: ${details.rect.y}px</span>
        </div>
        <div class="detail-row">
          <span class="detail-key">Kích thước:</span>
          <span class="detail-val">${details.rect.width} × ${details.rect.height} px</span>
        </div>
        <div class="detail-row">
          <span class="detail-key">Selector:</span>
          <span class="detail-val" style="color:#38bdf8;" title="Click để copy" id="copy-selector">${escapeHtml(details.selector)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-key">XPath:</span>
          <span class="detail-val" style="color:#a78bfa;" title="Click để copy" id="copy-xpath">${escapeHtml(details.xpath)}</span>
        </div>
        ${details.text ? `
        <div class="detail-row">
          <span class="detail-key">Nội dung:</span>
          <span class="detail-val">${escapeHtml(details.text)}</span>
        </div>` : ""}
      `;

      const copySelectorBtn = document.getElementById("copy-selector");
      if (copySelectorBtn) {
        copySelectorBtn.onclick = () => {
          navigator.clipboard.writeText(details.selector);
          showToast("Đã sao chép CSS Selector!");
        };
      }
      const copyXpathBtn = document.getElementById("copy-xpath");
      if (copyXpathBtn) {
        copyXpathBtn.onclick = () => {
          navigator.clipboard.writeText(details.xpath);
          showToast("Đã sao chép XPath!");
        };
      }
    }
  }

  getSelectedElementDetails() {
    return this.selectedElementDetails;
  }

  addColorToPalette(colorObj) {
    if (this.colorSwatchCurrent) this.colorSwatchCurrent.style.background = colorObj.hex;
    if (this.colorHex) this.colorHex.textContent = `HEX: ${colorObj.hex}`;
    if (this.colorRgb) this.colorRgb.textContent = `RGB: ${colorObj.rgb}`;
    if (this.colorHsl) this.colorHsl.textContent = `HSL: ${colorObj.hsl}`;

    if (!this.colorHistory.includes(colorObj.hex)) {
      this.colorHistory.unshift(colorObj.hex);
      if (this.colorHistory.length > 14) this.colorHistory.pop();
      this.renderPalette();
      chrome.storage.local.set({ agent_pilot_colors: this.colorHistory });
    }
  }

  renderPalette() {
    if (!this.paletteChips) return;
    this.paletteChips.innerHTML = "";
    this.colorHistory.forEach((hex) => {
      const chip = document.createElement("div");
      chip.className = "color-chip";
      chip.style.backgroundColor = hex;
      chip.title = `${hex} (Click để copy)`;
      chip.onclick = () => {
        navigator.clipboard.writeText(hex);
        showToast(`Đã copy ${hex} vào clipboard!`);
      };
      this.paletteChips.appendChild(chip);
    });
  }

  loadColorHistory() {
    chrome.storage.local.get(["agent_pilot_colors"], (res) => {
      if (res && res.agent_pilot_colors && Array.isArray(res.agent_pilot_colors)) {
        this.colorHistory = res.agent_pilot_colors;
        this.renderPalette();
      }
    });
  }
}
