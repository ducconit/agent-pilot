# Agent Pilot MCP Reference

Use the MCP interface for conversational agents and IDEs. The MCP server runs over stdio (`agent-pilot mcp`) while the Go bridge and Chrome extension remain shared local services.

The generated schemas in `mcp/agent-pilot/` are authoritative. This repository currently exports 57 schema files; clients that show an older count or omit newer actions are using a stale provider cache. `browser_run_actions.actions` is an array of action objects (`{"type":"click",...}`), not an array of strings.

Before testing, query `http://127.0.0.1:<port>/health` and confirm the MCP/bridge port plus `clients[].extensionVersion` and `clients[].extensionBuildId`. If the MCP connector reports a different port or build than `/health`, it is stale or attached to another bridge; select the port explicitly with `agent-pilot mcp --bridge-port <port>` and refresh the connector schema.

## Minimal workflow

Use `browser_run_actions` for a complete test whenever the steps are known in advance:

```json
{
  "actions": [
    {"action": "open", "url": "http://127.0.0.1:3000"},
    {"action": "wait_for_selector", "selector": "#app"},
    {"action": "fill_form", "fields": [{"selector": "#email", "value": "user@example.com"}]},
    {"action": "click", "selector": "button[type=submit]", "waitForSelector": ".success"},
    {"action": "devtools", "detail": "summary", "errorsOnly": true, "excludeStatic": true},
    {"action": "screenshot", "path": "/tmp/agent-pilot-success.png"},
    {"action": "close"}
  ],
  "stopOnError": true
}
```

For exploratory work, call `browser_open_tab`, save the returned `tabId`, and pass it explicitly to subsequent tools. Do not use `browser_list_tabs` as a required preflight; an empty result is expected when no Agent Pilot tab exists.

For a compact DevTools batch, use action objects:

```json
{
  "actions": [
    {"type": "performance_metrics"},
    {"type": "performance_trace", "action": "start"},
    {"type": "performance_trace", "action": "stop"},
    {"type": "heap_snapshot", "stopOnError": false}
  ]
}
```

## Tool selection

| Need | MCP tool |
| --- | --- |
| Open/navigate/close | `browser_open_tab`, `browser_navigate`, `browser_close_tab` |
| Find interactive controls | `browser_snapshot` |
| Inspect one element | `browser_get_element` |
| Fill several fields | `browser_fill_form` |
| Click/type/scroll | `browser_click`, `browser_type`, `browser_scroll` |
| Upload files | `browser_upload_file` (`via: "auto"` by default) |
| Screenshot | `browser_screenshot` |
| Console/network/metrics | `browser_get_devtools_data` |
| Trace / Web Vitals / heap | `browser_performance_trace`, `browser_performance_metrics`, `browser_take_heapsnapshot` |
| Advanced DevTools | `browser_lighthouse_audit`, `browser_lighthouse_analyze_audit`, `browser_performance_analyze_insight`, `browser_accessibility_snapshot`, `browser_service_workers` |
| Extension lifecycle | `browser_manage_extensions` |

## Token-efficient observation

Start with the smallest response that answers the question:

```json
{
  "tabId": 123,
  "type": "all",
  "detail": "summary",
  "errorsOnly": true,
  "excludeStatic": true,
  "limit": 20
}
```

`browser_get_devtools_data` supports `detail: "summary" | "standard" | "full"`, `errorsOnly`, `excludeStatic`, `filterOrigin`, `includeHeaders`, `limit`, and `clear`. Use `full` or `includeHeaders` only when drilling into a known failure.

Prefer `browser_snapshot` with a bounded `maxElements` and `waitForSelector` over raw HTML. Prefer `browser_get_element` with `includeStyles: false`; enable styles only for UI or contrast inspection. Screenshots should use a filesystem `path`; request `base64: true` only when the image must remain inline.

## CDP and capability boundaries

- Synthetic DOM actions do not require CDP and are safer for ordinary pages.
- Use `via: "cdp"` for trusted input, cross-origin frames, canvas, and WebGL. Use `via: "auto"` when a synthetic fallback is acceptable.
- CDP-dependent actions can fail if another debugger is attached. Check `browser_devtools_status` only when the requested operation needs CDP.
- HeapProfiler is not available on ordinary extension-debugger tabs. `browser_take_heapsnapshot` returns `HEAPPROFILER_UNAVAILABLE` and does not save a fake performance-metrics baseline. Use an isolated DevTools context when a real heap snapshot is required.
- Heap baseline/diff is not emulated on ordinary extension-debugger tabs. Treat `HEAPPROFILER_UNAVAILABLE` or protocol `-32601` as an explicit capability boundary; do not interpret runtime metrics as a heap snapshot or leak diff.
- `browser_get_css_styles` is compact by default (`detail: "summary"`). Use `detail: "computed"` with `groups`/`properties`, `detail: "rules"` with `includeInherited`, or `detail: "full"` only when the complete cascade is needed. The response reports direct rules and inherited sources separately.
- Lighthouse uses a bounded runtime budget and resets the private DevTools process after a timeout; a timed-out audit should be retried once only after inspecting the returned error. `browser_accessibility_snapshot` uses a separate path and remains callable after audit recovery.
- Snapshot/capture operations on `data:` URLs may fail with a missing content receiver. Reproduce them on an HTTP/localhost page or in an isolated DevTools context.

## Extension manager actions

`browser_manage_extensions` supports:

```text
list | setEnabled | toggle | install | reload | triggerAction | uninstall
```

Use `reload` for an unpacked extension update. Do not implement reload as `setEnabled(false)` followed by `setEnabled(true)`, because that can drop the bridge connection. `triggerAction` must target the enclosing tab, not a page/webview target.

## Session isolation and cleanup

- Only tabs in the `🤖 Agent Pilot` group are visible to page tools.
- Context tabs for isolated sessions use negative IDs; do not confuse context isolation with tab-group isolation.
- Never close another agent's tab. Close tabs created by the current workflow with `browser_close_tab` or the final batch `close` action.
- For independent login state, create a browser context and pass its `contextId`; use a fresh snapshot after navigation.

## Setup and schema refresh

Run `agent-pilot mcp` in the MCP client configuration. If the client exposes an old tool list, rebuild/export the schemas and refresh the client/provider cache:

```bash
npm run build:cli
./cli/agent-pilot export-mcp mcp/agent-pilot
```

See [setup.md](setup.md) for client-specific configuration and [architecture-and-server.md](architecture-and-server.md) for bridge, REST, and concurrency details.
