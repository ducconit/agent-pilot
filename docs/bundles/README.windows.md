# 🪟 Agent Pilot {{VERSION}} — Bản Windows ({{PLATFORM}})

Gói cài đặt chuyên biệt dành cho **Windows 10 / Windows 11 ({{ARCH}})**, tích hợp sẵn Chrome Extension, MCP Server tĩnh và Agent Skill:

```text
agent-pilot-{{VERSION}}-{{PLATFORM}}\
├── extensions\            Chrome Extension (Manifest V3) — nạp trực tiếp vào Chrome/Edge/Brave
├── {{BINARY_NAME}}        Agent Pilot CLI & MCP Server (Windows PE static binary, zero-dependency)
├── install.ps1            Script PowerShell cài đặt tự động 1 lệnh cho Windows
├── skills\agent-pilot\    Agent Skill (SKILL.md + references + examples)
└── README.md              Tài liệu hướng dẫn cho Windows
```

## Yêu cầu hệ thống
- **Hệ điều hành**: Windows 10 / Windows 11 ({{ARCH}})
- **Trình duyệt**: Google Chrome 116+, Microsoft Edge hoặc Brave (hỗ trợ Side Panel API)
- **Phụ thuộc**: Không cần cài Node.js hay Go (`{{BINARY_NAME}}` chạy độc lập, không cần quyền Administrator)

---

## ⚡ Cài đặt nhanh 1 lệnh bằng PowerShell (Khuyên dùng)

Mở **PowerShell** tại thư mục vừa giải nén và chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Script `install.ps1` sẽ tự động:
1. Gỡ chặn SmartScreen (`Unblock-File`) cho tệp thực thi tải từ Internet.
2. Sao chép `agent-pilot.exe` vào thư mục chuẩn `%LOCALAPPDATA%\Programs\agent-pilot\agent-pilot.exe`.
3. Thêm `%LOCALAPPDATA%\Programs\agent-pilot` vào biến môi trường `PATH` của User (không cần quyền Admin).
4. Đăng ký và khởi chạy tác vụ chạy ngầm trong **Windows Task Scheduler** (`AgentPilotBridge`).
5. Cài đặt Agent Skill vào `%USERPROFILE%\.agents\skills\agent-pilot` và `%USERPROFILE%\.gemini\config\skills\agent-pilot` (Antigravity).
6. In ra đoạn cấu hình JSON MCP với đường dẫn `C:\\Users\\...` đã được escape chuẩn cho Windows.

---

## 🛠️ Hoặc Cài Đặt Thủ Công Từng Bước

### Bước 1: Nạp Chrome / Edge Extension
1. Mở Google Chrome truy cập `chrome://extensions` (hoặc Microsoft Edge tại `edge://extensions`).
2. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển).
3. Nhấn **Load unpacked** (Tải tiện ích đã giải nén) → chọn thư mục `extensions` bên trong gói này.
4. Ghim biểu tượng **Agent Pilot (📌)** lên thanh công cụ và mở Side Panel bằng phím tắt <kbd>Ctrl + Shift + P</kbd>.

### Bước 2: Cài Đặt `agent-pilot.exe` & Background Service (Task Scheduler)
Chạy trong **PowerShell**:
```powershell
# 1. Gỡ khóa SmartScreen (nếu tải file zip từ trình duyệt)
Unblock-File -Path .\agent-pilot.exe

# 2. Tạo thư mục cài đặt chuẩn trong AppData\Local\Programs
$installDir = "$env:LOCALAPPDATA\Programs\agent-pilot"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item .\agent-pilot.exe -Destination "$installDir\agent-pilot.exe" -Force

# 3. Đăng ký và chạy dịch vụ nền qua Windows Task Scheduler
& "$installDir\agent-pilot.exe" service install
& "$installDir\agent-pilot.exe" service status
```

Quản lý dịch vụ nền trên Windows:
```powershell
agent-pilot.exe service status     # hoặc: schtasks /Query /TN AgentPilotBridge
agent-pilot.exe service restart    # Khởi động lại Task
agent-pilot.exe service stop       # Dừng Task
agent-pilot.exe service uninstall  # Xóa Task AgentPilotBridge khỏi Task Scheduler
```

