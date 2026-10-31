# 📚 Danh Mục Tham Chiếu API (Agent Pilot)

Tài liệu đặc tả toàn bộ các thông điệp tin nhắn (Message Passing Actions), cấu trúc dữ liệu và API toàn cục của **Agent Pilot**.

---

## 1. Tin Nhắn Gửi Tới Background Service Worker

Các lệnh được gửi qua `chrome.runtime.sendMessage({ action: "...", ... })`:

### 1.1 Quản Lý Tab & Điều Hướng
| Action | Tham số yêu cầu | Phản hồi (Response) | Mô tả |
| :--- | :--- | :--- | :--- |
| `get_active_tab` | Không | `{ tab: TabObject }` | Lấy thông tin tab đang hoạt động |
| `list_tabs` | Không | `{ tabs: TabObject[] }` | Liệt kê tất cả các tab đang mở |
| `new_tab` | `url?: string` | `{ success: true, tab }` | Mở tab mới với URL chỉ định |
| `navigate` | `tabId: number, url: string` | `{ success: true, tab }` | Điều hướng tab đến URL mới |
| `reload_tab` | `tabId: number` | `{ success: true }` | Tải lại trang trên tab chỉ định |
| `close_tab` | `tabId: number` | `{ success: true }` | Đóng tab chỉ định |

### 1.2 Chrome DevTools Protocol (CDP)
| Action | Tham số yêu cầu | Phản hồi (Response) | Mô tả |
| :--- | :--- | :--- | :--- |
| `attach_debugger` | `tabId: number` | `{ success: boolean, error?: string }` | Gắn kết nối CDP và kích hoạt các domain Console, Network, Performance |
| `detach_debugger` | `tabId: number` | `{ success: true }` | Ngắt kết nối CDP khỏi tab |
| `get_debugger_status` | `tabId: number` | `{ attached: boolean }` | Kiểm tra trạng thái kết nối CDP hiện tại |
| `get_devtools_data` | `tabId: number` | `{ console: [], network: [], attached }` | Lấy bộ đệm lịch sử logs console và network |
| `clear_console` | `tabId: number` | `{ success: true }` | Xóa bộ đệm nhật ký console |
| `clear_network` | `tabId: number` | `{ success: true }` | Xóa danh sách network requests |
| `get_performance_metrics`| `tabId: number` | `{ success: boolean, metrics: Object }` | Đọc các chỉ số JS Heap, DOM Nodes, Layouts |

### 1.3 Chụp Ảnh Màn Hình
| Action | Tham số yêu cầu | Phản hồi (Response) | Mô tả |
| :--- | :--- | :--- | :--- |
| `capture_screenshot` | `mode: "visible"` | `{ success: true, dataUrl: string }` | Chụp toàn bộ khung nhìn hiển thị |
| `capture_screenshot` | `mode: "element" \| "region", tabId, clip: {x, y, width, height}` | `{ success: true, dataUrl, requiresCrop?: boolean, clip }` | Chụp và cắt ảnh theo tọa độ chữ nhật |

### 1.4 Phương Thức RPC Qua Bridge (WebSocket / HTTP `/api`)

Các method nhận input có hỗ trợ chọn engine (`via`) và toạ độ cho canvas/game. Mặc định vẫn là synthetic để không phá vỡ hành vi cũ.

