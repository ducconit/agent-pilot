package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

func printUsage() {
	fmt.Println(`Agent Pilot CLI (v1.0.7-beta) - Universal AI Agent Browser Controller
Mã nguồn & Tài liệu: https://github.com/ducconit/agent-pilot-extension

SỬ DỤNG:
  agent-pilot [lệnh] [tùy chọn]

CÁC LỆNH HỖ TRỢ:
  mcp                           Khởi chạy MCP Server (stdio JSON-RPC) cho AI Agent (Mặc định)
  server [--port 58765]         Khởi chạy Bridge Server nền lắng nghe kết nối từ Extension
  service <action>              Quản lý service chạy ngầm (install, uninstall, start, stop, restart, status)

THAO TÁC TRỰC TIẾP TRÊN TRÌNH DUYỆT (DÀNH CHO TESTER / QC / SCRIPT / AGENT):
  snapshot [tùy chọn]           Trích xuất bản đồ phần tử tương tác (@1, @2...) cực nhẹ cho Agent
  fill <fields.json> [tùy chọn] Điền toàn bộ form và tự động submit chỉ trong 1 thao tác
  click <selector>              Click chuột ảo vào phần tử DOM (hỗ trợ ref @1 hoặc CSS selector)
  type <selector> <text>        Gõ phím vào ô nhập liệu (hỗ trợ ref @1 hoặc CSS selector)
  open <url>                    Mở tab mới với URL chỉ định
  navigate <url>                Điều hướng tab hiện tại đến URL
  screenshot [tùy chọn]         Chụp ảnh màn hình (Lưu ra file PNG)
  inspect <selector>            Soi và trích xuất thông số phần tử DOM
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

// sessionValueFlags defines non-boolean flags that consume a following value argument.
var sessionValueFlags = map[string]bool{
	"-name":    true,
	"--name":   true,
	"-action":  true,
	"--action": true,
	"-tab":     true,
	"--tab":    true,
}

func ParseSessionArgs(args []string) (string, string, interface{}, error) {
	subcmd := "start"
	name := "AI Agent Session"
	tabID := 0

	var flagArgs []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if i > 0 {
			prev := args[i-1]
			if sessionValueFlags[prev] {
				flagArgs = append(flagArgs, arg)
				continue
			}
		}

		lower := strings.ToLower(arg)
		if lower == "start" || lower == "end" || lower == "stop" || lower == "status" {
			subcmd = lower
		} else {
			flagArgs = append(flagArgs, arg)
		}
	}

	sessionFlags := flag.NewFlagSet("session", flag.ContinueOnError)
	sessionFlags.IntVar(&tabID, "tab", 0, "Target tab ID")
	sessionFlags.StringVar(&name, "name", name, "Session name or task description")
	sessionFlags.StringVar(&name, "action", name, "Alias for session name")
	if err := sessionFlags.Parse(flagArgs); err != nil {
		return "", "", nil, err
	}

	var targetTab interface{}
	if tabID > 0 {
		targetTab = tabID
	}
	return subcmd, name, targetTab, nil
}

func parseEvalArgs(args []string) (string, interface{}, error) {
	var fileArg string
	var tabID int
	var positional []string

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "-f" || arg == "--file" {
			if i+1 < len(args) {
				fileArg = args[i+1]
				i++
			}
		} else if strings.HasPrefix(arg, "-f=") || strings.HasPrefix(arg, "--file=") {
			parts := strings.SplitN(arg, "=", 2)
			fileArg = parts[1]
		} else if arg == "-tab" || arg == "--tab" {
			if i+1 < len(args) {
				if id, err := strconv.Atoi(args[i+1]); err == nil {
					tabID = id
				}
				i++
			}
		} else if strings.HasPrefix(arg, "-tab=") || strings.HasPrefix(arg, "--tab=") {
			parts := strings.SplitN(arg, "=", 2)
			if id, err := strconv.Atoi(parts[1]); err == nil {
				tabID = id
			}
		} else {
			positional = append(positional, arg)
		}
	}

	var script string
	if fileArg != "" {
		data, err := os.ReadFile(fileArg)
		if err != nil {
			return "", nil, fmt.Errorf("không thể đọc file %s: %w", fileArg, err)
		}
		script = string(data)
	} else if len(positional) > 0 {
		script = positional[0]
	} else {
		// Check stdin
		stat, err := os.Stdin.Stat()
		if err == nil && (stat.Mode()&os.ModeCharDevice) == 0 {
			data, err := io.ReadAll(os.Stdin)
			if err != nil {
				return "", nil, fmt.Errorf("lỗi đọc stdin: %w", err)
			}
			script = string(data)
		}
	}

	if strings.TrimSpace(script) == "" {
		return "", nil, fmt.Errorf("vui lòng cung cấp mã script, file (-f <path>) hoặc pipe qua stdin")
	}

	var t interface{}
	if tabID > 0 {
		t = tabID
	}
	return script, t, nil
}

func parseFillArgs(args []string) ([]map[string]interface{}, string, bool, interface{}, error) {
	var submitSelector string
	var pressEnter bool
	var tabID int
	var positional []string

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "-submit" || arg == "--submit" {
			if i+1 < len(args) {
				submitSelector = args[i+1]
				i++
			}
		} else if strings.HasPrefix(arg, "-submit=") || strings.HasPrefix(arg, "--submit=") {
			parts := strings.SplitN(arg, "=", 2)
			submitSelector = parts[1]
		} else if arg == "-enter" || arg == "--enter" {
			pressEnter = true
		} else if arg == "-tab" || arg == "--tab" {
			if i+1 < len(args) {
				if id, err := strconv.Atoi(args[i+1]); err == nil {
					tabID = id
				}
				i++
			}
		} else if strings.HasPrefix(arg, "-tab=") || strings.HasPrefix(arg, "--tab=") {
			parts := strings.SplitN(arg, "=", 2)
			if id, err := strconv.Atoi(parts[1]); err == nil {
				tabID = id
			}
		} else {
			positional = append(positional, arg)
		}
	}

	var raw []byte
	if len(positional) > 0 {
		fileOrJSON := positional[0]
		data, err := os.ReadFile(fileOrJSON)
		if err == nil {
			raw = data
		} else {
			raw = []byte(fileOrJSON)
		}
	} else {
		// Check stdin
		stat, err := os.Stdin.Stat()
		if err == nil && (stat.Mode()&os.ModeCharDevice) == 0 {
			data, err := io.ReadAll(os.Stdin)
			if err != nil {
				return nil, "", false, nil, fmt.Errorf("lỗi đọc stdin: %w", err)
			}
			raw = data
		}
	}

	if len(raw) == 0 {
		return nil, "", false, nil, fmt.Errorf("vui lòng cung cấp file JSON hoặc chuỗi JSON danh sách fields")
	}

	var fields []map[string]interface{}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, "", false, nil, fmt.Errorf("không thể phân tích cú pháp fields JSON: %w", err)
	}

	var t interface{}
	if tabID > 0 {
		t = tabID
	}
	return fields, submitSelector, pressEnter, t, nil
}

func main() {
	if len(os.Args) < 2 {
		// If running without arguments, default to MCP Server for AI Agent stdio pipes
		// Check if input is a pipe or terminal
		stat, err := os.Stdin.Stat()
		if err == nil && (stat.Mode()&os.ModeCharDevice) == 0 {
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
		if err := serverFlags.Parse(os.Args[2:]); err != nil {
			os.Exit(1)
		}
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
		if err := clickFlags.Parse(os.Args[2:]); err != nil {
			os.Exit(1)
		}

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
		if err := typeFlags.Parse(os.Args[2:]); err != nil {
			os.Exit(1)
		}

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
		if err := openFlags.Parse(os.Args[2:]); err != nil {
			os.Exit(1)
		}
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
		if err := navFlags.Parse(os.Args[2:]); err != nil {
			os.Exit(1)
		}
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
		if err := shotFlags.Parse(os.Args[2:]); err != nil {
			os.Exit(1)
		}

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
		if err := inspFlags.Parse(os.Args[2:]); err != nil {
			os.Exit(1)
		}
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

	case "session":
		subcmd, name, targetTab, err := ParseSessionArgs(os.Args[2:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error parsing arguments: %v\n", err)
			os.Exit(1)
		}
		if err := ExecSession(subcmd, name, targetTab); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "snapshot":
		var tabID int
		var maxEl int = 80
		var format string = "text"
		snapFlags := flag.NewFlagSet("snapshot", flag.ExitOnError)
		snapFlags.IntVar(&tabID, "tab", 0, "Target tab ID")
		snapFlags.IntVar(&maxEl, "max", 80, "Max interactive elements to inspect")
		snapFlags.StringVar(&format, "format", "text", "Output format: text or json")
		if err := snapFlags.Parse(os.Args[2:]); err != nil {
			os.Exit(1)
		}
		var t interface{}
		if tabID > 0 {
			t = tabID
		}
		if err := ExecSnapshot(maxEl, format, t); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "fill":
		fields, submitSelector, pressEnter, targetTab, err := parseFillArgs(os.Args[2:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			fmt.Println("Sử dụng: agent-pilot fill <fields.json> [--tab <id>] [--submit <selector>] [--enter]")
			os.Exit(1)
		}
		if err := ExecFillForm(fields, submitSelector, pressEnter, targetTab); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "evaluate", "eval":
		script, targetTab, err := parseEvalArgs(os.Args[2:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			fmt.Println("Sử dụng: agent-pilot evaluate <script> [-f <file>] [--tab <id>] (Alias: eval)")
			os.Exit(1)
		}
		if err := ExecEvaluate(script, targetTab); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "tabs":
		if err := ExecListTabs(); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "batch":
		if len(os.Args) < 3 || os.Args[2] == "--help" || os.Args[2] == "-h" || os.Args[2] == "help" {
			fmt.Println("Sử dụng: agent-pilot batch <path-to-script.json>")
			if len(os.Args) >= 3 && (os.Args[2] == "--help" || os.Args[2] == "-h" || os.Args[2] == "help") {
				os.Exit(0)
			}
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
		resJSON, mErr := json.MarshalIndent(res, "", "  ")
		if mErr != nil {
			fmt.Printf("✅ Kết quả thực thi Batch: %v\n", res)
		} else {
			fmt.Printf("✅ Kết quả thực thi Batch:\n%s\n", string(resJSON))
		}

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
			jsonB, mErr := json.MarshalIndent(res, "", "  ")
			if mErr != nil {
				fmt.Printf("%v\n", res)
			} else {
				fmt.Println(string(jsonB))
			}
		} else if sub == "wait" {
			timeout := 120
			if len(os.Args) > 3 {
				if t, parseErr := strconv.Atoi(os.Args[3]); parseErr == nil && t > 0 {
					timeout = t
				}
			}
			fmt.Printf("⏳ Đang chờ người dùng gửi feedback từ trình duyệt (Timeout: %ds)...\n", timeout)
			res := WaitForFeedback(timeout, nil)
			jsonB, mErr := json.MarshalIndent(res, "", "  ")
			if mErr != nil {
				fmt.Printf("%v\n", res)
			} else {
				fmt.Println(string(jsonB))
			}
		}

	case "export-mcp":
		outDir := "mcp/agent-pilot"
		if len(os.Args) > 2 {
			outDir = os.Args[2]
		}
		if err := ExportMCPSchemas(outDir); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Lỗi xuất MCP schemas: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("✅ Đã xuất %d tool schemas MCP thành công vào: %s\n", len(mcpTools), outDir)

	case "--help", "-h", "help":
		printUsage()

	default:
		fmt.Printf("Lệnh không hợp lệ: %s\n\n", cmd)
		printUsage()
		os.Exit(1)
	}
}
