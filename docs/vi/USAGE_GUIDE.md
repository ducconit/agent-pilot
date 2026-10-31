# 📖 Sổ Tay Hướng Dẫn Sử Dụng (Agent Pilot User Guide)

Chào mừng bạn đến với **Agent Pilot**! Dự án ban đầu được xây dựng phục vụ nhu cầu cá nhân nhằm **thay thế Chrome MCP mặc định trên Google Antigravity**, đồng thời loại bỏ việc **AI Agent phải tự sinh code Python để thao tác trình duyệt hoặc vẽ chữ lên hình ảnh** trong quá trình kiểm thử web. Sổ tay này hướng dẫn chi tiết từng bước cài đặt và vận hành toàn bộ các tính năng của công cụ.

::: warning ⚠️ Cảnh Báo: Dự Án 100% Vibe Coding & Miễn Trừ Trách Nhiệm
**Agent Pilot là dự án thử nghiệm mã nguồn mở được phát triển 100% bằng hình thức "Vibe Coding" với Google Antigravity.**
Toàn bộ kiến trúc, mã nguồn Go CLI, script Chrome Extension MV3 và MCP Server đều do AI coding agent tự động sinh mã thông qua prompt engineering. Dù đã có hệ thống kiểm thử tự động và bộ lọc che giấu secret 29 quy tắc, vui lòng lưu ý:
- **Thử nghiệm trên Sandbox**: Luôn chạy thử nghiệm các tác vụ AI tự động trên profile Chrome riêng biệt (`--user-data-dir`) hoặc môi trường non-production.
- **Miễn trừ trách nhiệm**: Tác giả, cộng tác viên và đội ngũ bảo trì không chịu bất kỳ trách nhiệm pháp lý nào đối với các sự cố mất mát dữ liệu, phí dịch vụ phát sinh ngoài ý muốn hay hư hại hệ thống do AI Agent gây ra khi dùng Agent Pilot.
:::

---

## 1. Cài Đặt & Thiết Lập Môi Trường

Agent Pilot cung cấp 3 phương thức cài đặt tùy theo nhu cầu và đối tượng sử dụng:

### Cách A: Cài Đặt Qua Bộ Cài Theo Hệ Điều Hành (Khuyến Nghị)

Đây là **phương pháp được khuyến nghị hàng đầu** cho người dùng hàng ngày và kỹ sư QA/QC. Mỗi gói phát hành được đóng gói tối ưu riêng cho từng hệ điều hành, chỉ chứa file nhị phân duy nhất cho OS đó, thư mục tiện ích Chrome và script cài đặt tự động 1 bước:

| Hệ Điều Hành | Gói Cài Đặt | Lệnh Cài Đặt Tự Động | Hướng Dẫn Chi Tiết |
| :--- | :--- | :--- | :--- |
| 🐧 **Linux / Ubuntu** | `agent-pilot-*-linux.zip` | `./install.sh` | [Xem hướng dẫn Linux](/vi/bundles/README.ubuntu) |
| 🍎 **macOS** | `agent-pilot-*-macos.zip` | `./install.sh` | [Xem hướng dẫn macOS](/vi/bundles/README.macos) |
| 🪟 **Windows** | `agent-pilot-*-windows.zip` | `powershell -ExecutionPolicy Bypass -File .\install.ps1` | [Xem hướng dẫn Windows](/vi/bundles/README.windows) |

