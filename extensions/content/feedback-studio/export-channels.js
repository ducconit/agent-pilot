/**
 * Agent Pilot - Feedback Studio Export Channels
 * Channel A (Live Agent Push), Channel B (Agent Inbox Persistence), Channel C (Markdown Prompt Clipboard).
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};
  window.__AP_INTERNAL__.feedbackStudio = window.__AP_INTERNAL__.feedbackStudio || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.fsChannels) return;
  window.__AP_INTERNAL__.__guards.fsChannels = true;

  const constants = window.__AP_INTERNAL__.feedbackStudio.constants || {};
  const showToast = constants.showToast || (() => {});

  // =========================================================================
  // Channel C: 1-Click Clipboard Markdown Prompt Generator
  // =========================================================================

  function generateMarkdownPrompt(customItems, options = {}) {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    const items = (customItems && customItems.length) ? customItems : (state?.getItems() || []);
    if (!items || !items.length) return null;

    const includeBase64Images = options.includeBase64Images !== false;
    const diagnostics = options.diagnostics || null;
    const env = diagnostics?.environment || {
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      devicePixelRatio: window.devicePixelRatio || 1
    };
    const reproSteps = diagnostics?.reproSteps || (window.__AP_INTERNAL__.inspector?.getReproSteps ? window.__AP_INTERNAL__.inspector.getReproSteps() : []);
    const consoleErrors = diagnostics?.consoleErrors || [];
    const networkErrors = diagnostics?.networkErrors || [];

    let md = `### 🎯 YÊU CẦU CHỈNH SỬA GIAO DIỆN & BÁO CÁO QA (Agent Pilot Visual Feedback)\n\n`;
    md += `- **URL**: \`${window.location.href}\`\n`;
    md += `- **Tiêu đề trang**: "${document.title}"\n`;
    md += `- **Môi trường hiển thị (Viewport)**: \`${env.viewport}\` (DPR: \`${env.devicePixelRatio}x\`)\n`;
    md += `- **Thời gian ghi nhận**: ${new Date().toLocaleString("vi-VN")}\n`;
    md += `- **Tổng số mục phản hồi**: ${items.length}\n\n`;
    md += `---\n\n`;

    items.forEach((item, index) => {
      const num = index + 1;
      md += `#### Mục ${num}: [${item.mode.toUpperCase()}] ${item.title}\n`;

      if (item.component) {
        md += `- **Component Framework**: \`${item.component.framework || "React"}\`\n`;
        md += `- **Component Name**: \`<${item.component.componentName} />\`\n`;
        if (item.component.fileName) {
          md += `- **Đường dẫn tệp nguồn (Source File)**: \`${item.component.fileName}${item.component.lineNumber ? `:${item.component.lineNumber}` : ""}\`\n`;
        }
        if (item.component.hierarchy) {
          const hierStr = Array.isArray(item.component.hierarchy)
            ? item.component.hierarchy.join(" > ")
            : String(item.component.hierarchy);
          md += `- **Cây Component**: \`${hierStr}\`\n`;
        }
      }

      if (item.dom) {
        const matchSuffix = item.dom.selectorMatches !== undefined
          ? (item.dom.selectorMatches === 1 ? " *(Duy nhất: 1 match)*" : ` *(Trùng lặp: ${item.dom.selectorMatches} matches)*`)
          : "";
        md += `- **CSS Selector**: \`${item.dom.selector || item.dom.tagName}\`${matchSuffix}\n`;
        if (item.dom.playwrightLocator) {
          md += `- **Playwright Locator**: \`${item.dom.playwrightLocator}\`\n`;
        }
        if (item.dom.testId) {
          md += `- **Test ID**: \`${item.dom.testIdAttr || "data-testid"}="${item.dom.testId}"\`\n`;
        }
        if (item.dom.xpath) md += `- **XPath**: \`${item.dom.xpath}\`\n`;
        if (item.dom.role || item.dom.accessibleName) {
          md += `- **Trợ năng (ARIA)**: role=\`${item.dom.role || "none"}\`${item.dom.accessibleName ? `, name="${item.dom.accessibleName}"` : ""}\n`;
        }
        if (item.dom.a11y && item.dom.a11y.contrastRatio !== undefined && item.dom.a11y.contrastRatio !== null) {
          md += `- **Độ tương phản chữ/nền (WCAG)**: \`${item.dom.a11y.contrastRatio}:1\` (Chuẩn: **${item.dom.a11y.wcagLevel || "AA"}**)\n`;
        }
        if (item.dom.a11y?.warnings && item.dom.a11y.warnings.length > 0) {
          md += `- **⚠️ Cảnh báo QA / Accessibility**: ${item.dom.a11y.warnings.join("; ")}\n`;
        }
        if (item.dom.text) md += `- **Nội dung text**: "${item.dom.text.replace(/\n+/g, " ").slice(0, 150)}"\n`;
        if (item.dom.styles) {
          md += `- **Thông số CSS hiện tại**: \`color: ${item.dom.styles.color}; background: ${item.dom.styles.backgroundColor}; font-size: ${item.dom.styles.fontSize};\`\n`;
        }
      }

      if (item.clip) {
        md += `- **Tọa độ / Kích thước**: ${item.clip.width}×${item.clip.height}px (x: ${item.clip.x}, y: ${item.clip.y})\n`;
      }

      if (item.annotations && item.annotations.length) {
        md += `- **Các điểm & khung đánh dấu (Annotations)**:\n`;
        item.annotations.forEach((ann, pinIdx) => {
          const pinNum = pinIdx + 1;
          if (ann.type === "box") {
            md += `  - ⬜ Khung #${pinNum} (${ann.width}×${ann.height}px tại x:${ann.x}, y:${ann.y}): ${ann.comment || "Cần sửa khu vực này"}\n`;
          } else {
            md += `  - 📍 Điểm #${pinNum} (x:${ann.x}, y:${ann.y}): ${ann.comment || "Cần sửa vị trí này"}\n`;
          }
        });
      }

      md += `- **Yêu cầu chỉnh sửa của người dùng (User Note)**:\n`;
      md += `  > ${item.comment ? item.comment.replace(/\n/g, "\n  > ") : "*(Không có ghi chú cụ thể)*"}\n\n`;

      if (item.screenshotDataUrl) {
        if (includeBase64Images) {
          md += `- **Ảnh chụp thực tế**: \n  ![Mục ${num}](${item.screenshotDataUrl})\n\n`;
        } else {
          md += `- **Ảnh chụp thực tế**: \`item_${num}.png\`\n\n`;
        }
      }

      md += `---\n\n`;
    });

    if (reproSteps && reproSteps.length > 0) {
      md += `#### 👣 Các bước thao tác tái hiện (Steps to Reproduce)\n`;
      reproSteps.slice(-10).forEach((step, idx) => {
        md += `${idx + 1}. ${step.description}\n`;
      });
      md += `\n`;
    }

    if (consoleErrors && consoleErrors.length > 0) {
      md += `#### 🚨 Lỗi Console / Runtime ghi nhận trên trang (${consoleErrors.length})\n`;
      consoleErrors.slice(-10).forEach((err) => {
        const countBadge = err.count > 1 ? ` *(×${err.count})*` : "";
        const srcBadge = err.source ? ` tại \`${err.source}\`` : "";
        md += `- **[${err.type || "error"}]** \`${String(err.message).replace(/`/g, "'")}\`${srcBadge}${countBadge}\n`;
      });
      md += `\n`;
    }

    if (networkErrors && networkErrors.length > 0) {
      md += `#### 🌐 Request Mạng / API thất bại (${networkErrors.length})\n`;
      networkErrors.slice(-10).forEach((net) => {
        const statusLabel = net.status > 0 ? `HTTP ${net.status}${net.statusText ? ` ${net.statusText}` : ""}` : (net.statusText || "Network Error");
        const countBadge = net.count > 1 ? ` *(×${net.count})*` : "";
        md += `- **[${statusLabel}]** \`${net.method} ${net.url}\` (${net.durationMs || 0}ms)${countBadge}\n`;
      });
      md += `\n`;
    }

    md += `\n**Chỉ dẫn cho AI Agent**:\n`;
    md += `1. Xem xét chính xác tệp nguồn, component, lỗi Console/Network (nếu có) và các bước tái hiện được liệt kê ở trên.\n`;
    md += `2. Cập nhật mã nguồn và kiểu dáng CSS/Tailwind theo đúng yêu cầu ghi chú của người dùng.\n`;
    md += `3. Giữ nguyên các chức năng và cấu trúc không được yêu cầu thay đổi.\n`;

    return md;
  }

  async function collectDiagnosticsSafe() {
    try {
      if (window.__AP_INTERNAL__.inspector?.queryPageDiagnostics) {
        return await window.__AP_INTERNAL__.inspector.queryPageDiagnostics({ clear: false });
      }
    } catch (_) {}
    return null;
  }

  async function copyFeedbackPrompt() {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    const items = state?.getItems() || [];
    if (!items.length) {
      showToast("⚠️ Chưa có vị trí nào được đánh dấu để copy. Hãy chọn phần tử hoặc kéo vùng trước!");
      return;
    }

    const diagnostics = await collectDiagnosticsSafe();
    // Use compact image reference in clipboard prompt so pasting into AI chat does not overflow token limits with multi-MB base64 strings
    const md = generateMarkdownPrompt(items, { diagnostics, includeBase64Images: false });
    try {
      await navigator.clipboard.writeText(md);
      showToast(`📋 Đã copy ${items.length} vị trí kèm chẩn đoán QA! Hãy dán (Ctrl+V) vào khung chat Agent.`);
    } catch (err) {
      // Fallback via textarea
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast(`📋 Đã copy ${items.length} vị trí chú thích vào Clipboard!`);
    }
  }

  // =========================================================================
  // Channel B: Save feedback items to ~/.agent-pilot/inbox/feedback/<timestamp>/*
  // =========================================================================

  async function saveFeedbackToInbox() {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    const items = state?.getItems() || [];
    if (items.length === 0) {
      showToast("⚠️ Chưa có vị trí nào được đánh dấu để lưu vào inbox. Hãy chọn phần tử hoặc kéo vùng trước!");
      return { success: false, error: "No feedback items" };
    }

    showToast("💾 Đang lưu chú thích & dữ liệu chẩn đoán vào inbox...");
    const diagnostics = await collectDiagnosticsSafe();
    const promptMd = generateMarkdownPrompt(items, { diagnostics, includeBase64Images: false });
    const payload = {
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title,
      items,
      diagnostics,
      prompt: promptMd
    };

    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: "save_feedback_inbox",
          payload
        }, (res) => resolve(res || { success: false }));
      });

      if (resp && resp.success) {
        if (resp.storage === "filesystem") {
          showToast(`✓ Đã lưu ${items.length} vị trí vào ~/.agent-pilot/inbox/feedback/${resp.sessionId}/`);
        } else {
          showToast(`✓ Đã lưu ${items.length} vị trí vào bộ nhớ Extension!`);
        }
        return resp;
      } else {
        showToast(`❌ Lỗi lưu inbox: ${resp?.error || "Không thể lưu"}`);
        return resp || { success: false };
      }
    } catch (err) {
      showToast(`❌ Lỗi: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // =========================================================================
  // Channel A: Push feedback live to waiting agent
  // =========================================================================

  async function pushFeedbackToAgent() {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    const items = state?.getItems() || [];
    if (items.length === 0) {
      showToast("⚠️ Chưa có vị trí nào được đánh dấu để gửi. Hãy chọn phần tử hoặc kéo vùng trước!");
      return { success: false, error: "No feedback items" };
    }

    showToast("🚀 Đang gửi chú thích & chẩn đoán trực tiếp cho Agent...");
    const diagnostics = await collectDiagnosticsSafe();
    const promptMd = generateMarkdownPrompt(items, { diagnostics, includeBase64Images: false });
    const payload = {
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title,
      items,
      diagnostics,
      prompt: promptMd
    };

    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: "push_feedback_live",
          payload
        }, (res) => resolve(res || { success: false }));
      });

      if (resp && resp.success) {
        showToast(`✓ Đã truyền trực tiếp ${items.length} vị trí cần sửa cho AI Agent!`);
        return resp;
      } else {
        showToast(`⚠️ Không có Agent nào đang chờ (chạy browser_wait_for_feedback). Đã tự động lưu vào inbox!`);
        return resp || { success: false };
      }
    } catch (err) {
      showToast(`❌ Lỗi gửi: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  window.__AP_INTERNAL__.feedbackStudio.channels = {
    generateMarkdownPrompt,
    copyFeedbackPrompt,
    saveFeedbackToInbox,
    pushFeedbackToAgent
  };
})();
