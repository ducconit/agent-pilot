# 🤖 Hướng Dẫn Tích Hợp AI Agent (Skills + CLI & MCP)

**Agent Pilot** là bộ điều khiển trình duyệt đa năng, hoạt động mượt mà với **bất kỳ AI coding agent hoặc công cụ tự động hóa nào** có hỗ trợ một trong hai cơ chế:
1. **Agent Skills + Command Line (CLI)** (`skills.sh` + thực thi lệnh terminal)
2. **Model Context Protocol (MCP)** (cấu hình JSON `mcpServers`)

Các công cụ tương thích hoàn toàn bao gồm: **Claude Code**, **Cursor**, **Windsurf**, **Google Antigravity**, **Cline / Roo Code**, **OpenCode**, **Codex**, **Aider**, **Zed**, và bất kỳ LLM agent tùy chỉnh nào có khả năng chạy lệnh shell hoặc kết nối MCP.

---

## 1. Hai Chế Độ Tích Hợp Linh Hoạt

### Chế Độ A: Agent Skills + Command Line (CLI) — Khuyên dùng để tối ưu Token
Mọi AI Agent có khả năng đọc tài liệu hướng dẫn (`SKILL.md`) và chạy lệnh terminal đều có thể điều khiển trình duyệt thông qua binary độc lập `agent-pilot`:

```bash
# 1. Cài đặt Agent Skill toàn cục cho toàn bộ công cụ AI trên máy
npx skills add https://github.com/ducconit/agent-pilot -g --all

# Hoặc cài trực tiếp bằng trình cài đặt tích hợp sẵn trong CLI:
agent-pilot install-skill --all
```

Sau khi cài đặt, AI Agent tự động nắm vững bộ lệnh CLI gọn nhẹ (`agent-pilot open`, `agent-pilot snapshot`, `agent-pilot click`, `agent-pilot screenshot`) mà không làm tốn bộ nhớ ngữ cảnh (context window) bởi hàng chục schema phức tạp.

### Chế Độ B: Model Context Protocol (MCP) Server
Dành cho các IDE và ứng dụng hỗ trợ chuẩn MCP, Agent Pilot tích hợp sẵn MCP server giao tiếp qua `stdio` cung cấp trọn bộ 68 công cụ điều khiển trình duyệt và DevTools:

```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "agent-pilot",
      "args": ["mcp"]
    }
  }
}
```

| AI Agent / Công cụ | Chế độ hỗ trợ | File cấu hình / Lệnh cài đặt |
| :--- | :--- | :--- |
| **Claude Code** | Skills + CLI, MCP | `npx skills add ...` hoặc `claude mcp add agent-pilot -- agent-pilot mcp` |
| **Cursor** | Skills + CLI, MCP | `.cursor/mcp.json` hoặc `~/.cursor/mcp.json` |
| **Windsurf** | Skills + CLI, MCP | `~/.codeium/windsurf/mcp_config.json` |
| **Google Antigravity** | Skills + CLI, MCP | `~/.gemini/config/mcp_config.json` hoặc thư mục `skills/` |
| **Cline / Roo Code** | Skills + CLI, MCP | VS Code MCP Settings JSON |
| **OpenCode / Codex** | Skills + CLI, MCP | `npx skills add ...` hoặc cấu hình MCP dự án |

---

