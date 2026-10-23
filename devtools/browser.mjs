import puppeteer from "puppeteer-core";
import { randomUUID } from "node:crypto";
import { resolveChromiumBin } from "../scripts/browser_resolver.mjs";
import { BridgeTransport } from "./transport.mjs";
import { normalizeUrl } from "../extensions/background/constants.js";

export class Browsers {
  constructor(extension) {
    this.extension = extension;
    this.relays = new Map();
    this.contexts = new Map();
    this.tabs = new Map();
    this.nextTab = -Date.now() * 1000;
  }
  owner(params) { return params.agentId || "cli"; }
  async browser(options) {
    if (!this.managedBrowser) {
      this.managedBrowser = await puppeteer.launch({
        executablePath: resolveChromiumBin(), headless: options.headless ?? false,
        pipe: true, defaultViewport: null,
        args: process.env.AGENT_PILOT_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : []
      });
      this.managedBrowser.on("disconnected", () => {
        this.managedBrowser = null; this.contexts.clear(); this.tabs.clear();
      });
    }
    return this.managedBrowser;
  }
  async context(action, params) {
    const owner = this.owner(params);
    if (action === "list") return { contexts: [...this.contexts].filter(([, c]) => c.owner === owner).map(([contextId, c]) => ({ contextId, name: c.name, tabs: [...this.tabs].filter(([, t]) => t.contextId === contextId).map(([tabId]) => tabId) })) };
    if (action === "create") {
      const browser = await this.browser(params);
      const name = params.name || params.isolatedContext || randomUUID();
      if ([...this.contexts.values()].some(c => c.owner === owner && c.name === name)) throw new Error(`Context already exists: ${name}`);
      const contextId = randomUUID();
      const context = await browser.createBrowserContext();
      if (params.permissions?.length) {
        if (!params.origin) { await context.close(); throw new Error("origin is required with permissions"); }
        try { await context.overridePermissions(params.origin, params.permissions); }
        catch (error) { await context.close(); throw error; }
      }
      this.contexts.set(contextId, { context, owner, name });
      return { contextId, name, isolated: true };
    }
    const entry = this.contexts.get(params.contextId);
    if (!entry || entry.owner !== owner) throw new Error("Context not found for this agent");
    if (action !== "close") throw new Error(`Unknown context action: ${action}`);
    await entry.context.close(); this.contexts.delete(params.contextId);
    for (const [id, tab] of this.tabs) if (tab.contextId === params.contextId) this.tabs.delete(id);
    return { success: true, contextId: params.contextId };
  }
  async open(params) {
    let contextId = params.contextId;
    if (!contextId && params.isolatedContext) {
      contextId = [...this.contexts].find(([, c]) => c.owner === this.owner(params) && c.name === params.isolatedContext)?.[0];
      if (!contextId) contextId = (await this.context("create", { ...params, name: params.isolatedContext })).contextId;
    }
    const entry = this.contexts.get(contextId);
    if (!entry || entry.owner !== this.owner(params)) throw new Error("Context not found for this agent");
    const page = await entry.context.newPage();
    if (params.username !== undefined) await page.authenticate({ username: String(params.username), password: String(params.password || "") });
    const tabId = this.nextTab--;
    const tab = { page, tabId, contextId, owner: entry.owner, refs: new Map(), console: [], requests: new Map(), emulation: {} };
    this.tabs.set(tabId, tab);
    page.on("close", () => this.tabs.delete(tabId));
    page.on("dialog", dialog => { tab.dialog = dialog; });
    page.on("console", message => {
      tab.console.push({ type: message.type(), text: message.text(), location: message.location(), timestamp: Date.now() });
      if (tab.console.length > 1000) tab.console.shift();
    });
    page.on("pageerror", error => tab.console.push({ type: "error", text: error.message, stack: error.stack, timestamp: Date.now() }));
    const client = await page.createCDPSession();
    tab.client = client;
    await client.send("Network.enable");
    client.on("Network.requestWillBeSent", event => {
      // Keep request listings small. Consumers can retrieve the upload body
      // explicitly through network.getResponseBody when they need it.
      tab.requests.set(event.requestId, { id: event.requestId, url: event.request.url, method: event.request.method, type: event.type, requestHeaders: event.request.headers, status: "pending" });
      if (tab.requests.size > 1000) tab.requests.delete(tab.requests.keys().next().value);
    });
    client.on("Network.responseReceived", event => { const req = tab.requests.get(event.requestId); if (req) Object.assign(req, { status: event.response.status, responseHeaders: event.response.headers, mimeType: event.response.mimeType }); });
    client.on("Network.loadingFailed", event => { const req = tab.requests.get(event.requestId); if (req) Object.assign(req, { status: "failed", errorText: event.errorText }); });
    try { await page.goto(normalizeUrl(params.url || "about:blank"), { waitUntil: params.waitUntil === false ? "domcontentloaded" : "load", timeout: params.timeoutMs || 30000 }); }
    catch (error) { await page.close(); throw error; }
    return { id: tabId, tabId, contextId, url: page.url(), title: await page.title() };
  }
  async get(params) {
    let id = Number(params.tabId ?? params.agentLastTabId);
    if (params.contextId && !params.tabId) id = [...this.tabs.values()].filter(t => t.contextId === params.contextId && t.owner === this.owner(params)).at(-1)?.tabId;
    if (id < 0) {
      const tab = this.tabs.get(id);
      if (!tab || tab.owner !== this.owner(params) || (params.contextId && params.contextId !== tab.contextId)) throw new Error("Isolated tab not found for this agent");
      return tab;
    }
    if (params.contextId) throw new Error("No tab in this isolated context; open a tab with contextId first");
    const request = (method, values) => this.extension(method, { ...values, instanceId: params.instanceId, agentId: params.agentId });
    const tabInfo = await request("devtools.protocol.open", { tabId: id || undefined });
    const key = `${params.instanceId}:${tabInfo.tabId}`;
    if (!this.relays.has(key)) {
      const transport = new BridgeTransport(tabInfo, request);
      this.relays.set(key, { transport, connecting: true });
      try {
        const browser = await puppeteer.connect({ transport, defaultViewport: null, protocolTimeout: 120000, networkEnabled: false, issuesEnabled: false });
        const [page] = await browser.pages();
        if (!page) throw new Error("Could not attach Puppeteer to the extension tab");
        const tab = { ...tabInfo, page, browser, transport, key, refs: new Map(), client: page._client() };
        this.relays.set(key, tab);
      } catch (error) { transport.close(); this.relays.delete(key); await request("devtools.protocol.close", { tabId: tabInfo.tabId }).catch(() => {}); throw error; }
    }
    return this.relays.get(key);
  }
  event(event) {
    const key = `${event.instanceId}:${event.tabId}`;
    const relay = this.relays.get(key);
    if (!relay) return;
    if (event.type === "DEVTOOLS_PROTOCOL_CLOSED") { relay.transport.close(); this.relays.delete(key); }
    else relay.transport.event(event.source || {}, event.method, event.params);
  }
  async close() {
    for (const tab of this.relays.values()) { tab.transport.close(); tab.browser?.disconnect(); }
    await this.managedBrowser?.close().catch(() => {});
  }
}
