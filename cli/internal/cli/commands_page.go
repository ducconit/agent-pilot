// commands_page.go holds the Cobra constructors for the navigation/interaction/
// page commands registered on the root (root.go): open, navigate, click, type,
// hover, drag, key, wait, upload, dialog, evaluate, snapshot, fill, busy,
// session, screenshot, inspect and tabs.
//
// Each command disables Cobra/pflag parsing and reuses the existing parsers and
// Exec* helpers unchanged, so the stdout/stderr text and exit codes are
// identical to the old dispatch switch. The pflag declarations exist purely so
// `agent-pilot <cmd> --help` lists the supported flags.

package cli

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

func newOpenCommand() *cobra.Command {
	cmd := newLeafCommand("open", nil, func(args []string) error {
		openFlags := flag.NewFlagSet("open", flag.ExitOnError)
		active := openFlags.Bool("active", false, "Make tab active")
		if err := openFlags.Parse(args); err != nil {
			return errUsage
		}
		posArgs := openFlags.Args()
		if len(posArgs) < 1 {
			fmt.Println("Sử dụng: agent-pilot open <url> [--active]")
			return errUsage
		}
		if err := ExecOpen(posArgs[0], *active); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	cmd.Flags().Bool("active", false, "Make tab active")
	return cmd
}

func newNavigateCommand() *cobra.Command {
	cmd := newLeafCommand("navigate", nil, func(args []string) error {
		navFlags := flag.NewFlagSet("navigate", flag.ExitOnError)
		tabID := navFlags.Int("tab", 0, "Target tab ID")
		if err := navFlags.Parse(args); err != nil {
			return errUsage
		}
		posArgs := navFlags.Args()
		if len(posArgs) < 1 {
			fmt.Println("Sử dụng: agent-pilot navigate <url> [--tab <id>]")
			return errUsage
		}
		var t interface{}
		if *tabID > 0 {
			t = *tabID
		}
		if err := ExecNavigate(posArgs[0], t); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	cmd.Flags().IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newClickCommand() *cobra.Command {
	cmd := newLeafCommand("click", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "tab", Aliases: []string{"t"}},
			{Name: "x"},
			{Name: "y"},
			{Name: "via"},
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
		x, err := cmdArgs.Float("x", 0)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		y, err := cmdArgs.Float("y", 0)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		selector := ""
		if len(cmdArgs.Positional) > 0 {
			selector = cmdArgs.Positional[0]
		}
		if err := ExecClick(selector, x, y, cmdArgs.String("via", "synthetic"), tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.IntP("tab", "t", 0, "Target tab ID")
	f.Float64("x", 0, "X coordinate (with --y)")
	f.Float64("y", 0, "Y coordinate (with --x)")
	f.String("via", "synthetic", "Input backend: synthetic|cdp|auto")
	return cmd
}

func newTypeCommand() *cobra.Command {
	cmd := newLeafCommand("type", nil, func(args []string) error {
		typeFlags := flag.NewFlagSet("type", flag.ExitOnError)
		tabID := typeFlags.Int("tab", 0, "Target tab ID")
		clear := typeFlags.Bool("clear", false, "Clear field before typing")
		enter := typeFlags.Bool("enter", false, "Press enter after typing")
		if err := typeFlags.Parse(args); err != nil {
			return errUsage
		}

		posArgs := typeFlags.Args()
		if len(posArgs) < 2 {
			fmt.Println("Sử dụng: agent-pilot type <selector> <text> [--clear] [--enter] [--tab <id>]")
			return errUsage
		}
		var t interface{}
		if *tabID > 0 {
			t = *tabID
		}
		if err := ExecType(posArgs[0], posArgs[1], *clear, *enter, t); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	f := cmd.Flags()
	f.IntP("tab", "t", 0, "Target tab ID")
	f.Bool("clear", false, "Clear field before typing")
	f.Bool("enter", false, "Press enter after typing")
	return cmd
}

func newHoverCommand() *cobra.Command {
	cmd := newLeafCommand("hover", nil, func(args []string) error {
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
		if len(cmdArgs.Positional) < 1 {
			fmt.Println("Sử dụng: agent-pilot hover <selector> [--tab <id>]")
			return errUsage
		}
		if err := ExecHover(cmdArgs.Positional[0], tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	cmd.Flags().IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newDragCommand() *cobra.Command {
	cmd := newLeafCommand("drag", nil, func(args []string) error {
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
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		steps, err := cmdArgs.Int("steps", 8)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		hold, err := cmdArgs.Int("hold", 0)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		fromX, err := cmdArgs.Float("from-x", -1)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		fromY, err := cmdArgs.Float("from-y", -1)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		toX, err := cmdArgs.Float("to-x", -1)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		toY, err := cmdArgs.Float("to-y", -1)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		fromSelector, toSelector := "", ""
		if len(cmdArgs.Positional) >= 2 {
			fromSelector, toSelector = cmdArgs.Positional[0], cmdArgs.Positional[1]
		}
		params, err := BuildDragParams(fromSelector, toSelector, fromX, fromY, toX, toY, steps, hold, cmdArgs.String("via", "synthetic"))
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			fmt.Println("Sử dụng: agent-pilot drag <fromSelector> <toSelector> | --from-x <x> --from-y <y> --to-x <x> --to-y <y> [--steps <n>] [--hold <ms>] [--via synthetic|cdp|auto] [--tab <id>]")
			return errUsage
		}
		if err := ExecDrag(params, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.IntP("tab", "t", 0, "Target tab ID")
	f.IntP("steps", "s", 8, "Number of interpolation steps")
	f.Int("hold", 0, "Hold duration in ms before release")
	f.String("via", "synthetic", "Input backend: synthetic|cdp|auto")
	f.Float64("from-x", -1, "Start X coordinate")
	f.Float64("from-y", -1, "Start Y coordinate")
	f.Float64("to-x", -1, "End X coordinate")
	f.Float64("to-y", -1, "End Y coordinate")
	return cmd
}

func newKeyCommand() *cobra.Command {
	cmd := newLeafCommand("key", []string{"press-key"}, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "selector", Aliases: []string{"sel", "s"}},
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
		selector := cmdArgs.String("selector", "")
		if len(cmdArgs.Positional) < 1 {
			fmt.Println("Sử dụng: agent-pilot key <keyName> [--selector <sel>] [--tab <id>]")
			return errUsage
		}
		if err := ExecPressKey(cmdArgs.Positional[0], selector, tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.StringP("selector", "s", "", "Target element selector")
	f.String("sel", "", "Alias for --selector")
	f.IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newWaitCommand() *cobra.Command {
	cmd := newLeafCommand("wait", []string{"wait-for"}, func(args []string) error {
		sel, text, state, timeout, targetTab, err := parseWaitArgs(args)
		if err != nil {
			fmt.Printf("❌ %v\n", err)
			fmt.Println("Sử dụng: agent-pilot wait <selector|text> [--text <text>] [--state <visible|attached|hidden>] [--timeout <ms>] [--tab <id>]")
			return errUsage
		}
		if err := ExecWaitFor(sel, text, state, timeout, targetTab); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.IntP("tab", "t", 0, "Target tab ID")
	f.Int("timeout", 0, "Timeout in milliseconds")
	f.String("state", "visible", "Wait state: visible|attached|hidden")
	f.String("text", "", "Text to wait for")
	f.StringP("selector", "s", "", "Element selector to wait for")
	return cmd
}

func newUploadCommand() *cobra.Command {
	cmd := newLeafCommand("upload", nil, func(args []string) error {
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
			fmt.Println("Sử dụng: agent-pilot upload <selector> <file1> [file2...] [--tab <id>]")
			return errUsage
		}
		if err := ExecUploadFile(cmdArgs.Positional[0], cmdArgs.Positional[1:], tabID); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	cmd.Flags().IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newDialogCommand() *cobra.Command {
	cmd := newLeafCommand("dialog", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "prompt", Aliases: []string{"p"}},
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
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.StringP("prompt", "p", "", "Prompt text for prompt dialogs")
	f.IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newEvaluateCommand() *cobra.Command {
	cmd := newLeafCommand("evaluate", []string{"eval"}, func(args []string) error {
		script, targetTab, err := parseEvalArgs(args)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			fmt.Println("Sử dụng: agent-pilot evaluate <script> [-f <file>] [--tab <id>] (Alias: eval)")
			return errUsage
		}
		if err := ExecEvaluate(script, targetTab); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.StringP("file", "f", "", "Path to a JS script file")
	f.IntP("tab", "t", 0, "Target tab ID")
	return cmd
}

func newSnapshotCommand() *cobra.Command {
	cmd := newLeafCommand("snapshot", nil, func(args []string) error {
		var tabID int
		var maxEl int = 80
		var format string = "text"
		snapFlags := flag.NewFlagSet("snapshot", flag.ExitOnError)
		snapFlags.IntVar(&tabID, "tab", 0, "Target tab ID")
		snapFlags.IntVar(&maxEl, "max", 80, "Max interactive elements to inspect")
		snapFlags.StringVar(&format, "format", "text", "Output format: text or json")
		if err := snapFlags.Parse(args); err != nil {
			return errUsage
		}
		var t interface{}
		if tabID > 0 {
			t = tabID
		}
		if err := ExecSnapshot(maxEl, format, t); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	f := cmd.Flags()
	f.Int("tab", 0, "Target tab ID")
	f.Int("max", 80, "Max interactive elements to inspect")
	f.String("format", "text", "Output format: text or json")
	return cmd
}

func newFillCommand() *cobra.Command {
	cmd := newLeafCommand("fill", nil, func(args []string) error {
		fields, submitSelector, pressEnter, targetTab, err := parseFillArgs(args)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			fmt.Println("Sử dụng: agent-pilot fill <fields.json> [--tab <id>] [--submit <selector>] [--enter]")
			return errUsage
		}
		if err := ExecFillForm(fields, submitSelector, pressEnter, targetTab); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.IntP("tab", "t", 0, "Target tab ID")
	f.String("submit", "", "Submit button selector")
	f.Bool("enter", false, "Press Enter after filling")
	return cmd
}

func newBusyCommand() *cobra.Command {
	cmd := newLeafCommand("busy", nil, func(args []string) error {
		isBusy, actionDesc, targetTab, err := ParseBusyArgs(args)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error parsing arguments: %v\n", err)
			return errUsage
		}
		if err := ExecBusy(isBusy, actionDesc, targetTab); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.Int("tab", 0, "Target tab ID")
	f.String("action", "", "Action description")
	return cmd
}

func newSessionCommand() *cobra.Command {
	cmd := newLeafCommand("session", nil, func(args []string) error {
		subcmd, name, targetTab, err := ParseSessionArgs(args)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error parsing arguments: %v\n", err)
			return errUsage
		}
		if err := ExecSession(subcmd, name, targetTab); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.Int("tab", 0, "Target tab ID")
	f.String("name", "", "Session name or task description")
	f.String("action", "", "Alias for session name")
	return cmd
}

func newScreenshotCommand() *cobra.Command {
	cmd := newLeafCommand("screenshot", nil, func(args []string) error {
		shotFlags := flag.NewFlagSet("screenshot", flag.ExitOnError)
		tabID := shotFlags.Int("tab", 0, "Target tab ID")
		mode := shotFlags.String("mode", "visible", "Capture mode: visible, region, element, full")
		out := shotFlags.String("o", "", "Output PNG path")
		selector := shotFlags.String("selector", "", "CSS selector for element mode")
		if err := shotFlags.Parse(args); err != nil {
			return errUsage
		}

		var t interface{}
		if *tabID > 0 {
			t = *tabID
		}
		if err := ExecScreenshot(*mode, *selector, *out, t); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	f := cmd.Flags()
	f.Int("tab", 0, "Target tab ID")
	f.String("mode", "visible", "Capture mode: visible, region, element, full")
	f.String("o", "", "Output PNG path")
	f.String("selector", "", "CSS selector for element mode")
	return cmd
}

func newInspectCommand() *cobra.Command {
	cmd := newLeafCommand("inspect", nil, func(args []string) error {
		inspFlags := flag.NewFlagSet("inspect", flag.ExitOnError)
		tabID := inspFlags.Int("tab", 0, "Target tab ID")
		if err := inspFlags.Parse(args); err != nil {
			return errUsage
		}
		posArgs := inspFlags.Args()
		if len(posArgs) < 1 {
			fmt.Println("Sử dụng: agent-pilot inspect <selector> [--tab <id>]")
			return errUsage
		}
		var t interface{}
		if *tabID > 0 {
			t = *tabID
		}
		if err := ExecInspect(posArgs[0], t); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	cmd.Flags().Int("tab", 0, "Target tab ID")
	return cmd
}

func newTabsCommand() *cobra.Command {
	return newLeafCommand("tabs", nil, func(args []string) error {
		if err := ExecListTabs(); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
}
