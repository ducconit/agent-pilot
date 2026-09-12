/**
 * Agent Pilot - Side Panel Logic Controller
 * Universal AI Agent Browser Controller - Antigravity First
 */

(function () {
  let activeTabId = null;
  let isCdpAttached = false;
  let isInspectorActive = false;
  let selectedElementDetails = null;
  let latestScreenshotDataUrl = null;
  let colorHistory = [];

  // DOM Elements
  const cdpStatusDot = document.getElementById("cdp-status-dot");
  const btnToggleCdp = document.getElementById("btn-toggle-cdp");
  const activeTabTitle = document.getElementById("active-tab-title");
  const inputUrl = document.getElementById("input-url");
  const btnNavigate = document.getElementById("btn-navigate");
  const btnReload = document.getElementById("btn-reload");
  const btnNewTab = document.getElementById("btn-new-tab");

  // AI Agent Bridge Elements
  const agentBridgeDot = document.getElementById("agent-bridge-dot");
  const agentBridgeText = document.getElementById("agent-bridge-text");
  const inputBridgePort = document.getElementById("input-bridge-port");
  const btnReconnectBridge = document.getElementById("btn-reconnect-bridge");

  // Tabs Nav
  const tabBtns = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".panel");

  // Subtabs Nav
  const subtabBtns = document.querySelectorAll(".subtab-btn");
  const subpanels = document.querySelectorAll(".subpanel");

  // AI Agent Monitor Elements
  const agentStatusBadge = document.getElementById("agent-status-badge");
  const agentInfoPort = document.getElementById("agent-info-port");
  const agentInfoTarget = document.getElementById("agent-info-target");
  const btnPingAgent = document.getElementById("btn-ping-agent");
  const btnSelfTestAgent = document.getElementById("btn-self-test-agent");
  const agentTestLog = document.getElementById("agent-test-log");
  const agentActivityLog = document.getElementById("agent-activity-log");
  const agentActivityCount = document.getElementById("agent-activity-count");
  const btnClearAgentLog = document.getElementById("btn-clear-agent-log");
  const agentEmptyHint = document.getElementById("agent-empty-hint");

  // DevTools Controls
  const consoleStream = document.getElementById("console-stream");
  const consoleCount = document.getElementById("console-count");
  const consoleLevelFilter = document.getElementById("console-level-filter");
  const consoleSearchFilter = document.getElementById("console-search-filter");
  const btnClearConsole = document.getElementById("btn-clear-console");

  const networkStream = document.getElementById("network-stream");
  const networkCount = document.getElementById("network-count");
  const networkSearchFilter = document.getElementById("network-search-filter");
  const btnClearNetwork = document.getElementById("btn-clear-network");

  const btnRefreshPerf = document.getElementById("btn-refresh-perf");
  const metricHeap = document.getElementById("metric-heap");
  const metricHeapTotal = document.getElementById("metric-heap-total");
  const metricNodes = document.getElementById("metric-nodes");
  const metricLayouts = document.getElementById("metric-layouts");
  const metricStyles = document.getElementById("metric-styles");

  // Inspector & Color
  const btnToggleInspector = document.getElementById("btn-toggle-inspector");
  const inspectorResultBox = document.getElementById("inspector-result-box");
  const elementActions = document.getElementById("element-actions");
  const btnMoveToElement = document.getElementById("btn-move-to-element");
  const btnClickElement = document.getElementById("btn-click-element");
  const btnSnapElement = document.getElementById("btn-snap-element");

  const btnPickColor = document.getElementById("btn-pick-color");
  const colorSwatchCurrent = document.getElementById("color-swatch-current");
  const colorHex = document.getElementById("color-hex");
  const colorRgb = document.getElementById("color-rgb");
  const colorHsl = document.getElementById("color-hsl");
  const paletteChips = document.getElementById("palette-chips");

  // Screenshots
  const btnCaptureVisible = document.getElementById("btn-capture-visible");
  const btnCaptureRegion = document.getElementById("btn-capture-region");
  const btnCaptureElement = document.getElementById("btn-capture-element");
  const screenshotPreviewCard = document.getElementById("screenshot-preview-card");
  const screenshotImg = document.getElementById("screenshot-img");
  const shotDimensions = document.getElementById("shot-dimensions");
  const btnDownloadShot = document.getElementById("btn-download-shot");
  const btnCopyShot = document.getElementById("btn-copy-shot");

  const sidepanelToast = document.getElementById("sidepanel-toast");

  // =========================================================================
  // 1. Tab & View Navigation
  // =========================================================================

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      document.getElementById(targetId).classList.add("active");
    });
  });

  subtabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      subtabBtns.forEach((b) => b.classList.remove("active"));
      subpanels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.getAttribute("data-subtab");
      document.getElementById(targetId).classList.add("active");
      if (targetId === "devtools-perf" && isCdpAttached) {
        refreshPerformance();
      }
    });
  });

  async function updateActiveTab() {
    chrome.runtime.sendMessage({ action: "get_active_tab" }, (res) => {
      if (res && res.tab) {
        activeTabId = res.tab.id;
        activeTabTitle.textContent = res.tab.title || "Tab không tên";
        inputUrl.value = res.tab.url || "";
        if (agentInfoTarget) {
          agentInfoTarget.textContent = `Tab ${res.tab.id}: ${res.tab.title || res.tab.url || "Untitled"}`;
        }
        checkCdpStatus();
      }
    });
  }

  // Sync when user changes tabs in Chrome
  chrome.tabs.onActivated.addListener(updateActiveTab);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === activeTabId && changeInfo.title) {
      activeTabTitle.textContent = changeInfo.title;
    }
  });

  btnNavigate.onclick = () => {
    if (!activeTabId || !inputUrl.value) return;
    chrome.runtime.sendMessage({ action: "navigate", tabId: activeTabId, url: inputUrl.value }, () => {
      showToast("Đang điều hướng...");
    });
  };

  inputUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnNavigate.click();
  });

  btnReload.onclick = () => {
    if (!activeTabId) return;
    chrome.runtime.sendMessage({ action: "reload_tab", tabId: activeTabId }, () => {
      showToast("Đang tải lại trang...");
    });
  };

  btnNewTab.onclick = () => {
    chrome.runtime.sendMessage({ action: "new_tab", url: "https://google.com" });
  };

  // =========================================================================
  // 2. CDP Debugger State Management
  // =========================================================================

  function checkCdpStatus() {
    if (!activeTabId) return;
    chrome.runtime.sendMessage({ action: "get_debugger_status", tabId: activeTabId }, (res) => {
      setCdpState(res && res.attached);
    });
  }

  function setCdpState(attached) {
    isCdpAttached = !!attached;
    if (isCdpAttached) {
      cdpStatusDot.classList.add("connected");
      btnToggleCdp.textContent = "Ngắt CDP";
      btnToggleCdp.classList.add("btn-danger");
      btnToggleCdp.classList.remove("btn-outline");
    } else {
      cdpStatusDot.classList.remove("connected");
      btnToggleCdp.textContent = "Gắn CDP";
      btnToggleCdp.classList.remove("btn-danger");
      btnToggleCdp.classList.add("btn-outline");
    }
  }

  btnToggleCdp.onclick = () => {
    if (!activeTabId) return;
    if (isCdpAttached) {
      chrome.runtime.sendMessage({ action: "detach_debugger", tabId: activeTabId }, () => {
        setCdpState(false);
        showToast("Đã ngắt kết nối CDP.");
      });
    } else {
      chrome.runtime.sendMessage({ action: "attach_debugger", tabId: activeTabId }, (res) => {
        if (res && res.success) {
          setCdpState(true);
          showToast("Đã gắn kết nối CDP (Console, Network, Performance sẵn sàng)!");
          refreshPerformance();
        } else {
          showToast("Lỗi gắn CDP: " + (res.error || "Không xác định"));
        }
      });
    }
  };

  // =========================================================================
  // 3. AI Agent Monitor & Live Activity Stream
  // =========================================================================

  let agentActivityTotal = 0;

  function addAgentActivityLog(item) {
    if (!agentActivityLog) return;
    if (agentEmptyHint) agentEmptyHint.style.display = "none";
    agentActivityTotal++;
    if (agentActivityCount) agentActivityCount.textContent = agentActivityTotal;

    const row = document.createElement("div");
    row.className = "agent-activity-item";

    const timeStr = new Date(item.timestamp || Date.now()).toLocaleTimeString("vi-VN", { hour12: false });
    const isError = item.status === "error";

    const header = document.createElement("div");
    header.className = "agent-activity-header";

    const timeSpan = document.createElement("span");
    timeSpan.className = "agent-activity-time";
    timeSpan.textContent = timeStr;

    const methodSpan = document.createElement("span");
    methodSpan.className = "agent-activity-method";
    methodSpan.textContent = item.method || "unknown";

    const statusBadge = document.createElement("span");
    statusBadge.className = `agent-activity-status ${isError ? 'error' : 'success'}`;
    statusBadge.textContent = isError ? "✕ Lỗi" : "✓ Xong";

    header.appendChild(timeSpan);
    header.appendChild(methodSpan);
    header.appendChild(statusBadge);
    row.appendChild(header);

    const detail = document.createElement("div");
    detail.className = "agent-activity-detail";
    detail.textContent = formatParams(item.params);
    row.appendChild(detail);

    if (isError && item.error) {
      const errDetail = document.createElement("div");
      errDetail.style.color = "var(--accent-red)";
      errDetail.style.fontSize = "10px";
      errDetail.style.marginTop = "2px";
      errDetail.textContent = `Chi tiết lỗi: ${item.error}`;
      row.appendChild(errDetail);
    }

    agentActivityLog.prepend(row);
  }

  function formatParams(params) {
    if (!params) return "";
    if (typeof params !== "object") return String(params);
    const keys = Object.keys(params);
    if (keys.length === 0) return "";
    return keys.map((k) => `${k}: ${JSON.stringify(params[k])}`).join(", ");
  }

  if (btnClearAgentLog) {
    btnClearAgentLog.onclick = () => {
      if (agentActivityLog) {
        agentActivityLog.innerHTML = `<div class="empty-hint" id="agent-empty-hint">Chưa có lệnh nào. Khi AI Agent gửi lệnh qua cổng 58765, hoạt động sẽ hiển thị tại đây.</div>`;
      }
      agentActivityTotal = 0;
      if (agentActivityCount) agentActivityCount.textContent = "0";
      showToast("Đã xóa nhật ký lệnh Agent");
    };
  }

  if (btnPingAgent) {
    btnPingAgent.onclick = () => {
      chrome.runtime.sendMessage({ action: "get_agent_bridge_status" }, (status) => {
        if (status && status.connected) {
          showToast(`✓ Đã kết nối ổn định tới AI Agent (Cổng ${status.port})`);
        } else {
          showToast(`⚪ Chưa có AI Agent kết nối tại cổng ${status?.port || 58765}`);
        }
      });
    };
  }

  if (btnSelfTestAgent) {
    btnSelfTestAgent.onclick = async () => {
      if (!agentTestLog) return;
      agentTestLog.style.display = "block";
      agentTestLog.innerHTML = `<div style="color:var(--accent-cyan);font-weight:600;margin-bottom:4px;">🚀 Bắt đầu tự kiểm tra khả năng hoạt động của AI Agent...</div>`;

      const steps = [
        {
          name: "1. Kiểm tra quyền truy cập tab đang mở",
          run: async () => {
            if (!activeTabId) throw new Error("Chưa xác định được tab. Vui lòng mở một trang web bình thường.");
            const tab = await chrome.tabs.get(activeTabId).catch(() => null);
            if (!tab) throw new Error("Không thể truy vấn thông tin tab.");
            if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:"))) {
              throw new Error("Không thể thao tác trên trang hệ thống nội bộ của trình duyệt. Hãy mở trang web bình thường.");
            }
            return `Tab ID: ${tab.id} - ${tab.title || tab.url}`;
          }
        },
        {
          name: "2. Kiểm tra nạp Content Script & API Chuột/Phím",
          run: async () => {
            const res = await new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: "ensure_content_script", tabId: activeTabId }, resolve);
            });
            if (!res || !res.success) {
              throw new Error(res?.error || "Không thể nạp Content Script vào trang web.");
            }
            return "Content Script & Bridge API sẵn sàng";
          }
        },
        {
          name: "3. Kiểm tra kết nối Máy chủ Bridge (Port 58765)",
          run: async () => {
            const status = await new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: "get_agent_bridge_status" }, resolve);
            });
            if (!status || !status.connected) {
              throw new Error(`Máy chủ chưa kết nối. Hãy đảm bảo đã khởi chạy agent-pilot server trên cổng ${status?.port || 58765}.`);
            }
            return `Kết nối WebSocket mở tại ws://127.0.0.1:${status.port}`;
          }
        }
      ];

      let hasError = false;
      let failedReason = "";

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const logLine = document.createElement("div");
        logLine.style.fontSize = "11px";
        logLine.style.padding = "2px 0";
        logLine.textContent = `${step.name}...`;
        agentTestLog.appendChild(logLine);

        try {
          const detail = await step.run();
          logLine.textContent += ` ✓ Thành công (${detail})`;
          logLine.style.color = "var(--accent-green)";
        } catch (err) {
          hasError = true;
          failedReason = err.message;
          logLine.textContent += ` ✕ Lỗi: ${err.message}`;
          logLine.style.color = "var(--accent-red)";
          break; // Stop immediately upon error
        }
      }

      const summaryLine = document.createElement("div");
      summaryLine.style.marginTop = "6px";
      summaryLine.style.fontWeight = "bold";

      if (hasError) {
        summaryLine.style.color = "var(--accent-red)";
        summaryLine.textContent = `❌ Kiểm tra thất bại: ${failedReason}`;
      } else {
        summaryLine.style.color = "var(--accent-green)";
        summaryLine.textContent = "🎉 Toàn bộ hệ thống sẵn sàng 100% cho AI Agent thao tác!";
      }

      agentTestLog.appendChild(summaryLine);
      agentTestLog.scrollTop = agentTestLog.scrollHeight;
    };
  }

  // =========================================================================
  // 5. DevTools (Console, Network, Performance)
  // =========================================================================

  let consoleEntries = [];
  let networkEntries = [];
  const evictedNetworkIds = new Set();

  function renderConsole() {
    const level = consoleLevelFilter.value;
    const search = consoleSearchFilter.value.toLowerCase();

    const filtered = consoleEntries.filter((item) => {
      if (level !== "all" && item.type !== level) return false;
      if (search && !item.text.toLowerCase().includes(search)) return false;
      return true;
    });

    consoleCount.textContent = consoleEntries.length;
    if (filtered.length === 0) {
      consoleStream.innerHTML = `<div class="empty-hint">Không có console log nào khớp bộ lọc.</div>`;
      return;
    }

    consoleStream.innerHTML = "";
    filtered.forEach((item) => {
      const row = document.createElement("div");
      row.className = `log-entry ${item.type}`;
      const timeStr = new Date(item.timestamp).toLocaleTimeString();
      row.innerHTML = `<span class="log-time">[${timeStr}]</span> <span>${escapeHtml(item.text)}</span>`;
      consoleStream.appendChild(row);
    });
    consoleStream.scrollTop = consoleStream.scrollHeight;
  }

  function renderNetwork() {
    const search = networkSearchFilter.value.toLowerCase();
    const filtered = networkEntries.filter((req) => {
      if (search && !req.url.toLowerCase().includes(search)) return false;
      return true;
    });

    networkCount.textContent = networkEntries.length;
    if (filtered.length === 0) {
      networkStream.innerHTML = `<div class="empty-hint">Không có network request nào khớp bộ lọc.</div>`;
      return;
    }

    networkStream.innerHTML = "";
    filtered.forEach((req) => {
      const row = document.createElement("div");
      row.className = "net-entry";
      const methodClass = (req.method || "").toLowerCase();
      const statusClass = req.status === "failed" ? "err" : (req.status >= 400 ? "err" : "ok");
      row.innerHTML = `
        <span class="net-badge ${methodClass}">${req.method || "GET"}</span>
        <span class="net-status ${statusClass}">${req.status || "..."}</span>
        <span class="net-url" title="${escapeHtml(req.url)}">${escapeHtml(req.url)}</span>
      `;
      networkStream.appendChild(row);
    });
    networkStream.scrollTop = networkStream.scrollHeight;
  }

  consoleLevelFilter.onchange = renderConsole;
  consoleSearchFilter.oninput = renderConsole;
  networkSearchFilter.oninput = renderNetwork;

  btnClearConsole.onclick = () => {
    consoleEntries = [];
    if (activeTabId) chrome.runtime.sendMessage({ action: "clear_console", tabId: activeTabId });
    renderConsole();
  };

  btnClearNetwork.onclick = () => {
    networkEntries = [];
    evictedNetworkIds.clear();
    if (activeTabId) chrome.runtime.sendMessage({ action: "clear_network", tabId: activeTabId });
    renderNetwork();
  };

  function refreshPerformance() {
    if (!activeTabId || !isCdpAttached) {
      showToast("Cần gắn kết nối CDP trước để đo chỉ số hiệu năng!");
      return;
    }
    chrome.runtime.sendMessage({ action: "get_performance_metrics", tabId: activeTabId }, (res) => {
      if (res && res.success && res.metrics) {
        const m = res.metrics;
        const usedMb = (m.JSHeapUsedSize / (1024 * 1024)).toFixed(2);
        const totalMb = (m.JSHeapTotalSize / (1024 * 1024)).toFixed(2);
        metricHeap.textContent = `${usedMb} MB`;
        metricHeapTotal.textContent = `Tổng cấp phát: ${totalMb} MB`;
        metricNodes.textContent = (m.Nodes || 0).toLocaleString();
        metricLayouts.textContent = (m.LayoutCount || 0).toLocaleString();
        metricStyles.textContent = (m.RecalcStyleCount || 0).toLocaleString();
      } else {
        showToast("Không thể tải metrics: " + (res ? res.error : ""));
      }
    });
  }

  btnRefreshPerf.onclick = refreshPerformance;

  // =========================================================================
  // 6. Element Inspector & Eyedropper
  // =========================================================================

  btnToggleInspector.onclick = () => {
    if (!activeTabId) return;
    isInspectorActive = !isInspectorActive;
    chrome.tabs.sendMessage(activeTabId, { action: "toggle_inspector", enabled: isInspectorActive }, (res) => {
      if (isInspectorActive) {
        btnToggleInspector.textContent = "Tắt Soi Phần tử";
        btnToggleInspector.classList.replace("btn-primary", "btn-secondary");
        showToast("Đã BẬT soi phần tử. Hãy di chuột qua trang web.");
      } else {
        btnToggleInspector.textContent = "Bật Soi Phần tử";
        btnToggleInspector.classList.replace("btn-secondary", "btn-primary");
        showToast("Đã TẮT soi phần tử.");
      }
    });
  };

  function displayElementDetails(details) {
    selectedElementDetails = details;
    elementActions.style.display = "flex";
    elementActions.style.gap = "6px";
    elementActions.style.flexWrap = "wrap";

    inspectorResultBox.innerHTML = `
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

    document.getElementById("copy-selector").onclick = () => {
      navigator.clipboard.writeText(details.selector);
      showToast("Đã sao chép CSS Selector!");
    };
    document.getElementById("copy-xpath").onclick = () => {
      navigator.clipboard.writeText(details.xpath);
      showToast("Đã sao chép XPath!");
    };

    // Update coordinates in virtual mouse input
    mouseXInput.value = details.rect.x + Math.round(details.rect.width / 2);
    mouseYInput.value = details.rect.y + Math.round(details.rect.height / 2);
  }

  btnMoveToElement.onclick = () => {
    if (!selectedElementDetails || !activeTabId) return;
    const cx = selectedElementDetails.rect.x + Math.round(selectedElementDetails.rect.width / 2);
    const cy = selectedElementDetails.rect.y + Math.round(selectedElementDetails.rect.height / 2);
    chrome.tabs.sendMessage(activeTabId, { action: "virtual_mouse_move", x: cx, y: cy });
    showToast(`Chuột ảo đang bay tới phần tử (${cx}, ${cy})`);
  };

  btnClickElement.onclick = () => {
    if (!selectedElementDetails || !activeTabId) return;
    const cx = selectedElementDetails.rect.x + Math.round(selectedElementDetails.rect.width / 2);
    const cy = selectedElementDetails.rect.y + Math.round(selectedElementDetails.rect.height / 2);
    chrome.tabs.sendMessage(activeTabId, { action: "virtual_mouse_click", x: cx, y: cy });
    showToast(`Đã click phần tử tại (${cx}, ${cy})`);
  };

  btnSnapElement.onclick = () => {
    if (!selectedElementDetails) return;
    captureElementScreenshot(selectedElementDetails.rect);
  };

  // Color Eyedropper
  btnPickColor.onclick = () => {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(activeTabId, { action: "pick_color" });
  };

  function addColorToPalette(colorObj) {
    colorSwatchCurrent.style.background = colorObj.hex;
    colorHex.textContent = `HEX: ${colorObj.hex}`;
    colorRgb.textContent = `RGB: ${colorObj.rgb}`;
    colorHsl.textContent = `HSL: ${colorObj.hsl}`;

    if (!colorHistory.includes(colorObj.hex)) {
      colorHistory.unshift(colorObj.hex);
      if (colorHistory.length > 14) colorHistory.pop();
      renderPalette();
      chrome.storage.local.set({ agent_pilot_colors: colorHistory });
    }
  }

  function renderPalette() {
    paletteChips.innerHTML = "";
    colorHistory.forEach((hex) => {
      const chip = document.createElement("div");
      chip.className = "color-chip";
      chip.style.backgroundColor = hex;
      chip.title = `${hex} (Click để copy)`;
      chip.onclick = () => {
        navigator.clipboard.writeText(hex);
        showToast(`Đã copy ${hex} vào clipboard!`);
      };
      paletteChips.appendChild(chip);
    });
  }

  // Load color history from storage
  chrome.storage.local.get(["agent_pilot_colors"], (res) => {
    if (res.agent_pilot_colors && Array.isArray(res.agent_pilot_colors)) {
      colorHistory = res.agent_pilot_colors;
      renderPalette();
    }
  });

  // =========================================================================
  // 7. Screenshot Suite
  // =========================================================================

  btnCaptureVisible.onclick = captureVisibleScreenshot;

  function captureVisibleScreenshot() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "capture_screenshot", mode: "visible" }, (res) => {
        if (res && res.success && res.dataUrl) {
          displayScreenshot(res.dataUrl);
          showToast("Đã chụp toàn bộ khung nhìn!");
          resolve(res.dataUrl);
        } else {
          showToast("Lỗi chụp ảnh: " + (res ? res.error : ""));
          resolve(null);
        }
      });
    });
  }

  btnCaptureRegion.onclick = () => {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(activeTabId, { action: "start_region_crop" }, () => {
      showToast("Kéo chuột trên trang để chọn vùng cần chụp.");
    });
  };

  btnCaptureElement.onclick = () => {
    if (!selectedElementDetails) {
      showToast("Vui lòng soi và chọn một phần tử trước!");
      return;
    }
    captureElementScreenshot(selectedElementDetails.rect);
  };

  function captureElementScreenshot(rect) {
    if (!activeTabId || !rect) return;
    chrome.runtime.sendMessage({
      action: "capture_screenshot",
      mode: "element",
      tabId: activeTabId,
      clip: rect
    }, (res) => {
      if (res && res.success) {
        if (res.requiresCrop && res.dataUrl) {
          cropImageViaCanvas(res.dataUrl, res.clip);
        } else if (res.dataUrl) {
          displayScreenshot(res.dataUrl);
          showToast("Đã chụp phần tử thành công!");
        }
      }
    });
  }

  function cropImageViaCanvas(fullDataUrl, clip) {
    const img = new Image();
    img.onload = () => {
      // Scale factor if devicePixelRatio > 1
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
      displayScreenshot(croppedDataUrl);
      showToast("Đã chụp và cắt vùng thành công!");
    };
    img.src = fullDataUrl;
  }

  function displayScreenshot(dataUrl) {
    latestScreenshotDataUrl = dataUrl;
    screenshotPreviewCard.style.display = "block";
    screenshotImg.src = dataUrl;

    const img = new Image();
    img.onload = () => {
      shotDimensions.textContent = `Kích thước: ${img.naturalWidth} × ${img.naturalHeight} px`;
    };
    img.src = dataUrl;

    // Switch to screenshot tab
    document.querySelector('[data-tab="tab-screenshot"]').click();
  }

  btnDownloadShot.onclick = () => {
    if (!latestScreenshotDataUrl) return;
    const a = document.createElement("a");
    a.href = latestScreenshotDataUrl;
    a.download = `agent-pilot-shot-${Date.now()}.png`;
    a.click();
    showToast("Đã tải ảnh về máy tính!");
  };

  btnCopyShot.onclick = async () => {
    if (!latestScreenshotDataUrl) return;
    try {
      const blob = await (await fetch(latestScreenshotDataUrl)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      showToast("Đã sao chép ảnh vào clipboard!");
    } catch (e) {
      showToast("Không thể sao chép ảnh: " + e.message);
    }
  };

  // =========================================================================
  // 8. Global Messages from Content Script & Background
  // =========================================================================

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "DEBUGGER_STATUS_CHANGED") {
      if (msg.tabId === activeTabId) {
        setCdpState(msg.attached);
      }
    }

    if (msg.type === "DEVTOOLS_CONSOLE_EVENT") {
      if (msg.tabId === activeTabId && msg.entry) {
        consoleEntries.push(msg.entry);
        if (consoleEntries.length > 300) consoleEntries.shift();
        renderConsole();
      }
    }

    if (msg.type === "DEVTOOLS_NETWORK_EVENT") {
      if (msg.tabId === activeTabId && msg.request) {
        const reqId = msg.request.id;
        const existingIdx = networkEntries.findIndex((r) => r.id === reqId);
        if (existingIdx !== -1) {
          networkEntries[existingIdx] = msg.request;
        } else if (!evictedNetworkIds.has(reqId)) {
          networkEntries.push(msg.request);
          if (networkEntries.length > 150) {
            const evicted = networkEntries.shift();
            if (evicted) {
              evictedNetworkIds.add(evicted.id);
              if (evictedNetworkIds.size > 500) {
                const oldest = evictedNetworkIds.values().next().value;
                evictedNetworkIds.delete(oldest);
              }
            }
          }
        }
        renderNetwork();
      }
    }

    if (msg.type === "ELEMENT_SELECTED" && msg.details) {
      displayElementDetails(msg.details);
      document.querySelector('[data-tab="tab-inspector"]').click();
    }

    if (msg.type === "COLOR_PICKED" && msg.color) {
      addColorToPalette(msg.color);
      document.querySelector('[data-tab="tab-inspector"]').click();
    }

    if (msg.type === "REGION_CROP_REQUESTED" && msg.clip) {
      chrome.runtime.sendMessage({ action: "capture_screenshot", mode: "visible" }, (res) => {
        if (res && res.success && res.dataUrl) {
          cropImageViaCanvas(res.dataUrl, msg.clip);
        }
      });
    }

    if (msg.type === "AGENT_BRIDGE_STATUS_CHANGED" && msg.status) {
      updateBridgeUI(msg.status);
    }

    if (msg.type === "AGENT_ACTION_LOG" && msg.log) {
      addAgentActivityLog(msg.log);
    }
  });

  // AI Agent Bridge UI Handlers
  function updateBridgeUI(status) {
    if (!status) return;
    if (agentBridgeDot && agentBridgeText) {
      if (status.connected) {
        agentBridgeDot.className = "status-dot connected";
        agentBridgeText.textContent = "AI Agent: Đã kết nối";
        agentBridgeText.style.color = "var(--accent-green)";
      } else {
        agentBridgeDot.className = "status-dot disconnected";
        agentBridgeText.textContent = "AI Agent: Chờ kết nối";
        agentBridgeText.style.color = "var(--text-secondary)";
      }
    }
    if (agentStatusBadge) {
      agentStatusBadge.textContent = status.connected ? "Đã kết nối" : "Chờ kết nối";
      agentStatusBadge.style.color = status.connected ? "var(--accent-green)" : "var(--text-muted)";
    }
    if (agentInfoPort && status.port) {
      agentInfoPort.textContent = `ws://127.0.0.1:${status.port}`;
    }
    if (inputBridgePort && status.port) {
      inputBridgePort.value = status.port;
    }
  }

  if (btnReconnectBridge) {
    btnReconnectBridge.onclick = () => {
      chrome.runtime.sendMessage({ action: "reconnect_agent_bridge" }, (res) => {
        showToast("Đang kết nối lại AI Agent bridge...");
      });
    };
  }

  if (inputBridgePort) {
    inputBridgePort.onchange = () => {
      const port = Number(inputBridgePort.value);
      if (port > 1024 && port < 65536) {
        chrome.runtime.sendMessage({ action: "set_agent_bridge_port", port }, (res) => {
          showToast(`Đã đổi cổng AI Agent sang ${port}`);
        });
      } else {
        showToast("Cổng không hợp lệ (1024 - 65535)");
      }
    };
  }

  // Utility helpers
  function showToast(message) {
    sidepanelToast.textContent = message;
    sidepanelToast.classList.add("visible");
    setTimeout(() => {
      sidepanelToast.classList.remove("visible");
    }, 2800);
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initialize
  updateActiveTab();
  chrome.runtime.sendMessage({ action: "get_agent_bridge_status" }, (res) => {
    if (res) updateBridgeUI(res);
  });
})();
