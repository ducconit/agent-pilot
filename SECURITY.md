# 🛡️ Chính Sách Bảo Mật (Security Policy)

An ninh và an toàn dữ liệu của người dùng và lập trình viên là ưu tiên hàng đầu tại **Agent Pilot**. Do ứng dụng có khả năng kết nối trực tiếp với các mô hình AI Agent (Antigravity, Claude Desktop, Cursor...), chúng tôi đã thiết lập nhiều tầng phòng thủ chuyên sâu.

---

## 📋 Các Phiên Bản Được Hỗ Trợ (Supported Versions)

Chúng tôi cung cấp các bản vá bảo mật cho các phiên bản sau:

| Phiên Bản | Trạng Thái | Hỗ Trợ Bảo Mật |
| :--- | :---: | :---: |
| **`v1.0.3-beta`** | **Bản Beta Hiện Tại** | ✅ Có hỗ trợ tích cực |
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
3. **Lớp Chắn Bảo Vệ Thao Tác Con Người (Human Input Shield)**:
   - Khi Agent thực thi kịch bản, lớp màn chắn bảo vệ sẽ tạm thời chặn các sự kiện chuột/phím người dùng để tránh xung đột hành vi, đồng thời trang bị nút **Mở khóa khẩn cấp (Emergency Unlock)** để người dùng luôn nắm quyền kiểm soát tối cao.

---

## 🚨 Báo Cáo Lỗ Hổng An Ninh (Reporting a Vulnerability)

Nếu bạn phát hiện bất kỳ lỗ hổng bảo mật hoặc rủi ro an ninh nào liên quan đến Agent Pilot:

1. **Vui lòng KHÔNG mở GitHub Issue công khai** để bảo vệ cộng đồng người dùng trước khi bản vá được phát hành.
2. Hãy gửi báo cáo chi tiết đến quản trị viên (**DNT** - [@ducconit](https://github.com/ducconit)) hoặc mở **GitHub Security Advisory** riêng tư tại:
   - [GitHub Security Advisories](https://github.com/ducconit/agent-pilot-extension/security/advisories)
3. Báo cáo của bạn nên bao gồm:
   - Mô tả chi tiết lỗ hổng và phạm vi tác động.
   - Các bước cụ thể để tái hiện (Proof of Concept - PoC).
   - Đề xuất khắc phục (nếu có).

### Cam kết của chúng tôi:
- Xác nhận đã nhận báo cáo trong vòng **48 giờ**.
- Cung cấp đánh giá mức độ nghiêm trọng và lộ trình khắc phục trong vòng **5 ngày làm việc**.
- Ghi nhận và cảm ơn đóng góp của bạn (Credit) khi bản vá bảo mật được phát hành công khai.
