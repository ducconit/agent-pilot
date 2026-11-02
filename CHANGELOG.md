# 📝 Changelog

All notable changes to **Agent Pilot** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.0] - 2026-11-02

### 🌟 Added
- **Native Set-of-Marks (SoM) Visual Overlay**:
  - Automatically overlays high-contrast interactive element badges (`@1, @2, @3...`) and bounding boxes directly onto captured screenshots.
  - **Zero Page DOM Mutation**: Rendered 100% on `OffscreenCanvas` in the background Service Worker, eliminating CSS layout distortion, mutation observer triggers, and bot detection risks.
  - Supported via CLI flag `--annotate-interactive` (or `-i`) on `agent-pilot screenshot`.
  - Customizable color themes via `--som-color` (or `somColor`: `amber`, `cyan`, `green`, `red`, `purple`).
  - Supported in MCP via `browser_screenshot(annotateInteractive=true, somColor="amber")`.
- **Smart DOM Pruning & Collision Filtering**:
  - Upgraded `dom-inspector.js` to automatically filter out non-clickable elements with `pointer-events: none`.
  - 3-point collision and occlusion detection using `document.elementFromPoint` (sampling element center and opposite corners) to prune elements obscured behind modal dialogs, backdrops, and sticky overlays.
  - Fully immune to false-positives when target elements contain child SVGs/icons or when covered by Agent Pilot's internal UI overlays (`[id^='agent-pilot']`).
  - Bounding box top-left coordinates (`bounds: { x, y, width, height }`) and viewport metadata (`viewport`, `scrollX`, `scrollY`) added to JSON snapshot output alongside `rect` (center x, y) for 100% backward compatibility.
- **Dual-Mode Snapshot**:
  - Added `includeScreenshot: true` (`--screenshot` / `-s`) to `agent-pilot snapshot` and MCP `browser_snapshot`.
  - Enables AI Coding Agents to receive both compact accessibility text tree and Set-of-Marks annotated screenshot in a single tool round-trip.
- **Automated Verification Suite**:
  - Added `test/unit/core/som_annotation.test.mjs` with 5 automated test cases covering SoM canvas rendering, custom color themes, JSON bounds, pointer-events pruning, and backdrop occlusion.
  - Verified 100% pass across all 8 unit test modules and 4 core E2E browser test suites.

### 🔄 Changed
- Updated Go CLI parameter parsers and Cobra commands for `screenshot` and `snapshot`.
- Updated MCP server tool schemas in `cli/mcp/tools.go` for `browser_screenshot` and `browser_snapshot`.
- Updated Agent Skills documentation (`skills/agent-pilot/SKILL.md`) with Set-of-Marks prompt engineering recipes.
- Version bump to `1.4.0` across extension manifest, service worker constants, and packaging manifests.

---

## [1.3.0] - 2026-10-31

### 🌟 Added
- **Visual Feedback Studio**: In-page HUD overlay for pinning bug reports, region annotations, and exporting markdown reproduction prompts.
- **Side Panel Control Center**: 5-format eyedropper (HEX, RGB, RGBA, HSL, OKLCH), agent session monitor, and manual reconnect.
- **Chrome DevTools Protocol (CDP) Hardware Capture**: Background tab screenshots, console interception, and network request monitoring without stealing user focus.
- **Tab Group Isolation**: Strict security containment inside `🤖 Agent Pilot` tab groups to protect user personal tabs.

---

## [1.2.1] - 2026-10-25

### 🛠️ Fixed
- Resolved focus stealing race conditions when running concurrent agent sessions.
- Fixed clipboard delegate permissions in Linux headless environments with Xvfb.

---

## [1.2.0] - 2026-10-15

### 🌟 Added
- Multi-platform Go CLI standalone engine with dual-mode port forwarding (Port 58765).
- Model Context Protocol (MCP) server support for Claude Code, Cursor, Windsurf, and Google Antigravity.
- Dual-layer secret sanitization engine redacting 13 regex patterns and 23 sensitive property keys.