---

## 🤖 Cấu Hình MCP Server Trên Windows

Thêm cấu hình dưới đây vào tệp cấu hình MCP của AI Agent bạn đang sử dụng.

> ⚠️ **Lưu ý cú pháp JSON trên Windows**: Trong file `.json`, dấu gạch chéo ngược `\` trong đường dẫn Windows **bắt buộc phải viết kép thành `\\`** (ví dụ `C:\\Users\\...\\agent-pilot.exe`). Sử dụng đường dẫn tuyệt đối giúp Claude Desktop, Cursor và Antigravity luôn gọi được MCP Server ngay cả khi bạn chưa khởi động lại máy sau khi sửa `PATH`.

```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "C:\\Users\\<TenUserCuaBan>\\AppData\\Local\\Programs\\agent-pilot\\agent-pilot.exe",
      "args": ["mcp"]
    }
  }
}
```

### Đường dẫn file cấu hình MCP trên Windows:
| AI Coding Agent | Đường dẫn file cấu hình trên Windows |
| :--- | :--- |
| **Google Antigravity** | `%USERPROFILE%\.gemini\config\mcp_config.json` (`C:\Users\<User>\.gemini\config\mcp_config.json`) |
| **Claude Desktop** | `%APPDATA%\Claude\claude_desktop_config.json` (`C:\Users\<User>\AppData\Roaming\Claude\claude_desktop_config.json`) |
| **Claude Code CLI** | `%USERPROFILE%\.claude.json` |
| **Cursor IDE** | `%USERPROFILE%\.cursor\mcp.json` (hoặc *Cursor Settings → MCP → Add Server*) |
| **OpenCode / Codex** | `%USERPROFILE%\.config\opencode\opencode.json` / `%USERPROFILE%\.codex\config.toml` |

Kiểm tra kết nối từ PowerShell:
```powershell
Invoke-RestMethod http://127.0.0.1:58765/health
agent-pilot.exe tabs
```

---

## 📦 Cài Đặt Agent Skill Cho AI Coding Assistant
```powershell
agent-pilot.exe skill install --force          # %USERPROFILE%\.agents\skills\agent-pilot
agent-pilot.exe skill install --agy --force    # %USERPROFILE%\.gemini\config\skills\agent-pilot
```

---

## 🧪 Lệnh CLI & Batch Automation Thường Dùng (PowerShell / CMD)
```powershell
agent-pilot.exe open "https://example.com" --active
agent-pilot.exe snapshot
agent-pilot.exe click "#login-button"
agent-pilot.exe type "#username" "testuser" --enter
agent-pilot.exe screenshot -o page.png --mode visible
agent-pilot.exe batch flow.json
agent-pilot.exe close
```

---

## 🔧 Xử Lý Sự Cố Thường Gặp Trên Windows
| Vấn đề | Nguyên nhân & Cách xử lý trên Windows |
| :--- | :--- |
| Windows Defender SmartScreen cảnh báo *"Windows protected your PC"* | Bấm **More info (Thêm thông tin)** → **Run anyway**, hoặc chạy lệnh PowerShell: `Unblock-File .\agent-pilot.exe`. |
| PowerShell báo *"cannot be loaded because running scripts is disabled"* | Chạy kèm cờ bypass: `powershell -ExecutionPolicy Bypass -File .\install.ps1`. |
| Lỗi JSON cú pháp khi thêm vào `mcp_config.json` | Kiểm tra lại dấu `\` trong đường dẫn `C:\Users\...` — phải viết thành `C:\\Users\\...` trong JSON. |
| Đổi cổng mặc định `58765` | Đặt biến môi trường trong PowerShell: `$env:AGENT_PILOT_PORT="58765"`. |
| `Another debugger is already attached` | Đóng cửa sổ DevTools (`F12`) trên tab đang điều khiển rồi thử lại. |

---
MIT License · Tác giả **DNT** ([@ducconit](https://github.com/ducconit)) · https://github.com/ducconit/agent-pilot-extension
