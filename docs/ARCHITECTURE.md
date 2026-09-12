# 🏛️ Tài Liệu Kiến Trúc Kỹ Thuật (Agent Pilot)

**Agent Pilot** được thiết kế dựa trên chuẩn **Google Chrome Extension Manifest V3 (MV3)**, tập trung vào hiệu năng cao, bảo mật vững chắc và tính tương thích mở rộng cho các hệ thống AI Agent tự động hóa.

---

## 1. Tổng quan Kiến trúc Đa tầng (Multi-Layer Architecture)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CHROME EXTENSION RUNTIME                           │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     GIAO DIỆN NGƯỜI DÙNG (UI LAYER)                   │  │
│  │                                                                       │  │
│  │   ┌────────────────────────────────┐   ┌───────────────────────────┐  │  │
│  │   │  Side Panel (sidepanel.html)   │   │    Popup (popup.html)     │  │  │
│  │   │  - Giám sát DevTools realtime  │   │  - Khởi động nhanh        │  │  │
│  │   │  - Điều khiển chuột ảo (X, Y)  │   │  - Chụp ảnh 1-click       │  │  │
│  │   │  - Trình chạy JSON Action      │   │  - Mở Side Panel          │  │  │
│  │   └───────────────┬────────────────┘   └─────────────┬─────────────┘  │  │
│  └───────────────────┼──────────────────────────────────┼────────────────┘  │
│                      │                                  │                   │
│                      │ chrome.runtime.sendMessage       │                   │
│                      ▼                                  ▼                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                 BACKGROUND TỔNG THỂ (SERVICE WORKER)                  │  │
│  │                       (extensions/background.js)                      │  │
│  │                                                                       │  │
│  │   ┌────────────────────────┐  ┌────────────────────────────────────┐  │  │
│  │   │  Quản lý Tab Trình Duyệt│  │  Điều Phối Chrome DevTools (CDP)   │  │  │
│  │   │  - create, update,     │  │  - Console.enable, Network.enable  │  │  │
│  │   │    reload, close       │  │  - Performance.getMetrics          │  │  │
│  │   └────────────────────────┘  └────────────────────────────────────┘  │  │
│  │   ┌────────────────────────┐  ┌────────────────────────────────────┐  │  │
│  │   │  Bộ Chụp Ảnh Màn Hình  │  │  Định Tuyến Thông Điệp Agent       │  │  │
│  │   │  - Visible Tab Capture │  │  - Agent Control Protocol (ACP)    │  │  │
│  │   │  - Crop Canvas Engine  │  │  - Event Broadcast tới UI views   │  │  │
│  │   └────────────────────────┘  └────────────────────────────────────┘  │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│                                      │ chrome.tabs.sendMessage / CDP        │
│                                      ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                  NGỮ CẢNH TRANG WEB (CONTENT SCRIPT)                  │  │
│  │                  (extensions/content.js & content.css)                │  │
│  │                                                                       │  │
│  │   ┌────────────────────────┐  ┌────────────────────────────────────┐  │  │
│  │   │  Lớp Chuột Ảo SVG      │  │  Bộ Soi Phần Tử DOM                │  │  │
│  │   │  - Con trỏ neon tọa độ │  │  - Bounding rect, CSS Selector     │  │  │
│  │   │  - Sóng click ripple   │  │  - XPath, computed styles          │  │  │
│  │   └────────────────────────┘  └────────────────────────────────────┘  │  │
│  │   ┌────────────────────────┐  ┌────────────────────────────────────┐  │  │
│  │   │  Vùng Kéo Chọn Crop Box│  │  Cầu Nối window.__AGENT_PILOT__    │  │  │
│  │   │  - Overlay kéo thả     │  │  - API toàn cục cho Antigravity    │  │  │
│  │   │  - Eyedropper màu sắc  │  │    và các test runner tự động hóa  │  │  │
│  │   └────────────────────────┘  └────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Các Thành phần Kỹ thuật Cốt lõi

