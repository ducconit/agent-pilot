---
name: agent-pilot
description: Control browser tabs and web applications through Agent Pilot using either its standalone CLI or MCP tools. Use for browser automation, web testing, screenshots, DOM inspection, DevTools diagnostics, and extension lifecycle tasks.
---

# Agent Pilot

Agent Pilot is a browser automation bridge backed by a Chrome MV3 extension. It provides two equivalent interfaces over the same bridge:

- [CLI workflow](references/cli.md) — shell scripts, CI, deterministic local automation, and environments without an MCP client.
- [MCP workflow](references/mcp.md) — conversational agents and IDE integrations.

Load only the interface reference needed for the current task. The detailed command reference remains available at [cli-usage.md](references/cli-usage.md); setup and bridge internals are in [setup.md](references/setup.md) and [architecture-and-server.md](references/architecture-and-server.md).

## Core safety rules

1. Agent Pilot only controls tabs in the `🤖 Agent Pilot` Chrome tab group. If there is no controlled tab, open one first; an empty `browser_list_tabs` result is expected in that state.
2. Capture the `tabId` returned by `open`/`browser_open_tab` and pass it explicitly to later operations. This prevents cross-agent tab hijacking.
3. Close tabs created for a test when finished. Use CLI `close`, MCP `browser_close_tab`, or a final `close` batch action.
4. Use extension `reload` to reload an unpacked extension. Do not disable/enable it as a reload workaround because that can drop the bridge connection.
5. Synthetic DOM input is the default. Use CDP only for trusted input, cross-origin iframes, canvas/WebGL, background screenshots, tracing, metrics, heap, and other CDP-only operations.

## Token-efficient default

Prefer one batch over a chain of individual calls:

```text
open → wait_for_selector → fill/click → devtools summary → screenshot → close
```

For diagnostics, start with compact output (`detail: "summary"`, `errorsOnly: true`, `excludeStatic: true`) and request full data only for a follow-up investigation. Use snapshots or targeted element inspection instead of dumping raw HTML. Save screenshots to disk and return paths instead of base64 unless inline image data is required.

## Bridge

The bridge listens on loopback. The default port is `58765`; deployments may override it with `AGENT_PILOT_PORT` or the extension setting. Multiple clients share the first bridge through forwarder mode, so a second client should reuse the active bridge instead of starting another one.

## Capability notes

- HeapProfiler may be unavailable through Chrome's extension debugger. Heap actions can return `supported: false` with a performance-metrics fallback; do not retry blindly.
- CDP can be temporarily unavailable when another debugger is attached. Prefer synthetic actions where possible and inspect `cdp.status`/`browser_devtools_status` only when a CDP operation is actually needed.
- The generated MCP schemas under `mcp/agent-pilot/` are the source of truth for current tool names and parameters; do not rely on an old provider schema or a stale tool-count claim.

## References

- [CLI interface and efficient command patterns](references/cli.md)
- [MCP interface, batch actions, and compact DevTools queries](references/mcp.md)
- [Full CLI command reference](references/cli-usage.md)
- [Setup and troubleshooting](references/setup.md)
- [Architecture, bridge, REST, and concurrency](references/architecture-and-server.md)
- [Batch automation example](examples/batch-flow-example.json)
