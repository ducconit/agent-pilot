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
# 1. Kiểm tra cú pháp (Syntax & Lint Check trên toàn bộ 25+ tệp mã nguồn)
npm run lint

# 2. Chạy bộ kiểm thử 15 tính năng cốt lõi của Extension (DOM, Chuột ảo, CDP, Inspector, Eyedropper, Screenshot)
npm test

# 3. Chạy bộ kiểm thử kết nối AI Agent & 29 kịch bản điều khiển qua cổng 58765
npm run test:agent

# 4. Kiểm thử độc lập lớp lọc Secret & API Key Redaction
node scripts/verify_secret_sanitizer.mjs

# 5. Kiểm thử đóng gói bản phát hành
npm run pack
```

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