1. Tải bản phát hành mới nhất phù hợp với hệ điều hành từ [GitHub Releases](https://github.com/ducconit/agent-pilot/releases).
2. Giải nén tệp `.zip` ra một thư mục cố định trên máy tính của bạn.
3. Chạy script cài đặt (`./install.sh` trên Linux/macOS hoặc `powershell -ExecutionPolicy Bypass -File .\install.ps1` trên Windows). Script sẽ tự động đưa CLI vào biến môi trường `PATH` và đăng ký dịch vụ chạy ngầm tự khởi động cùng máy (`systemd` / `launchd` / Windows service).
4. Mở Google Chrome, truy cập: `chrome://extensions`.
5. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải màn hình.
6. Nhấp nút **Load unpacked** (Tải tiện ích đã giải nén) ở góc trên bên trái → Chọn thư mục `extensions/` từ gói vừa giải nén.
7. Nhấp vào biểu tượng mảnh ghép (Extensions icon) trên thanh công cụ và chọn **Ghim (📌)** biểu tượng **Agent Pilot**.

### Cách B: Cài Đặt Nhanh Cho AI Agent (`npx skills add`)

Nếu bạn muốn trang bị nhanh kỹ năng điều khiển trình duyệt cho trợ lý AI coding (Claude Code, Cursor, Windsurf, Antigravity, OpenCode, Codex, Roo Code, v.v.) mà không cần tải file zip thủ công:

```bash
# Cài đặt toàn cục (Global) cho mọi trợ lý trên máy
npx skills add https://github.com/ducconit/agent-pilot -g --all

# Hoặc cài đặt riêng cho dự án hiện tại
npx skills add https://github.com/ducconit/agent-pilot
```

> 💡 **Lưu ý về phương án cài nhanh**: Phương thức này được thiết kế để **bootstrap nhanh cho AI Agent**. Vì cần hỗ trợ mọi loại máy trạm tức thì, gói kỹ năng này chứa sẵn các file nhị phân biên dịch cho **cả 3 hệ điều hành** (Linux `agent-pilot`, macOS `agent-pilot`, Windows `agent-pilot.exe`) nằm trong thư mục `skills/agent-pilot/scripts/`. Để cài đặt tinh gọn dung lượng và tích hợp dịch vụ nền theo chuẩn hệ điều hành, hãy ưu tiên **Cách A (Bộ cài theo hệ điều hành)**.

Để nạp tiện ích vào Chrome, nạp thư mục `extensions/` từ gói skill vừa cài đặt hoặc tải về qua `chrome://extensions` (Load unpacked).

### Cách C: Tự Biên Dịch & Cài Đặt Từ Mã Nguồn (Dành Cho Nhà Phát Triển)

Dành cho lập trình viên muốn chỉnh sửa mã nguồn Go CLI, kiểm thử hoặc phát triển tính năng cho tiện ích mở rộng Chrome:

1. Clone mã nguồn từ GitHub:
   ```bash
   git clone https://github.com/ducconit/agent-pilot.git
   cd agent-pilot
   ```
2. Biên dịch file nhị phân Go CLI:
   ```bash
   go build -o bin/agent-pilot ./cli/cmd/agent-pilot
   ```
3. Cài đặt và kiểm tra dịch vụ chạy ngầm:
   ```bash
   ./bin/agent-pilot service install
   ./bin/agent-pilot service status
   ```
4. Vào `chrome://extensions`, bật **Developer mode**, nhấn **Load unpacked** và chọn thư mục:
   ```
   /đường/dẫn/tới/agent-pilot/extensions
   ```

---

## 2. Khởi Động Bảng Điều Khiển (Side Panel)

Bạn có thể dễ dàng mở trung tâm điều khiển Side Panel bằng 2 cách trực quan:
1. **Cách 1 (Nhanh & thuận tiện nhất)**: Nhấp chuột trực tiếp vào biểu tượng **Agent Pilot (📌)** đã ghim trên thanh công cụ Chrome. Bảng điều khiển sẽ trượt mở tức thì bên phải.
2. **Cách 2 (Menu chuột phải)**: Nhấp chuột phải vào bất kỳ vị trí nào trên trang web → Chọn **Mở Agent Pilot (Side Panel)**.

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
   - Rà chuột highlight phần tử trên trang web → Bấm chuột để chọn.
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
1. **🚀 Kênh A (Live Push Long-Polling)**: Bấm **"🚀 Gửi Agent"** → Dữ liệu phản hồi gửi thẳng tới AI Agent đang gọi công cụ `browser_wait_for_feedback()` trong thời gian thực.
2. **💾 Kênh B (Hộp Thư Persistent Inbox)**: Bấm **"💾 Lưu Inbox"** → Lưu toàn bộ phiên phản hồi vào thư mục `~/.agent-pilot/inbox/feedback/<timestamp>/` (gồm `session.json`, `prompt.md`, `item_*.png`). AI Agent có thể truy vấn mọi lúc bằng `browser_get_pending_feedback()`.
3. **📋 Kênh C (1-Click Clipboard Prompt)**: Bấm **"📋 Copy Prompt"** → Xuất ra prompt Markdown đầy đủ thông số và cấu trúc sẵn sàng dán vào khung chat của bất kỳ mô hình LLM nào.

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

Kỹ sư kiểm thử tự động và AI Agent có thể điều khiển Chrome trực tiếp qua terminal thông qua file nhị phân độc lập `agent-pilot`. Dưới đây là bảng tra cứu đầy đủ phân loại theo nhóm lệnh, ví dụ chi tiết, cờ tối ưu Inline Wait Flags, điều khiển CDP và cấu trúc kịch bản Batch JSON.

#### 4.4.1. Bảng Tra Cứu Toàn Bộ Lệnh CLI

##### Nhóm 1: Thao Tác Tương Tác Trang Web (17 Lệnh)

| Lệnh | Cú pháp | Mô tả chi tiết | Cần CDP? |
| :--- | :--- | :--- | :--- |
| `open` | `agent-pilot open <url>` | Mở URL trong tab chạy ngầm thuộc nhóm `🤖 Agent Pilot` (hoặc điều hướng tab mục tiêu với `--tab`) | ❌ Không |
| `navigate` | `agent-pilot navigate <url\|back\|forward\|reload>` | Điều hướng tab với lịch sử back/forward, bỏ qua cache, nạp script ban đầu hoặc xử lý beforeunload | ❌ Không |
| `click` | `agent-pilot click <selector>` | Click chuột ảo hoặc theo tọa độ (`--x`, `--y`); hỗ trợ `--dblclick`, `--button` và `--via cdp` | ⚙️ Tùy chọn (`--via cdp`) |
| `type` | `agent-pilot type <selector> <text>` | Gõ văn bản mô phỏng người dùng; hỗ trợ `--clear` trước khi gõ và `--enter` sau khi gõ | ❌ Không |
| `fill` | `agent-pilot fill <fields.json>` | Điền toàn bộ các trường của form và tự động submit chỉ trong 1 thao tác duy nhất | ❌ Không |
| `scroll` | `agent-pilot scroll [down\|up\|left\|right\|dx dy]` | Cuộn trang hoặc phần tử theo hướng (`down`, `up`, `right`, `left`) hoặc khoảng cách pixel (`--dx`, `--dy`) | ❌ Không |
| `hover` | `agent-pilot hover <selector>` | Di chuột ảo vào phần tử DOM để kích hoạt hiệu ứng CSS `:hover` và popup tooltip | ❌ Không |
| `drag` | `agent-pilot drag <from> <to>` | Kéo thả phần tử hoặc tọa độ (`--from-x`, `--from-y`, `--to-x`, `--to-y`); hỗ trợ `--hold` và `--via cdp` | ⚙️ Tùy chọn (`--via cdp`) |
| `key` | `agent-pilot key <key1> [key2...]` | Gửi phím đơn, tổ hợp phím tắt (`Ctrl+A`, `Ctrl+V`), hoặc chuỗi phím (`--delay`, `--repeat`) | ❌ Không |
| `wait` | `agent-pilot wait [selector\|text\|ms]` | Chờ selector, đoạn text, trạng thái (`visible`, `attached`), hoặc sleep số mili-giây cố định | ❌ Không |
| `upload` | `agent-pilot upload <selector> <files...>` | Tải file từ máy lên ô input file qua CDP hoặc cơ chế fallback synthetic `DataTransfer` | ⚙️ Tùy chọn (`--via auto`) |
| `dialog` | `agent-pilot dialog <accept\|dismiss>` | Tự động xử lý các hộp thoại JavaScript (`alert`, `confirm`, `prompt`) kèm nội dung phản hồi | ✅ Có |
| `inspect` | `agent-pilot inspect <selector>` | Soi tọa độ khung bao (rect), CSS selector, XPath, text và thuộc tính CSS tính toán (`--styles`) | ❌ Không |
| `snapshot` | `agent-pilot snapshot` | Trích xuất bản đồ tương tác siêu nhẹ (`@1`, `@2`...) tối ưu cho context window của LLM | ❌ Không |
| `screenshot` | `agent-pilot screenshot` | Chụp ảnh màn hình độ nét cao kèm chú thích (`--highlight`, `--step`, `--title`, `--arrow`, `--badge`) | ✅ Có (tab ngầm) |
| `close` | `agent-pilot close [ids...\|--all]` | Đóng tab hiện tại, danh sách tab ID chỉ định hoặc toàn bộ tab trong nhóm `🤖 Agent Pilot` | ❌ Không |
| `tabs` | `agent-pilot tabs` | Liệt kê danh sách tất cả các tab đang mở trong nhóm `🤖 Agent Pilot` (Alias: `list`, `ls`) | ❌ Không |

##### Nhóm 2: Đánh Giá & Bộ Công Cụ DevTools (11 Lệnh)

| Lệnh | Cú pháp | Mô tả chi tiết | Cần CDP? |
| :--- | :--- | :--- | :--- |
| `eval` / `evaluate` | `agent-pilot eval <script>` | Thực thi JavaScript trong ngữ cảnh trang (`MAIN` world, truy cập `window` và state React/Vue) | ❌ Không (fallback CDP) |
| `console` | `agent-pilot console [list\|errors\|clear]` | Xem danh sách log console, cảnh báo hoặc các ngoại lệ runtime của trang (`errors`) | ✅ Có |
| `network` | `agent-pilot network [list\|get <id>\|clear]` | Theo dõi HTTP requests/responses, lọc theo URL/loại tài nguyên/lần tải trang, xem body | ✅ Có |
| `metrics` | `agent-pilot metrics` | Thu thập chỉ số chuyên sâu Core Web Vitals (LCP, CLS, FCP, TTFB, TBT), DOM health và Heap | ✅ Có |
| `trace` | `agent-pilot trace <start\|stop>` | Ghi timeline hiệu năng DevTools, phát hiện Long Tasks (>=50ms), layout reflows và bottleneck | ✅ Có |
| `heap` | `agent-pilot heap [snapshot\|baseline\|diff\|gc]` | Chụp V8 Heap Snapshot, phân tích rò rỉ bộ nhớ (Memory Leak) hoặc kích hoạt dọn rác GC | ✅ Có |
| `resize` | `agent-pilot resize <width> <height>` | Thay đổi kích thước khung nhìn viewport phục vụ kiểm thử giao diện responsive | ✅ Có |
| `emulate` | `agent-pilot emulate` | Giả lập giới hạn băng thông mạng (`slow-3g`, `offline`), bóp CPU (throttling), giao diện sáng/tối | ✅ Có |
| `webauthn` | `agent-pilot webauthn <action>` | Quản lý thiết bị xác thực ảo WebAuthn và Passkey phục vụ kiểm thử đăng nhập không mật khẩu | ✅ Có |
| `extensions` | `agent-pilot extensions [list\|toggle]` | Quản lý, xem danh sách và bật/tắt các tiện ích mở rộng Extension trên trình duyệt | ✅ Có |
| `cdp` | `agent-pilot cdp status` | Kiểm tra trạng thái gắn kết debugger CDP trước khi thực thi các thao tác mức thấp | ✅ Có |

##### Nhóm 3: Quản Lý Phiên, Bảo Vệ & Tự Động Hóa (6 Lệnh)

| Lệnh | Cú pháp | Mô tả chi tiết | Cần CDP? |
| :--- | :--- | :--- | :--- |
| `session` | `agent-pilot session [start\|end\|status]` | Duy trì phiên làm việc liên tục, giữ con trỏ neon và viền bảo vệ hiển thị xuyên suốt | ❌ Không |
| `busy` | `agent-pilot busy [on\|off]` | Bật/tắt nhanh lớp chắn khóa tương tác người dùng kèm thông báo trạng thái Agent | ❌ Không |
| `service` | `agent-pilot service <action>` | Quản lý daemon chạy ngầm hệ điều hành (`install`, `uninstall`, `start`, `stop`, `restart`, `status`) | ❌ Không |
| `skill` | `agent-pilot skill install` | Cài đặt skill `agent-pilot` tích hợp sẵn vào thư mục agent skills (`--agy`, `--path`) | ❌ Không |
| `batch` | `agent-pilot batch <flow.json>` | Thực thi chuỗi hành động kiểm thử tự động trong 1 lượt gửi mạng duy nhất | ❌ Không (tùy bước) |
| `recorder` | `agent-pilot recorder <operation>` | Ghi nhận, phát lại, đo lường và xuất/nhập kịch bản DevTools Recorder chuẩn | ❌ Không (tùy bước) |

---

#### 4.4.2. Ví Dụ Thực Tế Cho Từng Nhóm Lệnh

```bash
# === 1. THAO TÁC TRÊN TRANG ===
# Mở một địa chỉ web và đưa lên tiêu điểm
agent-pilot open "https://example.com" --active

# Tải lại trang bỏ qua bộ nhớ đệm
agent-pilot navigate reload --ignore-cache --tab 12345

# Chụp cây DOM tương tác siêu nhẹ (@1, @2...)
agent-pilot snapshot --tab 12345

# Gõ văn bản vào ô tìm kiếm và nhấn Enter
agent-pilot type "#search-box" "laptop gaming" --clear --enter

# Click chuột ảo kèm hiệu ứng gợn sóng neon
agent-pilot click ".btn-search" --tab 12345

# Điền toàn bộ thông tin form và submit
agent-pilot fill form_data.json --submit "#btn-submit"

# Cuộn trang xuống 800px hoặc theo hướng
agent-pilot scroll down --tab 12345
agent-pilot scroll --dy 800 --tab 12345

# Rê chuột vào menu dropdown
agent-pilot hover ".dropdown-menu-trigger" --tab 12345

# Gửi phím tắt hoặc tổ hợp phím
agent-pilot key Ctrl+a Backspace 1 2 3 Enter --selector "#otp-input" --tab 12345

# Chờ selector xuất hiện hoặc chờ văn bản hiển thị
agent-pilot wait "#success-banner" --state visible --timeout 5000
agent-pilot wait --text "Payment Successful" --timeout 5000

# Tải file đính kèm lên ô <input type="file">
agent-pilot upload "input[type=file]" ./document.pdf --via auto --tab 12345

# Tự động đồng ý hộp thoại alert/confirm của JavaScript
agent-pilot dialog accept --tab 12345

# Soi thông số chi tiết của phần tử DOM
agent-pilot inspect "#product-price" --styles --tab 12345

# Chụp ảnh màn hình đính kèm thông tin bước test
agent-pilot screenshot -o /tmp/checkout.png --step "1/3" --title "Thanh toán" --highlight "@1" --tab 12345

# Quản lý danh sách tab
agent-pilot tabs
agent-pilot close --tab 12345

# === 2. ĐÁNH GIÁ & DEVTOOLS ===
# Chạy mã JavaScript trực tiếp trong trang (truy cập window, state React/Vue)
agent-pilot eval "document.title" --tab 12345
agent-pilot eval -f ./extract-data.js -o /tmp/extracted.json --tab 12345

# Xem lỗi runtime và log console
agent-pilot console errors --tab 12345
agent-pilot console list --level warn --limit 20 --tab 12345

# Theo dõi request mạng thuộc lần tải trang hiện tại
agent-pilot network list --current-nav --tab 12345
agent-pilot network get req_abc123 --tab 12345

# Đo lường Core Web Vitals & sức khỏe DOM
agent-pilot metrics --tab 12345

# Ghi timeline hiệu năng và phát hiện bottleneck
agent-pilot trace start --tab 12345
agent-pilot click "#compute-btn" --tab 12345
agent-pilot trace stop --tab 12345

# Phát hiện rò rỉ bộ nhớ (Memory Leak) qua V8 heap snapshot
agent-pilot heap baseline --tab -12345 --file /tmp/base.heapsnapshot
agent-pilot heap diff --tab -12345 --file /tmp/curr.heapsnapshot

# Thay đổi kích thước khung nhìn kiểm tra responsive
agent-pilot resize 375 812 --tab 12345

# Giả lập giới hạn băng thông mạng 3G và dark theme
agent-pilot emulate --network slow-3g --cpu 4x --theme dark --tab 12345

# Khởi tạo thiết bị xác thực WebAuthn / Passkey ảo
agent-pilot webauthn enable --tab 12345
agent-pilot webauthn add --protocol ctap2 --transport internal --tab 12345

# Kiểm tra trạng thái extensions
agent-pilot extensions list

# === 3. QUẢN LÝ PHIÊN, BẢO MỆ & TỰ ĐỘNG HÓA ===
# Duy trì phiên làm việc liên tục với con trỏ chuột neon
agent-pilot session start --name "Kịch bản Kiểm thử Đặt hàng" --tab 12345
agent-pilot busy on --action "Đang xử lý đơn hàng tự động..." --tab 12345
agent-pilot busy off --tab 12345
agent-pilot session end --tab 12345

# Ghi nhận và phát lại luồng thao tác Chrome DevTools Recorder
agent-pilot recorder start --title "Luồng Đăng nhập" --tab 12345
agent-pilot click "#login-button" --tab 12345
agent-pilot recorder stop --tab 12345
agent-pilot recorder export --tab 12345 --format json > flow.recorder.json
agent-pilot recorder replay --file flow.recorder.json --tab 12345

# Chạy một kịch bản Batch Automation hoàn chỉnh từ file JSON
agent-pilot batch flow_test.json
```

---

#### 4.4.3. Tính Năng Cờ Đợi Nội Dòng (Inline Wait Flags - Tiết Kiệm Token & Giảm Roundtrip)

Trong tự động hóa trình duyệt thông thường, việc thực hiện một chuỗi thao tác thường đòi hỏi 3 round-trip mạng rời rạc:
1. Gửi lệnh `click` phần tử -> chờ trình duyệt phản hồi.
2. Gửi lệnh `wait_for_selector` -> chờ selector xuất hiện.
3. Gửi lệnh `snapshot` -> chờ trả về bản đồ tương tác.

Agent Pilot cung cấp cơ chế **Inline Wait Flags**, cho phép AI Agent gộp chung điều kiện chờ và chụp snapshot trực tiếp vào lệnh tương tác (`open`, `navigate`, `click`, `type`, `fill`, `scroll`, `hover`, `drag`, `key`, `upload`) chỉ trong **1 lệnh gọi nguyên tử (atomic call)**:

| Cờ Inline Wait | Alias | Ý nghĩa & Mô tả |
| :--- | :--- | :--- |
| `--wait <ms>` | `--sleep`, `--wait-ms`, `--sleep-ms` | Chờ thêm số mili-giây sau khi hành động thực thi xong (VD: `--wait 500` hoặc `--wait 500ms`) |
| `--wait-for <selector>` | `--wait-selector` | Chờ CSS selector hoặc `@ref` mục tiêu xuất hiện/gắn vào DOM trước khi trả kết quả |
| `--wait-text <text>` | *(không có)* | Chờ đoạn văn bản chỉ định xuất hiện trên giao diện trang trước khi trả kết quả |
| `--include-snapshot` | `--snapshot` | Tự động chụp và trả về cây tương tác DOM mới nhất (`@1`, `@2`...) ngay trong phản hồi |

**Lợi ích vượt trội**:
- **Tiết kiệm ~80% Token**: Cắt giảm hoàn toàn các lượt hỏi đáp qua lại giữa Agent và Bridge Server cho các bước đợi và lấy snapshot.
- **Triệt tiêu hiện tượng Flaky**: Trình điều khiển nội tại Chrome Bridge chủ động đợi phần tử sẵn sàng trước khi kết xuất snapshot, tránh lỗi đọc giao diện khi DOM chưa render xong.

**Ví dụ thực tế**:
```bash
# Click nút gửi form, đợi màn hình dashboard xuất hiện và nhận snapshot mới nhất chỉ trong 1 lệnh duy nhất:
agent-pilot click "#btn-submit" --wait-for "#dashboard-view" --include-snapshot --tab 12345

# Nhập từ khóa tìm kiếm, ấn Enter, chờ 500ms render kết quả và trả snapshot:
agent-pilot type "#search-box" "laptop gaming" --enter --wait 500 --include-snapshot --tab 12345

# Mở URL và đợi văn bản chào mừng xuất hiện trước khi trả kết quả:
agent-pilot open "https://example.com" --wait-text "Xin chào" --include-snapshot
```

---

#### 4.4.4. Điều Khiển Cross-Origin Iframe / Canvas / Game Bằng CDP (Tùy Chọn)

Mặc định `click`/`drag` dùng synthetic DOM event (nhanh, có con trỏ neon). Khi cần điều khiển **iframe khác origin, `<canvas>`, WebGL/Unity game**, hãy bật engine CDP trusted:

```bash
# Kiểm tra debugger có gắn được không (DevTools đang mở trên tab sẽ chặn)
agent-pilot cdp status --tab 12345

# Click trusted theo tọa độ (dùng cờ chuẩn GNU/Cobra --x và --y)
agent-pilot click --x 733 --y 668 --via cdp --tab 12345

# Kéo slingshot trong game: kéo từ điểm A tới B, giữ 800ms rồi thả
agent-pilot drag --from-x 745 --from-y 490 --to-x 745 --to-y 832 --steps 10 --hold 800 --via cdp --tab 12345

# Chế độ an toàn: thử CDP trước, tự fallback synthetic nếu debugger bị chặn
agent-pilot click "#play-button" --via auto --tab 12345
```

- `--via cdp` **không fallback âm thầm**: nếu gắn debugger thất bại sẽ báo lỗi `CDP_UNAVAILABLE: <reason>` kèm gợi ý cụ thể.
- `--via auto` phù hợp khi muốn chạy mượt mà trên cả trang DOM thường lẫn iframe/canvas.
- Con trỏ neon và hiệu ứng gợn sóng chỉ do **synthetic engine** vẽ. Input qua CDP là sự kiện mức hệ thống nên sẽ không hiển thị con trỏ ảo.
- Các lệnh `upload`, `dialog`, `emulate`, `resize`, `network`, `trace`, `metrics`, `heap` và screenshot tab ngầm **bắt buộc CDP** — xem `skills/agent-pilot/references/cli-usage.md` §1.1.

---

#### 4.4.5. Cấu Trúc File Batch Automation JSON (`flow_test.json`)

Kịch bản Batch Automation cho phép gộp chuỗi nhiều hành động thành một file JSON duy nhất để thực thi tuần tự:

```json
[
  { "action": "open", "url": "https://google.com", "active": true },
  { "action": "wait", "ms": 1000 },
  { "action": "type", "selector": "textarea[name='q']", "text": "Agent Pilot Golang", "pressEnter": true },
  { "action": "wait", "ms": 2000 },
  { "action": "screenshot", "label": "google_search_results" }
]
```

Hoặc sử dụng định dạng đối tượng có mảng `actions`:

```json
{
  "actions": [
    { "type": "open", "url": "https://example.com/login" },
    { "type": "wait_for_selector", "selector": "#username", "timeout": 5000 },
    { "type": "type", "selector": "#username", "text": "tester@example.com" },
    { "type": "type", "selector": "#password", "text": "Secret123!" },
    { "type": "click", "selector": "#btn-submit" },
    { "type": "screenshot", "mode": "visible", "path": "/tmp/step-login.png", "title": "Hoàn tất đăng nhập" },
    { "type": "close" }
  ]
}
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
npx skills add https://github.com/ducconit/agent-pilot

# Cài đặt toàn cục (Global) cho mọi trợ lý trên máy
npx skills add https://github.com/ducconit/agent-pilot -g --all
```

> 💡 **Lưu ý về binary**: Gói cài đặt `npx skills add` chứa sẵn binary biên dịch cho cả 3 hệ điều hành (Linux, macOS, Windows) bên trong thư mục `skills/agent-pilot/scripts/` để AI Agent có thể chạy ngay trên mọi máy tính. Nếu bạn muốn cài đặt tinh gọn dung lượng và tự động đăng ký dịch vụ chạy ngầm của hệ điều hành, hãy sử dụng [Bộ cài đặt theo hệ điều hành](#cach-a-cai-dat-qua-bo-cai-theo-he-dieu-hanh-khuyen-nghi).

---

## 6. Hỏi & Đáp Thường Gặp (Q&A)

Để tra cứu các câu hỏi thường gặp về kiến trúc, cách tiết kiệm token và quy trình kiểm thử Web QA/QC chuyên sâu, xem chi tiết tại [Hỏi & Đáp Thường Gặp (Q&A)](/vi/QA).

---

## 7. Lỗi Thường Gặp & Cách Khắc Phục (Troubleshooting)

Nếu gặp sự cố về kết nối cầu nối (Bridge), lỗi gắn kết debugger CDP hoặc cấu hình biến môi trường PATH, hãy tham khảo tài liệu chi tiết tại [Lỗi Thường Gặp & Cách Khắc Phục](/vi/TROUBLESHOOTING).
