# 🤝 Hướng Dẫn Đóng Góp (Contributing to Agent Pilot)

Chào mừng bạn đến với cộng đồng nguồn mở **Agent Pilot**! Chúng tôi trân trọng mọi hình thức đóng góp: từ báo cáo lỗi (Bug Report), đề xuất tính năng (Feature Request), cải thiện tài liệu đến gửi Pull Request (PR) trực tiếp.

> ⚠️ **Lưu ý về Giai đoạn Phát triển**: Hiện tại Agent Pilot đang trong giai đoạn **Bản Thử Nghiệm (Public Beta)**. Mọi đóng góp thử nghiệm, tối ưu hóa hiệu năng, cải tiến trải nghiệm người dùng và mở rộng công cụ MCP đều vô cùng quý giá!

---

## 📜 Bộ Quy Tắc Ứng Xử (Code of Conduct)
Dự án tuân thủ bộ quy tắc [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). Xin vui lòng tôn trọng, cởi mở và xây dựng một môi trường hòa đồng, lịch sự cho tất cả mọi người.

---

## 🚀 Bắt Đầu Phát Triển Cục Bộ (Local Development Setup)

### 1. Yêu Cầu Môi Trường
- **Node.js**: v18.0.0+ (Khuyến nghị Node.js 22 LTS).
- **npm**: v9.0.0+.
- **Trình duyệt**: Google Chrome 116+ (hỗ trợ Side Panel API), Chromium, Brave hoặc Microsoft Edge.
- **Hệ điều hành**: Windows 10/11, macOS, hoặc Linux (Ubuntu, Debian, Fedora...).

### 2. Cài Đặt Mã Nguồn
```bash
# Clone kho lưu trữ
git clone git@github.com:ducconit/agent-pilot.git
cd agent-pilot

# Cài đặt các gói phụ thuộc
npm install
```

### 3. Nạp Extension Lên Trình Duyệt (Load Unpacked)
1. Mở trình duyệt Chrome và truy cập: `chrome://extensions`.
2. Bật công tắc **Developer mode** ở góc trên cùng bên phải.
3. Nhấp nút **Load unpacked** và chọn thư mục `extensions/` trong dự án.
4. Tiện ích **Agent Pilot (Beta) - AI Browser Controller** sẽ xuất hiện tức thì!
5. Khi bạn chỉnh sửa mã nguồn trong thư mục `extensions/`, chỉ cần nhấp nút 🔄 **Reload** trên trang quản lý extension để cập nhật.

---

## 🧪 Quy Trình Kiểm Thử & Đảm Bảo Chất Lượng

Dự án trang bị hệ thống kiểm thử tự động toàn diện trên trình duyệt thật (Chromium):

```bash
# 1. Kiểm tra cú pháp (Syntax & Lint Check trên toàn bộ 160+ tệp mã nguồn)
npm run lint

# 2. Chạy toàn bộ Unit Tests siêu tốc (Browserless: Secret Sanitizer, Schema XSS, Color Utils, Background API, Recorder)
npm run test:unit

# 3. Chạy bộ kiểm thử 16 tính năng cốt lõi của Extension trên Chromium thật (DOM, Chuột ảo, CDP, Inspector, Eyedropper, Screenshot)
npm test

# 4. Chạy bộ kiểm thử kết nối AI Agent & 29 kịch bản điều khiển qua cổng 58765
npm run test:agent

# 5. Chạy bộ kiểm thử Go CLI & Race Detector
npm run test:cli

# 6. Kiểm thử đóng gói bản phát hành
npm run pack
```

### 📂 Phân Nhóm Kiểm Thử (Test Groups)

Bộ test suite trong thư mục `./test/` được phân tách theo từng miền chức năng rõ rệt, cho phép chạy độc lập:

