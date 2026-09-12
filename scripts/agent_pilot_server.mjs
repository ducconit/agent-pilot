#!/usr/bin/env node
/**
 * Agent Pilot - Universal AI Agent Bridge Server
 * WebSocket Bridge & Model Context Protocol (MCP) Server - Antigravity First
 * Default Port: 58765 (Dynamic/Private range, collision-free)
 */

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.AGENT_PILOT_PORT || process.env.PORT || 58765);
const HOST = process.env.AGENT_PILOT_HOST || "127.0.0.1";
const CLIENT_HOST = HOST === "0.0.0.0" || HOST === "::" ? "127.0.0.1" : HOST;

const connectedClients = new Map(); // id -> { id, ws, ip, connectedAt, lastActive, agent, version, details }
let activeClientId = null;
let pendingRequests = new Map();
let requestIdCounter = 1;

function getActiveClient(targetId = null) {
  if (targetId && connectedClients.has(targetId)) {
    const c = connectedClients.get(targetId);
    if (c.ws && c.ws.readyState === WebSocket.OPEN) return c;
  }
  if (activeClientId && connectedClients.has(activeClientId)) {
    const c = connectedClients.get(activeClientId);
    if (c.ws && c.ws.readyState === WebSocket.OPEN) return c;
  }
  // Fallback to the most recently active open client
  const openClients = Array.from(connectedClients.values()).filter(c => c.ws && c.ws.readyState === WebSocket.OPEN);
  if (openClients.length === 0) return null;
  openClients.sort((a, b) => b.lastActive - a.lastActive);
  activeClientId = openClients[0].id;
  return openClients[0];
}

