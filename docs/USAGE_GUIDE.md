# 📖 Sổ Tay Hướng Dẫn Sử Dụng (Agent Pilot User Guide)

Chào mừng bạn đến với **Agent Pilot**! Sổ tay này hướng dẫn chi tiết từng bước cài đặt và vận hành toàn bộ các tính năng của tiện ích mở rộng.

---

## 1. Hướng Dẫn Cài Đặt Lên Google Chrome

Do Agent Pilot được phát triển dưới dạng mã nguồn mở chuẩn Manifest V3, bạn có thể cài đặt trực tiếp ở chế độ Nhà phát triển (Developer Mode):

1. Khởi động trình duyệt **Google Chrome**.
2. Nhập vào thanh địa chỉ: `chrome://extensions` và nhấn **Enter**.
3. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải màn hình.
4. Nhấp vào nút **Load unpacked** (Tải tiện ích đã giải nén) ở góc trên bên trái.
5. Duyệt đến thư mục của dự án và chọn thư mục con:
   ```
   /home/ubuntu/workspace/projects/browser-control/extentions
   ```
6. Tiện ích **Agent Pilot - AI Browser Controller** sẽ ngay lập tức xuất hiện trong danh sách extensions.
7. Nhấp vào biểu tượng mảnh ghép (Extensions icon) trên thanh công cụ của Chrome và chọn **Ghim (Pin)** biểu tượng Agent Pilot ra ngoài để tiện sử dụng.

---

## 2. Khởi Động Bảng Điều Khiển (Side Panel)

Có 3 cách đơn giản để mở trung tâm điều khiển Side Panel:
1. **Cách 1 (Nhanh nhất)**: Nhấn tổ hợp phím tắt <kbd>Alt + Shift + A</kbd> (hoặc <kbd>Option + Shift + A</kbd> trên macOS).
2. **Cách 2**: Nhấp vào biểu tượng Agent Pilot trên thanh công cụ -> Nhấn nút **🚀 Mở Bảng Điều Khiển (Side Panel)**.
3. **Cách 3**: Nhấp chuột phải vào bất kỳ đâu trên trang web -> Chọn **Mở Agent Pilot (Side Panel)**.

---

## 3. Hướng Dẫn Chi Tiết Các Tính Năng

### 3.1 Điều Khiển Tab & Trình Duyệt
- **Đi tới địa chỉ mới**: Nhập URL vào ô địa chỉ trên thanh công cụ của Side Panel (ví dụ: `google.com` hoặc `localhost:3000`) và nhấn **Enter** hoặc nhấp **Đi tới**.
- **Tải lại tab**: Nhấp vào biểu tượng 🔄 **Reload**.
- **Tạo tab mới**: Nhấp vào biểu tượng ➕ **New Tab**.

---

### 3.2 Thao Tác Chuột Ảo & Tự Động Gõ Chữ
Chuyển sang tab **🖱️ Chuột & Agent** trên Side Panel:
- **Di chuyển chuột đến tọa độ**: Nhập tọa độ `X` và `Y` (ví dụ: `350`, `200`) -> Nhấp **Di chuyển chuột**. Bạn sẽ thấy con trỏ chuột neon lướt mượt mà trên trang web kèm bảng tọa độ trực quan.
- **Click chuột ảo**: Nhấp **Click tại (X, Y)**. Tại vị trí con trỏ sẽ phát ra vòng sóng ripple màu xanh ngọc và kích hoạt sự kiện click lên phần tử thực tế bên dưới.
- **Cuộn trang**: Nhấp **Cuộn lên ⬆** hoặc **Cuộn xuống ⬇**.
- **Tự động điền văn bản**:
  - Nhập CSS Selector của ô input (ví dụ: `#search-input` hoặc `input[name='q']`).
  - Nhập nội dung cần gõ.
  - Nhấp **Gõ chữ tự động**: Chuột ảo sẽ tự động bay đến ô nhập liệu, click focus và gõ từng ký tự với hoạt ảnh chân thực.

---

### 3.3 Chạy Kịch Bản Tự Động Hóa Của Agent (JSON Action Script)
- Nhấp nút **Tải mẫu** trong mục *Kịch bản Agent* để tải đoạn mã JSON mẫu gồm chuỗi các bước: `navigate` -> `mouse_move` -> `mouse_click` -> `type` -> `scroll` -> `screenshot`.
- Nhấp **▶ Chạy Kịch bản Agent**: Hệ thống sẽ tuần tự thực thi từng hành động và hiển thị tiến trình hoàn thành chi tiết trong nhật ký.

