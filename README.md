<div align="center">

![Agent Pilot Banner](assets/banner.svg)

# 🚀 AGENT PILOT
### Universal AI Agent Browser Controller • Antigravity-First

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue?style=for-the-badge&logo=googlechrome)](extentions/manifest.json)
[![Antigravity First](https://img.shields.io/badge/AI%20Agent-Antigravity--First-8b5cf6?style=for-the-badge)](docs/ANTIGRAVITY_INTEGRATION.md)
[![CDP Protocol](https://img.shields.io/badge/Engine-Chrome%20DevTools%20Protocol-06b6d4?style=for-the-badge)](docs/CDP_GUIDE.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

<p align="center">
  <b>Agent Pilot</b> là tiện ích mở rộng Google Chrome (Manifest V3) đột phá, được thiết kế chuyên biệt để giúp <b>mọi AI Agent</b> (ưu tiên tối ưu hóa cho <b>Antigravity</b>) có thể quan sát, phân tích và điều khiển trình duyệt một cách mượt mà, an toàn và trực quan nhất.
</p>

[✨ Tính năng chính](#-tính-năng-cốt-lõi) • [🚀 Cài đặt nhanh](#-hướng-dẫn-cài-đặt-nhanh) • [🧪 Trang thử nghiệm](#-phòng-thí-nghiệm-kiểm-thử-test-page) • [📚 Tài liệu chi tiết](#-hệ-thống-tài-liệu-chuyên-sâu)

---

</div>

## 🌟 Tính Năng Cốt Lõi

| Tính Năng | Biểu Tượng | Mô Tả Kỹ Thuật |
| :--- | :---: | :--- |
| **Điều khiển Trình duyệt** | 🌐 | Mở tab mới, điều hướng URL, reload, chuyển đổi và đóng tab linh hoạt. |
| **Mô phỏng Chuột ảo** | 🖱️ | Con trỏ đồ họa neon bay mượt mà trên màn hình, phát sóng click ripple và chuỗi sự kiện DOM hoàn chỉnh. |
| **Tự động Gõ chữ** | ⌨️ | Focus vào ô nhập liệu và gõ văn bản từng ký tự theo thời gian thực (Human-like Typing). |
| **Giám sát DevTools (CDP)** | ⚡ | Kết nối cấp thấp qua Chrome DevTools Protocol để bắt trọn `console.log/error`, `Network traffic` và `Performance RAM/DOM`. |
| **Soi & Lấy vị trí DOM** | 🎯 | Bắt dính phần tử khi hover, hiển thị kích thước `W × H`, tọa độ `(X, Y)`, trích xuất **CSS Selector** và **XPath**. |
| **Trích xuất Mã màu** | 🎨 | Kính lúp pixel nhặt màu chính xác (HEX, RGB, HSL), tự động copy và lưu khay lịch sử màu sắc. |
| **Bộ Chụp Màn Hình** | 📸 | Hỗ trợ 3 chế độ: Chụp toàn khung nhìn, Kéo chọn vùng cắt tùy ý (Crop), và Chụp riêng phần tử DOM đã khóa. |
| **Tương thích Antigravity** | 🤖 | Tích hợp sẵn bộ chạy kịch bản **JSON Action**, cầu nối `window.__AGENT_PILOT__` và chuẩn hóa cho Antigravity MCP Tools. |

---

## 🏗️ Cấu Trúc Thư Mục Dự Án

Dự án được tổ chức khoa học và tuân thủ tuyệt đối các yêu cầu về đường dẫn:

```
browser-control/
├── assets/                             # Tài nguyên đồ họa & nhận diện thương hiệu
│   ├── banner.svg                      # Banner giới thiệu công nghệ cao
│   └── logo.svg                        # Logo vector gốc của Agent Pilot
├── docs/                               # Bộ tài liệu kỹ thuật chuyên sâu
│   ├── ANTIGRAVITY_INTEGRATION.md      # Hướng dẫn tích hợp Antigravity First & MCP
│   ├── ARCHITECTURE.md                 # Kiến trúc chi tiết Manifest V3 & IPC
│   ├── CDP_GUIDE.md                    # Hướng dẫn Chrome DevTools Protocol (CDP)
│   ├── API_REFERENCE.md                # Danh mục tin nhắn & đặc tả JSON Action
│   └── USAGE_GUIDE.md                  # Sổ tay hướng dẫn sử dụng từng tính năng
├── extentions/                         # Toàn bộ mã nguồn Chrome Extension (Manifest V3)
│   ├── manifest.json                   # Cấu hình chuẩn Chrome Extension MV3
│   ├── background.js                   # Service Worker: CDP, Tab Manager, Screenshot Engine
│   ├── content.js                      # Content Script: Chuột ảo, Inspector, Crop, Bridge
│   ├── content.css                     # Stylesheet cho con trỏ, sóng ripple, highlight box
│   ├── sidepanel.html                  # Giao diện trung tâm điều khiển Side Panel
│   ├── sidepanel.js                    # Bộ xử lý sự kiện realtime, DevTools charts, Actions
│   ├── sidepanel.css                   # Giao diện Modern Dark Tech Cyberpunk
│   ├── popup.html                      # Popup tiện ích khởi động nhanh
│   ├── popup.js                        # Xử lý sự kiện popup
│   ├── popup.css
│   └── icons/                          # Bộ icon nhận diện chuẩn các kích thước
│       ├── icon.svg
│       ├── icon16.png
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png
├── test-page.html                      # Trang web tương tác phục vụ kiểm thử tức thì
└── README.md                           # Tài liệu giới thiệu dự án
```

---

## 🚀 Hướng Dẫn Cài Đặt Nhanh

### Bước 1: Mở Quản lý Tiện ích trên Chrome
Truy cập đường dẫn sau trên trình duyệt Chrome:
```text
chrome://extensions
```

### Bước 2: Bật Chế độ Nhà phát triển & Tải Extension
1. Gạt bật công tắc **Developer mode** ở góc trên cùng bên phải.
2. Nhấp nút **Load unpacked** (Tải tiện ích đã giải nén) ở góc trên bên trái.
3. Chọn đường dẫn thư mục `extentions` của dự án:
   ```text
   /home/ubuntu/workspace/projects/browser-control/extentions
   ```

### Bước 3: Khởi động Bảng điều khiển (Side Panel)
* Nhấn phím tắt nhanh: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> (hoặc <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> trên Mac).
* Hoặc nhấp vào biểu tượng Agent Pilot trên thanh công cụ và chọn **🚀 Mở Bảng Điều Khiển (Side Panel)**.

---

## 🧪 Phòng Thí Nghiệm Kiểm Thử (`test-page.html`)

Dự án có sẵn tệp `test-page.html` được thiết kế đặc biệt để bạn kiểm nghiệm toàn bộ các tính năng ngay lập tức mà không cần internet:

1. Kéo thả tệp `test-page.html` vào trình duyệt Chrome (hoặc mở bằng URL `file:///home/ubuntu/workspace/projects/browser-control/test-page.html`).
2. Mở **Agent Pilot Side Panel**:
   - Thử nghiệm **Chuột ảo**: Di chuyển chuột đến nút *"🎯 Click vào đây!"* và nhấp click.
   - Thử nghiệm **Tự động gõ chữ**: Điền nội dung vào ô `#test-search-input`.
   - Thử nghiệm **DevTools**: Nhấp các nút sinh `console.log`, `warn`, `error` hoặc nút gửi API để thấy nhật ký và network nhảy tức thì trong Side Panel.
   - Thử nghiệm **Lấy màu**: Bật nút lấy mã màu và nhặt màu từ dải các ô màu rực rỡ trên trang.
   - Thử nghiệm **Chụp ảnh**: Thử chụp toàn màn hình, kéo khung crop box hoặc chụp riêng khối `#inspector-special-box`.

---

## 📡 Kết Nối AI Agent Trực Tiếp (Cổng 58765 & Chuẩn MCP)

Agent Pilot trang bị sẵn máy chủ WebSocket & MCP Server tại cổng chuyên dụng **`58765`** (thuộc dải cổng riêng tư IANA `49152 – 65535`, chống trùng lặp hoàn toàn với các cổng dev phổ biến như 3000, 5000, 8000, 8080,...):

1. **Khởi chạy Bridge Server**:
   ```bash
   npm run server
   ```
2. **Kiểm thử tự động kết nối AI Agent điều khiển Trình duyệt**:
   ```bash
   npm run test:agent
   ```
   *(Bộ test tự động hóa E2E kiểm chứng 12/12 tính năng Agent điều khiển Chrome qua cổng 58765 đạt 100% PASS).*
3. **Cấu hình Antigravity MCP**: Xem hướng dẫn 1-click tại [docs/ANTIGRAVITY_INTEGRATION.md](docs/ANTIGRAVITY_INTEGRATION.md).

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

## 📄 Bản Quyền & Giấy Phép

Dự án được phát hành theo giấy phép mã nguồn mở [MIT License](LICENSE).
Tương thích hoàn hảo với Antigravity, Chrome 116+ (hỗ trợ đầy đủ Side Panel API).
