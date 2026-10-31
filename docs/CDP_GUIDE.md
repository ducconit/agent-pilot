# ⚡ Chrome DevTools Protocol (CDP) Guide in Agent Pilot

The **Chrome DevTools Protocol (CDP)** provides low-level communication directly with the Chromium engine. In **Agent Pilot**, CDP is harnessed via the standard Manifest V3 `chrome.debugger` API.

---

## 1. Attachment Lifecycle

To initiate monitoring or issue trusted low-level commands, the Service Worker attaches to the target tab:

```javascript
// Attach CDP connection to specified tab (Protocol version 1.3)
chrome.debugger.attach({ tabId }, "1.3", async () => {
  if (chrome.runtime.lastError) {
    console.error("CDP attach failed:", chrome.runtime.lastError.message);
    return;
  }
  
  // Enable required DevTools domains
  await sendCdpCommand(tabId, "Console.enable");
  await sendCdpCommand(tabId, "Runtime.enable");
  await sendCdpCommand(tabId, "Network.enable");
  await sendCdpCommand(tabId, "Performance.enable");
  await sendCdpCommand(tabId, "Page.enable");
});
```

> [!NOTE]
> **Google Chrome Infobar**: When an extension attaches a debugger to any tab, Chromium automatically displays a yellow infobar at the top: `"Agent Pilot is debugging this browser"`. This is Chromium's required security notice ensuring users are aware of active browser automation.

---

## 2. Exploited DevTools Domains

### 2.1 Console & Runtime Domain (Log & Exception Interception)
CDP captures all `console.log`, `console.warn`, `console.error` calls and uncaught exceptions:

- **Event Listeners**:
  ```javascript
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method === "Runtime.consoleAPICalled") {
      // params.type: "log" | "warn" | "error" | "info" | "table"
      // params.args: List of argument objects
      // params.stackTrace: Call stack trace at log location
    } else if (method === "Console.messageAdded") {
      // params.message.level: Log level
      // params.message.text: Message content
      // params.message.url: Source file URL
    }
  });
  ```

### 2.2 Network Domain (Traffic & API Inspection)
Tracks full HTTP/HTTPS request lifecycles:

1. `Network.requestWillBeSent`: Request dispatch initiated (URL, Method, Initial Headers, Resource Type).
2. `Network.responseReceived`: Server response received (HTTP Status, Status Text, Headers, MIME type).
3. `Network.loadingFinished`: Data transfer completed (total byte size).
4. `Network.loadingFailed`: Request blocked by CORS, network drop, or DNS failure.

### 2.3 Performance Domain (Metrics & Memory Telemetry)
Provides Blink and V8 internal engine telemetry:

```javascript
const res = await sendCdpCommand(tabId, "Performance.getMetrics");
// Returns:
// - JSHeapUsedSize: Actual V8 memory in use
// - JSHeapTotalSize: Total allocated V8 heap
// - Nodes: Current DOM node count
// - LayoutCount: Cumulative layout recalculations
// - RecalcStyleCount: Cumulative CSS style calculations
```

### 2.4 Input Domain (Trusted System-Level Mouse & Keyboard)
Beyond synthetic DOM events, Agent Pilot dispatches events directly into the browser engine via CDP Input Domain. CDP input produces **trusted events** (`isTrusted: true`), enabling interaction with **cross-origin iframes, `<canvas>`, and WebGL applications** (Unity games, Playables) where synthetic events cannot pierce security boundaries.

Standard helpers in `extensions/background/cdp-manager.js`:

```javascript
// Trusted click: move -> press -> release
await dispatchCdpMouseClick(tabId, x, y, { button: "left", clickCount: 1 });

// Trusted drag: press -> multi-step interpolation -> hold -> release
// Ideal for slingshot aiming or canvas dragging
await dispatchCdpMouseDrag(tabId, fromX, fromY, toX, toY, { steps: 10, holdMs: 800 });
```

Raw CDP example via `Input.dispatchMouseEvent`:

```javascript
await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
  type: "mouseMoved",
  x: 250,
  y: 180
});
await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
  type: "mousePressed",
  x: 250,
  y: 180,
  button: "left",
  buttons: 1,
  clickCount: 1
});
await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
  type: "mouseReleased",
  x: 250,
  y: 180,
  button: "left",
  buttons: 0,
  clickCount: 1
});
```

> [!IMPORTANT]
> **When is CDP Input Required?** Normal DOM pages use synthetic events by default. For **cross-origin iframes, `<canvas>`, and WebGL games**, synthetic events cannot cross the origin boundary, making CDP Input required.
> - CLI commands: `agent-pilot click -x 733 -y 668 --via cdp --tab <id>` and `agent-pilot drag --from-x 745 --from-y 490 --to-x 745 --to-y 832 --steps 10 --hold 800 --via cdp --tab <id>`.
> - Engine flags: `--via synthetic` (default) · `--via cdp` (trusted, no fallback) · `--via auto` (tries CDP, falls back to synthetic).
> - Diagnostic check: `agent-pilot cdp status --tab <id>`.

> [!NOTE]
> **Visual Feedback**: The neon cursor and ripple animations are rendered exclusively by the **synthetic engine**. CDP input dispatches native system-level events and does not render virtual cursor overlays.

### 2.5 Page Domain (Pixel-Accurate Screen Capture)
Captures screenshots cropped precisely to viewport coordinates:

```javascript
const res = await sendCdpCommand(tabId, "Page.captureScreenshot", {
  format: "png",
  clip: {
    x: elementRect.x,
    y: elementRect.y,
    width: elementRect.width,
    height: elementRect.height,
    scale: 1
  }
});
// res.data contains complete Base64-encoded PNG
```
