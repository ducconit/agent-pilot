# ❓ Hỏi & Đáp Thường Gặp (Q&A)

Tài liệu này giải đáp các câu hỏi thường gặp nhất về **Agent Pilot**, bao gồm kiến trúc hệ thống, tích hợp AI Assistant và các kịch bản kiểm thử chất lượng giao diện (Web QA/QC Testing).

::: info Lưu ý về định hướng phát triển
Bộ tính năng hiện tại của Agent Pilot đã hoàn chỉnh cho toàn bộ quy trình tự động hóa trình duyệt, kiểm thử giao diện trực quan và debug web chuyên sâu. Trọng tâm tương lai của dự án là duy trì sự ổn định và tương thích, chưa có kế hoạch mở rộng thêm tính năng mới.
:::

---

## 1. Câu Hỏi Chung & Kiến Trúc Hệ Thống

### Q1: Agent Pilot khác gì so với Chrome MCP mặc định?

Các Chrome MCP server thông thường hay mở ra một cửa sổ trình duyệt hoàn toàn mới, liên tục cướp focus chuột/màn hình khi bạn đang làm việc, trả về cây DOM HTML thô ngốn hàng ngàn tokens, và khi cần chụp ảnh báo cáo lỗi thì AI phải tự viết thêm script Python (`Pillow`/`OpenCV`) tạm bợ để vẽ khung viền.

**Agent Pilot** giải quyết triệt để các hạn chế trên:
1. **Không cướp màn hình làm việc**: Chạy trực tiếp trên trình duyệt Chrome bạn đang mở, gom các tab điều khiển vào một nhóm tab riêng (`🤖 Agent Pilot`) chạy ngầm, giữ nguyên cookie và phiên đăng nhập.
2. **Tiết kiệm >50% token**: Rút gọn cấu trúc DOM thành các nhãn tương tác siêu nhẹ (`@1`, `@2`...), hỗ trợ cờ đợi inline (`--wait-for`, `--include-snapshot`) và chạy hàng loạt hành động trong 1 lệnh (Batch Execution).
3. **Tích hợp sẵn công cụ Visual QA**: Tự động chụp ảnh highlight viền đỏ và đóng dấu banner tiêu đề lỗi trực tiếp từ Chrome mà không cần AI phải sinh code Python.
4. **Bộ công cụ DevTools chuyên sâu**: Đo lường Core Web Vitals, kiểm tra rò rỉ bộ nhớ (V8 Heap Diff), quay video `.mp4` quá trình thao tác kèm chuột ảo neon và xuất trực tiếp kịch bản ra mã nguồn Playwright TypeScript.

---

### Q2: Agent Pilot có mất phí hay cần API key riêng không?

**Hoàn toàn không.** Agent Pilot là phần mềm mã nguồn mở 100% miễn phí phát hành theo giấy phép MIT License. Toàn bộ binary Go CLI và tiện ích Chrome chạy offline trực tiếp trên máy tính của bạn, không thu thập dữ liệu và không yêu cầu đăng ký tài khoản hay API key đám mây nào.

---

### Q3: Công cụ hỗ trợ những trình duyệt web nào?

Agent Pilot được xây dựng tối ưu cho Google Chrome (Manifest V3) và tương thích hoàn toàn với các trình duyệt nhân Chromium hỗ trợ Chrome Side Panel API và Manifest V3:
- **Google Chrome** (từ phiên bản 116 trở lên)
- **Brave Browser**
- **Microsoft Edge**

---

### Q4: Vì sao Agent Pilot tiết kiệm được hơn 50% token ngữ cảnh?

Khả năng tối ưu token vượt trội đến từ 3 thiết kế cốt lõi:
1. **Interactive Element References (`@1`, `@2`...)**: Thay vì gửi toàn bộ cây DOM HTML thô dài hàng ngàn dòng, công cụ chỉ trích xuất các phần tử tương tác được và gán nhãn ngắn gọn.
2. **Cờ đợi nội tuyến (Inline Wait Flags)**: Cho phép kết hợp 3 bước (Click → Đợi giao diện → Lấy lại Snapshot) vào **đúng 1 lệnh duy nhất** (`agent-pilot click "@1" --wait-for "#modal" --include-snapshot`), giảm tối đa các vòng trao đổi (roundtrips) qua lại với LLM.
3. **Định dạng CLI JSON gọn nhẹ**: Giao tiếp qua lệnh CLI với cờ `--format json` loại bỏ toàn bộ overhead của schema JSON-RPC cồng kềnh trong giao thức MCP.

---

### Q5: Có thể kiểm thử các trang yêu cầu đăng nhập hoặc mã OTP/2FA không?

**Có, hoàn toàn bình thường.** Vì Agent Pilot kết nối trực tiếp vào phiên Chrome đang mở của bạn, mọi cookie, session và trạng thái đăng nhập tài khoản cá nhân đều được giữ nguyên. AI có thể kiểm thử trực tiếp các trang quản trị nội bộ mà không cần bạn phải cung cấp mật khẩu hay mã OTP trong prompt.

---

## 2. Tích Hợp AI Agent & Cấu Hình

### Q6: Khi nào nên cài qua Release Bundle, khi nào dùng `npx skills add`?

