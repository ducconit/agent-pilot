# 🐧 Agent Pilot {{VERSION}} — Bản Ubuntu / Linux ({{PLATFORM}})

Gói cài đặt chuyên biệt dành cho **Ubuntu / Debian / Linux ({{ARCH}})**, tích hợp sẵn Chrome Extension, MCP Server tĩnh và Agent Skill:

```text
agent-pilot-{{VERSION}}-{{PLATFORM}}/
├── extensions/            Chrome Extension (Manifest V3) — nạp trực tiếp vào Chrome/Chromium
├── install.sh             Script cài đặt tự động 1 lệnh cho Ubuntu/Linux
├── skills/agent-pilot/    Agent Skill + scripts/{{BINARY_NAME}} native binary
└── README.md              Tài liệu hướng dẫn cho Ubuntu/Linux
```

## Yêu cầu hệ thống
- **Hệ điều hành**: Ubuntu 20.04+ / Debian / Linux ({{ARCH}}) có `systemd`
- **Trình duyệt**: Google Chrome 116+, Chromium, Brave hoặc Microsoft Edge (hỗ trợ Side Panel API)
- **Phụ thuộc**: Không cần cài Node.js hay Go (`skills/agent-pilot/scripts/{{BINARY_NAME}}` được biên dịch tĩnh `CGO_ENABLED=0`)

---

## ⚡ Cài đặt nhanh 1 lệnh (Khuyên dùng)

Mở Terminal tại thư mục vừa giải nén và chạy:

```bash
chmod +x ./install.sh && ./install.sh
```

Script `install.sh` sẽ tự động:
1. Cài đặt binary `agent-pilot` vào `~/.local/bin/agent-pilot` (không cần `sudo`).
2. Đăng ký và kích hoạt dịch vụ chạy ngầm `systemd --user` (`~/.config/systemd/user/agent-pilot.service`).
3. Cài đặt Agent Skill vào `~/.agents/skills/agent-pilot` và `~/.gemini/config/skills/agent-pilot` (Antigravity).
4. In ra đoạn cấu hình JSON MCP kèm đường dẫn chính xác trên máy của bạn.

Binary native cũng có sẵn tại `skills/agent-pilot/scripts/agent-pilot`; skill
installer tự sao chép nó vào skill đã cài để agent có thể gọi khi GUI IDE không
truyền đúng `PATH`.

---

## 🛠️ Hoặc Cài Đặt Thủ Công Từng Bước

### Bước 1: Nạp Chrome Extension
1. Mở trình duyệt Chrome/Chromium, truy cập `chrome://extensions`.
2. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Nhấn **Load unpacked** (Tải tiện ích đã giải nén) → chọn thư mục `extensions/` trong gói này.
4. Ghim biểu tượng **Agent Pilot (📌)** lên thanh công cụ và mở Side Panel bằng phím tắt <kbd>Ctrl+Shift+P</kbd>.

### Bước 2: Cài đặt CLI / MCP Server & Service (`systemd --user`)
```bash
# Cấp quyền thực thi và cài vào ~/.local/bin (hoặc /usr/local/bin nếu muốn dùng toàn hệ thống)
mkdir -p ~/.local/bin
chmod +x ./skills/agent-pilot/scripts/{{BINARY_NAME}}
cp ./skills/agent-pilot/scripts/{{BINARY_NAME}} ~/.local/bin/agent-pilot

# Đảm bảo ~/.local/bin nằm trong PATH (thêm vào ~/.bashrc nếu chưa có)
export PATH="$HOME/.local/bin:$PATH"

# Cài đặt và kích hoạt systemd user service tự chạy khi đăng nhập
agent-pilot service install
agent-pilot service status
```

Quản lý dịch vụ `systemd --user`:
```bash
agent-pilot service status     # hoặc: systemctl --user status agent-pilot.service
agent-pilot service restart    # hoặc: systemctl --user restart agent-pilot.service
agent-pilot service stop       # hoặc: systemctl --user stop agent-pilot.service
agent-pilot service uninstall  # Gỡ bỏ service khỏi ~/.config/systemd/user/
journalctl --user -u agent-pilot.service -f   # Xem log thời gian thực
```

---

## 🤖 Cấu Hình MCP Server Trên Ubuntu / Linux

Thêm cấu hình dưới đây vào tệp cấu hình MCP của AI Agent bạn đang sử dụng.

> 💡 **Mẹo trên Linux**: Dùng đường dẫn tuyệt đối `/home/<user>/.local/bin/agent-pilot` (hoặc `/usr/local/bin/agent-pilot`) giúp các IDE khởi chạy từ Desktop Launcher luôn tìm thấy binary kể cả khi `PATH` trong `.bashrc` chưa được nạp vào phiên GUI.

```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "/home/<ten_user_cua_ban>/.local/bin/agent-pilot",
      "args": ["mcp"]
    }
  }
}
```

### Đường dẫn file cấu hình MCP trên Ubuntu / Linux:
| AI Coding Agent | Đường dẫn file cấu hình trên Ubuntu / Linux |
| :--- | :--- |
| **Google Antigravity** | `~/.gemini/config/mcp_config.json` |
| **Claude Desktop / Claude Code** | `~/.config/Claude/claude_desktop_config.json` hoặc `~/.claude.json` |
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

## 🧪 Lệnh CLI & Batch Automation Thường Dùng
```bash
agent-pilot open "https://example.com" --active
agent-pilot snapshot
agent-pilot click "#login-button"
agent-pilot type "#username" "testuser" --enter
agent-pilot screenshot -o page.png --mode visible
agent-pilot batch flow.json
agent-pilot close
```

---

## 🔧 Xử Lý Sự Cố Thường Gặp Trên Ubuntu / Linux
| Vấn đề | Nguyên nhân & Cách xử lý trên Ubuntu / Linux |
| :--- | :--- |
| `command not found: agent-pilot` | Thư mục `~/.local/bin` chưa có trong `PATH`. Chạy `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc`, hoặc copy vào `/usr/local/bin/agent-pilot`. |
| `Failed to connect to bus` khi chạy `service install` | Phiên đăng nhập SSH tối giản không có `DBUS_SESSION_BUS_ADDRESS`. Hãy chạy trên terminal trong phiên Desktop, hoặc chạy trực tiếp `nohup agent-pilot server >/tmp/agent-pilot.log 2>&1 &`. |
| `no Chrome Extension connected` | Mở Chrome, kiểm tra tiện ích Agent Pilot đã bật tại `chrome://extensions` và dịch vụ `agent-pilot service status` đang báo `active (running)`. |
| `Another debugger is already attached` | Đóng cửa sổ DevTools (`F12`) trên tab đang điều khiển rồi thử lại. |
| Đổi cổng mặc định `58765` | Đặt biến môi trường `export AGENT_PILOT_PORT=58765` hoặc cấu hình `Environment="AGENT_PILOT_PORT=..."` trong `~/.config/systemd/user/agent-pilot.service`. |

---
MIT License · Tác giả **DNT** ([@ducconit](https://github.com/ducconit)) · https://github.com/ducconit/agent-pilot-extension
