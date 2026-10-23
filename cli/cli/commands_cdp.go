// commands_cdp.go holds the Cobra constructors for the CDP/emulation/
// inspection commands registered on the root (root.go): emulate, resize,
// network, trace, metrics, heap, cdp status and extensions management.
//
// As with the page commands, Cobra parsing is disabled so the legacy parsers
// keep producing byte-identical output; the pflag declarations only feed the
// generated per-command help.

package cli

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

func newEmulateCommand() *cobra.Command {
	cmd := newLeafCommand("emulate", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "network"},
			{Name: "cpu"},
			{Name: "theme"},
			{Name: "tab", Aliases: []string{"t"}},
			{Name: "format"},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		network := cmdArgs.String("network", "")
		cpu := cmdArgs.String("cpu", "")
		theme := cmdArgs.String("theme", "")
		if err := ExecEmulate(network, cpu, theme, tabID, map[string]interface{}{"format": cmdArgs.String("format", "text")}); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.String("network", "", "Network preset: slow-3g|offline|…")
	f.String("cpu", "", "CPU throttling rate, e.g. 4x")
	f.String("theme", "", "Color scheme: dark|light")
	f.IntP("tab", "t", 0, "Target tab ID")
	f.String("format", "text", "Output format: text or json")
	return cmd
}

