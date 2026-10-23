// cli_usage.go holds the top-level help text and its printer. The usage string
// is kept verbatim as a raw constant so the CLI output stays byte-for-byte
// identical to previous releases.

package cli

import (
	"fmt"

	"github.com/ducconit/agent-pilot-extension/cli/version"
)

// usageTextTemplate is printed by `agent-pilot` with no arguments
// (interactive), `--help`, `-h` or `help`. The version is injected at build
// time (see the version package); the rest of the text stays verbatim.
const usageTextTemplate = `Agent Pilot CLI (%s) - Universal AI Agent Browser Controller
Mã nguồn & Tài liệu: https://github.com/ducconit/agent-pilot-extension

SỬ DỤNG:
  agent-pilot [lệnh] [tùy chọn]

CÁC LỆNH HỖ TRỢ:
  mcp                           Khởi chạy MCP Server (stdio JSON-RPC) cho AI Agent (Mặc định)
  server [--port 58765]         Khởi chạy Bridge Server nền lắng nghe kết nối từ Extension
  service <action>              Quản lý service chạy ngầm (install, uninstall, start, stop, restart, status)
  skill install [tùy chọn]      Cài skill agent-pilot vào thư mục skills (~/.agents/skills)

THAO TÁC TRỰC TIẾP TRÊN TRÌNH DUYỆT (DÀNH CHO TESTER / QC / SCRIPT / AGENT):
  snapshot [tùy chọn]           Trích xuất bản đồ phần tử tương tác (@1, @2...) cực nhẹ cho Agent
  fill <fields.json> [tùy chọn] Điền toàn bộ form và tự động submit chỉ trong 1 thao tác
  click <selector>              Click chuột ảo (dùng --x/--y cho tọa độ; --via cdp cho trusted CDP)
  type <selector> <text>        Gõ phím vào ô nhập liệu (hỗ trợ ref @1 hoặc CSS selector)
  hover <selector>              Di chuột ảo vào phần tử DOM (hỗ trợ ref @1 hoặc CSS selector)
  drag <from> <to>              Kéo thả phần tử, hoặc dùng --from-x/--from-y/--to-x/--to-y cho canvas/game
  key <keyName>                 Gửi phím đơn hoặc tổ hợp phím (Enter, Tab, Control+A...)
  upload <sel> <file1...>       Tải file từ máy lên ô nhập liệu file input qua CDP
  dialog <accept|dismiss>       Tự động xử lý hộp thoại alert, confirm, prompt
  wait <selector|text>          Chờ selector hoặc text xuất hiện với timeout
  emulate [tùy chọn]            Giả lập mạng (slow-3g, offline), CPU throttling, theme (dark/light)
  resize <width> <height>       Thay đổi kích thước khung nhìn viewport
  network [list|get <id>]       Xem danh sách request HTTP hoặc lấy response body
  console [list|errors|clear]   Xem lịch sử Console logs và Page errors (Runtime exceptions)
  trace <start|stop>            Ghi raw trace đầy đủ, bottlenecks và DevTools insights
  devtools <operation>          CSS, Lighthouse, audit drill-down, video, context riêng, worker, AX
  metrics                       Lấy chỉ số chuyên sâu (Core Web Vitals: LCP/CLS/FCP/TTFB/TBT, DOM Health, Heap)
  heap [baseline|diff|snapshot] Chụp V8 Heap Snapshot, phân tích Detached DOM & phát hiện Memory Leak
  extensions [list|toggle]      Quản lý, xem danh sách và bật/tắt các Extension đã cài đặt
  open <url>                    Mở tab mới với URL chỉ định
  navigate <url>                Điều hướng tab hiện tại đến URL
  screenshot [tùy chọn]         Chụp ảnh màn hình (Lưu ra file PNG)
  inspect <selector>            Soi và trích xuất thông số phần tử DOM
  cdp status                    Kiểm tra CDP/debugger đã attach (dùng cho --via cdp)
  session [start|end|status]    Bắt đầu/kết thúc phiên làm việc (Giữ chuột ảo và viền neon liên tục)
  busy [on|off]                 Bật/tắt viền phát sáng và chỉ báo trạng thái AI Agent trên tab
  evaluate <script>             Thực thi mã JavaScript (-f <file>, stdin, hoặc string; Alias: eval)
  tabs                          Liệt kê danh sách tất cả các tab đang mở
  batch <script.json>           Thực thi chuỗi hành động automation từ file JSON
  feedback [list|wait]          Xem danh sách hoặc chờ phản hồi từ người dùng

TÙY CHỌN BỔ SUNG:
  --tab <id>                    Chỉ định Tab ID mục tiêu
  --port <58765>                Cổng kết nối bridge server (Mặc định: 58765)
  --output, -o <file.png>       Đường dẫn lưu file ảnh screenshot
  --mode <visible|full|region>  Chế độ chụp màn hình
  --caption, --title <text>     Ghi chú tiêu đề trực tiếp lên ảnh screenshot
  --description, --desc <text>  Mô tả chi tiết bước test hiển thị trên banner screenshot
  --step <1|1/7>                Badge số thứ tự bước hiển thị trên banner screenshot
  --highlight <selector>        Khoanh vùng nổi bật phần tử DOM trên ảnh screenshot
  --via <synthetic|cdp|auto>    Backend cho click/drag/upload (upload mặc định: auto = CDP + synthetic fallback)
  --path <dir>                  Thư mục gốc cài skill (mặc định: ~/.agents/skills)
  --agy, --antigravity          Cài skill vào ~/.gemini/config/skills (Antigravity)
  --force, -f                   Ghi đè skill nếu đã tồn tại
  --clear                       Xóa nội dung input trước khi gõ
  --enter                       Bấm Enter sau khi gõ xong
  -f, --file <path>             Đường dẫn file script JS cho lệnh eval
  --max <n>                     Số lượng phần tử tối đa cho snapshot (Mặc định: 80)
  --format <text|json>          Định dạng xuất cho snapshot (Mặc định: text)
  --submit <selector>           Phần tử nút submit sau khi fill form
  --help, -h                    Hiển thị hướng dẫn sử dụng này

VÍ DỤ NHANH:
  agent-pilot snapshot --tab 1734672950
  agent-pilot fill form.json --submit "#btn-submit"
  agent-pilot click "@1"
  agent-pilot type "@2" "admin@example.com" --enter
  agent-pilot eval -f script.js --tab 1734672950
  cat script.js | agent-pilot eval --tab 1734672950
  agent-pilot screenshot -o step_1.png --step "1/7" --title "Mở trang chủ" --desc "Kiểm tra giao diện ban đầu" --highlight "@1"
  agent-pilot click -x 733 -y 668 --via cdp --tab 1734672950
  agent-pilot drag --from-x 745 --from-y 490 --to-x 745 --to-y 832 --via cdp --tab 1734672950
  agent-pilot cdp status --tab 1734672950
  agent-pilot skill install
  agent-pilot skill install --agy --force
  agent-pilot skill install --path ~/my-skills
  agent-pilot batch test_flow.json`

func printUsage() {
	fmt.Printf(usageTextTemplate+"\n", version.String())
}
