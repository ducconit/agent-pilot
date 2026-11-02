# 📚 Agent Pilot API Reference

Complete specification of message passing actions, data schemas, and the global runtime API of **Agent Pilot**.

---

## 1. Messages Sent to Background Service Worker

Dispatched via `chrome.runtime.sendMessage({ action: "...", ... })`:

### 1.1 Tab Management & Navigation
| Action | Required Parameters | Response | Description |
| :--- | :--- | :--- | :--- |
| `get_active_tab` | None | `{ tab: TabObject }` | Get active tab details |
| `list_tabs` | None | `{ tabs: TabObject[] }` | List all open tabs |
| `new_tab` | `url?: string` | `{ success: true, tab }` | Open new tab with target URL |
| `navigate` | `tabId: number, url: string` | `{ success: true, tab }` | Navigate tab to new URL |
| `reload_tab` | `tabId: number` | `{ success: true }` | Reload target tab |
| `close_tab` | `tabId: number` | `{ success: true }` | Close target tab |

### 1.2 Chrome DevTools Protocol (CDP)
| Action | Required Parameters | Response | Description |
| :--- | :--- | :--- | :--- |
| `attach_debugger` | `tabId: number` | `{ success: boolean, error?: string }` | Attach CDP and enable Console, Network, and Performance domains |
| `detach_debugger` | `tabId: number` | `{ success: true }` | Detach CDP from tab |
| `get_debugger_status` | `tabId: number` | `{ attached: boolean }` | Inspect current CDP connection state |
| `get_devtools_data` | `tabId: number` | `{ console: [], network: [], attached }` | Retrieve buffered console logs and network requests |
| `clear_console` | `tabId: number` | `{ success: true }` | Clear console buffer |
| `clear_network` | `tabId: number` | `{ success: true }` | Clear network request history |
| `get_performance_metrics`| `tabId: number` | `{ success: boolean, metrics: Object }` | Retrieve JS Heap, DOM Node counts, Layout metrics |

### 1.3 Screenshot Capture
| Action | Required Parameters | Response | Description |
| :--- | :--- | :--- | :--- |
| `capture_screenshot` | `mode: "visible"` | `{ success: true, dataUrl: string }` | Capture full visible viewport |
| `capture_screenshot` | `mode: "element" \| "region", tabId, clip: {x, y, width, height}` | `{ success: true, dataUrl, requiresCrop?: boolean, clip }` | Capture and crop to bounding rectangle |

### 1.4 Bridge RPC Methods (WebSocket / HTTP `/api`)

Input methods support engine selection (`via`) and coordinate targeting for Canvas/WebGL:

