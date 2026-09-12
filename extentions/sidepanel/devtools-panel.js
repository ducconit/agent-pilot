/**
 * Agent Pilot - Side Panel DevTools (CDP Monitor) Module
 * Handles Console stream, Network request inspector, and Performance metrics
 */

import { showToast, escapeHtml } from "./ui-helpers.js";

export class DevToolsPanel {
  constructor(options = {}) {
    this.getActiveTabId = options.getActiveTabId || (() => null);
    this.getIsCdpAttached = options.getIsCdpAttached || (() => false);

    // Console Elements
    this.consoleStream = document.getElementById("console-stream");
    this.consoleCount = document.getElementById("console-count");
    this.consoleLevelFilter = document.getElementById("console-level-filter");
    this.consoleSearchFilter = document.getElementById("console-search-filter");
    this.btnClearConsole = document.getElementById("btn-clear-console");

    // Network Elements
    this.networkStream = document.getElementById("network-stream");
    this.networkCount = document.getElementById("network-count");
    this.networkSearchFilter = document.getElementById("network-search-filter");
    this.btnClearNetwork = document.getElementById("btn-clear-network");

    // Performance Elements
    this.btnRefreshPerf = document.getElementById("btn-refresh-perf");
    this.metricHeap = document.getElementById("metric-heap");
    this.metricHeapTotal = document.getElementById("metric-heap-total");
    this.metricNodes = document.getElementById("metric-nodes");
    this.metricLayouts = document.getElementById("metric-layouts");
    this.metricStyles = document.getElementById("metric-styles");

    this.consoleEntries = [];
    this.networkEntries = [];
    this.evictedNetworkIds = new Set();

    this.bindEvents();
  }

  bindEvents() {
    if (this.consoleLevelFilter) this.consoleLevelFilter.onchange = () => this.renderConsole();
    if (this.consoleSearchFilter) this.consoleSearchFilter.oninput = () => this.renderConsole();
    if (this.networkSearchFilter) this.networkSearchFilter.oninput = () => this.renderNetwork();

    if (this.btnClearConsole) {
      this.btnClearConsole.onclick = () => {
        this.consoleEntries = [];
        const activeTabId = this.getActiveTabId();
        if (activeTabId) chrome.runtime.sendMessage({ action: "clear_console", tabId: activeTabId });
        this.renderConsole();
      };
    }

    if (this.btnClearNetwork) {
      this.btnClearNetwork.onclick = () => {
        this.networkEntries = [];
        this.evictedNetworkIds.clear();
        const activeTabId = this.getActiveTabId();
        if (activeTabId) chrome.runtime.sendMessage({ action: "clear_network", tabId: activeTabId });
        this.renderNetwork();
      };
    }

    if (this.btnRefreshPerf) {
      this.btnRefreshPerf.onclick = () => this.refreshPerformance();
    }
  }

  addConsoleEntry(entry) {
    this.consoleEntries.push(entry);
    if (this.consoleEntries.length > 300) this.consoleEntries.shift();
    this.renderConsole();
  }

  addOrUpdateNetworkEntry(request) {
    const reqId = request.id;
    const existingIdx = this.networkEntries.findIndex((r) => r.id === reqId);
    if (existingIdx !== -1) {
      this.networkEntries[existingIdx] = request;
    } else if (!this.evictedNetworkIds.has(reqId)) {
      this.networkEntries.push(request);
      if (this.networkEntries.length > 150) {
        const evicted = this.networkEntries.shift();
        if (evicted) {
          this.evictedNetworkIds.add(evicted.id);
          if (this.evictedNetworkIds.size > 500) {
            const oldest = this.evictedNetworkIds.values().next().value;
            this.evictedNetworkIds.delete(oldest);
          }
        }
      }
    }
    this.renderNetwork();
  }

  renderConsole() {
    if (!this.consoleStream) return;
    const level = this.consoleLevelFilter ? this.consoleLevelFilter.value : "all";
    const search = this.consoleSearchFilter ? this.consoleSearchFilter.value.toLowerCase() : "";

    const filtered = this.consoleEntries.filter((item) => {
      if (level !== "all" && item.type !== level) return false;
      if (search && !item.text.toLowerCase().includes(search)) return false;
      return true;
    });

    if (this.consoleCount) this.consoleCount.textContent = this.consoleEntries.length;
    if (filtered.length === 0) {
      this.consoleStream.innerHTML = `<div class="empty-hint">Không có console log nào khớp bộ lọc.</div>`;
      return;
    }

    this.consoleStream.innerHTML = "";
    filtered.forEach((item) => {
      const row = document.createElement("div");
      row.className = `log-entry ${item.type}`;
      const timeStr = new Date(item.timestamp).toLocaleTimeString();
      row.innerHTML = `<span class="log-time">[${timeStr}]</span> <span>${escapeHtml(item.text)}</span>`;
      this.consoleStream.appendChild(row);
    });
    this.consoleStream.scrollTop = this.consoleStream.scrollHeight;
  }

  renderNetwork() {
    if (!this.networkStream) return;
    const search = this.networkSearchFilter ? this.networkSearchFilter.value.toLowerCase() : "";
    const filtered = this.networkEntries.filter((req) => {
      if (search && !req.url.toLowerCase().includes(search)) return false;
      return true;
    });

    if (this.networkCount) this.networkCount.textContent = this.networkEntries.length;
    if (filtered.length === 0) {
      this.networkStream.innerHTML = `<div class="empty-hint">Không có network request nào khớp bộ lọc.</div>`;
      return;
    }

    this.networkStream.innerHTML = "";
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
      this.networkStream.appendChild(row);
    });
    this.networkStream.scrollTop = this.networkStream.scrollHeight;
  }

  refreshPerformance() {
    const activeTabId = this.getActiveTabId();
    const isCdpAttached = this.getIsCdpAttached();

    if (!activeTabId || !isCdpAttached) {
      showToast("Cần gắn kết nối CDP trước để đo chỉ số hiệu năng!");
      return;
    }

    chrome.runtime.sendMessage({ action: "get_performance_metrics", tabId: activeTabId }, (res) => {
      if (res && res.success && res.metrics) {
        const m = res.metrics;
        const usedMb = (m.JSHeapUsedSize / (1024 * 1024)).toFixed(2);
        const totalMb = (m.JSHeapTotalSize / (1024 * 1024)).toFixed(2);
        if (this.metricHeap) this.metricHeap.textContent = `${usedMb} MB`;
        if (this.metricHeapTotal) this.metricHeapTotal.textContent = `Tổng cấp phát: ${totalMb} MB`;
        if (this.metricNodes) this.metricNodes.textContent = (m.Nodes || 0).toLocaleString();
        if (this.metricLayouts) this.metricLayouts.textContent = (m.LayoutCount || 0).toLocaleString();
        if (this.metricStyles) this.metricStyles.textContent = (m.RecalcStyleCount || 0).toLocaleString();
      } else {
        showToast("Không thể tải metrics: " + (res ? res.error : ""));
      }
    });
  }
}
