# DevTools nâng cao

Bản phát hành chứa một MCP binary tự đủ. Máy sử dụng chỉ cần Chrome, extension và binary đúng hệ điều hành/CPU. Không cần cài Node.js, npm, FFmpeg, chạy `install` dependency hay mở cổng remote debugging. Có thể trỏ cấu hình MCP thẳng vào binary vừa giải nén; script cài service là tùy chọn.

Runtime và các thư viện đã khóa phiên bản được nhúng trong binary. Khi gọi tính năng nâng cao lần đầu, server giải nén chúng vào cache riêng của ứng dụng và tự khởi chạy. Không tải hoặc cài thêm phần mềm từ mạng. Các thao tác extension cơ bản vẫn chạy trực tiếp; runtime nâng cao chỉ khởi động khi cần. Audit và trace có thể dùng nhiều RAM hơn bridge cơ bản.

## Các tool mới

| Tool | Chức năng |
| --- | --- |
| `browser_get_css_styles` | Matched rules, inline/inherited styles, specificity, `!important`, layers, media/supports/container/scope, vị trí nguồn, computed styles; phân trang. |
| `browser_lighthouse_audit` | Lighthouse thật trên tab hiện tại; điểm, audit thất bại, DOM liên quan, báo cáo HTML/JSON. |
| `browser_lighthouse_analyze_audit` | Đào sâu audit theo `auditId`: mô tả, nguyên nhân, đề xuất, bảng chi tiết và DOM; đọc lại JSON sau khi khởi động lại. |
| `browser_performance_analyze_insight` | Phân tích bằng DevTools trace engine: liệt kê insight sets rồi đào sâu LCP, CLS, render blocking và các insight có trong trace. |
| `browser_screencast_start`, `browser_screencast_stop` | Quay MP4 bằng encoder trong Chrome, trả file khi dừng. |
| `browser_create_context`, `browser_list_contexts`, `browser_close_context` | Phiên đăng nhập độc lập thật, có vòng đời rõ ràng. |
| `browser_service_workers` | Liệt kê worker đang chạy, evaluate async, đọc console/error, gửi lệnh CDP Debugger và detach. |
| `browser_accessibility_snapshot` | Accessibility tree thật của Chrome, vai trò/tên/trạng thái và backend DOM IDs. |
| `browser_devtools_status` | Kiểm tra phiên bản runtime nhúng; không cần Node trên PATH. |
| `browser_analyze_heapsnapshot` | Phân tích file V8 `.heapsnapshot`: constructor summary, class nodes/details, edges/retainers/retaining paths, dominator chain, duplicate strings, context analysis, close cache và diff giữa hai snapshot. `action: compare` dùng hai path; các action khác dùng `filePath`. |
| `browser_list_3p_developer_tools`, `browser_execute_3p_developer_tool` | Discover và gọi developer tools mà trang tự expose qua event `devtoolstooldiscovery`, không cấp thêm quyền ngoài JavaScript của trang. |
| `browser_list_webmcp_tools`, `browser_execute_webmcp_tool` | Discover và gọi WebMCP tools mà trang expose qua Puppeteer WebMCP runtime; không mở thêm quyền ngoài trang. |
| `browser_get_os_app_state`, `browser_install_pwa`, `browser_launch_pwa`, `browser_uninstall_pwa` | Đọc và quản lý PWA qua browser-scoped `PWA.*` CDP domain. Chỉ hoạt động trên Chrome build có experimental PWA domain; không chạy qua extension relay. |
| `browser_get_network_request` | Ngoài metadata và response body, có thể lấy request POST body, tắt từng body, và lưu request/response ra file `.network-request`/`.network-response`. |
| `browser_recorder_start`, `browser_recorder_stop`, `browser_recorder_state`, `browser_recorder_replay`, `browser_recorder_measure`, `browser_recorder_export`, `browser_recorder_import`, `browser_recorder_edit`, `browser_recorder_clear` | Ghi, replay, chỉnh sửa, đo performance và trao đổi user flow theo JSON của Chrome DevTools Recorder. JSON giữ thuộc tính gốc; replay chỉ hỗ trợ tập step phù hợp với main-frame extension tab. |

