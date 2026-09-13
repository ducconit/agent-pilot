package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
)

func printUsage() {
	fmt.Println(`Agent Pilot CLI (v1.0.6-beta) - Universal AI Agent Browser Controller
Mã nguồn & Tài liệu: https://github.com/ducconit/agent-pilot-extension

SỬ DỤNG:
  agent-pilot [lệnh] [tùy chọn]

CÁC LỆNH HỖ TRỢ:
  mcp                           Khởi chạy MCP Server (stdio JSON-RPC) cho AI Agent (Mặc định)
  server [--port 58765]         Khởi chạy Bridge Server nền lắng nghe kết nối từ Extension
  service <action>              Quản lý service chạy ngầm (install, uninstall, start, stop, restart, status)

THAO TÁC TRỰC TIẾP TRÊN TRÌNH DUYỆT (DÀNH CHO TESTER / QC / SCRIPT):
  click <selector>              Click chuột ảo vào phần tử DOM
  type <selector> <text>        Gõ phím vào ô nhập liệu
  open <url>                    Mở tab mới với URL chỉ định
  navigate <url>                Điều hướng tab hiện tại đến URL
  screenshot [tùy chọn]         Chụp ảnh màn hình (Lưu ra file PNG)
  inspect <selector>            Soi và trích xuất thông số phần tử DOM
  busy [on|off]                 Bật/tắt viền phát sáng và chỉ báo trạng thái AI Agent trên tab
  tabs                          Liệt kê danh sách tất cả các tab đang mở
  batch <script.json>           Thực thi chuỗi hành động automation từ file JSON
  feedback [list|wait]          Xem danh sách hoặc chờ phản hồi từ người dùng

TÙY CHỌN BỔ SUNG:
  --tab <id>                    Chỉ định Tab ID mục tiêu
  --port <58765>                Cổng kết nối bridge server (Mặc định: 58765)
  --output, -o <file.png>       Đường dẫn lưu file ảnh screenshot
  --mode <visible|full|region>  Chế độ chụp màn hình
  --clear                       Xóa nội dung input trước khi gõ
  --enter                       Bấm Enter sau khi gõ xong
  --help, -h                    Hiển thị hướng dẫn sử dụng này

VÍ DỤ NHANH:
  agent-pilot click "#btn-login"
  agent-pilot type "#email" "tester@example.com" --enter
  agent-pilot screenshot -o homepage.png --mode full
  agent-pilot batch test_flow.json`)
}

// busyValueFlags defines non-boolean flags that consume a following value argument.
// NOTE FOR MAINTAINERS: When registering a new non-boolean flag in busyFlags below,
// ensure it is added to this map so its argument is not misidentified as a positional on/off toggle.
var busyValueFlags = map[string]bool{
	"-action":  true,
	"--action": true,
	"-tab":     true,
	"--tab":    true,
}

func ParseBusyArgs(args []string) (bool, string, interface{}, error) {
	tabID := 0
	actionDesc := "AI Agent đang thao tác..."
	isBusy := true

	var flagArgs []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if i > 0 {
			prev := args[i-1]
			if busyValueFlags[prev] {
				flagArgs = append(flagArgs, arg)
				continue
			}
		}

		lower := strings.ToLower(arg)
		if lower == "on" || lower == "true" || lower == "1" {
			isBusy = true
		} else if lower == "off" || lower == "false" || lower == "0" {
			isBusy = false
		} else {
			flagArgs = append(flagArgs, arg)
		}
	}

	busyFlags := flag.NewFlagSet("busy", flag.ContinueOnError)
	busyFlags.IntVar(&tabID, "tab", 0, "Target tab ID")
	busyFlags.StringVar(&actionDesc, "action", actionDesc, "Action description")
	if err := busyFlags.Parse(flagArgs); err != nil {
		return false, "", nil, err
	}

	var targetTab interface{}
	if tabID > 0 {
		targetTab = tabID
	}
	return isBusy, actionDesc, targetTab, nil
}

