# Agent Pilot MCP Reference

Use the MCP interface for conversational agents and IDEs. The MCP server runs over stdio (`agent-pilot mcp`) while the Go bridge and Chrome extension remain shared local services.

The generated schemas in `mcp/agent-pilot/` are authoritative. This repository currently exports 68 schema files; clients that show an older count or omit newer actions are using a stale provider cache. `browser_run_actions.actions` is an array of action objects (`{"type":"click",...}`), not an array of strings.

Before testing, query `http://127.0.0.1:<port>/health` and confirm the MCP/bridge port plus `clients[].instanceId`, `clients[].bridgePort`, `clients[].extensionVersion`, and `clients[].extensionBuildId`. If the MCP connector reports a different port or build than `/health`, it is stale or attached to another bridge; select the port explicitly with `agent-pilot mcp --bridge-port <port>` and refresh the connector schema. Every MCP response includes compact `_meta` provenance (`bridgePort`, bridge version, instance, extension version/build when available).

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
| Open/navigate/back/forward/reload/close/list | `browser_open_tab`, `browser_navigate` (`action: "url"\|"back"\|"forward"\|"reload"`, `ignoreCache`, `initScript`, `handleBeforeUnload`), `browser_close_tab`, `browser_list_tabs` |
| Multi-browser instance discovery & routing | `browser_list_instances`, `browser_select_instance` (`instanceId`) |
| Persistent agent session & visual busy lock | `browser_start_session` (`name`), `browser_end_session` (`closeTab`), `browser_set_busy` (`busy`, `action`) |
| Batch action pipeline (multi-step single round-trip) | `browser_run_actions` (`actions: [{type/action, ...}]`, `stopOnError`, `omitDataUrls`) |
| Find interactive controls / accessibility snapshot | `browser_snapshot` (or `includeSnapshot: true` on interaction/navigation tools) |
| Inspect one element / sample pixel color | `browser_get_element` (`includeStyles`), `browser_pick_color` (`x`, `y`) |
| Evaluate JS with `@ref`/selector args or disk I/O | `browser_evaluate` (`script` or `sourcePath`, `args: ["@1", ...]`, `filePath`, `waitMs`/`sleepMs`, `waitForSelector`, `waitForText`) |
| Fill several form fields / upload files | `browser_fill_form` (`fields`), `browser_upload_file` (`files`, `selector`, `via: "auto"\|"cdp"`) |
| Mouse & keyboard interaction | `browser_click` (`dblClick: true`, `via`), `browser_type` (`clear`, `pressEnter`), `browser_scroll` (`deltaX`, `deltaY`), `browser_hover` (`selector`, `via`), `browser_drag` (`from`, `to`, `fromX`, `fromY`, `toX`, `toY`, `steps`, `holdMs`, `via`), `browser_press_key` (`key`, `selector`, `eventType`, `modifiers`) |
| Wait for DOM state / JavaScript dialogs | `browser_wait_for` (`selector`, `text`, `state`, `timeoutMs`), `browser_handle_dialog` (`accept`, `promptText`) |
| Device emulation & viewport resizing | `browser_emulate` (`device`, `viewport`, `userAgent`), `browser_resize_page` (`width`, `height`, `deviceScaleFactor`, `mobile`) |
| Isolated multi-tenant browser contexts | `browser_create_context` (`name`), `browser_list_contexts`, `browser_close_context` (`contextId`) |
| Screenshot (`png`/`jpeg`/`webp` + banner/highlight/arrows/badges/icons) | `browser_screenshot` (`format`, `quality`, `path`, `step`, `title`/`caption`, `description`, `captionPosition`, `highlightSelector`, `arrows`, `callouts`, `badges`, `boxes`, `circles`, `icons`, `redact`, `spotlight`, `clip`) |
| Native MP4 screen recording (screencast) | `browser_screencast_start` (`format: "mp4"`, `quality`, `crop`), `browser_screencast_stop` (`filePath`) |
| Console/network/metrics, HTTP bodies & DevTools health | `browser_devtools_status`, `browser_get_devtools_data` (`msgid`, `includePreserved`, `navigationId`), `browser_list_network_requests`, `browser_get_network_request` (`requestId`, `filePath`), `browser_get_css_styles` (`detail: "summary"\|"computed"\|"rules"\|"full"`) |
| Human UI Feedback Studio (Channel A / Channel B) | `browser_get_pending_feedback` (`limit`, `sessionId`, `clear`), `browser_wait_for_feedback` (`timeout`) |
| Virtual WebAuthn / Passkey testing | `browser_webauthn` (`enable`, `addAuthenticator`, `getCredentials`, `setUserVerified`, `clearCredentials`, `removeAuthenticator`, `disable`) |
| Trace / Web Vitals / heap analysis | `browser_performance_trace`, `browser_performance_metrics`, `browser_heap_capability`, `browser_take_heapsnapshot`, `browser_analyze_heapsnapshot` |
| Advanced DevTools & Service Workers | `browser_lighthouse_audit`, `browser_lighthouse_analyze_audit`, `browser_performance_analyze_insight`, `browser_accessibility_snapshot`, `browser_service_workers` |
| Progressive Web Apps (PWA) | `browser_get_os_app_state`, `browser_install_pwa`, `browser_launch_pwa`, `browser_uninstall_pwa` |
| WebMCP & 3P Developer Tools | `browser_list_webmcp_tools`, `browser_execute_webmcp_tool`, `browser_list_3p_developer_tools`, `browser_execute_3p_developer_tool` |
| Extension lifecycle | `browser_manage_extensions` (`action: "list"\|"setEnabled"\|"toggle"\|"install"\|"reload"\|"triggerAction"\|"uninstall"`) |
| Chrome Recorder flow | `browser_recorder_start/stop/state/replay/measure/export/import/edit/clear` (9 tools: `browser_recorder_start`, `browser_recorder_stop`, `browser_recorder_state`, `browser_recorder_replay`, `browser_recorder_measure`, `browser_recorder_export`, `browser_recorder_import`, `browser_recorder_edit`, `browser_recorder_clear`) |

