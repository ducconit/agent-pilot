# Agent Pilot bundled CLI

Release bundles populate this directory with the native Agent Pilot CLI/MCP
binary for the target operating system and architecture:

- Ubuntu/Linux: `agent-pilot`
- macOS: `agent-pilot`
- Windows: `agent-pilot.exe`

The source repository and the embedded skill documentation do not commit
compiled binaries. `npm run pack:bundle` injects the matching binary into each
OS bundle, and `agent-pilot skill install` copies the running native binary
into the installed skill's `scripts/` directory.