func main() {
	if len(os.Args) < 2 {
		// If running without arguments, default to MCP Server for AI Agent stdio pipes
		// Check if input is a pipe or terminal
		stat, _ := os.Stdin.Stat()
		if (stat.Mode() & os.ModeCharDevice) == 0 {
			RunMCPServer()
			return
		}
		printUsage()
		return
	}

	cmd := os.Args[1]

	switch cmd {
	case "mcp":
		RunMCPServer()

	case "server":
		serverFlags := flag.NewFlagSet("server", flag.ExitOnError)
		port := serverFlags.Int("port", DefaultPort, "Port to listen on")
		_ = serverFlags.Parse(os.Args[2:])
		if err := StartBridgeServer(*port); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Server error: %v\n", err)
			os.Exit(1)
		}

	case "service":
		if err := HandleServiceCommand(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Service error: %v\n", err)
			os.Exit(1)
		}

	case "click":
		clickFlags := flag.NewFlagSet("click", flag.ExitOnError)
		tabID := clickFlags.Int("tab", 0, "Target tab ID")
		x := clickFlags.Float64("x", 0, "X coordinate")
		y := clickFlags.Float64("y", 0, "Y coordinate")
		_ = clickFlags.Parse(os.Args[2:])

		args := clickFlags.Args()
		selector := ""
		if len(args) > 0 {
			selector = args[0]
		}
		var t interface{}
		if *tabID > 0 {
			t = *tabID
		}
		if err := ExecClick(selector, *x, *y, t); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "type":
		typeFlags := flag.NewFlagSet("type", flag.ExitOnError)
		tabID := typeFlags.Int("tab", 0, "Target tab ID")
		clear := typeFlags.Bool("clear", false, "Clear field before typing")
		enter := typeFlags.Bool("enter", false, "Press enter after typing")
		_ = typeFlags.Parse(os.Args[2:])

		args := typeFlags.Args()
		if len(args) < 2 {
			fmt.Println("Sử dụng: agent-pilot type <selector> <text> [--clear] [--enter] [--tab <id>]")
			os.Exit(1)
		}
		var t interface{}
		if *tabID > 0 {
			t = *tabID
		}
		if err := ExecType(args[0], args[1], *clear, *enter, t); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "open":
		openFlags := flag.NewFlagSet("open", flag.ExitOnError)
		active := openFlags.Bool("active", false, "Make tab active")
		_ = openFlags.Parse(os.Args[2:])
		args := openFlags.Args()
		if len(args) < 1 {
			fmt.Println("Sử dụng: agent-pilot open <url> [--active]")
			os.Exit(1)
		}
		if err := ExecOpen(args[0], *active); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "navigate":
		navFlags := flag.NewFlagSet("navigate", flag.ExitOnError)
		tabID := navFlags.Int("tab", 0, "Target tab ID")
		_ = navFlags.Parse(os.Args[2:])
		args := navFlags.Args()
		if len(args) < 1 {
			fmt.Println("Sử dụng: agent-pilot navigate <url> [--tab <id>]")
			os.Exit(1)
		}
		var t interface{}
		if *tabID > 0 {
			t = *tabID
		}
		if err := ExecNavigate(args[0], t); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "screenshot":
		shotFlags := flag.NewFlagSet("screenshot", flag.ExitOnError)
		tabID := shotFlags.Int("tab", 0, "Target tab ID")
		mode := shotFlags.String("mode", "visible", "Capture mode: visible, region, element, full")
		out := shotFlags.String("o", "", "Output PNG path")
		selector := shotFlags.String("selector", "", "CSS selector for element mode")
		_ = shotFlags.Parse(os.Args[2:])

		var t interface{}
		if *tabID > 0 {
			t = *tabID
		}
		if err := ExecScreenshot(*mode, *selector, *out, t); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "inspect":
		inspFlags := flag.NewFlagSet("inspect", flag.ExitOnError)
		tabID := inspFlags.Int("tab", 0, "Target tab ID")
		_ = inspFlags.Parse(os.Args[2:])
		args := inspFlags.Args()
		if len(args) < 1 {
			fmt.Println("Sử dụng: agent-pilot inspect <selector> [--tab <id>]")
			os.Exit(1)
		}
		var t interface{}
		if *tabID > 0 {
			t = *tabID
		}
		if err := ExecInspect(args[0], t); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "busy":
		isBusy, actionDesc, targetTab, err := ParseBusyArgs(os.Args[2:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error parsing arguments: %v\n", err)
			os.Exit(1)
		}
		if err := ExecBusy(isBusy, actionDesc, targetTab); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "tabs":
		if err := ExecListTabs(); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "batch":
		if len(os.Args) < 3 {
			fmt.Println("Sử dụng: agent-pilot batch <path-to-script.json>")
			os.Exit(1)
		}
		filePath := os.Args[2]
		raw, err := os.ReadFile(filePath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Không thể đọc file: %v\n", err)
			os.Exit(1)
		}

		var payload map[string]interface{}
		if err := json.Unmarshal(raw, &payload); err != nil {
			// Try as array of actions
			var actList []interface{}
			if aErr := json.Unmarshal(raw, &actList); aErr == nil {
				payload = map[string]interface{}{"actions": actList}
			} else {
				fmt.Fprintf(os.Stderr, "❌ File JSON không hợp lệ: %v\n", err)
				os.Exit(1)
			}
		}

		res, err := DispatchCommand("batch.run", payload, DefaultPort)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Thực thi batch thất bại: %v\n", err)
			os.Exit(1)
		}
		resJSON, _ := json.MarshalIndent(res, "", "  ")
		fmt.Printf("✅ Kết quả thực thi Batch:\n%s\n", string(resJSON))

	case "feedback":
		sub := "list"
		if len(os.Args) > 2 {
			sub = os.Args[2]
		}
		if sub == "list" {
			res, err := GetPendingFeedback(10, "", false)
			if err != nil {
				fmt.Fprintf(os.Stderr, "❌ Lỗi: %v\n", err)
				os.Exit(1)
			}
			jsonB, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(jsonB))
		} else if sub == "wait" {
			timeout := 120
			if len(os.Args) > 3 {
				timeout, _ = strconv.Atoi(os.Args[3])
			}
			fmt.Printf("⏳ Đang chờ người dùng gửi feedback từ trình duyệt (Timeout: %ds)...\n", timeout)
			res := WaitForFeedback(timeout, nil)
			jsonB, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(jsonB))
		}

	case "export-mcp":
		outDir := "mcp/agent-pilot"
		if len(os.Args) > 2 {
			outDir = os.Args[2]
		}
		if err := ExportMCPSchemas(outDir); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Lỗi xuất schema MCP: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("✅ Đã xuất 16 tool schemas MCP thành công vào: %s\n", outDir)

	case "--help", "-h", "help":
		printUsage()

	default:
		fmt.Printf("Lệnh không hợp lệ: %s\n\n", cmd)
		printUsage()
		os.Exit(1)
	}
}
