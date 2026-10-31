# 🍎 Agent Pilot — Hướng Dẫn Cài Đặt Trên macOS

Gói cài đặt chuyên biệt dành cho **macOS (darwin-arm64 — Apple Silicon M1-M4)**, tích hợp sẵn Chrome Extension, MCP Server tĩnh và Agent Skill:

```text
agent-pilot-v1.3.0-macos/
├── extensions/            Chrome Extension (Manifest V3) — nạp trực tiếp vào Chrome/Brave/Arc
├── install.sh             Script cài đặt tự động 1 lệnh cho macOS (tự gỡ Gatekeeper quarantine)
├── skills/agent-pilot/    Agent Skill + scripts/agent-pilot native binary
└── README.md              Tài liệu hướng dẫn cho macOS
```

## Yêu cầu hệ thống
- **Hệ điều hành**: macOS 12 Monterey trở lên (`darwin-arm64` cho chip M1/M2/M3/M4 hoặc `darwin-amd64` cho chip Intel)
- **Trình duyệt**: Google Chrome 116+, Brave, Arc hoặc Microsoft Edge (hỗ trợ Side Panel API)
- **Phụ thuộc**: Không cần cài Node.js hay Go (`skills/agent-pilot/scripts/agent-pilot` đã được biên dịch độc lập)

---

## ⚡ Cài đặt nhanh 1 lệnh (Khuyên dùng)

Mở **Terminal** (hoặc iTerm2) tại thư mục vừa giải nén và chạy:

```bash
chmod +x ./install.sh && ./install.sh
```

Script `install.sh` sẽ tự động:
1. Gỡ cờ cách ly **macOS Gatekeeper** (`xattr -cr`) khỏi toàn bộ gói tải về để macOS không chặn thực thi ngầm khi MCP gọi.
2. Cài đặt binary `agent-pilot` vào `~/.local/bin/agent-pilot` (hoặc `/usr/local/bin/agent-pilot` nếu có quyền ghi).
3. Đăng ký và kích hoạt dịch vụ chạy ngầm `launchd` (`~/Library/LaunchAgents/com.agentpilot.bridge.plist`).
4. Cài đặt Agent Skill vào `~/.agents/skills/agent-pilot` và `~/.gemini/config/skills/agent-pilot` (Antigravity).
5. In ra đoạn cấu hình JSON MCP với đường dẫn tuyệt đối chuẩn cho macOS.

Binary native cũng có sẵn tại `skills/agent-pilot/scripts/agent-pilot`; skill
installer tự sao chép nó vào skill đã cài để agent có thể gọi khi GUI IDE không
truyền đúng `PATH`.

---

## 🛠️ Hoặc Cài Đặt Thủ Công Từng Bước

### Bước 1: Gỡ Gatekeeper Quarantine & Cài Đặt Binary
> ⚠️ **Quan trọng trên macOS**: Khi tải file `.zip` bằng Safari/Chrome, macOS tự động gắn thuộc tính `com.apple.quarantine`. Nếu không gỡ bỏ, các ứng dụng như Claude Desktop / Cursor / Antigravity khi gọi `agent-pilot mcp` chạy ngầm sẽ bị macOS chặn âm thầm.

```bash
# 1. Gỡ thuộc tính quarantine của macOS Gatekeeper
xattr -cr .
chmod +x ./skills/agent-pilot/scripts/agent-pilot

# 2. Cài vào ~/.local/bin (không cần sudo) hoặc /usr/local/bin
mkdir -p ~/.local/bin
cp ./skills/agent-pilot/scripts/agent-pilot ~/.local/bin/agent-pilot

# Đảm bảo ~/.local/bin có trong ~/.zshrc
export PATH="$HOME/.local/bin:$PATH"
```

### Bước 2: Kích Hoạt Dịch Vụ Ngầm (`launchd` User Agent)
```bash
agent-pilot service install
agent-pilot service status
```
Lệnh trên tạo tệp `~/Library/LaunchAgents/com.agentpilot.bridge.plist` tự khởi động khi đăng nhập macOS và ghi log tại `~/Library/Logs/agent-pilot.log`.