// 1. Create HTTP & WebSocket Server (Local loopback only, no external CORS)
const server = http.createServer(async (req, res) => {

  // Health check
  if (req.url === "/" || req.url === "/health") {
    const active = getActiveClient();
    const clientsList = Array.from(connectedClients.values())
      .filter(c => c.ws && c.ws.readyState === WebSocket.OPEN)
      .map(c => ({
        instanceId: c.id,
        browser: c.details?.browser || "Chromium",
        os: c.details?.os || "linux",
        windowCount: c.details?.windowCount || 1,
        activeTabTitle: c.details?.activeTabTitle || "Unknown",
        activeTabUrl: c.details?.activeTabUrl || "",
        isActive: c.id === activeClientId
      }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      name: "Agent Pilot Bridge Server",
      port: PORT,
      extensionConnected: !!active,
      clientCount: clientsList.length,
      activeClientId,
      clients: clientsList,
      version: "1.0.0"
    }));
    return;
  }

  // HTTP API Endpoint for non-WebSocket scripts / curl
  if (req.url === "/api" && req.method === "POST") {
    // CSRF Protection: Require application/json Content-Type.
    // In browsers, non-preflighted requests cannot use application/json.
    const contentType = req.headers["content-type"] || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      res.writeHead(415, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unsupported Media Type: application/json required" }));
      return;
    }

    // CSRF Protection: If Origin is sent (by a browser web page), reject non-loopback/extension origins
    const origin = req.headers["origin"];
    if (origin) {
      const allowed = origin.startsWith("chrome-extension://") ||
                      origin.startsWith("http://127.0.0.1:") ||
                      origin.startsWith("http://localhost:");
      if (!allowed) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden: Cross-origin request rejected" }));
        return;
      }
    }

    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large (max 5MB)" }));
        req.destroy();
      }
    });
    req.on("end", async () => {
      if (res.writableEnded) return;
      try {
        const json = JSON.parse(body || "{}");
        const { method, params } = json;
        if (!method) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Missing method" }));
        }

        const result = await sendCommandToExtension(method, params);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, result }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const clientId = "browser_" + Math.random().toString(36).slice(2, 8);
  const clientInfo = {
    id: clientId,
    ws,
    ip: req.socket.remoteAddress,
    connectedAt: Date.now(),
    lastActive: Date.now(),
    agent: "AgentPilot-Extension",
    version: "1.0.0",
    details: { browser: "Chromium", os: "linux", windowCount: 1, activeTabTitle: "", activeTabUrl: "" }
  };
  connectedClients.set(clientId, clientInfo);
  if (!activeClientId) activeClientId = clientId;

  console.error(`[BridgeServer] 🔌 Extension connected [${clientId}] from ${req.socket.remoteAddress}. Total active: ${connectedClients.size}`);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Response to a pending command
      if (msg.id && pendingRequests.has(msg.id)) {
        const { resolve, reject } = pendingRequests.get(msg.id);
        pendingRequests.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error));
        } else {
          resolve(msg.result);
        }
        return;
      }

      // Incoming event from extension
      if (msg.type === "HANDSHAKE") {
        clientInfo.agent = msg.agent || clientInfo.agent;
        clientInfo.version = msg.version || clientInfo.version;
        if (msg.details) Object.assign(clientInfo.details, msg.details);
        clientInfo.lastActive = Date.now();
        console.error(`[BridgeServer] 🤝 Handshake from ${clientInfo.agent} [${clientId}] (${clientInfo.details.browser} on ${clientInfo.details.os}) - Tab: "${clientInfo.details.activeTabTitle}"`);
      } else if (msg.type === "WINDOW_FOCUS") {
        clientInfo.lastActive = Date.now();
        activeClientId = clientId;
        if (msg.activeTabTitle) clientInfo.details.activeTabTitle = msg.activeTabTitle;
        if (msg.activeTabUrl) clientInfo.details.activeTabUrl = msg.activeTabUrl;
        console.error(`[BridgeServer] 🎯 Window focus switched to [${clientId}] (${clientInfo.details.browser}) - "${msg.activeTabTitle}"`);
      } else if (msg.type === "DEVTOOLS_CONSOLE_EVENT") {
        // Streamed console log from CDP
        if (process.env.DEBUG_STREAM) {
          console.error(`[CDP:Console] [${msg.entry?.type}] ${msg.entry?.text}`);
        }
      }
    } catch (err) {
      console.error("[BridgeServer] Error handling message:", err);
    }
  });

  ws.on("close", () => {
    connectedClients.delete(clientId);
    if (activeClientId === clientId) {
      const remaining = Array.from(connectedClients.keys());
      activeClientId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
    console.error(`[BridgeServer] ❌ Client [${clientId}] disconnected. Remaining: ${connectedClients.size}`);
    for (const [id, req] of pendingRequests.entries()) {
      if (req.clientId === clientId) {
        pendingRequests.delete(id);
        req.reject(new Error("Extension disconnected while request was pending"));
      }
    }
  });

  ws.on("error", (err) => {
    console.error(`[BridgeServer] WebSocket error [${clientId}]:`, err.message);
  });
});

/**
 * Dispatch command to the Chrome Extension over WebSocket
 */
export function sendCommandToExtension(method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    // Local multi-instance management commands
    if (method === "instances.list") {
      const list = Array.from(connectedClients.values())
        .filter(c => c.ws && c.ws.readyState === WebSocket.OPEN)
        .map(c => ({
          instanceId: c.id,
          browser: c.details?.browser || "Chromium",
          os: c.details?.os || "linux",
          windowCount: c.details?.windowCount || 1,
          activeTabTitle: c.details?.activeTabTitle || "Unknown",
          activeTabUrl: c.details?.activeTabUrl || "",
          isActive: c.id === activeClientId,
          connectedAt: new Date(c.connectedAt).toISOString()
        }));
      return resolve(list);
    }

    if (method === "instances.select") {
      const targetId = params.instanceId;
      if (!targetId || !connectedClients.has(targetId)) {
        return reject(new Error(`Instance '${targetId}' not found. Available: ${Array.from(connectedClients.keys()).join(", ") || "none"}`));
      }
      activeClientId = targetId;
      const target = connectedClients.get(targetId);
      return resolve({
        success: true,
        activeInstanceId: activeClientId,
        browser: target.details?.browser || "Chromium",
        activeTabTitle: target.details?.activeTabTitle || ""
      });
    }

    const client = getActiveClient(params.instanceId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return reject(new Error("Agent Pilot Chrome Extension is not connected. Make sure Chrome is open with Agent Pilot installed!"));
    }

    const id = requestIdCounter++;
    const timer = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Command '${method}' timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    pendingRequests.set(id, {
      clientId: client.id,
      resolve: (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      }
    });

    const cleanParams = { ...params };
    delete cleanParams.instanceId;
    client.ws.send(JSON.stringify({ id, method, params: cleanParams }));
  });
}

