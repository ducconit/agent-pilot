# Agent Pilot tool routing

Use this page to choose the smallest interface and the correct browser
execution path. The CLI and MCP call the same bridge, but they do not expose
the same amount of protocol detail in each response.

## Interface choice

| Situation | Choose | Reason |
| --- | --- | --- |
| Known sequence, CI, shell, or token-sensitive work | CLI `batch` | One process call, compact JSON, deterministic exit status |
| Exploratory browser work from a shell | CLI command with `--format json` | Easy to retry and pipe into scripts |
| Host cannot spawn the binary, needs schemas, or is an IDE MCP client | MCP | Tool validation and conversational lifecycle |
| Known sequence through MCP | `browser_run_actions` | One ordered MCP call instead of many stateful calls |

CLI and MCP are not separate browser implementations. Always pass the exact
bridge `--port`/`--bridge-port` and, when more than one Chrome is connected,
`--instance-id` or `instanceId`.

## Execution paths

| Path | How to identify it | Use it for | Does not provide |
| --- | --- | --- | --- |
| Extension relay | Positive Chrome `tabId`; tab is in the `🤖 Agent Pilot` group | DOM actions, snapshots, normal screenshots, Recorder, synthetic input, compact CSS/network/metrics | Real `HeapProfiler` snapshots on ordinary tabs; content receiver on `data:` URLs |
| Isolated DevTools runtime | Negative tab ID from `contextId`, or an explicit `contextId` | Lighthouse, AX tree, full CSS on isolated tabs, trace insights, native MP4, real heap files, service workers, PWA, WebMCP, third-party page tools | The extension's tab group state and normal extension-only UI state |
| Page-provided tool API | `webmcp-*` or `3p-*` against a page that exposes the API | WebMCP tools and developer tools advertised by the page | Arbitrary Chrome/OS privileges; an undiscovered page tool cannot be executed |

A positive tab ID and a negative isolated tab ID must not be mixed in one
operation. `browser_recorder_measure` is intentionally restricted to a
positive Chrome tab because replay may replace an unusable tab and trace must
remain on the same tab.

## Capability matrix

