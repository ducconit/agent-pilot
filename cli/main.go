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
	fmt.Println(`Agent Pilot CLI (v1.0.8-beta) - Universal AI Agent Browser Controller
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
  trace <start|stop>            Ghi và xuất trace phân tích DevTools Performance
  metrics                       Lấy các thông số hiệu năng runtime thời gian thực (DOM, Heap...)
  heap                          Chụp Memory Heap Snapshot qua CDP
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
  --via <synthetic|cdp|auto>    Backend input cho click/drag (mặc định: synthetic; cdp = trusted, dùng cho iframe/canvas)
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
  agent-pilot screenshot -o homepage.png --mode full
  agent-pilot click -x 733 -y 668 --via cdp --tab 1734672950
  agent-pilot drag --from-x 745 --from-y 490 --to-x 745 --to-y 832 --via cdp --tab 1734672950
  agent-pilot cdp status --tab 1734672950
  agent-pilot skill install
  agent-pilot skill install --agy --force
  agent-pilot skill install --path ~/my-skills
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
				id, err := strconv.Atoi(args[i+1])
				if err != nil || id <= 0 {
					return "", nil, fmt.Errorf("giá trị tab ID không hợp lệ: %s", args[i+1])
				}
				tabID = id
				i++
			}
		} else if strings.HasPrefix(arg, "-tab=") || strings.HasPrefix(arg, "--tab=") {
			parts := strings.SplitN(arg, "=", 2)
			id, err := strconv.Atoi(parts[1])
			if err != nil || id <= 0 {
				return "", nil, fmt.Errorf("giá trị tab ID không hợp lệ: %s", parts[1])
			}
			tabID = id
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
				id, err := strconv.Atoi(args[i+1])
				if err != nil || id <= 0 {
					return nil, "", false, nil, fmt.Errorf("giá trị tab ID không hợp lệ: %s", args[i+1])
				}
				tabID = id
				i++
			}
		} else if strings.HasPrefix(arg, "-tab=") || strings.HasPrefix(arg, "--tab=") {
			parts := strings.SplitN(arg, "=", 2)
			id, err := strconv.Atoi(parts[1])
			if err != nil || id <= 0 {
				return nil, "", false, nil, fmt.Errorf("giá trị tab ID không hợp lệ: %s", parts[1])
			}
			tabID = id
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

type FlagDef struct {
	Name    string
	Aliases []string
	IsBool  bool
}

type FlexibleCmdArgs struct {
	Flags      map[string]string
	Positional []string
}

func parseCmdArgs(args []string, allowedFlags []FlagDef) (FlexibleCmdArgs, error) {
	res := FlexibleCmdArgs{
		Flags:      make(map[string]string),
		Positional: make([]string, 0),
	}

	lookup := make(map[string]FlagDef)
	for _, f := range allowedFlags {
		lookup[f.Name] = f
		for _, a := range f.Aliases {
			lookup[a] = f
		}
	}

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			res.Positional = append(res.Positional, args[i+1:]...)
			break
		}
		if strings.HasPrefix(arg, "-") {
			if strings.Contains(arg, "=") {
				parts := strings.SplitN(arg, "=", 2)
				flagName := strings.TrimLeft(parts[0], "-")
				def, ok := lookup[flagName]
				if !ok {
					return res, fmt.Errorf("cờ không hợp lệ: %s", parts[0])
				}
				res.Flags[def.Name] = parts[1]
			} else {
				flagName := strings.TrimLeft(arg, "-")
				def, ok := lookup[flagName]
				if !ok {
					return res, fmt.Errorf("cờ không hợp lệ: %s", arg)
				}
				if def.IsBool {
					res.Flags[def.Name] = "true"
				} else {
					if i+1 >= len(args) {
						return res, fmt.Errorf("cờ %s yêu cầu một giá trị", arg)
					}
					res.Flags[def.Name] = args[i+1]
					i++
				}
			}
		} else {
			res.Positional = append(res.Positional, arg)
		}
	}
	return res, nil
}

func (a FlexibleCmdArgs) TabID() (interface{}, error) {
	val, ok := a.Flags["tab"]
	if !ok {
		return nil, nil
	}
	id, err := strconv.Atoi(val)
	if err != nil || id <= 0 {
		return nil, fmt.Errorf("giá trị tab ID không hợp lệ: %s", val)
	}
	return id, nil
}

func (a FlexibleCmdArgs) Int(flagName string, defaultVal int) (int, error) {
	val, ok := a.Flags[flagName]
	if !ok {
		return defaultVal, nil
	}
	v, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal, fmt.Errorf("giá trị %s không hợp lệ: %s", flagName, val)
	}
	return v, nil
}

func (a FlexibleCmdArgs) Float(flagName string, defaultVal float64) (float64, error) {
	val, ok := a.Flags[flagName]
	if !ok {
		return defaultVal, nil
	}
	v, err := strconv.ParseFloat(val, 64)
	if err != nil {
		return defaultVal, fmt.Errorf("giá trị %s không hợp lệ: %s", flagName, val)
	}
	return v, nil
}

func (a FlexibleCmdArgs) String(flagName string, defaultVal string) string {
	if val, ok := a.Flags[flagName]; ok {
		return val
	}
	return defaultVal
}

func (a FlexibleCmdArgs) Bool(flagName string) bool {
	if val, ok := a.Flags[flagName]; ok {
		lower := strings.ToLower(val)
		return lower == "true" || lower == "1" || lower == ""
	}
	return false
}

func parseWaitArgs(args []string) (string, string, string, int, interface{}, error) {
	allowedFlags := []FlagDef{
		{Name: "tab", Aliases: []string{"t"}},
		{Name: "timeout"},
		{Name: "state"},
		{Name: "text"},
		{Name: "selector", Aliases: []string{"sel", "s"}},
	}
	cmdArgs, err := parseCmdArgs(args, allowedFlags)
	if err != nil {
		return "", "", "", 0, nil, err
	}
	tab, err := cmdArgs.TabID()
	if err != nil {
		return "", "", "", 0, nil, err
	}
	timeout, err := cmdArgs.Int("timeout", 10000)
	if err != nil || timeout <= 0 {
		val := cmdArgs.Flags["timeout"]
		return "", "", "", 0, nil, fmt.Errorf("giá trị timeout không hợp lệ: %s", val)
	}
	state := cmdArgs.String("state", "visible")
	text := cmdArgs.String("text", "")
	selector := cmdArgs.String("selector", "")

	if len(cmdArgs.Positional) > 0 {
		pos := cmdArgs.Positional[0]
		if selector == "" && text == "" {
			if strings.HasPrefix(pos, "@") || strings.HasPrefix(pos, "#") || strings.HasPrefix(pos, ".") || strings.HasPrefix(pos, "[") {
				selector = pos
			} else if strings.ContainsAny(pos, " \t\n\r") && !strings.ContainsAny(pos, ">+~:[") {
				text = pos
			} else {
				selector = pos
			}
		} else if selector == "" && text != "" {
			selector = pos
		} else if selector != "" && text == "" {
			text = pos
		}
	}

	if selector == "" && text == "" {
		return "", "", "", 0, nil, fmt.Errorf("vui lòng cung cấp selector hoặc text cần chờ")
	}

	return selector, text, state, timeout, tab, nil
}

// DefaultBridgePort resolves the bridge port, honoring the AGENT_PILOT_PORT
// environment variable and falling back to the built-in default.
func DefaultBridgePort() int {
	if env := strings.TrimSpace(os.Getenv("AGENT_PILOT_PORT")); env != "" {
		if p, err := strconv.Atoi(env); err == nil && p > 0 && p < 65536 {
			return p
		}
	}
	return DefaultPort
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
		port := serverFlags.Int("port", DefaultBridgePort(), "Port to listen on")
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
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "tab", Aliases: []string{"t"}},
			{Name: "x"},
			{Name: "y"},
			{Name: "via"},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		x, err := cmdArgs.Float("x", 0)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		y, err := cmdArgs.Float("y", 0)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		selector := ""
		if len(cmdArgs.Positional) > 0 {
			selector = cmdArgs.Positional[0]
		}
		if err := ExecClick(selector, x, y, cmdArgs.String("via", "synthetic"), tabID); err != nil {
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

		res, err := DispatchCommand("batch.run", payload, DefaultBridgePort())
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

	case "hover":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		if len(cmdArgs.Positional) < 1 {
			fmt.Println("Sử dụng: agent-pilot hover <selector> [--tab <id>]")
			os.Exit(1)
		}
		if err := ExecHover(cmdArgs.Positional[0], tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "drag":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "tab", Aliases: []string{"t"}},
			{Name: "steps", Aliases: []string{"s"}},
			{Name: "hold"},
			{Name: "via"},
			{Name: "from-x"},
			{Name: "from-y"},
			{Name: "to-x"},
			{Name: "to-y"},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		steps, err := cmdArgs.Int("steps", 8)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		hold, err := cmdArgs.Int("hold", 0)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		fromX, err := cmdArgs.Float("from-x", -1)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		fromY, err := cmdArgs.Float("from-y", -1)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		toX, err := cmdArgs.Float("to-x", -1)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		toY, err := cmdArgs.Float("to-y", -1)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		fromSelector, toSelector := "", ""
		if len(cmdArgs.Positional) >= 2 {
			fromSelector, toSelector = cmdArgs.Positional[0], cmdArgs.Positional[1]
		}
		params, err := BuildDragParams(fromSelector, toSelector, fromX, fromY, toX, toY, steps, hold, cmdArgs.String("via", "synthetic"))
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			fmt.Println("Sử dụng: agent-pilot drag <fromSelector> <toSelector> | --from-x <x> --from-y <y> --to-x <x> --to-y <y> [--steps <n>] [--hold <ms>] [--via synthetic|cdp|auto] [--tab <id>]")
			os.Exit(1)
		}
		if err := ExecDrag(params, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "cdp":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		if len(cmdArgs.Positional) < 1 || strings.ToLower(cmdArgs.Positional[0]) != "status" {
			fmt.Println("Sử dụng: agent-pilot cdp status [--tab <id>]")
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		if err := ExecCdpStatus(tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "key", "press-key":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "selector", Aliases: []string{"sel", "s"}},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		selector := cmdArgs.String("selector", "")
		if len(cmdArgs.Positional) < 1 {
			fmt.Println("Sử dụng: agent-pilot key <keyName> [--selector <sel>] [--tab <id>]")
			os.Exit(1)
		}
		if err := ExecPressKey(cmdArgs.Positional[0], selector, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "wait", "wait-for":
		sel, text, state, timeout, targetTab, err := parseWaitArgs(os.Args[2:])
		if err != nil {
			fmt.Printf("❌ %v\n", err)
			fmt.Println("Sử dụng: agent-pilot wait <selector|text> [--text <text>] [--state <visible|attached|hidden>] [--timeout <ms>] [--tab <id>]")
			os.Exit(1)
		}
		if err := ExecWaitFor(sel, text, state, timeout, targetTab); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "upload":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		if len(cmdArgs.Positional) < 2 {
			fmt.Println("Sử dụng: agent-pilot upload <selector> <file1> [file2...] [--tab <id>]")
			os.Exit(1)
		}
		if err := ExecUploadFile(cmdArgs.Positional[0], cmdArgs.Positional[1:], tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "dialog":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "prompt", Aliases: []string{"p"}},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		promptText := cmdArgs.String("prompt", "")
		accept := true
		if len(cmdArgs.Positional) > 0 {
			first := strings.ToLower(cmdArgs.Positional[0])
			if first == "dismiss" || first == "cancel" || first == "false" {
				accept = false
			}
			if len(cmdArgs.Positional) > 1 && promptText == "" {
				promptText = cmdArgs.Positional[1]
			}
		}
		if err := ExecHandleDialog(accept, promptText, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "emulate":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "network"},
			{Name: "cpu"},
			{Name: "theme"},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		network := cmdArgs.String("network", "")
		cpu := cmdArgs.String("cpu", "")
		theme := cmdArgs.String("theme", "")
		if err := ExecEmulate(network, cpu, theme, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "resize":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		if len(cmdArgs.Positional) < 2 {
			fmt.Println("Sử dụng: agent-pilot resize <width> <height> [--tab <id>]")
			os.Exit(1)
		}
		w, err := strconv.Atoi(cmdArgs.Positional[0])
		if err != nil || w <= 0 {
			fmt.Fprintf(os.Stderr, "❌ Error: Chiều rộng (width) phải là số nguyên dương: %v\n", cmdArgs.Positional[0])
			os.Exit(1)
		}
		h, err := strconv.Atoi(cmdArgs.Positional[1])
		if err != nil || h <= 0 {
			fmt.Fprintf(os.Stderr, "❌ Error: Chiều cao (height) phải là số nguyên dương: %v\n", cmdArgs.Positional[1])
			os.Exit(1)
		}
		if err := ExecResizePage(w, h, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "network":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "filter"},
			{Name: "method"},
			{Name: "type"},
			{Name: "limit"},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		filterUrl := cmdArgs.String("filter", "")
		method := cmdArgs.String("method", "")
		resType := cmdArgs.String("type", "")
		limit, err := cmdArgs.Int("limit", 50)
		if err != nil || limit <= 0 {
			fmt.Fprintf(os.Stderr, "❌ Error: Giới hạn (limit) phải là số nguyên dương: %v\n", cmdArgs.Flags["limit"])
			os.Exit(1)
		}
		if len(cmdArgs.Positional) > 1 && (cmdArgs.Positional[0] == "get" || cmdArgs.Positional[0] == "body") {
			if err := ExecGetNetworkResponseBody(cmdArgs.Positional[1], tabID); err != nil {
				fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
				os.Exit(1)
			}
		} else {
			if err := ExecListNetworkRequests(filterUrl, method, resType, limit, tabID); err != nil {
				fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
				os.Exit(1)
			}
		}

	case "trace":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "categories"},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		cats := cmdArgs.String("categories", "")
		action := "start"
		if len(cmdArgs.Positional) > 0 {
			action = cmdArgs.Positional[0]
		}
		if err := ExecPerformanceTrace(action, cats, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "metrics":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		if err := ExecPerformanceMetrics(tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "heap", "heapsnapshot":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "gc", IsBool: true},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		gc := cmdArgs.Bool("gc")
		if err := ExecTakeHeapSnapshot(gc, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "skill", "skills":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "path", Aliases: []string{"p"}},
			{Name: "force", Aliases: []string{"f"}, IsBool: true},
			{Name: "agy", IsBool: true},
			{Name: "antigravity", IsBool: true},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		sub := "install"
		if len(cmdArgs.Positional) > 0 {
			sub = strings.ToLower(cmdArgs.Positional[0])
		}
		if sub != "install" && sub != "add" {
			fmt.Println("Sử dụng: agent-pilot skill install [--path <dir>] [--agy|--antigravity] [--force]")
			os.Exit(1)
		}
		antigravity := cmdArgs.Bool("agy") || cmdArgs.Bool("antigravity")
		if err := ExecSkillInstall(cmdArgs.String("path", ""), antigravity, cmdArgs.Bool("force")); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}

	case "extensions", "ext":
		cmdArgs, err := parseCmdArgs(os.Args[2:], []FlagDef{
			{Name: "enabled", Aliases: []string{"e"}},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
		}
		action := "list"
		extID := ""
		var enabled *bool
		if len(cmdArgs.Positional) > 0 {
			sub := strings.ToLower(cmdArgs.Positional[0])
			switch sub {
			case "list":
				action = "list"
				if len(cmdArgs.Positional) > 1 {
					extID = cmdArgs.Positional[1]
				}
			case "enable":
				action = "setEnabled"
				val := true
				enabled = &val
				if len(cmdArgs.Positional) > 1 {
					extID = cmdArgs.Positional[1]
				}
			case "disable":
				action = "setEnabled"
				val := false
				enabled = &val
				if len(cmdArgs.Positional) > 1 {
					extID = cmdArgs.Positional[1]
				}
			case "setenabled":
				action = "setEnabled"
				if len(cmdArgs.Positional) > 1 {
					extID = cmdArgs.Positional[1]
				}
				if cmdArgs.Flags["enabled"] != "" {
					b := cmdArgs.Bool("enabled")
					enabled = &b
				} else if len(cmdArgs.Positional) > 2 {
					b := strings.ToLower(cmdArgs.Positional[2]) == "true" || cmdArgs.Positional[2] == "1"
					enabled = &b
				}
			case "toggle":
				action = "toggle"
				if len(cmdArgs.Positional) > 1 {
					extID = cmdArgs.Positional[1]
				}
			case "uninstall":
				action = "uninstall"
				if len(cmdArgs.Positional) > 1 {
					extID = cmdArgs.Positional[1]
				}
			default:
				extID = cmdArgs.Positional[0]
			}
		}
		if (action == "setEnabled" || action == "toggle" || action == "uninstall") && extID == "" {
			fmt.Printf("Sử dụng: agent-pilot extensions %s <extensionId>\n", action)
			os.Exit(1)
		}
		if err := ExecManageExtensions(action, extID, enabled); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			os.Exit(1)
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
