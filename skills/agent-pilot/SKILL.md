---
name: agent-pilot
description: Control browser tabs and web applications through Agent Pilot using either its standalone CLI or MCP tools. Use for browser automation, web testing, screenshots, DOM inspection, DevTools diagnostics, and extension lifecycle tasks.
---

# Agent Pilot

Agent Pilot is a browser automation bridge backed by a Chrome MV3 extension. It provides two equivalent interfaces over the same bridge:

- [CLI workflow](references/cli.md) — shell scripts, CI, deterministic local automation, and environments without an MCP client.
- [MCP workflow](references/mcp.md) — conversational agents and IDE integrations.

Load only the interface reference needed for the current task. The detailed command reference remains available at [cli-usage.md](references/cli-usage.md); setup and bridge internals are in [setup.md](references/setup.md) and [architecture-and-server.md](references/architecture-and-server.md).

Use [tool-routing.md](references/tool-routing.md) when the task could use more
than one interface or execution path. It maps each capability to CLI/MCP,
extension relay/isolated DevTools, required tab IDs, and known capability
boundaries.

Release bundles include a native CLI/MCP binary in `scripts/` for each target
OS: Ubuntu/Linux and macOS use `scripts/agent-pilot`; Windows uses
`scripts/agent-pilot.exe`. Prefer the installed `agent-pilot` command when it
is on `PATH`; use the skill-local script when an IDE cannot resolve `PATH`.
The source checkout has only `scripts/README.md`; compiled binaries are
injected by `npm run pack:bundle` or copied by `agent-pilot skill install`.

## Default interface recommendation

**Prefer the standalone CLI by default.** It produces substantially smaller
machine-readable output than MCP and is usually the better choice when the
agent can run local commands. Use `--format json`, pin `--port` and
`--instance-id`, and combine known multi-step workflows in one `batch` file.
This minimizes context usage, makes retries explicit, and is easy to measure
or reproduce in CI.

Choose MCP instead when the host agent can only call MCP tools, needs tool
schema discovery/validation, needs conversational progressive disclosure, or
must integrate with an IDE's MCP lifecycle. MCP responses include useful
provenance metadata, but that metadata is repeated on each response and can
cost more context. If both interfaces are available, do the browser work with
CLI and reserve MCP for orchestration or capabilities not exposed by the CLI.

Decision order:

1. Use CLI `batch` for a known sequence of browser actions.
2. Use individual CLI commands with `--format json` for exploratory or
   scriptable work.
3. Fall back to MCP when CLI has no equivalent, the client cannot spawn the
   binary, or the task specifically needs MCP tools/schema semantics.

Do not send stateful MCP calls such as `screenshot` and `close` concurrently;
preserve ordering for tab lifecycle actions. This avoids a race where `close`
removes the tab before `screenshot` executes.

## Core safety rules

1. Agent Pilot only controls tabs in the `🤖 Agent Pilot` Chrome tab group. If there is no controlled tab, open one first; an empty `browser_list_tabs` result is expected in that state.
2. Capture the `tabId` returned by `open`/`browser_open_tab` and pass it explicitly to later operations. This prevents cross-agent tab hijacking.
3. Close tabs created for a test when finished. Use CLI `close`, MCP `browser_close_tab`, or a final `close` batch action.
4. Use extension `reload` to reload an unpacked extension. Do not disable/enable it as a reload workaround because that can drop the bridge connection.
5. Synthetic DOM input is the default. Use CDP only for trusted input, cross-origin iframes, canvas/WebGL, background screenshots, tracing, metrics, heap, and other CDP-only operations.

## Fast routing decision

1. Check `/health` on the exact bridge port and verify the instance, extension
version, and build ID before browser work.
2. Use CLI `batch` for a known sequence, or individual CLI commands with
`--format json` for exploratory work. Use MCP when the host cannot run the
binary or needs MCP schemas and tool lifecycle.
3. Use a positive Chrome tab ID for extension-backed tabs. Use a negative tab ID
or `contextId` for an isolated DevTools context. Never treat these IDs as
interchangeable.
4. Use the extension relay for ordinary DOM work and Recorder. Use isolated
DevTools for Lighthouse, AX, MP4, PWA, WebMCP, third-party page tools, and
real heap files. Read [tool-routing.md](references/tool-routing.md) before an
advanced operation.

## Token-efficient default

Prefer one CLI batch over a chain of individual calls:

```text
open → wait_for_selector → fill/click → devtools summary → screenshot → close
```

```bash
agent-pilot batch flow.json --port 58766 --instance-id browser_... --format json
```

When MCP is required, use its batch tool (`browser_run_actions`) for the same
sequence instead of emitting one tool call per step.

For diagnostics, start with compact output (`detail: "summary"`, `errorsOnly: true`, `excludeStatic: true`) and request full data only for a follow-up investigation. Use `includePreserved: false` (or `navigationId`) on `browser_get_devtools_data` and `browser_list_network_requests` when you only want Console/Network entries from the latest navigation, and pass `msgid` to inspect a single Console message's full arguments/stack trace. Use `includeSnapshot: true` (`--include-snapshot`) on `open`, `navigate`, `click`, `type`, `fill_form`, `upload_file`, `scroll`, `hover`, `drag`, or `press_key` to receive an interactive snapshot in the same round-trip. Save screenshots (`png`, `jpeg`, or `webp` with `quality`) and large `evaluate` outputs (`filePath` / `-o`) to disk and return paths instead of inline payloads.

## Bridge

