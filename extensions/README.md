# 🚀 Hướng Dẫn Cài Đặt & Sử Dụng Agent Pilot

Chào mừng bạn đến với **Agent Pilot** – Tiện ích mở rộng điều khiển trình duyệt dành cho AI Agent (Tương thích Antigravity-First).

---

## 1. Hướng Dẫn Cài Đặt Lên Trình Duyệt (Chrome / Brave / Edge)

1. Mở trình duyệt và truy cập: `chrome://extensions` (hoặc `edge://extensions`, `brave://extensions`).
2. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải màn hình.
3. Nhấp vào nút **Load unpacked** (Tải tiện ích đã giải nén) ở góc trên bên trái.
4. Chọn **thư mục này** (thư mục chứa tệp `manifest.json`).
5. Tiện ích **Agent Pilot - AI Browser Controller** sẽ xuất hiện ngay lập tức!
6. Nhấp vào biểu tượng mảnh ghép trên thanh công cụ và chọn **Ghim (Pin)** biểu tượng Agent Pilot ra ngoài.

---

## 2. Cách Khởi Động Bảng Điều Khiển (Side Panel)

- **Cách 1 (Nhanh & tiện nhất)**: Nhấp chuột trực tiếp vào biểu tượng **Agent Pilot (📌)** trên thanh công cụ trình duyệt. Bảng điều khiển sẽ trượt mở tức thì ở cạnh phải màn hình.
- **Cách 2 (Menu chuột phải)**: Nhấp chuột phải vào bất kỳ vị trí nào trên trang web → Chọn **Mở Agent Pilot (Side Panel)**.

> 💡 **Tùy chỉnh phím tắt theo ý muốn**: Để tránh xung đột với phím tắt hệ thống (như rofi, i3wm, hệ điều hành), tiện ích không gán phím tắt mặc định. Nếu bạn muốn dùng phím tắt, hãy mở `chrome://extensions/shortcuts` và gán bất kỳ tổ hợp phím nào bạn thuận tay!

---

## 3. Kết Nối Với AI Agent (Antigravity / Codex)

1. Mở Side Panel, bạn sẽ thấy thanh trạng thái kết nối Agent ở trên cùng:
   - `🟢 AI Agent: Đã kết nối`: Tiện ích đã bắt tay thành công với máy chủ Agent.
   - `⚪ AI Agent: Đang chờ kết nối (Cổng 58765)`: Đang chờ máy chủ Agent khởi động.
2. Cổng kết nối mặc định: **`58765`** (chống trùng lặp tuyệt đối). Bạn có thể đổi cổng linh hoạt bằng cách nhấp vào ô nhập Port trong Side Panel.
3. Cấu hình MCP trong Antigravity, Claude Desktop hoặc Cursor:
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

---

## 4. Các Tính Năng Chính

- **🤖 AI Agent Monitor & Batch Engine**: Kết nối qua cổng 58765, hiển thị luồng lệnh thời gian thực, tự kiểm tra 3 bước và hỗ trợ gom cụm tác vụ (Batch Execution).
- **🛡️ Lớp Lọc Che Giấu Secret/API Key**: Tự động che Private Key, OpenAI, Gemini, Claude, AWS, GitHub... trước khi gửi về AI Agent, kèm hộp thoại cảnh báo bảo mật.
- **🖱️ Chuột ảo & Gõ phím tự động**: Di chuyển chuột mượt mà, hiển thị huy hiệu tọa độ, phát sóng ripple click và human-like typing.
- **🎯 Soi phần tử & Kiểu dáng CSS**: Bắt tọa độ, selector, xpath, xem thông số Computed CSS kèm bộ lọc tìm kiếm và tự động tắt sau khi chọn.
- **🎨 Kính lúp phóng đại 11x11 pixel**: Kính lúp theo dõi con trỏ chuột, hiển thị lưới điểm ảnh cực nét để lấy màu HEX, RGB, HSL chính xác.
- **📸 Chụp ảnh màn hình & Auto-Copy**: Chụp toàn màn hình, kéo vùng crop, chụp chọn phần tử (Element Snap) và công tắc tự động sao chép ảnh vào Clipboard.
- **📖 Tài Liệu Hướng Dẫn Trực Tuyến**: Nút mở trang tài liệu VitePress trên GitHub Pages (`https://ducconit.github.io/agent-pilot/`), hỗ trợ chuyển focus tab thông minh tránh mở tab trùng lặp.
