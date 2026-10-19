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
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

func registerInlineWaitPflags(cmd *cobra.Command) {
	f := cmd.Flags()
	f.Int("wait", 0, "Milliseconds to wait/sleep after action (alias: --sleep)")
	f.Int("sleep", 0, "Milliseconds to sleep after action")
	f.String("wait-for", "", "CSS selector or @ref to wait for after action")
	f.String("wait-text", "", "Text to wait for on the page after action")
}

func newOpenCommand() *cobra.Command {
	cmd := newLeafCommand("open", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, withInlineWaitFlags(
			FlagDef{Name: "active", IsBool: true},
		))
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if len(cmdArgs.Positional) < 1 {
			fmt.Println("Sử dụng: agent-pilot open <url> [--active] [--wait <ms>] [--wait-for <selector>] [--wait-text <text>]")
			return errUsage
		}
		extra := map[string]interface{}{}
		if err := cmdArgs.ApplyInlineWait(extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecOpen(cmdArgs.Positional[0], cmdArgs.Bool("active"), extra); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	cmd.Flags().Bool("active", false, "Make tab active")
	registerInlineWaitPflags(cmd)
	return cmd
}

func newNavigateCommand() *cobra.Command {
	cmd := newLeafCommand("navigate", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, withInlineWaitFlags(
			FlagDef{Name: "tab", Aliases: []string{"t"}},
		))
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
			fmt.Println("Sử dụng: agent-pilot navigate <url> [--tab <id>] [--wait <ms>] [--wait-for <selector>] [--wait-text <text>]")
			return errUsage
		}
		extra := map[string]interface{}{}
		if err := cmdArgs.ApplyInlineWait(extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecNavigate(cmdArgs.Positional[0], tabID, extra); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	cmd.Flags().IntP("tab", "t", 0, "Target tab ID")
	registerInlineWaitPflags(cmd)
	return cmd
}

func newCloseCommand() *cobra.Command {
	cmd := newLeafCommand("close", []string{"close-tab"}, func(args []string) error {
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
		if tabID == nil && len(cmdArgs.Positional) > 0 {
			parsed, convErr := strconv.Atoi(cmdArgs.Positional[0])
			if convErr != nil || parsed <= 0 {
				fmt.Fprintf(os.Stderr, "❌ Error: invalid tab ID: %s\n", cmdArgs.Positional[0])
				return errUsage
			}
			tabID = parsed
		}
		if err := ExecClose(tabID); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	cmd.Flags().IntP("tab", "t", 0, "Target tab ID in Agent Pilot group to close")
	return cmd
}

func newClickCommand() *cobra.Command {
	cmd := newLeafCommand("click", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, withInlineWaitFlags(
			FlagDef{Name: "tab", Aliases: []string{"t"}},
			FlagDef{Name: "x"},
			FlagDef{Name: "y"},
			FlagDef{Name: "via"},
		))
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
		extra := map[string]interface{}{}
		if err := cmdArgs.ApplyInlineWait(extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecClick(selector, x, y, cmdArgs.String("via", "synthetic"), tabID, extra); err != nil {
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
	registerInlineWaitPflags(cmd)
	return cmd
}

func newTypeCommand() *cobra.Command {
	cmd := newLeafCommand("type", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, withInlineWaitFlags(
			FlagDef{Name: "tab", Aliases: []string{"t"}},
			FlagDef{Name: "clear", IsBool: true},
			FlagDef{Name: "enter", IsBool: true},
		))
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
			fmt.Println("Sử dụng: agent-pilot type <selector> <text> [--clear] [--enter] [--wait <ms>] [--tab <id>]")
			return errUsage
		}
		extra := map[string]interface{}{}
		if err := cmdArgs.ApplyInlineWait(extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecType(cmdArgs.Positional[0], cmdArgs.Positional[1], cmdArgs.Bool("clear"), cmdArgs.Bool("enter"), tabID, extra); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	f := cmd.Flags()
	f.IntP("tab", "t", 0, "Target tab ID")
	f.Bool("clear", false, "Clear field before typing")
	f.Bool("enter", false, "Press enter after typing")
	registerInlineWaitPflags(cmd)
	return cmd
}

func newScrollCommand() *cobra.Command {
	cmd := newLeafCommand("scroll", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, withInlineWaitFlags(
			FlagDef{Name: "tab", Aliases: []string{"t"}},
			FlagDef{Name: "dx", Aliases: []string{"delta-x"}},
			FlagDef{Name: "dy", Aliases: []string{"delta-y"}},
		))
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		dx, err := cmdArgs.Float("dx", 0)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		dy, err := cmdArgs.Float("dy", 500)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if len(cmdArgs.Positional) > 0 {
			first := strings.ToLower(strings.TrimSpace(cmdArgs.Positional[0]))
			switch first {
			case "down":
				if _, ok := cmdArgs.Flags["dy"]; !ok {
					dy = 500
				}
			case "up":
				if _, ok := cmdArgs.Flags["dy"]; !ok {
					dy = -500
				}
			case "right":
				if _, ok := cmdArgs.Flags["dx"]; !ok {
					dx = 500
				}
				if _, ok := cmdArgs.Flags["dy"]; !ok {
					dy = 0
				}
			case "left":
				if _, ok := cmdArgs.Flags["dx"]; !ok {
					dx = -500
				}
				if _, ok := cmdArgs.Flags["dy"]; !ok {
					dy = 0
				}
			default:
				if len(cmdArgs.Positional) >= 2 {
					parsedX, errX := strconv.ParseFloat(cmdArgs.Positional[0], 64)
					parsedY, errY := strconv.ParseFloat(cmdArgs.Positional[1], 64)
					if errX != nil || errY != nil {
						fmt.Fprintf(os.Stderr, "❌ Error: giá trị tọa độ scroll không hợp lệ\n")
						return errUsage
					}
					dx, dy = parsedX, parsedY
				} else {
					parsedY, errY := strconv.ParseFloat(cmdArgs.Positional[0], 64)
					if errY != nil {
						fmt.Fprintf(os.Stderr, "❌ Error: giá trị scroll không hợp lệ: %s\n", cmdArgs.Positional[0])
						return errUsage
					}
					dy = parsedY
				}
			}
		}
		extra := map[string]interface{}{}
		if err := cmdArgs.ApplyInlineWait(extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecScroll(dx, dy, tabID, extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.IntP("tab", "t", 0, "Target tab ID")
	f.Float64("dx", 0, "Horizontal scroll offset in pixels")
	f.Float64("dy", 500, "Vertical scroll offset in pixels")
	registerInlineWaitPflags(cmd)
	return cmd
}

func newHoverCommand() *cobra.Command {
	cmd := newLeafCommand("hover", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, withInlineWaitFlags(
			FlagDef{Name: "tab", Aliases: []string{"t"}},
		))
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
			fmt.Println("Sử dụng: agent-pilot hover <selector> [--wait <ms>] [--tab <id>]")
			return errUsage
		}
		extra := map[string]interface{}{}
		if err := cmdArgs.ApplyInlineWait(extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecHover(cmdArgs.Positional[0], tabID, extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	cmd.Flags().IntP("tab", "t", 0, "Target tab ID")
	registerInlineWaitPflags(cmd)
	return cmd
}

func newDragCommand() *cobra.Command {
	cmd := newLeafCommand("drag", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, withInlineWaitFlags(
			FlagDef{Name: "tab", Aliases: []string{"t"}},
			FlagDef{Name: "steps", Aliases: []string{"s"}},
			FlagDef{Name: "hold"},
			FlagDef{Name: "via"},
			FlagDef{Name: "from-x"},
			FlagDef{Name: "from-y"},
			FlagDef{Name: "to-x"},
			FlagDef{Name: "to-y"},
		))
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
			fmt.Println("Sử dụng: agent-pilot drag <fromSelector> <toSelector> | --from-x <x> --from-y <y> --to-x <x> --to-y <y> [--steps <n>] [--hold <ms>] [--via synthetic|cdp|auto] [--wait <ms>] [--tab <id>]")
			return errUsage
		}
		if err := cmdArgs.ApplyInlineWait(params); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
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
	registerInlineWaitPflags(cmd)
	return cmd
}

func newKeyCommand() *cobra.Command {
	cmd := newLeafCommand("key", []string{"press-key"}, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, withInlineWaitFlags(
			FlagDef{Name: "selector", Aliases: []string{"sel", "s"}},
			FlagDef{Name: "tab", Aliases: []string{"t"}},
		))
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
			fmt.Println("Sử dụng: agent-pilot key <keyName> [--selector <sel>] [--wait <ms>] [--tab <id>]")
			return errUsage
		}
		extra := map[string]interface{}{}
		if err := cmdArgs.ApplyInlineWait(extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecPressKey(cmdArgs.Positional[0], selector, tabID, extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.StringP("selector", "s", "", "Target element selector")
	f.String("sel", "", "Alias for --selector")
	f.IntP("tab", "t", 0, "Target tab ID")
	registerInlineWaitPflags(cmd)
	return cmd
}

func newWaitCommand() *cobra.Command {
	cmd := newLeafCommand("wait", []string{"wait-for", "sleep"}, func(args []string) error {
		sel, text, state, timeout, targetTab, err := parseWaitArgs(args)
		if err != nil {
			fmt.Printf("❌ %v\n", err)
			fmt.Println("Sử dụng: agent-pilot wait [selector|text|ms] [--text <text>] [--state <visible|attached|hidden>] [--timeout <ms>] [--sleep <ms>] [--tab <id>]")
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
	f.Int("sleep", 0, "Sleep duration in milliseconds (alias: --ms)")
	f.Int("ms", 0, "Sleep duration in milliseconds")
	f.String("state", "visible", "Wait state: visible|attached|hidden")
	f.String("text", "", "Text to wait for")
	f.StringP("selector", "s", "", "Element selector to wait for")
	return cmd
}

func newUploadCommand() *cobra.Command {
	cmd := newLeafCommand("upload", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, withInlineWaitFlags(
			FlagDef{Name: "tab", Aliases: []string{"t"}},
		))
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
			fmt.Println("Sử dụng: agent-pilot upload <selector> <file1> [file2...] [--wait <ms>] [--tab <id>]")
			return errUsage
		}
		extra := map[string]interface{}{}
		if err := cmdArgs.ApplyInlineWait(extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecUploadFile(cmdArgs.Positional[0], cmdArgs.Positional[1:], tabID, extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	cmd.Flags().IntP("tab", "t", 0, "Target tab ID")
	registerInlineWaitPflags(cmd)
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
		cmdArgs, err := parseCmdArgs(args, withInlineWaitFlags(
			FlagDef{Name: "tab", Aliases: []string{"t"}},
			FlagDef{Name: "max"},
			FlagDef{Name: "format"},
		))
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		maxEl, err := cmdArgs.Int("max", 80)
		if err != nil || maxEl <= 0 {
			fmt.Fprintf(os.Stderr, "❌ Error: invalid --max value\n")
			return errUsage
		}
		format := cmdArgs.String("format", "text")
		extra := map[string]interface{}{}
		if err := cmdArgs.ApplyInlineWait(extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecSnapshot(maxEl, format, tabID, extra); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	f := cmd.Flags()
	f.IntP("tab", "t", 0, "Target tab ID")
	f.Int("max", 80, "Max interactive elements to inspect")
	f.String("format", "text", "Output format: text or json")
	registerInlineWaitPflags(cmd)
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
		cmdArgs, err := parseCmdArgs(args, withInlineWaitFlags(
			FlagDef{Name: "tab", Aliases: []string{"t"}},
			FlagDef{Name: "mode"},
			FlagDef{Name: "o", Aliases: []string{"output", "out", "path", "save-path"}},
			FlagDef{Name: "selector", Aliases: []string{"sel", "s"}},
			FlagDef{Name: "clip"},
		))
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		tabID, err := cmdArgs.TabID()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		mode := cmdArgs.String("mode", "visible")
		out := cmdArgs.String("o", "")
		selector := cmdArgs.String("selector", "")
		clip := cmdArgs.String("clip", "")
		if out == "" && len(cmdArgs.Positional) > 0 {
			out = cmdArgs.Positional[0]
		}
		extra := map[string]interface{}{}
		if err := cmdArgs.ApplyInlineWait(extra); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		if err := ExecScreenshotWithOptions(mode, selector, clip, out, tabID, extra); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	f := cmd.Flags()
	f.IntP("tab", "t", 0, "Target tab ID")
	f.String("mode", "visible", "Capture mode: visible, region, element, full")
	f.StringP("output", "o", "", "Output PNG path")
	f.StringP("selector", "s", "", "CSS selector or snapshot ref for element mode")
	f.String("clip", "", "Clip bounding box 'x,y,width,height' for region mode")
	registerInlineWaitPflags(cmd)
	return cmd
}

func newInspectCommand() *cobra.Command {
	cmd := newLeafCommand("inspect", nil, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "tab", Aliases: []string{"t"}},
			{Name: "styles", Aliases: []string{"include-styles"}, IsBool: true},
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
			fmt.Println("Sử dụng: agent-pilot inspect <selector> [--styles] [--tab <id>]")
			return errUsage
		}
		extra := map[string]interface{}{}
		if cmdArgs.Bool("styles") {
			extra["includeStyles"] = true
		}
		if err := ExecInspect(cmdArgs.Positional[0], tabID, extra); err != nil {
			return fmt.Errorf("❌ Error: %v", err)
		}
		return nil
	})
	f := cmd.Flags()
	f.IntP("tab", "t", 0, "Target tab ID")
	f.Bool("styles", false, "Include computed CSS styles")
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
