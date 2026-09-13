#!/usr/bin/env node
/**
 * Agent Pilot - Universal AI Agent Bridge Server
 * WebSocket Bridge & Model Context Protocol (MCP) Server - Antigravity First
 * Default Port: 58765 (Dynamic/Private range, collision-free)
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { WebSocketServer, WebSocket } from "ws";

let SERVER_VERSION = "1.0.1-beta";
try {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  if (pkg && pkg.version) SERVER_VERSION = pkg.version;
} catch (_) {}

const PORT = Number(process.env.AGENT_PILOT_PORT || process.env.PORT || 58765);
const HOST = process.env.AGENT_PILOT_HOST || "127.0.0.1";
const CLIENT_HOST = HOST === "0.0.0.0" || HOST === "::" ? "127.0.0.1" : HOST;

const connectedClients = new Map(); // id -> { id, ws, ip, connectedAt, lastActive, agent, version, details }
let activeClientId = null;
let pendingRequests = new Map();
let requestIdCounter = 1;
let lastSecretFilterState = true;
let pendingFeedbackWaiters = [];

export function getFeedbackStorageDir() {
  const agentPilotHome = process.env.AGENT_PILOT_HOME || path.join(os.homedir(), ".agent-pilot");
  return path.join(agentPilotHome, "inbox", "feedback");
}

export function saveFeedbackSession(payload) {
  const timestamp = String(payload.timestamp || Date.now());
  const feedbackDir = getFeedbackStorageDir();
  const sessionDir = path.join(feedbackDir, timestamp);
  fs.mkdirSync(sessionDir, { recursive: true });

  const items = Array.isArray(payload.items) ? payload.items : [];
  const savedItems = [];

  items.forEach((item, index) => {
    const itemNum = index + 1;
    let imageFileName = null;
    let imageAbsolutePath = null;

    if (item.screenshotDataUrl && item.screenshotDataUrl.startsWith("data:image/")) {
      const matches = item.screenshotDataUrl.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (matches) {
        const ext = matches[1] === "jpeg" ? "jpg" : "png";
        imageFileName = `item_${itemNum}.${ext}`;
        imageAbsolutePath = path.join(sessionDir, imageFileName);
        fs.writeFileSync(imageAbsolutePath, Buffer.from(matches[2], "base64"));
      }
    }

    savedItems.push({
      id: item.id || `item_${itemNum}`,
      mode: item.mode,
      title: item.title,
      comment: item.comment,
      dom: item.dom,
      component: item.component,
      clip: item.clip,
      annotations: item.annotations,
      imageFile: imageFileName,
      imagePath: imageAbsolutePath
    });
  });

  const sessionMetadata = {
    sessionId: timestamp,
    savedAt: new Date().toISOString(),
    url: payload.url || "",
    title: payload.title || "",
    count: savedItems.length,
    items: savedItems
  };
  fs.writeFileSync(path.join(sessionDir, "session.json"), JSON.stringify(sessionMetadata, null, 2), "utf-8");

  // Format prompt.md
  let promptMd = payload.prompt || "";
  if (!promptMd) {
    promptMd = `### 🎯 YÊU CẦU CHỈNH SỬA GIAO DIỆN (Agent Pilot Visual Feedback)\n\n`;
    promptMd += `- **URL**: \`${payload.url || ""}\`\n`;
    promptMd += `- **Tiêu đề trang**: "${payload.title || ""}"\n`;
    promptMd += `- **Thời gian ghi nhận**: ${new Date().toLocaleString("vi-VN")}\n`;
    promptMd += `- **Tổng số mục phản hồi**: ${savedItems.length}\n\n---\n\n`;

    savedItems.forEach((it, idx) => {
      promptMd += `#### Mục ${idx + 1}: [${(it.mode || "").toUpperCase()}] ${it.title}\n`;
      if (it.component) {
        promptMd += `- **Component Framework**: \`${it.component.framework || "React"}\`\n`;
        promptMd += `- **Component Name**: \`<${it.component.componentName} />\`\n`;
        if (it.component.fileName) {
          promptMd += `- **Đường dẫn tệp nguồn (Source File)**: \`${it.component.fileName}${it.component.lineNumber ? `:${it.component.lineNumber}` : ""}\`\n`;
        }
        if (it.component.hierarchy) {
          const hierStr = Array.isArray(it.component.hierarchy) ? it.component.hierarchy.join(" > ") : String(it.component.hierarchy);
          promptMd += `- **Cây Component**: \`${hierStr}\`\n`;
        }
      }
      if (it.dom) {
        promptMd += `- **CSS Selector**: \`${it.dom.selector || it.dom.tagName}\`\n`;
        if (it.dom.xpath) promptMd += `- **XPath**: \`${it.dom.xpath}\`\n`;
        if (it.dom.text) promptMd += `- **Nội dung text**: "${it.dom.text.replace(/\\n+/g, " ").slice(0, 150)}"\n`;
      }
      if (it.clip) {
        promptMd += `- **Tọa độ / Kích thước**: ${it.clip.width}×${it.clip.height}px (x: ${it.clip.x}, y: ${it.clip.y})\n`;
      }
      if (it.annotations && it.annotations.length) {
        promptMd += `- **Các điểm đánh dấu (Pins)**:\n`;
        it.annotations.forEach((ann, pinIdx) => {
          promptMd += `  - Điểm ${pinIdx + 1} (x:${ann.x}, y:${ann.y}): ${ann.comment || "Cần sửa vị trí này"}\n`;
        });
      }
      promptMd += `- **Yêu cầu chỉnh sửa của người dùng (User Note)**:\n  > ${(it.comment || "*(Không có ghi chú)*").replace(/\\n/g, "\n  > ")}\n\n`;
      if (it.imageFile) {
        promptMd += `- **Ảnh chụp thực tế**: \n  ![Mục ${idx + 1}](${it.imageFile})\n\n`;
      }
      promptMd += `---\n\n`;
    });
  } else {
    items.forEach((it, idx) => {
      const saved = savedItems[idx];
      if (saved?.imageFile && it?.screenshotDataUrl) {
        promptMd = promptMd.split(it.screenshotDataUrl).join(saved.imageFile);
      }
    });
  }
  fs.writeFileSync(path.join(sessionDir, "prompt.md"), promptMd, "utf-8");

  // Check if any Channel A waiters should be resolved
  checkAndNotifyFeedbackWaiters({
    sessionId: timestamp,
    sessionDir,
    metadata: sessionMetadata,
    promptMd
  });

  return {
    sessionId: timestamp,
    sessionDir,
    metadata: sessionMetadata,
    promptMd,
    savedItems
  };
}

export function getPendingFeedback(args = {}) {
  const feedbackDir = getFeedbackStorageDir();
  if (!fs.existsSync(feedbackDir)) {
    return {
      success: true,
      sessionsCount: 0,
      sessions: [],
      feedbackDir,
      message: "No pending feedback found"
    };
  }

  const dirs = fs.readdirSync(feedbackDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a, b) => Number(b) - Number(a));

  const limit = Number(args.limit) || 10;
  let targetIds = dirs;
  if (args.sessionId) {
    targetIds = dirs.filter(id => id === String(args.sessionId));
  }
  targetIds = targetIds.slice(0, limit);

  const sessions = [];
  for (const id of targetIds) {
    const sDir = path.join(feedbackDir, id);
    const metaPath = path.join(sDir, "session.json");
    const promptPath = path.join(sDir, "prompt.md");
    let meta = {};
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch (_) {}
    }
    let prompt = "";
    if (fs.existsSync(promptPath)) {
      try { prompt = fs.readFileSync(promptPath, "utf-8"); } catch (_) {}
    }

    sessions.push({
      sessionId: id,
      sessionDir: sDir,
      ...meta,
      prompt
    });

    if (args.clear) {
      const agentPilotHome = process.env.AGENT_PILOT_HOME || path.join(os.homedir(), ".agent-pilot");
      const archiveDir = path.join(agentPilotHome, "inbox", "feedback_archive");
      fs.mkdirSync(archiveDir, { recursive: true });
      try {
        fs.renameSync(sDir, path.join(archiveDir, id));
      } catch (_) {}
    }
  }

  return {
    success: true,
    sessionsCount: sessions.length,
    sessions,
    feedbackDir
  };
}

export function waitForFeedback(args = {}) {
  const timeoutSec = Math.min(600, Math.max(5, Number(args.timeout) || 120));
  return new Promise((resolve) => {
    const waiterId = "wait_" + Math.random().toString(36).substr(2, 9);
    const timer = setTimeout(() => {
      pendingFeedbackWaiters = pendingFeedbackWaiters.filter(w => w.id !== waiterId);
      resolve({
        success: false,
        timeout: true,
        message: `Timed out waiting for feedback after ${timeoutSec}s. Human user has not submitted feedback yet.`
      });
    }, timeoutSec * 1000);

    pendingFeedbackWaiters.push({
      id: waiterId,
      resolve,
      timer,
      tabId: args.tabId || null
    });
  });
}

export function checkAndNotifyFeedbackWaiters(feedbackData) {
  if (!pendingFeedbackWaiters.length) return;
  const waiters = [...pendingFeedbackWaiters];
  pendingFeedbackWaiters = [];

  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.resolve({
      success: true,
      delivered: true,
      channel: "reactive_channel_a",
      ...feedbackData
    });
  }
}

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
      version: SERVER_VERSION
    }));
    return;
  }

  // Helper to validate origin for loopback / extension requests
  const isOriginAllowed = (origin) => {
    if (!origin) return true;
    return origin.startsWith("chrome-extension://") ||
           origin.startsWith("http://127.0.0.1:") ||
           origin.startsWith("http://localhost:");
  };

  // HTTP API Endpoint for non-WebSocket scripts / curl
  if (req.url === "/api" && req.method === "POST") {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      res.writeHead(415, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unsupported Media Type: application/json required" }));
      return;
    }

    if (!isOriginAllowed(req.headers["origin"])) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden: Cross-origin request rejected" }));
      return;
    }

    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large (max 25MB)" }));
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

        // Direct feedback methods (Channel B & A)
        if (method === "feedback.save") {
          const result = saveFeedbackSession(params || {});
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: true, result }));
        }
        if (method === "feedback.pending") {
          const result = getPendingFeedback(params || {});
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: true, result }));
        }
        if (method === "feedback.push") {
          const result = saveFeedbackSession(params || {});
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: true, result }));
        }
        if (method === "feedback.wait") {
          const result = await waitForFeedback(params || {});
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: true, result }));
        }

        const result = await sendCommandToExtension(method, params, params?.timeoutMs);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, result: sanitizeServerData(result) }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Dedicated endpoint: Save feedback session to inbox (Channel B)
  if (req.url === "/api/feedback/save" && req.method === "POST") {
    if (!isOriginAllowed(req.headers["origin"])) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Forbidden" }));
    }
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large" }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      try {
        const payload = JSON.parse(body || "{}");
        const result = saveFeedbackSession(payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Dedicated endpoint: Get pending feedback sessions from inbox (Channel B)
  if ((req.url === "/api/feedback/pending" || req.url.startsWith("/api/feedback/pending?")) && (req.method === "GET" || req.method === "POST")) {
    if (!isOriginAllowed(req.headers["origin"])) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Forbidden" }));
    }
    const parseUrl = new URL(req.url, `http://${CLIENT_HOST}:${PORT}`);
    const queryParams = {
      sessionId: parseUrl.searchParams.get("sessionId") || undefined,
      limit: parseUrl.searchParams.get("limit") ? Number(parseUrl.searchParams.get("limit")) : undefined,
      clear: parseUrl.searchParams.get("clear") === "true"
    };

    if (req.method === "GET") {
      const result = getPendingFeedback(queryParams);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, ...result }));
    }

    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const postParams = JSON.parse(body || "{}");
        const result = getPendingFeedback({ ...queryParams, ...postParams });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Dedicated endpoint: Push live feedback (Channel A)
  if (req.url === "/api/feedback/push" && req.method === "POST") {
    if (!isOriginAllowed(req.headers["origin"])) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Forbidden" }));
    }
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large" }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      try {
        const payload = JSON.parse(body || "{}");
        const result = saveFeedbackSession(payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Dedicated endpoint: Wait for feedback long-poll (Channel A)
  if (req.url === "/api/feedback/wait" && req.method === "POST") {
    if (!isOriginAllowed(req.headers["origin"])) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Forbidden" }));
    }
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      if (res.writableEnded) return;
      try {
        const params = JSON.parse(body || "{}");
        const result = await waitForFeedback(params);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, ...result }));
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
    version: SERVER_VERSION,
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
        if (msg.secretFilterEnabled !== undefined) {
          lastSecretFilterState = Boolean(msg.secretFilterEnabled);
        }
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
      } else if (msg.type === "FEEDBACK_SUBMISSION") {
        clientInfo.lastActive = Date.now();
        const saved = saveFeedbackSession(msg.payload || {});
        console.error(`[BridgeServer] 🚀 Received live FEEDBACK_SUBMISSION from [${clientId}] - Session: ${saved.sessionId} (${saved.metadata?.count || 0} items)`);
        if (msg.id && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ id: msg.id, result: { success: true, sessionId: saved.sessionId, count: saved.metadata?.count } }));
        }
      } else if (msg.type === "FEEDBACK_SAVE") {
        clientInfo.lastActive = Date.now();
        const saved = saveFeedbackSession(msg.payload || {});
        console.error(`[BridgeServer] 💾 Saved FEEDBACK_SAVE from [${clientId}] - Session: ${saved.sessionId} (${saved.metadata?.count || 0} items)`);
        if (msg.id && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ id: msg.id, result: { success: true, sessionId: saved.sessionId, count: saved.metadata?.count } }));
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

// Secret & Private Key Masking for AI Agents (Defense-in-Depth)
const AGENT_SECURITY_NOTICE = "⚠️ [SECURITY NOTICE FOR AGENT] One or more sensitive credentials (API keys, private keys, or tokens) have been masked with asterisks (*) to protect secrets from leaking to LLM providers. Asterisks are redaction placeholders, NOT the literal key values. Do not attempt to use asterisks as credentials.";

const SERVER_SECRET_PATTERNS = [
  {
    name: "Private Key",
    regex: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    replacer: (match) => {
      const header = match.split("\n")[0] || "-----BEGIN PRIVATE KEY-----";
      const footer = match.trim().split("\n").pop() || "-----END PRIVATE KEY-----";
      return `${header}\n******************** [MASKED_SECRET: Private Key]\n${footer}`;
    }
  },
  {
    name: "OpenAI API Key",
    regex: /\b(?:sk-proj-[a-zA-Z0-9_-]{20,}|sk-admin-[a-zA-Z0-9_-]{20,}|sk-[a-zA-Z0-9]{20,48})\b/g,
    replacer: (match) => `${match.slice(0, 7)}******************** [MASKED_SECRET: OpenAI API Key]`
  },
  {
    name: "Anthropic API Key",
    regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,
    replacer: (match) => `${match.slice(0, 7)}******************** [MASKED_SECRET: Anthropic API Key]`
  },
  {
    name: "Google API Key",
    regex: /\bAIzaSy[a-zA-Z0-9_-]{33}\b/g,
    replacer: (match) => `${match.slice(0, 6)}******************** [MASKED_SECRET: Google API Key]`
  },
  {
    name: "GitHub Token",
    regex: /\b(?:ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{50,82})\b/g,
    replacer: (match) => `${match.slice(0, 4)}******************** [MASKED_SECRET: GitHub Token]`
  },
  {
    name: "AWS Access Key",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacer: (match) => `${match.slice(0, 4)}******************** [MASKED_SECRET: AWS Access Key]`
  },
  {
    name: "Stripe Key",
    regex: /\b(?:sk|pk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g,
    replacer: (match) => `${match.slice(0, 8)}******************** [MASKED_SECRET: Stripe Key]`
  },
  {
    name: "Slack Token",
    regex: /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/g,
    replacer: (match) => `${match.slice(0, 5)}******************** [MASKED_SECRET: Slack Token]`
  },
  {
    name: "JWT Token",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacer: () => "eyJ******************** [MASKED_SECRET: JWT Token]"
  },
  {
    name: "Bearer Token",
    regex: /\bBearer\s+([A-Za-z0-9-_.+/=]{20,})\b/gi,
    replacer: (match, token) => `Bearer ${(token || "").slice(0, 4)}******************** [MASKED_SECRET: Bearer Token]`
  },
  {
    name: "URL Secret Parameter",
    regex: /([?&](?:api_key|apikey|access_token|auth_token|token|password|passwd|secret)=)([^&\s]{6,})/gi,
    replacer: (match, paramKey) => `${paramKey}******************** [MASKED_SECRET: URL Parameter]`
  },
  {
    name: "Sensitive Key-Value",
    regex: /(["']?(?:password|passwd|secret|client_?secret|access_?token|auth_?token|api_?key)["']?\s*[:=]\s*["'])([^"'\\,\s]{6,})(["'])/gi,
    replacer: (match, prefix, secretVal, suffix) => {
      const p = secretVal.slice(0, 2);
      return `${prefix}${p}******************** [MASKED_SECRET: Sensitive Field]${suffix}`;
    }
  }
];

const SENSITIVE_PROP_REGEX = /^(?:password|passwd|secret|api_?key|access_?token|auth_?token|private_?key|client_?secret)$/i;

function maskServerString(text) {
  if (typeof text !== "string" || text.length < 6) return { text, masked: false, types: [] };
  if (text.includes("[MASKED_SECRET")) return { text, masked: false, types: [] };
  let result = text;
  let masked = false;
  const types = new Set();
  for (const p of SERVER_SECRET_PATTERNS) {
    p.regex.lastIndex = 0;
    if (p.regex.test(result)) {
      p.regex.lastIndex = 0;
      result = result.replace(p.regex, (...args) => {
        masked = true;
        types.add(p.name);
        return p.replacer(...args);
      });
    }
  }
  return { text: result, masked, types: Array.from(types) };
}

export function hasMaskedSecretNotice(data) {
  if (!data) return false;
  if (typeof data === "object") {
    if (data._securityNotice) return true;
    try {
      return JSON.stringify(data).includes("[MASKED_SECRET");
    } catch {
      return false;
    }
  }
  if (typeof data === "string") return data.includes("[MASKED_SECRET");
  return false;
}

export function sanitizeServerData(data, isEnabled = null) {
  const activeEnabled = isEnabled !== null ? Boolean(isEnabled) : lastSecretFilterState;
  if (!activeEnabled || data === null || data === undefined) return data;
  let totalMaskedCount = 0;
  const allMaskedTypes = new Set();
  const seen = new WeakSet();

  function walk(val, keyContext = "") {
    if (val === null || val === undefined) return val;
    if (typeof val === "string") {
      if (val.includes("[MASKED_SECRET")) return val;
      if (keyContext && SENSITIVE_PROP_REGEX.test(keyContext) && val.length >= 4) {
        totalMaskedCount++;
        allMaskedTypes.add(`Field:${keyContext}`);
        return `${val.slice(0, 2)}******************** [MASKED_SECRET: ${keyContext}]`;
      }
      const res = maskServerString(val);
      if (res.masked) {
        totalMaskedCount += res.types.length;
        res.types.forEach((t) => allMaskedTypes.add(t));
        return res.text;
      }
      return val;
    }
    if (typeof val === "number" || typeof val === "boolean" || typeof val === "symbol") return val;
    if (Array.isArray(val)) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
      return val.map((item) => walk(item, keyContext));
    }
    if (typeof val === "object") {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
      const copy = {};
      for (const [k, v] of Object.entries(val)) {
        copy[k] = walk(v, k);
      }
      return copy;
    }
    return val;
  }

  const sanitized = walk(data);
  if (totalMaskedCount > 0) {
    if (typeof sanitized === "string") {
      return `${sanitized}\n\n${AGENT_SECURITY_NOTICE}`;
    }
    if (sanitized && typeof sanitized === "object") {
      sanitized._securityNotice = AGENT_SECURITY_NOTICE;
      sanitized._maskedCount = (sanitized._maskedCount || 0) + totalMaskedCount;
      sanitized._maskedTypes = Array.from(new Set([...(sanitized._maskedTypes || []), ...allMaskedTypes]));
    }
  }
  return sanitized;
}

/**
 * Dispatch command to the Chrome Extension over WebSocket
 */
