// cli_commands_page.go holds the navigation/interaction/page command handlers
// invoked by dispatchCommand (cli_dispatch.go): open, navigate, click, type,
// hover, drag, key, wait, upload, dialog, evaluate, snapshot, fill, busy,
// session, screenshot, inspect and tabs. Each handler owns the flag parsing for
// exactly one subcommand and calls the matching Exec*/handler function. Bodies
// were moved verbatim from main.go's dispatch switch.

package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
)

func cmdOpen(args []string) {
	openFlags := flag.NewFlagSet("open", flag.ExitOnError)
	active := openFlags.Bool("active", false, "Make tab active")
	if err := openFlags.Parse(args); err != nil {
		os.Exit(1)
	}
	posArgs := openFlags.Args()
	if len(posArgs) < 1 {
		fmt.Println("Sử dụng: agent-pilot open <url> [--active]")
		os.Exit(1)
	}
	if err := ExecOpen(posArgs[0], *active); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdNavigate(args []string) {
	navFlags := flag.NewFlagSet("navigate", flag.ExitOnError)
	tabID := navFlags.Int("tab", 0, "Target tab ID")
	if err := navFlags.Parse(args); err != nil {
		os.Exit(1)
	}
	posArgs := navFlags.Args()
	if len(posArgs) < 1 {
		fmt.Println("Sử dụng: agent-pilot navigate <url> [--tab <id>]")
		os.Exit(1)
	}
	var t interface{}
	if *tabID > 0 {
		t = *tabID
	}
	if err := ExecNavigate(posArgs[0], t); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdClick(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}

func cmdType(args []string) {
	typeFlags := flag.NewFlagSet("type", flag.ExitOnError)
	tabID := typeFlags.Int("tab", 0, "Target tab ID")
	clear := typeFlags.Bool("clear", false, "Clear field before typing")
	enter := typeFlags.Bool("enter", false, "Press enter after typing")
	if err := typeFlags.Parse(args); err != nil {
		os.Exit(1)
	}

	posArgs := typeFlags.Args()
	if len(posArgs) < 2 {
		fmt.Println("Sử dụng: agent-pilot type <selector> <text> [--clear] [--enter] [--tab <id>]")
		os.Exit(1)
	}
	var t interface{}
	if *tabID > 0 {
		t = *tabID
	}
	if err := ExecType(posArgs[0], posArgs[1], *clear, *enter, t); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdHover(args []string) {
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
	if len(cmdArgs.Positional) < 1 {
		fmt.Println("Sử dụng: agent-pilot hover <selector> [--tab <id>]")
		os.Exit(1)
	}
	if err := ExecHover(cmdArgs.Positional[0], tabID); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdDrag(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}

func cmdKey(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}

func cmdWait(args []string) {
	sel, text, state, timeout, targetTab, err := parseWaitArgs(args)
	if err != nil {
		fmt.Printf("❌ %v\n", err)
		fmt.Println("Sử dụng: agent-pilot wait <selector|text> [--text <text>] [--state <visible|attached|hidden>] [--timeout <ms>] [--tab <id>]")
		os.Exit(1)
	}
	if err := ExecWaitFor(sel, text, state, timeout, targetTab); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdUpload(args []string) {
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
		fmt.Println("Sử dụng: agent-pilot upload <selector> <file1> [file2...] [--tab <id>]")
		os.Exit(1)
	}
	if err := ExecUploadFile(cmdArgs.Positional[0], cmdArgs.Positional[1:], tabID); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdDialog(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
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
}

func cmdEvaluate(args []string) {
	script, targetTab, err := parseEvalArgs(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		fmt.Println("Sử dụng: agent-pilot evaluate <script> [-f <file>] [--tab <id>] (Alias: eval)")
		os.Exit(1)
	}
	if err := ExecEvaluate(script, targetTab); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdSnapshot(args []string) {
	var tabID int
	var maxEl int = 80
	var format string = "text"
	snapFlags := flag.NewFlagSet("snapshot", flag.ExitOnError)
	snapFlags.IntVar(&tabID, "tab", 0, "Target tab ID")
	snapFlags.IntVar(&maxEl, "max", 80, "Max interactive elements to inspect")
	snapFlags.StringVar(&format, "format", "text", "Output format: text or json")
	if err := snapFlags.Parse(args); err != nil {
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
}

func cmdFill(args []string) {
	fields, submitSelector, pressEnter, targetTab, err := parseFillArgs(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		fmt.Println("Sử dụng: agent-pilot fill <fields.json> [--tab <id>] [--submit <selector>] [--enter]")
		os.Exit(1)
	}
	if err := ExecFillForm(fields, submitSelector, pressEnter, targetTab); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdBusy(args []string) {
	isBusy, actionDesc, targetTab, err := ParseBusyArgs(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error parsing arguments: %v\n", err)
		os.Exit(1)
	}
	if err := ExecBusy(isBusy, actionDesc, targetTab); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdSession(args []string) {
	subcmd, name, targetTab, err := ParseSessionArgs(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error parsing arguments: %v\n", err)
		os.Exit(1)
	}
	if err := ExecSession(subcmd, name, targetTab); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdScreenshot(args []string) {
	shotFlags := flag.NewFlagSet("screenshot", flag.ExitOnError)
	tabID := shotFlags.Int("tab", 0, "Target tab ID")
	mode := shotFlags.String("mode", "visible", "Capture mode: visible, region, element, full")
	out := shotFlags.String("o", "", "Output PNG path")
	selector := shotFlags.String("selector", "", "CSS selector for element mode")
	if err := shotFlags.Parse(args); err != nil {
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
}

func cmdInspect(args []string) {
	inspFlags := flag.NewFlagSet("inspect", flag.ExitOnError)
	tabID := inspFlags.Int("tab", 0, "Target tab ID")
	if err := inspFlags.Parse(args); err != nil {
		os.Exit(1)
	}
	posArgs := inspFlags.Args()
	if len(posArgs) < 1 {
		fmt.Println("Sử dụng: agent-pilot inspect <selector> [--tab <id>]")
		os.Exit(1)
	}
	var t interface{}
	if *tabID > 0 {
		t = *tabID
	}
	if err := ExecInspect(posArgs[0], t); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdTabs(args []string) {
	if err := ExecListTabs(); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}
