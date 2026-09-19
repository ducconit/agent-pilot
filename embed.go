// Package agentpilot exposes repository-level assets to the CLI module.
//
// The skills tree lives at the repository root because the Agent Skills
// ecosystem (`npx skills add <repo>`) discovers `skills/` there. Embedding it
// from the module root keeps that directory the single source of truth:
// editing skills/ and rebuilding is enough — there is no generated Go file to
// regenerate, sync or commit.
package agentpilot

import "embed"

// SkillFiles embeds the canonical skills tree (skills/agent-pilot/**).
//
// The CLI installs these files verbatim with `agent-pilot skill install`, so a
// released binary always ships the exact files the repository publishes.
//
//go:embed skills
var SkillFiles embed.FS
