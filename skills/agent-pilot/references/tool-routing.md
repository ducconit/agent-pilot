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
| Open (`--tab` to reuse tab), navigate (`url`/`back`/`forward`/`reload`), close (`<id1> <id2>...`, `--all`), list tabs | `open`, `navigate`, `close`, `tabs` | `browser_open_tab`, `browser_navigate`, `browser_close_tab`, `browser_list_tabs` | Extension relay; tabs belong to `🤖 Agent Pilot` group; add `includeSnapshot: true` (`--include-snapshot`) to save a round-trip |
| Multi-browser instance discovery & selection | `--instance-id <id>`, `/api/instances` | `browser_list_instances`, `browser_select_instance` | Discovers and routes commands to specific Chrome instances across bridge ports |
| Persistent agent session & visual busy lock | `session start/end/status`, `busy on/off` | `browser_start_session`, `browser_end_session`, `browser_set_busy` | Extension relay; keeps neon cursor and user lock shield continuously visible during complex agent tasks |
| Click (`dblClick`), type, fill form, scroll, hover, drag, key press, wait | `click`, `type`, `fill`, `scroll`, `hover`, `drag`, `key`, `wait` | `browser_click`, `browser_type`, `browser_fill_form`, `browser_scroll`, `browser_hover`, `browser_drag`, `browser_press_key`, `browser_wait_for` | Extension relay; synthetic DOM input by default; add `includeSnapshot: true` to get a fresh snapshot |
| Trusted input, canvas, WebGL, cross-origin iframe | `--via cdp` on `click`/`drag`/`hover`/`upload` | `via: "cdp"` | Extension CDP; fails with `CDP_UNAVAILABLE` if another debugger is attached |
| File upload | `upload` (`--via auto\|cdp`) | `browser_upload_file` | Extension relay / CDP; files restricted to workspace or `/tmp` |
| JavaScript alert/confirm/prompt dialogs | `dialog` (`accept`, `dismiss`, `prompt`) | `browser_handle_dialog` | Extension CDP (`Page.handleJavaScriptDialog`); handles modal JS dialogs |
| Evaluate JS with `@ref`/selector `args` or file I/O | `evaluate` (`--arg`, `--args`, `-f`, `-o`, `--timeout` max `120000`) | `browser_evaluate` (`args`, `sourcePath`, `filePath`, `waitMs`/`sleepMs`, `waitForSelector`, `waitForText`) | Extension relay (`MAIN` world first, CDP fallback); `@ref` and CSS selectors in `args` resolve to live DOM `Element` nodes; `-o`/`filePath` restricted to workspace or `/tmp` |
| Interactive page snapshot & element inspection | `snapshot`, `inspect`, `color` / `pick-color` | `browser_snapshot`, `browser_get_element`, `browser_pick_color` | Extension relay; bounded `maxElements` keeps snapshot small; `browser_get_element` extracts geometry & styles |
| Screenshot (`png`/`jpeg`/`webp`) + text banner & visual annotations | `screenshot` (`--format`, `--quality`, `--step`, `--title`/`-c`, `--desc`, `--caption-pos`, `--highlight`, `--box`) | `browser_screenshot` (`format`, `quality`, `step`, `title`, `description`, `captionPosition`, `highlightSelector`, `boxes`, `clip`) | Extension relay (`OffscreenCanvas` annotation without mutating DOM); background capture requires CDP; save to `path` |
| Atomic multi-step batch automation | `batch flow.json` | `browser_run_actions` (`actions: [...]`, `stopOnError`) | Single atomic network round-trip; saves ~80% context tokens and latency |
| Device emulation & viewport resizing | `emulate`, `resize` | `browser_emulate`, `browser_resize_page` | Extension CDP; overrides device metrics, scale factor, user agent, and viewport size |
| Isolated multi-tenant browser contexts | `devtools context-create/list/close` | `browser_create_context`, `browser_list_contexts`, `browser_close_context` | Isolated DevTools runtime; negative tab IDs prevent state leaks between tests |
| UI Feedback Studio (human visual review) | `feedback list`, `feedback wait` | `browser_get_pending_feedback`, `browser_wait_for_feedback` | Channel B (saved inbox sessions) and Channel A (reactive long-polling for user submission) |
| DevTools debugger connection status | `cdp status` | `browser_devtools_status` | Extension CDP; reports debugger attachment and domain status |
| CSS inspection | `devtools css --tab <positive-id>` | `browser_get_css_styles` | Compact `summary` by default; use `computed`, `rules`, then `full` progressively |
| Console/network summary & `msgid` lookup | `network list` (`--current-nav`, `--nav-id`), `network get` | `browser_get_devtools_data` (`msgid`, `includePreserved`, `navigationId`), `browser_list_network_requests`, `browser_get_network_request` | Extension relay & CDP; filter to latest navigation with `includePreserved: false`; inspect single console message with `msgid` or fetch raw body with `browser_get_network_request` |
| Virtual WebAuthn / Passkey testing | `webauthn` (`enable`, `add`, `credentials`, `verify`, `clear`, `remove`, `disable`) | `browser_webauthn` | Extension CDP (`WebAuthn` domain) on positive Chrome `tabId` |
| Runtime metrics | `metrics` | `browser_performance_metrics` | Extension CDP on ordinary tabs; no heap snapshot is implied |
| Performance trace and insights | `trace`, `devtools trace-insight` | `browser_performance_trace`, `browser_performance_analyze_insight` | Isolated DevTools for the full trace/insight runtime; stop the trace before reading insights |
| Lighthouse audits | `devtools audit`, `audit-details` | `browser_lighthouse_audit`, `browser_lighthouse_analyze_audit` | Isolated DevTools; navigation audits reload the page and can take up to 120s |
| Accessibility tree | `devtools ax` | `browser_accessibility_snapshot` | Isolated DevTools; use the returned backend node ID with CSS inspection |
| Heap snapshot/baseline/diff | `heap capability`, `heap baseline/diff`, `devtools heap-analyze` | `browser_heap_capability`, `browser_take_heapsnapshot`, `browser_analyze_heapsnapshot` | Probe first. Real `.heapsnapshot` requires isolated negative tab and `filePath`; ordinary extension tabs return `HEAPPROFILER_UNAVAILABLE` |
| Native MP4 screencast | `devtools video-start/video-stop` | `browser_screencast_start`, `browser_screencast_stop` | Isolated DevTools and Chrome `Page.startScreenRecording`; older Chrome may return unsupported |
| PWA state/install/launch/uninstall | `devtools pwa-*` with `--params` | `browser_get_os_app_state`, `browser_install_pwa`, `browser_launch_pwa`, `browser_uninstall_pwa` | Browser-scoped PWA CDP domain and a real manifest/app; never extension relay |
| WebMCP tools | `devtools webmcp-list/webmcp-execute` | `browser_list_webmcp_tools`, `browser_execute_webmcp_tool` | Isolated runtime plus page WebMCP API, Chrome flag/origin trial may be required |
| Third-party developer tools | `devtools 3p-list/3p-execute` | `browser_list_3p_developer_tools`, `browser_execute_3p_developer_tool` | Isolated runtime plus page `devtoolstooldiscovery` exposure |
| Service worker debugging | `devtools workers` | `browser_service_workers` | Worker must be running; context workers require `contextId` |
| Chrome Recorder flows | `recorder start/stop/state/replay/measure/export/import/edit/clear` | `browser_recorder_start/stop/state/replay/measure/export/import/edit/clear` (9 tools) | Extension relay and positive tab. Recording covers navigation, clicks, input/change, Enter, and settled viewport scroll; imported iframe/viewport/advanced assertion steps are preserved but rejected when unsupported |

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