| Method | Tham số | CDP? | Mô tả |
| :--- | :--- | :--- | :--- |
| `tabs.listAll` | Không | ❌ | Liệt kê toàn bộ các tab đang mở trên tất cả các cửa sổ Chrome |
| `tabs.create` | `url?: string, active?: boolean` | ❌ | Tạo tab mới (mặc định mở nền trong nhóm `🤖 Agent Pilot`) |
| `tabs.update` | `tabId?: number, url?: string, action?: "url" \| "back" \| "forward" \| "reload"` | ❌ | Điều hướng hoặc tải lại trang trên tab chỉ định |
| `tabs.remove` | `tabId: number` | ❌ | Đóng tab chỉ định |
| `page.click` | `selector?`, `x?`, `y?`, `via?: "synthetic" \| "cdp" \| "auto"`, `tabId?` | ⚙️ Tùy chọn | `via: "cdp"` phát trusted click (cross-origin iframe/canvas); `"auto"` tự fallback synthetic |
| `page.type` | `selector?`, `text: string`, `clear?: boolean`, `pressEnter?: boolean`, `tabId?` | ❌ | Tự động gõ từng ký tự vào ô nhập |
| `page.scroll` | `deltaX?: number, deltaY?: number`, `tabId?` | ❌ | Cuộn trang theo hướng ngang/dọc |
| `page.hover` | `selector?`, `x?`, `y?`, `via?`, `tabId?` | ⚙️ Tự động | Ưu tiên CDP `Input.dispatchMouseEvent`, fallback synthetic |
| `page.drag` | `from`/`to` (selector) **hoặc** `fromX/fromY/toX/toY`, `steps?`, `holdMs?`, `via?`, `tabId?` | ⚙️ Tùy chọn | Drag trusted cho slingshot/aim; `holdMs` giữ trước khi thả |
| `page.pressKey` | `key: string`, `selector?`, `tabId?` | ⚙️ Tự động | Ưu tiên CDP `Input.dispatchKeyEvent`, fallback synthetic |
| `page.fillForm` | `fields: Array<{selector, value}>`, `submitSelector?`, `tabId?` | ❌ | Điền nhiều trường form trong 1 lần gọi duy nhất |
| `page.uploadFile`| `files: string[]`, `selector?`, `via?: "auto" \| "cdp"`, `tabId?` | ⚙️ Tùy chọn | Thiết lập file input qua CDP hoặc synthetic event; file giới hạn trong workspace hoặc `/tmp` |
| `page.waitFor` | `selector?`, `text?`, `state?`, `timeoutMs?`, `tabId?` | ❌ | Chờ đợi trạng thái phần tử hoặc chuỗi văn bản |
| `page.snapshot`| `maxElements?: number, format?: string`, `tabId?` | ❌ | Lấy bản chụp DOM tương tác và cây khả năng tiếp cận |
| `page.screenshot`| `mode?: string, format?: "png" \| "jpeg" \| "webp", path?: string, clip?: Object, tabId?` | ⚙️ Tab ngầm | Chụp ảnh màn hình viewport, element, hoặc toàn trang |
| `page.getElement`| `selector: string, includeStyles?: boolean`, `tabId?` | ❌ | Lấy chi tiết thông số tọa độ, selector, XPath, CSS computed |
| `page.evaluate` | `expression?: string, script?: string, args?: any[], filePath?: string`, `tabId?` | ❌ | Thực thi mã JavaScript trong bối cảnh MAIN world (fallback CDP) |
| `page.pickColor`| `x?: number, y?: number`, `tabId?` | ❌ | Lấy mẫu màu pixel với 5 định dạng (HEX, RGB, RGBA, HSL, OKLCH) |
| `page.handleDialog` | `accept: boolean, promptText?: string`, `tabId?` | ✅ | Xử lý các hộp thoại JavaScript (alert, confirm, prompt) |
| `page.setBusy` | `busy: boolean, action?: string`, `tabId?` | ❌ | Hiển thị viền neon bảo vệ input và thanh trạng thái hoạt động |
| `session.start` | `name?: string`, `tabId?` | ❌ | Bắt đầu phiên làm việc hoạt động liên tục của Agent |
| `session.end` | `closeTab?: boolean`, `tabId?` | ❌ | Kết thúc phiên làm việc Agent và ẩn viền neon |
| `emulation.set` | `device?: string, viewport?: Object, userAgent?: string`, `tabId?` | ✅ | Giả lập kích thước viewport, thiết bị di động và User-Agent |
| `emulation.resize` | `width: number, height: number, deviceScaleFactor?: number, mobile?: boolean`, `tabId?` | ✅ | Thay đổi kích thước khung nhìn viewport trang web |
| `batch.run` | `actions: Object[], stopOnError?: boolean`, `tabId?` | ⚙️ Từng action | Thực thi hàng loạt hành động trong 1 chu trình duy nhất |
| `cdp.status` | `tabId?` | ✅ | Trả `{ attached: boolean, error?, hint? }` để kiểm tra debugger trước khi dùng `via: "cdp"` |
| `cdp.send` | `cdpMethod: string, cdpParams?: Object`, `tabId?` | ✅ | Gửi lệnh CDP thô; lỗi attach trả `CDP_UNAVAILABLE` rõ ràng |

