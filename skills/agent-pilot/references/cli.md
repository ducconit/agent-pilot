# Agent Pilot CLI Reference

Use the standalone `agent-pilot` binary for shell, CI, test harnesses, and deterministic browser workflows. It talks to the same local bridge as the MCP server and does not require Node.js at runtime.

## Fast path

```bash
# Start or verify the bridge
agent-pilot service status

# Always create a controlled tab first; capture the returned tab id
agent-pilot open http://127.0.0.1:3000

# Prefer explicit targeting in multi-agent/browser sessions
agent-pilot snapshot --tab 123 --format json
agent-pilot fill fields.json --tab 123
agent-pilot click '#submit' --tab 123

# Compact diagnostics
agent-pilot devtools status --tab 123

# Clean up tabs created by the workflow
agent-pilot close --tab 123
```

If `tabs` returns an empty list, it normally means no tab has been opened or granted to the `🤖 Agent Pilot` group. Use `open`, or ask the user to move an existing tab into that group / attach it from the side panel.

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

Use inline `waitMs`, `waitForSelector`, or `waitForText` on navigation and interaction commands instead of a separate sleep/wait command. Batch screenshots are written to disk and should not be returned as base64 unless explicitly needed.

## Compact DevTools workflow

```bash
agent-pilot devtools status --tab 123
agent-pilot metrics --tab 123
agent-pilot trace start --tab 123
agent-pilot trace stop --tab 123
agent-pilot heap baseline --tab 123
agent-pilot heap diff --tab 123
```

HeapProfiler support depends on Chrome. A response with `supported: false` and `fallback: "performance.metrics"` is a handled capability downgrade, not a reason to retry repeatedly.

For the complete command list and flags, see [cli-usage.md](cli-usage.md).

## Service and MCP commands

```bash
agent-pilot service install
agent-pilot service status
agent-pilot service restart
agent-pilot mcp
agent-pilot export-mcp mcp/agent-pilot
```

Use the generated files in `mcp/agent-pilot/` when configuring or validating an MCP client. If a client shows fewer capabilities than those schemas, refresh its provider/tool cache before debugging the extension.

## Extension lifecycle

Use the MCP extension manager or the corresponding bridge method to reload an unpacked extension. Avoid a disable/enable cycle: it can terminate the extension WebSocket and make the CLI appear broken until the bridge reconnects.
