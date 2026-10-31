# Advanced DevTools & Diagnostics

The release package ships as a self-contained MCP binary. Target machines only require Chrome, the extension, and the corresponding OS binary. There is zero need to install Node.js, npm, FFmpeg, run dependency installers, or open remote debugging ports. You can point your MCP configuration directly to the unpacked binary; background service installation is optional.

The runtime and pinned libraries are embedded inside the binary. On first invocation of advanced capabilities, the server extracts them to an isolated application cache directory and self-starts. No network downloads or external installations occur. Basic extension operations continue running directly; the advanced runtime spins up only when requested.

## DevTools Capabilities & Tools

| Tool | Capability |
| --- | --- |
| `browser_get_css_styles` | Matched rules, inline/inherited styles, specificity, `!important`, layers, media/supports/container/scope queries, source file positions, computed styles; paginated. |
| `browser_lighthouse_audit` | Real Lighthouse audits on the current tab; scores, failed audits, related DOM nodes, HTML/JSON reports. |
| `browser_lighthouse_analyze_audit` | Deep dive into specific audits by `auditId`: descriptions, root causes, suggestions, item tables, and affected DOM nodes; can re-read JSON reports across restarts. |
| `browser_performance_analyze_insight` | Analyzes performance using the DevTools trace engine: lists insight sets and drills into LCP breakdowns, CLS, render-blocking resources, and trace events. |
| `browser_screencast_start`, `browser_screencast_stop` | Records MP4 screencasts using Chrome's internal video encoder, returning file paths upon completion. |
| `browser_create_context`, `browser_list_contexts`, `browser_close_context` | True isolated browser contexts with independent cookies, localStorage, IndexedDB, and service workers. |
| `browser_service_workers` | Lists active service workers, performs async evaluation, reads console logs/errors, sends CDP debugger commands, and detaches. |
| `browser_accessibility_snapshot` | True Chrome accessibility tree, roles, accessible names, states, and backend DOM node IDs. |
| `browser_devtools_status` | Inspects embedded runtime version and status without requiring Node on the system `PATH`. |
| `browser_analyze_heapsnapshot` | Analyzes V8 `.heapsnapshot` files: constructor summaries, class nodes/details, retainers/retaining paths, dominator chains, duplicate strings, and memory diffing between two snapshots. |
| `browser_list_3p_developer_tools`, `browser_execute_3p_developer_tool` | Discovers and invokes developer tools exposed by pages via `devtoolstooldiscovery` events without escalating browser permissions. |
| `browser_list_webmcp_tools`, `browser_execute_webmcp_tool` | Discovers and executes WebMCP tools exposed by pages via Puppeteer WebMCP runtime. |
| `browser_get_os_app_state`, `browser_install_pwa`, `browser_launch_pwa`, `browser_uninstall_pwa` | Inspects and manages PWAs via browser-scoped `PWA.*` CDP domain. |
| `browser_get_network_request` | Retrieves request/response bodies, including POST payloads, and exports exchanges to `.network-request`/`.network-response` files. |
| `browser_recorder_*` | Records, replays, edits, measures performance, and exports/imports Chrome DevTools Recorder JSON flows. |

Extension management via `browser_manage_extensions` supports `list`, `setEnabled`, `toggle`, `install`, `reload`, `triggerAction`, and `uninstall`.

`browser_performance_trace` captures full raw traces (`.json`/`.json.gz`) without 2,000-event caps. Completed traces return `traceId`, file path, and insight sets, which can be re-opened directly in Chrome DevTools.

## MCP Usage Examples

```json
{"tool":"browser_get_css_styles","arguments":{"tabId":123,"selector":"#submit","pageSize":10}}
{"tool":"browser_lighthouse_audit","arguments":{"tabId":123,"mode":"snapshot"}}
{"tool":"browser_lighthouse_analyze_audit","arguments":{"reportId":"<reportId>","auditId":"color-contrast","pageSize":20}}
{"tool":"browser_performance_trace","arguments":{"tabId":123,"action":"start","reload":true}}
{"tool":"browser_performance_trace","arguments":{"tabId":123,"action":"stop","filePath":"/absolute/path/trace.json.gz"}}
{"tool":"browser_performance_analyze_insight","arguments":{"traceId":"<traceId>","insightSetId":"<id from trace>","insightName":"LCPBreakdown"}}
{"tool":"browser_screencast_start","arguments":{"tabId":123,"filePath":"/absolute/path/demo.mp4"}}
{"tool":"browser_screencast_stop","arguments":{"tabId":123}}
{"tool":"browser_recorder_start","arguments":{"tabId":123,"title":"Checkout flow"}}
{"tool":"browser_recorder_export","arguments":{"tabId":123}}
{"tool":"browser_recorder_replay","arguments":{"tabId":123}}
{"tool":"browser_recorder_measure","arguments":{"tabId":123}}
{"tool":"browser_analyze_heapsnapshot","arguments":{"action":"compare","baseFilePath":"/tmp/before.heapsnapshot","currentFilePath":"/tmp/after.heapsnapshot"}}
```