> Các method **bắt buộc CDP**: `page.screenshot` (tab ngầm), `page.uploadFile` (`via: "cdp"`), `page.handleDialog`, `emulation.*`, `network.*`, `performance.*`, `memory.*`, `devtools.getData`, `lighthouse.*`, `accessibility.*`.
> Synthetic event **không vượt được cross-origin iframe** và không điều khiển được canvas/WebGL.
> `memory.heapSnapshot` lưu snapshot V8 ra file `.heapsnapshot`; dùng MCP `browser_analyze_heapsnapshot` để query, xem retainers/retaining paths hoặc compare hai snapshot.

---

## 2. Tin Nhắn Gửi Tới Content Script (Web Page Context)

Các lệnh được gửi qua `chrome.tabs.sendMessage(tabId, { action: "...", ... })`:

### 2.1 Chuột Ảo & Tương Tác
| Action | Tham số | Phản hồi | Mô tả |
| :--- | :--- | :--- | :--- |
| `virtual_mouse_move` | `x: number, y: number, duration?: number` | `{ x, y }` | Di chuyển con trỏ chuột ảo mượt mà đến tọa độ chỉ định |
| `virtual_mouse_click`| `x?: number, y?: number` | `{ success: boolean, element }` | Kích hoạt hiệu ứng sóng ripple và chuỗi sự kiện click DOM |
| `virtual_type` | `selector?: string, text: string` | `{ success: boolean, textEntered }` | Tự động gõ từng ký tự vào ô nhập |
| `virtual_scroll` | `deltaX?: number, deltaY?: number` | `{ success: true, scrollX, scrollY }` | Cuộn trang theo hướng ngang/dọc |

### 2.2 Soi Phần Tử, Vùng Cắt & Lấy Màu
| Action | Tham số | Phản hồi | Mô tả |
| :--- | :--- | :--- | :--- |
| `toggle_inspector` | `enabled: boolean` | `{ success: true, active }` | Bật hoặc tắt chế độ thanh tra phần tử DOM |
| `get_element_info` | `selector?: string` | `{ success: boolean, details }` | Lấy chi tiết thông số tọa độ, selector, xpath |
| `start_region_crop`| Không | `{ success: true }` | Bật lớp phủ kéo thả chữ nhật để chọn vùng chụp |
| `pick_color` | Không | `{ success: boolean, color: {hex, rgb, rgba, hsl, oklch} }` | Mở công cụ lấy màu pixel trên màn hình với 5 định dạng |
| `set_agent_busy` | `busy: boolean, currentAction?: string` | `{ success: boolean, isAgentBusy: boolean, isSessionActive: boolean }` | Bật/tắt viền phát sáng và pill trạng thái hoạt động của Agent |

---

## 3. Sự Kiện Phát Sóng Cục Bộ (Broadcast Events)

Service Worker và Content Script phát sóng các sự kiện sau tới Side Panel:

| Tên sự kiện (`type`) | Cấu trúc dữ liệu | Mục đích |
| :--- | :--- | :--- |
| `DEBUGGER_STATUS_CHANGED` | `{ tabId: number, attached: boolean }` | Thông báo thay đổi trạng thái kết nối CDP |
| `DEVTOOLS_CONSOLE_EVENT` | `{ tabId: number, entry: { type, text, timestamp } }` | Đẩy console log mới xuất hiện |
| `DEVTOOLS_NETWORK_EVENT` | `{ tabId: number, request: { id, url, method, status } }` | Cập nhật tiến trình của network request |
| `ELEMENT_SELECTED` | `{ details: ElementDetailsObject }` | Người dùng đã click chọn một phần tử khi soi |
| `COLOR_PICKED` | `{ color: { hex, rgb, rgba, hsl, oklch, timestamp } }` | Người dùng đã nhặt được một mã màu mới (5 định dạng) |
| `REGION_CROP_REQUESTED` | `{ clip: { x, y, width, height } }` | Người dùng đã kéo chọn xong vùng cần chụp |
| `FEEDBACK_ITEMS_UPDATED` | `{ items: FeedbackItem[] }` | Đồng bộ danh sách chú thích UI giữa Web Page và Side Panel |

---

## 4. API Đối Tượng Toàn Cục `window.__AGENT_PILOT__`

