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
   /home/ubuntu/workspace/projects/browser-control/extensions
   ```
6. Tiện ích **Agent Pilot - AI Browser Controller** sẽ ngay lập tức xuất hiện trong danh sách extensions.
7. Nhấp vào biểu tượng mảnh ghép (Extensions icon) trên thanh công cụ của Chrome và chọn **Ghim (Pin)** biểu tượng Agent Pilot ra ngoài để tiện sử dụng.

---

## 2. Khởi Động Bảng Điều Khiển (Side Panel)

Bạn có thể dễ dàng mở trung tâm điều khiển Side Panel bằng 2 cách trực quan:
1. **Cách 1 (Nhanh & thuận tiện nhất)**: Nhấp chuột trực tiếp vào biểu tượng **Agent Pilot (📌)** đã ghim trên thanh công cụ Chrome. Bảng điều khiển sẽ trượt mở tức thì bên phải.
2. **Cách 2 (Menu chuột phải)**: Nhấp chuột phải vào bất kỳ vị trí nào trên trang web $\rightarrow$ Chọn **Mở Agent Pilot (Side Panel)**.

> 💡 **Cấu hình phím tắt (Tùy chọn)**: Để tránh hoàn toàn xung đột với các phím tắt hệ điều hành hoặc trình quản lý cửa sổ (như rofi, i3wm), tiện ích không gán phím tắt mặc định. Nếu bạn muốn gán phím tắt riêng:
> - Mở tab mới và nhập: `chrome://extensions/shortcuts`
> - Tìm dòng **Agent Pilot** và tự do nhập tổ hợp phím bạn yêu thích!

---

## 3. Hướng Dẫn Chi Tiết Các Tính Năng

### 3.1 Điều Khiển Thanh Điều Hướng & Trang Hướng Dẫn
- **Đi tới địa chỉ mới**: Nhập URL vào ô địa chỉ trên thanh công cụ của Side Panel (ví dụ: `google.com` hoặc `localhost:3000`) và nhấn **Enter** hoặc nhấp **Đi tới**.
- **Mở trang Thông tin & Hướng dẫn sử dụng**: Nhấp vào biểu tượng 📖 trên thanh Header:
  - Nếu trang hướng dẫn chưa mở: Extension tự động mở một tab mới và focus vào tab đó.
  - Nếu tab hướng dẫn đang mở: Tự động chuyển focus về tab đó và đưa cửa sổ trình duyệt lên trên cùng (chống mở trùng lặp).
- **Gắn kết nối CDP**: Nhấp nút **Gắn CDP** ở góc trên bên phải để chủ động kết nối Chrome DevTools Protocol khi cần.

---

### 3.2 Giám Sát Hoạt Động AI Agent Thời Gian Thực
Chuyển sang tab **🤖 AI Agent** trên Side Panel:
- **Tự động hóa hoàn toàn bởi AI Agent**: Toàn bộ các thao tác di chuyển chuột ảo, click tạo sóng ripple, tự động điền văn bản và cuộn trang đều do AI Agent (Antigravity) điều khiển tự động thông qua giao thức MCP (cổng `58765`).
- **Lớp lọc bảo vệ Secret & Private Key**:
  - Mặc định **Bật**: Tự động nhận diện và che giấu bằng các dấu sao `*` đối với Private Key (RSA, EC, OpenSSH), API Keys (OpenAI, Gemini, Claude, AWS, GitHub, Stripe, Slack...), JWT và query secrets trước khi gửi cho AI Agent. Kèm thông báo bảo mật rõ ràng để Agent không nhầm lẫn giá trị che giấu.
  - Hover vào icon **`?`** để xem nhanh mô tả bảo vệ.
  - Khi người dùng gạt tắt công tắc, hộp thoại cảnh báo bảo mật sẽ xuất hiện yêu cầu xác nhận rủi ro nhà cung cấp mô hình LLM có thể thu thập thông tin.
- **Nhật ký Lệnh Thời gian thực (Live Action Stream)**: Hiển thị thời gian thực luồng lệnh Agent gửi đến (`moveMouse`, `click`, `type`, `run_actions`...) kèm nút sao chép toàn bộ nhật ký (📋) và nút xóa nhật ký (🗑️).
- **Tự kiểm tra hệ thống (Self-Test)**: Nhấp nút **🧪 Tự kiểm tra hệ thống** để kiểm tra tự động 3 bước:
  1. Quyền truy cập tab web hiện tại.
  2. Khả năng nạp Content Script và kích hoạt API Chuột ảo.
  3. Trạng thái kết nối Máy chủ Bridge (Port 58765).

