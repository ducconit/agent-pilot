// root.go wires the CLI to Cobra. It builds the command tree, owns the exit
// policy and normalizes the legacy single-dash long flags before dispatch.
//
// The historical per-command parsers (args.go, params.go) and handlers
// (exec_page.go, exec_cdp.go) are reused verbatim; each Cobra leaf command has
// flag parsing disabled at the Cobra/pflag layer and hands the raw arguments to
// the matching parser, so stdout/stderr text and exit codes stay byte-identical
// to the pre-Cobra dispatch switch. Cobra adds routing, aliases, help and
// completion instead of replacing the parsing semantics.

package cli

import (
	"errors"
	"fmt"
	"github.com/ducconit/agent-pilot-extension/cli/bridge"
	"github.com/ducconit/agent-pilot-extension/cli/config"
	"os"
	"strconv"
	"strings"

	"github.com/ducconit/agent-pilot-extension/cli/mcp"
	"github.com/spf13/cobra"
)

// errUsage is the sentinel returned after a command has already printed the
// user-facing usage/error text. Run treats it as a silent os.Exit(1) so Cobra
// never appends its own "Error: ..." line or usage text.
var errUsage = errors.New("usage")

// cobraDefaultHelp is Cobra's stock help renderer, captured from a parentless
// command. The root command overrides help with the legacy usage text, but
// subcommands fall back to this default.
var cobraDefaultHelp = (&cobra.Command{}).HelpFunc()

// Run executes the CLI with the given arguments (os.Args[1:]).
func Run(args []string) {
	defer bridge.CloseDevtoolsHost()
	_ = config.SetBridgePortOverride(0)
	config.SetInstanceIDOverride("")
	root := newRootCommand()
	root.SetArgs(normalizeLegacyFlags(args))
	if err := root.Execute(); err != nil {
		if errors.Is(err, errUsage) {
			os.Exit(1)
		}
		// Commands return messages that already carry the legacy prefix
		// (e.g. "❌ Error: …", "❌ Server error: …").
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

// runRoot reproduces the historic no-subcommand behaviour: with a piped stdin it
// enters the MCP stdio server; interactively it prints the usage text. A stray
// top-level token (unknown command or flag such as --version) is reported and
// exits non-zero, while --help/-h prints the usage text and succeeds.
func runRoot(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		stat, err := os.Stdin.Stat()
		if err == nil && (stat.Mode()&os.ModeCharDevice) == 0 {
			mcp.RunMCPServer()
			return nil
		}
		printUsage()
		return nil
	}
	if args[0] == "--help" || args[0] == "-h" {
		printUsage()
		return nil
	}
	fmt.Printf("Lệnh không hợp lệ: %s\n\n", args[0])
	printUsage()
	return errUsage
}

// newLeafCommand builds a subcommand that owns all of its argument parsing.
// Flag parsing is disabled at the Cobra layer (the historical parsers keep
// working on the raw args) and --help/-h is intercepted to show Cobra's
// generated per-command help.
func newLeafCommand(name string, aliases []string, run func(args []string) error) *cobra.Command {
	cmd := &cobra.Command{
		Use:                name,
		Aliases:            aliases,
		DisableFlagParsing: true,
		Args:               cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
				return cmd.Help()
			}
			filteredArgs, port, instanceID, err := extractBridgeOptions(args)
			if err != nil {
				return fmt.Errorf("❌ Invalid bridge port: %v", err)
			}
			if port > 0 {
				if err := config.SetBridgePortOverride(port); err != nil {
					return fmt.Errorf("❌ Invalid bridge port: %v", err)
				}
			}
			if instanceID != "" {
				config.SetInstanceIDOverride(instanceID)
			}
			return run(filteredArgs)
		},
	}
	// Leaf commands retain the historical runtime parser. These declarations are
	// for discoverability in generated help; RunE strips and applies the flags.
	// The server command owns --port for its listen address, and MCP keeps its
	// own explicit parser, so do not register duplicate Cobra flags there.
	if name != "mcp" && name != "server" {
		cmd.Flags().Int("bridge-port", 0, "Bridge port to target (overrides AGENT_PILOT_PORT)")
		cmd.Flags().Int("port", 0, "Alias for --bridge-port")
		cmd.Flags().String("instance-id", "", "Browser instance ID to target")
	}
	return cmd
}

// extractBridgePort removes the process-level selector before legacy command
// parsers see it, including bespoke parsers that do not use parseCmdArgs.
func extractBridgePort(args []string) ([]string, int, error) {
	filtered, port, _, err := extractBridgeOptions(args)
	return filtered, port, err
}

