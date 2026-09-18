// cli_commands_cdp.go holds the CDP/emulation/inspection command handlers
// invoked by dispatchCommand (cli_dispatch.go): emulate, resize, network, trace,
// metrics, heap, cdp status and extensions management. Each handler owns the
// flag parsing for exactly one subcommand and calls the matching Exec*/handler
// function. Bodies were moved verbatim from main.go's dispatch switch.

package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

func cmdEmulate(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}

func cmdResize(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}

func cmdNetwork(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}

func cmdTrace(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}

func cmdMetrics(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}

func cmdHeap(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}

func cmdCdp(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}

func cmdExtensions(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}
