# 💡 Prompt Mẫu & Kịch Bản Cho AI Agent (Prompt Recipes)

Tổng hợp các mẫu câu lệnh (prompt templates) thực chiến giúp bạn ra lệnh cho bất kỳ AI coding assistant hoặc công cụ tự động hóa nào (**Claude Code**, **Cursor**, **Windsurf**, **Google Antigravity**, **Cline / Roo Code**, **OpenCode**, **Codex**, **Aider**, v.v.) điều khiển trình duyệt thông qua **Agent Pilot**.

::: tip Tương Thích Đa Nền Tảng (Skills + CLI & MCP)
Dù công cụ của bạn hoạt động theo cơ chế **Agent Skills + Command Line (`agent-pilot` CLI)** hay **Model Context Protocol (`agent-pilot mcp`)**, các mẫu prompt ngôn ngữ tự nhiên dưới đây đều sử dụng giống hệt nhau.
:::

---

## 🎯 Cơ Chế Hoạt Động Của Prompt Với Agent Pilot

Khi bạn kết nối Agent Pilot vào AI Agent qua **Skills + Command Line (`npx skills add`)** hoặc **MCP (`mcp.json`)**, trợ lý AI sẽ tự động biết cách gọi lệnh CLI (`agent-pilot open`, `agent-pilot click`, `agent-pilot screenshot`) hoặc công cụ MCP (`browser_open_tab`, `page_click`, `page_screenshot`, `devtools_audit_lighthouse`).

Bạn chỉ cần diễn đạt yêu cầu bằng ngôn ngữ tự nhiên—AI Agent sẽ tự động phân tích DOM, mô phỏng thao tác người dùng và kiểm chứng kết quả thực tế trên trình duyệt Chrome.

---

## 📋 Danh Sách Prompt Mẫu Sẵn Sàng Sử Dụng

### 1. 🧪 Kiểm Thử Tự Động Toàn Diện (End-to-End Testing)

Sao chép và dán prompt sau vào khung chat của AI Coding Agent:

```markdown
Hãy dùng Agent Pilot để kiểm thử luồng đăng nhập của ứng dụng tại http://localhost:3000:
1. Mở URL trong một tab nền độc lập (background tab).
2. Soi form đăng nhập, điền tài khoản "demo@example.com" và mật khẩu "Password123!".
3. Bấm nút "Sign In" bằng mô phỏng chuột ảo mượt mà.
4. Xác minh giao diện Dashboard hiển thị thành công.
5. Chụp ảnh màn hình có chú thích lưu vào ./assets/login_verified.png để làm bằng chứng.
6. Kiểm tra xem có bất kỳ lỗi console hoặc request HTTP nào thất bại hay không.
```

---

### 2. 📸 Kiểm Tra Giao Diện Responsive & Bắt Lỗi Layout

```markdown
Kiểm tra độ tương thích responsive của trang landing page http://localhost:3000/:
1. Đổi kích thước màn hình sang 375x812 (iPhone X/13), chụp toàn bộ trang (full-page) và kiểm tra xem có bị tràn ngang (scrollWidth > innerWidth) hay không.
2. Đổi sang 768x1024 (iPad dọc), kiểm tra xem thanh menu đã tự động chuyển sang menu hamburger chưa.
3. Đổi sang 1440x900 (Desktop), kiểm tra căn chỉnh lưới sản phẩm và tỉ lệ ảnh banner.
4. Nếu phát hiện phần tử bị vỡ layout, hãy dùng agent-pilot screenshot --highlight <selector> (hoặc công cụ MCP page_screenshot với tham số highlightSelector) để khoanh vùng lỗi và đề xuất code CSS cần sửa.
```

---

### 3. 🔍 Điền Form & Trích Xuất Dữ Liệu Bảng (Data Extraction)

```markdown
Tự động hóa nhập liệu và trích xuất dữ liệu tại http://localhost:3000/admin/products:
1. Mở trang quản trị sản phẩm và chụp cây DOM tương tác (@1, @2, ...).
2. Bấm nút "Thêm Sản Phẩm Mới".
3. Điền các trường thông tin:
   - Tên sản phẩm: "Autonomous AI Agent Router"
   - Giá: "49.99"
   - Danh mục: Chọn "Developer Tools"
4. Gửi form và chờ thông báo Toast thành công xuất hiện.
5. Trích xuất ID sản phẩm vừa tạo và toàn bộ danh sách bảng thành tệp JSON có cấu trúc tại ./tmp/products.json.
```

---

### 4. ⚡ Đo Lường Hiệu Năng & Kiểm Định Lighthouse

```markdown
Chạy kiểm định hiệu năng chuyên sâu cho trang http://localhost:3000:
1. Thực thi kiểm định Lighthouse đầy đủ 4 hạng mục: Performance, Accessibility, Best Practices và SEO.
2. Tổng kết các chỉ số Core Web Vitals cốt lõi (LCP, FID/INP, CLS).
3. Nếu điểm Performance dưới 90, hãy soi biểu đồ tải mạng (network waterfall) để chỉ ra các file CSS/JS làm chặn render hoặc hình ảnh chưa nén.
4. Đề xuất các bước tối ưu hóa trực tiếp trong cấu hình Vite hoặc Next.js.
```

