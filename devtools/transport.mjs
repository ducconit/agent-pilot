/** CDP transport over the extension bridge (no Chrome debugging port required).
 * Virtual browser/tab targets follow Puppeteer's ExtensionTransport model.
 * A separate virtual page session lets Lighthouse create its own CDPSession.
 */
export class BridgeTransport {
  constructor(tab, request) {
    this.tab = tab;
    this.request = request;
    this.pageSessions = new Set(["ap-page"]);
    this.closed = false;
    this.tabAttached = false;
  }
  dispatch(message) {
    if (!this.closed) setImmediate(() => this.onmessage?.(JSON.stringify(message)));
  }
  target(type) {
    return { targetId: `ap-${type}`, type, title: this.tab.title || "", url: this.tab.url || "about:blank", attached: true, canAccessOpener: false };
  }
  event(source, method, params) {
    if (this.closed) return;
    if (source.sessionId) this.dispatch({ sessionId: source.sessionId, method, params });
    else for (const sessionId of this.pageSessions) this.dispatch({ sessionId, method, params });
  }
  async send(text) {
    const message = JSON.parse(text);
    const { id, method, params = {}, sessionId } = message;
    if (process.env.AGENT_PILOT_DEVTOOLS_DEBUG) console.error("[DevTools CDP]", method, sessionId || "browser");
    const reply = result => this.dispatch({ id, sessionId, result: result || {} });
    try {
      if (method === "Browser.getVersion") {
        const userAgent = this.tab.userAgent || "";
        const version = userAgent.match(/(?:Headless)?Chrome\/([\d.]+)/)?.[1] || "0";
        return reply({ protocolVersion: "1.3", product: `Chrome/${version}`, revision: "unknown", userAgent, jsVersion: "unknown" });
      }
      if (method === "Target.getBrowserContexts") return reply({ browserContextIds: [] });
      if (method === "Target.setDiscoverTargets") {
        for (const type of ["tab", "page"]) this.dispatch({ method: "Target.targetCreated", params: { targetInfo: this.target(type) } });
        return reply({});
      }
      if (method === "Target.setAutoAttach" && !sessionId) {
        if (!this.tabAttached && params.autoAttach) {
          this.tabAttached = true;
          this.dispatch({ method: "Target.attachedToTarget", params: { targetInfo: this.target("tab"), sessionId: "ap-tab", waitingForDebugger: false } });
        }
        return reply({});
      }
      if (method === "Target.setAutoAttach" && sessionId === "ap-tab") {
        if (!this.pageAttached && params.autoAttach) {
          this.pageAttached = true;
          this.dispatch({ sessionId, method: "Target.attachedToTarget", params: { targetInfo: this.target("page"), sessionId: "ap-page", waitingForDebugger: false } });
        }
        return reply({});
      }
      if (method === "Target.attachToTarget" && params.targetId === "ap-page") {
        const attachedId = `ap-page-${id}`;
        this.pageSessions.add(attachedId);
        this.dispatch({ method: "Target.attachedToTarget", params: { targetInfo: this.target("page"), sessionId: attachedId, waitingForDebugger: false } });
        return reply({ sessionId: attachedId });
      }
      if (method === "Target.detachFromTarget" && this.pageSessions.has(params.sessionId)) {
        this.pageSessions.delete(params.sessionId);
        this.dispatch({ method: "Target.detachedFromTarget", params: { sessionId: params.sessionId, targetId: "ap-page" } });
        return reply({});
      }
      if (method === "Target.getTargetInfo" && (!params.targetId || params.targetId === "ap-page")) return reply({ targetInfo: this.target("page") });
      if (method === "Browser.close" || method === "Target.closeTarget") throw new Error("The extension transport cannot close the browser; use browser_close_tab");
      const result = await this.request("devtools.protocol.send", {
        tabId: this.tab.tabId, cdpMethod: method, cdpParams: params,
        ...(sessionId && !this.pageSessions.has(sessionId) ? { sessionId } : {})
      });
      reply(result);
    } catch (error) { this.dispatch({ id, sessionId, error: { code: -32000, message: error.message } }); }
  }
  close() { this.closed = true; this.onclose?.(); }
}