---

### 3.4 Giám Sát DevTools Thời Gian Thực (CDP)
Chuyển sang tab **⚡ DevTools**:
1. Nhấp nút **Gắn CDP** ở góc trên cùng bên phải thanh Header. (Trình duyệt sẽ hiển thị thanh vàng thông báo debug).
2. **Subtab Console**:
   - Theo dõi toàn bộ `console.log`, `warn`, `error` và `uncaught exception` phát sinh trên trang web.
   - Sử dụng bộ lọc Cấp độ (Level) hoặc ô tìm kiếm để lọc nhanh thông điệp lỗi.
   - Nhấp **Xóa** để làm sạch màn hình.
3. **Subtab Network**:
   - Theo dõi danh sách các API requests (Fetch / XHR / Document) kèm phương thức (GET, POST), mã phản hồi HTTP (200, 404, 500) và đường dẫn URL.
4. **Subtab Performance**:
   - Nhấp **Làm mới** để đọc ngay tức thời:
     - Dung lượng RAM bộ nhớ V8 JS Heap (Used & Total).
     - Số lượng DOM Nodes đang tồn tại.
     - Số lần tính toán lại Layout và CSS Style.

---

### 3.5 Soi Phần Tử & Lấy Vị Trí (Element Inspector)
Chuyển sang tab **🎯 Inspector & Màu**:
1. Nhấp nút **Bật Soi Phần tử**: Khi bạn di chuyển con trỏ chuột thật qua trang web, khung bao sáng màu cyan sẽ tự động bắt dính vào từng phần tử kèm thẻ thông số hiển thị Tag name, kích thước `W x H` và CSS selector.
2. **Click để khóa phần tử**: Click chuột vào phần tử bạn muốn chọn.
3. Bảng điều khiển Side Panel sẽ tự động hiển thị:
   - Tag Name, Tọa độ `X, Y`, Kích thước chính xác `W × H`.
   - Chuỗi **CSS Selector** (nhấp để copy).
   - Biểu thức **XPath** (nhấp để copy).
   - Nội dung chữ bên trong.
4. **Hành động nhanh với phần tử**:
   - **Di chuột tới phần tử**: Ra lệnh cho chuột ảo bay ngay vào tâm của phần tử vừa chọn.
   - **Click vào phần tử**: Chuột ảo click trực tiếp vào phần tử.
   - **Chụp riêng phần tử này**: Cắt và chụp đúng kích thước của phần tử thành ảnh PNG.

---

### 3.6 Trích Xuất Màu Sắc (Color Eyedropper)
1. Nhấp nút **🎨 Lấy mã màu** trên Side Panel hoặc Popup.
2. Kính lúp phóng to pixel sẽ xuất hiện trên màn hình.
3. Di chuột và click vào điểm màu bất kỳ trên trang web.
4. Mã màu **HEX** sẽ được tự động copy vào bộ nhớ đệm (clipboard), đồng thời hiển thị đầy đủ thông số `HEX`, `RGB`, `HSL` và lưu lại vào khay lịch sử màu sắc trên Side Panel.

---

### 3.7 Bộ Công Cụ Chụp Màn Hình (Screenshot Studio)
Chuyển sang tab **📸 Chụp ảnh**:
- **🖥️ Chụp Toàn màn hình**: Chụp lại toàn bộ khung nhìn hiển thị hiện tại của tab.
- **✂️ Kéo chọn vùng (Crop)**: Trang web sẽ mờ đi kèm con trỏ dấu cộng; bạn chỉ cần giữ chuột trái và kéo một khung chữ nhật quanh khu vực cần chụp -> Nhấp **✓ Chụp vùng này**.
- **🎯 Chụp Phần tử đang chọn**: Tự động tính toán khung viền của phần tử bạn đã khóa ở mục Inspector và xuất ảnh riêng cho phần tử đó.
- Sau khi chụp, ảnh xem trước sẽ hiển thị ngay trong Side Panel kèm kích thước pixel thực tế, nút **💾 Tải về PNG** và nút **📋 Sao chép** vào clipboard.
