// main.go is the thin CLI entry point: it hands the process arguments to the
// cli package, which owns subcommand dispatch, the MCP stdio server and the
// per-command handlers.

package main

import (
	"os"

	"github.com/ducconit/agent-pilot-extension/cli/cli"
)

func main() {
	cli.Run(os.Args[1:])
}