---

### 5. 🔬 Bắt Lỗi Rò Rỉ Bộ Nhớ (V8 Heap Leak Diagnostics)

```markdown
Kiểm tra xem Single Page Application của chúng ta có bị rò rỉ bộ nhớ (memory leak) khi chuyển trang không:
1. Mở http://localhost:3000/dashboard và chụp một snapshot bộ nhớ V8 Heap làm mốc chuẩn.
2. Mô phỏng chuyển đổi qua lại giữa trang "Dashboard" và "Analytics" 5 lần liên tiếp.
3. Chụp snapshot thứ hai và tính toán độ chênh lệch (heap delta) phân bổ đối tượng.
4. Báo cáo các node DOM bị cô lập (detached DOM nodes), timer setInterval chưa huỷ hoặc closure listener bị tích tụ.
```

---

### 6. 🛡️ Giám Sát Lỗi Network & Bảo Mật Dữ Liệu

```markdown
Giám sát luồng gọi API tại trang thanh toán http://localhost:3000/checkout:
1. Bật ghi nhận sự kiện mạng và lỗi console.
2. Bấm nút "Xác Nhận Đặt Hàng".
3. Soi request POST /api/checkout được gửi đi:
   - Đảm bảo các thông tin nhạy cảm (số thẻ, token xác thực) đã được che giấu hoặc mã hóa an toàn.
   - Kiểm tra mã trạng thái trả về là HTTP 200 OK.
4. Báo cáo nếu có bất kỳ phản hồi lỗi 4xx/5xx hoặc cảnh báo chính sách CORS nào xuất hiện.
```

---

### 7. 🎨 Soi Thông Số Giao Diện & Đánh Giá Tương Phản (A11y)

```markdown
Mở Feedback Studio trên trình duyệt tại http://localhost:3000:
1. Kích hoạt công cụ Element Inspector vào nút bấm Call-To-Action chính.
2. Trích xuất các thuộc tính CSS thực tế (font-size, line-height, background-color, border-radius).
3. Kiểm tra độ tương phản màu chữ so với màu nền theo chuẩn WCAG 2.2 AA.
4. Nếu chưa đạt độ tương phản, hãy gợi ý mã màu hex thay thế và ghim ghi chú lỗi trực tiếp lên giao diện.
```

---

### 8. 🎭 Ghi Nhận Thao Tác, Replay & Xuất Code Kiểm Thử Playwright

```markdown
Sử dụng tính năng Recorder của Agent Pilot tại http://localhost:3000:
1. Bắt đầu ghi nhận kịch bản (recorder start) với tiêu đề "Checkout Flow".
2. Thực hiện luồng: Tìm kiếm sản phẩm -> Thêm vào giỏ hàng -> Đi tới trang Thanh toán.
3. Dừng ghi nhận (recorder stop) và chạy phát lại (recorder replay) để kiểm tra tính ổn định.
4. Xuất kịch bản kiểm thử:
   - Để xuất định dạng chuẩn Chrome DevTools Recorder JSON (dùng để import trực tiếp vào tab Recorder của Chrome DevTools), sử dụng lệnh CLI `agent-pilot recorder export`.
   - Để xuất mã nguồn TypeScript Playwright trực tiếp, sử dụng công cụ MCP `browser_recorder_export` và lưu file kiểm thử tại ./tests/checkout.spec.ts.
```

---

### 9. 🎥 Quay Video Kiểm Thử & Chụp Màn Hình Ghi Chú Thích Cho QA/QC

```markdown
Thực hiện kiểm thử nghiệm thu trực quan (Visual QA) cho trang http://localhost:3000/pricing:
1. Bắt đầu quay video màn hình tab kiểm thử.
2. Cuộn trang qua các gói cước, chuyển đổi nút gạt "Tháng / Năm" và bấm thử nút "Đăng ký".
3. Chụp ảnh màn hình kèm khoanh vùng highlight bảng giá và đóng dấu tiêu đề "QA Verified - Pricing Table".
4. Lưu file video .mp4 và ảnh chụp báo cáo vào thư mục ./artifacts/qa-report/.
```

---

## 💡 Kinh Nghiệm Ra Lệnh (Best Practices) Cho AI Agent

| Lời khuyên | Nên làm (Do) | Không nên (Don't) |
| :--- | :--- | :--- |
| **Ghi rõ URL và Tab** | "Mở `http://localhost:5173/` trong tab riêng" | "Kiểm tra web giúp tôi" nhưng không đưa URL |
| **Yêu cầu bằng chứng ảnh** | "Chụp ảnh màn hình xác nhận sau khi bấm" | Tin tưởng kết quả mù quáng khi chưa xem ảnh |
| **Không cướp chuột** | "Mở tab ngầm cách ly (background isolation)" | Tự lấy chuột bấm lung tung khi AI đang chạy |
| **Liệt kê từng bước** | Đánh số thứ tự 1, 2, 3 rõ ràng, logic | Viết đoạn văn dài dòng không phân tách bước |
| **Bắt lỗi chủ động** | "Nếu đăng nhập lỗi, hãy đọc log console" | Để AI dừng đột ngột mà không ghi lại nguyên nhân |