func newResizeCommand() *cobra.Command {
	cmd := newLeafCommand("resize", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if len(cmdArgs.Positional) < 2 {
			fmt.Println("Sử dụng: agent-pilot resize <width> <height> [--tab <id>]")
			return errUsage
		}
		w, err := strconv.Atoi(cmdArgs.Positional[0])
		if err != nil || w <= 0 {
			return fmt.Errorf("❌ Error: Chiều rộng (width) phải là số nguyên dương: %v", cmdArgs.Positional[0])
		}
		h, err := strconv.Atoi(cmdArgs.Positional[1])
		if err != nil || h <= 0 {
			return fmt.Errorf("❌ Error: Chiều cao (height) phải là số nguyên dương: %v", cmdArgs.Positional[1])
		}
		if err := ExecResizePage(w, h, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	cmd.Flags().IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newNetworkCommand() *cobra.Command {
	cmd := newLeafCommand("network", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "filter"},
			{Name: "method"},
			{Name: "type"},
			{Name: "limit"},
			{Name: "headers", Aliases: []string{"include-headers"}, IsBool: true},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		filterUrl := cmdArgs.String("filter", "")
		method := cmdArgs.String("method", "")
		resType := cmdArgs.String("type", "")
		limit, err := cmdArgs.Int("limit", 50)
		if err != nil || limit <= 0 {
			return fmt.Errorf("❌ Error: Giới hạn (limit) phải là số nguyên dương: %v", cmdArgs.Flags["limit"])
		}
		if len(cmdArgs.Positional) > 1 && (cmdArgs.Positional[0] == "get" || cmdArgs.Positional[0] == "body") {
			if err := ExecGetNetworkResponseBody(cmdArgs.Positional[1], tabID); err != nil {
				fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
				return errUsage
			}
		} else {
			extra := map[string]interface{}{}
			if cmdArgs.Bool("headers") {
				extra["includeHeaders"] = true
			}
			if err := ExecListNetworkRequests(filterUrl, method, resType, limit, tabID, extra); err != nil {
				fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
				return errUsage
			}
		}
		return nil
	})
	f := cmd.Flags()
	f.String("filter", "", "Filter requests by URL substring")
	f.String("method", "", "Filter by HTTP method")
	f.String("type", "", "Filter by resource type")
	f.Int("limit", 50, "Maximum number of requests")
	f.Bool("headers", false, "Include full HTTP request and response headers")
	f.IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newConsoleCommand() *cobra.Command {
	cmd := newLeafCommand("console", []string{"logs"}, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "level", Aliases: []string{"type"}},
			{Name: "limit"},
			{Name: "clear", IsBool: true},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		level := strings.ToLower(strings.TrimSpace(cmdArgs.String("level", "")))
		clearLogs := cmdArgs.Bool("clear")
		if len(cmdArgs.Positional) > 0 {
			pos := strings.ToLower(strings.TrimSpace(cmdArgs.Positional[0]))
			switch pos {
			case "clear":
				clearLogs = true
			case "error", "errors", "err":
				if level == "" {
					level = "error"
				}
			case "warn", "warning", "warnings":
				if level == "" {
					level = "warning"
				}
			}
		}
		limit, err := cmdArgs.Int("limit", 50)
		if err != nil || limit <= 0 {
			return fmt.Errorf("❌ Error: Giới hạn (limit) phải là số nguyên dương: %v", cmdArgs.Flags["limit"])
		}
		if err := ExecListConsoleLogs(level, limit, clearLogs, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.String("level", "", "Filter console entries by level: error|warn|info|log")
	f.Int("limit", 50, "Maximum number of console entries")
	f.Bool("clear", false, "Clear buffered console entries after reading")
	f.IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newTraceCommand() *cobra.Command {
	cmd := newLeafCommand("trace", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "categories"},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		cats := cmdArgs.String("categories", "")
		action := "start"
		if len(cmdArgs.Positional) > 0 {
			action = cmdArgs.Positional[0]
		}
		if err := ExecPerformanceTrace(action, cats, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.String("categories", "", "Trace categories")
	f.IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newMetricsCommand() *cobra.Command {
	cmd := newLeafCommand("metrics", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "no-vitals", IsBool: true},
			{Name: "no-resources", IsBool: true},
			{Name: "no-dom-health", IsBool: true},
			{Name: "gc", IsBool: true},
			{Name: "bring-to-front", Aliases: []string{"foreground", "activate"}, IsBool: true},
			{Name: "timeout"},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		timeoutMs, err := cmdArgs.Int("timeout", 0)
		if err != nil || timeoutMs < 0 {
			fmt.Fprintf(os.Stderr, "❌ Error: giá trị timeout không hợp lệ: %v\n", cmdArgs.Flags["timeout"])
			return errUsage
		}
		includeVitals := !cmdArgs.Bool("no-vitals")
		includeResources := !cmdArgs.Bool("no-resources")
		includeDomHealth := !cmdArgs.Bool("no-dom-health")
		extra := map[string]interface{}{}
		if cmdArgs.Bool("gc") {
			extra["collectGarbage"] = true
		}
		if cmdArgs.Bool("bring-to-front") {
			extra["bringToFront"] = true
		}
		if timeoutMs > 0 {
			extra["timeoutMs"] = timeoutMs
		}
		if err := ExecPerformanceMetricsWithOptions(includeVitals, includeResources, includeDomHealth, tabID, extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.Bool("no-vitals", false, "Skip Core Web Vitals probe")
	f.Bool("no-resources", false, "Skip resource bottleneck probe")
	f.Bool("no-dom-health", false, "Skip DOM and accessibility health scan")
	f.Bool("gc", false, "Trigger V8 garbage collection before reading metrics")
	f.Bool("bring-to-front", false, "Activate tab before reading metrics so Chromium computes FCP and LCP")
	f.Int("timeout", 0, "Command timeout in milliseconds")
	f.IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newHeapCommand() *cobra.Command {
	cmd := newLeafCommand("heap", []string{"heapsnapshot"}, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "action", Aliases: []string{"a"}},
			{Name: "baseline", IsBool: true},
			{Name: "diff", Aliases: []string{"leak", "check-leak"}, IsBool: true},
			{Name: "gc", IsBool: true},
			{Name: "no-gc", IsBool: true},
			{Name: "max-constructors"},
			{Name: "file", Aliases: []string{"path", "file-path"}},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		maxConstructors, err := cmdArgs.Int("max-constructors", 0)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		filePath := cmdArgs.String("file", "")
		action := strings.ToLower(strings.TrimSpace(cmdArgs.String("action", "")))
		if action == "" && len(cmdArgs.Positional) > 0 {
			action = strings.ToLower(strings.TrimSpace(cmdArgs.Positional[0]))
		}
		if action == "capability" {
			return ExecHeapCapability(tabID)
		}
		if action == "" {
			if cmdArgs.Bool("baseline") {
				action = "baseline"
			} else if cmdArgs.Bool("diff") {
				action = "diff"
			} else if cmdArgs.Bool("gc") {
				action = "gc"
			} else {
				action = "snapshot"
			}
		}
		collectGarbage := !cmdArgs.Bool("no-gc")
		if err := ExecTakeHeapSnapshotWithOptionsAndPath(action, collectGarbage, maxConstructors, filePath, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.StringP("action", "a", "snapshot", "Action: snapshot|baseline|diff|check_leak|gc")
	f.Bool("baseline", false, "Record GC'd memory baseline for this tab")
	f.Bool("diff", false, "Compare current GC'd heap against tab baseline for memory leaks")
	f.Bool("gc", false, "Trigger V8 garbage collection only")
	f.Bool("no-gc", false, "Skip automatic V8 garbage collection before snapshot")
	f.Int("max-constructors", 15, "Maximum number of top object constructors to return")
	f.String("file", "", "Save an isolated-context snapshot to this .heapsnapshot path")
	f.IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newCdpCommand() *cobra.Command {
	cmd := newLeafCommand("cdp", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if len(cmdArgs.Positional) < 1 || strings.ToLower(cmdArgs.Positional[0]) != "status" {
			fmt.Println("Sử dụng: agent-pilot cdp status [--tab <id>]")
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecCdpStatus(tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	cmd.Flags().IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newExtensionsCommand() *cobra.Command {
	cmd := newLeafCommand("extensions", []string{"ext"}, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "enabled", Aliases: []string{"e"}, IsBool: true},
			{Name: "path", Aliases: []string{"p"}},
			{Name: "enable-incognito", IsBool: true},
			{Name: "confirm-self", IsBool: true},
			{Name: "tab", Aliases: []string{"t"}},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		action := "list"
		extID := ""
		extensionPath := cmdArgs.String("path", "")
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
			case "install":
				action = "install"
				if extensionPath == "" && len(cmdArgs.Positional) > 1 {
					extensionPath = cmdArgs.Positional[1]
				}
			case "reload":
				action = "reload"
				if len(cmdArgs.Positional) > 1 {
					extID = cmdArgs.Positional[1]
				}
			case "trigger", "trigger-action", "trigger_action":
				action = "triggerAction"
				if len(cmdArgs.Positional) > 1 {
					extID = cmdArgs.Positional[1]
				}
			default:
				extID = cmdArgs.Positional[0]
			}
		}
		if (action == "setEnabled" || action == "toggle" || action == "uninstall" || action == "reload" || action == "triggerAction") && extID == "" {
			fmt.Printf("Sử dụng: agent-pilot extensions %s <extensionId>\n", action)
			return errUsage
		}
		if action == "install" && extensionPath == "" {
			fmt.Println("Sử dụng: agent-pilot extensions install <absolute-extension-path>")
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecManageExtensions(action, extID, extensionPath, enabled, tabID, cmdArgs.Bool("enable-incognito"), cmdArgs.Bool("confirm-self")); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.BoolP("enabled", "e", false, "Enable/disable value for setEnabled")
	f.StringP("path", "p", "", "Absolute path to an unpacked extension directory for install")
	f.Bool("enable-incognito", false, "Enable an installed unpacked extension in incognito windows")
	f.Bool("confirm-self", false, "Allow uninstalling Agent Pilot itself")
	f.IntP("tab", "t", 0, "Target tab ID")
	return cmd
}
