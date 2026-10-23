# Agent Pilot CLI Reference

Use the standalone `agent-pilot` binary as the preferred interface when the
agent can run local commands: it is compact, deterministic, easy to script,
and measured output is typically much smaller than the equivalent MCP JSON-RPC
responses. It is suitable for shell, CI, test harnesses, and repetitive browser
workflows. It talks to the same local bridge as the MCP server and does not
require Node.js at runtime. Set `AGENT_PILOT_PORT` when the bridge is not on the
default port, or select it per command with `--port`/`--bridge-port`.

Use MCP when the host cannot spawn the binary, needs MCP schema discovery, or
requires an IDE/conversational tool lifecycle. Otherwise prefer CLI `batch`
for known sequences and `--format json` for individual commands.

## Fast path

```bash
# Start or verify the bridge
agent-pilot service status

# Always create a controlled tab first; capture the returned tab id
agent-pilot open http://127.0.0.1:3000

# Machine-readable interaction output
agent-pilot open http://127.0.0.1:3000 --format json
agent-pilot click '#submit' --tab 123 --format json
agent-pilot close --tab 123 --format json
agent-pilot emulate --theme dark --format json

# Prefer explicit targeting in multi-agent/browser sessions
agent-pilot snapshot --tab 123 --port 58766 --instance-id browser_... --format json
agent-pilot fill fields.json --tab 123 --port 58766 --instance-id browser_...
agent-pilot click '#submit' --tab 123 --port 58766 --instance-id browser_...

# Compact diagnostics
agent-pilot devtools status --tab 123

# Clean up tabs created by the workflow
agent-pilot close --tab 123
```

### Chrome Recorder flows

Use the extension-backed Recorder lifecycle for a compact, agent-controlled
user flow. The CLI is the preferred interface for recording because it keeps
the flow JSON on disk instead of returning a large step payload on every
browser action:

```bash
agent-pilot recorder start --tab 123 --title "Checkout flow"
agent-pilot click "[data-testid=add]" --tab 123
agent-pilot recorder stop --tab 123
agent-pilot recorder export --tab 123 --format json > checkout.recorder.json
agent-pilot recorder replay --file checkout.recorder.json --format json
agent-pilot recorder measure --file checkout.recorder.json --tab 123 --format json
```

`recorder import`, `state`, `edit`, and `clear` support JSON editing without
opening DevTools. `recorder measure` combines trace start, flow replay and
trace stop in one CLI command. It requires a positive Chrome tab ID and returns
a compact trace by default; add `--include-events` for the full event summary.
Imported iframe/target, viewport, and advanced assertion steps remain in the
exported JSON but fail explicitly when the extension cannot replay them.

If `tabs` returns an empty list, it normally means no tab has been opened or granted to the `🤖 Agent Pilot` group. Use `open`, or ask the user to move an existing tab into that group / attach it from the side panel.

`--port` is an alias for `--bridge-port` and applies to every browser command, including `tabs`, `open`, `cdp`, and `batch`. `--instance-id` pins dispatch to one connected Chrome process; an unknown explicit instance fails closed instead of falling back to the active browser. `AGENT_PILOT_INSTANCE_ID` provides the same pin for scripts that cannot add a flag.

## Choose the execution engine

- `snapshot`, `inspect`, `fill`, `type`, `scroll`, `wait`, and normal `evaluate` use the synthetic DOM path and do not need a debugger.
- `click` and `drag` are synthetic by default. Add `--via cdp` for cross-origin iframes, canvas, WebGL, or trusted input; use `--via auto` when fallback is desirable.
- `screenshot` of a background tab, `dialog`, `emulate`, `resize`, `network`, `trace`, `metrics`, and `heap` require CDP.
- Check availability with `agent-pilot cdp status --tab <id>` only before a CDP-dependent operation.

Never silently replace an explicit `--via cdp` failure. The command should report `CDP_UNAVAILABLE`; switch to synthetic input only when the task permits it.

## Batch for fewer round-trips

Put a complete test in a JSON file and run it once:

```json
{
  "actions": [
    {"action": "open", "url": "http://127.0.0.1:3000"},
    {"action": "wait_for_selector", "selector": "#app"},
    {"action": "fill_form", "fields": [{"selector": "#email", "value": "user@example.com"}]},
    {"action": "click", "selector": "button[type=submit]", "waitForSelector": ".success"},
    {"action": "screenshot", "path": "/tmp/agent-pilot-success.png"},
    {"action": "close"}
  ]
}
```

```bash
agent-pilot batch flow.json --format json
```

Batch `actions` must contain objects. For DevTools use `{ "type": "performance_metrics" }`, `{ "type": "performance_trace", "action": "start" }`, `{ "type": "performance_trace", "action": "stop" }`, or `{ "type": "heap_snapshot" }`; unsupported heap capture reports `HEAPPROFILER_UNAVAILABLE` rather than a fake fallback.