// 2. Model Context Protocol (MCP) Stdio Interface for Antigravity
export const MCP_TOOLS = [
  {
    name: "browser_open_tab",
    description: "Open a new browser tab with the specified URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to navigate to (e.g. https://github.com)" },
        active: { type: "boolean", description: "Whether to make the newly opened tab active/focused (default false to keep user focus undisturbed). Set to true only if explicitly requested to switch focus.", default: false }
      },
      required: ["url"]
    }
  },
  {
    name: "browser_list_tabs",
    description: "List all open browser tabs with tabId, title, url, active state, and whether they belong to the agent",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "browser_navigate",
    description: "Navigate active tab or specific tab to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Destination URL" },
        tabId: { type: "integer", description: "Optional Tab ID. Defaults to current active tab" }
      },
      required: ["url"]
    }
  },
  {
    name: "browser_click",
    description: "Simulate virtual mouse movement and click at (x, y) coordinates or on a CSS selector on the agent's tab or specified tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Optional target Tab ID" },
        x: { type: "number", description: "Target X pixel coordinate" },
        y: { type: "number", description: "Target Y pixel coordinate" },
        selector: { type: "string", description: "Optional CSS selector to click" }
      }
    }
  },
  {
    name: "browser_type",
    description: "Simulate human-like typing into an input or textarea element on the agent's tab or specified tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Optional target Tab ID" },
        selector: { type: "string", description: "CSS selector of the input field" },
        text: { type: "string", description: "Text string to type" },
        delay: { type: "number", description: "Typing delay between keys in ms (default 50)" }
      },
      required: ["selector", "text"]
    }
  },
  {
    name: "browser_scroll",
    description: "Scroll the agent's tab or specified tab smoothly",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Optional target Tab ID" },
        deltaX: { type: "number", description: "Horizontal scroll amount" },
        deltaY: { type: "number", description: "Vertical scroll amount (e.g. 300 to scroll down)" }
      }
    }
  },
  {
    name: "browser_get_element",
    description: "Inspect a DOM element on the agent's tab or specified tab, returning bounding box, dimensions, CSS selector, and XPath",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Optional target Tab ID" },
        selector: { type: "string", description: "CSS selector to inspect" }
      },
      required: ["selector"]
    }
  },
  {
    name: "browser_screenshot",
    description: "Capture a screenshot of a specified tab or active tab, even if running in the background while the user works on another tab (returns PNG data)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Optional Tab ID to capture. If omitted, captures the tab controlled by the agent (even if in background) or active tab" },
        mode: { type: "string", enum: ["visible", "region"], description: "Screenshot mode (default visible)" }
      }
    }
  },
  {
    name: "browser_get_devtools_data",
    description: "Retrieve real-time DevTools CDP inspection data (Console logs and Network requests)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Optional Tab ID" }
      }
    }
  },
  {
    name: "browser_pick_color",
    description: "Trigger the high-precision eyedropper color picker on the page",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Optional target Tab ID" }
      }
    }
  },
  {
    name: "browser_list_instances",
    description: "List all connected browser instances (Chrome, Edge, Brave, separate profiles or windows) and see which one is currently active",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "browser_select_instance",
    description: "Switch active target browser instance when multiple browsers or windows are connected",
    inputSchema: {
      type: "object",
      properties: {
        instanceId: { type: "string", description: "The instanceId from browser_list_instances to select" }
      },
      required: ["instanceId"]
    }
  },
  {
    name: "browser_set_busy",
    description: "Lock or unlock human interactions on a browser tab with a sleek ChatGPT Operator-style overlay banner while the agent is executing workflows",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Optional target Tab ID" },
        busy: { type: "boolean", description: "True to lock user input, false to unlock", default: true },
        action: { type: "string", description: "Optional description of the active action to display on the banner" }
      }
    }
  }
];

