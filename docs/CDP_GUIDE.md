# ⚡ Sổ Tay Chrome DevTools Protocol (CDP) trong Agent Pilot

**Chrome DevTools Protocol (CDP)** là giao thức giao tiếp cấp thấp cho phép công cụ kiểm thử và các AI Agent tương tác trực tiếp với lõi Chromium. Trong **Agent Pilot**, CDP được khai thác qua API `chrome.debugger` chuẩn Manifest V3.

---

## 1. Cơ Chế Gắn Kết Nối (Attachment Lifecycle)

Để bắt đầu giám sát hoặc phát lệnh cấp thấp tới một tab, Service Worker thực hiện gắn kết:

```javascript
// Gắn kết nối CDP với tab chỉ định (Phiên bản giao thức 1.3)
chrome.debugger.attach({ tabId }, "1.3", async () => {
  if (chrome.runtime.lastError) {
    console.error("Lỗi gắn kết CDP:", chrome.runtime.lastError.message);
    return;
  }
  
  // Kích hoạt các domain DevTools cần thiết
  await sendCdpCommand(tabId, "Console.enable");
  await sendCdpCommand(tabId, "Runtime.enable");
  await sendCdpCommand(tabId, "Network.enable");
  await sendCdpCommand(tabId, "Performance.enable");
  await sendCdpCommand(tabId, "Page.enable");
});
```

> [!NOTE]
> **Thanh cảnh báo của Google Chrome**: Khi extension gắn kết nối CDP vào bất kỳ tab nào, Chrome sẽ tự động hiển thị thanh thông báo màu vàng ở đầu trình duyệt: `"Agent Pilot is debugging this browser"`. Đây là cơ chế bảo mật bắt buộc của Chromium để đảm bảo người dùng luôn biết trình duyệt đang được theo dõi/điều khiển.

---

## 2. Các Domain DevTools Được Khai Thác

### 2.1 Domain Console & Runtime (Bắt Nhật Ký Lỗi)
CDP cho phép Agent Pilot bắt toàn bộ các lời gọi `console.log`, `console.warn`, `console.error` và các ngoại lệ chưa được xử lý (Uncaught Exceptions):

- **Lắng nghe sự kiện**:
  ```javascript
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method === "Runtime.consoleAPICalled") {
      // params.type: "log" | "warn" | "error" | "info" | "table"
      // params.args: Danh sách đối tượng tham số truyền vào
      // params.stackTrace: Call stack tại vị trí gọi log
    } else if (method === "Console.messageAdded") {
      // params.message.level: Cấp độ log
      // params.message.text: Nội dung thông điệp
      // params.message.url: Tệp nguồn JavaScript phát sinh log
    }
  });
  ```

### 2.2 Domain Network (Giám Sát Mạng & API)
Agent Pilot theo dõi toàn bộ chu trình sống của các HTTP/HTTPS request:

1. `Network.requestWillBeSent`: Bắt đầu gửi request (URL, HTTP Method, Headers ban đầu, Resource Type: XHR, Fetch, Script, Image).
2. `Network.responseReceived`: Nhận phản hồi từ server (HTTP Status 200/404/500, Status Text, Response Headers, MimeType).
3. `Network.loadingFinished`: Quá trình tải dữ liệu hoàn tất (tổng kích thước byte nhận được).
4. `Network.loadingFailed`: Request bị chặn bởi CORS, mạng rớt hoặc DNS fail.

### 2.3 Domain Performance (Đo Lường Hiệu Năng & Bộ Nhớ)
Cung cấp các chỉ số đo đạc nội bộ của engine V8 và Blink:

```javascript
const res = await sendCdpCommand(tabId, "Performance.getMetrics");
// Trả về mảng các chỉ số:
// - JSHeapUsedSize: Dung lượng RAM V8 JS thực tế đang sử dụng
// - JSHeapTotalSize: Tổng dung lượng RAM V8 cấp phát
// - Nodes: Số lượng node trên cây DOM hiện tại
// - LayoutCount: Số lần trình duyệt phải tính toán lại Layout
// - RecalcStyleCount: Số lần tính toán lại CSS Style
```

### 2.4 Domain Input (Mô Phỏng Chuột & Bàn Phím Cấp Hệ Thống)
Bên cạnh việc kích hoạt synthetic DOM events trong Content Script, Agent Pilot hỗ trợ phát sự kiện trực tiếp vào engine qua CDP Input Domain. Input qua CDP là **trusted event** (`isTrusted: true`) nên có thể điều khiển được **cross-origin iframe, `<canvas>` và ứng dụng WebGL** (Unity, game Playables…) — nơi synthetic event bất lực.

Hai helper chuẩn trong `extensions/background/cdp-manager.js`:

```javascript
// Click trusted: move -> press -> release
await dispatchCdpMouseClick(tabId, x, y, { button: "left", clickCount: 1 });

// Drag trusted: press -> nội suy nhiều bước -> giữ (hold) -> release
// Dùng cho cơ chế kéo slingshot/ngắm trong game canvas
await dispatchCdpMouseDrag(tabId, fromX, fromY, toX, toY, { steps: 10, holdMs: 800 });
```

Ví dụ thô với `Input.dispatchMouseEvent`:

```javascript
await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
  type: "mouseMoved",
  x: 250,
  y: 180
});
await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
  type: "mousePressed",
  x: 250,
  y: 180,
  button: "left",
  buttons: 1,
  clickCount: 1
});
await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
  type: "mouseReleased",
  x: 250,
  y: 180,
  button: "left",
  buttons: 0,
  clickCount: 1
});
```

> [!IMPORTANT]
> **Khi nào BẮT BUỘC dùng CDP Input?** Trang thường (DOM) có thể dùng synthetic mặc định. Với **cross-origin iframe / canvas / WebGL**, synthetic event không vượt được ranh giới origin nên phải dùng CDP Input.
> - CLI: `agent-pilot click -x 733 -y 668 --via cdp --tab <id>` và `agent-pilot drag --from-x 745 --from-y 490 --to-x 745 --to-y 832 --steps 10 --hold 800 --via cdp --tab <id>`
> - `--via synthetic` (mặc định, giữ nguyên hành vi cũ) · `--via cdp` (trusted, không fallback) · `--via auto` (thử CDP, tự động fallback synthetic).
> - Kiểm tra trước khi chạy: `agent-pilot cdp status --tab <id>`.
>
> **Xử lý lỗi gắn kết**: `ensureCdpAttached()` kiểm tra kết quả `chrome.debugger.attach` và ném lỗi rõ ràng `CDP_UNAVAILABLE: <reason>` (DevTools đang mở trên tab, quyền/policy bị chặn) thay vì treo hoặc fallback âm thầm.

> [!NOTE]
> **Hiệu ứng hình ảnh**: con trỏ neon và hiệu ứng ripple chỉ do **synthetic engine** vẽ. Input qua CDP là input thật cấp hệ thống nên **không** hiển thị con trỏ ảo.

### 2.5 Domain Page (Chụp Ảnh Chuẩn Xác Từng Pixel)
Cho phép chụp ảnh màn hình tab kèm khung cắt (crop box) chính xác theo tọa độ viewport:

```javascript
const res = await sendCdpCommand(tabId, "Page.captureScreenshot", {
  format: "png",
  clip: {
    x: elementRect.x,
    y: elementRect.y,
    width: elementRect.width,
    height: elementRect.height,
    scale: 1
  }
});
// Kết quả res.data là chuỗi Base64 PNG hoàn chỉnh
```