| Method | Parameters | CDP Required? | Description |
| :--- | :--- | :--- | :--- |
| `tabs.listAll` | None | ❌ No | Lists all open tabs across Chrome windows |
| `tabs.create` | `url?: string, active?: boolean` | ❌ No | Creates a new tab (defaults to background in `🤖 Agent Pilot` group) |
| `tabs.update` | `tabId?: number, url?: string, action?: "url" \| "back" \| "forward" \| "reload"` | ❌ No | Navigates or reloads the target tab |
| `tabs.remove` | `tabId: number` | ❌ No | Closes the target tab |
| `page.click` | `selector?`, `x?`, `y?`, `via?: "synthetic" \| "cdp" \| "auto"`, `tabId?` | ⚙️ Optional | `via: "cdp"` issues trusted click (cross-origin iframe/canvas); `"auto"` falls back to synthetic |
| `page.type` | `selector?`, `text: string`, `clear?: boolean`, `pressEnter?: boolean`, `tabId?` | ❌ No | Types text sequentially into target element |
| `page.scroll` | `deltaX?: number, deltaY?: number`, `tabId?` | ❌ No | Smooth page scrolling horizontally/vertically |
| `page.hover` | `selector?`, `x?`, `y?`, `via?`, `tabId?` | ⚙️ Auto | Prioritizes CDP `Input.dispatchMouseEvent`, falls back to synthetic |
| `page.drag` | `from`/`to` (selector) **or** `fromX/fromY/toX/toY`, `steps?`, `holdMs?`, `via?`, `tabId?` | ⚙️ Optional | Trusted drag for slingshot/aim; `holdMs` holds before release |
| `page.pressKey` | `key: string`, `selector?`, `tabId?` | ⚙️ Auto | Prioritizes CDP `Input.dispatchKeyEvent`, falls back to synthetic |
| `page.fillForm` | `fields: Array<{selector, value}>`, `submitSelector?`, `tabId?` | ❌ No | Fills multiple form inputs in a single round-trip |
| `page.uploadFile`| `files: string[]`, `selector?`, `via?: "auto" \| "cdp"`, `tabId?` | ⚙️ Optional | Sets file inputs via CDP or synthetic event; files restricted to workspace or `/tmp` |
| `page.waitFor` | `selector?`, `text?`, `state?`, `timeoutMs?`, `tabId?` | ❌ No | Waits for selector state or text presence |
| `page.snapshot`| `maxElements?: number, format?: string, includeScreenshot?: boolean`, `tabId?` | ❌ No | Retrieves interactive accessibility and DOM snapshot (supports Set-of-Marks screenshot) |
| `page.screenshot`| `mode?: string, format?: "png" \| "jpeg" \| "webp", path?: string, clip?: Object, annotateInteractive?: boolean, somColor?: string, tabId?` | ⚙️ Background | Captures viewport, element, or full page screenshot (supports Set-of-Marks overlay) |
| `page.getElement`| `selector: string, includeStyles?: boolean`, `tabId?` | ❌ No | Retrieves selector, XPath, geometry, computed dimensions |
| `page.evaluate` | `expression?: string, script?: string, args?: any[], filePath?: string`, `tabId?` | ❌ No | Evaluates JavaScript in MAIN world first with CDP fallback |
| `page.pickColor`| `x?: number, y?: number`, `tabId?` | ❌ No | Samples pixel color across 5 formats (HEX, RGB, RGBA, HSL, OKLCH) |
| `page.handleDialog` | `accept: boolean, promptText?: string`, `tabId?` | ✅ Yes | Handles JavaScript alert, confirm, prompt dialogs |
| `page.setBusy` | `busy: boolean, action?: string`, `tabId?` | ❌ No | Displays neon input-shield and status pill |
| `session.start` | `name?: string`, `tabId?` | ❌ No | Starts continuous visual agent session |
| `session.end` | `closeTab?: boolean`, `tabId?` | ❌ No | Ends active agent session and dismisses shield |
| `emulation.set` | `device?: string, viewport?: Object, userAgent?: string`, `tabId?` | ✅ Yes | Overrides device metrics, viewport, and user agent |
| `emulation.resize` | `width: number, height: number, deviceScaleFactor?: number, mobile?: boolean`, `tabId?` | ✅ Yes | Dynamically resizes page viewport |
| `batch.run` | `actions: Object[], stopOnError?: boolean`, `tabId?` | ⚙️ Per action | Atomic batch execution of multi-step action pipeline |
| `cdp.status` | `tabId?` | ✅ Yes | Returns `{ attached: boolean, error?, hint? }` to verify debugger |
| `cdp.send` | `cdpMethod: string, cdpParams?: Object`, `tabId?` | ✅ Yes | Dispatches raw CDP command; returns `CDP_UNAVAILABLE` on failure |

> **CDP-Mandated Methods**: `page.screenshot` (background tabs), `page.uploadFile` (`via: "cdp"`), `page.handleDialog`, `emulation.*`, `network.*`, `performance.*`, `memory.*`, `devtools.getData`, `lighthouse.*`, `accessibility.*`.<br/>
> Synthetic DOM events **cannot pierce cross-origin iframes** or interact with `<canvas>` / WebGL games.<br/>
> `memory.heapSnapshot` dumps V8 heap snapshots to `.heapsnapshot` files; use MCP tool `browser_analyze_heapsnapshot` to inspect retainers or compare snapshots.

---

## 2. Messages Sent to Content Script (Web Page Context)

Dispatched via `chrome.tabs.sendMessage(tabId, { action: "...", ... })`:

### 2.1 Virtual Mouse & Interaction
| Action | Parameters | Response | Description |
| :--- | :--- | :--- | :--- |
| `virtual_mouse_move` | `x: number, y: number, duration?: number` | `{ x, y }` | Moves virtual cursor smoothly to target coordinates |
| `virtual_mouse_click`| `x?: number, y?: number` | `{ success: boolean, element }` | Triggers ripple animation and full DOM click event cascade |
| `virtual_type` | `selector?: string, text: string` | `{ success: boolean, textEntered }` | Types characters sequentially into form element |
| `virtual_scroll` | `deltaX?: number, deltaY?: number` | `{ success: true, scrollX, scrollY }` | Smooth page scrolling horizontally/vertically |