| Nhóm Kiểm Thử | Lệnh Chạy | Mô Tả |
| :--- | :--- | :--- |
| **Unit (Toàn bộ)** | `npm run test:unit` | 7 tệp kiểm thử đơn vị thuần Node.js, không cần mở trình duyệt (~1s) |
| **Unit: Security** | `npm run test:unit:security` | Lớp lọc bảo mật Secret/API Key Redaction & Schema chống XSS |
| **Unit: Core** | `npm run test:unit:core` | Background API handlers, Color Utils, Recorder State Machine |
| **Unit: Harness** | `npm run test:unit:harness` | Khởi tạo cờ Chrome & dọn dẹp static server |
| **E2E: Core** | `npm run test:group:core` *(hoặc `npm test`)* | 16 tính năng cốt lõi (DOM, cursor, CDP, sidepanel, tab group isolation) |
| **E2E: Bridge** | `npm run test:group:bridge` | Kết nối AI Agent WebSocket port 58765 & 29 kịch bản |
| **E2E: Feedback** | `npm run test:group:feedback` | Feedback Studio, Annotator vẽ hộp/ghim điểm, edit/delete |
| **E2E: DevTools** | `npm run test:group:devtools` | DevTools protocol, Lighthouse, phân tích JS Heap rò rỉ bộ nhớ |
| **E2E: Protocols** | `npm run test:group:protocols` | Khai báo & thực thi WebMCP, Chrome PWA Adapter |
| **Platform** | `npm run test:group:platform` | Cú pháp PowerShell, UTF-8 BOM và xuống dòng CRLF cho Windows |
| **All-in-One** | `npm run test:all` | Chạy toàn diện Go CLI + Unit Tests + E2E Suites |

> ⚠️ **Nguyên tắc vàng**: Mọi PR bắt buộc phải vượt qua toàn bộ `npm run lint` và `npm test` mà không có bất kỳ lỗi hay cảnh báo nào trước khi được xem xét hợp nhất.

---

## 🏛️ Quy Chuẩn Kiến Trúc Mã Nguồn

Dự án được phân tách theo mô hình module hóa sạch (Clean Modular Architecture):
- **`extensions/background/`**: Dịch vụ nền Manifest V3 (Service Worker). Chứa các module chuyên biệt: `cdp-manager.js`, `tab-manager.js`, `secret-sanitizer.js`, `screenshot-service.js`, `batch-executor.js`, `bridge-client.js`.
- **`extensions/content/`**: Tương tác DOM trực tiếp: `toast.js`, `lock-shield.js`, `cursor-simulator.js`, `dom-inspector.js`, `eyedropper.js`.
- **`extensions/sidepanel/`**: Giao diện người dùng Side Panel: `ui-helpers.js`, `agent-monitor.js`, `inspector-panel.js`, `screenshot-panel.js`.
- **`mcp/agent-pilot/`**: Nguồn chân lý duy nhất (Single Source of Truth - SSOT) định nghĩa 35 công cụ Model Context Protocol. Nếu bạn thêm hoặc chỉnh sửa công cụ MCP, hãy cập nhật trong `cli/mcp.go` rồi chạy `npm run export:mcp` để tự động đồng bộ.

---

## 📝 Quy Ước Cam Kết (Commit Message Conventions)

Chúng tôi áp dụng chuẩn **[Conventional Commits](https://www.conventionalcommits.org/)**:

```text
<loại-thay-đổi>(<phạm-vi>): <mô tả ngắn gọn bằng tiếng Anh hoặc tiếng Việt>

[Thân commit chi tiết nếu cần]
```

### Các loại thay đổi (Types):
- `feat`: Tính năng mới (ví dụ: `feat(inspector): add computed css subtab`).
- `fix`: Sửa lỗi (ví dụ: `fix(screenshot): resolve clipboard png blob copy error`).
- `docs`: Cập nhật tài liệu (ví dụ: `docs: update USAGE_GUIDE with 14 mcp tools`).
- `style`: Định dạng mã nguồn, CSS, khoảng trắng, không ảnh hưởng logic.
- `refactor`: Tái cấu trúc mã nguồn mà không thay đổi hành vi bên ngoài.
- `test`: Thêm hoặc bổ sung kiểm thử tự động.
- `chore`: Cập nhật quy trình build, package.json, CI/CD workflow.

---

## 📬 Quy Trình Gửi Pull Request (PR Workflow)

1. **Fork** repository trên GitHub về tài khoản của bạn.
2. Tạo nhánh mới từ `main` với tên mô tả rõ ràng:
   ```bash
   git checkout -b feat/your-feature-name
   # hoặc: git checkout -b fix/issue-description
   ```
3. Thực hiện thay đổi, tuân thủ kiến trúc và phong cách code hiện có.
4. Chạy kiểm thử xác minh:
   ```bash
   npm run lint && npm test
   ```
5. Commit thay đổi theo chuẩn Conventional Commits.
6. Push lên nhánh trên fork của bạn và mở **Pull Request** trỏ về nhánh `main` của repository gốc.
7. Điền đầy đủ thông tin vào mẫu checklist trong PR Template.
8. Quản trị viên dự án (**DNT** - [@ducconit](https://github.com/ducconit)) sẽ đánh giá PR và phản hồi trong thời gian sớm nhất!

Xin chân thành cảm ơn sự đồng hành và đóng góp của bạn cho **Agent Pilot**! 🚀