Được tích hợp sẵn trong Content Script để phục vụ việc lập trình tự động hóa:

> ⚠️ **Ngữ nghĩa lỗi (Error Semantics)**: Các phương thức trả về `Promise` sẽ **reject kèm một `Error`** khi thao tác thất bại (trước đây resolve `null`). Riêng trường hợp **hết thời gian chờ (timeout)** vẫn resolve `null`.

```typescript
interface AgentPilotBridge {
  version: string;
  moveMouse(x: number, y: number, duration?: number): Promise<{ x: number, y: number }>;
  click(x?: number, y?: number): Promise<{ success: boolean, element: any }>;
  animateClick(x: number, y: number, selector?: string): Promise<any>;
  type(selector: string | null, text: string, clear?: boolean): Promise<{ success: boolean, textEntered?: string }>;
  scroll(deltaX?: number, deltaY?: number): Promise<{ success: boolean, scrollX: number, scrollY: number }>;
  hover(selector: string): Promise<any>;
  drag(from: string | { x: number, y: number }, to: string | { x: number, y: number }, steps?: number): Promise<any>;
  pressKey(key: string, selector?: string): Promise<any>;
  waitFor(options: any): Promise<any>;
  snapshot(maxElements?: number, format?: string): Promise<any>;
  fillForm(fields: any, submitSelector?: string, pressEnter?: boolean): Promise<any>;
  toggleInspector(enabled: boolean): Promise<{ success: boolean, active: boolean }>;
  isInspectorActive(): Promise<{ active: boolean }>;
  getElement(selector: string, includeStyles?: boolean): Promise<ElementDetails | null>;
  startElementSnap(): Promise<{ success: boolean }>;
  stopElementSnap(): Promise<{ success: boolean }>;
  isElementSnapActive(): Promise<boolean>;
  startRegionCrop(): Promise<{ success: boolean }>;
  getLockedElement(): Promise<ElementDetails | null>;
  pickColor(x?: number, y?: number): Promise<{ success: boolean, color: { hex: string, rgb: string, rgba: string, hsl: string, oklch: string } | null }>;
  stopEyedropper(): Promise<{ success: boolean }>;
  isEyedropperActive(): Promise<{ active: boolean }>;
  getCursorPosition(): Promise<{ x: number, y: number }>;
  // Trạng thái tương tác & phiên Agent
  isBusy(): Promise<boolean>;
  isAgentTab(): Promise<boolean>;
  setBusy(busy: boolean, action?: string): Promise<{ success: boolean, isAgentBusy: boolean }>;
  // In-Page Feedback Studio
  startFeedbackStudio(): Promise<{ success: boolean, active: boolean }>;
  stopFeedbackStudio(): Promise<{ success: boolean, active: boolean }>;
  isFeedbackStudioActive(): Promise<boolean>;
  getFeedbackItems(): Promise<FeedbackItem[]>;
  addFeedbackItem(item: FeedbackItem): Promise<any>;
  clearFeedbackItems(): Promise<{ success: boolean }>;
  copyFeedbackPrompt(): Promise<any>;
  generateFeedbackPrompt(items?: FeedbackItem[]): Promise<string>;
}
```

---

## 5. Danh Mục Công Cụ Model Context Protocol (MCP) (68 Công Cụ)

Agent Pilot cung cấp 68 schema công cụ chuẩn Model Context Protocol (MCP) qua giao tiếp stdio (`agent-pilot mcp`) và thư mục schema (`mcp/agent-pilot/`). Toàn bộ các công cụ đều ánh xạ trực tiếp đến các lệnh RPC qua bridge:

