/**
 * Agent Pilot - Side Panel DOM Inspector & Color Picker Module
 * Manages element inspection, subtabs (Overview & CSS Styles), coordinates, and color palette
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

    // Inspector Subtabs & CSS Viewer Elements
    this.subtabBtns = document.querySelectorAll("#inspector-subtabs .subtab-btn");
    this.subtabContents = document.querySelectorAll("#tab-inspector .subtab-content");
    this.inspectorCssBox = document.getElementById("inspector-css-box");
    this.inspectorCssSearch = document.getElementById("inspector-css-search");
    this.btnCopyAllCss = document.getElementById("btn-copy-all-css");
    this.cssSearchQuery = "";

    // Color Eyedropper Elements
    this.btnPickColor = document.getElementById("btn-pick-color");
    this.colorSwatchCurrent = document.getElementById("color-swatch-current");
    this.colorHex = document.getElementById("color-hex");
    this.colorRgb = document.getElementById("color-rgb");
    this.colorHsl = document.getElementById("color-hsl");
    this.paletteChips = document.getElementById("palette-chips");

    this.isInspectorActive = false;
    this.isEyedropperActive = false;
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

    // Inspector Subtabs Switching
    if (this.subtabBtns) {
      this.subtabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const subtabId = btn.getAttribute("data-subtab");
          this.switchSubtab(subtabId);
        });
      });
    }

    // CSS Property Search & Filter
    if (this.inspectorCssSearch) {
      this.inspectorCssSearch.addEventListener("input", (e) => {
        this.cssSearchQuery = e.target.value;
        this.renderCssProperties(this.cssSearchQuery);
      });
    }

    // Copy All CSS Button
    if (this.btnCopyAllCss) {
      this.btnCopyAllCss.addEventListener("click", () => {
        this.copyAllCss();
      });
    }

    if (this.btnPickColor) {
      this.btnPickColor.onclick = () => {
        const activeTabId = this.getActiveTabId();
        if (!activeTabId) return;
        if (this.isEyedropperActive) {
          chrome.tabs.sendMessage(activeTabId, { action: "stop_eyedropper" }, () => {
            this.setEyedropperActiveState(false);
          });
        } else {
          this.setEyedropperActiveState(true);
          chrome.tabs.sendMessage(activeTabId, { action: "pick_color" }, (res) => {
            if (res && res.color) {
              this.addColorToPalette(res.color);
            }
            this.setEyedropperActiveState(false);
          });
        }
      };
    }
  }

  switchSubtab(targetSubtabId) {
    if (this.subtabBtns) {
      this.subtabBtns.forEach((btn) => {
        const match = btn.getAttribute("data-subtab") === targetSubtabId;
        btn.classList.toggle("active", match);
      });
    }
    if (this.subtabContents) {
      this.subtabContents.forEach((panel) => {
        const match = panel.id === targetSubtabId;
        panel.classList.toggle("active", match);
      });
    }
  }

  setEyedropperActiveState(active) {
    this.isEyedropperActive = Boolean(active);
    if (!this.btnPickColor) return;
    if (this.isEyedropperActive) {
      this.btnPickColor.textContent = "🎯 Đang chọn màu...";
      this.btnPickColor.classList.replace("btn-secondary", "btn-warning");
    } else {
      this.btnPickColor.textContent = "🎨 Lấy mã màu";
      this.btnPickColor.classList.replace("btn-warning", "btn-secondary");
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

    // 1. Render Tab 1: Tổng quan
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

    // 2. Render Tab 2: Thông số CSS mà phần tử đang chịu
    this.renderCssProperties(this.cssSearchQuery || "");
  }

  renderCssProperties(filter = "") {
    if (!this.inspectorCssBox) return;
    if (!this.selectedElementDetails) {
      this.inspectorCssBox.innerHTML = `<div class="empty-hint">Chưa có phần tử nào được chọn để hiển thị thông số CSS. Hãy bấm "Bật Soi Phần tử" và click chọn 1 phần tử.</div>`;
      return;
    }

    const styles = this.selectedElementDetails.computedStyles || this.selectedElementDetails.styles || {};
    const query = filter.trim().toLowerCase();

    // Group definitions
    const groups = [
      {
        title: "🔤 Kiểu Chữ (Typography)",
        props: ["color", "font-family", "font-size", "font-weight", "font-style", "line-height", "text-align", "letter-spacing", "text-decoration", "white-space", "word-break"]
      },
      {
        title: "📐 Bố Cục & Vị Trí (Layout & Box)",
        props: ["display", "position", "top", "right", "bottom", "left", "z-index", "box-sizing", "overflow", "overflow-x", "overflow-y"]
      },
      {
        title: "📏 Kích Thước & Khoảng Cách (Dimensions & Spacing)",
        props: ["width", "height", "min-width", "max-width", "min-height", "max-height", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left"]
      },
      {
        title: "🎨 Nền & Viền (Visuals & Border)",
        props: ["background-color", "background-image", "background-size", "border", "border-width", "border-style", "border-color", "border-radius", "outline", "box-shadow", "opacity", "visibility", "cursor"]
      },
      {
        title: "⚡ Flexbox & Grid",
        props: ["flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", "gap", "grid-template-columns", "grid-template-rows"]
      },
      {
        title: "✨ Hiệu Ứng (Transform & Transition)",
        props: ["transform", "transition"]
      }
    ];

    let html = "";
    let matchCount = 0;

    groups.forEach((g) => {
      let groupRows = "";
      g.props.forEach((prop) => {
        const val = styles[prop];
        if (val !== undefined && val !== null && val !== "") {
          if (!query || prop.toLowerCase().includes(query) || String(val).toLowerCase().includes(query)) {
            matchCount++;
            const isColor = prop.includes("color") || (typeof val === "string" && (val.startsWith("#") || val.startsWith("rgb") || val.startsWith("hsl")));
            const colorPreview = isColor ? `<span class="css-color-preview" style="background:${escapeHtml(val)};"></span>` : "";
            groupRows += `
              <div class="css-prop-row" data-prop="${escapeHtml(prop)}" data-val="${escapeHtml(val)}" title="Click để copy: ${escapeHtml(prop)}: ${escapeHtml(val)};">
                <span class="css-prop-name">${escapeHtml(prop)}:</span>
                <div class="css-prop-val-wrap">
                  ${colorPreview}
                  <span class="css-prop-val">${escapeHtml(val)}</span>
                </div>
              </div>
            `;
          }
        }
      });

      if (groupRows) {
        html += `<div class="css-group-title">${g.title}</div>${groupRows}`;
      }
    });

    if (!html) {
      if (query) {
        html = `<div class="empty-hint">Không tìm thấy thuộc tính CSS nào khớp với "${escapeHtml(query)}".</div>`;
      } else {
        html = `<div class="empty-hint">Không có thông số CSS nào được trích xuất.</div>`;
      }
    }

    this.inspectorCssBox.innerHTML = html;

    // Add click listeners to copy CSS property
    const rows = this.inspectorCssBox.querySelectorAll(".css-prop-row");
    rows.forEach((row) => {
      row.onclick = () => {
        const prop = row.getAttribute("data-prop");
        const val = row.getAttribute("data-val");
        const text = `${prop}: ${val};`;
        navigator.clipboard.writeText(text);
        showToast(`Đã sao chép: ${text}`);
      };
    });
  }

  copyAllCss() {
    if (!this.selectedElementDetails) {
      showToast("Chưa có phần tử nào được chọn để sao chép CSS!");
      return;
    }
    const sel = this.selectedElementDetails.selector || this.selectedElementDetails.tagName;
    const styles = this.selectedElementDetails.computedStyles || this.selectedElementDetails.styles || {};
    const lines = [];
    lines.push(`/* CSS computed for: ${sel} */`);
    lines.push(`${sel} {`);
    for (const [prop, val] of Object.entries(styles)) {
      if (val) {
        lines.push(`  ${prop}: ${val};`);
      }
    }
    lines.push(`}`);
    const fullCss = lines.join("\n");
    navigator.clipboard.writeText(fullCss);
    showToast("Đã sao chép toàn bộ khai báo CSS vào clipboard!");
  }

  getSelectedElementDetails() {
    return this.selectedElementDetails;
  }

  addColorToPalette(colorObj) {
    this.setEyedropperActiveState(false);
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