Các thao tác quản lý extension qua `browser_manage_extensions` hỗ trợ `list`, `setEnabled`, `toggle`, `install`, `reload`, `triggerAction` và `uninstall`. Các thao tác lifecycle cần Chrome CDP Extensions domain; extension managed/policy-controlled có thể từ chối. `uninstall` yêu cầu agent truyền xác nhận rõ ràng khi nhắm chính Agent Pilot.

`browser_performance_trace` giờ lưu đầy đủ raw trace `.json`/`.json.gz`, không bị cắt ở 2.000 events. Dừng trace trả `traceId`, file và insight sets. File có thể mở lại trong Chrome DevTools.

## Ví dụ MCP

```json
{"tool":"browser_get_css_styles","arguments":{"tabId":123,"selector":"#submit","pageSize":10}}
{"tool":"browser_lighthouse_audit","arguments":{"tabId":123,"mode":"snapshot"}}
{"tool":"browser_lighthouse_analyze_audit","arguments":{"reportId":"<reportId>","auditId":"color-contrast","pageSize":20}}
{"tool":"browser_performance_trace","arguments":{"tabId":123,"action":"start","reload":true}}
{"tool":"browser_performance_trace","arguments":{"tabId":123,"action":"stop","filePath":"/absolute/path/trace.json.gz"}}
{"tool":"browser_performance_analyze_insight","arguments":{"traceId":"<traceId>","insightSetId":"<id from trace>","insightName":"LCPBreakdown"}}
{"tool":"browser_screencast_start","arguments":{"tabId":123,"filePath":"/absolute/path/demo.mp4"}}
{"tool":"browser_screencast_stop","arguments":{"tabId":123}}
{"tool":"browser_recorder_start","arguments":{"tabId":123,"title":"Checkout flow"}}
{"tool":"browser_recorder_export","arguments":{"tabId":123}}
{"tool":"browser_recorder_replay","arguments":{"tabId":123}}
{"tool":"browser_recorder_measure","arguments":{"tabId":123}}
{"tool":"browser_analyze_heapsnapshot","arguments":{"action":"compare","baseFilePath":"/tmp/before.heapsnapshot","currentFilePath":"/tmp/after.heapsnapshot"}}
{"tool":"browser_list_3p_developer_tools","arguments":{"tabId":123}}
{"tool":"browser_execute_3p_developer_tool","arguments":{"tabId":123,"toolName":"component_state","input":{"id":"checkout"}}}
{"tool":"browser_list_webmcp_tools","arguments":{"tabId":-1}}
{"tool":"browser_execute_webmcp_tool","arguments":{"tabId":-1,"toolName":"checkout","input":{"cartId":"cart-1"}}}
{"tool":"browser_get_os_app_state","arguments":{"manifestId":"https://example.test/manifest.webmanifest"}}
{"tool":"browser_launch_pwa","arguments":{"manifestId":"https://example.test/manifest.webmanifest"}}
```

Audit `navigation` tải lại trang; `snapshot` kiểm tra trạng thái hiện tại. Mặc định chạy accessibility, best practices và SEO; thêm `performance` vào `categories` nếu muốn. `device` chọn giả định đánh giá của Lighthouse; viewport và user agent hiện tại được giữ để audit đúng trạng thái đã cấu hình qua `browser_emulate`. Báo cáo lưu tại `~/.agent-pilot/artifacts/` trừ khi chỉ định đường dẫn. File đã tồn tại không bị ghi đè.

Quay video yêu cầu Chrome hiện hành có `Page.startScreenRecording`. Không có fallback yêu cầu cài FFmpeg.

CSS trả computed values cuối cùng từ Chrome. Trạng thái declaration được tính trong từng tầng kế thừa; animation, `@scope`, container query hoặc cơ chế cascade đặc biệt có thể ảnh hưởng giá trị cuối cùng. Không xem các declaration trong ancestor là thuộc tính tự động kế thừa của node đang chọn.

## Giả lập môi trường

`browser_emulate` hỗ trợ CPU; offline/3G/4G hoặc tốc độ mạng tùy chỉnh; theme; reduced motion; contrast; forced colors; geolocation; user agent/client hints; HTTP headers; locale; timezone; viewport/mobile/touch/landscape/DPR. Các lần gọi giữ các thiết lập đã áp dụng trước đó. Dùng `auto`, chuỗi trống hoặc `null` theo schema để reset. Geolocation override vẫn tuân theo quyền vị trí của website.