// extractBridgeOptions removes process-level bridge and instance selectors
// before legacy command parsers see them. The bridge-port wrapper above keeps
// existing parser tests and callers source-compatible.
func extractBridgeOptions(args []string) ([]string, int, string, error) {
	filtered := make([]string, 0, len(args))
	port := 0
	instanceID := ""
	endFlags := false
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if endFlags {
			filtered = append(filtered, arg)
			continue
		}
		if arg == "--" {
			endFlags = true
			filtered = append(filtered, arg)
			continue
		}
		if arg == "--bridge-port" || arg == "-bridge-port" || arg == "--port" || arg == "-port" {
			if i+1 >= len(args) {
				return nil, 0, "", fmt.Errorf("cờ %s yêu cầu một giá trị", arg)
			}
			i++
			arg = args[i]
		} else if strings.HasPrefix(arg, "--bridge-port=") || strings.HasPrefix(arg, "-bridge-port=") || strings.HasPrefix(arg, "--port=") || strings.HasPrefix(arg, "-port=") {
			arg = strings.SplitN(arg, "=", 2)[1]
		} else if arg == "--instance-id" || arg == "-instance-id" {
			if i+1 >= len(args) {
				return nil, 0, "", fmt.Errorf("cờ %s yêu cầu một giá trị", arg)
			}
			i++
			instanceID = strings.TrimSpace(args[i])
			if instanceID == "" {
				return nil, 0, "", fmt.Errorf("instance ID không được để trống")
			}
			continue
		} else if strings.HasPrefix(arg, "--instance-id=") || strings.HasPrefix(arg, "-instance-id=") {
			instanceID = strings.TrimSpace(strings.SplitN(arg, "=", 2)[1])
			if instanceID == "" {
				return nil, 0, "", fmt.Errorf("instance ID không được để trống")
			}
			continue
		} else {
			filtered = append(filtered, arg)
			continue
		}
		parsed, err := strconv.Atoi(strings.TrimSpace(arg))
		if err != nil || parsed < 1 || parsed > 65535 {
			return nil, 0, "", fmt.Errorf("giá trị bridge port không hợp lệ: %s", arg)
		}
		port = parsed
	}
	return filtered, port, instanceID, nil
}

// newRootCommand builds the Cobra root command and registers every subcommand.
func newRootCommand() *cobra.Command {
	root := &cobra.Command{
		Use:                "agent-pilot",
		SilenceErrors:      true,
		SilenceUsage:       true,
		DisableSuggestions: true,
		// Root-level flag parsing is disabled so the first token is handled by
		// runRoot exactly like the old dispatch switch.
		DisableFlagParsing: true,
		Args:               cobra.ArbitraryArgs,
		RunE:               runRoot,
	}
	root.CompletionOptions.DisableDefaultCmd = true
	root.SetHelpFunc(func(cmd *cobra.Command, args []string) {
		if cmd == root {
			printUsage()
			return
		}
		cobraDefaultHelp(cmd, args)
	})

	root.AddCommand(
		newDevtoolsCommand(),
		newOpenCommand(),
		newNavigateCommand(),
		newCloseCommand(),
		newClickCommand(),
		newTypeCommand(),
		newScrollCommand(),
		newHoverCommand(),
		newDragCommand(),
		newKeyCommand(),
		newWaitCommand(),
		newUploadCommand(),
		newDialogCommand(),
		newEvaluateCommand(),
		newSnapshotCommand(),
		newFillCommand(),
		newBusyCommand(),
		newSessionCommand(),
		newScreenshotCommand(),
		newInspectCommand(),
		newTabsCommand(),
		newEmulateCommand(),
		newResizeCommand(),
		newNetworkCommand(),
		newTraceCommand(),
		newMetricsCommand(),
		newHeapCommand(),
		newCdpCommand(),
		newExtensionsCommand(),
		newSkillCommand(),
		newFeedbackCommand(),
		newBatchCommand(),
		newServerCommand(),
		newServiceCommand(),
		newMCPCommand(),
		newExportMCPCommand(),
	)
	return root
}

// legacyLongFlags is the fixed allowlist of long flag names that may be written
// with a single dash (e.g. -tab). Only these names are rewritten to double-dash
// form; single-letter shorthands that are not listed here are left untouched.
var legacyLongFlags = []string{
	"active", "tab", "x", "y", "via", "clear", "enter", "selector", "sel",
	"steps", "hold", "from-x", "from-y", "to-x", "to-y", "prompt", "file",
	"max", "format", "mode", "o", "output", "clip", "text", "state", "timeout",
	"wait", "sleep", "wait-ms", "sleep-ms", "wait-for", "wait-text", "ms",
	"dx", "dy", "styles", "include-styles", "submit",
	"action", "name", "network", "cpu", "theme", "filter", "method", "type", "bridge-port", "instance-id",
	"limit", "categories", "enabled", "path", "force", "agy", "antigravity",
	"gc", "port",
}

// normalizeLegacyFlags rewrites any token that is exactly "-<name>" or starts
// with "-<name>=" into "--<name>…" for the names in legacyLongFlags. This keeps
// the historic `agent-pilot click -tab 1 -x 2` spellings working while pflag/
// Cobra (and help output) only ever see the long form.
func normalizeLegacyFlags(args []string) []string {
	out := make([]string, len(args))
	copy(out, args)
	for i, a := range out {
		if len(a) < 2 || a[0] != '-' || a[1] == '-' {
			continue
		}
		rest := a[1:]
		name := rest
		if j := strings.IndexByte(rest, '='); j >= 0 {
			name = rest[:j]
		}
		for _, lf := range legacyLongFlags {
			if name == lf {
				out[i] = "-" + a
				break
			}
		}
	}
	return out
}
