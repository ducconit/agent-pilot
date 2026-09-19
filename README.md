<div align="center">

![Agent Pilot Banner](assets/banner.svg)

# 🚀 AGENT PILOT
### Universal AI Agent Browser Controller • Antigravity-First

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue?style=for-the-badge&logo=googlechrome)](extensions/manifest.json)
[![Status: Public Beta](https://img.shields.io/badge/Status-Public%20Beta-amber?style=for-the-badge&logo=statuspage)](#)
[![Antigravity First](https://img.shields.io/badge/AI%20Agent-Antigravity--First-8b5cf6?style=for-the-badge)](docs/ANTIGRAVITY_INTEGRATION.md)
[![CDP Protocol](https://img.shields.io/badge/Engine-Chrome%20DevTools%20Protocol-06b6d4?style=for-the-badge)](docs/CDP_GUIDE.md)
[![Cross-Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blueviolet?style=for-the-badge)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge)](CONTRIBUTING.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

<p align="center">
  <b>Agent Pilot</b> là tiện ích mở rộng Google Chrome (Manifest V3) đột phá, được thiết kế chuyên biệt để giúp <b>mọi AI Agent</b> (ưu tiên tối ưu hóa cho <b>Antigravity</b>) có thể quan sát, phân tích và điều khiển trình duyệt một cách mượt mà, an toàn và trực quan nhất.
</p>

> ⚠️ **Thông Báo Bản Thử Nghiệm (Public Beta)**: Agent Pilot hiện đang được phát hành dưới dạng **Public Beta** cho cộng đồng nhà phát triển. Toàn bộ tính năng cốt lõi đã vượt qua 100% các bài kiểm thử tự động trên trình duyệt thật. Chúng tôi rất mong nhận được đóng góp ý kiến, phản hồi trải nghiệm và báo cáo lỗi từ bạn qua [GitHub Issues](https://github.com/ducconit/agent-pilot-extension/issues) hoặc [Pull Requests](CONTRIBUTING.md)!

[✨ Tính năng chính](#-tính-năng-cốt-lõi) • [🚀 Cài đặt nhanh](#-hướng-dẫn-cài-đặt-nhanh) • [🧪 Trang thử nghiệm](#-phòng-thí-nghiệm-kiểm-thử-test-page) • [📚 Tài liệu chi tiết](#-hệ-thống-tài-liệu-chuyên-sâu) • [🤝 Đóng góp](CONTRIBUTING.md)

---

</div>

## 🌟 Tính Năng Cốt Lõi

| Tính Năng | Biểu Tượng | Mô Tả Kỹ Thuật |
| :--- | :---: | :--- |
| **Điều khiển Trình duyệt** | 🌐 | Mở tab mới, điều hướng URL, reload, chuyển đổi và đóng tab linh hoạt. |
| **Mô phỏng Chuột ảo** | 🖱️ | Con trỏ đồ họa neon bay mượt mà trên màn hình, phát sóng click ripple và chuỗi sự kiện DOM hoàn chỉnh. |
| **Trusted CDP Input (tùy chọn)** | 🛡️ | `--via cdp` phát input thật (`Input.dispatchMouseEvent`) điều khiển được cross-origin iframe, `<canvas>` và WebGL/Unity game; `--via auto` tự fallback synthetic. Tiền kiểm tra bằng `agent-pilot cdp status --tab <id>`. |
| **Tự động Gõ chữ** | ⌨️ | Focus vào ô nhập liệu và gõ văn bản từng ký tự theo thời gian thực (Human-like Typing). |
| **Giám sát DevTools (CDP)** | ⚡ | Kết nối cấp thấp qua Chrome DevTools Protocol để bắt trọn `console.log/error`, `Network traffic` và `Performance RAM/DOM`. |
| **Soi & Lấy vị trí DOM** | 🎯 | Bắt dính phần tử khi hover, hiển thị kích thước `W × H`, tọa độ `(X, Y)`, trích xuất **CSS Selector** và **XPath**. |
| **Trích xuất Mã màu** | 🎨 | Kính lúp pixel nhặt màu chính xác 5 định dạng (HEX, RGB, RGBA, HSL, OKLCH), 1-click copy từng định dạng và lưu khay lịch sử màu sắc. |
| **Bộ Chụp Màn Hình** | 📸 | Hỗ trợ 4 chế độ (`visible`, `region`, `element`, `full`): Chụp toàn khung nhìn, Kéo chọn vùng cắt tùy ý (Crop), Chụp riêng phần tử DOM đã khóa, và Chụp toàn trang cuộn (Full Page). |
| **Chú Thích & Chỉ Điểm UI** | ✏️ | Khoanh vùng, chỉ điểm phần tử/component nguồn (React/Vue/Astro:line), ghim ghi chú lỗi để giao việc cho AI Agent sửa code (hỗ trợ 3 kênh Live Push, Persistent Inbox, Clipboard Prompt). |
| **Tương thích Antigravity** | 🤖 | Tích hợp sẵn bộ chạy kịch bản **JSON Action**, cầu nối `window.__AGENT_PILOT__` và 35 công cụ MCP Tools. |

---

## 🏗️ Cấu Trúc Thư Mục Dự Án

Dự án được tổ chức khoa học, module hóa chuyên sâu và tuân thủ các chuẩn kỹ thuật cao nhất:

```
agent-pilot-extension/
├── assets/                             # Tài nguyên đồ họa & nhận diện thương hiệu
│   ├── banner.svg                      # Banner giới thiệu công nghệ cao
│   └── logo.svg                        # Logo vector gốc của Agent Pilot
├── docs/                               # Bộ tài liệu kỹ thuật chuyên sâu
│   ├── ANTIGRAVITY_INTEGRATION.md      # Hướng dẫn tích hợp Antigravity First & MCP
│   ├── ARCHITECTURE.md                 # Kiến trúc chi tiết Manifest V3 & IPC
│   ├── CDP_GUIDE.md                    # Hướng dẫn Chrome DevTools Protocol (CDP)
│   ├── API_REFERENCE.md                # Danh mục tin nhắn & đặc tả JSON Action
│   ├── BUNDLE_README.md                # README hướng dẫn cài đặt đóng gói kèm bundle phát hành
│   └── USAGE_GUIDE.md                  # Sổ tay hướng dẫn sử dụng từng tính năng
├── skills/                             # Kỹ năng chuẩn Agent Skills Ecosystem (skills.sh)
│   └── agent-pilot/
│       └── SKILL.md                    # Hướng dẫn & cấu hình skill cho npx skills add
├── cli/                                # Bộ công cụ dòng lệnh (CLI) & MCP Server độc lập bằng Go (Golang)
│   ├── main.go                         # Điểm khởi đầu mỏng: chuyển tiếp tới internal/cli
│   ├── internal/                       # Mã nguồn CLI tách thành các package nội bộ, routing bằng Cobra
│   │   ├── cli/                        # Cobra root + commands (page/cdp/meta) + parser tương thích flag cũ (-tab → --tab)
│   │   ├── config/                     # Hằng số cấu hình dùng chung & DefaultBridgePort()
│   │   ├── bridge/                     # WebSocket Server 58765, HTTP REST API, timeout derivation, sanitizer
│   │   ├── feedback/                   # Feedback Inbox, Waiter & long-poll (Channel A/B)
│   │   ├── mcp/                        # MCP stdio server & registry 35 công cụ
│   │   ├── service/                    # Quản lý service chạy ngầm (systemd / launchd / Task Scheduler)
│   │   └── skill/                      # Cài Agent Skill & kỹ năng nhúng base64 (assets.go sinh tự động)
│   └── README.md                       # Hướng dẫn sử dụng & biên dịch Go binary

├── extensions/                         # Toàn bộ mã nguồn Chrome Extension (Manifest V3)
│   ├── manifest.json                   # Cấu hình chuẩn Chrome Extension MV3
│   ├── guide.html                      # Trang Thông tin & Hướng dẫn sử dụng responsive
│   ├── background.js                   # Service Worker chính (ES Module entry)
│   ├── background/                     # Các module dịch vụ nền
│   │   ├── constants.js                # Hằng số hệ thống & cấu hình
│   │   ├── secret-sanitizer.js         # Lớp lọc che giấu Secret & API Key
│   │   ├── cdp-manager.js              # Quản lý Chrome DevTools Protocol
│   │   ├── tab-manager.js              # Quản lý Tabs & Native Tab Groups
│   │   ├── screenshot-service.js       # Dịch vụ chụp ảnh màn hình
│   │   ├── batch-executor.js           # Bộ chạy kịch bản gom cụm Batch Actions
│   │   └── bridge-client.js            # WebSocket client kết nối AI Agent bridge
│   ├── content.js                      # Content Script điều phối in-page
│   ├── content/                        # Các module tương tác DOM & Visuals
│   │   ├── toast.js                    # Thông báo Toast HUD trên trang web
│   │   ├── lock-shield.js              # Chỉ báo viền phát sáng & pill trạng thái khi Agent thao tác
│   │   ├── cursor-simulator.js         # Con trỏ chuột ảo Neon & sóng ripple
│   │   ├── dom-inspector.js            # Trích xuất thông số DOM & Element Snap
│   │   ├── eyedropper.js               # Kính lúp phóng đại 11x11 lấy mã màu
│   │   └── feedback-studio/            # Chú thích & Chỉ điểm UI in-page (Modular Architecture)
│   │       ├── constants.js            # Bảng màu xoay vòng, tiện ích escape & kéo thả
│   │       ├── state.js                # Quản lý trạng thái phiên chú thích & danh sách vị trí
│   │       ├── capture-service.js      # Dịch vụ chụp ảnh, cắt Canvas & nhận diện component nguồn
│   │       ├── pinned-overlay.js       # Quản lý layer ghim cố định khung chọn trên màn hình
│   │       ├── hud-toolbar.js          # Thanh công cụ HUD nổi trên trang & chuyển chế độ
│   │       ├── modals.js               # Popover ghi chú, Annotator màn hình & modal danh sách
│   │       ├── selection-modes.js      # Logic chọn phần tử, kéo chọn vùng, chụp viewport/fullpage
│   │       ├── export-channels.js      # 3 kênh xuất feedback (Prompt C, Inbox B, Live A)
│   │       └── index.js                # Điều phối vòng đời & xuất API window.__AP_INTERNAL__.feedback
│   ├── content.css                     # Stylesheet cho con trỏ, kính lúp, overlay & feedback HUD
│   ├── sidepanel.html                  # Giao diện trung tâm điều khiển Side Panel
│   ├── sidepanel.css                   # Giao diện Modern Dark Cyberpunk Responsive
│   ├── sidepanel.js                    # Bộ điều phối UI Side Panel (ES Module)
│   ├── sidepanel/                      # Các module quản lý thẻ Side Panel
│   │   ├── ui-helpers.js               # Tiện ích giao diện, toast, badge
│   │   ├── color-utils.js              # Chuyển đổi 5 định dạng màu (HEX, RGB, RGBA, HSL, OKLCH)
│   │   ├── agent-monitor.js            # Giám sát kết nối Agent & Secret Redaction toggle
│   │   ├── inspector-panel.js          # Thẻ Tổng quan DOM & Kiểu dáng CSS
│   │   ├── screenshot-panel.js         # Studio chụp ảnh & Auto-copy Clipboard
│   │   └── feedback-panel.js           # Thẻ Chú thích UI & kênh xuất Prompt/Inbox/Live
│   ├── popup.html                      # Popup tiện ích khởi động nhanh
│   ├── popup.js                        # Xử lý sự kiện popup
│   ├── popup.css
│   └── icons/                          # Bộ icon nhận diện chuẩn các kích thước
├── mcp/agent-pilot/                    # 35 tệp lược đồ chuẩn Single Source of Truth (SSOT)
├── scripts/                            # Bộ công cụ build, test, pack & sync cross-platform
│   ├── browser_resolver.mjs            # Tự động tìm kiếm Chrome/Chromium/Edge/Brave đa nền tảng
│   ├── build_cli.mjs                   # Build CLI tĩnh cross-platform (thay cho env-var prefix POSIX)
│   ├── embed_skills.mjs                # Nhúng kỹ năng vào CLI Go dạng base64 (cli/internal/skill/assets.go)
│   ├── export_mcp.mjs                  # Xuất schema MCP ra repo + config Antigravity (không cần `~`)
│   ├── export_mcp_schemas.mjs          # Trích xuất schema MCP tự động (SSOT)
│   ├── lint.mjs                        # Syntax-check mọi file .js/.mjs trong extensions/ và scripts/
│   ├── pack_extension.mjs              # Đóng gói tiện ích ra ZIP (kiểm tra manifest, dùng cho CWS)
│   ├── pack_bundle.mjs                 # Đóng gói bundle từng nền tảng: extensions + binary + skills + README
│   ├── run_test.mjs                    # Bộ chạy test tự động Windows/macOS/Linux (kèm xvfb-run)
│   ├── sync_agk.mjs                    # Đồng bộ sang plugin AGK Antigravity
│   ├── lib/                            # Tiện ích dùng chung: config.mjs, harness.mjs, zip.mjs
│   ├── features/                       # Các khối kiểm thử tách từ verify_all_features / verify_agent_connection
│   ├── verify_all_features.mjs         # Bộ kiểm thử 15 tính năng cốt lõi trên trình duyệt thật
│   ├── verify_agent_connection.mjs     # Bộ kiểm thử 29 tính năng kết nối & điều khiển Agent
│   ├── verify_annotator_tools.mjs      # Bộ kiểm thử chuyển đổi công cụ Annotator & kéo khung
│   ├── verify_background_api.mjs       # Kiểm thử cấu trúc background: CDP facade, registry, drag clamp
│   ├── verify_color_utils.mjs          # Kiểm thử chuyển đổi màu HEX/RGB/HSL/OKLCH
│   ├── verify_feedback_system.mjs      # Bộ kiểm thử hệ thống Feedback Channel B & Channel A
│   ├── verify_feedback_edit_delete.mjs # Bộ kiểm thử sửa & xóa feedback (in-page + Side Panel)
│   ├── verify_feedback_item_xss.mjs    # Bộ kiểm thử kháng XSS cho nội dung feedback
│   ├── verify_pinned_regions.mjs       # Bộ kiểm thử ghim vùng chọn & đa vùng trực quan
│   ├── verify_secret_sanitizer.mjs     # Bộ kiểm thử 26 kịch bản lọc che giấu Secret/API Key
│   ├── verify_session_lifecycle.mjs    # Bộ kiểm thử vòng đời phiên điều khiển của Agent
│   ├── agent-pilot.service             # Unit systemd --user mẫu (Linux)
│   ├── com.agentpilot.bridge.plist     # Cấu hình launchd User Agent mẫu (macOS)
│   └── install_windows_service.ps1     # Script đăng ký Task Scheduler mẫu (Windows)
├── test-page.html                      # Trang web tương tác phục vụ kiểm thử tức thì
└── README.md                           # Tài liệu giới thiệu dự án
```

---

## 🚀 Hướng Dẫn Cài Đặt (Installation Guide)

Agent Pilot cung cấp 3 thành phần chính: **Chrome Extension (Giao diện & Cầu nối trình duyệt)**, **Standalone Go CLI / MCP Server (Bộ máy điều khiển độc lập)**, và **Agent Skill (Kỹ năng cho AI Coding Assistants)**.

```mermaid
flowchart LR
    subgraph Install["3 Bước Thiết Lập Toàn Diện"]
        A["<b>1. Cài Extension</b><br/>Nạp vào Chrome (MV3)"] --> B["<b>2. Cài Go CLI</b><br/>Tải binary hoặc build"]
        B --> C["<b>3. Cài Kỹ Năng / MCP</b><br/>npx skills add hoặc mcp_config"]
    end
```

### 1. Cài Đặt Chrome Extension

#### Cách A: Cài đặt từ Bản Phát Hành (Khuyên dùng)
1. Tải **gói bundle** cho đúng nền tảng của bạn từ [GitHub Releases](https://github.com/ducconit/agent-pilot-extension/releases) — ví dụ `agent-pilot-v1.0.8-beta-linux-amd64.zip` (đã gồm sẵn extension + CLI + skills + README hướng dẫn), hoặc tệp chỉ-chứa-extension `agent-pilot-v1.0.8-beta.zip` nếu bạn chỉ cần phần Chrome.
2. Giải nén tệp `.zip` ra một thư mục cố định.
3. Mở trình duyệt Chrome, truy cập: `chrome://extensions`.
4. Gạt bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
5. Nhấn nút **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục **`extensions/`** bên trong gói vừa giải nén.
6. Nhấp biểu tượng Extensions (mảnh ghép) trên thanh công cụ Chrome và **Ghim (Pin)** biểu tượng **Agent Pilot (📌)**.

> 📄 Hướng dẫn đầy đủ từng bước nằm trong `README.md` ngay trong gói bundle.

#### Cách B: Cài đặt từ Mã Nguồn (Dành cho Lập trình viên)
```bash
git clone https://github.com/ducconit/agent-pilot-extension.git
cd agent-pilot-extension
npm ci
npm run pack          # Chỉ extension -> dist/agent-pilot-v*.zip
npm run pack:bundle   # Bundle từng nền tảng -> dist/bundles/agent-pilot-v*-<os>-<arch>.zip
```
Sau đó nạp thư mục `extensions/` trực tiếp vào `chrome://extensions`.

---

### 2. Cài Đặt Standalone Go CLI & MCP Server (`agent-pilot`)

Bản binary độc lập viết bằng **Golang** tích hợp sẵn máy chủ **WebSocket/REST Bridge Server (cổng 58765)**, **MCP Server (stdio)** và **bộ lệnh CLI** điều khiển trình duyệt trực tiếp (khởi động `<5ms`, RAM `~12MB` — số liệu tham khảo, có thể thay đổi theo nền tảng, đóng gói tĩnh pure static `CGO_ENABLED=0`, không phụ thuộc Node.js hay thư viện hệ thống).

#### Cách A: Tải Bundle Biên Dịch Sẵn (GitHub Releases)
Mỗi bundle chứa sẵn `extensions/` + binary đúng nền tảng + `skills/` + `README.md`:

| Nền Tảng | Kiến Trúc | Tên Tệp Tải Về | Cài Đặt |
| :--- | :--- | :--- | :--- |
| **Linux** | x86_64 (amd64) | `agent-pilot-v1.0.8-beta-linux-amd64.zip` | `chmod +x agent-pilot && sudo mv agent-pilot /usr/local/bin/` |
| **Linux** | ARM64 (aarch64) | `agent-pilot-v1.0.8-beta-linux-arm64.zip` | như trên |
| **macOS** | Apple Silicon (M1-M4) | `agent-pilot-v1.0.8-beta-darwin-arm64.zip` | như trên |
| **macOS** | Intel (x86_64) | `agent-pilot-v1.0.8-beta-darwin-amd64.zip` | như trên |
| **Windows** | x86_64 (amd64) | `agent-pilot-v1.0.8-beta-windows-amd64.zip` | Giữ `agent-pilot.exe`, thêm thư mục vào `PATH` |
| **Windows** | ARM64 | `agent-pilot-v1.0.8-beta-windows-arm64.zip` | như trên |

Trong bundle, binary nằm ngay cạnh thư mục `extensions/` — cài xong extension theo mục 1 là dùng được ngay.

#### Cách B: Tự Biên Dịch Từ Nguồn (Yêu cầu Go 1.21+)
```bash
# Cách 1: Sử dụng npm script
npm run build:cli

# Cách 2: Tự biên dịch trực tiếp qua go build
cd cli
go build -ldflags="-s -w" -o agent-pilot .

# Hoặc cài đặt trực tiếp qua Go toolchain
go install github.com/ducconit/agent-pilot-extension/cli@latest
```

#### Cách Kích Hoạt Service Chạy Ngầm (Khuyên dùng cho trải nghiệm tốt nhất)
Thay vì phải tự chạy server thủ công, bạn chỉ cần gõ 1 lệnh để hệ thống tự động đăng ký service chạy ngầm (Linux `systemd --user`, macOS `launchd`, Windows `Task Scheduler`):

```bash
# Cài đặt và kích hoạt service tự khởi động cùng máy:
agent-pilot service install

# Kiểm tra trạng thái service:
agent-pilot service status

# Các lệnh quản trị khác:
agent-pilot service restart    # Khởi động lại
agent-pilot service stop       # Dừng tạm thời
agent-pilot service uninstall  # Gỡ bỏ service
```

> 💡 **Lưu Ý Khi Chạy Nhiều AI Agent Đồng Thời (Multi-Agent Concurrency)**:
> - **Chống xung đột cổng**: Khi chạy ngầm bằng `agent-pilot service install`, server đóng vai trò Master Bridge. Bạn có thể bật đồng thời **Antigravity IDE**, **Codex**, **Claude Code**, và **Antigravity CLI** để xử lý nhiều task cùng lúc mà không lo lỗi đụng độ cổng mạng.
> - **Chỉ định `tabId`**: Khi Agent mở tab bằng `browser_open_tab`, hãy truyền `tabId` vào các lệnh tiếp theo (`click`, `type`, `screenshot`, `run_actions`) để mỗi Agent làm việc trên tab riêng của mình mà không tranh chấp tiêu điểm (focus) với nhau.

---

### 3. Cài Đặt Kỹ Năng Cho Trợ Lý AI (Agent Skills Ecosystem)

Agent Pilot tuân thủ chuẩn mở **Agent Skills** ([skills.sh](https://skills.sh/)). Mọi trợ lý AI coding (như **Claude Code**, **Cursor**, **Codex**, **OpenCode**, **Antigravity**, **Amp**, **Roo Code**, **Devin**, v.v.) đều có thể tự động tải và kích hoạt kỹ năng chỉ với 1 lệnh:

```bash
# Cài đặt cho thư mục dự án hiện tại:
npx skills add https://github.com/ducconit/agent-pilot-extension

# Hoặc cài đặt toàn cục (Global) cho mọi AI agent trên hệ thống:
npx skills add https://github.com/ducconit/agent-pilot-extension -g --all
```

---

## 📖 Hướng Dẫn Sử Dụng (User & Developer Guide)

### 1. Dành Cho Người Dùng (Humans)

#### Khởi Động Bảng Điều Khiển (Side Panel)
- **Cách 1**: Nhấp chuột trực tiếp vào biểu tượng **Agent Pilot (📌)** trên thanh công cụ Chrome (Side Panel sẽ trượt mở tức thì).
- **Cách 2**: Nhấp chuột phải trên bất kỳ trang web nào $\rightarrow$ Chọn **Mở Agent Pilot (Side Panel)**.
- **Phím tắt nhanh**: <kbd>Ctrl + Shift + P</kbd> (trên macOS: <kbd>Cmd + Shift + P</kbd>). Bạn có thể tùy chỉnh lại phím tắt tại `chrome://extensions/shortcuts`.

#### Các Tính Năng Nổi Bật Trên Giao Diện:
1. **🎯 Soi Phần Tử DOM (Inspector)**: Bật nút soi $\rightarrow$ rà chuột qua trang web để xem bounding box, kích thước, CSS Selector và XPath. Nhấp vào bất kỳ dòng nào để sao chép nhanh hoặc bấm **📋 Copy Tất cả**.
2. **🎨 Kính Lúp Nhặt Mã Màu (Eyedropper)**: Phóng đại pixel 11×11 bám theo con trỏ chuột, nhặt màu chính xác 5 chuẩn hiện đại (HEX, RGB, RGBA, HSL, OKLCH), hỗ trợ 1-click copy từng dòng định dạng và lưu khay lịch sử màu sắc.
3. **📸 Bộ Chụp Màn Hình (Screenshot Studio)**:
   - Chụp toàn màn hình, kéo khung cắt tùy chọn (Crop), hoặc chụp riêng phần tử DOM đã khóa.
   - Bật công tắc **Tự động sao chép vào Clipboard** để dán ngay lập tức mà không cần bấm lưu.
4. **✏️ Chú Thích & Chỉ Điểm UI Cho Agent (Feedback Studio)**:
   - **4 chế độ chọn**: Chọn phần tử (tự động phát hiện React/Vue/Astro source line), Kéo chọn vùng (ghim khung số hóa #1, #2,...), Toàn màn hình viewport (vẽ khung box & cắm ghim pin), và Toàn trang web cuộn (Full Page).
   - **Chỉnh sửa / Xóa linh hoạt**: Nhấp nút ✏️ để sửa ghi chú trực tiếp trên trang hoặc trên thẻ Side Panel; bấm ✕ để xóa khung ghim.
   - **3 kênh xuất linh hoạt**:
     - **Kênh A (Live Push)**: Đẩy trực tiếp sang cho AI Agent đang chờ.
     - **Kênh B (Shared Inbox)**: Lưu phiên vào `~/.agent-pilot/inbox/feedback/<timestamp>/`.
     - **Kênh C (Clipboard Prompt)**: 1-click tạo prompt Markdown hoàn chỉnh kèm vị trí component.
5. **🛡️ Chỉ Báo Hoạt Động Tinh Tế (Subtle Agent Indicator)**:
   - Khi AI Agent thao tác, giao diện hiển thị viền màn hình phát sáng neon nhẹ nhàng và thanh trạng thái nhỏ gọn (floating pill) hiển thị hành động đang thực thi.
   - Trang bị nút `[ 🔓 Chiếm quyền ]` và lắng nghe phím <kbd>Esc</kbd> để người dùng mở khóa tức thì mà không làm mờ trang web hay cản trở tầm nhìn.

---

### 2. Dành Cho Trợ Lý AI Coding Agents (Antigravity, Claude, Cursor)

#### Cấu Hình MCP Server (`stdio`):
Thêm vào file cấu hình MCP của bạn (`~/.gemini/antigravity/mcp/` hoặc `claude_desktop_config.json` hoặc Cursor Settings):

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

#### Khởi Chạy Bridge Server Chống Xung Đột Cổng (Dual Mode):
```bash
# Khởi chạy server độc lập
agent-pilot server
```
Khi chạy đa tác vụ hoặc nhiều cửa sổ IDE, Agent Pilot tự động chuyển sang chế độ **Forwarder**, chuyển tiếp lệnh qua HTTP REST API `http://127.0.0.1:58765/api` mà không bao giờ gặp lỗi xung đột cổng `EADDRINUSE`.

#### Bộ Công Cụ MCP Điều Khiển Trình Duyệt (35 Tools):
- `browser_run_actions`: Động cơ thực thi chuỗi kịch bản hàng loạt (Batch Engine), tiết kiệm >80% token.
- `browser_open_tab`, `browser_list_tabs`, `browser_navigate`: Quản lý và điều hướng các tab trình duyệt (mặc định mở ngầm không cướp focus).
- `browser_click`, `browser_drag`, `browser_type`, `browser_scroll`: Mô phỏng chuột ảo neon với sóng click ripple. `browser_click`/`browser_drag` hỗ trợ `via: "cdp"` (trusted input cho cross-origin iframe/canvas/WebGL) và drag theo tọa độ `fromX/fromY/toX/toY` + `holdMs` cho game.
- `browser_get_element`, `browser_pick_color`, `browser_screenshot`: Đọc DOM, trích xuất mã màu pixel, chụp ảnh màn hình ngầm qua CDP.
- `browser_get_devtools_data`: Bắt log Console, Network requests và Performance RAM/DOM.
- `browser_list_instances`, `browser_select_instance`: Quản lý đa trình duyệt Chrome đồng thời.
- `browser_set_busy`: Khóa/mở khóa khiên bảo vệ người dùng thao tác khi Agent chạy kịch bản phức tạp.
- `browser_wait_for_feedback`: Chờ phản hồi trực quan từ người dùng theo thời gian thực (Channel A).
- `browser_get_pending_feedback`: Đọc danh sách phản hồi UI trong Inbox cục bộ (Channel B).

---

### 3. Dành Cho Kỹ Sư Kiểm Thử / QC (Standalone CLI Automation)

Kỹ sư kiểm thử tự động có thể điều khiển trình duyệt trực tiếp qua terminal hoặc tích hợp vào shell script/CI mà không cần Node.js:

```bash
# 1. Điều hướng và mở tab
agent-pilot open "https://github.com" --active

# 2. Tương tác chuột & bàn phím
agent-pilot type "#search-input" "agent pilot" --enter
agent-pilot click ".repo-item:first-child"
agent-pilot scroll 0 400

# 3. Trích xuất thông tin DOM
agent-pilot inspect "h1.entry-title"

# 4. Chụp ảnh màn hình kiểm thử
agent-pilot screenshot -o result.png --mode visible

# 5. Xem danh sách các tab đang hoạt động
agent-pilot tabs

# 6. Chạy kịch bản tự động hóa từ tệp JSON
agent-pilot batch flow_test.json

# 7. Quản lý phản hồi UI
agent-pilot feedback list

# 8. Trusted CDP input cho cross-origin iframe / canvas / WebGL game (tùy chọn)
agent-pilot cdp status --tab 12345
agent-pilot click -x 733 -y 668 --via cdp --tab 12345
agent-pilot drag --from-x 745 --from-y 490 --to-x 745 --to-y 832 --steps 10 --hold 800 --via cdp --tab 12345

# 9. Cài Agent Skill trực tiếp từ binary (không cần clone repo / Node.js)
agent-pilot skill install              # ~/.agents/skills/agent-pilot
agent-pilot skill install --agy        # ~/.gemini/config/skills/agent-pilot (Antigravity)
agent-pilot skill install --path ~/my-skills --force
```

---

## 🧪 Phòng Thí Nghiệm Kiểm Thử (`test-page.html`)

Dự án có sẵn tệp `test-page.html` được thiết kế đặc biệt để bạn kiểm nghiệm toàn bộ các tính năng ngay lập tức mà không cần internet:

1. Kéo thả tệp `test-page.html` vào trình duyệt Chrome (hoặc mở bằng URL `file:///path/to/browser-control/test-page.html`).
2. Mở **Agent Pilot Side Panel**:
   - Thử nghiệm **Chuột ảo**: Di chuyển chuột đến nút *"🎯 Click vào đây!"* và nhấp click.
   - Thử nghiệm **Tự động gõ chữ**: Điền nội dung vào ô `#test-search-input`.
   - Thử nghiệm **DevTools**: Nhấp các nút sinh `console.log`, `warn`, `error` hoặc nút gửi API để thấy nhật ký và network nhảy tức thì trong Side Panel.
   - Thử nghiệm **Lấy màu**: Bật nút lấy mã màu và nhặt màu từ dải các ô màu rực rỡ trên trang.
   - Thử nghiệm **Chụp ảnh**: Thử chụp toàn màn hình, kéo khung crop box hoặc chụp riêng khối `#inspector-special-box`.
   - Thử nghiệm **Feedback Studio**: Bấm nút Feedback Studio, kéo chọn vùng, cắm ghim pin và bấm Copy Prompt hoặc Gửi Agent.

---

## 🤖 Kịch Bản Tự Động Hóa Mẫu (Antigravity Automation)

Bạn có thể dán đoạn mã JSON sau vào ô **Kịch bản Agent** trên Side Panel rồi nhấn **▶ Chạy Kịch bản Agent**:

```json
[
  { "action": "mouse_move", "x": 320, "y": 210, "duration": 400 },
  { "action": "wait", "ms": 250 },
  { "action": "mouse_click", "x": 320, "y": 210 },
  { "action": "wait", "ms": 300 },
  { "action": "type", "selector": "#test-search-input", "text": "Agent Pilot x Antigravity AI" },
  { "action": "scroll", "deltaY": 250 },
  { "action": "screenshot", "mode": "visible" }
]
```

---

## 📚 Hệ Thống Tài Liệu Chuyên Sâu

Để tìm hiểu sâu hơn về kiến trúc và cách tích hợp với AI Agent, vui lòng tham khảo các tài liệu chuyên ngành tại thư mục `docs/`:

* 📖 **[Tích hợp Antigravity & MCP Protocol](docs/ANTIGRAVITY_INTEGRATION.md)**: Hướng dẫn kết nối Agent Pilot với Antigravity coding agents, schema MCP tools và kịch bản end-to-end.
* 🏛️ **[Kiến trúc Hệ thống (ARCHITECTURE.md)](docs/ARCHITECTURE.md)**: Phân tích chi tiết mô hình Manifest V3, vòng đời Service Worker và đường ống truyền thông điệp (IPC).
* ⚡ **[Sổ tay Chrome DevTools Protocol (CDP_GUIDE.md)](docs/CDP_GUIDE.md)**: Cơ chế kết nối cấp thấp với Console, Network, Performance và Page Capture.
* 📚 **[Danh mục Tham chiếu API (API_REFERENCE.md)](docs/API_REFERENCE.md)**: Đặc tả toàn bộ cú pháp tin nhắn và hàm API của `window.__AGENT_PILOT__`.
* 📖 **[Sổ tay Người dùng (USAGE_GUIDE.md)](docs/USAGE_GUIDE.md)**: Hướng dẫn chi tiết từng bước vận hành toàn bộ chức năng.

---

## 🤝 Đóng Góp Cộng Đồng (Contributing)

Chúng tôi hoan nghênh mọi sự đóng góp để giúp Agent Pilot ngày càng hoàn thiện và mạnh mẽ hơn!

* 📖 **[Hướng dẫn Đóng góp (CONTRIBUTING.md)](CONTRIBUTING.md)**: Hướng dẫn cài đặt môi trường dev, chạy kiểm thử, quy ước commit và gửi Pull Request.
* 📜 **[Quy tắc Ứng xử (CODE_OF_CONDUCT.md)](CODE_OF_CONDUCT.md)**: Cam kết môi trường hợp tác văn minh, cởi mở theo chuẩn Contributor Covenant v2.1.
* 🛡️ **[Chính sách Bảo mật (SECURITY.md)](SECURITY.md)**: Báo cáo lỗ hổng an ninh có trách nhiệm và cam kết bảo vệ dữ liệu bí mật.

---

## 👤 Tác Giả & Quản Trị Dự Án (Author & Maintainer)

* **Tác giả (Owner)**: **DNT**
* **GitHub**: [@ducconit](https://github.com/ducconit) ([https://github.com/ducconit](https://github.com/ducconit))
* **Dự án**: [Agent Pilot Extension](https://github.com/ducconit/agent-pilot-extension)

---

## 📄 Bản Quyền & Giấy Phép

Dự án được phát hành theo giấy phép mã nguồn mở [MIT License](LICENSE).
Copyright (c) 2026 **DNT** ([@ducconit](https://github.com/ducconit)) & Agent Pilot Contributors.
Tương thích hoàn hảo với Antigravity, Chrome 116+ (hỗ trợ đầy đủ Side Panel API).
