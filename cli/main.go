// main.go is the CLI entry point. It only decides whether to print usage or
// enter the MCP stdio server (when launched with no subcommand), and otherwise
// delegates to dispatchCommand (cli_dispatch.go), which routes each subcommand
// to a per-command handler grouped by domain in cli_commands_page.go,
// cli_commands_cdp.go and cli_commands_meta.go. Argument parsing helpers live in
// cli_args.go, shared config in config.go and the help text in cli_usage.go.

package main

import "os"

func main() {
	if len(os.Args) < 2 {
		// No subcommand: when stdin is a pipe rather than a terminal, the caller
		// is an AI agent speaking MCP JSON-RPC, so default to the stdio MCP
		// server. Otherwise (interactive) just print the usage help.
		stat, err := os.Stdin.Stat()
		if err == nil && (stat.Mode()&os.ModeCharDevice) == 0 {
			RunMCPServer()
			return
		}
		printUsage()
		return
	}

	// dispatchCommand owns the subcommand switch and all per-command exit codes.
	dispatchCommand(os.Args[1], os.Args[2:])
}
