package mcp

func field(kind, description string) map[string]interface{} {
	return map[string]interface{}{"type": kind, "description": description}
}
func choices(description string, values ...string) map[string]interface{} {
	return map[string]interface{}{"type": "string", "description": description, "enum": values}
}
func devtoolsTool(name, description string, properties map[string]interface{}, required ...string) ToolInfo {
	schema := map[string]interface{}{"type": "object", "properties": properties}
	if len(required) > 0 {
		schema["required"] = required
	}
	return ToolInfo{Name: name, Description: description, InputSchema: schema}
}
func init() {
	mcpTools = append(mcpTools,
		devtoolsTool("browser_get_css_styles", "Inspect matched CSS rules, inline/inherited styles, specificity, important declarations, cascade layers, source locations and final computed styles. Paginated; accepts a CSS selector, snapshot @ref or backendNodeId.", map[string]interface{}{
			"selector": field("string", "CSS selector or snapshot @ref"), "backendNodeId": field("integer", "Backend DOM node ID from an accessibility snapshot"), "tabId": field("integer", "Target tab ID"), "pageIdx": field("integer", "Zero-based rule page"), "pageSize": field("integer", "Rules per page, default 10, maximum 100"),
		}),
		devtoolsTool("browser_lighthouse_audit", "Run real Lighthouse on the current authenticated tab without opening a debugging port. Returns category scores, failing audits, flagged DOM nodes, and HTML/JSON reports. Navigation reloads the tab; snapshot audits its current state. Built-in runtime; no Node installation required.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID"), "mode": choices("Audit mode; default navigation", "navigation", "snapshot"), "device": choices("Scoring form factor; current viewport is preserved", "desktop", "mobile"), "categories": map[string]interface{}{"type": "array", "items": choices("Category", "performance", "accessibility", "best-practices", "seo"), "description": "Default accessibility, best-practices, seo; performance is optional"}, "outputDirPath": field("string", "Directory for HTML and JSON reports"), "limit": field("integer", "Maximum failing audits inline; full report always saved"),
		}),
		devtoolsTool("browser_lighthouse_analyze_audit", "Drill into a saved Lighthouse report: list failures by category or inspect an audit's explanation, recommendations, DOM nodes, opportunity savings and paginated detail rows. Use reportId from browser_lighthouse_audit or the saved JSON filePath.", map[string]interface{}{
			"reportId": field("string", "Report identifier"), "filePath": field("string", "Saved Lighthouse JSON report; works after server restart"), "auditId": field("string", "Specific failing audit ID, e.g. color-contrast"), "category": field("string", "Optional category filter"), "failuresOnly": field("boolean", "Only failing audits, default true"), "pageIdx": field("integer", "Zero-based page"), "pageSize": field("integer", "Rows per page, maximum 100"),
		}),
		devtoolsTool("browser_performance_analyze_insight", "Analyze a recorded trace using the Chrome DevTools trace engine. List insight sets, then inspect a named insight such as LCPBreakdown, DocumentLatency, RenderBlocking or CLSCulprits. Accepts traceId or saved .json/.json.gz filePath.", map[string]interface{}{
			"traceId": field("string", "ID returned when stopping a trace"), "filePath": field("string", "Saved raw trace; works after server restart"), "insightSetId": field("string", "ID from the trace's available insight sets"), "insightName": field("string", "Omit to list available insights"), "maxItems": field("integer", "Maximum items in nested insight collections"),
		}),
		devtoolsTool("browser_screencast_start", "Record the target tab to MP4 using Chrome's built-in encoder, without FFmpeg. Requires Chrome with Page.startScreenRecording support. The recording continues until browser_screencast_stop.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID"), "filePath": field("string", "MP4 path; defaults to the local artifacts directory; existing files are never replaced"), "fps": field("number", "Frame rate 1..60, default 20"),
		}),
		devtoolsTool("browser_screencast_stop", "Stop and finalize the tab's MP4 recording; returns its absolute path, byte count and duration.", map[string]interface{}{"tabId": field("integer", "Target tab ID")}),
		devtoolsTool("browser_create_context", "Create a genuinely isolated login session: independent cookies, localStorage, IndexedDB and service workers. Uses installed Chrome and the embedded runtime automatically. Open tabs with the returned contextId; negative tab IDs identify context tabs.", map[string]interface{}{
			"name": field("string", "Optional session name"), "headless": field("boolean", "Launch the managed browser headlessly; default false; applies to the first context"), "origin": field("string", "Origin to grant optional permissions"), "permissions": map[string]interface{}{"type": "array", "items": field("string", "Chrome permission, e.g. geolocation")},
		}),
		devtoolsTool("browser_list_contexts", "List this agent's isolated login contexts and their tab IDs.", map[string]interface{}{}),
		devtoolsTool("browser_close_context", "Close all tabs in this agent's isolated context and discard its cookies and storage.", map[string]interface{}{"contextId": field("string", "Context to close")}, "contextId"),
		devtoolsTool("browser_service_workers", "Discover and debug active service-worker targets. Evaluate async JavaScript, read console/errors, or send CDP Debugger commands (enable, breakpoints, resume). Context workers require contextId; ordinary Chrome workers use the extension. Workers must be running to attach.", map[string]interface{}{
			"action": choices("Operation; default list", "list", "evaluate", "console", "send", "detach"), "serviceWorkerId": field("string", "ID from the worker list"), "contextId": field("string", "Optional isolated context"), "expression": field("string", "JavaScript to evaluate in the worker"), "cdpMethod": field("string", "CDP Debugger/Runtime method for send"), "cdpParams": map[string]interface{}{"type": "object", "description": "CDP command parameters"}, "limit": field("integer", "Maximum captured events, default 100"), "clear": field("boolean", "Clear captured events after reading"),
		}),
		devtoolsTool("browser_accessibility_snapshot", "Read Chrome's actual accessibility tree, including semantic roles, names, states, parent/child relationships and backend DOM IDs. Use backendNodeId with CSS inspection. Existing browser_snapshot keeps its compact interactive format.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID"), "verbose": field("boolean", "Include ignored AX nodes"), "maxElements": field("integer", "Maximum nodes, default 1000, maximum 10000"),
		}),
		devtoolsTool("browser_devtools_status", "Report the versions of the runtime embedded in the MCP binary. Works without a system Node or FFmpeg installation.", map[string]interface{}{}),
		devtoolsTool("browser_analyze_heapsnapshot", "Analyze a saved V8 heap snapshot: summary, object queries, outgoing edges, retainers, retaining paths, duplicate strings, native contexts, and constructor diffs. The snapshot is read by the embedded runtime and never sent to a remote service.", map[string]interface{}{
			"filePath":        field("string", "Path to a .heapsnapshot JSON file"),
			"action":          choices("Analysis operation", "summary", "query", "details", "edges", "retainers", "retaining_paths", "dominators", "dominator_chain", "duplicate_strings", "contexts", "class_nodes", "class_details", "analyze_contexts", "context_analysis", "close", "compare"),
			"baseFilePath":    field("string", "Earlier snapshot path for compare"),
			"currentFilePath": field("string", "Later snapshot path for compare"),
			"nodeId":          field("integer", "Heap node index or V8 node id for details/edges/retainers/paths"),
			"className":       field("string", "Name substring or /regex/ filter"),
			"name":            field("string", "Node name substring or /regex/ filter"),
			"nodeType":        field("string", "V8 node type filter"),
			"propertyName":    field("string", "Outgoing property name filter"),
			"isDetached":      field("boolean", "Filter detached DOM nodes"),
			"selfSize":        field("string", "Minimum self size, e.g. 1MB"),
			"maxSelfSize":     field("string", "Maximum self size, e.g. 10MB"),
			"sortBy":          choices("Query sort field", "selfSize", "name", "edgeCount"),
			"pageIdx":         field("integer", "Zero-based result page"),
			"pageSize":        field("integer", "Result page size"),
			"maxItems":        field("integer", "Maximum summary/detail rows"),
			"maxDepth":        field("integer", "Maximum retaining-path depth"),
			"maxNodes":        field("integer", "Maximum retaining paths"),
			"maxSiblings":     field("integer", "Maximum incoming edges explored per node"),
			"exact":           field("boolean", "For class_nodes, require an exact constructor name; default true"),
		}),
		devtoolsTool("browser_list_3p_developer_tools", "Discover developer tools exposed by the current page through the devtoolstooldiscovery event. Returns page-defined names, descriptions and input schemas without executing them.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID"),
		}),
		devtoolsTool("browser_execute_3p_developer_tool", "Execute one developer tool exposed by the current page through devtoolstooldiscovery. The tool runs in the page context and grants no privileges beyond page JavaScript.", map[string]interface{}{
			"tabId":    field("integer", "Target tab ID"),
			"toolName": field("string", "Page-defined developer tool name"),
			"input":    map[string]interface{}{"type": "object", "description": "JSON input passed to the page tool"},
			"params":   field("string", "JSON-stringified input alias"),
		}, "toolName"),
		devtoolsTool("browser_list_webmcp_tools", "List WebMCP tools exposed by the current page through Chrome's WebMCP runtime without executing them.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID"),
		}),
		devtoolsTool("browser_execute_webmcp_tool", "Execute one WebMCP tool exposed by the current page. Input is validated as a JSON object and the page runtime returns a structured invocation result.", map[string]interface{}{
			"tabId":    field("integer", "Target tab ID"),
			"toolName": field("string", "WebMCP tool name"),
			"input":    map[string]interface{}{"type": "object", "description": "JSON input passed to the WebMCP tool"},
		}, "toolName"),
		devtoolsTool("browser_get_os_app_state", "Read Chromium's OS-level state for an installed PWA by manifest ID. Requires a Chrome build exposing the browser-scoped PWA CDP domain.", map[string]interface{}{
			"manifestId": field("string", "PWA manifest ID"),
		}, "manifestId"),
		devtoolsTool("browser_install_pwa", "Install a PWA by manifest ID through the browser-scoped PWA CDP domain.", map[string]interface{}{
			"manifestId":            field("string", "PWA manifest ID"),
			"installUrlOrBundleUrl": field("string", "Optional install URL or bundle URL"),
			"displayMode":           choices("Optional post-install display mode", "browser", "standalone"),
		}, "manifestId"),
		devtoolsTool("browser_launch_pwa", "Launch an installed PWA through the browser-scoped PWA CDP domain.", map[string]interface{}{
			"manifestId": field("string", "PWA manifest ID"),
			"url":        field("string", "Optional URL to open in the PWA"),
		}, "manifestId"),
		devtoolsTool("browser_uninstall_pwa", "Uninstall a PWA by manifest ID through the browser-scoped PWA CDP domain.", map[string]interface{}{
			"manifestId": field("string", "PWA manifest ID"),
		}, "manifestId"),
	)
	for i := range mcpTools {
		tool := &mcpTools[i]
		properties := tool.InputSchema["properties"].(map[string]interface{})
		if _, hasTab := properties["tabId"]; hasTab || tool.Name == "browser_list_tabs" {
			properties["contextId"] = field("string", "Optional isolated context; context tab IDs are negative")
		}
		switch tool.Name {
		case "browser_open_tab":
			properties["contextId"] = field("string", "Isolated login context returned by browser_create_context")
			properties["isolatedContext"] = field("string", "Named isolated session; automatically creates it if missing")
			properties["headless"] = field("boolean", "First managed context can launch headlessly")
		case "browser_emulate":
			properties["colorScheme"] = choices("Color scheme preference; auto/default reset", "dark", "light", "auto", "default")
			properties["networkConditions"] = map[string]interface{}{"type": []string{"string", "object"}, "description": "offline, slow-3g, fast-3g, slow-4g, fast-4g, none, or custom offline/latency/downloadThroughput/uploadThroughput (bytes/sec)"}
			properties["geolocation"] = map[string]interface{}{"type": []string{"string", "object", "null"}, "description": "latitude,longitude or {latitude,longitude,accuracy}; null clears the override; site permission still applies"}
			properties["userAgent"] = field("string", "Override user agent; empty string clears it")
			properties["userAgentMetadata"] = map[string]interface{}{"type": "object", "description": "Optional CDP client hints metadata"}
			properties["extraHttpHeaders"] = map[string]interface{}{"type": []string{"object", "string"}, "description": "Extra HTTP headers; empty object clears them"}
			properties["prefersReducedMotion"] = choices("Reduced motion", "reduce", "no-preference", "auto")
			properties["prefersContrast"] = choices("Contrast preference", "more", "less", "custom", "no-preference", "auto")
			properties["forcedColors"] = choices("Forced colors", "active", "none", "auto")
			properties["timezoneId"] = field("string", "IANA timezone, e.g. Asia/Bangkok; empty clears")
			properties["locale"] = field("string", "Locale, e.g. vi-VN; empty clears")
			properties["viewport"] = map[string]interface{}{"type": []string{"object", "null"}, "description": "{width,height,deviceScaleFactor,mobile,touch,landscape}; null resets"}
		case "browser_resize_page":
			properties["touch"] = field("boolean", "Enable touch emulation")
		case "browser_performance_trace":
			tool.Description = "Record a complete Chrome trace without the old 2,000-event cap, save .json/.json.gz, and return bottleneck summaries plus DevTools insight sets. Start, interact with the page, then stop; or use reload and autoStop. Drill down with browser_performance_analyze_insight."
			properties["filePath"] = field("string", "Raw trace output path (.json or .json.gz); default local artifacts directory")
			properties["reload"] = field("boolean", "Reload after starting trace")
			properties["ignoreCache"] = field("boolean", "Bypass cache during reload")
			properties["autoStop"] = field("boolean", "Automatically stop and analyze")
			properties["durationMs"] = field("integer", "Auto-stop recording window, default 5000, max 30000")
		case "browser_take_heapsnapshot":
			properties["filePath"] = field("string", "Raw .heapsnapshot output for isolated context tabs; required there. Native tabs keep their constructor/baseline summaries.")
		}
	}
}