## Environment Emulation

`browser_emulate` configures CPU throttling, network throttling (offline/3G/4G/custom speeds), dark/light theme, reduced motion, forced colors, geolocation, user agent/client hints, custom HTTP headers, locale, timezone, and viewport/mobile/touch/landscape/DPR:

```json
{
  "tool": "browser_emulate",
  "arguments": {
    "tabId": 123,
    "networkConditions": "slow-4g",
    "prefersReducedMotion": "reduce",
    "prefersContrast": "more",
    "geolocation": { "latitude": 37.7749, "longitude": -122.4194, "accuracy": 10 },
    "timezoneId": "America/Los_Angeles",
    "locale": "en-US",
    "viewport": { "width": 390, "height": 844, "deviceScaleFactor": 3, "mobile": true, "touch": true },
    "extraHttpHeaders": { "X-Test-Run": "mobile" }
  }
}
```

## Isolated Browser Contexts

Isolated contexts run in dedicated Chrome instances spawned via pipes by the server, completely segregated from personal profiles. Each context maintains independent cookies, localStorage, IndexedDB, cache, and service workers:

```json
{"tool":"browser_create_context","arguments":{"name":"account-a"}}
{"tool":"browser_open_tab","arguments":{"url":"https://example.com/login","contextId":"<contextId>"}}
{"tool":"browser_create_context","arguments":{"name":"account-b"}}
{"tool":"browser_open_tab","arguments":{"url":"https://example.com/login","contextId":"<other-contextId>"}}
{"tool":"browser_close_context","arguments":{"contextId":"<contextId>"}}
```

## CLI Commands

CLI commands share parameter schemas with MCP tools:

```bash
agent-pilot devtools status
agent-pilot devtools css --tab 123 --params '{"selector":"#submit"}'
agent-pilot devtools audit --tab 123 --params '{"mode":"snapshot"}'
agent-pilot devtools audit-details --params '{"filePath":"/path/report.json","auditId":"image-alt"}'
agent-pilot devtools video-start --tab 123
agent-pilot devtools video-stop --tab 123
agent-pilot recorder start --tab 123 --title "Checkout flow"
agent-pilot recorder export --tab 123 --format json > checkout.recorder.json
agent-pilot recorder replay --file checkout.recorder.json --tab 123 --format json
agent-pilot devtools context-create --params '{"name":"account-a"}'
agent-pilot devtools workers --params '{"action":"list"}'
```

Multi-step start/stop commands require the same running bridge/MCP server to preserve state, exactly like standard MCP sessions.

Recorder uses `chrome.storage` to restore flows across service worker wakeups. `browser_recorder_measure` requires a positive Chrome tab ID and reports `failurePhase` if trace/replay errors occur or replay transitions across tabs; it omits `eventsSummary` by default to reduce payload size (`includeEvents: true` to receive complete events). Import/export preserves Chrome Recorder metadata, but replaying on extension tabs rejects unsupported steps (such as cross-origin iframes, alternate targets, and custom assertions) rather than reporting false successes.

## For Builders

Only the build machine requires Go and Node to run `npm ci` followed by `npm run build:cli`. The build script downloads a pinned Node distribution, verifies its SHA-256 checksum, bundles runtime dependencies, and embeds the archive into the Go binary. `npm run pack:bundle` executes this step for each target OS/architecture. Running `go build` directly without preparing the embedded payload produces a developer binary with basic functionality only; do not use raw builds for production release.

The embedded runtime contains Node/Lighthouse/Puppeteer code, licenses, and dependencies; end users do not need to install them separately. The Go bridge itself builds with `CGO_ENABLED=0`, while the embedded Chrome/Node runtime targets the respective operating system platform.
