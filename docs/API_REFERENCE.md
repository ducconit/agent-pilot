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
| `set_busy` | `busy: boolean, action?: string` | `{ success: boolean }` | Bật/tắt viền phát sáng và pill trạng thái hoạt động của Agent |

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

```typescript
interface AgentPilotBridge {
  version: string;
  moveMouse(x: number, y: number, duration?: number): Promise<{ x: number, y: number }>;
  click(x?: number, y?: number): Promise<{ success: boolean, element: any }>;
  type(selector: string | null, text: string): Promise<{ success: boolean, textEntered?: string }>;
  scroll(deltaX?: number, deltaY?: number): { success: boolean, scrollX: number, scrollY: number };
  toggleInspector(enabled: boolean): void;
  getElement(selector: string): ElementDetails | null;
  getLockedElement(): ElementDetails | null;
  startRegionCrop(): void;
  pickColor(): Promise<{ hex: string, rgb: string, rgba: string, hsl: string, oklch: string } | null>;
  getCursorPosition(): { x: number, y: number };
}
```
