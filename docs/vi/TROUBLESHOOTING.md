# 🔍 Lỗi Thường Gặp & Cách Khắc Phục (Troubleshooting)

Tài liệu này tổng hợp các sự cố thường gặp nhất trong quá trình cài đặt, cấu hình và vận hành **Agent Pilot**, kèm theo các bước chẩn đoán và hướng dẫn khắc phục chi tiết.

::: warning Lưu ý phần mềm Vibe-Coded
Agent Pilot là công cụ mã nguồn mở thử nghiệm được xây dựng 100% bằng phương pháp vibe coding cùng Google Antigravity. Vui lòng luôn kiểm thử các thao tác tự động hóa trên môi trường kiểm thử (staging) hoặc phiên làm việc cô lập.
:::

---

## 📋 Danh Sách Kiểm Tra Nhanh (Quick Checklist)

Khi gặp bất kỳ sự cố nào, bạn hãy thực hiện lần lượt 4 bước kiểm tra nhanh sau trên terminal:

```bash
# 1. Kiểm tra bản nhị phân CLI có hoạt động bình thường không
agent-pilot version

# 2. Kiểm tra trạng thái dịch vụ chạy ngầm
agent-pilot service status

# 3. Kiểm tra cổng giao tiếp của Bridge Server (mặc định 58765)
curl -s http://127.0.0.1:58765/health

# 4. Kiểm tra danh sách các tab đang chịu sự kiểm soát của Agent Pilot
agent-pilot tabs
```

---

## 1. Lỗi Kết Nối & Cầu Nối (Bridge)

### 1.1 `Connection refused on 127.0.0.1:58765` hoặc `Bridge: Disconnected`

#### Dấu hiệu nhận biết:
- Chạy lệnh CLI báo lỗi: `dial tcp 127.0.0.1:58765: connect: connection refused`.
- Trợ lý AI báo không thể kết nối tới trình duyệt.
- Bảng điều khiển Side Panel hiển thị chấm đỏ: `🔴 Bridge: Disconnected`.

#### Nguyên nhân:
1. Dịch vụ nền (background daemon) chưa được cài đặt hoặc chưa khởi động.
2. Cổng mạng `58765` bị chặn bởi tường lửa hoặc đang bị phần mềm khác chiếm dụng.
3. Tiện ích mở rộng Chrome đang ở trạng thái tắt hoặc chưa được nạp.

#### Cách xử lý:
1. **Khởi động lại dịch vụ nền**:
   - **Linux / macOS**:
     ```bash
     agent-pilot service stop
     agent-pilot service start
     agent-pilot service status
     ```
   - **Windows (PowerShell)**:
     ```powershell
     agent-pilot service restart
     agent-pilot service status
     ```
2. **Khởi động trực tiếp để soi nhật ký (Debug logs)**:
   ```bash
   agent-pilot serve --port 58765
   ```
   Nếu cổng `58765` bị trùng, bạn có thể chuyển sang cổng khác:
   ```bash
   agent-pilot serve --port 59000
   ```
   *(Nhớ chỉnh lại số cổng tương ứng trong phần cài đặt của Side Panel trên Chrome).*
3. **Kiểm tra tiện ích Chrome**:
   - Truy cập `chrome://extensions`.
   - Đảm bảo công tắc của **Agent Pilot** đang được **BẬT**.
   - Bấm vào biểu tượng mũi tên xoay tròn (🔄) để nạp lại tiện ích nếu Service Worker bị ngủ đông.

---

### 1.2 `No controlled tabs found` hoặc `Tab not in Agent Pilot group`

#### Dấu hiệu nhận biết:
- Chạy `agent-pilot snapshot` hoặc `agent-pilot click` nhận được thông báo lỗi: `Error: tab not found or not in Agent Pilot tab group`.
- Công cụ MCP trả về danh sách tab rỗng: `[]`.

#### Nguyên nhân:
Nhằm bảo vệ an toàn và sự riêng tư tối đa, **Agent Pilot chỉ thao tác trên các tab nằm trong nhóm tab `🤖 Agent Pilot`**. Tiện ích tuyệt đối không can thiệp vào các tab cá nhân của người dùng hoặc cướp tiêu điểm (focus) màn hình khi bạn đang làm việc.

