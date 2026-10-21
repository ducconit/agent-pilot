import fs from "node:fs/promises";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import { outputPath, writeArtifact, boundedJSON } from "./artifacts.mjs";
import { analyzeTraceEvents } from "../extensions/background/cdp-performance.js";

const traces = new Map();
let activeTrace = null;

async function parseTrace(events) {
  const { TraceProcessor, TraceHandlers, Helpers } = await import("lighthouse/core/lib/trace-engine.js");
  Helpers.SyntheticEvents.SyntheticEventsManager.createAndActivate(events);
  const processor = new TraceProcessor(TraceHandlers);
  await processor.parse(events, { metadata: {}, resolveSourceMap: async () => null });
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
    await page.tracing.start({ categories });
    activeTrace = { key, filePath, started: Date.now() };
    if (options.reload) {
      try {
        if (options.ignoreCache) await page.setCacheEnabled(false);
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
  if (action !== "stop") throw new Error("Trace action must be start or stop");
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