Use inline `waitMs`, `waitForSelector`, or `waitForText` on navigation and interaction commands instead of a separate sleep/wait command. Batch screenshots are written to disk and should not be returned as base64 unless explicitly needed.

## Compact DevTools workflow

```bash
agent-pilot devtools status --tab 123
agent-pilot metrics --tab 123
agent-pilot trace start --tab 123
agent-pilot trace stop --tab 123
agent-pilot heap capability --tab 123       # probe before doing heap work
agent-pilot heap baseline --tab -123 --file /tmp/base.heapsnapshot
agent-pilot heap diff --tab -123 --file /tmp/current.heapsnapshot
agent-pilot devtools heap-analyze --params '{"action":"summary","filePath":"/tmp/base.heapsnapshot"}'
agent-pilot devtools heap-analyze --params '{"action":"compare","baseFilePath":"/tmp/base.heapsnapshot","currentFilePath":"/tmp/current.heapsnapshot"}'
```

Heap support is explicit: call `heap capability` first. Ordinary extension-debugger tabs return `supported:false` with `HEAPPROFILER_UNAVAILABLE`; they never create a fake metrics baseline. Create an isolated context (`agent-pilot devtools context-create`), open its negative tab, and pass `--file` to capture a real `.heapsnapshot`; isolated tabs support baseline/diff and the saved file can be analyzed with `devtools heap-analyze`.

The `devtools` command also exposes the MCP-only operations that do not have a
separate top-level CLI command: `3p-list`, `3p-execute`, `webmcp-list`,
`webmcp-execute`, `pwa-probe`, `pwa-state`, `pwa-install`, `pwa-launch`, and
`pwa-uninstall`. Pass their MCP-shaped arguments through `--params`.

Extension-backed snapshot/screenshot operations on `data:` URLs return `DATA_URL_UNSUPPORTED` because Chrome does not inject the Agent Pilot content receiver into a `data:` document. Use an HTTP/localhost page for those operations. The isolated DevTools runtime can still inspect `data:` URLs for CDP/AX/CSS/video/heap operations.

The full DevTools bridge is available through CLI aliases as well as MCP:

```bash
agent-pilot devtools 3p-list --tab 123
agent-pilot devtools 3p-execute --tab 123 --params '{"toolName":"name","input":{}}'
agent-pilot devtools webmcp-list --tab 123
agent-pilot devtools webmcp-execute --tab 123 --params '{"toolName":"name","input":{}}'
agent-pilot devtools pwa-probe
agent-pilot devtools pwa-state --params '{"manifestId":"https://example.test/manifest.webmanifest"}'
agent-pilot devtools pwa-install --params '{"manifestId":"https://example.test/manifest.webmanifest"}'
agent-pilot devtools pwa-launch --params '{"manifestId":"https://example.test/manifest.webmanifest"}'
agent-pilot devtools pwa-uninstall --params '{"manifestId":"https://example.test/manifest.webmanifest"}'
agent-pilot devtools video-start --tab -123 --params '{"filePath":"/tmp/test.mp4","fps":10}'
agent-pilot devtools video-stop --tab -123
```

These operations use Chrome's native/private DevTools runtime. PWA commands still depend on a Chrome build exposing the browser-scoped PWA CDP domain; WebMCP and third-party tools depend on the page exposing those APIs.

CSS inspection is progressive to keep responses close to Chrome MCP's compact default:

- `agent-pilot devtools css --params '{"selector":"#app"}'` returns a compact summary with selected computed values and direct/inherited rule sources.
- Add `"detail":"computed"` plus `"groups":["layout","typography"]` or `"properties":["display","color"]` for targeted computed CSS.
- Add `"detail":"rules","includeInherited":true` for paginated cascade declarations, or `"detail":"full"` only for the complete payload.

For the complete command list and flags, see [cli-usage.md](cli-usage.md).

## Service and MCP commands

```bash
agent-pilot service install
agent-pilot service status
agent-pilot service restart
agent-pilot mcp
agent-pilot mcp --bridge-port 58766
agent-pilot export-mcp mcp/agent-pilot
```

Use the generated files in `mcp/agent-pilot/` when configuring or validating an MCP client. If a client shows fewer capabilities than those schemas, refresh its provider/tool cache before debugging the extension.

For the complete decision table covering CLI/MCP, positive extension tabs,
negative isolated tabs, page-provided tools, capability errors, and token-safe
defaults, read [tool-routing.md](tool-routing.md).

## Extension lifecycle

Use the MCP extension manager or the corresponding bridge method to reload an unpacked extension. Avoid a disable/enable cycle: it can terminate the extension WebSocket and make the CLI appear broken until the bridge reconnects.
