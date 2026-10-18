/**
 * Agent Pilot - Side Panel DOM Inspector & Color Picker Module
 * Manages element inspection, subtabs (Overview & CSS Styles), coordinates, and color palette
 */

import { showToast, escapeHtml } from "./ui-helpers.js";
import { normalizeColorData } from "./color-utils.js";

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

    this.overviewToolbar = document.getElementById("overview-toolbar");
    this.btnCopyAllOverview = document.getElementById("btn-copy-all-overview");

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
    this.colorRgba = document.getElementById("color-rgba");
    this.colorHsl = document.getElementById("color-hsl");
    this.colorOklch = document.getElementById("color-oklch");
    this.valHex = document.getElementById("val-hex");
    this.valRgb = document.getElementById("val-rgb");
    this.valRgba = document.getElementById("val-rgba");
    this.valHsl = document.getElementById("val-hsl");
    this.valOklch = document.getElementById("val-oklch");
    this.paletteChips = document.getElementById("palette-chips");

    this.isInspectorActive = false;
    this.isEyedropperActive = false;
    this.selectedElementDetails = null;
    this.colorHistory = [];

    this.bindEvents();
    this.loadColorHistory();
  }

  async sendTabMessage(tabId, msg) {
    if (!tabId) return null;
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (_) {
      try {
        const injected = await chrome.runtime.sendMessage({ action: "ensure_content_script", tabId });
        if (injected && injected.success) {
          return await chrome.tabs.sendMessage(tabId, msg);
        }
      } catch (_) {}
      showToast("Vui lòng làm mới (F5) trang web để sử dụng tính năng này!");
      return null;
    }
  }

  bindEvents() {
    if (this.btnToggleInspector) {
      this.btnToggleInspector.onclick = async () => {
        const activeTabId = this.getActiveTabId();
        if (!activeTabId) return;
        this.isInspectorActive = !this.isInspectorActive;
        const res = await this.sendTabMessage(activeTabId, { action: "toggle_inspector", enabled: this.isInspectorActive });
        if (!res) {
          this.isInspectorActive = false;
        }
        this.updateInspectorButton(Boolean(res));
      };
    }

    if (this.btnMoveToElement) {
      this.btnMoveToElement.onclick = async () => {
        const activeTabId = this.getActiveTabId();
        if (!this.selectedElementDetails || !activeTabId) return;
        const cx = this.selectedElementDetails.rect.x + Math.round(this.selectedElementDetails.rect.width / 2);
        const cy = this.selectedElementDetails.rect.y + Math.round(this.selectedElementDetails.rect.height / 2);
        const res = await this.sendTabMessage(activeTabId, { action: "virtual_mouse_move", x: cx, y: cy });
        if (res) showToast(`Chuột ảo đang bay tới phần tử (${cx}, ${cy})`);
      };
    }

    if (this.btnClickElement) {
      this.btnClickElement.onclick = async () => {
        const activeTabId = this.getActiveTabId();
        if (!this.selectedElementDetails || !activeTabId) return;
        const cx = this.selectedElementDetails.rect.x + Math.round(this.selectedElementDetails.rect.width / 2);
        const cy = this.selectedElementDetails.rect.y + Math.round(this.selectedElementDetails.rect.height / 2);
        const res = await this.sendTabMessage(activeTabId, { action: "virtual_mouse_click", x: cx, y: cy });
        if (res) showToast(`Đã click phần tử tại (${cx}, ${cy})`);
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

    // Copy All Overview Button
    if (this.btnCopyAllOverview) {
      this.btnCopyAllOverview.addEventListener("click", () => {
        this.copyAllOverview();
      });
    }

    // Copy All CSS Button
    if (this.btnCopyAllCss) {
      this.btnCopyAllCss.addEventListener("click", () => {
        this.copyAllCss();
      });
    }

    if (this.btnPickColor) {
      this.btnPickColor.onclick = async () => {
        const activeTabId = this.getActiveTabId();
        if (!activeTabId) return;
        if (this.isEyedropperActive) {
          await this.sendTabMessage(activeTabId, { action: "stop_eyedropper" });
          this.setEyedropperActiveState(false);
        } else {
          this.setEyedropperActiveState(true);
          const res = await this.sendTabMessage(activeTabId, { action: "pick_color" });
          if (res && res.color) {
            this.addColorToPalette(res.color);
          }
          this.setEyedropperActiveState(false);
        }
      };
    }

    // Color Eyedropper Format Rows Click-to-Copy (HEX, RGB, RGBA, HSL, OKLCH)
    const colorRows = [this.colorHex, this.colorRgb, this.colorRgba, this.colorHsl, this.colorOklch].filter(Boolean);
    colorRows.forEach((row) => {
      const copyColorValue = () => {
        const type = row.getAttribute("data-type") || "màu";
        const val = row.getAttribute("data-value") || row.querySelector(".color-format-val")?.textContent?.trim() || "";
        if (val) {
          navigator.clipboard.writeText(val)
            .then(() => {
              showToast(`Đã sao chép ${type}: ${val}`);
            })
            .catch((err) => {
              console.warn(`[AgentPilot Inspector] Không thể sao chép ${type}:`, err);
              showToast(`Không thể sao chép vào clipboard (${type})`);
            });
        }
      };
      row.addEventListener("click", copyColorValue);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          copyColorValue();
        }
      });
    });
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

    if (this.overviewToolbar) {
      this.overviewToolbar.style.display = "flex";
    }

    // 1. Render Tab 1: Tổng quan (mọi mục đều hỗ trợ click để sao chép)
    if (this.inspectorResultBox) {
      const matchBadge = details.selectorMatches === 1
        ? " ✓ (1 match)"
        : (details.selectorMatches > 1 ? ` ⚠ (${details.selectorMatches} matches)` : "");

      const rows = [
        {
          key: "Tag Name",
          label: "Tag Name",
          val: `<${details.tagName}>`,
          copyText: `<${details.tagName}>`,
          id: "copy-tag",
          color: "#f43f5e",
          weight: "700"
        },
        {
          key: "Tọa độ",
          label: "Tọa độ",
          val: `X: ${details.rect.x}px, Y: ${details.rect.y}px`,
          copyText: `X: ${details.rect.x}px, Y: ${details.rect.y}px`,
          id: "copy-coords",
          color: "#94a3b8"
        },
        {
          key: "Kích thước",
          label: "Kích thước",
          val: `${details.rect.width} × ${details.rect.height} px`,
          copyText: `${details.rect.width} × ${details.rect.height} px`,
          id: "copy-dimensions",
          color: "#94a3b8"
        },
        {
          key: "Selector",
          label: "CSS Selector",
          val: `${details.selector}${matchBadge}`,
          copyText: details.selector,
          id: "copy-selector",
          color: details.selectorMatches > 1 ? "#f59e0b" : "#38bdf8"
        }
      ];

      if (details.playwrightLocator) {
        rows.push({
          key: "Playwright",
          label: "Playwright Locator",
          val: details.playwrightLocator,
          copyText: details.playwrightLocator,
          id: "copy-playwright",
          color: "#22d3ee"
        });
      }

      if (details.testId) {
        rows.push({
          key: "Test ID",
          label: "Test ID",
          val: `${details.testIdAttr || "data-testid"}="${details.testId}"`,
          copyText: details.testId,
          id: "copy-testid",
          color: "#38bdf8"
        });
      }

      rows.push({
        key: "XPath",
        label: "XPath",
        val: details.xpath,
        copyText: details.xpath,
        id: "copy-xpath",
        color: "#a78bfa"
      });

      if (details.role || details.accessibleName) {
        const ariaSummary = `${details.role ? `role="${details.role}"` : ""}${details.role && details.accessibleName ? " • " : ""}${details.accessibleName ? `"${details.accessibleName}"` : ""}`;
        rows.push({
          key: "Trợ năng",
          label: "Thông tin Trợ năng (ARIA)",
          val: ariaSummary,
          copyText: ariaSummary,
          id: "copy-aria",
          color: "#cbd5e1"
        });
      }

      if (details.a11y && details.a11y.contrastRatio !== null && details.a11y.contrastRatio !== undefined) {
        const wcag = details.a11y.wcagLevel || "AA";
        const ratioText = `${details.a11y.contrastRatio}:1 (WCAG ${wcag === "Fail" ? "Chưa đạt AA" : wcag})`;
        rows.push({
          key: "Tương phản",
          label: "Độ tương phản màu (WCAG)",
          val: ratioText,
          copyText: ratioText,
          id: "copy-contrast",
          color: wcag === "Fail" ? "#f87171" : "#34d399"
        });
      }

      if (details.a11y?.warnings && details.a11y.warnings.length > 0) {
        const warnText = details.a11y.warnings.join(" • ");
        rows.push({
          key: "⚠️ Lưu ý QA",
          label: "Cảnh báo QA / Accessibility",
          val: warnText,
          copyText: warnText,
          id: "copy-a11y-warn",
          color: "#fbbf24"
        });
      }

      if (details.text) {
        rows.push({
          key: "Nội dung",
          label: "Nội dung",
          val: details.text,
          copyText: details.text,
          id: "copy-text",
          color: "#34d399"
        });
      }

      if (details.value !== undefined && details.value !== "") {
        rows.push({
          key: "Giá trị",
          label: "Giá trị (Value)",
          val: details.value,
          copyText: details.value,
          id: "copy-value",
          color: "#fbbf24"
        });
      }

      this.inspectorResultBox.innerHTML = rows.map((r) => `
        <div class="detail-row clickable" role="button" tabindex="0" data-copy="${escapeHtml(r.copyText)}" data-label="${escapeHtml(r.label)}" title="Click để sao chép ${escapeHtml(r.label)}">
          <span class="detail-key">${escapeHtml(r.key)}:</span>
          <span class="detail-val" style="${r.color ? `color:${r.color};` : ""}${r.weight ? `font-weight:${r.weight};` : ""}" ${r.id ? `id="${r.id}"` : ""}>${escapeHtml(r.val)}</span>
          <span class="copy-hint" title="Sao chép">📋</span>
        </div>
      `).join("");

      // Add click listeners to all clickable rows in Overview
      const clickableRows = this.inspectorResultBox.querySelectorAll(".detail-row.clickable");
      clickableRows.forEach((row) => {
        const copyRowValue = () => {
          const copyText = row.getAttribute("data-copy");
          const label = row.getAttribute("data-label");
          if (copyText) {
            navigator.clipboard.writeText(copyText).catch(() => showToast("Không thể sao chép vào clipboard"));
            showToast(`Đã sao chép ${label}!`);
          }
        };
        row.onclick = copyRowValue;
        row.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            copyRowValue();
          }
        };
      });
    }

    // 2. Render Tab 2: Thông số CSS mà phần tử đang chịu
    this.renderCssProperties(this.cssSearchQuery || "");
  }

  copyAllOverview() {
    if (!this.selectedElementDetails) {
      showToast("Chưa có phần tử nào được chọn để sao chép!");
      return;
    }
    const d = this.selectedElementDetails;
    const lines = [
      `Tag Name: <${d.tagName}>`,
      `Tọa độ: X: ${d.rect.x}px, Y: ${d.rect.y}px`,
      `Kích thước: ${d.rect.width} × ${d.rect.height} px`,
      `CSS Selector: ${d.selector}${d.selectorMatches ? ` (${d.selectorMatches} match)` : ""}`
    ];
    if (d.playwrightLocator) lines.push(`Playwright Locator: ${d.playwrightLocator}`);
    if (d.testId) lines.push(`Test ID: ${d.testIdAttr || "data-testid"}="${d.testId}"`);
    lines.push(`XPath: ${d.xpath}`);
    if (d.role || d.accessibleName) {
      lines.push(`ARIA: ${d.role ? `role="${d.role}" ` : ""}${d.accessibleName ? `"${d.accessibleName}"` : ""}`.trim());
    }
    if (d.a11y && d.a11y.contrastRatio !== null && d.a11y.contrastRatio !== undefined) {
      lines.push(`Độ tương phản WCAG: ${d.a11y.contrastRatio}:1 (${d.a11y.wcagLevel || "AA"})`);
    }
    if (d.a11y?.warnings?.length) {
      lines.push(`Lưu ý QA: ${d.a11y.warnings.join("; ")}`);
    }
    if (d.text) lines.push(`Nội dung: ${d.text}`);
    if (d.value !== undefined && d.value !== "") lines.push(`Giá trị: ${d.value}`);

    const fullOverview = lines.join("\n");
    navigator.clipboard.writeText(fullOverview).catch(() => showToast("Không thể sao chép vào clipboard"));
    showToast("Đã sao chép toàn bộ thông tin phần tử vào clipboard!");
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
            const safeColor = String(val).replace(/[^a-zA-Z0-9#(),.%\s/-]/g, "");
            const colorPreview = isColor ? `<span class="css-color-preview" style="background:${escapeHtml(safeColor)};"></span>` : "";
            groupRows += `
              <div class="css-prop-row" role="button" tabindex="0" data-prop="${escapeHtml(prop)}" data-val="${escapeHtml(val)}" title="Click để copy: ${escapeHtml(prop)}: ${escapeHtml(val)};">
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
      const copyCssProp = () => {
        const prop = row.getAttribute("data-prop");
        const val = row.getAttribute("data-val");
        const text = `${prop}: ${val};`;
        navigator.clipboard.writeText(text).catch(() => showToast("Không thể sao chép vào clipboard"));
        showToast(`Đã sao chép: ${text}`);
      };
      row.onclick = copyCssProp;
      row.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          copyCssProp();
        }
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
    navigator.clipboard.writeText(fullCss).catch(() => showToast("Không thể sao chép vào clipboard"));
    showToast("Đã sao chép toàn bộ khai báo CSS vào clipboard!");
  }

  getSelectedElementDetails() {
    return this.selectedElementDetails;
  }

  updateColorDisplay(norm) {
    if (!norm) return;
    if (this.colorSwatchCurrent) this.colorSwatchCurrent.style.background = norm.hex;

    if (this.colorHex) {
      this.colorHex.setAttribute("data-value", norm.hex);
      if (this.valHex) this.valHex.textContent = norm.hex;
      else this.colorHex.textContent = `HEX: ${norm.hex}`;
    }
    if (this.colorRgb) {
      this.colorRgb.setAttribute("data-value", norm.rgb);
      if (this.valRgb) this.valRgb.textContent = norm.rgb;
      else this.colorRgb.textContent = `RGB: ${norm.rgb}`;
    }
    if (this.colorRgba) {
      this.colorRgba.setAttribute("data-value", norm.rgba);
      if (this.valRgba) this.valRgba.textContent = norm.rgba;
      else this.colorRgba.textContent = `RGBA: ${norm.rgba}`;
    }
    if (this.colorHsl) {
      this.colorHsl.setAttribute("data-value", norm.hsl);
      if (this.valHsl) this.valHsl.textContent = norm.hsl;
      else this.colorHsl.textContent = `HSL: ${norm.hsl}`;
    }
    if (this.colorOklch) {
      this.colorOklch.setAttribute("data-value", norm.oklch);
      if (this.valOklch) this.valOklch.textContent = norm.oklch;
      else this.colorOklch.textContent = `OKLCH: ${norm.oklch}`;
    }
  }

  addColorToPalette(colorObj) {
    this.setEyedropperActiveState(false);
    const norm = normalizeColorData(colorObj);
    if (!norm) return;

    this.updateColorDisplay(norm);

    const hexNorm = norm.hex.toLowerCase();
    if (!this.colorHistory.map((h) => (typeof h === "string" ? h.toLowerCase() : "")).includes(hexNorm)) {
      this.colorHistory.unshift(norm.hex);
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
      chip.title = `${hex} (Click để copy & xem 5 định dạng)`;
      chip.onclick = () => {
        navigator.clipboard.writeText(hex)
          .then(() => {
            showToast(`Đã copy ${hex} vào clipboard!`);
          })
          .catch((err) => {
            console.warn("[AgentPilot Palette] Không thể copy chip màu:", err);
          });
        const norm = normalizeColorData(hex);
        if (norm) {
          this.updateColorDisplay(norm);
        }
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
