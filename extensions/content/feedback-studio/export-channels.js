/**
 * Agent Pilot - Feedback Studio Export Channels
 * Channel A (Live Agent Push), Channel B (Agent Inbox Persistence), Channel C (Markdown Prompt Clipboard).
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};
  window.__AP_INTERNAL__.feedbackStudio = window.__AP_INTERNAL__.feedbackStudio || {};

  const constants = window.__AP_INTERNAL__.feedbackStudio.constants || {};
  const showToast = constants.showToast || (() => {});

  // =========================================================================
  // Channel C: 1-Click Clipboard Markdown Prompt Generator
  // =========================================================================

  function generateMarkdownPrompt(customItems) {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    const items = (customItems && customItems.length) ? customItems : (state?.getItems() || []);
    if (!items || !items.length) return null;

    let md = `### 🎯 YÊU CẦU CHỈNH SỬA GIAO DIỆN (Agent Pilot Visual Feedback)\n\n`;
    md += `- **URL**: \`${window.location.href}\`\n`;
    md += `- **Tiêu đề trang**: "${document.title}"\n`;
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
        md += `- **CSS Selector**: \`${item.dom.selector || item.dom.tagName}\`\n`;
        if (item.dom.xpath) md += `- **XPath**: \`${item.dom.xpath}\`\n`;
        if (item.dom.text) md += `- **Nội dung text**: "${item.dom.text.replace(/\n+/g, " ").slice(0, 150)}"\n`;
        if (item.dom.styles) {
          md += `- **Thông số CSS hiện tại**: \`color: ${item.dom.styles.color}; background: ${item.dom.styles.backgroundColor}; font-size: ${item.dom.styles.fontSize};\`\n`;
        }
      }

      if (item.clip) {
        md += `- **Tọa độ / Kích thước**: ${item.clip.width}×${item.clip.height}px (x: ${item.clip.x}, y: ${item.clip.y})\n`;
      }

      if (item.annotations && item.annotations.length) {
        md += `- **Các điểm đánh dấu (Pins)**:\n`;
        item.annotations.forEach((ann, pinIdx) => {
          md += `  - Điểm ${pinIdx + 1} (x:${ann.x}, y:${ann.y}): ${ann.comment || "Cần sửa vị trí này"}\n`;
        });
      }

      md += `- **Yêu cầu chỉnh sửa của người dùng (User Note)**:\n`;
      md += `  > ${item.comment ? item.comment.replace(/\n/g, "\n  > ") : "*(Không có ghi chú cụ thể)*"}\n\n`;

      if (item.screenshotDataUrl) {
        md += `- **Ảnh chụp thực tế**: \n  ![Mục ${num}](${item.screenshotDataUrl})\n\n`;
      }

      md += `---\n\n`;
    });

    md += `\n**Chỉ dẫn cho AI Agent**:\n`;
    md += `1. Xem xét chính xác tệp nguồn và component được liệt kê ở trên.\n`;
    md += `2. Cập nhật mã nguồn và kiểu dáng CSS/Tailwind theo đúng yêu cầu ghi chú của người dùng.\n`;
    md += `3. Giữ nguyên các chức năng và cấu trúc không được yêu cầu thay đổi.\n`;

    return md;
  }

  async function copyFeedbackPrompt() {
    const state = window.__AP_INTERNAL__.feedbackStudio.state;
    const items = state?.getItems() || [];
    if (!items.length) {
      showToast("⚠️ Chưa có vị trí nào được đánh dấu để copy. Hãy chọn phần tử hoặc kéo vùng trước!");
      return;
    }

    const md = generateMarkdownPrompt();
    try {
      await navigator.clipboard.writeText(md);
      showToast(`📋 Đã copy ${items.length} vị trí chú thích! Hãy dán (Ctrl+V) vào khung chat Agent.`);
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

    showToast("💾 Đang lưu chú thích vào inbox...");
    const promptMd = generateMarkdownPrompt(items);
    const payload = {
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title,
      items,
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

    showToast("🚀 Đang gửi chú thích trực tiếp cho Agent...");
    const promptMd = generateMarkdownPrompt(items);
    const payload = {
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title,
      items,
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
