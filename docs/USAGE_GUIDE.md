# 📖 Sổ Tay Hướng Dẫn Sử Dụng (Agent Pilot User Guide)

Chào mừng bạn đến với **Agent Pilot**! Sổ tay này hướng dẫn chi tiết từng bước cài đặt và vận hành toàn bộ các tính năng của tiện ích mở rộng.

---

## 1. Hướng Dẫn Cài Đặt Lên Google Chrome

### Cách A: Cài Đặt Từ Bản Phát Hành ZIP (Khuyên dùng)
1. Tải bản phát hành mới nhất từ [GitHub Releases](https://github.com/ducconit/agent-pilot-extension/releases) (ví dụ `agent-pilot-v1.0.14-beta.zip`).
2. Giải nén tệp `.zip` ra một thư mục cố định trên máy tính của bạn.
3. Mở Google Chrome, truy cập: `chrome://extensions`.
4. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải màn hình.
5. Nhấp nút **Load unpacked** (Tải tiện ích đã giải nén) ở góc trên bên trái $\rightarrow$ Chọn thư mục vừa giải nén.
6. Nhấp vào biểu tượng mảnh ghép (Extensions icon) trên thanh công cụ và chọn **Ghim (Pin)** biểu tượng **Agent Pilot (📌)**.

### Cách B: Cài Đặt Từ Mã Nguồn (Source Code)
1. Clone mã nguồn từ GitHub:
   ```bash
   git clone https://github.com/ducconit/agent-pilot-extension.git
   ```
2. Vào `chrome://extensions`, bật **Developer mode**, nhấn **Load unpacked** và chọn thư mục:
   ```
   /path/to/agent-pilot-extension/extensions
   ```

---

## 2. Khởi Động Bảng Điều Khiển (Side Panel)

Bạn có thể dễ dàng mở trung tâm điều khiển Side Panel bằng 2 cách trực quan:
1. **Cách 1 (Nhanh & thuận tiện nhất)**: Nhấp chuột trực tiếp vào biểu tượng **Agent Pilot (📌)** đã ghim trên thanh công cụ Chrome. Bảng điều khiển sẽ trượt mở tức thì bên phải.
2. **Cách 2 (Menu chuột phải)**: Nhấp chuột phải vào bất kỳ vị trí nào trên trang web $\rightarrow$ Chọn **Mở Agent Pilot (Side Panel)**.

> 💡 **Cấu hình phím tắt (Tùy chọn)**: Để tránh hoàn toàn xung đột với các phím tắt hệ điều hành hoặc trình quản lý cửa sổ (như rofi, i3wm), tiện ích không gán phím tắt mặc định. Nếu bạn muốn gán phím tắt riêng:
> - Mở tab mới và nhập: `chrome://extensions/shortcuts`
> - Tìm dòng **Agent Pilot** và tự do nhập tổ hợp phím bạn yêu thích!

---

## 3. Hướng Dẫn Chi Tiết Các Tính Năng

### 3.1 Điều Khiển Thanh Điều Hướng & Trang Hướng Dẫn
- **Đi tới địa chỉ mới**: Nhập URL vào ô địa chỉ trên thanh công cụ của Side Panel (ví dụ: `google.com` hoặc `localhost:3000`) và nhấn **Enter** hoặc nhấp **Đi tới**.
- **Mở trang Thông tin & Hướng dẫn sử dụng**: Nhấp vào biểu tượng 📖 trên thanh Header:
  - Nếu trang hướng dẫn chưa mở: Extension tự động mở một tab mới và focus vào tab đó.
  - Nếu tab hướng dẫn đang mở: Tự động chuyển focus về tab đó và đưa cửa sổ trình duyệt lên trên cùng (chống mở trùng lặp).
- **Gắn kết nối CDP**: Nhấp nút **Gắn CDP** ở góc trên bên phải để chủ động kết nối Chrome DevTools Protocol khi cần.

---

### 3.2 Giám Sát Hoạt Động AI Agent Thời Gian Thực
Chuyển sang tab **🤖 AI Agent** trên Side Panel:
- **Tự động hóa hoàn toàn bởi AI Agent**: Toàn bộ các thao tác di chuyển chuột ảo, click tạo sóng ripple, tự động điền văn bản và cuộn trang đều do AI Agent (Antigravity) điều khiển tự động thông qua giao thức MCP (cổng `58765`).
- **Lớp lọc bảo vệ Secret & Private Key**:
  - Mặc định **Bật**: Tự động nhận diện và che giấu bằng các dấu sao `*` đối với Private Key (RSA, EC, OpenSSH), API Keys (OpenAI, Gemini, Claude, AWS, GitHub, Stripe, Slack...), JWT và query secrets trước khi gửi cho AI Agent. Kèm thông báo bảo mật rõ ràng để Agent không nhầm lẫn giá trị che giấu.
  - Hover vào icon **`?`** để xem nhanh mô tả bảo vệ.
  - Khi người dùng gạt tắt công tắc, hộp thoại cảnh báo bảo mật sẽ xuất hiện yêu cầu xác nhận rủi ro nhà cung cấp mô hình LLM có thể thu thập thông tin.
- **Nhật ký Lệnh Thời gian thực (Live Action Stream)**: Hiển thị thời gian thực luồng lệnh Agent gửi đến (`moveMouse`, `click`, `type`, `run_actions`...) kèm nút sao chép toàn bộ nhật ký (📋) và nút xóa nhật ký (🗑️).
- **Chỉ Báo Hoạt Động Tinh Tế (Subtle Indicator)**: Khi AI Agent thao tác, trang web hiển thị viền neon phát sáng nhẹ nhàng và tạm thời khóa chuột/bàn phím để tránh xung đột thao tác, không hiển thị thanh trạng thái nổi hay làm mờ trang web cản trở tầm nhìn của người dùng.
- **Tự kiểm tra hệ thống (Self-Test)**: Nhấp nút **🧪 Tự kiểm tra hệ thống** để kiểm tra tự động 3 bước:
  1. Quyền truy cập tab web hiện tại.
  2. Khả năng nạp Content Script và kích hoạt API Chuột ảo.
  3. Trạng thái kết nối Máy chủ Bridge (Port 58765).

---

### 3.3 Trợ Thủ DevTools Toàn Diện Cho AI Agent (CDP Engine)
Thay vì làm rối giao diện Side Panel, khả năng DevTools được chuyển giao toàn diện thành siêu năng lực cho AI Agent:
- AI Agent có thể truy xuất logs `console.log/warn/error`, các truy vấn mạng `Network traffic`, hoặc đọc dung lượng RAM `Performance metrics` (JS Heap used/total, số lượng DOM nodes, recalculate styles) thông qua công cụ MCP `browser_get_devtools_data` hoặc gom cụm trong `browser_run_actions`.
- Khi Agent yêu cầu dữ liệu DevTools, Extension tự động kích hoạt CDP và trả về cấu trúc dữ liệu đã được làm sạch và lọc bảo mật.

---

### 3.4 Soi Phần Tử & Kiểu Dáng CSS (DOM Inspector Studio)
Chuyển sang tab **🎯 Inspector & Màu**:
1. Nhấp nút **Bật Soi Phần tử**: Di chuyển con trỏ chuột thật qua trang web, khung bao sáng màu cyan tự động bắt dính vào từng phần tử kèm thẻ thông số hiển thị Tag name, kích thước `W x H`.
2. **Click để chọn phần tử**: Ngay khi bạn click chọn phần tử, chế độ soi sẽ **tự động tắt ngay lập tức** để trả lại trạng thái tương tác tự nhiên cho trang web.
3. Bảng điều khiển Side Panel chia làm 2 thẻ phụ (Subtabs) trực quan:
   - **📌 Tổng quan**: Hiển thị Tag Name, Tọa độ `X, Y`, Kích thước `W × H`, chuỗi **CSS Selector**, biểu thức **XPath**, Nội dung (Text) và Giá trị (Value). Nhấp vào bất kỳ dòng nào để sao chép nhanh hoặc bấm **📋 Copy Tất cả** để trích xuất toàn bộ metadata.
   - **🎨 Kiểu dáng CSS**: Hiển thị toàn bộ thông số CSS tính toán (Computed CSS) mà phần tử đang chịu (Typography, Layout, Dimensions, Spacing, Visuals, Flexbox, Grid...), tích hợp thanh tìm kiếm CSS thời gian thực và nút **Sao chép tất cả CSS**.

---

### 3.5 Kính Lúp Phóng Đại Lấy Mã Màu (Eyedropper)
1. Nhấp nút **🎨 Lấy mã màu** trên Side Panel hoặc Popup.
2. Một **vùng kính lúp phóng đại 11x11 pixel** cực nét sẽ xuất hiện và bám theo đầu con trỏ chuột, hiển thị rõ ràng từng điểm ảnh cùng tâm ngắm kép và bảng mã màu trực tiếp quanh chuột.
3. Nhấp chuột trái vào điểm màu bạn chọn:
   - Hỗ trợ đầy đủ **5 chuẩn mã màu hiện đại**: `HEX`, `RGB`, `RGBA`, `HSL`, `OKLCH`.
   - **Sao chép 1 chạm (1-Click Copy)**: Nhấp vào bất kỳ dòng mã màu nào hoặc biểu tượng 📋 để sao chép ngay giá trị mong muốn kèm Toast thông báo.
   - Tự động sao chép mã **HEX** mặc định vào clipboard và lưu vào khay dải màu lịch sử (Palette History Chips). Nhấp vào bất kỳ chip màu nào để xem lại cả 5 format và sao chép.
   - Chế độ lấy mã màu **tự động tắt ngay lập tức** (hoặc nhấn phím `Esc` để hủy bất kỳ lúc nào).

---

### 3.7 Bộ Công Cụ Chụp Màn Hình (Screenshot Studio)
Chuyển sang tab **📸 Chụp ảnh**:
- **🖥️ Chụp Toàn màn hình**: Chụp lại toàn bộ khung nhìn hiển thị hiện tại của tab.
- **✂️ Kéo chọn vùng (Crop)**: Trang web sẽ mờ đi kèm con trỏ dấu cộng; bạn chỉ cần giữ chuột trái và kéo một khung chữ nhật quanh khu vực cần chụp -> Nhấp **✓ Chụp vùng này**.
- **🎯 Chụp phần tử**: Di chuột trực tiếp trên trang web để chọn phần tử muốn chụp (viền tím và tooltip hướng dẫn). Khi click chọn phần tử, hệ thống sẽ tự động chụp khung viền của phần tử đó và tự động tắt ngay chế độ chọn (có thể nhấn Esc để hủy).
- **📋 Tự động sao chép vào Clipboard (Switch)**: Khi bật tùy chọn này, bất kỳ thao tác chụp nào (toàn màn hình, kéo vùng crop hay chụp phần tử) sẽ tự động sao chép ngay ảnh kết quả vào bộ nhớ tạm (clipboard) của hệ thống mà không cần nhấp thêm nút Sao chép.
- Sau khi chụp, ảnh xem trước sẽ hiển thị ngay trong Side Panel kèm kích thước pixel thực tế, nút **💾 Tải về PNG** và nút **📋 Sao chép** vào clipboard.

---

### 3.8 Hệ Thống Chú Thích & Chỉ Điểm UI Cho Agent (Feedback Studio)
Chuyển sang tab **✏️ Chú thích UI** trên Side Panel hoặc nhấp nút Feedback Studio nổi trên trang:

#### 4 Chế Độ Thu Thập Phản Hồi Trực Quan:
1. **🎯 Chọn phần tử (Element Mode)**:
   - Rà chuột highlight phần tử trên trang web $\rightarrow$ Bấm chuột để chọn.
   - Hệ thống tự động cắt ảnh phần tử và bóc tách tệp nguồn framework (`fileName:lineNumber` của React Fiber `_debugSource`, Vue Component `__file`, hoặc Astro).
2. **✂️ Kéo chọn vùng (Region Crop Mode)**:
   - Giữ và kéo chuột trái để tạo khung chọn vùng lỗi trên trang web.
   - Khi buông chuột, khung chọn số hóa dạng ghim `#1`, `#2`... với màu sắc xoay vòng sẽ được cố định ngay trên trang để chống chọn trùng lặp.
   - Hộp thoại nhập ghi chú nhanh sẽ trượt mở ngay bên cạnh khung chọn.
3. **📱 Màn hình hiện tại (Screen Viewport Mode)**:
   - Chụp lại toàn bộ khung nhìn hiển thị hiện tại.
   - Mở modal Annotator cho phép cắm cờ ghim (📍 Pin) hoặc kéo khung chữ nhật (⬜ Khung) để chú thích nhiều lỗi trên cùng 1 ảnh.
4. **📄 Toàn bộ trang web (Full Page Mode)**:
   - Tự động cuộn trang theo từng bước và ghép trọn vẹn toàn bộ trang web dài từ đầu đến chân trang.

#### Quản Lý & Chỉnh Sửa Chú Thích:
- **Chỉnh sửa ghi chú**: Nhấp vào nút ✏️ trên thẻ Side Panel hoặc nhấp vào badge `#N` trên khung ghim in-page để mở popover sửa ghi chú.
- **Xóa ghi chú / khung ghim**: Nhấp vào nút ✕ trên khung ghim hoặc nút 🗑️ trên thẻ Side Panel. Các số thứ tự còn lại sẽ tự động căn chỉnh lại.
- **Đồng bộ thời gian thực hai chiều**: Mọi thao tác thêm, sửa, xóa trên trang web hay trên Side Panel đều được đồng bộ tức thì.

#### 3 Kênh Xuất Phản Hồi Độc Lập:
1. **🚀 Kênh A (Live Push Long-Polling)**: Bấm **"🚀 Gửi Agent"** $\rightarrow$ Dữ liệu phản hồi gửi thẳng tới AI Agent đang gọi công cụ `browser_wait_for_feedback()` trong thời gian thực.
2. **💾 Kênh B (Hộp Thư Persistent Inbox)**: Bấm **"💾 Lưu Inbox"** $\rightarrow$ Lưu toàn bộ phiên phản hồi vào thư mục `~/.agent-pilot/inbox/feedback/<timestamp>/` (gồm `session.json`, `prompt.md`, `item_*.png`). AI Agent có thể truy vấn mọi lúc bằng `browser_get_pending_feedback()`.
3. **📋 Kênh C (1-Click Clipboard Prompt)**: Bấm **"📋 Copy Prompt"** $\rightarrow$ Xuất ra prompt Markdown đầy đủ thông số và cấu trúc sẵn sàng dán vào khung chat của bất kỳ mô hình LLM nào.

---

## 4. Bộ Công Cụ Dòng Lệnh Độc Lập Go CLI & MCP Server (`agent-pilot`)

Bản binary độc lập viết bằng **Golang** loại bỏ hoàn toàn sự phụ thuộc vào môi trường Node.js / npm, đóng gói sẵn bridge server, stdio MCP server và bộ lệnh CLI:

### 4.1. Cài Đặt Binary Go CLI
- **Tải binary dựng sẵn từ GitHub Releases**:
  - Linux x86_64: `agent-pilot-linux-amd64`
  - Linux ARM64: `agent-pilot-linux-arm64`
  - macOS Apple Silicon: `agent-pilot-darwin-arm64`
  - macOS Intel: `agent-pilot-darwin-amd64`
  - Windows: `agent-pilot-windows-amd64.exe` hoặc `agent-pilot-windows-arm64.exe`
- Đặt tên binary thành `agent-pilot` và di chuyển vào thư mục `/usr/local/bin/` (trên Linux/macOS) hoặc thêm vào biến môi trường `PATH` (trên Windows).

### 4.2. Quản Lý Service Chạy Ngầm Tự Động (Background Service)
Thay vì phải tự chạy lệnh `agent-pilot server` thủ công, bạn có thể cài đặt và quản lý service chạy ngầm đa nền tảng chỉ bằng 1 lệnh:

```bash
# Cài đặt và kích hoạt service tự chạy khi khởi động máy:
agent-pilot service install

# Kiểm tra trạng thái hoạt động:
agent-pilot service status

# Khởi động lại service:
agent-pilot service restart

# Dừng service:
agent-pilot service stop

# Gỡ bỏ service khỏi máy:
agent-pilot service uninstall
```

**Cơ chế nền tảng tự động nhận diện:**
- **Linux**: Tự động tạo và kích hoạt `systemd --user` tại `~/.config/systemd/user/agent-pilot.service` (hoạt động ở User Mode, không cần quyền `sudo`).
- **macOS**: Tự động nạp LaunchAgent tại `~/Library/LaunchAgents/com.agentpilot.bridge.plist`.
- **Windows**: Tự động đăng ký Windows Task Scheduler (`AgentPilotBridge`) chạy ngầm không hiển thị cửa sổ console.

### 4.3. Cấu Hình Làm Máy Chủ MCP (`stdio`) Cho AI Coding Assistant
Thêm vào file cấu hình MCP của Antigravity, Claude Desktop, hoặc Cursor:
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

### 4.4. Bộ Lệnh Dành Cho Tester / Kỹ Sư QC Tự Động Hóa
Kỹ sư kiểm thử tự động có thể điều khiển Chrome trực tiếp qua terminal:
```bash
# Mở một địa chỉ web
agent-pilot open "https://example.com" --active

# Gõ văn bản vào form và nhấn Enter
agent-pilot type "#search-box" "laptop gaming" --enter

# Click chuột ảo vào phần tử
agent-pilot click ".btn-search"

# Soi thông số phần tử DOM
agent-pilot inspect "#product-price"

# Chụp ảnh màn hình lưu ra tệp PNG
agent-pilot screenshot -o search_results.png --mode visible

# Xem danh sách các tab đang mở
agent-pilot tabs

# Chạy một kịch bản Batch Automation hoàn chỉnh từ file JSON
agent-pilot batch flow_test.json

# Xem danh sách các phiên phản hồi UI
agent-pilot feedback list
```

#### Điều khiển Cross-Origin Iframe / Canvas / Game bằng CDP (tùy chọn)

Mặc định `click`/`drag` dùng synthetic DOM event (nhanh, có con trỏ neon). Khi cần điều khiển **iframe khác origin, `<canvas>`, WebGL/Unity game**, hãy bật engine CDP trusted:

```bash
# Kiểm tra debugger có gắn được không (DevTools đang mở trên tab sẽ chặn)
agent-pilot cdp status --tab 12345

# Click trusted theo tọa độ (mặc định vẫn là synthetic nếu không có --via)
agent-pilot click -x 733 -y 668 --via cdp --tab 12345

# Kéo slingshot trong game: kéo từ điểm A tới B, giữ 800ms rồi thả
agent-pilot drag --from-x 745 --from-y 490 --to-x 745 --to-y 832 --steps 10 --hold 800 --via cdp --tab 12345

# Chế độ an toàn: thử CDP trước, tự fallback synthetic nếu debugger bị chặn
agent-pilot click "#play-button" --via auto --tab 12345
```

- `--via cdp` **không fallback âm thầm**: nếu gắn debugger thất bại sẽ báo lỗi `CDP_UNAVAILABLE` kèm gợi ý.
- `--via auto` phù hợp khi muốn chạy được trên cả trang DOM thường lẫn iframe/canvas.
- Các lệnh `upload`, `dialog`, `emulate`, `resize`, `network`, `trace`, `metrics`, `heap` và screenshot tab ngầm **bắt buộc CDP** — xem `skills/agent-pilot/references/cli-usage.md` §1.1.

#### Cấu Trúc File Batch Automation JSON (`flow_test.json`):
```json
[
  { "action": "open", "url": "https://google.com", "active": true },
  { "action": "wait", "ms": 1000 },
  { "action": "type", "selector": "textarea[name='q']", "text": "Agent Pilot Golang", "pressEnter": true },
  { "action": "wait", "ms": 2000 },
  { "action": "screenshot", "label": "google_search_results" }
]
```

---

### 4.5. Hướng Dẫn Chạy Đa AI Agent Đồng Thời (Multi-Agent Concurrency)

Khi bạn mở đồng thời nhiều AI Agent (ví dụ: Antigravity IDE, Codex, Claude Code, Antigravity CLI) để làm nhiều tác vụ song song:
1. **Bật Service Chạy Ngầm**: Chạy `agent-pilot service install`. Cổng 58765 sẽ luôn sẵn sàng. Nhờ cơ chế **Dual Mode**, mọi AI Agent gửi lệnh qua HTTP REST Gateway tới Master Bridge mà **hoàn toàn không bị xung đột cổng mạng (EADDRINUSE)**.
2. **Quy Tắc Chỉ Định `tabId`**: Khi Agent mở một tab web mới qua `browser_open_tab(url)`, extension sẽ trả về mã định danh `tabId` (ví dụ: `1546114498`). Hãy đảm bảo các bước tiếp theo (`browser_click`, `browser_type`, `browser_screenshot`, `browser_run_actions`) luôn truyền tham số `tabId` đó. Điều này giúp mỗi Agent hoàn toàn làm việc độc lập trên tab riêng của mình mà không tranh chấp tiêu điểm (focus) với nhau.
3. **Thao Tác Ngầm Không Tranh Chấp Focus**: Các tab do Agent quản lý mặc định mở ngầm (`active: false`) và tự động gom vào nhóm `🤖 Agent Pilot`. Tính năng chụp ảnh ngầm qua CDP Surface Capture cho phép chụp ảnh chính xác mà không cướp màn hình làm việc của bạn.

---

## 5. Tích Hợp Kỹ Năng Cho Trợ Lý Lập Trình (Agent Skills)

Agent Pilot tuân thủ chuẩn mở **Agent Skills Open Ecosystem** ([skills.sh](https://skills.sh/)). Mọi trợ lý AI coding (như Claude Code, Cursor, Codex, OpenCode, Antigravity, Amp, Roo, Devin,...) đều có thể tự động cài đặt kỹ năng điều khiển trình duyệt chỉ với 1 lệnh:

```bash
# Cài đặt cho dự án hiện tại
npx skills add https://github.com/ducconit/agent-pilot-extension

# Cài đặt toàn cục (Global) cho mọi trợ lý trên máy
npx skills add https://github.com/ducconit/agent-pilot-extension -g --all
```
