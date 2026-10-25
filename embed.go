// Package agentpilot exposes repository-level assets to the CLI module.
//
// The skills tree lives at the repository root because the Agent Skills
// ecosystem (`npx skills add <repo>`) discovers `skills/` there. Embedding it
// from the module root keeps that directory the single source of truth:
// editing skills/ and rebuilding is enough — there is no generated Go file to
// regenerate, sync or commit.
package agentpilot

import "embed"

// SkillFiles embeds the canonical skills documentation tree (skills/agent-pilot/**),
// excluding any locally built native binary inside skills/agent-pilot/scripts/.
//
// The CLI installs these files verbatim with `agent-pilot skill install` and
// copies the running native binary into `<target>/scripts/agent-pilot(.exe)`.
//
//go:embed skills/agent-pilot/SKILL.md skills/agent-pilot/references skills/agent-pilot/examples skills/agent-pilot/scripts/README.md
var SkillFiles embed.FS