## 2. Mô Hình Kiến Trúc Kết Nối

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            HỆ THỐNG MÁY TÍNH HOST                           │
│                                                                             │
│  ┌───────────────────────────┐                ┌──────────────────────────┐  │
│  │     Mọi AI Coding Agent   │                │  Lập Trình Viên / User   │  │
│  │ (Claude/Cursor/Antigravity│                │  (Quan sát trực tiếp)    │  │
│  └─────────────┬─────────────┘                └────────────┬─────────────┘  │
│                │                                           │                │
│                │ 1. Phát lệnh điều khiển                   │ Quan sát chuột │
│                │    qua Skills+CLI hoặc MCP                │ ảo & logs      │
│                ▼                                           ▼                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                 CHROME BROWSER (AGENT PILOT EXTENSION)                │  │
│  │                                                                       │  │
│  │  ┌────────────────────────┐            ┌───────────────────────────┐  │  │
│  │  │  Side Panel Controller │◄──────────►│ Background Service Worker │  │  │
│  │  │  - JSON Action Runner  │            │ - Chrome DevTools (CDP)   │  │  │
│  │  │  - Live Monitor UI     │            │ - Tab & Screenshot Engine │  │  │
│  │  └───────────┬────────────┘            └─────────────┬─────────────┘  │  │
│  │              │                                       │                │  │
│  │              ▼                                       ▼                │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Web Tab (Localhost / App)                                       │  │  │
│  │  │ - Con trỏ chuột ảo di chuyển mượt mà (X, Y)                     │  │  │
│  │  │ - Sóng click ripple, tự động điền form                          │  │  │
│  │  │ - Trích xuất tọa độ DOM & Bounding box                          │  │  │
│  │  │ - window.__AGENT_PILOT__ Bridge API                             │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Giao Thức Hành Động JSON (Agent Control Protocol - ACP)

Antigravity có thể tạo ra các chuỗi lệnh JSON có cấu trúc để nạp vào Agent Pilot thực thi theo kịch bản:

### Cú pháp mẫu:
```json
{
  "actions": [
    {
      "action": "navigate",
      "url": "http://localhost:3000/dashboard"
    },
    {
      "action": "wait",
      "ms": 1000
    },
    {
      "action": "hover",
      "selector": "input[name='search']"
    },
    {
      "action": "click",
      "selector": "input[name='search']"
    },
    {
      "action": "type",
      "selector": "input[name='search']",
      "text": "Antigravity Browser Control"
    },
    {
      "action": "scroll",
      "deltaY": 400
    },
    {
      "action": "screenshot",
      "mode": "visible"
    }
  ],
  "stopOnError": true
}
```

### Danh mục hành động hỗ trợ:
| Action | Tham số | Mô tả |
| :--- | :--- | :--- |
| `navigate` | `url` (string) | Điều hướng tab hiện tại đến địa chỉ mong muốn |
| `wait` | `ms` (number) | Tạm dừng luồng thực thi trong khoảng thời gian mili-giây |
| `hover` | `selector` (string) hoặc `x`, `y` | Di chuyển con trỏ chuột ảo mượt mà / hover vào phần tử hoặc tọa độ |
| `click` | `selector?`, `x?`, `y?`, `via?` ("synthetic" \| "cdp" \| "auto") | Phát hiệu ứng sóng click và chuỗi sự kiện DOM; `via: "cdp"` phát trusted click (bắt buộc cho cross-origin iframe/canvas/WebGL) |
| `drag` | `from`/`to` (selector) hoặc `fromX/fromY/toX/toY`, `steps?`, `holdMs?`, `via?` | Kéo thả; dùng tọa độ + `via: "cdp"` cho game canvas (slingshot/aim) |
| `type` | `selector` (string), `text` (string) | Di chuyển đến ô nhập liệu, kích hoạt focus và tự động gõ ký tự từng bước |
| `scroll` | `deltaX`, `deltaY` (px) | Cuộn trang mượt mà theo trục X/Y |
| `screenshot` | `mode` ("visible" \| "element" \| "region" \| "full") | Kích hoạt bộ chụp màn hình |

---

## 3. Máy Chủ Cầu Nối WebSocket & MCP Server (Cổng 58765)

Agent Pilot trang bị sẵn một máy chủ cầu nối hai chiều chuẩn **Model Context Protocol (MCP)** và **WebSocket** tại cổng chuyên dụng **`58765`** (dải cổng riêng tư IANA `49152 – 65535`, chống trùng lặp hoàn toàn với các dịch vụ dev thông thường).

### 3.1. Khởi chạy Máy chủ Cầu nối (Bridge Server):
```bash
# Sử dụng binary Go (khuyên dùng, không phụ thuộc Node.js):
agent-pilot server

# Hoặc khởi chạy qua npm script:
npm run server

# Hoặc khởi chạy với cổng tùy chỉnh:
AGENT_PILOT_PORT=58765 agent-pilot server
```

### 3.2. Cấu hình Antigravity MCP Server:
MCP hiện cung cấp 68 tool; các tool DevTools mở rộng được mô tả trong [DevTools nâng cao](DEVTOOLS.md).
Thêm cấu hình sau vào tệp cấu hình MCP của Antigravity (`~/.gemini/config/mcp_config.json` hoặc cấu hình MCP dự án) để AI Agent tự động sở hữu toàn bộ 68 công cụ điều khiển trình duyệt. Binary phát hành nhúng sẵn runtime DevTools; máy sử dụng không cần cài Node/npm/FFmpeg hoặc dependency:
```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "agent-pilot",
      "args": ["mcp"]
    }
  }
}
```
*(Nếu cài đặt binary ở đường dẫn riêng, thay `"agent-pilot"` bằng đường dẫn tuyệt đối như `"/home/ubuntu/.agk/bin/agent-pilot"` hoặc `"/usr/local/bin/agent-pilot"`)*.

### 3.3. Bộ Công Cụ MCP Cung Cấp Cho AI Agent (68 Tools — trích lược):
1. `browser_open_tab(url, active)`: Mở tab trình duyệt mới (mặc định mở nền không cướp focus của người dùng, tự động phân nhóm Chrome Tab Group).
2. `browser_list_tabs()`: Liệt kê toàn bộ các tab trình duyệt kèm trạng thái tab do Agent quản lý.
3. `browser_navigate(url, tabId)`: Điều hướng tab đang hoạt động hoặc tab chỉ định.
4. `browser_click(x, y, selector, via)`: Di chuyển chuột ảo mượt mà và click vào tọa độ (X, Y) hoặc selector CSS. Thêm `via: "cdp"` để phát **trusted CDP input** — bắt buộc khi click bên trong cross-origin iframe hoặc canvas/WebGL; `via: "auto"` tự fallback synthetic.
5. `browser_drag(from, to, fromX, fromY, toX, toY, steps, holdMs, via)`: Kéo thả phần tử hoặc kéo giữa tọa độ; `via: "cdp"` + `holdMs` cho cơ chế kéo slingshot trong game.
   *(Tiền kiểm tra CDP: `browser_run_actions` với action `cdp` gọi `cdp.status`, hoặc CLI `agent-pilot cdp status --tab <id>`.)*
6. `browser_type(selector, text, clear, pressEnter)`: Tự động gõ phím human-like vào ô nhập liệu.
7. `browser_scroll(deltaX, deltaY)`: Cuộn trang web mượt mà theo trục X hoặc Y.
8. `browser_get_element(selector)`: Trích xuất Bounding Box, kích thước, CSS selector và XPath của phần tử DOM.
9. `browser_screenshot(mode, tabId)`: Chụp ảnh màn hình (hỗ trợ chụp cả tab ngầm trong background mà không cần focus màn hình).
10. `browser_get_devtools_data(tabId, type, limit, clear)`: Lấy toàn bộ Console logs, Network requests và Performance metrics (JS Heap, DOM Nodes) thời gian thực qua CDP.
11. `browser_pick_color(x, y)`: Trích xuất mã màu pixel tại vị trí chỉ định (trả về 5 định dạng: HEX, RGB, RGBA, HSL, OKLCH).
12. `browser_list_instances()`: Liệt kê các phiên bản trình duyệt Chrome đang kết nối đến hệ thống.
13. `browser_select_instance(instanceId)`: Lựa chọn điều khiển một trình duyệt cụ thể trong môi trường đa trình duyệt.
14. `browser_start_session(name, tabId)`: Bắt đầu phiên làm việc hoạt động của Agent trên tab mục tiêu, duy trì hiển thị liên tục con trỏ chuột ảo và viền neon trạng thái.
15. `browser_end_session(tabId, closeTab)`: Kết thúc phiên làm việc Agent, ẩn con trỏ chuột ảo và viền trạng thái (tùy chọn đóng tab khi kết thúc).
16. `browser_set_busy(busy, action)`: Hiển thị viền màn hình sáng tinh tế và thanh trạng thái nổi (floating pill) kèm nút mở khóa khi Agent thực thi thao tác phức tạp.
17. `browser_handle_dialog(accept, promptText, tabId)`: Xử lý các hộp thoại JavaScript (alert, confirm, prompt) thông qua CDP `Page.handleJavaScriptDialog`.
18. `browser_resize_page(width, height, deviceScaleFactor, mobile, tabId)`: Thay đổi kích thước khung nhìn (viewport) của trang theo kích thước và tỉ lệ chỉ định thông qua CDP `Emulation.setDeviceMetricsOverride`.
19. `browser_run_actions(actions, tabId, stopOnError)`: Bộ máy gom cụm thực thi hàng loạt hành động trong 1 lệnh duy nhất (Batch Execution Engine), giảm 80%+ độ trễ và số token tiêu thụ.
20. `browser_get_pending_feedback(limit, sessionId, clear)`: Truy vấn danh sách phiên phản hồi UI do người dùng tạo từ Feedback Studio lưu trong hộp thư máy chủ cục bộ.
21. `browser_wait_for_feedback(timeout, tabId)`: Chế độ chờ phản hồi trực tiếp (Channel A Reactive Long-Polling), phản hồi ngay khi người dùng nhấn 'Gửi Agent'.

> 📝 *Danh sách trên là trích lược — xem `mcp/agent-pilot/` để có đủ 68 tool và [DevTools nâng cao](DEVTOOLS.md) cho CSS, Lighthouse, trace insights, MP4, context riêng, service worker, heap analysis và page-defined developer tools.*

---

## 4. Cầu nối In-Page API (`window.__AGENT_PILOT__`)

Khi trang web được nạp, Content Script tự động phơi bày đối tượng toàn cục `window.__AGENT_PILOT__`. Các script tự động hóa hoặc test runner (Jest, Playwright, Cypress, Puppeteer) có thể tương tác trực tiếp:

```javascript
// Di chuyển chuột ảo đến tọa độ (500, 300) trong 350ms
await window.__AGENT_PILOT__.moveMouse(500, 300, 350);

// Click ảo tại vị trí hiện tại
await window.__AGENT_PILOT__.click(500, 300);

// Tự động gõ chữ vào ô input
await window.__AGENT_PILOT__.type("#username-field", "admin@antigravity.ai");

// Trích xuất vị trí, kích thước, selector của phần tử
const info = await window.__AGENT_PILOT__.getElement("#submit-button");
console.log("Vị trí phần tử:", info?.rect); // { x: 500, y: 300, width: 120, height: 40 }

// Nhặt màu trên màn hình (hỗ trợ 5 định dạng)
const color = await window.__AGENT_PILOT__.pickColor();
console.log("Mã màu đã nhặt:", color.hex, color.rgb, color.rgba, color.hsl, color.oklch);
```

---

## 5. Quy trình Antigravity Debug Tự động (End-to-End Workflow)

1. **Khởi chạy ứng dụng dev**: Antigravity chạy server phát triển cục bộ (`http://localhost:3000` hoặc `test-page.html`).
2. **Mở tab kiểm thử**: Agent gửi lệnh mở tab mới hoặc điều hướng đến trang kiểm thử qua Agent Pilot.
3. **Gắn kết nối CDP**: Agent Pilot kết nối Chrome DevTools Protocol để lắng nghe lỗi `console.error` và các network request lỗi 4xx/5xx.
4. **Mô phỏng hành vi người dùng**: Chuột ảo bay đến các nút bấm, điền form đăng ký, gửi dữ liệu.
5. **Thu thập logs & Screenshot**: Nếu có lỗi phát sinh, Agent Pilot tự động chụp màn hình và trích xuất nguyên nhân lỗi gửi về cho Antigravity phân tích và sửa code tự động.
