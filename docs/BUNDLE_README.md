# 🚀 Agent Pilot {{VERSION}} — Gói cài đặt tổng hợp ({{PLATFORM}})

Gói này chứa mọi thứ cần thiết để AI Agent quan sát và điều khiển trình duyệt:

```
agent-pilot-{{VERSION}}-{{PLATFORM}}/
├── extensions/            Chrome Extension (Manifest V3) — nạp trực tiếp vào Chrome
├── {{BINARY_NAME}}        Agent Pilot CLI / MCP Server (binary tĩnh, zero-dependency)
├── skills/agent-pilot/    Agent Skill (SKILL.md + references + examples)
└── README.md              Tài liệu này
```

## Yêu cầu
- Google Chrome 116+ (hoặc Chromium / Edge / Brave tương đương, hỗ trợ Side Panel API)
- Không cần Node.js hay Go — binary đã được biên dịch tĩnh (`CGO_ENABLED=0`)

## 1) Cài Chrome Extension
1. Mở `chrome://extensions` → bật **Developer mode** (góc phải trên).
2. Bấm **Load unpacked** → chọn thư mục `extensions/` trong gói này.
3. Ghim icon **Agent Pilot (📌)** lên thanh công cụ Chrome.
4. Mở Side Panel: click icon, hoặc chuột phải trên trang → **Mở Agent Pilot (Side Panel)**,
   hoặc dùng phím tắt gợi ý <kbd>Ctrl+Shift+P</kbd> (macOS: <kbd>Cmd+Shift+P</kbd>).

## 2) Cài CLI / MCP Server

**Linux / macOS**
```bash
chmod +x ./{{BINARY_NAME}}
sudo mv ./{{BINARY_NAME}} /usr/local/bin/agent-pilot
agent-pilot --help
```

**Windows**
- Giữ nguyên `agent-pilot.exe`, thêm thư mục chứa nó vào biến môi trường `PATH`
  (hoặc chạy trực tiếp bằng đường dẫn đầy đủ).

**Chạy bridge như service chạy ngầm (khuyên dùng)** — tự khởi động cùng máy:
```bash
agent-pilot service install     # Linux: systemd --user · macOS: launchd · Windows: Task Scheduler
agent-pilot service status
# agent-pilot service restart | stop | uninstall
```
Hoặc chạy thủ công: `agent-pilot server`
- Mặc định lắng nghe `127.0.0.1:58765`
- Đổi cổng: `AGENT_PILOT_PORT=<port>` (áp dụng cho cả server lẫn CLI) hoặc `--port <port>` cho lệnh `server`

## 3) Kết nối với AI Agent (MCP)
Thêm vào file cấu hình MCP của agent:
```json
{
  "mcpServers": {
    "agent-pilot": { "command": "agent-pilot", "args": ["mcp"] }
  }
}
```
Vị trí thường gặp:
- **Antigravity**: `~/.gemini/config/mcp_config.json`
- **Claude Desktop**: `claude_desktop_config.json`
- **Cursor**: Settings → MCP → Add server
- **Codex / OpenCode / Claude Code**: mục MCP trong config tương ứng

Kiểm tra nhanh: `agent-pilot tabs` (liệt kê tab đang mở qua bridge).

## 4) Cài Agent Skill (tùy chọn, cho Antigravity/Claude Code/Cursor…)
```bash
agent-pilot skill install          # ~/.agents/skills/agent-pilot
agent-pilot skill install --agy    # ~/.gemini/config/skills/agent-pilot (Antigravity)
agent-pilot skill install --path ~/my-skills --force
```
Hoặc cài từ repo: `npx skills add https://github.com/ducconit/agent-pilot-extension`

## 5) Ví dụ sử dụng nhanh
```bash
agent-pilot open "https://example.com" --active
agent-pilot click "#login-button"
agent-pilot type "#username" "testuser" --enter
agent-pilot inspect "h1"
agent-pilot screenshot -o page.png --mode visible
agent-pilot batch flow.json
agent-pilot feedback list
```
Kịch bản batch (1 tool call chạy nhiều bước):
```json
[
  { "action": "mouse_move", "x": 320, "y": 210, "duration": 400 },
  { "action": "mouse_click", "x": 320, "y": 210 },
  { "action": "type", "selector": "#test-search-input", "text": "hello" },
  { "action": "scroll", "deltaY": 250 },
  { "action": "screenshot", "mode": "visible" }
]
```

## 6) MCP Tools (35 công cụ)
- **Tab**: `browser_open_tab`, `browser_list_tabs`, `browser_navigate`, `browser_list_instances`, `browser_select_instance`
- **Tương tác**: `browser_click`, `browser_drag`, `browser_type`, `browser_scroll`, `browser_hover`, `browser_press_key`, `browser_fill_form`, `browser_upload_file`
- **Đọc trang / CDP**: `browser_get_element`, `browser_screenshot`, `browser_pick_color`, `browser_get_devtools_data`, `browser_list_network_requests`, `browser_get_network_request`, `browser_performance_metrics`, `browser_performance_trace`, `browser_take_heapsnapshot`, `browser_evaluate`
- **Batch & phiên làm việc**: `browser_run_actions`, `browser_set_busy`, `browser_handle_dialog`, `browser_emulate`
- **Feedback người dùng**: `browser_wait_for_feedback`, `browser_get_pending_feedback`
- **Hệ thống**: `browser_manage_extensions`, `browser_end_session`, …

Bảng đầy đủ: `docs/API_REFERENCE.md` trong repository.

## 7) Bảo mật
- **Secret Redaction**: tự động che API key / private key / JWT / Bearer token trước khi gửi cho LLM
  (bật/tắt trong Side Panel — mặc định bật).
- **Bridge cục bộ**: chỉ lắng nghe `127.0.0.1:58765`, allowlist origin localhost + extension,
  **không có auth token** → chỉ chạy phần mềm tin cậy trên máy này, không mở port ra ngoài.

## 8) Xử lý sự cố
| Vấn đề | Cách xử lý |
|---|---|
| `Another debugger is already attached` | Đóng DevTools của tab đó rồi thử lại |
| `no Chrome Extension connected` | Kiểm tra extension đang bật và bridge đang chạy (`agent-pilot service status`) |
| Cổng 58765 bị chiếm | Đặt `AGENT_PILOT_PORT=<port>` (server + CLI dùng chung biến này) |
| macOS chặn binary | `xattr -d com.apple.quarantine ./agent-pilot` hoặc System Settings → Privacy & Security → Allow |
| Không chụp được tab nền | Chrome chặn `captureVisibleTab` cho tab không active — dùng `browser_screenshot` (mặc định qua CDP) |
| Side Panel không mở | Kiểm tra Chrome ≥ 116 và extension đã được Load unpacked |

---
MIT License · Tác giả **DNT** ([@ducconit](https://github.com/ducconit)) · https://github.com/ducconit/agent-pilot-extension
