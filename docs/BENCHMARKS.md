<script setup>
import { withBase } from 'vitepress'
</script>

# 📊 MCP vs Standalone CLI Performance Benchmarks

This document records the empirical comparison between the **MCP Server** (`stdio` JSON-RPC) and the **Standalone CLI** (`agent-pilot`) on identical Chrome environments and browser automation workflows.

---

## 🔬 Benchmark Methodology

Both interfaces were tested against bridge `http://127.0.0.1:58766` on the same test page (`example.com`) executing the identical 7-step sequence:

1. **`open`**: Open a controlled background tab and await navigation completion.
2. **`snapshot`**: Capture interactive DOM elements (max 20 elements).
3. **`scroll`**: Scroll the viewport by 300px.
4. **`evaluate`**: Execute JavaScript extracting `title`, `url`, `links`, and `textLength`.
5. **`performance metrics`**: Capture Core Web Vitals, heap size, and DOM health.
6. **`screenshot`**: Capture visible viewport screenshot via CDP.
7. **`close`**: Close the tab and release memory.

Videos and screenshots recorded during benchmark:
- <a :href="withBase('/artifacts/browser-comparison/mcp-example-com.mp4')" target="_blank" rel="noopener">🎬 Video workflow via MCP</a> · <a :href="withBase('/artifacts/browser-comparison/mcp-example-com.png')" target="_blank" rel="noopener">🖼️ Screenshot MCP</a>
- <a :href="withBase('/artifacts/browser-comparison/cli-example-com.mp4')" target="_blank" rel="noopener">🎬 Video workflow via CLI</a> · <a :href="withBase('/artifacts/browser-comparison/cli-example-com.png')" target="_blank" rel="noopener">🖼️ Screenshot CLI</a>

<div class="ap-feature-grid">
  <div class="ap-feature-card">
    <div class="ap-feature-badge">MCP WORKFLOW RECORDING</div>
    <video controls preload="metadata" :poster="withBase('/artifacts/browser-comparison/mcp-example-com.png')" style="width: 100%; border-radius: 6px; margin-top: 0.5rem;">
      <source :src="withBase('/artifacts/browser-comparison/mcp-example-com.mp4')" type="video/mp4" />
    </video>
  </div>
  <div class="ap-feature-card">
    <div class="ap-feature-badge">CLI WORKFLOW RECORDING</div>
    <video controls preload="metadata" :poster="withBase('/artifacts/browser-comparison/cli-example-com.png')" style="width: 100%; border-radius: 6px; margin-top: 0.5rem;">
      <source :src="withBase('/artifacts/browser-comparison/cli-example-com.mp4')" type="video/mp4" />
    </video>
  </div>
</div>

> **Note on "Token Proxy"**: Output-size proxy is calculated as `ceil(raw_bytes / 4)` representing the payload volume parsed by the agent model context (excluding hidden system prompt and reasoning tokens).

---

## 📈 Summary Results

| Channel | Successful Calls | Retries / Errors | Total Calls | Raw Output | Token Proxy | Execution Latency | Screen Recording Duration |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **MCP stdio** (`port 58766`) | 7 | 0 | 7 | 8,361 bytes | ≈ 2,091 tokens | 1.419 s | 68.1 s |
| **CLI** (`port 58766`) | 7 | 1 / 1 | 8 | 3,992 bytes | ≈ 998 tokens | 1.329 s | 61.1 s |

- **Context Savings**: CLI output consumes **~52.3% less payload volume** than MCP.
- **Speed**: CLI executed **~6.3% faster** in total request latency.

---

## 🔍 Step-by-Step Latency & Payload Breakdown

| Step | MCP Latency / Payload | CLI Latency / Payload | Notes |
| :--- | :---: | :---: | :--- |
| `open` | 1,148 ms / 1,186 B | 1,157 ms / 531 B | Both await page readyState |
| `snapshot` | 5 ms / 782 B | 10 ms / 417 B | MCP response includes `_meta` provenance |
| `scroll` | 154 ms / 667 B | 4 ms / 44 B | Synthetic DOM scroll |
| `scroll retry` | — | 7 ms / 67 B | CLI retry with valid flag |
| `evaluate` | 4 ms / 842 B | 8 ms / 231 B | Title, URL, links, text length |
| `performance metrics` | 5 ms / 3,404 B | 9 ms / 2,519 B | Core Web Vitals + DOM health |
| `screenshot` | 95 ms / 842 B | 123 ms / 133 B | CLI writes file, returns path |
| `close` | 8 ms / 638 B | 11 ms / 50 B | MCP response includes metadata |

---

## 💡 Recommendations for AI Agents

1. **Use Standalone CLI (`agent-pilot`) when context efficiency is critical**:
   - Ideal for shell-capable coding agents (Antigravity, Claude Code, Cursor Terminal).
   - Minimal output per action reduces model context window consumption.
   - Use `--format json` for clean parsing without text banners.

2. **Use MCP (`agent-pilot mcp`) when running in tool-calling IDEs**:
   - Best for desktop clients (Claude Desktop, Cursor MCP, Windsurf).
   - Rich schema validation, structured error codes, and provenance metadata (`bridgePort`, `instanceId`).

3. **Concurrency Rule**:
   - When running multiple concurrent agents, always pass explicit `--tab <id>` and `--port <58765>` to avoid cross-agent tab collision.
