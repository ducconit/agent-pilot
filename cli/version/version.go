// Package version carries the build metadata for the CLI / bridge / MCP binary.
//
// Values are injected at build time with -ldflags "-X" so there is a single
// source of truth (package.json) and no version constant to keep in sync:
//
//	-X github.com/ducconit/agent-pilot-extension/cli/version.Version=1.0.8-beta
//	-X github.com/ducconit/agent-pilot-extension/cli/version.Commit=abc1234
//	-X github.com/ducconit/agent-pilot-extension/cli/version.Date=2026-09-19T10:00:00Z
//
// scripts/build_cli.mjs, scripts/pack_bundle.mjs and scripts/export_mcp.mjs
// pass these flags. A bare `go build` (no flags) reports Version "dev".
package version

import "strings"

var (
	// Version is the semantic version without the leading "v" (e.g. "1.0.8-beta").
	Version = "dev"
	// Commit is the short git SHA the binary was built from (optional).
	Commit = ""
	// Date is the UTC build timestamp (optional).
	Date = ""
)

// Raw returns the version exactly as reported by /health, the ping API and the
// MCP initialize handshake (no leading "v").
func Raw() string {
	return Version
}

// String returns the display version used in help output ("v1.0.8-beta"), or
// "dev" when the build did not inject a version.
func String() string {
	if Version == "" || Version == "dev" {
		return "dev"
	}
	return "v" + strings.TrimPrefix(Version, "v")
}

// Full returns the display version with commit/date when available.
func Full() string {
	var parts []string
	if Commit != "" {
		parts = append(parts, Commit)
	}
	if Date != "" {
		parts = append(parts, Date)
	}
	if len(parts) == 0 {
		return String()
	}
	return String() + " (" + strings.Join(parts, ", ") + ")"
}
