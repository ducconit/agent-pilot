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
	"os"
	"strings"

	"github.com/ducconit/agent-pilot/cli/internal/mcp"
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
	return &cobra.Command{
		Use:                name,
		Aliases:            aliases,
		DisableFlagParsing: true,
		Args:               cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
				return cmd.Help()
			}
			return run(args)
		},
	}
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
		newOpenCommand(),
		newNavigateCommand(),
		newClickCommand(),
		newTypeCommand(),
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
	"max", "format", "mode", "o", "text", "state", "timeout", "submit",
	"action", "name", "network", "cpu", "theme", "filter", "method", "type",
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
