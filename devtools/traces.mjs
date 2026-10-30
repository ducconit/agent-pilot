import fs from "node:fs/promises";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import { outputPath, writeArtifact, boundedJSON } from "./artifacts.mjs";
import { analyzeTraceEvents } from "../extensions/background/cdp-performance.js";

const traces = new Map();
let activeTrace = null;

/**
 * Chrome 156+ no longer emits `TracingStartedInBrowser`, which the trace
 * engine relies on to identify the main frame. It emits `markAsMainFrame`
 * instead. Synthesize the legacy event so the engine can attribute main-frame
 * navigations and compute insight sets.
 */
function normalizeTraceEvents(events) {
  if (!Array.isArray(events)) return events;
  const hasTracingStarted = events.some(e => e?.name === "TracingStartedInBrowser");
  if (hasTracingStarted) return events;
  let frameId = events.find(e => e?.name === "markAsMainFrame")?.args?.frame;
  let pid = events.find(e => e?.name === "markAsMainFrame")?.pid;
  let tid = events.find(e => e?.name === "markAsMainFrame")?.tid;
  let ts = events.find(e => e?.name === "markAsMainFrame")?.ts;
  if (!frameId) {
    const nav = events.find(e => e?.name === "navigationStart" && e?.args?.frame);
    frameId = nav?.args?.frame;
    pid = nav?.pid ?? pid;
    tid = nav?.tid ?? tid;
    ts = nav?.ts ?? ts;
  }
  if (!frameId) return events;
  const normalized = [...events];
  const synthetic = {
    name: "TracingStartedInBrowser",
    cat: "disabled-by-default-devtools.timeline",
    ph: "I",
    pid: pid ?? 0,
    tid: tid ?? 0,
    ts: Math.max(0, (ts || 0) - 1000),
    args: {
      data: {
        frames: [{
          frame: frameId,
          url: "",
          processId: pid ?? 0,
          parent: null,
          isInPrimaryMainFrame: true,
          isOutermostMainFrame: true
        }]
      }
    }
  };
  normalized.unshift(synthetic);
  return normalized;
}

async function parseTrace(events) {
  const { TraceProcessor, TraceHandlers, Helpers } = await import("lighthouse/core/lib/trace-engine.js");
  const normalized = normalizeTraceEvents(events);
  Helpers.SyntheticEvents.SyntheticEventsManager.createAndActivate(normalized);
  const processor = new TraceProcessor(TraceHandlers);
  await processor.parse(normalized, { metadata: {}, resolveSourceMap: async () => null });
  return processor.insights || new Map();
}
function listInsights(insights) {
  return [...insights].map(([insightSetId, set]) => ({ insightSetId, url: set.url, insights: Object.entries(set.model || {}).map(([name, model]) => ({ name, title: model.title, state: model.state, description: model.description, error: model instanceof Error ? model.message : undefined })) }));
}

export async function performanceTrace(page, key, options) {
  const action = options.action || "start";
  if (action === "start") {
    if (activeTrace) throw new Error("A trace is already running; stop it before starting another");
    const requested = options.filePath || options.path;
    const filePath = await outputPath(requested, requested?.endsWith(".gz") ? ".json.gz" : ".json", "trace");
    await fs.access(filePath).then(() => { throw new Error(`File exists: ${filePath}`); }, error => { if (error.code !== "ENOENT") throw error; });
    const categories = options.categories ? options.categories.split(",").map(c => c.trim()) : ["-*", "devtools.timeline", "v8.execute", "blink.user_timing", "loading", "latencyInfo", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "disabled-by-default-devtools.timeline.stack", "disabled-by-default-v8.cpu_profiler"];
    const client = page.mainFrame()?.client || page._client?.();
    if (client) {
      await client.send("Page.enable", {}).catch(() => {});
      await client.send("Page.setLifecycleEventsEnabled", { enabled: true }).catch(() => {});
    }
    await page.tracing.start({ categories });
    activeTrace = { key, filePath, started: Date.now() };
    if (options.reload) {
      try {
        if (options.ignoreCache) await page.setCacheEnabled(false);
        // Let TracingStartedInBrowser settle before the navigation commit event
        // so Lighthouse TraceProcessor always precedes NavigationStart in time.
        await new Promise(resolve => setTimeout(resolve, 60));
        await page.reload({ waitUntil: "load" });
      } catch (error) {
        await page.tracing.stop().catch(() => {}); activeTrace = null; throw error;
      } finally { if (options.ignoreCache) await page.setCacheEnabled(true); }
    }
    if (options.autoStop) {
      await new Promise(resolve => setTimeout(resolve, Math.min(30000, Math.max(1000, options.durationMs || 5000))));
      return performanceTrace(page, key, { ...options, action: "stop" });
    }
    return { success: true, action, filePath, categories };
  }
  if (action !== "stop") throw new Error("Trace action must be stop");
  if (!activeTrace || activeTrace.key !== key) throw new Error("No active trace for this tab");
  const session = activeTrace;
  let data;
  try { data = await page.tracing.stop(); } finally { activeTrace = null; }
  if (!data) throw new Error("Chrome returned no trace data");
  const raw = Buffer.from(data);
  const filePath = options.filePath ? await outputPath(options.filePath, options.filePath.endsWith(".gz") ? ".json.gz" : ".json", "trace") : session.filePath;
  const artifact = await writeArtifact(filePath, filePath.endsWith(".gz") ? zlib.gzipSync(raw) : raw);
  const events = JSON.parse(raw.toString()).traceEvents || [];
  const id = randomUUID();
  let insights = new Map(), analysisError;
  try { insights = await parseTrace(events); } catch (error) { analysisError = error.message; }
  traces.set(id, { insights, filePath });
  if (traces.size > 5) traces.delete(traces.keys().next().value);
  const analysis = analyzeTraceEvents(events);
  return { success: true, traceId: id, durationMs: Date.now() - session.started, ...artifact, totalEvents: events.length, truncated: false, insights: { breakdownMs: analysis.breakdownMs, longTasks: analysis.longTasks, forcedReflows: analysis.forcedReflows, hotScripts: analysis.hotScripts, bottlenecks: analysis.bottlenecks }, insightSets: listInsights(insights), analysisError };
}

export async function analyzeInsight(options) {
  let trace = traces.get(options.traceId);
  if (!trace && options.filePath) {
    let raw = await fs.readFile(options.filePath);
    if (raw[0] === 0x1f && raw[1] === 0x8b) raw = zlib.gunzipSync(raw);
    const parsed = JSON.parse(raw.toString());
    trace = { insights: await parseTrace(parsed.traceEvents || parsed), filePath: options.filePath };
  }
  if (!trace) throw new Error("Trace not found; supply traceId or filePath");
  if (!options.insightName) return { insightSets: listInsights(trace.insights), filePath: trace.filePath };
  let set = trace.insights.get(options.insightSetId);
  if (!set && trace.insights.size === 1 && !options.insightSetId) set = trace.insights.values().next().value;
  if (!set) throw new Error("Unknown insightSetId; list available insight sets first");
  const model = set.model[options.insightName];
  if (!model) throw new Error(`Unknown insightName: ${options.insightName}`);
  return { insightName: options.insightName, insightSetId: options.insightSetId, model: boundedJSON(model, { maxItems: options.maxItems || 50, maxDepth: 8 }), filePath: trace.filePath };
}