#### Cách xử lý:
1. **Luôn mở tab thông qua Agent Pilot**:
   Khởi tạo tab bằng lệnh CLI hoặc công cụ MCP:
   ```bash
   # Bằng CLI
   agent-pilot open "https://example.com"
   ```
   ```json
   // Bằng MCP
   { "tool": "browser_open_tab", "arguments": { "url": "https://example.com" } }
   ```
2. **Lưu lại và truyền chính xác `tabId`**:
   Lệnh `open` sẽ trả về một số nguyên `tabId` (ví dụ `1546114498`). Bạn hãy truyền `tabId` này vào các lệnh tiếp theo:
   ```bash
   agent-pilot snapshot --tab 1546114498
   agent-pilot click "@1" --tab 1546114498
   ```

---

## 2. Lỗi Đường Dẫn & Lệnh CLI (PATH)

### 2.1 `command not found: agent-pilot`

#### Dấu hiệu nhận biết:
- Terminal báo lỗi: `zsh: command not found: agent-pilot` hoặc `'agent-pilot' is not recognized as an internal or external command`.

#### Nguyên nhân:
Thư mục chứa file nhị phân chưa được đưa vào biến môi trường `PATH` của người dùng.

#### Cách xử lý:
1. **Trên Linux / Ubuntu**:
   Bổ sung `~/.local/bin` vào tệp cấu hình shell:
   ```bash
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
   source ~/.bashrc
   ```
2. **Trên macOS**:
   Bổ sung `~/.local/bin` vào `.zshrc`:
   ```bash
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```
3. **Trên Windows (PowerShell)**:
   Thêm đường dẫn cài đặt vào biến môi trường người dùng:
   ```powershell
   $targetDir = "$env:LOCALAPPDATA\Programs\agent-pilot"
   [Environment]::SetEnvironmentVariable("Path", "$targetDir;" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")
   ```
   Khởi động lại cửa sổ PowerShell.

---

### 2.2 `spawn agent-pilot ENOENT` Trên Ứng Dụng GUI macOS (Claude Desktop / Cursor / Antigravity)

#### Dấu hiệu nhận biết:
- Ứng dụng AI báo lỗi không khởi động được MCP Server: `spawn agent-pilot ENOENT`.

#### Nguyên nhân:
Trên hệ điều hành macOS, các ứng dụng có giao diện (GUI) được mở từ Finder, Dock hoặc Spotlight **không đọc cấu hình `PATH` trong file `~/.zshrc`**. Do đó chúng chỉ chạy với biến `PATH` mặc định tối thiểu của hệ thống (`/usr/bin:/bin:/usr/sbin:/sbin`).

#### Cách xử lý:
Trong tệp cấu hình MCP (`claude_desktop_config.json`, `~/.gemini/antigravity/mcp/` hoặc Cursor Settings), hãy **khai báo đường dẫn tuyệt đối** tới file thực thi:

```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "/Users/TEN_NGUOI_DUNG/.local/bin/agent-pilot",
      "args": ["mcp"]
    }
  }
}
```

---

## 3. Lỗi Giao Thức Chrome DevTools Protocol (CDP)

### 3.1 `CDP_UNAVAILABLE: Cannot attach to this target`

#### Dấu hiệu nhận biết:
- Khi chạy lệnh kèm cờ `--via cdp`, chạy đo Lighthouse hoặc chụp V8 Heap Snapshot, terminal trả về: `Error: CDP_UNAVAILABLE: Cannot attach to this target: Another debugger is already attached`.

#### Nguyên nhân:
Trình duyệt Google Chrome chỉ cho phép **duy nhất một kết nối debugger gắn vào tab tại một thời điểm**. Nếu bạn đang mở cửa sổ Chrome DevTools (phím F12 hoặc Inspect) trên tab đó, Chrome sẽ chặn yêu cầu kết nối CDP của Agent Pilot.

#### Cách xử lý:
1. **Đóng cửa sổ F12 DevTools**: Tắt cửa sổ Developer Tools trên tab bạn đang muốn AI tương tác.
2. **Sử dụng chế độ `--via auto`**: Cho phép Agent Pilot ưu tiên thử CDP trước, nếu debugger bị chặn sẽ tự động chuyển sang sự kiện DOM giả lập mà không bị gián đoạn:
   ```bash
   agent-pilot click "#submit" --via auto --tab 12345
   ```
3. **Giới hạn tab hệ thống**: Chrome nghiêm cấm gắn debugger vào các URL nội bộ đặc biệt (như `chrome://`, `chrome-extension://` và Chrome Web Store).