## Token-efficient observation

Start with the smallest response that answers the question:

```json
{
  "tabId": 123,
  "type": "all",
  "detail": "summary",
  "errorsOnly": true,
  "excludeStatic": true,
  "includePreserved": false,
  "limit": 20
}
```

`browser_get_devtools_data` supports `detail: "summary" | "standard" | "full"`, `errorsOnly`, `excludeStatic`, `filterOrigin`, `includeHeaders`, `includePreserved`, `navigationId`, `msgid`, `limit`, and `clear`. Pass `includePreserved: false` to restrict Console/Network entries to the latest navigation (`navigationId`), or pass `msgid` to inspect a specific Console message's full `args` and stack trace. Use `full` or `includeHeaders` only when drilling into a known failure.

Prefer `browser_snapshot` with a bounded `maxElements` and `waitForSelector` over raw HTML, or pass `includeSnapshot: true` directly on `browser_open_tab`, `browser_navigate`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_upload_file`, `browser_scroll`, `browser_hover`, `browser_drag`, or `browser_press_key` to save a round-trip. Prefer `browser_get_element` with `includeStyles: false`; enable styles only for UI or contrast inspection. Screenshots should use a filesystem `path` (supports `format: "png" | "jpeg" | "webp"` and `quality: 1..100`); request `base64: true` only when the image must remain inline. For large `browser_evaluate` outputs, pass `filePath` so the Go bridge writes the JSON result to disk and returns compact metadata (`savedPath`, `bytes`).

## CDP and capability boundaries

- Synthetic DOM actions do not require CDP and are safer for ordinary pages.
- Use `via: "cdp"` for trusted input, cross-origin frames, canvas, and WebGL. Use `via: "auto"` when a synthetic fallback is acceptable.
- CDP-dependent actions can fail if another debugger is attached. Check `browser_devtools_status` only when the requested operation needs CDP.
- HeapProfiler is not available on ordinary extension-debugger tabs. `browser_take_heapsnapshot` returns `HEAPPROFILER_UNAVAILABLE` and does not save a fake performance-metrics baseline. Use an isolated DevTools context when a real heap snapshot is required.
- Call `browser_heap_capability` first. Ordinary tabs report `supported:false`; isolated negative-tab IDs report real `snapshot`, `baseline`, `diff`, and `collectGarbage` support. Pass `filePath` to `browser_take_heapsnapshot`, then use `browser_analyze_heapsnapshot` for summary/query/retainers/constructor compare.
- Heap baseline/diff is not emulated on ordinary extension-debugger tabs. Treat `HEAPPROFILER_UNAVAILABLE` or protocol `-32601` as an explicit capability boundary; do not interpret runtime metrics as a heap snapshot or leak diff.
- `browser_get_css_styles` is compact by default (`detail: "summary"`). Use `detail: "computed"` with `groups`/`properties`, `detail: "rules"` with `includeInherited`, or `detail: "full"` only when the complete cascade is needed. The response reports direct rules and inherited sources separately.
- Lighthouse uses a bounded runtime budget and resets the private DevTools process after a timeout; a timed-out audit should be retried once only after inspecting the returned error. `browser_accessibility_snapshot` uses a separate path and remains callable after audit recovery.
- Extension-backed snapshot/screenshot and batch capture on `data:` URLs return `DATA_URL_UNSUPPORTED`: Chrome does not inject the Agent Pilot content receiver into a `data:` document. Use HTTP/localhost for those operations; the isolated DevTools runtime can inspect `data:` URLs through CDP.
- Native MP4 screencast, PWA install/launch/uninstall, WebMCP and third-party developer-tool discovery/execution are exposed in both MCP and CLI. Availability of PWA/WebMCP remains dependent on the Chrome build/page APIs.
- Chrome Recorder flows are exposed in both MCP and CLI. The extension records navigation, clicks, input changes, Enter keys and settled viewport scroll positions. Import/export preserves the JSON fields; unsupported iframe/target, viewport and advanced assertion steps fail explicitly on replay. Use `browser_recorder_measure` with a positive Chrome tab ID for trace → replay → trace stop in one call; it returns compact trace data by default and accepts `includeEvents: true` for raw event summaries.

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

For the complete decision table covering CLI/MCP, positive extension tabs,
negative isolated tabs, page-provided tools, capability errors, and token-safe
defaults, read [tool-routing.md](tool-routing.md).