### 2.2 DOM Inspector & Color Eyedropper
| Action | Parameters | Response | Description |
| :--- | :--- | :--- | :--- |
| `toggle_inspector` | `enabled: boolean` | `{ success: true, active }` | Toggles DOM element inspector overlay |
| `get_element_info` | `selector?: string` | `{ success: boolean, details }` | Retrieves selector, XPath, computed dimensions |
| `start_region_crop`| None | `{ success: true }` | Starts drag-to-select rectangular crop overlay |
| `pick_color` | None | `{ success: boolean, color: {hex, rgb, rgba, hsl, oklch} }` | Activates 11x11 magnifying eyedropper loupe |
| `set_agent_busy` | `busy: boolean, currentAction?: string` | `{ success: boolean, isAgentBusy: boolean, isSessionActive: boolean }` | Toggles glowing neon border and agent status indicator |

---

## 3. Broadcast Events

Dispatched by the Service Worker and Content Scripts to the Side Panel:

| Event Name (`type`) | Payload Schema | Purpose |
| :--- | :--- | :--- |
| `DEBUGGER_STATUS_CHANGED` | `{ tabId: number, attached: boolean }` | CDP connection status changes |
| `DEVTOOLS_CONSOLE_EVENT` | `{ tabId: number, entry: { type, text, timestamp } }` | New console log stream event |
| `DEVTOOLS_NETWORK_EVENT` | `{ tabId: number, request: { id, url, method, status } }` | Network request lifecycle updates |
| `ELEMENT_SELECTED` | `{ details: ElementDetailsObject }` | User selected an element in inspector |
| `COLOR_PICKED` | `{ color: { hex, rgb, rgba, hsl, oklch, timestamp } }` | User sampled a color with eyedropper |
| `REGION_CROP_REQUESTED` | `{ clip: { x, y, width, height } }` | User completed a region crop drag |
| `FEEDBACK_ITEMS_UPDATED` | `{ items: FeedbackItem[] }` | Synchronizes UI annotations across page & Side Panel |

---

## 4. Global API Object `window.__AGENT_PILOT__`

Available in the webpage context for programmatic automation:

> ⚠️ **Error Semantics**: Methods returning a `Promise` **reject with an `Error`** on failure (previously resolved `null`). Only **timeouts** resolve `null`.

```typescript
interface AgentPilotBridge {
  version: string;
  moveMouse(x: number, y: number, duration?: number): Promise<{ x: number, y: number }>;
  click(x?: number, y?: number): Promise<{ success: boolean, element: any }>;
  animateClick(x: number, y: number, selector?: string): Promise<any>;
  type(selector: string | null, text: string, clear?: boolean): Promise<{ success: boolean, textEntered?: string }>;
  scroll(deltaX?: number, deltaY?: number): Promise<{ success: boolean, scrollX: number, scrollY: number }>;
  hover(selector: string): Promise<any>;
  drag(from: string | { x: number, y: number }, to: string | { x: number, y: number }, steps?: number): Promise<any>;
  pressKey(key: string, selector?: string): Promise<any>;
  waitFor(options: any): Promise<any>;
  snapshot(maxElements?: number, format?: string): Promise<any>;
  fillForm(fields: any, submitSelector?: string, pressEnter?: boolean): Promise<any>;
  toggleInspector(enabled: boolean): Promise<{ success: boolean, active: boolean }>;
  isInspectorActive(): Promise<{ active: boolean }>;
  getElement(selector: string, includeStyles?: boolean): Promise<ElementDetails | null>;
  startElementSnap(): Promise<{ success: boolean }>;
  stopElementSnap(): Promise<{ success: boolean }>;
  isElementSnapActive(): Promise<boolean>;
  startRegionCrop(): Promise<{ success: boolean }>;
  getLockedElement(): Promise<ElementDetails | null>;
  pickColor(x?: number, y?: number): Promise<{ success: boolean, color: { hex: string, rgb: string, rgba: string, hsl: string, oklch: string } | null }>;
  stopEyedropper(): Promise<{ success: boolean }>;
  isEyedropperActive(): Promise<{ active: boolean }>;
  getCursorPosition(): Promise<{ x: number, y: number }>;
  // Agent interaction state
  isBusy(): Promise<boolean>;
  isAgentTab(): Promise<boolean>;
  setBusy(busy: boolean, action?: string): Promise<{ success: boolean, isAgentBusy: boolean }>;
  // In-Page Feedback Studio
  startFeedbackStudio(): Promise<{ success: boolean, active: boolean }>;
  stopFeedbackStudio(): Promise<{ success: boolean, active: boolean }>;
  isFeedbackStudioActive(): Promise<boolean>;
  getFeedbackItems(): Promise<FeedbackItem[]>;
  addFeedbackItem(item: FeedbackItem): Promise<any>;
  clearFeedbackItems(): Promise<{ success: boolean }>;
  copyFeedbackPrompt(): Promise<any>;
  generateFeedbackPrompt(items?: FeedbackItem[]): Promise<string>;
}
```

