#!/usr/bin/env node
/**
 * Agent Pilot - Universal AI Agent Bridge Server
 * WebSocket Bridge & Model Context Protocol (MCP) Server - Antigravity First
 * Default Port: 58765 (Dynamic/Private range, collision-free)
 */

import http from "node:http";
import readline from "node:readline";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.AGENT_PILOT_PORT || process.env.PORT || 58765);
const HOST = process.env.AGENT_PILOT_HOST || "127.0.0.1";

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

// 1. Create HTTP & WebSocket Server
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === "/" || req.url === "/health") {
    const active = getActiveClient();
    const clientsList = Array.from(connectedClients.values())
      .filter(c => c.ws && c.ws.readyState === WebSocket.OPEN)
      .map(c => ({
        instanceId: c.id,
        browser: c.details?.browser || "Chromium",
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
    details: { browser: "Chromium", windowCount: 1, activeTabTitle: "", activeTabUrl: "" }
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
        console.error(`[BridgeServer] 🤝 Handshake from ${clientInfo.agent} [${clientId}] (${clientInfo.details.browser}) - Tab: "${clientInfo.details.activeTabTitle}"`);
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

    client.ws.send(JSON.stringify({ id, method, params }));
  });
}

// 2. Model Context Protocol (MCP) Stdio Interface for Antigravity
const MCP_TOOLS = [
  {
    name: "browser_open_tab",
    description: "Open a new browser tab with the specified URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to navigate to (e.g. https://github.com)" }
      },
      required: ["url"]
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
    description: "Simulate virtual mouse movement and click at (x, y) coordinates or on a CSS selector",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Target X pixel coordinate" },
        y: { type: "number", description: "Target Y pixel coordinate" },
        selector: { type: "string", description: "Optional CSS selector to click" }
      }
    }
  },
  {
    name: "browser_type",
    description: "Simulate human-like typing into an input or textarea element",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the input field" },
        text: { type: "string", description: "Text string to type" },
        delay: { type: "number", description: "Typing delay between keys in ms (default 50)" }
      },
      required: ["selector", "text"]
    }
  },
  {
    name: "browser_scroll",
    description: "Scroll the active web page smoothly",
    inputSchema: {
      type: "object",
      properties: {
        deltaX: { type: "number", description: "Horizontal scroll amount" },
        deltaY: { type: "number", description: "Vertical scroll amount (e.g. 300 to scroll down)" }
      }
    }
  },
  {
    name: "browser_get_element",
    description: "Inspect a DOM element, returning bounding box, dimensions, CSS selector, and XPath",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector to inspect" }
      },
      required: ["selector"]
    }
  },
  {
    name: "browser_screenshot",
    description: "Capture a screenshot of the visible tab or specific region (returns PNG data)",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["visible", "region"], description: "Screenshot mode" }
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
      properties: {}
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
  }
];

async function handleMcpToolCall(name, args) {
  switch (name) {
    case "browser_open_tab":
      return await sendCommandToExtension("tabs.create", { url: args.url });

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

    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}

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
  wss.close();
  server.close(() => process.exit(0));
});

// Start HTTP & WebSocket Server
server.listen(PORT, HOST, () => {
  console.error("==================================================================");
  console.error(`🚀 AGENT PILOT BRIDGE SERVER RUNNING`);
  console.error(`📡 WebSocket URL: ws://${HOST}:${PORT}`);
  console.error(`🌐 HTTP API URL : http://${HOST}:${PORT}/api`);
  console.error(`🎯 MCP Status   : Ready for Antigravity-First AI Agent Control`);
  console.error("==================================================================");
});

// Graceful shutdown
const shutdown = (signal) => {
  console.error(`\n[BridgeServer] ${signal} received. Shutting down...`);
  wss.close();
  server.close(() => process.exit(0));
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export { server, wss, PORT, HOST };