- **Bộ cài Release Bundle theo OS (Khuyên dùng)**: Lựa chọn tốt nhất cho máy tính làm việc hàng ngày. Gói phát hành chỉ chứa duy nhất binary cho hệ điều hành của bạn (dung lượng nhẹ), có sẵn script cài đặt 1 bước (`./install.sh` hoặc `.\install.ps1`) tự động cấu hình PATH và đăng ký dịch vụ chạy ngầm (`systemd` / `launchd` / Windows service).
- **Lệnh `npx skills add`**: Lựa chọn khi cần cài nhanh vào các AI coding agent (Claude Code, Cursor, Windsurf, Antigravity, OpenCode, Codex). Lệnh này tải gói kỹ năng đa nền tảng chứa sẵn binary của **cả 3 hệ điều hành** trong `skills/agent-pilot/scripts/`.

---

### Q7: Khi nào nên sử dụng cờ `--via cdp` thay vì sự kiện DOM thông thường?

Mặc định, Agent Pilot dùng sự kiện giả lập DOM siêu tốc (kèm hiệu ứng chuột ảo neon). Bạn nên bật `--via cdp` khi:
1. Tương tác với các thẻ `<iframe>` khác tên miền (cross-origin iframe).
2. Nhấp chuột hoặc kéo thả bên trong thẻ `<canvas>` HTML5, giao diện đồ họa WebGL hoặc game Unity/Phaser.
3. Cần mô phỏng sự kiện phần cứng cấp thấp (Trusted Input).

*(Mẹo: Dùng cờ `--via auto` để ưu tiên thử CDP trước, nếu debugger bị chặn sẽ tự động chuyển sang DOM giả lập mà không bị dừng đột ngột).*

---

### Q8: Hệ thống xử lý đa tác nhân (Multi-Agent Concurrency) như thế nào?

Agent Pilot quản lý tab bằng mã số nguyên `tabId`. Khi một Agent mở tab mới bằng `agent-pilot open` hoặc `browser_open_tab`, công cụ sẽ trả về một `tabId` riêng biệt (ví dụ `1546114498`). Bằng cách truyền `tabId` này vào các thao tác tiếp theo, nhiều agent độc lập có thể làm việc song song trên các tab khác nhau mà không sợ xung đột hay tranh chấp lẫn nhau.

---

## 3. Quy Trình Kiểm Thử QA / QC (Quality Assurance)

### Q9: Làm sao để chụp ảnh màn hình báo cáo lỗi kèm highlight khung đỏ và banner tiêu đề?

Bạn có thể tạo ảnh chụp báo cáo lỗi hoàn chỉnh chỉ với 1 dòng lệnh:

```bash
# Khoanh khung đỏ phần tử @1 và đóng dấu tiêu đề báo cáo lỗi
agent-pilot screenshot -o bug-checkout.png --highlight "@1" --title "Lỗi #402: Nút thanh toán bị che khuất" --tab 12345
```

Hoặc thông qua công cụ MCP:
```json
{
  "tool": "browser_screenshot",
  "arguments": {
    "tabId": 12345,
    "highlightSelector": "#btn-checkout",
    "title": "Lỗi #402: Nút thanh toán bị che khuất",
    "mode": "visible"
  }
}
```

---

### Q10: Làm thế nào để xuất luồng thao tác ra code kiểm thử Playwright TypeScript?

Sau khi bạn hoặc AI thực hiện xong một kịch bản kiểm thử trên trình duyệt, hãy xuất toàn bộ luồng đó:

- **Qua MCP Tool**:
  ```json
  { "tool": "browser_recorder_export", "arguments": {} }
  ```
  Công cụ sẽ trả về toàn bộ code Playwright TypeScript hoàn chỉnh, có sẵn cơ chế auto-waiting assertions.
- **Qua CLI**:
  ```bash
  agent-pilot recorder export > flow.spec.ts
  ```

---

### Q11: Cách phát hiện rò rỉ bộ nhớ (Memory Leak) với V8 Heap Snapshot?

Agent Pilot cho phép chụp và so sánh dung lượng bộ nhớ Heap trước và sau chuỗi thao tác:

```bash
# 1. Chụp ảnh bộ nhớ ban đầu (Baseline)
agent-pilot heap snapshot baseline.heapsnapshot --tab 12345

# 2. Thực hiện thao tác lặp (ví dụ: mở đóng popup 10 lần)
agent-pilot batch test-popup-cycle.json

# 3. Chụp ảnh bộ nhớ sau thao tác để phân tích sự chênh lệch đối tượng chưa được GC
agent-pilot heap snapshot post-cycle.heapsnapshot --tab 12345
```

---

### Q12: Làm thế nào để quay video .mp4 quá trình AI thao tác kiểm thử?

Để quay lại video minh họa quá trình thao tác kèm chuột ảo neon và sóng click chuột:

```bash
# Bắt đầu quay video tab
agent-pilot devtools video-start --tab 12345

# Thực hiện chuỗi thao tác kiểm thử
agent-pilot click "@1" --tab 12345
agent-pilot type "@2" "dữ liệu kiểm thử" --enter --tab 12345

# Dừng quay và lưu tệp video .mp4
agent-pilot devtools video-stop --tab 12345
```