| Task | CLI | MCP | Path and required conditions |
| --- | --- | --- | --- |
| Open (`--tab` to reuse tab), navigate (`url`/`back`/`forward`/`reload`), close (`<id1> <id2>...`, `--all`), click (`dblClick`), type, fill, scroll, wait | `open`, `navigate`, `close`, `click`, `type`, `fill`, `scroll`, `wait` | `browser_open_tab`, `browser_navigate`, `browser_close_tab`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_scroll`, `browser_wait_for` | Extension relay; use synthetic input by default; add `includeSnapshot: true` (`--include-snapshot`) to get a snapshot in the same round-trip |
| Evaluate JS with `@ref`/selector `args` or file I/O | `evaluate` (`--arg`, `--args`, `-f`, `-o`, `--timeout` max `120000`) | `browser_evaluate` (`args`, `sourcePath`, `filePath`, `timeout`) | Extension relay (`MAIN` world first, CDP fallback); `@ref` and CSS selectors in `args` resolve to live DOM `Element` nodes; `-o`/`filePath` restricted to workspace or `/tmp` |
| Interactive page snapshot | `snapshot` | `browser_snapshot` | Extension relay; bounded `maxElements` keeps output small |
| Trusted input, canvas, WebGL, cross-origin iframe | `--via cdp` on `click`/`drag`/upload where supported | `via: "cdp"` | Extension CDP; fails with `CDP_UNAVAILABLE` if another debugger is attached |
| Screenshot (`png`/`jpeg`/`webp`) + text banner & highlight box | `screenshot` (`--format`, `--quality`, `--step`, `--title`/`-c`, `--desc`, `--caption-pos`, `--highlight`) | `browser_screenshot` (`format`, `quality`, `step`, `title`, `description`, `captionPosition`, `highlightSelector`, `highlightBox`) | Extension relay (`OffscreenCanvas` annotation without mutating DOM); background capture requires CDP; save to `path` |
| CSS | `devtools css --tab <positive-id>` | `browser_get_css_styles` | Compact `summary` by default; use `computed`, `rules`, then `full` progressively |
| Console/network summary & `msgid` lookup | `network list` (`--current-nav`, `--nav-id`) | `browser_get_devtools_data` (`msgid`, `includePreserved`, `navigationId`), `browser_list_network_requests` | Extension relay; filter to latest navigation with `includePreserved: false`; inspect single console message with `msgid` |
| Virtual WebAuthn / Passkey testing | `webauthn` (`enable`, `add`, `credentials`, `verify`, `clear`, `remove`, `disable`) | `browser_webauthn` | Extension CDP (`WebAuthn` domain) on positive Chrome `tabId` |
| Network body/artifact | `network get` / DevTools detail | `browser_get_network_request` | CDP; pass file paths when an artifact is required |
| Runtime metrics | `metrics` | `browser_performance_metrics` | Extension CDP on ordinary tabs; no heap snapshot is implied |
| Performance trace and insights | `trace`, `devtools trace-insight` | `browser_performance_trace`, `browser_performance_analyze_insight` | Isolated DevTools for the full trace/insight runtime; stop the trace before reading insights |
| Lighthouse | `devtools audit`, `audit-details` | `browser_lighthouse_audit`, `browser_lighthouse_analyze_audit` | Isolated DevTools; navigation audits reload the page and can take up to 120s |
| Accessibility tree | `devtools ax` | `browser_accessibility_snapshot` | Isolated DevTools; use the returned backend node ID with CSS inspection |
| Heap snapshot/baseline/diff | `heap capability`, `heap baseline/diff`, `devtools heap-analyze` | `browser_heap_capability`, `browser_take_heapsnapshot`, `browser_analyze_heapsnapshot` | Probe first. Real `.heapsnapshot` requires isolated negative tab and `filePath`; ordinary extension tabs return `HEAPPROFILER_UNAVAILABLE` |
| Native MP4 | `devtools video-start/video-stop` | `browser_screencast_start/stop` | Isolated DevTools and Chrome `Page.startScreenRecording`; older Chrome may return unsupported |
| PWA state/install/launch/uninstall | `devtools pwa-*` with `--params` | `browser_get_os_app_state`, `browser_install_pwa`, `browser_launch_pwa`, `browser_uninstall_pwa` | Browser-scoped PWA CDP domain and a real manifest/app; never extension relay |
| WebMCP | `devtools webmcp-list/webmcp-execute` | `browser_list_webmcp_tools`, `browser_execute_webmcp_tool` | Isolated runtime plus page WebMCP API, Chrome flag/origin trial may be required |
| Third-party developer tools | `devtools 3p-list/3p-execute` | `browser_list_3p_developer_tools`, `browser_execute_3p_developer_tool` | Isolated runtime plus page `devtoolstooldiscovery` exposure |
| Service worker debugging | `devtools workers` | `browser_service_workers` | Worker must be running; context workers require `contextId` |
| Chrome Recorder | `recorder start/stop/state/replay/measure/export/import/edit/clear` | `browser_recorder_*` | Extension relay and positive tab. Recording covers navigation, clicks, input/change, Enter, and settled viewport scroll; imported iframe/viewport/advanced assertion steps are preserved but rejected when unsupported |

## Error and fallback rules

| Error | Meaning | Correct next action |
| --- | --- | --- |
| `DATA_URL_UNSUPPORTED` | Extension content receiver cannot be injected into a `data:` page | Serve the page over localhost/HTTP, or use isolated DevTools CDP |
| `HEAPPROFILER_UNAVAILABLE` or protocol `-32601` | This target cannot provide a real heap snapshot | Stop; do not create a metrics baseline. Use `heap capability`, then an isolated context |
| `CDP_UNAVAILABLE` | The extension debugger cannot attach | Close DevTools/other debugger, check policy, or use synthetic input where it is valid |
| `WEBMCP_UNAVAILABLE` | The page/runtime does not expose WebMCP | Enable the Chrome experiment/origin trial or use a page that registers tools |
| `PWA_PROTOCOL_UNAVAILABLE` | Chrome lacks the browser-scoped PWA domain | Use a compatible Chrome build; do not retry through the extension relay |
| `UNSUPPORTED_EXTENSION_API` | Chrome Extensions CDP domain or target shape is unavailable | Check Chrome version and unpacked/policy-controlled extension state |

An explicit CLI Recorder result with `success:false` exits nonzero while
preserving its JSON. MCP Recorder failures set `isError:true`; inspect the
structured payload before retrying.

## Token and concurrency defaults

- Verify `/health` once per workflow and pin the port, instance, and returned
  tab ID. Do not repeatedly rediscover the active tab.
- Prefer one ordered CLI batch or MCP `browser_run_actions` call for a known
  sequence. Do not run stateful `screenshot`, `close`, Recorder, or trace calls
  concurrently.
- Start DevTools responses with `summary`, `errorsOnly`, `excludeStatic`, a
  bounded `limit`, and CSS `detail: "summary"`. Request full headers,
  declarations, computed properties, trace events, or heap rows only in a
  follow-up.
- Save screenshots, MP4, traces, and heap snapshots to files. Return paths and
  compact summaries instead of base64 or raw graphs.
- With two Chrome processes, use one bridge port per process. With multiple
  windows in one process, keep the same `instanceId` and pass explicit tab IDs;
  never rely on the focused window.

## Minimal examples

```bash
# Ordinary DOM work through the extension relay
agent-pilot open http://127.0.0.1:3000 --port 58766 --instance-id browser_...
agent-pilot batch flow.json --port 58766 --instance-id browser_... --format json

# Real heap work through an isolated context
agent-pilot devtools context-create --params '{"name":"heap-test"}'
agent-pilot heap capability --tab -123
agent-pilot heap baseline --tab -123 --file /tmp/base.heapsnapshot
agent-pilot heap diff --tab -123 --file /tmp/current.heapsnapshot
agent-pilot devtools heap-analyze --params '{"action":"compare","baseFilePath":"/tmp/base.heapsnapshot","currentFilePath":"/tmp/current.heapsnapshot"}'

# Page-provided tools
agent-pilot devtools webmcp-list --tab -123
agent-pilot devtools 3p-list --tab -123
```