---

### 3.3 Trợ Thủ DevTools Toàn Diện Cho AI Agent (CDP Engine)
Thay vì làm rối giao diện Side Panel, khả năng DevTools được chuyển giao toàn diện thành siêu năng lực cho AI Agent:
- AI Agent có thể truy xuất logs `console.log/warn/error`, các truy vấn mạng `Network traffic`, hoặc đọc dung lượng RAM `Performance metrics` (JS Heap used/total, số lượng DOM nodes, recalculate styles) thông qua công cụ MCP `browser_get_devtools_data` hoặc gom cụm trong `browser_run_actions`.
- Khi Agent yêu cầu dữ liệu DevTools, Extension tự động kích hoạt CDP và trả về cấu trúc dữ liệu đã được làm sạch và lọc bảo mật.

---

### 3.4 Soi Phần Tử & Kiểu Dáng CSS (DOM Inspector Studio)
Chuyển sang tab **🎯 Inspector & Màu**:
1. Nhấp nút **Bật Soi Phần tử**: Di chuyển con trỏ chuột thật qua trang web, khung bao sáng màu cyan tự động bắt dính vào từng phần tử kèm thẻ thông số hiển thị Tag name, kích thước `W x H`.
2. **Click để chọn phần tử**: Ngay khi bạn click chọn phần tử, chế độ soi sẽ **tự động tắt ngay lập tức** để trả lại trạng thái tương tác tự nhiên cho trang web.
3. Bảng điều khiển Side Panel chia làm 2 thẻ phụ (Subtabs) trực quan:
   - **📌 Tổng quan**: Hiển thị Tag Name, Tọa độ `X, Y`, Kích thước `W × H`, chuỗi **CSS Selector** và biểu thức **XPath** (nhấp để sao chép nhanh).
   - **🎨 Kiểu dáng CSS**: Hiển thị toàn bộ thông số CSS tính toán (Computed CSS) mà phần tử đang chịu (Typography, Layout, Dimensions, Spacing, Visuals, Flexbox, Grid...), tích hợp thanh tìm kiếm CSS thời gian thực và nút **Sao chép tất cả CSS**.

---

### 3.5 Kính Lúp Phóng Đại Lấy Mã Màu (Eyedropper)
1. Nhấp nút **🎨 Lấy mã màu** trên Side Panel hoặc Popup.
2. Một **vùng kính lúp phóng đại 11x11 pixel** cực nét sẽ xuất hiện và bám theo đầu con trỏ chuột, hiển thị rõ ràng từng điểm ảnh cùng tâm ngắm kép và bảng mã màu trực tiếp quanh chuột.
3. Nhấp chuột trái vào điểm màu bạn chọn:
   - Mã màu **HEX** tự động copy vào bộ nhớ đệm (clipboard).
   - Bảng mã màu được **cố định ngay trên Side Panel** (hiển thị HEX, RGB, HSL và khay lịch sử màu).
   - Chế độ lấy mã màu **tự động tắt ngay lập tức** (hoặc nhấn phím `Esc` để hủy bất kỳ lúc nào).

---

### 3.7 Bộ Công Cụ Chụp Màn Hình (Screenshot Studio)
Chuyển sang tab **📸 Chụp ảnh**:
- **🖥️ Chụp Toàn màn hình**: Chụp lại toàn bộ khung nhìn hiển thị hiện tại của tab.
- **✂️ Kéo chọn vùng (Crop)**: Trang web sẽ mờ đi kèm con trỏ dấu cộng; bạn chỉ cần giữ chuột trái và kéo một khung chữ nhật quanh khu vực cần chụp -> Nhấp **✓ Chụp vùng này**.
- **🎯 Chụp phần tử**: Di chuột trực tiếp trên trang web để chọn phần tử muốn chụp (viền tím và tooltip hướng dẫn). Khi click chọn phần tử, hệ thống sẽ tự động chụp khung viền của phần tử đó và tự động tắt ngay chế độ chọn (có thể nhấn Esc để hủy).
- **📋 Tự động sao chép vào Clipboard (Switch)**: Khi bật tùy chọn này, bất kỳ thao tác chụp nào (toàn màn hình, kéo vùng crop hay chụp phần tử) sẽ tự động sao chép ngay ảnh kết quả vào bộ nhớ tạm (clipboard) của hệ thống mà không cần nhấp thêm nút Sao chép.
- Sau khi chụp, ảnh xem trước sẽ hiển thị ngay trong Side Panel kèm kích thước pixel thực tế, nút **💾 Tải về PNG** và nút **📋 Sao chép** vào clipboard.
