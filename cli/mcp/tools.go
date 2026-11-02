// mcp_tools.go contains the static MCP tool registry: the ToolInfo shape and
// the full mcpTools list advertised to MCP clients. This is pure data so it is
// kept separate from the JSON-RPC plumbing in mcp.go and the bridge translation
// in mcp_dispatch.go.

package mcp

type ToolInfo struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"inputSchema"`
}

var mcpTools = []ToolInfo{
	{
		Name:        "browser_run_actions",
		Description: "Execute an ordered sequence of browser actions in a single tool call (open, navigate, wait with failure snapshot diagnostics, click, type, fill_form, upload, screenshot with step/title/description/highlightSelector & disk path, evaluate, devtools with detail summary/standard/full, metrics/performance_metrics, trace/performance_trace, heap/heap_snapshot, close).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"actions": map[string]interface{}{
					"type":        "array",
					"description": "List of action objects to execute sequentially. Each item uses type or action plus operation-specific fields.",
					"items": map[string]interface{}{
						"type":                 "object",
						"description":          "Browser action object, e.g. {type: 'click', selector: '#submit'} or {type: 'performance_trace', action: 'start'}",
						"additionalProperties": true,
						"properties": map[string]interface{}{
							"type":   map[string]interface{}{"type": "string", "description": "Action type or alias"},
							"action": map[string]interface{}{"type": "string", "description": "Action type alias or operation such as start/stop"},
						},
					},
				},
				"tabId": map[string]interface{}{
					"type":        "integer",
					"description": "Target tab ID",
				},
				"stopOnError": map[string]interface{}{
					"type":        "boolean",
					"description": "Stop execution if any step fails (default: true)",
				},
				"omitDataUrls": map[string]interface{}{
					"type":        "boolean",
					"description": "Omit raw Base64 data from screenshot steps to prevent memory bloat",
				},
			},
			"required": []string{"actions"},
		},
	},
	{
		Name:        "browser_open_tab",
		Description: "Open a new browser tab (automatically creates a new browser window if none exists, and waits for page load completion by default). Defaults to active: false to never interrupt user focus.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"url":                map[string]interface{}{"type": "string", "description": "URL to load"},
				"username":           map[string]interface{}{"type": "string", "description": "Optional HTTP Basic Auth username (automatically URL-encoded into the target URL)"},
				"password":           map[string]interface{}{"type": "string", "description": "Optional HTTP Basic Auth password (automatically URL-encoded into the target URL, safe for special characters like && or #)"},
				"active":             map[string]interface{}{"type": "boolean", "description": "Make tab active (default: false)"},
				"initScript":         map[string]interface{}{"type": "string", "description": "Optional JavaScript registered via Page.addScriptToEvaluateOnNewDocument for navigations in this tab"},
				"handleBeforeUnload": map[string]interface{}{"type": "string", "enum": []string{"accept", "decline"}, "description": "Automatically accept or decline beforeunload confirmation dialogs on this tab"},
				"includeSnapshot":    map[string]interface{}{"type": "boolean", "description": "Capture and return an interactive page snapshot after opening the tab (default: false)"},
				"waitUntil":          map[string]interface{}{"type": "boolean", "description": "Wait for tab load completion before returning (default: true)"},
				"waitMs":             map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep after opening tab (saves a separate wait call)"},
				"sleepMs":            map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep after opening tab"},
				"waitForSelector":    map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for after opening tab"},
				"waitForText":        map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page after opening tab"},
			},
			"required": []string{"url"},
		},
	},
	{
		Name:        "browser_close_tab",
		Description: "Close a tab belonging to the Agent Pilot tab group to free RAM after testing is complete.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"tabId": map[string]interface{}{"type": "integer", "description": "Target tab ID in the Agent Pilot group (defaults to last agent-controlled tab)"},
			},
		},
	},
	{
		Name:        "browser_list_tabs",
		Description: "List open tabs managed by Agent Pilot (inside the '🤖 Agent Pilot' tab group). Personal user tabs outside this group are isolated to prevent focus theft — call browser_open_tab to open a new Agent Pilot tab if empty.",
		InputSchema: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
	},
	{
		Name:        "browser_navigate",
		Description: "Navigate the active or specified tab to a new URL, or perform history/reload actions ('back', 'forward', 'reload'). Supports initScript, ignoreCache, handleBeforeUnload, and includeSnapshot.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"url":                map[string]interface{}{"type": "string", "description": "Destination URL (required when action is 'url' or omitted)"},
				"action":             map[string]interface{}{"type": "string", "enum": []string{"url", "back", "forward", "reload"}, "description": "Navigation operation: 'url' (default), 'back', 'forward', or 'reload'"},
				"ignoreCache":        map[string]interface{}{"type": "boolean", "description": "Bypass browser cache when action is 'reload' (default: false)"},
				"initScript":         map[string]interface{}{"type": "string", "description": "Optional JavaScript registered via Page.addScriptToEvaluateOnNewDocument before navigating"},
				"handleBeforeUnload": map[string]interface{}{"type": "string", "enum": []string{"accept", "decline"}, "description": "Automatically accept or decline beforeunload confirmation dialogs during navigation"},
				"includeSnapshot":    map[string]interface{}{"type": "boolean", "description": "Capture and return an interactive page snapshot after navigation completes (default: false)"},
				"username":           map[string]interface{}{"type": "string", "description": "Optional HTTP Basic Auth username (automatically URL-encoded into the destination URL)"},
				"password":           map[string]interface{}{"type": "string", "description": "Optional HTTP Basic Auth password (automatically URL-encoded into the destination URL)"},
				"tabId":              map[string]interface{}{"type": "integer", "description": "Tab ID to navigate"},
				"waitUntil":          map[string]interface{}{"type": "boolean", "description": "Wait for tab load completion before returning (default: true)"},
				"waitMs":             map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep after navigation"},
				"sleepMs":            map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep after navigation"},
				"waitForSelector":    map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for after navigation"},
				"waitForText":        map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page after navigation"},
			},
		},
	},
	{
		Name:        "browser_click",
		Description: "Click (or double-click with dblClick: true) with the virtual mouse (visual cursor). Accepts CSS selector/@ref or direct (x, y) coordinates. Supports inline post-click waitMs/waitForSelector/waitForText and includeSnapshot.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector":        map[string]interface{}{"type": "string", "description": "CSS selector or @ref to click"},
				"x":               map[string]interface{}{"type": "number", "description": "X coordinate in viewport pixels"},
				"y":               map[string]interface{}{"type": "number", "description": "Y coordinate in viewport pixels"},
				"dblClick":        map[string]interface{}{"type": "boolean", "description": "Perform a double-click (dispatches click + dblclick events; default: false)"},
				"clickCount":      map[string]interface{}{"type": "integer", "description": "Click count (1 for single click, 2 for double click)"},
				"button":          map[string]interface{}{"type": "string", "enum": []string{"left", "right", "middle"}, "description": "Mouse button (default: 'left')"},
				"via":             map[string]interface{}{"type": "string", "description": "Input backend: synthetic (default), cdp (trusted), auto (cdp with synthetic fallback)"},
				"includeSnapshot": map[string]interface{}{"type": "boolean", "description": "Capture and return an interactive page snapshot after clicking (default: false)"},
				"tabId":           map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"waitMs":          map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep after clicking (saves a separate wait call)"},
				"sleepMs":         map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep after clicking"},
				"waitForSelector": map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for after clicking"},
				"waitForText":     map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page after clicking"},
			},
		},
	},
	{
		Name:        "browser_type",
		Description: "Type text into an input or textarea with realistic human keystroke intervals. Supports inline post-type waitMs/waitForSelector/waitForText and includeSnapshot.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector":        map[string]interface{}{"type": "string", "description": "CSS selector of input (optional; defaults to focused active element or cursor position)"},
				"text":            map[string]interface{}{"type": "string", "description": "Text to type"},
				"clear":           map[string]interface{}{"type": "boolean", "description": "Clear field first"},
				"pressEnter":      map[string]interface{}{"type": "boolean", "description": "Press Enter after typing"},
				"includeSnapshot": map[string]interface{}{"type": "boolean", "description": "Capture and return an interactive page snapshot after typing (default: false)"},
				"tabId":           map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"waitMs":          map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep after typing"},
				"sleepMs":         map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep after typing"},
				"waitForSelector": map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for after typing"},
				"waitForText":     map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page after typing"},
			},
			"required": []string{"text"},
		},
	},
	{
		Name:        "browser_scroll",
		Description: "Scroll viewport or active element smoothly by deltaX and deltaY pixels. Supports inline post-scroll waitMs/waitForSelector/waitForText and includeSnapshot.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"deltaX":          map[string]interface{}{"type": "number", "description": "Horizontal scroll offset"},
				"deltaY":          map[string]interface{}{"type": "number", "description": "Vertical scroll offset"},
				"includeSnapshot": map[string]interface{}{"type": "boolean", "description": "Capture and return an interactive page snapshot after scrolling (default: false)"},
				"tabId":           map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"waitMs":          map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep after scrolling"},
				"sleepMs":         map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep after scrolling"},
				"waitForSelector": map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for after scrolling"},
				"waitForText":     map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page after scrolling"},
			},
		},
	},
	{
		Name:        "browser_snapshot",
		Description: "Capture a token-efficient interactive accessibility snapshot of the page with numbered element references (@1, @2, etc.). Supports pre-snapshot waitMs/waitForSelector/waitForText so you can wait for SPA rendering and snapshot in a single call.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"maxElements":     map[string]interface{}{"type": "integer", "description": "Maximum number of interactive elements to include (default: 80)"},
				"format":          map[string]interface{}{"type": "string", "description": "Output format: 'text' (default, compact tree) or 'json'"},
				"tabId":           map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"waitUntil":       map[string]interface{}{"type": "boolean", "description": "Wait for tab load completion before taking snapshot (default: true)"},
				"waitMs":          map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep before taking snapshot"},
				"sleepMs":         map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep before taking snapshot"},
				"waitForSelector": map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for before taking snapshot"},
				"waitForText":     map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page before taking snapshot"},
				"includeScreenshot": map[string]interface{}{"type": "boolean", "description": "Also capture and return a Set-of-Marks annotated screenshot alongside the snapshot text"},
			},
		},
	},
	{
		Name:        "browser_fill_form",
		Description: "Fill multiple form fields (inputs, selects, checkboxes, textareas) and optionally submit in a single tool call. Compatible with React Hook Form, Vue, and standard HTML5 forms. Supports inline post-fill waitMs/waitForSelector/waitForText.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"fields": map[string]interface{}{
					"type":        "array",
					"description": "List of fields to fill: [{selector: '@1' or '#id', value: 'my text', clear: true}]",
					"items": map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"selector": map[string]interface{}{"type": "string", "description": "CSS selector or snapshot ref (e.g. '@1')"},
							"value":    map[string]interface{}{"type": []string{"string", "boolean", "number"}, "description": "Value to set (string, boolean for checkbox, etc.)"},
							"clear":    map[string]interface{}{"type": "boolean", "description": "Clear field before typing (default: true)"},
						},
						"required": []string{"selector", "value"},
					},
				},
				"submitSelector":  map[string]interface{}{"type": "string", "description": "Optional selector or snapshot ref (e.g. '@4') of submit button to click after filling"},
				"pressEnter":      map[string]interface{}{"type": "boolean", "description": "Press enter on the last input after filling (default: false)"},
				"includeSnapshot": map[string]interface{}{"type": "boolean", "description": "Capture and return an interactive page snapshot after filling form (default: false)"},
				"tabId":           map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"waitMs":          map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep after filling form"},
				"sleepMs":         map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep after filling form"},
				"waitForSelector": map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for after filling form"},
				"waitForText":     map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page after filling form"},
			},
			"required": []string{"fields"},
		},
	},
	{
		Name:        "browser_get_element",
		Description: "Inspect a DOM element, retrieving bounding box, coordinates, XPath, selector, text content, and optionally computed CSS.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector":      map[string]interface{}{"type": "string", "description": "CSS selector or snapshot ref (e.g. '@1')"},
				"includeStyles": map[string]interface{}{"type": "boolean", "description": "Include computed CSS styles. Omitted by default to minimize token usage."},
				"tabId":         map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"selector"},
		},
	},
	{
		Name:        "browser_screenshot",
		Description: "Capture high-resolution PNG screenshot via CDP hardware acceleration (supports background tabs). Defaults to capturing the full visible screen viewport (mode: 'visible'). Supports optional step/title/description banner annotation and element highlight box directly on the PNG without touching page DOM. Supports pre-capture waitMs/waitForSelector/waitForText. Saves to local PNG file by default; set base64: true to return raw base64 dataUrl.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"mode":     map[string]interface{}{"type": "string", "description": "Capture mode: 'visible' (default full screen viewport), 'full' (entire scrollable page), 'region', or 'element'"},
				"selector": map[string]interface{}{"type": "string", "description": "CSS selector or snapshot ref (e.g. '@1') for element mode. Automatically scrolls element into view and crops to its bounding box."},
				"clip": map[string]interface{}{
					"type":        "object",
					"description": "Bounding box coordinates for region mode: { x, y, width, height }",
					"properties": map[string]interface{}{
						"x":      map[string]interface{}{"type": "number", "description": "X coordinate in pixels"},
						"y":      map[string]interface{}{"type": "number", "description": "Y coordinate in pixels"},
						"width":  map[string]interface{}{"type": "number", "description": "Width in pixels"},
						"height": map[string]interface{}{"type": "number", "description": "Height in pixels"},
					},
					"required": []string{"x", "y", "width", "height"},
				},
				"x":                 map[string]interface{}{"type": "number", "description": "X coordinate in pixels for region mode (alternative to clip object)"},
				"y":                 map[string]interface{}{"type": "number", "description": "Y coordinate in pixels for region mode (alternative to clip object)"},
				"width":             map[string]interface{}{"type": "number", "description": "Width in pixels for region mode (alternative to clip object)"},
				"height":            map[string]interface{}{"type": "number", "description": "Height in pixels for region mode (alternative to clip object)"},
				"tabId":             map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"format":            map[string]interface{}{"type": "string", "enum": []string{"png", "jpeg", "webp"}, "description": "Screenshot image format: 'png' (default), 'jpeg', or 'webp'"},
				"quality":           map[string]interface{}{"type": "integer", "description": "Compression quality (1..100) for jpeg/webp formats (default: 85)"},
				"path":              map[string]interface{}{"type": "string", "description": "Output file path to save screenshot image (default: OS temp directory screenshot_<ts>.<ext>)"},
				"savePath":          map[string]interface{}{"type": "string", "description": "Alias for path: output file path to save screenshot image"},
				"base64":            map[string]interface{}{"type": "boolean", "description": "Return raw base64 dataUrl in response instead of saving to file (default: false)"},
				"caption":           map[string]interface{}{"type": "string", "description": "Optional banner title/caption drawn directly onto the screenshot PNG (alias for title)"},
				"title":             map[string]interface{}{"type": "string", "description": "Optional bold step title drawn on the screenshot annotation banner"},
				"description":       map[string]interface{}{"type": "string", "description": "Optional multi-line subtitle/description drawn below the title on the screenshot annotation banner"},
				"step":              map[string]interface{}{"type": []string{"integer", "string"}, "description": "Optional step number or label (e.g. 1 or '1/7') rendered as a badge in the screenshot banner"},
				"captionPosition":   map[string]interface{}{"type": "string", "enum": []string{"bottom", "top"}, "description": "Position of the annotation banner: 'bottom' (default) or 'top'"},
				"highlightSelector": map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to highlight with a glowing border on the screenshot"},
				"arrows":            map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": []string{"string", "object"}}, "description": "Optional arrows drawn onto screenshot (e.g. ['@1->@2|red:Next', '@3|amber:Click'])"},
				"callouts":          map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": []string{"string", "object"}}, "description": "Optional callout text boxes with arrows pointing to elements (e.g. ['@1:Click to login|green'])"},
				"badges":            map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": []string{"string", "object"}}, "description": "Optional numbered circular step badges on elements (e.g. ['1:@1:Email', '2:@2:Password'])"},
				"boxes":             map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": []string{"string", "object"}}, "description": "Optional extra highlight rectangles with custom color/dashed/label (e.g. ['@1|red|dashed:Invalid'])"},
				"circles":           map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": []string{"string", "object"}}, "description": "Optional circles/ellipses around elements (e.g. ['@1|amber:Notification icon'])"},
				"icons":             map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": []string{"string", "object"}}, "description": "Optional vector status icons (check, error, warn, info, click) on elements (e.g. ['check:@1', 'error:#email:Invalid'])"},
				"redact":            map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": []string{"string", "object"}}, "description": "Optional selectors or 'x,y,w,h' regions to permanently mask/redact on the screenshot"},
				"spotlight":         map[string]interface{}{"type": "boolean", "description": "Dim the background outside highlighted/annotated elements to focus reader attention (default: false)"},
				"annotateInteractive": map[string]interface{}{"type": "boolean", "description": "Overlay Set-of-Marks interactive badges (@1, @2, etc.) and bounding boxes on all interactive elements without touching page DOM"},
				"somColor":            map[string]interface{}{"type": "string", "enum": []string{"amber", "cyan", "green", "red", "purple"}, "description": "Color theme for Set-of-Marks badges (default: amber)"},
				"waitMs":            map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep before capturing screenshot"},
				"sleepMs":           map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep before capturing screenshot"},
				"waitForSelector":   map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for before capturing screenshot"},
				"waitForText":       map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page before capturing screenshot"},
			},
		},
	},
	{
		Name:        "browser_get_devtools_data",
		Description: "Retrieve real-time DevTools logs (Console with numeric msgid & args, Network requests, Performance metrics). Supports msgid lookup, includePreserved/navigationId filtering, errorsOnly, and excludeStatic.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"type":             map[string]interface{}{"type": "string", "description": "all, console, network, performance"},
				"msgid":            map[string]interface{}{"type": "integer", "description": "Optional numeric console message ID (msgid) to inspect a single console message in full detail"},
				"includePreserved": map[string]interface{}{"type": "boolean", "description": "Include console/network entries preserved across earlier navigations (default: true; set false for current navigation only)"},
				"navigationId":     map[string]interface{}{"type": "integer", "description": "Optional navigationId to filter console/network entries to a specific navigation"},
				"detail":           map[string]interface{}{"type": "string", "enum": []string{"summary", "standard", "full"}, "description": "Output detail: summary minimizes tokens, standard preserves normal fields, full returns complete metrics (default: full)"},
				"filterOrigin":     map[string]interface{}{"type": "boolean", "description": "Filter out internal extension logs/warnings (chrome-extension://*). Default: true"},
				"errorsOnly":       map[string]interface{}{"type": "boolean", "description": "Only return console errors/assertions and failed/4xx/5xx network requests (default: false)"},
				"excludeStatic":    map[string]interface{}{"type": "boolean", "description": "Exclude static assets (images, fonts, media, stylesheets) from network requests (default: false)"},
				"includeHeaders":   map[string]interface{}{"type": "boolean", "description": "Include full HTTP response headers on network requests (default: false to save tokens)"},
				"tabId":            map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"limit":            map[string]interface{}{"type": "integer", "description": "Max entries to return"},
				"clear":            map[string]interface{}{"type": "boolean", "description": "Clear buffer after reading"},
			},
		},
	},
	{
		Name:        "browser_pick_color",
		Description: "Sample the pixel color at coordinates (X, Y) or activate the interactive eyedropper loupe.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"x":     map[string]interface{}{"type": "number", "description": "X coordinate"},
				"y":     map[string]interface{}{"type": "number", "description": "Y coordinate"},
				"tabId": map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_list_instances",
		Description: "List all connected browser instances and windows.",
		InputSchema: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
	},
	{
		Name:        "browser_select_instance",
		Description: "Switch the active target browser instance.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"instanceId": map[string]interface{}{"type": "string", "description": "ID of browser instance"},
			},
			"required": []string{"instanceId"},
		},
	},
	{
		Name:        "browser_set_busy",
		Description: "Display or dismiss the human input lock shield during automated tasks.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"busy":    map[string]interface{}{"type": "boolean", "description": "Enable or disable lock shield"},
				"action":  map[string]interface{}{"type": "string", "description": "Action name shown to user"},
				"session": map[string]interface{}{"type": "boolean", "description": "Keep cursor and lock shield continuously visible throughout the agent session"},
				"tabId":   map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_start_session",
		Description: "Start an active AI Agent session. Keeps the virtual cursor and glowing neon lock shield continuously visible on the tab until ended.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name":  map[string]interface{}{"type": "string", "description": "Session name or task description shown in the action pill"},
				"tabId": map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_end_session",
		Description: "End the active AI Agent session. Fades out and dismisses the virtual cursor and lock shield, and optionally closes the tab to free RAM.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"tabId":    map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"closeTab": map[string]interface{}{"type": "boolean", "description": "Close the Agent tab after ending the session to free RAM (default: false)"},
			},
		},
	},
	{
		Name:        "browser_get_pending_feedback",
		Description: "Channel B: Retrieve pending human visual UI feedback sessions stored in ~/.agent-pilot/inbox/feedback/.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"limit":     map[string]interface{}{"type": "integer", "description": "Max sessions to return"},
				"sessionId": map[string]interface{}{"type": "string", "description": "Specific session ID"},
				"clear":     map[string]interface{}{"type": "boolean", "description": "Archive sessions after reading"},
			},
		},
	},
	{
		Name:        "browser_wait_for_feedback",
		Description: "Channel A: Reactively pause agent execution until human user submits visual UI feedback.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"timeout": map[string]interface{}{"type": "integer", "description": "Timeout in seconds (default: 120)"},
				"tabId":   map[string]interface{}{"type": "integer", "description": "Optional tab ID filter"},
			},
		},
	},
	{
		Name:        "browser_evaluate",
		Description: "Evaluate a JavaScript expression, function, or script file in the context of the page (MAIN world first, with CDP Runtime.evaluate fallback) and return or save the serialized result. Supports resolving @ref/CSS selector arguments (args) into live DOM Elements, loading scripts from sourcePath, and saving large outputs to filePath.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"expression": map[string]interface{}{"type": "string", "description": "JavaScript expression or function to evaluate (e.g. '(el) => el.textContent')"},
				"script":     map[string]interface{}{"type": "string", "description": "Alias for expression: JavaScript expression or script to evaluate"},
				"sourcePath": map[string]interface{}{"type": "string", "description": "Optional local file path to load JavaScript source from instead of inline expression"},
				"filePath":   map[string]interface{}{"type": "string", "description": "Optional local file path to save the JSON-serialized evaluation result to disk"},
				"args": map[string]interface{}{
					"type":        "array",
					"items":       map[string]interface{}{"type": []string{"string", "number", "boolean", "object", "null"}},
					"description": "Optional arguments passed to the evaluated function; @ref or CSS selector strings (e.g. '@1', '#modal') are resolved to live DOM Element arguments in MAIN world",
				},
				"tabId":           map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"waitMs":          map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep after evaluating"},
				"sleepMs":         map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep after evaluating"},
				"waitForSelector": map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for after evaluating"},
				"waitForText":     map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page after evaluating"},
			},
		},
	},
	{
		Name:        "browser_upload_file",
		Description: "Upload local files into a file input element (<input type='file'>) or an upload trigger button/menuitem using CDP DOM.setFileInputFiles with automatic MAIN-world DataTransfer synthetic fallback when CDP cannot attach. Supports inline post-upload waitMs/waitForSelector/waitForText and includeSnapshot.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector": map[string]interface{}{"type": "string", "description": "CSS selector or @ref of the <input type='file'> element or upload trigger button/menuitem"},
				"files": map[string]interface{}{
					"type":        "array",
					"items":       map[string]interface{}{"type": "string"},
					"description": "Array of local file paths to upload",
				},
				"via":             map[string]interface{}{"type": "string", "enum": []string{"auto", "cdp", "synthetic"}, "description": "Upload backend: 'auto' (default, CDP with synthetic DataTransfer fallback), 'cdp' (strict CDP), or 'synthetic' (MAIN-world DataTransfer + File)"},
				"includeSnapshot": map[string]interface{}{"type": "boolean", "description": "Capture and return an interactive page snapshot after uploading (default: false)"},
				"tabId":           map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"waitMs":          map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep after uploading"},
				"sleepMs":         map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep after uploading"},
				"waitForSelector": map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for after uploading"},
				"waitForText":     map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page after uploading"},
			},
			"required": []string{"selector", "files"},
		},
	},
	{
		Name:        "browser_handle_dialog",
		Description: "Handle a pending or incoming JavaScript dialog (alert, confirm, prompt) with accept/dismiss and optional prompt text.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"accept":     map[string]interface{}{"type": "boolean", "description": "Whether to accept (true) or dismiss/cancel (false) the dialog (default: true)"},
				"promptText": map[string]interface{}{"type": "string", "description": "Optional text to enter into a prompt() dialog"},
				"tabId":      map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_hover",
		Description: "Simulate human-like virtual mouse hover over an element (triggering mouseenter, mouseover, mousemove). Supports inline post-hover waitMs/waitForSelector/waitForText and includeSnapshot.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector":        map[string]interface{}{"type": "string", "description": "CSS selector or @ref to hover over"},
				"includeSnapshot": map[string]interface{}{"type": "boolean", "description": "Capture and return an interactive page snapshot after hovering (default: false)"},
				"tabId":           map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"waitMs":          map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep after hovering"},
				"sleepMs":         map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep after hovering"},
				"waitForSelector": map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for after hovering"},
				"waitForText":     map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page after hovering"},
			},
			"required": []string{"selector"},
		},
	},
	{
		Name:        "browser_drag",
		Description: "Drag from a source to a target element, or between coordinates (fromX/fromY/toX/toY) for canvas/game aiming. Set via:'cdp' for trusted CDP input; via:'auto' falls back to synthetic. Supports inline post-drag waitMs/waitForSelector/waitForText and includeSnapshot.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"from":            map[string]interface{}{"type": "string", "description": "Source element selector or @ref"},
				"to":              map[string]interface{}{"type": "string", "description": "Target element selector or @ref"},
				"fromX":           map[string]interface{}{"type": "number", "description": "Source X coordinate (canvas/game)"},
				"fromY":           map[string]interface{}{"type": "number", "description": "Source Y coordinate (canvas/game)"},
				"toX":             map[string]interface{}{"type": "number", "description": "Target X coordinate (canvas/game)"},
				"toY":             map[string]interface{}{"type": "number", "description": "Target Y coordinate (canvas/game)"},
				"steps":           map[string]interface{}{"type": "integer", "description": "Number of interpolation steps (default: 8)"},
				"holdMs":          map[string]interface{}{"type": "integer", "description": "Hold at destination before release in ms (slingshot pull)"},
				"via":             map[string]interface{}{"type": "string", "description": "Input backend: synthetic (default), cdp (trusted), auto (cdp with synthetic fallback)"},
				"includeSnapshot": map[string]interface{}{"type": "boolean", "description": "Capture and return an interactive page snapshot after dragging (default: false)"},
				"tabId":           map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"waitMs":          map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep after dragging"},
				"sleepMs":         map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep after dragging"},
				"waitForSelector": map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for after dragging"},
				"waitForText":     map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page after dragging"},
			},
		},
	},
	{
		Name:        "browser_press_key",
		Description: "Dispatch keyboard key event, shortcut combination (Enter, Tab, Escape, F1-F12, Control+A, Control+C, Control+V, Control+X, Control+Z...), or an ordered sequence of keys to the active element or selector. Supports native editing commands (selectAll, copy, paste, cut, undo, redo), delayMs between keys, repeat count, inline post-key waitMs/waitForSelector/waitForText, and includeSnapshot.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"key":             map[string]interface{}{"type": "string", "description": "Key name, shortcut combination, or comma-separated sequence (e.g., 'Enter', 'Control+A', 'Ctrl+a, Backspace, 1, 2, 3, Enter')"},
				"keys":            map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "description": "Optional ordered array of keys or combinations to press in sequence (e.g., ['Ctrl+a', 'Ctrl+v', '1', '2', '3', 'Enter'])"},
				"delayMs":         map[string]interface{}{"type": "integer", "description": "Optional delay in milliseconds between keys in a sequence (0..5000, default: 0)"},
				"repeat":          map[string]interface{}{"type": "integer", "description": "Optional number of times to repeat the key or key sequence (1..100, default: 1)"},
				"selector":        map[string]interface{}{"type": "string", "description": "Optional target element selector or @ref"},
				"includeSnapshot": map[string]interface{}{"type": "boolean", "description": "Capture and return an interactive page snapshot after pressing key (default: false)"},
				"tabId":           map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"waitMs":          map[string]interface{}{"type": "integer", "description": "Optional milliseconds to wait/sleep after pressing key"},
				"sleepMs":         map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep after pressing key"},
				"waitForSelector": map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for after pressing key"},
				"waitForText":     map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page after pressing key"},
			},
			"required": []string{"key"},
		},
	},
	{
		Name:        "browser_wait_for",
		Description: "Smart wait until a selector or text appears, disappears, or meets state condition with timeout — or sleep for a fixed duration (waitMs/sleepMs/ms), or wait for document.readyState === 'complete' when called with no arguments.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector":  map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for"},
				"text":      map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page"},
				"state":     map[string]interface{}{"type": "string", "enum": []string{"visible", "attached", "hidden"}, "description": "Desired state (default: visible)"},
				"timeoutMs": map[string]interface{}{"type": "integer", "description": "Timeout in milliseconds (default: 10000)"},
				"waitMs":    map[string]interface{}{"type": "integer", "description": "Optional milliseconds to sleep (either pure sleep when no selector/text is given, or extra settle sleep after selector/text condition passes)"},
				"sleepMs":   map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep"},
				"ms":        map[string]interface{}{"type": "integer", "description": "Alias for waitMs: milliseconds to sleep"},
				"tabId":     map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_emulate",
		Description: "Emulate environment conditions: CPU throttling (rate 1/4/6), network conditions (offline, slow-3g, fast-3g, none), dark/light theme.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cpuThrottlingRate": map[string]interface{}{"type": "number", "description": "CPU throttling rate (1 = normal, 4 = 4x slowdown, 6 = 6x slowdown)"},
				"networkConditions": map[string]interface{}{"type": "string", "description": "Network preset: 'offline', 'slow-3g', 'fast-3g', 'none'"},
				"colorScheme":       map[string]interface{}{"type": "string", "enum": []string{"dark", "light", "default"}, "description": "Color scheme preference"},
				"tabId":             map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_resize_page",
		Description: "Resize browser page viewport metrics (width, height, deviceScaleFactor, mobile) for responsive testing.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"width":             map[string]interface{}{"type": "integer", "description": "Viewport width in pixels"},
				"height":            map[string]interface{}{"type": "integer", "description": "Viewport height in pixels"},
				"deviceScaleFactor": map[string]interface{}{"type": "number", "description": "Device pixel ratio (default: 1)"},
				"mobile":            map[string]interface{}{"type": "boolean", "description": "Whether to emulate mobile screen"},
				"tabId":             map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"width", "height"},
		},
	},
	{
		Name:        "browser_list_network_requests",
		Description: "List recent HTTP/HTTPS network requests captured on the tab with optional filters by URL, method, resourceType, navigation history (includePreserved/navigationId), and compact summary statistics.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"filterUrl":        map[string]interface{}{"type": "string", "description": "Filter requests matching URL substring"},
				"method":           map[string]interface{}{"type": "string", "description": "Filter by HTTP method (GET, POST, PUT, DELETE...)"},
				"resourceType":     map[string]interface{}{"type": "string", "description": "Filter by resource type (Fetch, XHR, Document, Script...)"},
				"includePreserved": map[string]interface{}{"type": "boolean", "description": "Include network requests preserved across earlier navigations (default: true; set false for current navigation only)"},
				"navigationId":     map[string]interface{}{"type": "integer", "description": "Optional navigationId to filter network requests to a specific navigation"},
				"includeHeaders":   map[string]interface{}{"type": "boolean", "description": "Include full HTTP request and response headers (default: false to save tokens)"},
				"limit":            map[string]interface{}{"type": "integer", "description": "Max requests to return (default: 100)"},
				"tabId":            map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_get_network_request",
		Description: "Get the full response body (JSON/Text) and details for a specific captured network request ID via CDP Network.getResponseBody.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"requestId":           map[string]interface{}{"type": "string", "description": "The unique request ID obtained from browser_list_network_requests or devtools data"},
				"includeRequestBody":  map[string]interface{}{"type": "boolean", "description": "Include the request POST body when available (default: true)"},
				"includeResponseBody": map[string]interface{}{"type": "boolean", "description": "Include the response body (default: true)"},
				"requestFilePath":     map[string]interface{}{"type": "string", "description": "Save the request body to a .network-request file; supported by the embedded runtime"},
				"responseFilePath":    map[string]interface{}{"type": "string", "description": "Save the response body to a .network-response file; supported by the embedded runtime"},
				"tabId":               map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"requestId"},
		},
	},
	{
		Name:        "browser_performance_trace",
		Description: "Start or stop DevTools Performance tracing session (Tracing.start/end). When stopped, returns structured bottleneck insights (CPU scripting/rendering/painting breakdown, Long Tasks >=50ms, synchronous Forced Reflows / layout thrashing, and Hot Scripts).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"action":     map[string]interface{}{"type": "string", "enum": []string{"start", "stop"}, "description": "Action: 'start' to begin recording, 'stop' to end and retrieve bottleneck insights"},
				"categories": map[string]interface{}{"type": "string", "description": "Optional trace categories string"},
				"tabId":      map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_performance_metrics",
		Description: "Retrieve comprehensive runtime & debugging metrics: CDP counters (JSHeapUsedMB, Nodes, JSEventListeners, LayoutCount, ScriptDuration), Core Web Vitals (TTFB, FCP, LCP + target element, CLS + shifting elements, INP, TBT + long tasks), Resource bottlenecks (slowest & render-blocking URLs), DOM/A11y health (liveDomElements vs blinkRetainedNodes, detachedOrUncollectedNodes, max depth, duplicate IDs, missing alt/labels), runtime console errors, and automated diagnostic warnings.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"includeWebVitals": map[string]interface{}{"type": "boolean", "description": "Collect Core Web Vitals (TTFB, FCP, LCP, CLS, INP, TBT) (default: true)"},
				"includeResources": map[string]interface{}{"type": "boolean", "description": "Collect resource bottleneck metrics (slowest & render-blocking URLs) (default: true)"},
				"includeDomHealth": map[string]interface{}{"type": "boolean", "description": "Collect DOM depth, duplicate IDs, and accessibility health metrics (default: true)"},
				"collectGarbage":   map[string]interface{}{"type": "boolean", "description": "Attempt V8 garbage collection before reading metrics to distinguish true detached DOM leaks from uncollected garbage (default: false)"},
				"forceGC":          map[string]interface{}{"type": "boolean", "description": "Alias for collectGarbage: trigger V8 garbage collection before reading metrics (default: false)"},
				"bringToFront":     map[string]interface{}{"type": "boolean", "description": "Activate and bring the tab to front before probing Web Vitals so Chromium paints FCP/LCP on background-opened tabs (default: false)"},
				"timeoutMs":        map[string]interface{}{"type": "integer", "description": "Optional timeout in milliseconds for the metrics probe"},
				"tabId":            map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_heap_capability",
		Description: "Probe the target's actual HeapProfiler support before taking a snapshot. Ordinary extension-debugger tabs return supported=false with HEAPPROFILER_UNAVAILABLE; isolated DevTools tabs are probed against Chrome and support snapshot, baseline and diff only when the protocol is available.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"tabId": map[string]interface{}{"type": "integer", "description": "Target tab ID; negative IDs identify an isolated DevTools tab"},
			},
		},
	},
	{
		Name:        "browser_take_heapsnapshot",
		Description: "Capture a real V8 heap memory snapshot, parse top object constructors & Detached DOM nodes, and detect memory leaks via baseline/diff comparison. Ordinary extension-debugger tabs return HEAPPROFILER_UNAVAILABLE instead of a metrics fallback; use an isolated DevTools context for native heap snapshots. Garbage collection is attempted before snapshot unless collectGarbage: false.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"action":              map[string]interface{}{"type": "string", "enum": []string{"snapshot", "baseline", "diff", "check_leak", "gc"}, "description": "Memory action: 'baseline' (record a real heap baseline), 'diff' / 'check_leak' (compare against a real tab baseline), 'snapshot' (default), or 'gc' (trigger V8 GC only). Unsupported extension-debugger tabs fail clearly."},
				"collectGarbage":      map[string]interface{}{"type": "boolean", "description": "Attempt V8 Garbage Collection before capturing a supported snapshot (default: true); GC failure does not fabricate a snapshot"},
				"forceGC":             map[string]interface{}{"type": "boolean", "description": "Alias for collectGarbage: trigger V8 Garbage Collection before snapshot (default: true)"},
				"recordBaseline":      map[string]interface{}{"type": "boolean", "description": "Explicitly save this snapshot as the new per-tab memory baseline"},
				"compareWithBaseline": map[string]interface{}{"type": "boolean", "description": "Compare this snapshot against the stored per-tab baseline to detect memory leaks"},
				"maxConstructors":     map[string]interface{}{"type": "integer", "description": "Maximum number of top object constructors to return (default: 20)"},
				"filePath":            map[string]interface{}{"type": "string", "description": "Required for isolated DevTools tabs; saves a real .heapsnapshot and enables baseline/diff comparison. Ordinary extension-debugger tabs do not support snapshots."},
				"tabId":               map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_manage_extensions",
		Description: "List, enable/disable, toggle, install, reload, trigger, or uninstall browser extensions. Uses chrome.management for profile-safe management and the Chrome DevTools Protocol Extensions domain for unpacked-extension lifecycle actions.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"action":            map[string]interface{}{"type": "string", "enum": []string{"list", "setEnabled", "toggle", "install", "reload", "triggerAction", "uninstall"}, "description": "Action to perform"},
				"extensionId":       map[string]interface{}{"type": "string", "description": "Extension ID for enable/disable/toggle/reload/trigger/uninstall"},
				"enabled":           map[string]interface{}{"type": "boolean", "description": "Target enabled state for setEnabled action"},
				"path":              map[string]interface{}{"type": "string", "description": "Absolute path to an unpacked extension directory for install"},
				"enableInIncognito": map[string]interface{}{"type": "boolean", "description": "Enable an installed unpacked extension in incognito windows"},
				"tabId":             map[string]interface{}{"type": "integer", "description": "Target tab used for CDP Extensions commands and triggerAction"},
				"confirmSelf":       map[string]interface{}{"type": "boolean", "description": "Explicitly allow uninstalling Agent Pilot itself"},
			},
		},
	},
}