```json
{"tool":"browser_emulate","arguments":{"tabId":123,"networkConditions":"slow-4g","prefersReducedMotion":"reduce","prefersContrast":"more","geolocation":{"latitude":13.75,"longitude":100.5,"accuracy":10},"timezoneId":"Asia/Bangkok","locale":"vi-VN","viewport":{"width":390,"height":844,"deviceScaleFactor":3,"mobile":true,"touch":true},"extraHttpHeaders":{"X-Test-Run":"mobile"}}}
```

## Phiên đăng nhập độc lập

Context riêng sử dụng một Chrome do server tự mở qua pipe, không dùng profile cá nhân. Mỗi context có cookies, localStorage, IndexedDB, cache và service workers độc lập. Tab trong context có ID âm; truyền ID đó vào các tool thao tác như click, type, evaluate, screenshot, audit và trace. Chỉ agent tạo context được thao tác lên context/tab đó.

```json
{"tool":"browser_create_context","arguments":{"name":"account-a"}}
{"tool":"browser_open_tab","arguments":{"url":"https://example.com/login","contextId":"<contextId>"}}
{"tool":"browser_create_context","arguments":{"name":"account-b"}}
{"tool":"browser_open_tab","arguments":{"url":"https://example.com/login","contextId":"<other-contextId>"}}
{"tool":"browser_close_context","arguments":{"contextId":"<contextId>"}}
```

Cũng có thể mở trực tiếp với `isolatedContext: "account-a"`; context cùng tên được dùng lại trong phạm vi agent hiện tại. `headless` áp dụng lúc mở Chrome quản lý đầu tiên. Đóng context xóa phiên đăng nhập của context. Context không sống qua lần khởi động lại server. UI con trỏ/HUD của extension không được chèn vào các tab context do runtime quản lý.

Service worker chỉ hiện khi đang chạy. Gọi `list`, chọn `serviceWorkerId`, rồi `evaluate`, `console`, `send` hoặc `detach`. Muốn nhận console từ trước thao tác, gọi `console` để attach trước. Trong context riêng, truyền thêm `contextId`.

## CLI

CLI dùng cùng trường tham số với MCP:

```bash
agent-pilot devtools status
agent-pilot devtools css --tab 123 --params '{"selector":"#submit"}'
agent-pilot devtools audit --tab 123 --params '{"mode":"snapshot"}'
agent-pilot devtools audit-details --params '{"filePath":"/path/report.json","auditId":"image-alt"}'
agent-pilot devtools video-start --tab 123
agent-pilot devtools video-stop --tab 123
agent-pilot recorder start --tab 123 --title "Checkout flow"
agent-pilot recorder export --tab 123 --format json > checkout.recorder.json
agent-pilot recorder replay --file checkout.recorder.json --tab 123 --format json
agent-pilot devtools context-create --params '{"name":"account-a"}'
agent-pilot devtools workers --params '{"action":"list"}'
```

Lệnh start/stop nhiều bước cần cùng một bridge/MCP server đang chạy để giữ state, như các phiên MCP bình thường.

Recorder dùng `chrome.storage` để khôi phục flow khi service worker thức dậy. `browser_recorder_measure` cần tab ID Chrome dương, trả `failurePhase` nếu trace/replay lỗi hoặc replay chuyển sang tab khác; mặc định lược `eventsSummary` để giảm payload (`includeEvents: true` để nhận đầy đủ). Import/export giữ metadata của Chrome Recorder, nhưng replay trên extension tab từ chối các step không hỗ trợ như iframe/target khác, viewport và assertion nâng cao thay vì báo thành công giả.

## Dành cho người build

Chỉ máy build cần Go và Node để chạy `npm ci` rồi `npm run build:cli`. Script tải Node distribution đã pin và xác minh SHA-256, đóng gói runtime/dependency, sau đó nhúng archive vào Go binary. `npm run pack:bundle` làm bước này cho từng OS/architecture. Chạy `go build` trực tiếp mà chưa chuẩn bị payload tạo developer binary chỉ có nhóm chức năng cơ bản; không dùng binary đó để phát hành.

Runtime chứa mã và giấy phép Node/Lighthouse/Puppeteer cùng các dependency; không yêu cầu cài chúng riêng trên máy sử dụng. Bản thân Go bridge vẫn dùng `CGO_ENABLED=0`; runtime Chrome/Node nhúng dùng nền tảng hệ điều hành tương ứng.