export function sendCommandToExtension(method, params = {}, timeoutMs = 15000) {
  if (method === "config.setSecretFilter" && params.enabled !== undefined) {
    lastSecretFilterState = Boolean(params.enabled);
  }
  const effectiveTimeout = Number(params?.timeoutMs) || (method === "batch.run" ? 45000 : timeoutMs);
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
        reject(new Error(`Command '${method}' timed out after ${effectiveTimeout}ms`));
      }
    }, effectiveTimeout);

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
    delete cleanParams.timeoutMs;
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
    description: "Retrieve real-time Chrome DevTools inspection data including Console logs, Network requests, and Performance metrics (JS Heap, DOM nodes, styles, layout)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Optional Tab ID. If omitted, uses the tab controlled by the agent or active tab" },
        type: {
          type: "string",
          enum: ["all", "console", "network", "performance"],
          description: "Data type to retrieve: 'all' (default), 'console' (logs/warnings/errors/traces), 'network' (HTTP requests/responses/failures), or 'performance' (JS heap size, node count, layout/style calculations)"
        },
        limit: {
          type: "integer",
          description: "Maximum number of console log or network entries to return (default: 50, max: 200)"
        },
        clear: {
          type: "boolean",
          description: "Optional: Clear buffer after reading so subsequent calls only return new events (default: false)"
        }
      }
    }
  },
  {
    name: "browser_pick_color",
    description: "Trigger the interactive magnifying loupe color picker on the page, or sample pixel color directly at (x, y)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Optional target Tab ID" },
        x: { type: "number", description: "Optional X coordinate to pick pixel color directly without opening interactive loupe" },
        y: { type: "number", description: "Optional Y coordinate to pick pixel color directly without opening interactive loupe" }
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
  },
  {
    name: "browser_run_actions",
    description: "Execute a batch sequence of browser actions in a single tool call to minimize LLM token usage and latency. Supports open_tab, navigate, wait_for_selector, scroll_into_view, click, type, press_key, scroll, sleep, screenshot, get_element, evaluate, cdp, and close_tab. Automatically scrolls off-screen elements into view before clicking or typing.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description: "Optional initial target Tab ID. Defaults to the tab opened in the batch or the current agent tab."
        },
        stopOnError: {
          type: "boolean",
          description: "Whether to halt the batch sequence immediately if any step fails (default: true).",
          default: true
        },
        actions: {
          type: "array",
          description: "Ordered array of actions to execute sequentially.",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "open",
                  "open_tab",
                  "navigate",
                  "close",
                  "close_tab",
                  "wait_for_selector",
                  "scroll_into_view",
                  "click",
                  "type",
                  "press_key",
                  "scroll",
                  "sleep",
                  "wait",
                  "screenshot",
                  "get_element",
                  "evaluate",
                  "cdp"
                ],
                description: "Type of action to execute"
              },
              url: { type: "string", description: "Target URL for open or navigate" },
              active: { type: "boolean", description: "Whether to make opened tab active (default false to avoid stealing user focus)", default: false },
              waitUntil: { type: "boolean", description: "Wait for page load complete on open/navigate (default true)", default: true },
              selector: { type: "string", description: "CSS selector for click, type, scroll_into_view, wait_for_selector, or get_element" },
              text: { type: "string", description: "Text to type into input field" },
              clear: { type: "boolean", description: "Clear existing text before typing (default false)", default: false },
              pressEnter: { type: "boolean", description: "Press Enter key after typing (default false)", default: false },
              key: { type: "string", description: "Key name to press for press_key (e.g. Enter, Escape, Tab)", default: "Enter" },
              x: { type: "number", description: "Target X pixel coordinate for click" },
              y: { type: "number", description: "Target Y pixel coordinate for click" },
              deltaX: { type: "number", description: "Horizontal scroll amount" },
              deltaY: { type: "number", description: "Vertical scroll amount (positive down, negative up)" },
              ms: { type: "number", description: "Duration in milliseconds for sleep/wait" },
              timeoutMs: { type: "number", description: "Timeout in milliseconds for wait_for_selector (default 5000)" },
              expression: { type: "string", description: "JavaScript expression to evaluate via CDP" },
              cdpMethod: { type: "string", description: "Chrome DevTools Protocol method name" },
              cdpParams: { type: "object", description: "Chrome DevTools Protocol parameters" },
              label: { type: "string", description: "Optional label for screenshot or step result" }
            },
            required: ["type"]
          }
        }
      },
      required: ["actions"]
    }
  },
  {
    name: "browser_get_pending_feedback",
    description: "Retrieve pending human visual UI feedback sessions saved in ~/.agent-pilot/inbox/feedback/<timestamp>/* (Channel B). Reads annotated component source files, CSS selectors, user notes, and screenshots recorded by human users.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Optional specific feedback session ID (timestamp). If omitted, returns latest sessions." },
        limit: { type: "integer", description: "Maximum number of feedback sessions to retrieve (default: 5)" },
        clear: { type: "boolean", description: "Whether to archive/clear the retrieved feedback sessions from the pending inbox (default: false)" }
      }
    }
  },
  {
    name: "browser_wait_for_feedback",
    description: "Wait reactively for human visual feedback (Channel A). Long-polls until the user submits feedback via Feedback Studio in the browser, or until timeout. Returns component source files, element selectors, user notes, and screenshots immediately upon submission.",
    inputSchema: {
      type: "object",
      properties: {
        timeout: { type: "integer", description: "Maximum seconds to wait for user feedback (default 120, min 5, max 600)" },
        tabId: { type: "integer", description: "Optional specific browser Tab ID to expect feedback from" }
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
  browser_set_busy: { method: "page.setBusy", getParams: (a) => a },
  browser_run_actions: { method: "batch.run", getParams: (a) => a },
  browser_get_pending_feedback: { method: "feedback.pending", getParams: (a) => a },
  browser_wait_for_feedback: { method: "feedback.wait", getParams: (a) => a }
});

async function handleMcpToolCall(name, args) {
  // Direct filesystem retrieval works identically across master and forwarder modes
  if (name === "browser_get_pending_feedback") {
    return getPendingFeedback(args);
  }

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

    case "browser_run_actions":
      return await sendCommandToExtension("batch.run", args);

    case "browser_get_pending_feedback":
      return getPendingFeedback(args);

    case "browser_wait_for_feedback":
      return await waitForFeedback(args);

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
              version: SERVER_VERSION
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
          const rawRes = await handleMcpToolCall(name, toolArgs);
          const res = sanitizeServerData(rawRes);
          let content = [];

          if (name === "browser_screenshot" && res?.dataUrl) {
            const base64Data = res.dataUrl.replace(/^data:image\/png;base64,/, "");
            content = [
              { type: "image", data: base64Data, mimeType: "image/png" },
              { type: "text", text: "Screenshot captured successfully" }
            ];
          } else if (name === "browser_run_actions" && res?.results) {
            const cleanRes = JSON.parse(JSON.stringify(res));
            for (const step of cleanRes.results) {
              if (step.dataUrl) {
                const base64Data = step.dataUrl.replace(/^data:image\/png;base64,/, "");
                content.push({
                  type: "image",
                  data: base64Data,
                  mimeType: "image/png"
                });
                step.dataUrl = `[base64 image captured: ${base64Data.length} chars]`;
              }
            }
            content.push({
              type: "text",
              text: JSON.stringify(cleanRes, null, 2)
            });
          } else if (name === "browser_get_pending_feedback" && res?.sessions) {
            content = [
              {
                type: "text",
                text: res.sessionsCount === 0
                  ? `No pending feedback sessions found in ${res.feedbackDir}.`
                  : `Found ${res.sessionsCount} pending feedback session(s) in ${res.feedbackDir}:\n\n` +
                    res.sessions.map((s, idx) => `=== SESSION ${idx + 1} (${s.sessionId}) ===\nURL: ${s.url}\nTitle: ${s.title}\nCount: ${s.count}\nDirectory: ${s.sessionDir}\n\n${s.prompt || ""}`).join("\n\n---\n\n")
              }
            ];
          } else if (name === "browser_wait_for_feedback") {
            if (res?.timeout) {
              content = [{ type: "text", text: res.message || "Timeout waiting for feedback." }];
            } else if (res?.promptMd || res?.metadata) {
              content = [
                {
                  type: "text",
                  text: `Received live feedback submission!\nSession ID: ${res.sessionId}\nDirectory: ${res.sessionDir}\nURL: ${res.metadata?.url}\nTitle: ${res.metadata?.title}\nItems count: ${res.metadata?.count}\n\n${res.promptMd || ""}`
                }
              ];
            } else {
              content = [{ type: "text", text: JSON.stringify(res, null, 2) }];
            }
          } else {
            content = [
              { type: "text", text: typeof res === "object" ? JSON.stringify(res, null, 2) : String(res) }
            ];
          }

          if (hasMaskedSecretNotice(res)) {
            const alreadyHasNotice = content.some(c => c.text && c.text.includes(AGENT_SECURITY_NOTICE));
            if (!alreadyHasNotice) {
              content.push({
                type: "text",
                text: AGENT_SECURITY_NOTICE
              });
            }
          }

          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { content, isError: Boolean(res && res.success === false) }
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