| Nhóm chức năng | Danh sách công cụ (Số lượng) | Mô tả |
| :--- | :--- | :--- |
| **Quản lý Tab & Điều hướng** | `browser_open_tab`, `browser_close_tab`, `browser_list_tabs`, `browser_navigate` (4) | Vòng đời tab Chrome trong nhóm tab cách ly `🤖 Agent Pilot`. |
| **Instance & Phiên làm việc** | `browser_list_instances`, `browser_select_instance`, `browser_start_session`, `browser_end_session`, `browser_set_busy` (5) | Khám phá đa trình duyệt, định tuyến instance, duy trì phiên hiển thị chuột neon và khiên khóa tương tác người dùng. |
| **Tương tác Trang Web** | `browser_click`, `browser_type`, `browser_scroll`, `browser_hover`, `browser_drag`, `browser_press_key`, `browser_fill_form`, `browser_upload_file`, `browser_handle_dialog` (9) | Tự động hóa chuột & bàn phím (synthetic DOM hoặc CDP đáng tin cậy qua `via: "cdp"`), tải lên tệp tin và xử lý hộp thoại JS. |
| **Quan sát & Thanh tra** | `browser_snapshot`, `browser_screenshot`, `browser_get_element`, `browser_evaluate`, `browser_wait_for`, `browser_pick_color` (6) | Bản chụp DOM/Accessibility, chụp ảnh màn hình tăng tốc phần cứng kèm chú thích/spotlight, hình học phần tử, chạy JS và nhặt mã màu. |
| **Thực thi Hàng loạt** | `browser_run_actions` (1) | Bộ máy thực thi chuỗi hành động nguyên tử trong 1 round-trip (tiết kiệm 80%+ token và độ trễ). |
| **Feedback Studio** | `browser_get_pending_feedback`, `browser_wait_for_feedback` (2) | Hệ thống phản hồi trực quan 3 kênh: đọc phản hồi từ hộp thư đến hoặc long-polling thời gian thực. |
| **Giả lập & Bối cảnh Cô lập** | `browser_emulate`, `browser_resize_page`, `browser_create_context`, `browser_list_contexts`, `browser_close_context` (5) | Giả lập thiết bị/khung nhìn và tạo bối cảnh trình duyệt cô lập nhiều người dùng (tab ID âm). |
| **DevTools & Mạng** | `browser_devtools_status`, `browser_get_devtools_data`, `browser_list_network_requests`, `browser_get_network_request`, `browser_get_css_styles` (5) | Kiểm tra kết nối CDP, bộ đệm console/network, nội dung response HTTP và thanh tra CSS computed/cascade. |
| **Hiệu năng & Kiểm định** | `browser_performance_metrics`, `browser_performance_trace`, `browser_performance_analyze_insight`, `browser_lighthouse_audit`, `browser_lighthouse_analyze_audit`, `browser_accessibility_snapshot` (6) | Đo lường Core Web Vitals, trace timeline, phân tích insight hiệu năng, kiểm định Lighthouse và cây accessibility. |
| **Bộ nhớ & JS Heap** | `browser_heap_capability`, `browser_take_heapsnapshot`, `browser_analyze_heapsnapshot` (3) | Kiểm tra năng lực HeapProfiler, chụp snapshot V8 heap, truy vấn retainers và so sánh constructor. |
| **Ghi hình & Service Workers** | `browser_screencast_start`, `browser_screencast_stop`, `browser_service_workers` (3) | Ghi video màn hình MP4 gốc và kiểm tra/debug Service Workers. |
| **Chrome Recorder** | `browser_recorder_start`, `browser_recorder_stop`, `browser_recorder_state`, `browser_recorder_replay`, `browser_recorder_measure`, `browser_recorder_export`, `browser_recorder_import`, `browser_recorder_edit`, `browser_recorder_clear` (9) | Ghi lại luồng DevTools Recorder, phát lại, đo lường hiệu năng, xuất/nhập JSON và chỉnh sửa bước. |
| **Extensions & WebAuthn** | `browser_manage_extensions`, `browser_webauthn` (2) | Quản lý vòng đời tiện ích mở rộng Chrome (install/toggle/reload) và giả lập khóa bảo mật WebAuthn/Passkey. |
| **PWA & Công cụ WebMCP** | `browser_install_pwa`, `browser_launch_pwa`, `browser_uninstall_pwa`, `browser_get_os_app_state`, `browser_list_webmcp_tools`, `browser_execute_webmcp_tool`, `browser_list_3p_developer_tools`, `browser_execute_3p_developer_tool` (8) | Quản lý ứng dụng PWA, thực thi công cụ WebMCP do trang phơi bày và tích hợp công cụ nhà phát triển bên thứ ba. |

*(Tổng cộng: 68 Công cụ — xem chi tiết schema tham số trong [DEVTOOLS.md](DEVTOOLS.md) và `skills/agent-pilot/references/tool-routing.md`).*
