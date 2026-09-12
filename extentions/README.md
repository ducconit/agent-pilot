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

- **Phím tắt nhanh**: Nhấn <kbd>Alt + Shift + P</kbd> (trên macOS: <kbd>Option + Shift + P</kbd>).
- **Hoặc**: Nhấp vào biểu tượng Agent Pilot trên thanh công cụ -> Chọn **Mở Bảng Điều Khiển**.
- **Hoặc**: Nhấp chuột phải vào trang web bất kỳ -> Chọn **Mở Agent Pilot (Side Panel)**.

---

## 3. Kết Nối Với AI Agent (Antigravity / Codex)

1. Mở Side Panel, bạn sẽ thấy thanh trạng thái kết nối Agent ở trên cùng:
   - `🟢 AI Agent: Đã kết nối`: Tiện ích đã bắt tay thành công với máy chủ Agent.
   - `⚪ AI Agent: Đang chờ kết nối (Cổng 58765)`: Đang chờ máy chủ Agent khởi động.
2. Cổng kết nối mặc định: **`58765`** (chống trùng lặp tuyệt đối). Bạn có thể đổi cổng linh hoạt bằng cách nhấp vào ô nhập Port trong Side Panel.
3. Cấu hình MCP trong Antigravity hoặc Claude Desktop:
   ```json
   {
     "mcpServers": {
       "agent-pilot": {
         "command": "node",
         "args": ["<path-to-server>/scripts/agent_pilot_server.mjs"],
         "env": {
           "AGENT_PILOT_PORT": "58765"
         }
       }
     }
   }
   ```

---

## 4. Các Tính Năng Chính

- **🖱️ Chuột ảo & Click**: Di chuyển chuột mượt mà, hiển thị huy hiệu tọa độ, phát sóng ripple click.
- **⌨️ Gõ phím tự động**: Human-like typing vào ô input/textarea.
- **🎯 Soi phần tử (Inspector)**: Đo kích thước, bắt tọa độ, trích xuất CSS Selector & XPath an toàn.
- **🎨 Lấy mã màu (Eyedropper)**: Phóng to pixel đọc mã màu HEX, RGB, HSL.
- **📸 Chụp ảnh màn hình**: Chụp toàn màn hình, kéo vùng crop hoặc chụp riêng phần tử DOM.
- **⚡ DevTools thời gian thực**: Xem log Console, Network requests và JS Heap/DOM nodes qua CDP.
