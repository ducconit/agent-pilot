<div align="center">

![Agent Pilot Banner](assets/banner.svg)

# 🚀 AGENT PILOT
### Bộ Điều Khiển Trình Duyệt Đa Năng Cho AI Agent • Skills + CLI & MCP

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue?style=flat-square&logo=googlechrome)](extensions/manifest.json)
[![Documentation](https://img.shields.io/badge/Docs-VitePress-06b6d4?style=flat-square&logo=vitepress)](https://ducconit.github.io/agent-pilot/)
[![Status: Public Beta](https://img.shields.io/badge/Status-Public%20Beta-amber?style=flat-square&logo=statuspage)](#)
[![CDP Protocol](https://img.shields.io/badge/Engine-Chrome%20DevTools%20Protocol-06b6d4?style=flat-square)](docs/vi/CDP_GUIDE.md)
[![Cross-Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blueviolet?style=flat-square)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![100% Vibe Coded](https://img.shields.io/badge/100%25-Vibe%20Coded-purple?style=flat-square&logo=visualstudiocode)](#-tuyen-bo-mien-tru-trach-nhiem--vibe-coding)
[![Built with Antigravity](https://img.shields.io/badge/Built%20with-Google%20Antigravity-4285F4?style=flat-square&logo=google)](#-tuyen-bo-mien-tru-trach-nhiem--vibe-coding)

[English](README.md) • [Tiếng Việt](README.vi.md) • [Trang tài liệu Public](https://ducconit.github.io/agent-pilot/) • [Đóng góp](CONTRIBUTING.md)

<p align="center">
  <b>Agent Pilot</b> là bộ công cụ điều khiển trình duyệt đa năng dành cho mọi <b>AI Coding Agent hoặc Công cụ tự động hóa</b> hỗ trợ <b>Agent Skills + Command Line (CLI)</b> hoặc <b>Model Context Protocol (MCP)</b> (Claude Code, Cursor, Windsurf, Google Antigravity, Cline, OpenCode, Codex, Aider).
</p>

</div>

> [!WARNING]
> ### ⚠️ Cảnh Báo: Dự Án 100% Vibe Coding & Miễn Trừ Trách Nhiệm
>
> **Agent Pilot là dự án thử nghiệm mã nguồn mở được kiến tạo 100% bằng hình thức "Vibe Coding" với Google Antigravity.**
>
> - **Mã nguồn hoàn toàn do AI sinh ra**: Mọi thành phần (binary Go CLI, Chrome extension Manifest V3, MCP Server và các bộ kiểm thử tự động) đều do các AI coding agent tự động thiết kế, triển khai và tái cấu trúc thông qua prompt engineering.
> - **Khuyến cáo cẩn trọng**: Mặc dù dự án đã vượt qua hệ thống kiểm thử tự động, linter và cơ chế lọc che giấu secret 2 lớp (13 mẫu regex và 23 khóa thuộc tính bảo mật), mã nguồn AI vẫn có thể tiềm ẩn những lỗi ngoại lệ (edge cases) chưa lường hết. **Luôn thử nghiệm trên profile Chrome riêng biệt (sandbox) hoặc môi trường non-production** trước khi cho phép AI toàn quyền thao tác trên các phiên làm việc hoặc tài khoản quan trọng.
> - **Tuyên bố miễn trừ trách nhiệm (Disclaimer)**: Phần mềm được cung cấp theo nguyên trạng **"AS IS"**, không có bất kỳ sự đảm bảo nào. Trong mọi trường hợp, tác giả và các cộng tác viên không chịu trách nhiệm pháp lý hay tài chính đối với bất kỳ thiệt hại dữ liệu, lỗi trình duyệt, tài khoản bị khoá hay các thao tác ngoài ý muốn do AI Agent gây ra khi dùng công cụ này.

---

## 🎯 Giới Thiệu & Bộ Công Cụ Kiểm Thử, QA/QC, Debug Web

**Agent Pilot** ban đầu được phát triển phục vụ mục đích cá nhân nhằm **thay thế Chrome MCP mặc định trên Google Antigravity**, đồng thời chấm dứt tình trạng **AI Agent phải tự sinh code Python để thao tác trình duyệt hoặc vẽ chữ/chú thích lên hình ảnh** trong quá trình kiểm thử web.

Dự án giúp các AI Coding Agent và kỹ sư QA/QC **điều khiển trình duyệt thuận tiện, tốn ít token nhất**, đồng thời trang bị trọn bộ công cụ chuyên dụng cho **Kiểm thử Web (Web Testing), QA/QC và Debug ứng dụng Web**:

- **Tiết Kiệm Tối Đa Token (>50% Savings)**: Cây DOM tương tác được rút gọn thông minh (`@1`, `@2`) cùng cơ chế thực thi gộp lệnh (Batch Execution) giảm hơn 50% lượng token tiêu thụ trên cả hai chế độ **Skills + CLI** và **MCP**.
- **Chụp Màn Hình & Ghi Chú Thích (Annotated Screenshots & Set-of-Marks)**: Chụp vùng nhìn thấy, toàn trang (full-page) hoặc từng phần tử; tự động khoanh vùng highlight lỗi, dán nhãn số Set-of-Marks (@1, @2...) không làm biến dạng DOM, và đóng dấu tiêu đề báo cáo QA.
- **Quay Video Luồng Thao Tác (Video Recording)**: Ghi lại video `.mp4` toàn bộ quá trình kiểm thử tự động và tái hiện lỗi (bao gồm quỹ đạo chuột ảo neon và hiệu ứng sóng click).
- **Ghi Nhận, Replay Thao Tác & Xuất Code Playwright**: Ghi lại chuỗi tương tác thực tế của người dùng hoặc AI, phát lại (replay) kịch bản tức thì và xuất trực tiếp ra mã nguồn kiểm thử **Playwright** hoàn chỉnh.
- **Đo Lường Performance & Kiểm Định Lighthouse**: Chạy kiểm định Lighthouse thực tế, đo các chỉ số Core Web Vitals (LCP, CLS, INP) và phân tích performance trace.
- **Tìm Memory Leak (V8 Heap Snapshot Diff)**: Chụp và so sánh đối chiếu các bản chụp bộ nhớ V8 Heap trước/sau thao tác để phát hiện rò rỉ bộ nhớ và các node DOM bị treo.
- **Debug Web Chuyên Sâu & Bảo Mật Secret**: Bắt lỗi Console thời gian thực, lọc các truy vấn mạng lỗi (HTTP 4xx/5xx), soi thuộc tính CSS thực tế và tự động che giấu thông tin nhạy cảm qua 2 lớp (13 mẫu regex và 23 khóa thuộc tính).
- **Feedback Studio & Chạy Ngầm Đa Agent**: Ghim chú thích lỗi trực tiếp lên giao diện web, lấy mã màu pixel chuẩn xác, và gom tab tự động vào nhóm riêng (`🤖 Agent Pilot`) không bao giờ cướp chuột của lập trình viên.

### ⚖️ Điểm Khác Biệt Giữa Agent Pilot & Chrome MCP Thông Thường

| Tiêu chí so sánh | Chrome MCP Thông Thường | 🚀 Agent Pilot |
| :--- | :--- | :--- |
| **Phương thức kết nối & Chi phí Token** | Chỉ hỗ trợ MCP; cấu trúc JSON-RPC và cây DOM thô tiêu tốn rất nhiều token ngữ cảnh. | Hỗ trợ song song cả **Skills + CLI** (tiết kiệm >50% token) lẫn **MCP Server**; rút gọn phần tử thành nhãn `@1, @2` và hỗ trợ gộp lệnh (Batch Execution). |
| **Chụp ảnh & Vẽ chú thích báo cáo QA** | Chỉ chụp ảnh màn hình thô; AI thường phải tự sinh code Python (`Pillow`/`OpenCV`) tạm bợ để vẽ chữ hoặc khoanh vùng lỗi lên ảnh. | **Tích hợp sẵn chụp ảnh kèm chú thích** (khung nhìn, full-page, từng phần tử), tự động vẽ khung viền highlight đỏ và đóng dấu tiêu đề báo cáo mà không cần sinh script Python. |
| **Phiên trình duyệt & Chạy ngầm** | Thường mở cửa sổ trình duyệt mới (mất trạng thái đăng nhập) hoặc liên tục cướp chuột/focus màn hình khi đang làm việc. | Chạy trực tiếp trên trình duyệt Chrome đang mở (giữ nguyên cookie/phiên đăng nhập), tự động gom tab vào nhóm riêng (`🤖 Agent Pilot`) chạy ngầm không cướp focus. |
| **Quay Video, Replay & Xuất Playwright** | Chỉ thực thi từng lệnh rời rạc, không có cơ chế lưu lại thao tác hay sinh mã kiểm thử tự động. | Quay trực tiếp video `.mp4` (kèm chuột ảo neon), ghi nhận & **Replay** lại kịch bản kiểm thử, và **xuất trực tiếp ra code Playwright**. |
| **Debug chuyên sâu & Bảo mật Secret** | Chủ yếu dừng ở thao tác DOM cơ bản và đọc log thô. | Tích hợp đo Core Web Vitals, chạy **Lighthouse**, so sánh **V8 Heap Diff** tìm Memory Leak, **Feedback Studio** ghim lỗi trên trang và tự động che giấu secret qua 2 lớp (13 mẫu regex + 23 khóa nhạy cảm). |

### 🧭 Định Hướng Trong Tương Lai

> **Ưu tiên sự ổn định**: Hiện tại bộ tính năng của Agent Pilot đã đáp ứng trọn vẹn nhu cầu điều khiển trình duyệt, kiểm thử QA/QC và debug web. **Mục tiêu trong tương lai của dự án là đảm bảo các tính năng hiện có hoạt động ổn định, tin cậy**, chưa có dự định phát triển thêm tính năng mới.

---

## 🚀 Cài Đặt & Khởi Động Nhanh

Agent Pilot cung cấp ba phương thức cài đặt:

1. **🌟 Bộ Cài Đặt Theo Hệ Điều Hành (Khuyến Nghị)**: Tải gói phát hành riêng cho hệ điều hành của bạn kèm script cài đặt 1 bước (`./install.sh` hoặc `.\install.ps1`). Tự động cấu hình PATH và dịch vụ chạy ngầm (`systemd` / `launchd` / Windows service).
2. **⚡ Cài Đặt Nhanh Cho AI Agent (`npx skills add`)**: Cài đặt tức thì chỉ với 1 dòng lệnh terminal cho các trợ lý AI coding (Claude Code, Cursor, Windsurf, Antigravity, OpenCode, Codex). *Lưu ý:* Gói đa nền tảng này chứa sẵn binary biên dịch cho **cả 3 hệ điều hành** (Linux, macOS, Windows) trong thư mục `skills/agent-pilot/scripts/`.
3. **🛠️ Tự Biên Dịch Từ Mã Nguồn (Source Code)**: Dành cho lập trình viên muốn nghiên cứu, tùy biến backend Go hoặc tính năng Chrome extension.

---

### Bước 1: Cài Đặt Bằng Bộ Cài Theo Hệ Điều Hành (Khuyên Dùng)

Tải gói cài đặt tối ưu cho hệ điều hành của bạn:

| Hệ Điều Hành | Gói Phát Hành | Lệnh Cài Đặt Tự Động | Hướng Dẫn |
| :--- | :--- | :--- | :--- |
| 🐧 **Ubuntu / Linux** | `agent-pilot-*-linux.zip` | `./install.sh` | [README.ubuntu.md](docs/vi/bundles/README.ubuntu.md) |
| 🍎 **macOS** | `agent-pilot-*-macos.zip` | `./install.sh` | [README.macos.md](docs/vi/bundles/README.macos.md) |
| 🪟 **Windows** | `agent-pilot-*-windows.zip` | `powershell -ExecutionPolicy Bypass -File .\install.ps1` | [README.windows.md](docs/vi/bundles/README.windows.md) |

Script cài đặt sẽ đưa binary vào `PATH` và khởi động dịch vụ chạy ngầm:
```bash
agent-pilot service status
```

### Bước 2: Nạp Extension vào Chrome
1. Mở Chrome → `chrome://extensions` → bật **Developer mode**.
2. Bấm **Load unpacked** → chọn thư mục `extensions/` và ghim biểu tượng **Agent Pilot (📌)**.

### Bước 3: Kết Nối Với AI Agent

#### Cách A: Cài Đặt Nhanh Chuẩn Agent Skills ([skills.sh](https://skills.sh/))
```bash
npx skills add https://github.com/ducconit/agent-pilot -g --all
```
*(Gói đa nền tảng chứa sẵn binary cho Linux, macOS và Windows).*

#### Cách B: Cấu Hình MCP Server (`stdio`)
Thêm vào `claude_desktop_config.json`, `~/.gemini/antigravity/mcp/` hoặc Cursor Settings:
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

#### Cách C: Tự Biên Dịch Từ Mã Nguồn (Dành Cho Nhà Phát Triển)
```bash
git clone https://github.com/ducconit/agent-pilot.git
cd agent-pilot
go build -o bin/agent-pilot ./cli/cmd/agent-pilot
./bin/agent-pilot service install
```

---

## 💻 Sử Dụng Nhanh (CLI Cheat Sheet)

```bash
# Mở tab mới ngầm (không cướp focus màn hình)
agent-pilot open "http://localhost:3000" --format json

# Trích xuất bản đồ tương tác siêu nhẹ (@1, @2...)
agent-pilot snapshot --tab 12345

# Thao tác chuột và bàn phím
agent-pilot click "@1" --tab 12345
agent-pilot type "@2" "test@example.com" --enter --tab 12345

# Chụp ảnh màn hình đính kèm khung viền nổi bật
agent-pilot screenshot -o step1.png --highlight "@1" --title "Đăng nhập"

# Kiểm tra lỗi console & runtime exceptions qua CDP
agent-pilot console errors --tab 12345

# Đóng tab và giải phóng tài nguyên
agent-pilot close --tab 12345
```

---

## 📚 Hệ Thống Tài Liệu Kỹ Thuật

- 🏛️ **[Kiến trúc Hệ thống (ARCHITECTURE.md)](docs/vi/ARCHITECTURE.md)**: Thiết kế Manifest V3, IPC Bridge và cơ chế cách ly tiến trình.
- 🤖 **[Tích hợp Antigravity & MCP](docs/vi/ANTIGRAVITY_INTEGRATION.md)**: Hướng dẫn kết nối toàn diện với AI coding agents.
- ⚡ **[Sổ tay Chrome DevTools Protocol](docs/vi/CDP_GUIDE.md)**: Tương tác cấp thấp CDP, Network, Console và Trusted Input.
- 🔬 **[Bộ công cụ DevTools Nâng Cao](docs/vi/DEVTOOLS.md)**: Lighthouse audit, heap snapshot, tracing, video screencast.
- 📖 **[Sổ tay Sử dụng Đầy đủ (USAGE_GUIDE.md)](docs/vi/USAGE_GUIDE.md)**: Hướng dẫn chi tiết từng tính năng cho người dùng và QA.
- 📊 **[Đo Lường Hiệu Năng MCP vs CLI](docs/vi/BENCHMARKS.md)**: Báo cáo thực nghiệm so sánh token, độ trễ và video demo.
- 📦 **[Hướng dẫn Cài đặt theo OS (BUNDLE_README.md)](docs/vi/BUNDLE_README.md)**: Chi tiết thiết lập cho Linux, macOS và Windows.

---

## 🤝 Đóng Góp & Phát Triển

- 🛠️ [Hướng dẫn đóng góp (CONTRIBUTING.md)](CONTRIBUTING.md)
- 📜 [Bộ quy tắc ứng xử (CODE_OF_CONDUCT.md)](CODE_OF_CONDUCT.md)
- 🛡️ [Chính sách bảo mật (SECURITY.md)](SECURITY.md)

---

## ⚠️ Tuyên Bố Miễn Trừ Trách Nhiệm & Vibe Coding

**Agent Pilot được phát triển 100% bằng hình thức Vibe Coding cùng Google Antigravity.**
- **Không qua code thủ công**: Toàn bộ kiến trúc, dòng lệnh CLI và script extension được AI tổng hợp thông qua các prompt ngôn ngữ tự nhiên.
- **Khuyến nghị môi trường Sandbox**: Các tác vụ tự động hóa có thể tương tác DOM, thay đổi trạng thái form, gửi request hoặc tải tệp. Hãy luôn chạy trên thư mục người dùng riêng biệt (`--user-data-dir`).
- **Miễn trừ trách nhiệm**: Nhóm phát triển không chịu trách nhiệm với bất kỳ giao dịch ngoài ý muốn, sửa đổi dữ liệu hay lỗi phát sinh từ hành động của AI Agent khi vận hành Agent Pilot.

---

## 📄 Bản Quyền & Giấy Phép

Phát hành theo giấy phép mã nguồn mở [MIT License](LICENSE).
Copyright (c) 2026 **DNT** ([@ducconit](https://github.com/ducconit)) & Agent Pilot Contributors.