The bridge listens on loopback. The default port is `58765`; deployments may override it with `AGENT_PILOT_PORT`, `agent-pilot <command> --port <port>`/`--bridge-port <port>`, `agent-pilot mcp --bridge-port <port>`, or the extension setting. Use `--instance-id <id>` (or `AGENT_PILOT_INSTANCE_ID`) for process affinity when multiple Chrome instances are connected; an explicit unknown instance fails closed. Before sending work, check `GET http://127.0.0.1:<port>/health` and verify `port`, `version`, `clientCount`, `clients[].instanceId`, `clients[].bridgePort`, `clients[].extensionVersion`, and `clients[].extensionBuildId`. A healthy response on another port/provider is not proof that this session is connected to the bridge under test.

If an MCP client reports an old tool list, old version, or a different port, treat it as a stale connector/provider cache. Compare its metadata with `/health` and refresh/export the schemas before debugging extension behavior. Use one explicit MCP bridge port per process when multiple Chrome profiles are running.

## Capability notes

- HeapProfiler is unavailable on ordinary extension-debugger tabs in the current Chrome path. When a raw `.heapsnapshot` `filePath` is requested, heap actions fail with `HEAPPROFILER_UNAVAILABLE`; when no `filePath` is requested, `agent-pilot heap --baseline` and `agent-pilot heap --diff` automatically fall back to `snapshotMode: "runtime-counters-fallback"` (tracking `jsHeapUsedMB`, `liveDomElements`, `detachedOrUncollectedNodes`, `documents`, and `jsEventListeners` deltas). Use an isolated DevTools context when a real V8 `.heapsnapshot` is required.
- Background tabs (`open` without `--active`) have `visibilityState: "hidden"`, so Chromium defers FCP and LCP until the tab is foregrounded. When auditing Core Web Vitals (FCP/LCP), either open the tab with `--active` (`active: true`) or pass `--bring-to-front` (`bringToFront: true`) and `--gc` (`collectGarbage: true`) to `agent-pilot metrics` / `browser_performance_metrics`. `metrics` already includes full `navigationTiming` (DNS/TCP/TLS/TTFB/download/decodedBodyKB/protocol) and `resources.byType` breakdowns, so custom `evaluate` scripts are unnecessary for standard Web Vitals and resource reports. Use `agent-pilot console errors --tab <id>` to inspect runtime console exceptions directly, and `agent-pilot network list --tab <id>` (add `--headers` when raw HTTP headers are needed) for compact network summaries with `cacheStatus`, `contentEncoding`, `durationMs`, and `transferKB`.
- Probe heap support with `agent-pilot heap capability --tab <id>` or MCP `browser_heap_capability` before starting a memory task. For a real snapshot/baseline/diff, create an isolated DevTools context, use its negative tab ID, and provide a `.heapsnapshot` `filePath`; analyze saved files with `devtools heap-analyze` or `browser_analyze_heapsnapshot`.
- CDP can be temporarily unavailable when another debugger is attached. Prefer synthetic actions where possible and inspect `cdp.status`/`browser_devtools_status` only when a CDP operation is actually needed.
- The generated MCP schemas under `mcp/agent-pilot/` are the source of truth for current tool names and parameters; do not rely on an old provider schema or a stale tool-count claim.
- Batch `actions` are objects, not strings. For example: `{"actions":[{"type":"performance_metrics"},{"type":"performance_trace","action":"start"},{"type":"performance_trace","action":"stop"}]}`. A `heap_snapshot` action is exposed consistently, but ordinary extension-debugger tabs may return `HEAPPROFILER_UNAVAILABLE`.
- Extension page snapshot/screenshot and batch capture on `data:` URLs fail early with `DATA_URL_UNSUPPORTED`: Chrome does not inject Agent Pilot's content receiver into a `data:` document. Use an HTTP/localhost page for extension-backed DOM capture, or an isolated DevTools context for CDP/AX/CSS/video/heap operations; the private Puppeteer path can inspect `data:` URLs.
- Native MP4 screencast, PWA install/launch/uninstall, WebMCP, and page developer-tool discovery are available from both MCP and the CLI. The CLI aliases are `devtools video-start/video-stop`, `pwa-probe/pwa-state/pwa-install/pwa-launch/pwa-uninstall`, `webmcp-list/webmcp-execute`, and `3p-list/3p-execute`; pass MCP-shaped JSON through `--params`.
- Rich navigation (`action: "url" | "back" | "forward" | "reload"`, `ignoreCache`, `initScript`, `handleBeforeUnload: "accept" | "decline"`), double-click (`dblClick: true` / `--dblclick`), element-aware `evaluate` (`args: ["@1", "#modal"]` resolved to live `Element` references in `MAIN` world, `sourcePath` / `-f`, `filePath` / `-o`), and tab-scoped Virtual WebAuthn (`browser_webauthn` / `agent-pilot webauthn` for passkey/CTAP2/U2F flows) work natively on extension-backed tabs.
- Chrome Recorder flows are available from both interfaces: CLI `recorder start|stop|state|replay|measure|export|import|edit|clear` and MCP `browser_recorder_start|stop|state|replay|measure|export|import|edit|clear`. Prefer CLI for long recordings and save the exported JSON. Replay is limited to supported main-frame steps; imported iframe/viewport/advanced assertion steps are preserved in JSON and rejected explicitly during replay. `measure` requires a positive Chrome tab ID, combines replay with a trace, and returns a compact trace by default.

## References

- [CLI interface and efficient command patterns](references/cli.md)
- [MCP interface, batch actions, and compact DevTools queries](references/mcp.md)
- [Full CLI command reference](references/cli-usage.md)
- [Setup and troubleshooting](references/setup.md)
- [Architecture, bridge, REST, and concurrency](references/architecture-and-server.md)
- [Batch automation example](examples/batch-flow-example.json)
