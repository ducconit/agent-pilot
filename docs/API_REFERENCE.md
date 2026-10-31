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
| `page.click` | `selector?`, `x?`, `y?`, `via?: "synthetic" \| "cdp" \| "auto"`, `tabId?` | ⚙️ Optional | `via: "cdp"` issues trusted click (cross-origin iframe/canvas); `"auto"` falls back to synthetic |
| `page.drag` | `from`/`to` (selector) **or** `fromX/fromY/toX/toY`, `steps?`, `holdMs?`, `via?`, `tabId?` | ⚙️ Optional | Trusted drag for slingshot/aim; `holdMs` holds before release |
| `page.hover` | `selector`, `tabId?` | ⚙️ Auto | Prioritizes CDP `Input.dispatchMouseEvent`, falls back to synthetic |
| `page.pressKey` | `key`, `selector?`, `tabId?` | ⚙️ Auto | Prioritizes CDP `Input.dispatchKeyEvent`, falls back to synthetic |
| `cdp.status` | `tabId?` | ✅ Yes | Returns `{ attached: boolean, error?, hint? }` to verify debugger |
| `cdp.send` | `cdpMethod`, `cdpParams`, `tabId?` | ✅ Yes | Dispatches raw CDP command; returns `CDP_UNAVAILABLE` on failure |

> **CDP-Mandated Methods**: `page.screenshot` (background tabs), `page.uploadFile`, `page.handleDialog`, `emulation.*`, `network.*`, `performance.*`, `memory.*`, `devtools.getData`.<br/>
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
| `set_busy` | `busy: boolean, action?: string` | `{ success: boolean }` | Toggles glowing neon border and agent status indicator |

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
  type(selector: string | null, text: string): Promise<{ success: boolean, textEntered?: string }>;
  scroll(deltaX?: number, deltaY?: number): { success: boolean, scrollX: number, scrollY: number };
  toggleInspector(enabled: boolean): void;
  getElement(selector: string): ElementDetails | null;
  getLockedElement(): ElementDetails | null;
  startRegionCrop(): void;
  pickColor(): Promise<{ hex: string, rgb: string, rgba: string, hsl: string, oklch: string } | null>;
  getCursorPosition(): { x: number, y: number };
  // Agent interaction state
  isBusy(): Promise<boolean>;
  setBusy(busy: boolean, action?: string): Promise<{ success: boolean, isAgentBusy: boolean }>;
  isAgentTab(): Promise<boolean>;
  setAgentTab(enabled: boolean): Promise<boolean>;
  // Feedback channels (Channel B — Shared Inbox, Channel A — Live Push)
  saveFeedbackToInbox(): Promise<any>;
  pushFeedbackToAgent(): Promise<any>;
}
```