---

### 3.2 Màn Hình Đen (Black Screen) Trong Môi Trường Headless / Linux

#### Dấu hiệu nhận biết:
- Ảnh chụp màn hình hoặc video quay lại hiển thị khung hình đen hoàn toàn trên máy chủ Linux headless hoặc môi trường Wayland.

#### Nguyên nhân:
Xung đột tăng tốc phần cứng (Hardware Acceleration) hoặc thiếu bộ đệm hiển thị ảo (Virtual Framebuffer).

#### Cách xử lý:
1. Chạy thông qua bộ đệm ảo `xvfb`:
   ```bash
   xvfb-run -a agent-pilot screenshot -o output.png --tab 12345
   ```
2. Thêm cờ `--disable-gpu` và `--ozone-platform=x11` vào cấu hình khởi chạy Chrome trên Linux không có màn hình vật lý.

---

## 4. Bảo Mật WebSocket & Đa Tác Nhân (Multi-Agent)

### 4.1 `403 Forbidden: Origin not allowed` Khi Bắt Tay WebSocket

#### Dấu hiệu nhận biết:
- Yêu cầu kết nối WebSocket tới cổng `58765` bị từ chối với mã lỗi `403 Forbidden`.

#### Nguyên nhân:
Cơ chế bảo vệ chống tấn công **Cross-Site WebSocket Hijacking (CSWSH)** của Agent Pilot sẽ từ chối kết nối bắt nguồn từ các website tùy ý (bao gồm cả `http://localhost` hay các trang web khác). Cầu nối chỉ chấp nhận kết nối từ extension ID hợp lệ (`chrome-extension://...`) hoặc client loopback nội bộ không gửi header Origin.

#### Cách xử lý:
- Đảm bảo kết nối được gửi từ chính tiện ích Chrome Agent Pilot.
- Nếu bạn tự viết kịch bản tự động hóa từ ngoài, hãy giao tiếp qua socket TCP tiêu chuẩn hoặc HTTP REST API, không khởi tạo WebSocket từ môi trường trình duyệt bên thứ ba.

---

## 5. Lỗi Trên Hệ Điều Hành Windows & PowerShell

### 5.1 `install.ps1 cannot be loaded because running scripts is disabled on this system`

#### Dấu hiệu nhận biết:
- Chạy `.\install.ps1` báo lỗi bảo mật chính sách PowerShell: `PSSecurityException`.

#### Nguyên nhân:
PowerShell trên Windows mặc định đặt chính sách thực thi ở mức `Restricted` (chặn chạy các tệp script `.ps1` chưa ký số).

#### Cách xử lý:
Chạy lệnh kèm cờ `ExecutionPolicy Bypass`:
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

---

### 5.2 Lỗi Cú Pháp JSON Do Dấu Gạch Chéo Ngược (`\`)

#### Dấu hiệu nhận biết:
- Tệp cấu hình MCP báo lỗi: `Invalid character in string: escape sequence`.

#### Nguyên nhân:
Đường dẫn thư mục trên Windows dùng dấu gạch chéo ngược (`\`). Trong file JSON, ký tự `\` cần phải được escape thành `\\`.

#### Cách xử lý:
Nhân đôi dấu gạch chéo ngược trong file cấu hình JSON:
```json
{
  "command": "C:\\Users\\Username\\.local\\bin\\agent-pilot.exe"
}
```
Hoặc dùng dấu gạch chéo xuôi (`/`), Windows hỗ trợ hoàn toàn bình thường:
```json
{
  "command": "C:/Users/Username/.local/bin/agent-pilot.exe"
}
```

---

## 6. Vẫn Cần Hỗ Trợ?

Nếu vấn đề của bạn chưa được giải quyết:
1. Xem log máy chủ trực tiếp:
   ```bash
   agent-pilot serve --debug
   ```
2. Xem log chạy ngầm của Chrome Extension:
   - Mở `chrome://extensions`.
   - Tìm **Agent Pilot**, nhấp vào dòng chữ **Inspect views: service worker** để xem Console log trực tiếp.
3. Tạo issue báo lỗi trên GitHub kèm log tại [GitHub Issues](https://github.com/ducconit/agent-pilot/issues/new) hoặc đọc [Hướng Dẫn Hỗ Trợ Cộng Đồng](/vi/COMMUNITY_SUPPORT).