---

## 5. Model Context Protocol (MCP) Tool Catalog (68 Tools)

Agent Pilot exports 68 Model Context Protocol (MCP) tool schemas via stdio (`agent-pilot mcp`) and the schema directory (`mcp/agent-pilot/`). All tools map directly to bridge RPC commands:

| Domain | Tools (Count) | Description |
| :--- | :--- | :--- |
| **Navigation & Tabs** | `browser_open_tab`, `browser_close_tab`, `browser_list_tabs`, `browser_navigate` (4) | Lifecycle management of Chrome tabs inside the `🤖 Agent Pilot` tab group. |
| **Instance & Session** | `browser_list_instances`, `browser_select_instance`, `browser_start_session`, `browser_end_session`, `browser_set_busy` (5) | Multi-browser discovery, instance routing, persistent neon cursor session, and user lock shield. |
| **Page Interaction** | `browser_click`, `browser_type`, `browser_scroll`, `browser_hover`, `browser_drag`, `browser_press_key`, `browser_fill_form`, `browser_upload_file`, `browser_handle_dialog` (9) | Mouse and keyboard automation (synthetic DOM or trusted CDP via `via: "cdp"`), file uploads, and JavaScript dialogs. |
| **Observation & Inspection**| `browser_snapshot`, `browser_screenshot`, `browser_get_element`, `browser_evaluate`, `browser_wait_for`, `browser_pick_color` (6) | DOM/accessibility snapshots, hardware-accelerated screenshots with annotations/spotlight, element geometry, JS execution, and color eyedropper. |
| **Batch Automation** | `browser_run_actions` (1) | Atomic multi-step action pipeline executing multiple actions in one round-trip (saving 80%+ tokens and latency). |
| **Feedback Studio** | `browser_get_pending_feedback`, `browser_wait_for_feedback` (2) | 3-Channel visual UI feedback: retrieve inbox feedback sessions or reactive long-polling. |
| **Emulation & Contexts**| `browser_emulate`, `browser_resize_page`, `browser_create_context`, `browser_list_contexts`, `browser_close_context` (5) | Device/viewport emulation and isolated multi-tenant browser contexts (negative tab IDs). |
| **DevTools & Network** | `browser_devtools_status`, `browser_get_devtools_data`, `browser_list_network_requests`, `browser_get_network_request`, `browser_get_css_styles` (5) | CDP connection health, console/network stream buffers, HTTP response bodies, and computed/cascade CSS inspection. |
| **Performance & Audit** | `browser_performance_metrics`, `browser_performance_trace`, `browser_performance_analyze_insight`, `browser_lighthouse_audit`, `browser_lighthouse_analyze_audit`, `browser_accessibility_snapshot` (6) | Core Web Vitals, timeline traces, trace insight analysis, Lighthouse performance/SEO audits, and full accessibility tree. |
| **Memory & Heap** | `browser_heap_capability`, `browser_take_heapsnapshot`, `browser_analyze_heapsnapshot` (3) | HeapProfiler capability probing, V8 heap snapshots, retainer queries, and constructor diffing. |
| **Screencast & Workers**| `browser_screencast_start`, `browser_screencast_stop`, `browser_service_workers` (3) | Native MP4 screen recording and Service Worker inspection/debugging. |
| **Chrome Recorder** | `browser_recorder_start`, `browser_recorder_stop`, `browser_recorder_state`, `browser_recorder_replay`, `browser_recorder_measure`, `browser_recorder_export`, `browser_recorder_import`, `browser_recorder_edit`, `browser_recorder_clear` (9) | Chrome DevTools Recorder flow capture, replay, performance measurement, export/import, and editing. |
| **Extensions & WebAuthn**| `browser_manage_extensions`, `browser_webauthn` (2) | Chrome extension lifecycle management (install/toggle/reload) and virtual WebAuthn/Passkey credential emulation. |
| **PWA & WebMCP Tools** | `browser_install_pwa`, `browser_launch_pwa`, `browser_uninstall_pwa`, `browser_get_os_app_state`, `browser_list_webmcp_tools`, `browser_execute_webmcp_tool`, `browser_list_3p_developer_tools`, `browser_execute_3p_developer_tool` (8) | Progressive Web App management, in-page WebMCP tool execution, and third-party developer tool integration. |

*(Total: 68 Tools — see [DEVTOOLS.md](DEVTOOLS.md) and `skills/agent-pilot/references/tool-routing.md` for detailed parameter schemas).*