### 2.1 Background Service Worker (`background.js`)
- **Mô hình Event-Driven**: Tuân thủ nghiêm ngặt chuẩn MV3, Service Worker tự động đi vào trạng thái nghỉ (idle) khi không có tác vụ và thức dậy ngay khi nhận sự kiện từ hệ thống Chrome hoặc tin nhắn.
- **Quản trị Chrome DevTools Protocol (CDP)**:
  - Sử dụng API cấp thấp `chrome.debugger.attach({ tabId }, "1.3")` để kết nối vào luồng debug nội bộ của trình duyệt.
  - Khởi tạo bộ đệm sự kiện vòng tròn (Circular Buffer) cho từng tab riêng biệt, lưu trữ tối đa 500 console logs và 100 network requests để không gây rò rỉ bộ nhớ.
  - Phân tích và phát sóng (broadcast) các sự kiện `Runtime.consoleAPICalled`, `Console.messageAdded`, `Network.requestWillBeSent`, `Network.responseReceived` trực tiếp tới Side Panel.

### 2.2 Content Script & In-Page Engine (`content.js`, `content.css`)
- **Môi trường cách ly (Isolated World)**: Content Script hoạt động an toàn trong không gian tên độc lập với JavaScript của trang web mục tiêu, ngăn chặn nguy cơ xung đột mã thư viện hoặc bị can thiệp bởi mã độc trên trang.
- **Lớp Chuột ảo (Virtual Mouse Layer)**:
  - Con trỏ chuột ảo là một thành phần đồ họa vector SVG độc lập gắn vào `document.documentElement` với `z-index: 2147483647`.
  - Thuật toán nội suy chuyển động (Cubic Ease-Out Interpolation) mô phỏng chính xác đường bay tự nhiên của chuột máy tính con người.
  - Chuỗi kích hoạt sự kiện DOM đầy đủ (`pointerdown` -> `mousedown` -> `pointerup` -> `mouseup` -> `click`) đảm bảo tương thích 100% với các framework hiện đại (React, Vue, Angular).
- **Bộ Soi Phần tử (Element Inspector)**:
  - Khung bao hiển thị (Highlight Box) và Tooltip nổi định vị động theo tọa độ Viewport.
  - Tự động xây dựng chuỗi CSS Selector độc nhất và cây biểu thức XPath chuẩn.

### 2.3 Giao diện Thanh bên (Side Panel API)
- Khác với giao diện Popup truyền thống bị tự động đóng khi người dùng click chuột ra ngoài trang web, **Side Panel API** (`chrome.sidePanel`) giữ cho bảng điều khiển luôn mở song song bên cạnh tab web.
- Điều này cho phép AI Agent và lập trình viên vừa theo dõi con trỏ chuột ảo di chuyển trên trang web, vừa nhìn thấy trực tiếp console logs và network requests đổ về theo thời gian thực mà không bị gián đoạn.

---

## 3. Cơ chế Bảo mật & Phân quyền (Permissions & Security)

| Quyền hạn | Mục đích kỹ thuật |
| :--- | :--- |
| `debugger` | Kết nối Chrome DevTools Protocol để đọc logs console, network và đo performance |
| `tabs` | Quản lý danh sách tab, mở tab mới, điều hướng URL và đóng tab |
| `activeTab` | Cho phép content script tương tác với tab người dùng đang làm việc |
| `scripting` | Chèn mã xử lý tự động hóa khi cần thiết |
| `sidePanel` | Hiển thị bảng điều khiển cố định bên hông trình duyệt |
| `storage` | Lưu trữ cấu hình cá nhân hóa và lịch sử mã màu đã nhặt |
| `host_permissions: ["<all_urls>"]` | Đảm bảo chuột ảo và công cụ soi phần tử có thể hoạt động trên mọi trang web (kể cả `localhost`) |
