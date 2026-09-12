# 🚀 Hướng Dẫn Tích Hợp Antigravity-First (Agent Pilot)

**Agent Pilot** được thiết kế với triết lý **Antigravity-First**, cho phép các AI coding & automation agent của Antigravity có thể "nhìn", "hiểu" và "điều khiển" trình duyệt của lập trình viên một cách an toàn, chính xác và trực quan.

---

## 1. Mô hình Kết nối Antigravity & Agent Pilot

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            HỆ THỐNG MÁY TÍNH HOST                           │
│                                                                             │
│  ┌───────────────────────────┐                ┌──────────────────────────┐  │
│  │   Antigravity AI Agent    │                │  Lập Trình Viên / User   │  │
│  │   (Coding Assistant)      │                │  (Quan sát trực tiếp)    │  │
│  └─────────────┬─────────────┘                └────────────┬─────────────┘  │
│                │                                           │                │
│                │ 1. Phát JSON Action                       │ Quan sát chuột │
│                │    hoặc gọi Script / MCP                  │ ảo & logs      │
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

## 2. Giao thức Hành động JSON (Agent Control Protocol - ACP)

Antigravity có thể tạo ra các chuỗi lệnh JSON có cấu trúc để nạp vào Agent Pilot thực thi theo kịch bản:

### Cú pháp mẫu:
```json
[
  {
    "action": "navigate",
    "url": "http://localhost:3000/dashboard"
  },
  {
    "action": "wait",
    "ms": 1000
  },
  {
    "action": "mouse_move",
    "x": 380,
    "y": 240,
    "duration": 400
  },
  {
    "action": "mouse_click",
    "x": 380,
    "y": 240
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
]
```

### Danh mục hành động hỗ trợ:
| Action | Tham số | Mô tả |
| :--- | :--- | :--- |
| `navigate` | `url` (string) | Điều hướng tab hiện tại đến địa chỉ mong muốn |
| `wait` | `ms` (number) | Tạm dừng luồng thực thi trong khoảng thời gian mili-giây |
| `mouse_move` | `x`, `y`, `duration` (ms) | Di chuyển con trỏ chuột ảo mượt mà đến tọa độ chỉ định |
| `mouse_click` | `x`, `y` | Phát hiệu ứng sóng click và kích hoạt chuỗi sự kiện DOM (`mousedown`, `mouseup`, `click`) |
| `type` | `selector` (string), `text` (string) | Di chuyển đến ô nhập liệu, kích hoạt focus và tự động gõ ký tự từng bước |
| `scroll` | `deltaX`, `deltaY` (px) | Cuộn trang mượt mà theo trục X/Y |
| `screenshot` | `mode` ("visible" \| "element" \| "region") | Kích hoạt bộ chụp màn hình |

---

## 3. Máy Chủ Cầu Nối WebSocket & MCP Server (Cổng 58765)

Agent Pilot trang bị sẵn một máy chủ cầu nối hai chiều chuẩn **Model Context Protocol (MCP)** và **WebSocket** tại cổng chuyên dụng **`58765`** (dải cổng riêng tư IANA `49152 – 65535`, chống trùng lặp hoàn toàn với các dịch vụ dev thông thường).

### 3.1. Khởi chạy Máy chủ Cầu nối:
```bash
# Khởi chạy chế độ thông thường (WebSocket + HTTP API)
npm run server

# Hoặc khởi chạy cổng tùy chỉnh
AGENT_PILOT_PORT=58765 npm run server
```

### 3.2. Cấu hình Antigravity MCP Server (`~/.gemini/antigravity/mcp/`):
Thêm cấu hình sau vào Antigravity để AI Agent tự động sở hữu toàn bộ công cụ điều khiển trình duyệt:
```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "node",
      "args": ["/home/ubuntu/workspace/projects/browser-control/scripts/agent_pilot_server.mjs", "--mcp"]
    }
  }
}
```

### 3.3. Danh mục 9 Công cụ MCP cung cấp cho Antigravity:
1. `browser_open_tab(url)`: Mở tab trình duyệt mới với địa chỉ URL chỉ định.
2. `browser_navigate(url, tabId)`: Điều hướng tab đang hoạt động hoặc tab chỉ định.
3. `browser_click(x, y, selector)`: Di chuyển chuột ảo mượt mà và click vào tọa độ (X, Y) hoặc selector CSS.
4. `browser_type(selector, text, delay)`: Tự động gõ phím human-like vào ô nhập liệu.
5. `browser_scroll(deltaX, deltaY)`: Cuộn trang web mượt mà theo trục X hoặc Y.
6. `browser_get_element(selector)`: Trích xuất Bounding Box, kích thước, CSS selector và XPath của phần tử DOM.
7. `browser_screenshot(mode)`: Chụp ảnh màn hình (trả về dữ liệu Base64 PNG trực tiếp cho Antigravity xem).
8. `browser_get_devtools_data(tabId)`: Lấy toàn bộ Console logs và Network requests thời gian thực qua CDP.
9. `browser_pick_color()`: Kích hoạt kính lúp lấy mã màu pixel tại vị trí chỉ định.

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
const info = window.__AGENT_PILOT__.getElement("#submit-button");
console.log("Vị trí phần tử:", info.rect); // { x: 500, y: 300, width: 120, height: 40 }

// Nhặt màu trên màn hình
const color = await window.__AGENT_PILOT__.pickColor();
console.log("Mã màu đã nhặt:", color.hex);
```

---

## 5. Quy trình Antigravity Debug Tự động (End-to-End Workflow)

1. **Khởi chạy ứng dụng dev**: Antigravity chạy server phát triển cục bộ (`http://localhost:3000` hoặc `test-page.html`).
2. **Mở tab kiểm thử**: Agent gửi lệnh mở tab mới hoặc điều hướng đến trang kiểm thử qua Agent Pilot.
3. **Gắn kết nối CDP**: Agent Pilot kết nối Chrome DevTools Protocol để lắng nghe lỗi `console.error` và các network request lỗi 4xx/5xx.
4. **Mô phỏng hành vi người dùng**: Chuột ảo bay đến các nút bấm, điền form đăng ký, gửi dữ liệu.
5. **Thu thập logs & Screenshot**: Nếu có lỗi phát sinh, Agent Pilot tự động chụp màn hình và trích xuất nguyên nhân lỗi gửi về cho Antigravity phân tích và sửa code tự động.