Quản lý dịch vụ `launchd` trên macOS:
```bash
agent-pilot service status     # hoặc: launchctl list com.agentpilot.bridge
agent-pilot service restart    # Nạp lại LaunchAgent
agent-pilot service stop       # Tạm dừng LaunchAgent
agent-pilot service uninstall  # Gỡ bỏ ~/Library/LaunchAgents/com.agentpilot.bridge.plist
tail -f ~/Library/Logs/agent-pilot.log ~/Library/Logs/agent-pilot.err
```

### Bước 3: Nạp Chrome Extension
1. Mở Chrome, truy cập `chrome://extensions`.
2. Bật **Developer mode** (góc trên bên phải).
3. Nhấn **Load unpacked** → chọn thư mục `extensions/` trong gói này.
4. Ghim biểu tượng **Agent Pilot (📌)** lên thanh công cụ và nhấp vào biểu tượng để mở Side Panel (hoặc tự cấu hình phím tắt tại `chrome://extensions/shortcuts`).

---

## 🤖 Cấu Hình MCP Server Trên macOS

> 💡 **Lưu ý đặc biệt cho ứng dụng GUI trên macOS**: Các ứng dụng macOS khởi chạy từ Finder/Dock/Spotlight (như Claude Desktop, Cursor, Antigravity) **không đọc `PATH` trong `~/.zshrc`**. Vì vậy bạn **nên khai báo đường dẫn tuyệt đối** tới file binary trong `"command"` để tránh lỗi `spawn agent-pilot ENOENT`.

```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "/Users/<ten_user_cua_ban>/.local/bin/agent-pilot",
      "args": ["mcp"]
    }
  }
}
```
*(Nếu bạn chép binary vào `/usr/local/bin/agent-pilot` hoặc `/opt/homebrew/bin/agent-pilot`, hãy thay `"command"` bằng đường dẫn tương ứng).*

### Đường dẫn file cấu hình MCP trên macOS:
| AI Coding Agent | Đường dẫn file cấu hình trên macOS |
| :--- | :--- |
| **Google Antigravity** | `~/.gemini/config/mcp_config.json` |
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Code CLI** | `~/.claude.json` |
| **Cursor IDE** | `~/.cursor/mcp.json` (hoặc *Cursor Settings → MCP → Add Server*) |
| **OpenCode / Codex** | `~/.config/opencode/opencode.json` / `~/.codex/config.toml` |

Kiểm tra kết nối từ Terminal:
```bash
curl http://127.0.0.1:58765/health
agent-pilot tabs
```

---

## 📦 Cài Đặt Agent Skill Cho AI Coding Assistant
```bash
agent-pilot skill install --force          # Chuẩn chung: ~/.agents/skills/agent-pilot
agent-pilot skill install --agy --force    # Antigravity: ~/.gemini/config/skills/agent-pilot
```

---

## 🔧 Xử Lý Sự Cố Thường Gặp Trên macOS
| Vấn đề | Nguyên nhân & Cách xử lý trên macOS |
| :--- | :--- |
| macOS báo *"agent-pilot cannot be opened because the developer cannot be verified"* | Chạy `xattr -d com.apple.quarantine ./skills/agent-pilot/scripts/agent-pilot` (hoặc `xattr -cr .` tại thư mục giải nén), hoặc vào **System Settings → Privacy & Security → Allow Anyway**. |
| MCP báo `spawn agent-pilot ENOENT` trong Claude / Cursor | Do ứng dụng GUI trên macOS không nhận `PATH` của `~/.zshrc`. Hãy đổi `"command": "agent-pilot"` thành đường dẫn tuyệt đối `"/Users/<user>/.local/bin/agent-pilot"` hoặc `"/usr/local/bin/agent-pilot"`. |
| Cài đặt phím tắt mở Side Panel | Tiện ích không gán phím tắt mặc định để tránh xung đột hệ thống. Bạn có thể tự gán tại `chrome://extensions/shortcuts`. |
| `Another debugger is already attached` | Đóng cửa sổ DevTools (<kbd>Cmd + Option + I</kbd>) trên tab đang điều khiển rồi thử lại. |

---
MIT License · Tác giả **DNT** ([@ducconit](https://github.com/ducconit)) · https://github.com/ducconit/agent-pilot-extension
