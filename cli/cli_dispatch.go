// cli_dispatch.go holds the top-level subcommand router. main() (main.go) hands
// the subcommand and the remaining arguments to dispatchCommand; each case is a
// thin delegation to a per-command function grouped by domain:
//
//   - cli_commands_page.go : navigation/interaction/page commands
//   - cli_commands_cdp.go  : emulate/resize/network/perf/heap/cdp/extensions
//   - cli_commands_meta.go : mcp/server/service/batch/feedback/skill/export-mcp
//
// Keeping the router separate from main() and from the command bodies means a
// new subcommand touches one case here plus one cohesive handler file.
//
// The --help/-h/help and default cases stay inline: they are dispatch concerns
// (print usage, or reject an unknown command and exit non-zero) rather than
// per-command handlers.

package main

import (
	"fmt"
	"os"
)

// dispatchCommand routes cmd to its handler. args is os.Args[2:] — the arguments
// following the subcommand. Handlers print their own errors and call os.Exit on
// failure, so there is no return value to propagate.
func dispatchCommand(cmd string, args []string) {
	switch cmd {
	case "mcp":
		cmdMCP(args)

	case "server":
		cmdServer(args)

	case "service":
		cmdService(args)

	case "click":
		cmdClick(args)

	case "type":
		cmdType(args)

	case "open":
		cmdOpen(args)

	case "navigate":
		cmdNavigate(args)

	case "screenshot":
		cmdScreenshot(args)

	case "inspect":
		cmdInspect(args)

	case "busy":
		cmdBusy(args)

	case "session":
		cmdSession(args)

	case "snapshot":
		cmdSnapshot(args)

	case "fill":
		cmdFill(args)

	case "evaluate", "eval":
		cmdEvaluate(args)

	case "tabs":
		cmdTabs(args)

	case "batch":
		cmdBatch(args)

	case "feedback":
		cmdFeedback(args)

	case "hover":
		cmdHover(args)

	case "drag":
		cmdDrag(args)

	case "cdp":
		cmdCdp(args)

	case "key", "press-key":
		cmdKey(args)

	case "wait", "wait-for":
		cmdWait(args)

	case "upload":
		cmdUpload(args)

	case "dialog":
		cmdDialog(args)

	case "emulate":
		cmdEmulate(args)

	case "resize":
		cmdResize(args)

	case "network":
		cmdNetwork(args)

	case "trace":
		cmdTrace(args)

	case "metrics":
		cmdMetrics(args)

	case "heap", "heapsnapshot":
		cmdHeap(args)

	case "skill", "skills":
		cmdSkill(args)

	case "extensions", "ext":
		cmdExtensions(args)

	case "export-mcp":
		cmdExportMCP(args)

	case "--help", "-h", "help":
		printUsage()

	default:
		fmt.Printf("Lệnh không hợp lệ: %s\n\n", cmd)
		printUsage()
		os.Exit(1)
	}
}
