// main.go is the CLI entry point: it resolves the requested subcommand and
// dispatches to the relevant Exec*/handler. Argument parsing helpers live in
// cli_args.go and the help text in cli_usage.go.

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
)

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
			res, err := GetPendingFeedback(defaultFeedbackListLimit, "", false)
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
			timeout := defaultFeedbackTimeoutSec
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