let isForwarderMode = false;

const FORWARDER_METHOD_MAP = Object.freeze({
  browser_open_tab: { method: "tabs.create", getParams: (a) => ({ url: a.url, active: a.active === true }) },
  browser_list_tabs: { method: "tabs.listAll", getParams: () => ({}) },
  browser_navigate: { method: "tabs.update", getParams: (a) => ({ url: a.url, tabId: a.tabId }) },
  browser_click: { method: "page.click", getParams: (a) => a },
  browser_type: { method: "page.type", getParams: (a) => a },
  browser_scroll: { method: "page.scroll", getParams: (a) => a },
  browser_get_element: { method: "page.getElement", getParams: (a) => a },
  browser_screenshot: { method: "page.screenshot", getParams: (a) => a },
  browser_get_devtools_data: { method: "devtools.getData", getParams: (a) => a },
  browser_pick_color: { method: "page.pickColor", getParams: (a) => a },
  browser_list_instances: { method: "instances.list", getParams: () => ({}) },
  browser_select_instance: { method: "instances.select", getParams: (a) => a },
  browser_set_busy: { method: "page.setBusy", getParams: (a) => a }
});

async function handleMcpToolCall(name, args) {
  if (isForwarderMode) {
    const target = FORWARDER_METHOD_MAP[name];
    if (!target) throw new Error(`Unsupported tool: ${name}`);

    const resp = await fetch(`http://${CLIENT_HOST}:${PORT}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: target.method,
        params: target.getParams(args)
      })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || "Tool execution failed");
    return data.result;
  }

  switch (name) {
    case "browser_open_tab":
      return await sendCommandToExtension("tabs.create", { url: args.url, active: args.active === true });

    case "browser_list_tabs":
      return await sendCommandToExtension("tabs.listAll");

    case "browser_navigate":
      return await sendCommandToExtension("tabs.update", { url: args.url, tabId: args.tabId });

    case "browser_click":
      return await sendCommandToExtension("page.click", args);

    case "browser_type":
      return await sendCommandToExtension("page.type", args);

    case "browser_scroll":
      return await sendCommandToExtension("page.scroll", args);

    case "browser_get_element":
      return await sendCommandToExtension("page.getElement", args);

    case "browser_screenshot":
      return await sendCommandToExtension("page.screenshot", args);

    case "browser_get_devtools_data":
      return await sendCommandToExtension("devtools.getData", args);

    case "browser_pick_color":
      return await sendCommandToExtension("page.pickColor", args);

    case "browser_list_instances":
      return await sendCommandToExtension("instances.list");

    case "browser_select_instance":
      return await sendCommandToExtension("instances.select", args);

    case "browser_set_busy":
      return await sendCommandToExtension("page.setBusy", args);

    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}

// Start stdio interface and HTTP server when executed directly as main script
const isWin = process.platform === "win32";
const isMainScript = Boolean(
  process.argv[1] &&
  (isWin
    ? path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
    : path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
);

if (isMainScript) {
  // Enable MCP stdio interface (always active for Antigravity & MCP clients)
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    try {
      const rpc = JSON.parse(line);
      const { id, method, params } = rpc;

      if (method === "initialize") {
        const response = {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: "agent-pilot-mcp",
              version: "1.0.0"
            },
            capabilities: {
              tools: {}
            }
          }
        };
        process.stdout.write(JSON.stringify(response) + "\n");
        return;
      }

      if (method === "tools/list") {
        const response = {
          jsonrpc: "2.0",
          id,
          result: {
            tools: MCP_TOOLS
          }
        };
        process.stdout.write(JSON.stringify(response) + "\n");
        return;
      }

      if (method === "tools/call") {
        if (!params || typeof params !== "object" || !params.name) {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: id ?? null,
            error: { code: -32602, message: "Invalid params: missing tool name" }
          }) + "\n");
          return;
        }

        const { name, arguments: toolArgs = {} } = params;
        try {
          const res = await handleMcpToolCall(name, toolArgs);
          const isScreenshot = name === "browser_screenshot" && res?.dataUrl;

          let content = [];
          if (isScreenshot) {
            const base64Data = res.dataUrl.replace(/^data:image\/png;base64,/, "");
            content = [
              { type: "image", data: base64Data, mimeType: "image/png" },
              { type: "text", text: "Screenshot captured successfully" }
            ];
          } else {
            content = [
              { type: "text", text: typeof res === "object" ? JSON.stringify(res, null, 2) : String(res) }
            ];
          }

          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { content, isError: false }
          }) + "\n");
        } catch (callErr) {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `Error executing ${name}: ${callErr.message}` }],
              isError: true
            }
          }) + "\n");
        }
        return;
      }

      if (method === "notifications/initialized") {
        return;
      }

      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method '${method}' not found` }
      }) + "\n");
    } catch (parseErr) {
      console.error("[BridgeServer:MCP] Invalid JSON-RPC line:", parseErr);
      try {
        const rawObj = JSON.parse(line);
        if (rawObj && typeof rawObj === "object" && rawObj.id !== undefined) {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: rawObj.id,
            error: { code: -32603, message: `Internal error: ${parseErr.message}` }
          }) + "\n");
        }
      } catch (_) {}
    }
  });

  // Handle stdin close (MCP client disconnect) to prevent orphaned/zombie processes
  rl.on("close", () => {
    console.error("[BridgeServer] Stdin pipe closed (MCP client disconnected). Exiting cleanly...");
    if (!isForwarderMode) {
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      wss.close();
      server.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });

  // 1. Check if an existing Bridge Server is already active on PORT
  let serverAlreadyRunning = false;
  try {
    const checkRes = await fetch(`http://${CLIENT_HOST}:${PORT}/health`, { signal: AbortSignal.timeout(600) });
    const checkJson = await checkRes.json();
    if (checkJson && checkJson.status === "ok") {
      serverAlreadyRunning = true;
    }
  } catch (_) {}

  if (serverAlreadyRunning) {
    isForwarderMode = true;
    console.error("==================================================================");
    console.error(`🚀 AGENT PILOT - MULTI-AGENT COMPATIBLE MCP STDIO MODE`);
    console.error(`🔗 Shared Bridge Server detected on http://${HOST}:${PORT}`);
    console.error(`🎯 Running in Thin Stdio Forwarder Mode (Zero Port Collision)`);
    console.error("==================================================================");
  } else {
    // Start HTTP & WebSocket Server as Primary Master
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[BridgeServer:MCP] ⚡ Port ${PORT} busy (EADDRINUSE). Seamlessly switching to Thin Stdio Forwarder mode.`);
        isForwarderMode = true;
      } else {
        console.error("[BridgeServer] Server error:", err);
      }
    });

    server.listen(PORT, HOST, () => {
      console.error("==================================================================");
      console.error(`🚀 AGENT PILOT BRIDGE SERVER RUNNING (PRIMARY MASTER)`);
      console.error(`📡 WebSocket URL: ws://${HOST}:${PORT}`);
      console.error(`🌐 HTTP API URL : http://${HOST}:${PORT}/api`);
      console.error(`🎯 MCP Status   : Ready for Antigravity-First AI Agent Control`);
      console.error("==================================================================");
    });
  }

  // Graceful shutdown
  const shutdown = (signal) => {
    console.error(`\n[BridgeServer] ${signal} received. Shutting down...`);
    if (!isForwarderMode) {
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      wss.close();
      server.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGBREAK", () => shutdown("SIGBREAK")); // Windows Ctrl+Break
}

export { server, wss, PORT, HOST };
