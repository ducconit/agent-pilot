# 🛡️ Chính Sách Bảo Mật (Security Policy)

An ninh và an toàn dữ liệu của người dùng và lập trình viên là ưu tiên hàng đầu tại **Agent Pilot**. Do ứng dụng có khả năng kết nối trực tiếp với các mô hình AI Agent (Antigravity, Claude Desktop, Cursor...), chúng tôi đã thiết lập nhiều tầng phòng thủ chuyên sâu.

---

## 📋 Các Phiên Bản Được Hỗ Trợ (Supported Versions)

Chúng tôi cung cấp các bản vá bảo mật cho các phiên bản sau:

| Phiên Bản | Trạng Thái | Hỗ Trợ Bảo Mật |
| :--- | :---: | :---: |
| **`v1.4.0`** | **Bản Chính Thức Hiện Tại** | ✅ Có hỗ trợ tích cực |
| `v1.3.x` | Bản Chính Thức trước | ⚠️ Khuyến nghị nâng cấp |
| `< 1.0.0` | Thử nghiệm nội bộ | ❌ Không hỗ trợ |

---

## 🔒 Cơ Chế An Ninh Cốt Lõi Của Agent Pilot

1. **Lớp Lọc Che Giấu Secret & Private Key (Redaction Layer)**:
   - **Tự động kích hoạt mặc định**: Mọi kết quả phản hồi từ trình duyệt trước khi truyền tới AI Agent qua WebSocket đều được rà soát để phát hiện và che giấu bằng các dấu sao `*`:
     - Khóa bí mật (RSA, EC, OpenSSH, DSA, PGP Private Keys).
     - Khóa API: OpenAI (`sk-`, `sk-proj-`, `sk-admin-`), Anthropic (`sk-ant-`), Google Gemini (`AIzaSy`), GitHub tokens (`ghp_`), AWS access keys (`AKIA`), Stripe (`sk_live_`), Slack (`xoxb-`), JWT và Bearer tokens.
     - Tham số URL nhạy cảm và các trường mật khẩu (`password`, `token`, `secret`, `credential`).
   - Kèm thông báo an ninh `AGENT_SECURITY_NOTICE` để Agent nhận biết các giá trị đã bị che mà không làm sai lệch luồng tư duy.
2. **Cô Lập Mạng Cục Bộ Loopback (Port 58765)**:
   - Máy chủ cầu nối chỉ lắng nghe trên giao diện cục bộ loopback `127.0.0.1`.
   - Vô hiệu hóa CORS ngoại lai, bảo vệ máy chủ HTTP REST khỏi các truy vấn từ web page độc hại bên ngoài.
3. **Lớp Chắn Bảo Vệ Thao Tác Con Người (Human Input Shield & Indicator)**:
   - Khi Agent thực thi kịch bản, hệ thống hiển thị viền màn hình phát sáng neon nhẹ nhàng và thanh trạng thái nhỏ gọn (floating pill) thông báo hành động, đồng thời trang bị nút **Mở khóa khẩn cấp (Emergency Unlock)** và phím <kbd>Esc</kbd> để người dùng luôn nắm quyền kiểm soát tối cao bất kỳ lúc nào.

---

## 🌉 Mô Hình Tin Cậy Của Bridge (Bridge Trust Model)

Máy chủ cầu nối (Bridge Server) chỉ lắng nghe trên giao diện cục bộ `127.0.0.1:58765` và kiểm tra nguồn gốc kết nối (`verifyClient`) theo danh sách cho phép: `localhost`, `127.0.0.1` và các nguồn `chrome-extension://`. Tuy nhiên cần lưu ý:

- **Mặc định không có token xác thực**: Bridge không yêu cầu khóa để giữ tương thích.
- **Auth tuỳ chọn**: đặt `AGENT_PILOT_API_KEY` trên server/CLI và nhập cùng key ở Side Panel → API key. Khi bật, HTTP và WebSocket yêu cầu API key; khi không đặt, bridge giữ nguyên behavior cũ.
- **Giới hạn mã hoá**: bridge dùng `ws://` trên loopback; API key không nằm trong URL/log nhưng frame vẫn không được mã hoá TLS. API key bảo vệ khỏi client local/web không biết key, không phải cơ chế chống process đặc quyền trên cùng máy.
- **Hệ quả khi tắt auth**: Bất kỳ tiến trình cục bộ (local process) nào trên cùng máy đều có thể kết nối tới cổng `58765` và điều khiển trình duyệt của bạn.

**Khuyến nghị an toàn**:
- Chỉ chạy phần mềm cục bộ đáng tin cậy trên máy đã cài Agent Pilot.
- **Không** công khai (expose) cổng `58765` ra mạng ngoài hoặc qua proxy/tunnel.
- Cân nhắc dừng service (`agent-pilot service stop`) khi không còn sử dụng.

---

## 🚨 Báo Cáo Lỗ Hổng An Ninh (Reporting a Vulnerability)

Nếu bạn phát hiện bất kỳ lỗ hổng bảo mật hoặc rủi ro an ninh nào liên quan đến Agent Pilot:

1. **Vui lòng KHÔNG mở GitHub Issue công khai** để bảo vệ cộng đồng người dùng trước khi bản vá được phát hành.
2. Hãy gửi báo cáo chi tiết đến quản trị viên (**DNT** - [@ducconit](https://github.com/ducconit)) hoặc mở **GitHub Security Advisory** riêng tư tại:
   - [GitHub Security Advisories](https://github.com/ducconit/agent-pilot/security/advisories)
3. Báo cáo của bạn nên bao gồm:
   - Mô tả chi tiết lỗ hổng và phạm vi tác động.
   - Các bước cụ thể để tái hiện (Proof of Concept - PoC).
   - Đề xuất khắc phục (nếu có).

### Cam kết của chúng tôi:
- Xác nhận đã nhận báo cáo trong vòng **48 giờ**.
- Cung cấp đánh giá mức độ nghiêm trọng và lộ trình khắc phục trong vòng **5 ngày làm việc**.
- Ghi nhận và cảm ơn đóng góp của bạn (Credit) khi bản vá bảo mật được phát hành công khai.
