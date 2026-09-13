# 🚀 Agent Pilot CLI (Golang)

Phiên bản dòng lệnh độc lập (**Single Executable Binary**) viết bằng **Golang**, đóng vai trò vừa là **MCP Server (stdio)** cho AI Agent, vừa là công cụ CLI automation cho **Tester / QC**.

---

## 🌟 Đặc Điểm Nổi Bật

- **Độc lập hoàn toàn (Zero Runtime Dependencies)**: Không cần cài đặt Node.js hay `npm`, không cần `node_modules`.
- **Khởi động siêu tốc**: Thời gian khởi động `<5ms`, chiếm chỉ khoảng `10MB - 15MB RAM`.
- **Đa năng (Hybrid All-in-One)**:
  - **Dành cho AI Agent**: Chạy làm máy chủ MCP Server qua `stdio` (Antigravity, Claude Code, Cursor).
  - **Dành cho Tester / QC**: Chạy lệnh trực tiếp từ terminal (`agent-pilot click`, `agent-pilot type`, `agent-pilot screenshot`, `agent-pilot batch`).
  - **Dành cho Hệ thống**: Chạy làm Bridge Server ngầm trên cổng `58765` với cơ chế Dual Mode chống xung đột cổng.
- **Bảo mật tuyệt đối**: Lớp lọc Secret Redaction 12 mẫu khóa bí mật và cơ chế khóa Origin WebSocket.

---

## 🛠️ Biên Dịch & Cài Đặt

### 1. Biên dịch từ mã nguồn

Yêu cầu: Đã cài đặt [Go (Golang)](https://go.dev/) (>= 1.20).

```bash
cd cli

# Tải dependencies
go mod tidy

# Biên dịch binary tối ưu kích thước
go build -ldflags="-s -w" -o agent-pilot .
```

### 2. Cài đặt vào hệ thống (Toàn cục)

```bash
# Trên Linux / macOS:
sudo mv agent-pilot /usr/local/bin/

# Hoặc cài đặt qua go install:
go install .
```

---

## 📖 Hướng Dẫn Sử Dụng

### 1. Sử dụng làm MCP Server cho AI Agent

Trong cấu hình MCP của Google Antigravity hoặc Claude Code, trỏ lệnh thực thi đến binary `agent-pilot`:

```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "/path/to/agent-pilot",
      "args": ["mcp"]
    }
  }
}
```

### 2. Dành cho Tester / QC (Lệnh CLI Trực Tiếp)

Tester hoặc kỹ sư QC có thể viết script shell (`.sh`, `.bat`, Python) để điều khiển trình duyệt tự động:

```bash
# 1. Mở trang web mới
agent-pilot open "https://example.com" --active

# 2. Gõ phím vào ô tìm kiếm hoặc đăng nhập
agent-pilot type "#search-box" "laptop gaming" --enter

# 3. Click chuột ảo vào nút bấm
agent-pilot click ".btn-search"

# 4. Soi thông số phần tử DOM
agent-pilot inspect "#product-price"

# 5. Chụp ảnh màn hình lưu ra file PNG
agent-pilot screenshot -o search_results.png --mode visible

# 6. Xem danh sách các tab đang mở
agent-pilot tabs

# 7. Chạy một kịch bản Batch Automation hoàn chỉnh từ file JSON
agent-pilot batch flow_test.json
```

### 3. Cấu Trúc File Batch Automation JSON

File `flow_test.json`:
```json
[
  { "action": "open", "url": "https://google.com" },
  { "action": "wait", "ms": 1000 },
  { "action": "type", "selector": "textarea[name='q']", "text": "Agent Pilot AI", "pressEnter": true },
  { "action": "wait", "ms": 2000 },
  { "action": "screenshot", "label": "search_result" }
]
```

Thực thi kịch bản:
```bash
agent-pilot batch flow_test.json
```

---

## 🧪 Chạy Kiểm Thử (Unit Tests)

```bash
cd cli
go test -v ./...
```
