/**
 * Agent Pilot - CDP Performance, Core Web Vitals, Trace Insights & Memory Leak Detector
 *
 * Provides deep website debugging telemetry:
 *   1. Runtime & Core Web Vitals metrics (TTFB, FCP, LCP, CLS, TBT, DOM health, Resource bottlenecks)
 *   2. Timeline trace bottleneck analyzer (Scripting/Rendering/Painting breakdown, Long Tasks, Forced Reflows, Hot Scripts)
 *   3. V8 Heap Snapshot parser & baseline/diff memory leak detector (Detached DOM nodes, growing constructors, listener leaks)
 */

import { activeTracingSessions, attachedTabs, devtoolsBuffers, memoryBaselines, TIMEOUTS, logDebug } from "./constants.js";
import { sendCdpCommand } from "./cdp-connection.js";

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;
const LONG_TASK_THRESHOLD_MS = 50;
const DEFAULT_DOM_PROBE_TIMEOUT_MS = 4500;

function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100;
}

function rateMetric(value, goodMax, poorMin) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "unknown";
  }
  const n = Number(value);
  if (n <= goodMax) return "good";
  if (n <= poorMin) return "needs-improvement";
  return "poor";
}

function getRuntimeErrorsSummary(tabId) {
  const buf = devtoolsBuffers.get(tabId);
  if (!buf) {
    return { count: 0, consoleErrorCount: 0, pageErrorCount: 0, recent: [] };
  }
  const consoleList = Array.isArray(buf.console) ? buf.console : [];
  const errorList = Array.isArray(buf.errors) ? buf.errors : [];
  const combined = [];
  const seen = new Set();
  let consoleErrorCount = 0;
  let pageErrorCount = 0;

  for (const item of consoleList) {
    if (!item) continue;
    const type = String(item.type || item.level || "").toLowerCase();
    if (type !== "error" && type !== "exception" && type !== "assert") {
      continue;
    }
    const text = String(item.text || item.message || "").trim();
    if (!text) continue;
    consoleErrorCount++;
    const dedupeKey = `${type}:${text}:${item.timestamp || 0}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    combined.push({
      type,
      text: text.slice(0, 300),
      url: item.url || undefined,
      lineNumber: item.lineNumber ?? undefined,
      timestamp: item.timestamp || undefined
    });
  }

  for (const item of errorList) {
    if (!item) continue;
    const type = String(item.type || item.level || "exception").toLowerCase();
    const text = String(item.text || item.message || "").trim();
    if (!text) continue;
    pageErrorCount++;
    const dedupeKey = `${type}:${text}:${item.timestamp || 0}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    combined.push({
      type,
      text: text.slice(0, 300),
      url: item.url || undefined,
      lineNumber: item.lineNumber ?? undefined,
      timestamp: item.timestamp || undefined
    });
  }

  return {
    count: combined.length,
    consoleErrorCount,
    pageErrorCount,
    recent: combined.slice(-5)
  };
}

/**
 * Probe Core Web Vitals, Resource timings, and DOM/A11y health in the page's MAIN world.
 * Uses buffered PerformanceObservers so LCP, CLS, Long Tasks, and INP are captured
 * without triggering Chromium's getEntriesByType deprecation warnings, and filters out
 * Agent Pilot's own injected overlay nodes from DOM health & duplicate ID checks.
 * Bounded by an internal timeout so frozen/blocked main threads do not hang metrics calls.
 */
async function collectPageWebVitalsAndDomProbe(tabId, timeoutMs = DEFAULT_DOM_PROBE_TIMEOUT_MS) {
  if (typeof chrome === "undefined" || !chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
    return null;
  }
  const effectiveTimeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_DOM_PROBE_TIMEOUT_MS;
  let timerId = null;
  try {
    const scriptPromise = chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        try {
          const isAgentPilotElement = (el) => {
            if (!el || typeof el !== "object") return false;
            const id = typeof el.id === "string" ? el.id : "";
            if (id.startsWith("agent-pilot-") || id === "ap-draft-badge") return true;
            const cls = typeof el.className === "string" ? el.className : "";
            if (
              cls.includes("agent-pilot-") ||
              /\bap-(badge|pinned-box|pinned-badge|draft-badge)\b/.test(cls)
            ) {
              return true;
            }
            if (
              typeof el.closest === "function" &&
              el.closest(
                '[id^="agent-pilot-"], .agent-pilot-virtual-cursor, .agent-pilot-toast, .agent-pilot-feedback-pinned-layer'
              )
            ) {
              return true;
            }
            return false;
          };

          const describeNode = (el) => {
            if (!el || !el.tagName || isAgentPilotElement(el)) return null;
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : "";
            const cls =
              typeof el.className === "string" && el.className.trim()
                ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
                : "";
            return `${tag}${id}${cls}`;
          };

          const perf = window.performance;
          const navEntries = perf && typeof perf.getEntriesByType === "function" ? perf.getEntriesByType("navigation") : [];
          const nav = navEntries && navEntries[0] ? navEntries[0] : null;
          const paintEntries = perf && typeof perf.getEntriesByType === "function" ? perf.getEntriesByType("paint") : [];
          const fcpEntry = (paintEntries || []).find((e) => e.name === "first-contentful-paint");

          // Install or read buffered PerformanceObserver state to avoid deprecated getEntriesByType("largest-contentful-paint" | "layout-shift" | "longtask")
          let lcpEntries = [];
          let layoutShiftEntries = [];
          let longTaskEntries = [];
          let eventEntries = [];

          if (typeof PerformanceObserver === "function") {
            const supported = Array.isArray(PerformanceObserver.supportedEntryTypes)
              ? PerformanceObserver.supportedEntryTypes
              : null;
            const canObserve = (type) => !supported || supported.includes(type);

            if (!window.__AP_PERF_OBSERVER_STATE__) {
              const state = {
                lcpEntries: [],
                layoutShiftEntries: [],
                longTaskEntries: [],
                eventEntries: [],
                pushCapped(list, entries, max = 250) {
                  for (const e of entries) {
                    list.push(e);
                    if (list.length > max) list.shift();
                  }
                }
              };
              window.__AP_PERF_OBSERVER_STATE__ = state;

              const observeBuffered = (type, targetList, extraOpts = {}) => {
                if (!canObserve(type)) return;
                try {
                  const obs = new PerformanceObserver((list) => {
                    state.pushCapped(targetList, list.getEntries());
                  });
                  obs.observe({ type, buffered: true, ...extraOpts });
                } catch (_) {}
              };

              observeBuffered("largest-contentful-paint", state.lcpEntries);
              observeBuffered("layout-shift", state.layoutShiftEntries);
              observeBuffered("longtask", state.longTaskEntries);
              observeBuffered("event", state.eventEntries, { durationThreshold: 16 });

              // Allow buffered PerformanceObserver entries to flush on newly observed page
              await new Promise((resolve) => setTimeout(resolve, 40));
            }

            const state = window.__AP_PERF_OBSERVER_STATE__;
            lcpEntries = state.lcpEntries || [];
            layoutShiftEntries = state.layoutShiftEntries || [];
            longTaskEntries = state.longTaskEntries || [];
            eventEntries = state.eventEntries || [];
          } else if (perf && typeof perf.getEntriesByType === "function") {
            lcpEntries = perf.getEntriesByType("largest-contentful-paint") || [];
            layoutShiftEntries = perf.getEntriesByType("layout-shift") || [];
            longTaskEntries = perf.getEntriesByType("longtask") || [];
          }

          const lastLcp = lcpEntries && lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1] : null;

          let clsScore = 0;
          const clsCulprits = [];
          for (const entry of layoutShiftEntries || []) {
            if (!entry.hadRecentInput && typeof entry.value === "number") {
              clsScore += entry.value;
              if (Array.isArray(entry.sources)) {
                for (const src of entry.sources) {
                  const desc = describeNode(src.node);
                  if (desc && !clsCulprits.includes(desc) && clsCulprits.length < 5) {
                    clsCulprits.push(desc);
                  }
                }
              }
            }
          }

          let totalBlockingTimeMs = 0;
          let maxLongTaskMs = 0;
          const topLongTasks = [];
          for (const lt of longTaskEntries || []) {
            const dur = Number(lt.duration) || 0;
            if (dur > 50) {
              totalBlockingTimeMs += dur - 50;
              if (dur > maxLongTaskMs) maxLongTaskMs = dur;
              topLongTasks.push({
                name: lt.name || "longtask",
                startTimeMs: Math.round(lt.startTime || 0),
                durationMs: Math.round(dur)
              });
            }
          }
          topLongTasks.sort((a, b) => b.durationMs - a.durationMs);

          // Interaction to Next Paint (INP) from Event Timing API
          let maxInteractionMs = undefined;
          let slowestInteraction = undefined;
          for (const ev of eventEntries || []) {
            const isInteraction =
              (typeof ev.interactionId === "number" && ev.interactionId > 0) ||
              ev.name === "click" ||
              ev.name === "keydown" ||
              ev.name === "pointerup";
            if (!isInteraction) continue;
            const dur = Number(ev.duration) || 0;
            if (maxInteractionMs === undefined || dur > maxInteractionMs) {
              maxInteractionMs = Math.round(dur);
              slowestInteraction = {
                name: ev.name || "interaction",
                durationMs: Math.round(dur),
                target: describeNode(ev.target) || undefined
              };
            }
          }

          // Resource bottlenecks
          const resourceEntries =
            perf && typeof perf.getEntriesByType === "function" ? perf.getEntriesByType("resource") : [];
          let totalTransferBytes = 0;
          const renderBlockingUrls = [];
          const slowList = [];
          for (const r of resourceEntries || []) {
            const transfer = Number(r.transferSize) || Number(r.encodedBodySize) || 0;
            totalTransferBytes += transfer;
            if (r.renderBlockingStatus === "blocking" && renderBlockingUrls.length < 10) {
              renderBlockingUrls.push(r.name);
            }
            slowList.push({
              url: String(r.name || "").slice(0, 180),
              initiatorType: r.initiatorType || "other",
              durationMs: Math.round(r.duration || 0),
              transferKB: Math.round((transfer / 1024) * 10) / 10
            });
          }
          slowList.sort((a, b) => b.durationMs - a.durationMs);

          // DOM & Accessibility health scan (excluding Agent Pilot's own injected UI nodes)
          const allElements = document.querySelectorAll("*");
          let totalPageElements = 0;
          let maxDepth = 0;
          let maxChildrenCount = 0;
          let maxChildrenSelector = "";
          const idCounts = new Map();
          let imagesMissingAlt = 0;
          let unlabelledInputs = 0;
          let iframeCount = 0;

          for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            if (isAgentPilotElement(el)) continue;
            totalPageElements++;

            let childCount = 0;
            if (el.children) {
              for (let c = 0; c < el.children.length; c++) {
                if (!isAgentPilotElement(el.children[c])) {
                  childCount++;
                }
              }
            }
            if (childCount > maxChildrenCount) {
              maxChildrenCount = childCount;
              maxChildrenSelector = describeNode(el) || el.tagName.toLowerCase();
            }
            if (el.id) {
              idCounts.set(el.id, (idCounts.get(el.id) || 0) + 1);
            }
            const tag = el.tagName;
            if (tag === "IMG" && !el.hasAttribute("alt") && el.getAttribute("role") !== "presentation") {
              imagesMissingAlt++;
            } else if (tag === "IFRAME") {
              iframeCount++;
            } else if (
              (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") &&
              el.type !== "hidden" &&
              el.type !== "submit" &&
              el.type !== "button"
            ) {
              const hasLabel =
                Boolean(el.getAttribute("aria-label")) ||
                Boolean(el.getAttribute("aria-labelledby")) ||
                Boolean(el.getAttribute("placeholder")) ||
                Boolean(el.closest("label")) ||
                Boolean(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
              if (!hasLabel) unlabelledInputs++;
            }
            if (childCount === 0) {
              let depth = 0;
              let curr = el;
              while (curr && depth < 100) {
                depth++;
                curr = curr.parentElement;
              }
              if (depth > maxDepth) maxDepth = depth;
            }
          }

          const duplicateIds = [];
          for (const [id, count] of idCounts.entries()) {
            if (count > 1 && duplicateIds.length < 10) {
              duplicateIds.push({ id, count });
            }
          }

          const perfMem = perf && perf.memory ? perf.memory : null;
          const lcpTime = lastLcp ? lastLcp.renderTime || lastLcp.loadTime || lastLcp.startTime : undefined;

          return {
            webVitals: {
              ttfbMs: nav ? Math.round(Math.max(0, (nav.responseStart || 0) - (nav.requestStart || 0))) : undefined,
              fcpMs: fcpEntry ? Math.round(fcpEntry.startTime) : undefined,
              lcpMs: lcpTime !== undefined ? Math.round(lcpTime) : undefined,
              lcpElement: lastLcp && lastLcp.element ? describeNode(lastLcp.element) : undefined,
              cls: Math.round(clsScore * 1000) / 1000,
              clsCulprits,
              inpMs: maxInteractionMs,
              ...(slowestInteraction ? { slowestInteraction } : {}),
              domInteractiveMs: nav ? Math.round(nav.domInteractive || 0) : undefined,
              domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd || 0) : undefined,
              loadEventMs: nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : undefined,
              longTasksCount: longTaskEntries ? longTaskEntries.length : 0,
              totalBlockingTimeMs: Math.round(totalBlockingTimeMs),
              maxLongTaskMs: Math.round(maxLongTaskMs),
              topLongTasks: topLongTasks.slice(0, 5)
            },
            resources: {
              totalCount: resourceEntries ? resourceEntries.length : 0,
              totalTransferKB: Math.round((totalTransferBytes / 1024) * 10) / 10,
              renderBlockingCount: renderBlockingUrls.length,
              renderBlockingUrls,
              slowestResources: slowList.slice(0, 5)
            },
            domHealth: {
              totalElements: totalPageElements,
              maxDepth,
              maxChildrenCount,
              maxChildrenSelector,
              iframeCount,
              duplicateIds,
              imagesMissingAlt,
              unlabelledInputs
            },
            jsMemoryFallback: perfMem
              ? {
                  usedJSHeapSize: perfMem.usedJSHeapSize,
                  totalJSHeapSize: perfMem.totalJSHeapSize,
                  jsHeapSizeLimit: perfMem.jsHeapSizeLimit
                }
              : null
          };
        } catch (_) {
          return null;
        }
      }
    });

    const timeoutPromise = new Promise((resolve) => {
      timerId = setTimeout(() => {
        resolve([{ result: { __probeTimedOut: true, timeoutMs: effectiveTimeoutMs } }]);
      }, effectiveTimeoutMs);
    });

    const results = await Promise.race([scriptPromise, timeoutPromise]);
    return results && results[0] ? results[0].result : null;
  } catch (err) {
    logDebug("collectPageWebVitalsAndDomProbe failed", err);
    return null;
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }
}

/**
 * Analyze raw Chrome trace events into structured CPU breakdown, Long Tasks,
 * Forced Reflows (layout thrashing), and Hot Scripts.
 */
export function analyzeTraceEvents(events = []) {
  const safeEvents = Array.isArray(events) ? events : [];
  let scriptingUs = 0;
  let renderingUs = 0;
  let paintingUs = 0;
  let otherUs = 0;

  const SCRIPTING_NAMES = new Set([
    "EvaluateScript",
    "FunctionCall",
    "v8.compile",
    "v8.run",
    "V8.Execute",
    "TimerFire",
    "FireAnimationFrame",
    "EventDispatch",
    "RunMicrotasks"
  ]);
  const RENDERING_NAMES = new Set([
    "UpdateLayoutTree",
    "RecalculateStyles",
    "Layout",
    "PrePaint",
    "HitTest",
    "ScheduleStyleRecalculation",
    "InvalidateLayout"
  ]);
  const PAINTING_NAMES = new Set([
    "Paint",
    "PaintImage",
    "CompositeLayers",
    "RasterTask",
    "DecodeImage",
    "GPUTask"
  ]);

  const longTasks = [];
  const forcedReflows = [];
  const scriptDurationsUs = new Map();
  const nonMetadataEvents = [];

  for (const ev of safeEvents) {
    if (!ev || typeof ev !== "object") continue;
    if (ev.ph === "M") continue;
    nonMetadataEvents.push(ev);

    const durUs = Number(ev.dur) || 0;
    if (durUs <= 0) continue;
    const name = String(ev.name || "");
    const durMs = durUs / 1000;

    if (SCRIPTING_NAMES.has(name)) {
      scriptingUs += durUs;
    } else if (RENDERING_NAMES.has(name)) {
      renderingUs += durUs;
    } else if (PAINTING_NAMES.has(name)) {
      paintingUs += durUs;
    } else if (name === "RunTask" || name === "ThreadControllerImpl::RunTask") {
      if (durMs >= LONG_TASK_THRESHOLD_MS) {
        longTasks.push({
          name,
          durationMs: round2(durMs),
          ts: ev.ts
        });
      }
    } else {
      otherUs += durUs;
    }

    const data = ev.args?.data || ev.args?.beginData || {};
    const scriptUrl = data.url || data.scriptName || ( data.stackTrace && data.stackTrace[0]?.url ) || "";
    const fnName = data.functionName || (data.stackTrace && data.stackTrace[0]?.functionName) || "";
    const lineNumber = data.lineNumber || (data.stackTrace && data.stackTrace[0]?.lineNumber) || undefined;

    if (durMs >= LONG_TASK_THRESHOLD_MS && name !== "RunTask" && name !== "ThreadControllerImpl::RunTask") {
      longTasks.push({
        name,
        durationMs: round2(durMs),
        url: scriptUrl || undefined,
        functionName: fnName || undefined,
        lineNumber
      });
    }

    if ((name === "Layout" || name === "UpdateLayoutTree" || name === "RecalculateStyles") && data.stackTrace && data.stackTrace.length > 0) {
      const topFrame = data.stackTrace[0];
      if (forcedReflows.length < 10) {
        forcedReflows.push({
          type: name,
          durationMs: round2(durMs),
          functionName: topFrame.functionName || "(anonymous)",
          url: topFrame.url || "",
          lineNumber: topFrame.lineNumber
        });
      }
    }

    if (scriptUrl && SCRIPTING_NAMES.has(name)) {
      const prev = scriptDurationsUs.get(scriptUrl) || { totalUs: 0, count: 0 };
      prev.totalUs += durUs;
      prev.count += 1;
      scriptDurationsUs.set(scriptUrl, prev);
    }
  }

  longTasks.sort((a, b) => b.durationMs - a.durationMs);
  const totalBlockingTimeMs = round2(
    longTasks.reduce((sum, t) => sum + Math.max(0, t.durationMs - LONG_TASK_THRESHOLD_MS), 0)
  );
  const maxDurationMs = longTasks.length > 0 ? longTasks[0].durationMs : 0;

  const hotScripts = Array.from(scriptDurationsUs.entries())
    .map(([url, info]) => ({
      url,
      totalMs: round2(info.totalUs / 1000),
      callCount: info.count
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 5);

  const breakdownMs = {
    scriptingMs: round2(scriptingUs / 1000),
    renderingMs: round2(renderingUs / 1000),
    paintingMs: round2(paintingUs / 1000),
    otherMs: round2(otherUs / 1000)
  };

  const bottlenecks = [];
  if (longTasks.length > 0) {
    bottlenecks.push(
      `Detected ${longTasks.length} long task(s) (>=50ms), max=${maxDurationMs}ms, TBT=${totalBlockingTimeMs}ms`
    );
  }
  if (forcedReflows.length > 0) {
    bottlenecks.push(
      `Detected ${forcedReflows.length} synchronous forced reflow/layout thrashing event(s)`
    );
  }
  if (hotScripts.length > 0 && hotScripts[0].totalMs > 100) {
    bottlenecks.push(`Hot script ${hotScripts[0].url} consumed ${hotScripts[0].totalMs}ms across ${hotScripts[0].callCount} calls`);
  }

  // Sort non-metadata duration events by duration descending so eventsSummary shows actual bottlenecks
  const rankedEvents = nonMetadataEvents
    .filter((e) => Number(e.dur) > 0)
    .sort((a, b) => (Number(b.dur) || 0) - (Number(a.dur) || 0))
    .slice(0, 50);

  return {
    breakdownMs,
    longTasks: {
      count: longTasks.length,
      totalBlockingTimeMs,
      maxDurationMs,
      topTasks: longTasks.slice(0, 10)
    },
    forcedReflows,
    hotScripts,
    bottlenecks,
    significantEvents: rankedEvents.length > 0 ? rankedEvents : safeEvents.slice(0, 50)
  };
}

/**
 * Start performance trace recording
 */
export async function startPerformanceTrace(tabId, categories = null) {
  const cats =
    categories ||
    "devtools.timeline,blink.user_timing,v8.execute,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack";
  activeTracingSessions.set(tabId, {
    buffer: [],
    startTime: Date.now(),
    categories: cats,
    completed: false
  });

  await sendCdpCommand(tabId, "Tracing.start", {
    categories: cats,
    transferMode: "ReportEvents"
  });

  return {
    success: true,
    tabId,
    message: "Performance tracing started",
    categories: cats
  };
}

/**
 * Stop performance trace recording and return structured bottleneck insights + summary
 */
export async function stopPerformanceTrace(tabId) {
  const trace = activeTracingSessions.get(tabId);
  try {
    const completePromise = new Promise((resolve) => {
      if (!trace || trace.completed) {
        resolve();
        return;
      }
      trace.onComplete = resolve;
      setTimeout(resolve, TIMEOUTS.CDP_TRACE_COMPLETE_MS);
    });

    await sendCdpCommand(tabId, "Tracing.end", {}, TIMEOUTS.CDP_TRACING_END_MS);
    await completePromise;
  } catch (err) {
    logDebug("Tracing.end error", err);
  }

  const events = trace?.buffer || [];
  activeTracingSessions.delete(tabId);

  const durationMs = trace ? Date.now() - trace.startTime : 0;
  const analysis = analyzeTraceEvents(events);

  return {
    success: true,
    tabId,
    durationMs,
    totalEvents: events.length,
    insights: {
      breakdownMs: analysis.breakdownMs,
      longTasks: analysis.longTasks,
      forcedReflows: analysis.forcedReflows,
      hotScripts: analysis.hotScripts,
      bottlenecks: analysis.bottlenecks
    },
    eventsSummary: analysis.significantEvents
  };
}

/**
 * Build actionable diagnostic warnings from CDP metrics, Web Vitals, and DOM health.
 */
function buildPerformanceDiagnostics(memory, webVitals, domHealth, resources, extraContext = {}) {
  const diagnostics = [];

  if (extraContext?.probeTimedOut) {
    const tMs = extraContext.probeTimeoutMs || DEFAULT_DOM_PROBE_TIMEOUT_MS;
    diagnostics.push({
      severity: "critical",
      category: "responsiveness",
      metric: "MainThreadBlocked",
      value: `>${tMs}ms`,
      message: `Page main thread did not respond to DOM/WebVitals probe within ${tMs}ms (likely blocked by heavy synchronous JavaScript or layout thrashing)`
    });
  }

  if (webVitals) {
    if (typeof webVitals.lcpMs === "number" && webVitals.lcpMs > 2500) {
      diagnostics.push({
        severity: webVitals.lcpMs > 4000 ? "critical" : "warning",
        category: "lcp",
        metric: "LCP",
        value: `${webVitals.lcpMs}ms`,
        element: webVitals.lcpElement,
        message: `Slow Largest Contentful Paint (${webVitals.lcpMs}ms > 2500ms)${webVitals.lcpElement ? ` on ${webVitals.lcpElement}` : ""}`
      });
    }
    if (typeof webVitals.cls === "number" && webVitals.cls > 0.1) {
      diagnostics.push({
        severity: webVitals.cls > 0.25 ? "critical" : "warning",
        category: "cls",
        metric: "CLS",
        value: webVitals.cls,
        culprits: webVitals.clsCulprits,
        message: `High Cumulative Layout Shift (${webVitals.cls} > 0.1)`
      });
    }
    if (typeof webVitals.inpMs === "number" && webVitals.inpMs > 200) {
      diagnostics.push({
        severity: webVitals.inpMs > 500 ? "critical" : "warning",
        category: "inp",
        metric: "INP",
        value: `${webVitals.inpMs}ms`,
        interaction: webVitals.slowestInteraction,
        message: `Slow Interaction to Next Paint (${webVitals.inpMs}ms > 200ms)${webVitals.slowestInteraction?.target ? ` on ${webVitals.slowestInteraction.target}` : ""}`
      });
    }
    if (typeof webVitals.totalBlockingTimeMs === "number" && webVitals.totalBlockingTimeMs > 200) {
      diagnostics.push({
        severity: webVitals.totalBlockingTimeMs > 600 ? "critical" : "warning",
        category: "tbt",
        metric: "TBT",
        value: `${webVitals.totalBlockingTimeMs}ms`,
        message: `High Total Blocking Time (${webVitals.totalBlockingTimeMs}ms across ${webVitals.longTasksCount} long tasks)`
      });
    }
  }

  if (memory) {
    const liveElements =
      typeof domHealth?.totalElements === "number"
        ? domHealth.totalElements
        : typeof memory.liveDomElements === "number"
          ? memory.liveDomElements
          : undefined;
    const effectiveLiveNodes = liveElements !== undefined ? liveElements : memory.domNodes;

    if (typeof effectiveLiveNodes === "number" && effectiveLiveNodes > 1500) {
      diagnostics.push({
        severity: effectiveLiveNodes > 3000 ? "critical" : "warning",
        category: "dom",
        metric: "DOMNodes",
        value: effectiveLiveNodes,
        message: `Large DOM tree (${effectiveLiveNodes} live nodes > 1500 recommended threshold)`
      });
    }

    if (
      typeof memory.domNodes === "number" &&
      typeof liveElements === "number" &&
      memory.domNodes - liveElements > 500 &&
      memory.domNodes > liveElements * 1.5
    ) {
      const retainedDiff = memory.domNodes - liveElements;
      diagnostics.push({
        severity: retainedDiff > 5000 ? "critical" : "warning",
        category: "memory",
        metric: "DetachedOrUncollectedNodes",
        value: retainedDiff,
        liveDomElements: liveElements,
        blinkRetainedNodes: memory.domNodes,
        message: `Blink retains ${memory.domNodes} DOM nodes while live document has only ${liveElements} elements (+${retainedDiff} detached or uncollected nodes waiting for GC)`
      });
    }

    const expectedDocs = 1 + (typeof domHealth?.iframeCount === "number" ? domHealth.iframeCount : 0);
    if (typeof memory.documents === "number" && memory.documents > expectedDocs) {
      diagnostics.push({
        severity: memory.documents > expectedDocs + 2 ? "critical" : "warning",
        category: "memory",
        metric: "RetainedDocuments",
        value: memory.documents,
        expectedDocuments: expectedDocs,
        message: `Renderer retains ${memory.documents} Document instances for ${expectedDocs} live document/iframe(s) (possible leaked Document or detached DOM reference across navigations)`
      });
    }

    if (typeof memory.jsHeapUsedMB === "number" && memory.jsHeapUsedMB > 100) {
      diagnostics.push({
        severity: memory.jsHeapUsedMB > 250 ? "critical" : "warning",
        category: "memory",
        metric: "JSHeapUsedMB",
        value: `${memory.jsHeapUsedMB}MB`,
        message: `High JavaScript Heap memory usage (${memory.jsHeapUsedMB} MB)`
      });
    }
  }

  if (domHealth) {
    if (Array.isArray(domHealth.duplicateIds) && domHealth.duplicateIds.length > 0) {
      diagnostics.push({
        severity: "warning",
        category: "dom",
        metric: "DuplicateIDs",
        value: domHealth.duplicateIds,
        message: `Found ${domHealth.duplicateIds.length} duplicate DOM id attribute(s): ${domHealth.duplicateIds.map((d) => `#${d.id} (x${d.count})`).join(", ")}`
      });
    }
    if (domHealth.maxDepth > 32) {
      diagnostics.push({
        severity: "warning",
        category: "dom",
        metric: "DOMDepth",
        value: domHealth.maxDepth,
        message: `Deep DOM nesting (maxDepth=${domHealth.maxDepth} > 32)`
      });
    }
  }

  if (resources && resources.renderBlockingCount > 0) {
    diagnostics.push({
      severity: "warning",
      category: "resource",
      metric: "RenderBlockingResources",
      value: resources.renderBlockingCount,
      urls: resources.renderBlockingUrls,
      message: `Found ${resources.renderBlockingCount} render-blocking resource(s)`
    });
  }

  if (extraContext?.runtimeErrors && extraContext.runtimeErrors.count > 0) {
    const latest = extraContext.runtimeErrors.recent?.[extraContext.runtimeErrors.recent.length - 1]?.text;
    diagnostics.push({
      severity: "warning",
      category: "runtime",
      metric: "ConsoleErrors",
      value: extraContext.runtimeErrors.count,
      recentErrors: extraContext.runtimeErrors.recent.map((e) => e.text),
      message: `Captured ${extraContext.runtimeErrors.count} runtime console error(s)/exception(s) on this tab${latest ? ` (latest: ${latest})` : ""}`
    });
  }

  return diagnostics;
}

/**
 * Get runtime performance metrics (JSHeap, DOM Nodes, Layouts, Core Web Vitals, DOM Health & Diagnostics)
 */
export async function getPerformanceMetrics(tabId, options = {}) {
  const includeWebVitals = options?.includeWebVitals !== false;
  const includeResources = options?.includeResources !== false;
  const includeDomHealth = options?.includeDomHealth !== false;
  const shouldCollectGarbage = Boolean(options?.collectGarbage || options?.gc);
  let garbageCollected = false;

  const metricsMap = {};
  if (attachedTabs.has(tabId)) {
    if (shouldCollectGarbage) {
      try {
        await sendCdpCommand(tabId, "HeapProfiler.collectGarbage");
        garbageCollected = true;
      } catch (gcErr) {
        logDebug("Pre-metrics HeapProfiler.collectGarbage error (ignored)", gcErr);
      }
    }
    try {
      const result = await sendCdpCommand(tabId, "Performance.getMetrics");
      if (result && Array.isArray(result.metrics)) {
        for (const m of result.metrics) {
          metricsMap[m.name] = m.value;
        }
      }
    } catch (cdpErr) {
      logDebug("Performance.getMetrics CDP error, falling back to page probe", cdpErr);
    }
  }

  const probeTimeoutMs =
    Number(options?.probeTimeoutMs) > 0 ? Number(options.probeTimeoutMs) : DEFAULT_DOM_PROBE_TIMEOUT_MS;
  const rawProbe =
    includeWebVitals || includeResources || includeDomHealth
      ? await collectPageWebVitalsAndDomProbe(tabId, probeTimeoutMs)
      : null;
  const probeTimedOut = Boolean(rawProbe?.__probeTimedOut);
  const probe = probeTimedOut ? null : rawProbe;
  const fallbackMem = probe?.jsMemoryFallback || null;

  const usedBytes = metricsMap.JSHeapUsedSize ?? fallbackMem?.usedJSHeapSize;
  const totalBytes = metricsMap.JSHeapTotalSize ?? fallbackMem?.totalJSHeapSize;
  const limitBytes = fallbackMem?.jsHeapSizeLimit;
  const liveDomElements = probe?.domHealth?.totalElements;
  const blinkRetainedNodes = metricsMap.Nodes;
  const domNodes = metricsMap.Nodes ?? liveDomElements;
  const detachedOrUncollectedNodes =
    typeof blinkRetainedNodes === "number" && typeof liveDomElements === "number"
      ? Math.max(0, blinkRetainedNodes - liveDomElements)
      : undefined;

  if (metricsMap.JSHeapUsedSize === undefined && usedBytes !== undefined) {
    metricsMap.JSHeapUsedSize = usedBytes;
  }
  if (metricsMap.JSHeapTotalSize === undefined && totalBytes !== undefined) {
    metricsMap.JSHeapTotalSize = totalBytes;
  }
  if (metricsMap.Nodes === undefined && domNodes !== undefined) {
    metricsMap.Nodes = domNodes;
  }

  const memory = {
    jsHeapUsedMB: usedBytes !== undefined ? round2(usedBytes / BYTES_PER_MB) : undefined,
    jsHeapTotalMB: totalBytes !== undefined ? round2(totalBytes / BYTES_PER_MB) : undefined,
    jsHeapLimitMB: limitBytes !== undefined ? round2(limitBytes / BYTES_PER_MB) : undefined,
    heapUsagePercent:
      usedBytes !== undefined && totalBytes > 0 ? round2((usedBytes / totalBytes) * 100) : undefined,
    domNodes,
    ...(liveDomElements !== undefined ? { liveDomElements } : {}),
    ...(blinkRetainedNodes !== undefined ? { blinkRetainedNodes } : {}),
    ...(detachedOrUncollectedNodes !== undefined ? { detachedOrUncollectedNodes } : {}),
    jsEventListeners: metricsMap.JSEventListeners,
    documents: metricsMap.Documents,
    frames: metricsMap.Frames,
    layoutObjects: metricsMap.LayoutObjects,
    layoutCount: metricsMap.LayoutCount,
    recalcStyleCount: metricsMap.RecalcStyleCount,
    scriptDurationMs:
      metricsMap.ScriptDuration !== undefined ? round2(metricsMap.ScriptDuration * 1000) : undefined,
    layoutDurationMs:
      metricsMap.LayoutDuration !== undefined ? round2(metricsMap.LayoutDuration * 1000) : undefined,
    recalcStyleDurationMs:
      metricsMap.RecalcStyleDuration !== undefined ? round2(metricsMap.RecalcStyleDuration * 1000) : undefined,
    taskDurationMs:
      metricsMap.TaskDuration !== undefined ? round2(metricsMap.TaskDuration * 1000) : undefined
  };

  let webVitals = undefined;
  if (includeWebVitals && probe?.webVitals) {
    const wv = probe.webVitals;
    webVitals = {
      ...wv,
      ratings: {
        ttfb: rateMetric(wv.ttfbMs, 800, 1800),
        fcp: rateMetric(wv.fcpMs, 1800, 3000),
        lcp: rateMetric(wv.lcpMs, 2500, 4000),
        cls: rateMetric(wv.cls, 0.1, 0.25),
        ...(wv.inpMs !== undefined ? { inp: rateMetric(wv.inpMs, 200, 500) } : {}),
        tbt: rateMetric(wv.totalBlockingTimeMs, 200, 600)
      }
    };
  }

  const resources = includeResources ? probe?.resources || undefined : undefined;
  const domHealth = includeDomHealth ? probe?.domHealth || undefined : undefined;
  const runtimeErrors = getRuntimeErrorsSummary(tabId);
  const diagnostics = buildPerformanceDiagnostics(memory, webVitals, domHealth, resources, {
    probeTimedOut,
    probeTimeoutMs,
    runtimeErrors
  });

  return {
    success: true,
    tabId,
    ...(shouldCollectGarbage ? { garbageCollected } : {}),
    ...(probeTimedOut ? { mainThreadBlocked: true, domProbeTimedOut: true } : {}),
    metrics: metricsMap,
    memory,
    webVitals,
    resources,
    domHealth,
    ...(runtimeErrors.count > 0 ? { runtimeErrors } : {}),
    diagnostics,
    timestamp: Date.now()
  };
}

/**
 * Collect garbage via CDP HeapProfiler
 */
export async function collectGarbage(tabId) {
  try {
    await sendCdpCommand(tabId, "HeapProfiler.collectGarbage");
    return { success: true, supported: true, tabId, message: "Garbage collection completed" };
  } catch (error) {
    if (!isUnsupportedHeapProfilerError(error)) throw error;
    throw createHeapProfilerUnavailableError("HeapProfiler.collectGarbage", error);
  }
}

export function isUnsupportedHeapProfilerError(error) {
  const message = String(error?.message || error || "");
  if (/timed out|timeout|deadline exceeded/i.test(message)) return false;
  return /-32601\b|unknown method|method not found|not found|not supported|unsupported|unknown command/i.test(message);
}

function createHeapProfilerUnavailableError(method, cause) {
  const error = new Error(
    `HEAPPROFILER_UNAVAILABLE: ${method} is not supported by Chrome's extension debugger for this tab; use an isolated DevTools context for heap snapshots.`
  );
  error.code = "HEAPPROFILER_UNAVAILABLE";
  error.method = method;
  error.cause = cause;
  return error;
}

/**
 * Parse V8 JSON Heap Snapshot chunks to extract top constructors by self size,
 * object counts, and Detached DOM / EventListener nodes for memory leak detection.
 */
export function parseV8HeapSnapshot(chunks = [], maxConstructors = 15) {
  const raw = Array.isArray(chunks) ? chunks.join("") : String(chunks || "");
  if (!raw.trim()) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return null;
  }

  const meta = parsed?.snapshot?.meta || {};
  const nodeFields = Array.isArray(meta.node_fields)
    ? meta.node_fields
    : ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"];
  const nodeTypes = Array.isArray(meta.node_types?.[0])
    ? meta.node_types[0]
    : [
        "hidden",
        "array",
        "string",
        "object",
        "code",
        "closure",
        "regexp",
        "number",
        "native",
        "synthetic",
        "concatenated string",
        "sliced string",
        "symbol",
        "bigint"
      ];

  const typeOffset = nodeFields.indexOf("type");
  const nameOffset = nodeFields.indexOf("name");
  const selfSizeOffset = nodeFields.indexOf("self_size");
  const detachednessOffset = nodeFields.indexOf("detachedness");
  const stride = nodeFields.length || 7;

  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const strings = Array.isArray(parsed.strings) ? parsed.strings : [];

  if (nodes.length === 0 || stride <= 0) {
    return null;
  }

  const SKIP_INTERNAL_TYPES = new Set(["hidden", "synthetic", "number", "code"]);
  const constructorsMap = new Map();
  const detachedMap = new Map();
  let totalNodes = 0;
  let totalSelfSizeBytes = 0;

  for (let i = 0; i + stride <= nodes.length; i += stride) {
    totalNodes++;
    const typeIdx = typeOffset >= 0 ? nodes[i + typeOffset] : 3;
    const typeName = nodeTypes[typeIdx] || "object";
    const nameIdx = nameOffset >= 0 ? nodes[i + nameOffset] : 0;
    const rawName = String(strings[nameIdx] ?? "(anonymous)").trim() || "(anonymous)";
    const selfSize = selfSizeOffset >= 0 ? Number(nodes[i + selfSizeOffset]) || 0 : 0;
    const detachedness = detachednessOffset >= 0 ? Number(nodes[i + detachednessOffset]) || 0 : 0;

    totalSelfSizeBytes += selfSize;

    const isDetached = rawName.startsWith("Detached ") || detachedness === 2;
    if (isDetached) {
      const detachedLabel = rawName.startsWith("Detached ") ? rawName : `Detached ${rawName}`;
      const prevDet = detachedMap.get(detachedLabel) || {
        name: detachedLabel,
        count: 0,
        selfSizeBytes: 0
      };
      prevDet.count += 1;
      prevDet.selfSizeBytes += selfSize;
      detachedMap.set(detachedLabel, prevDet);
    }

    if (SKIP_INTERNAL_TYPES.has(typeName) && !isDetached) {
      continue;
    }

    const key = isDetached && !rawName.startsWith("Detached ") ? `Detached ${rawName}` : rawName;
    const prev = constructorsMap.get(key) || {
      name: key,
      type: typeName,
      count: 0,
      selfSizeBytes: 0
    };
    prev.count += 1;
    prev.selfSizeBytes += selfSize;
    constructorsMap.set(key, prev);
  }

  const allConstructors = Array.from(constructorsMap.values()).map((item) => ({
    ...item,
    selfSizeKB: round2(item.selfSizeBytes / BYTES_PER_KB)
  }));
  allConstructors.sort((a, b) => b.selfSizeBytes - a.selfSizeBytes);

  const detachedItems = Array.from(detachedMap.values())
    .map((item) => ({
      ...item,
      selfSizeKB: round2(item.selfSizeBytes / BYTES_PER_KB)
    }))
    .sort((a, b) => b.selfSizeBytes - a.selfSizeBytes || b.count - a.count);

  const totalDetachedCount = detachedItems.reduce((acc, d) => acc + d.count, 0);
  const totalDetachedBytes = detachedItems.reduce((acc, d) => acc + d.selfSizeBytes, 0);
  const limit = Number(maxConstructors) > 0 ? Math.min(100, Number(maxConstructors)) : 15;

  return {
    totalNodes,
    totalSelfSizeBytes,
    totalSelfSizeMB: round2(totalSelfSizeBytes / BYTES_PER_MB),
    topConstructors: allConstructors.slice(0, limit),
    allConstructorsMap: constructorsMap,
    detachedDomNodes: {
      totalCount: totalDetachedCount,
      totalBytes: totalDetachedBytes,
      totalKB: round2(totalDetachedBytes / BYTES_PER_KB),
      items: detachedItems.slice(0, limit)
    }
  };
}

/**
 * Compare current memory metrics & V8 heap summary against a stored tab baseline
 * to pinpoint growing constructors, detached DOM nodes, and event listener leaks.
 */
function computeMemoryLeakDiff(baseline, current) {
  const deltaHeapBytes = (current.metrics.JSHeapUsedSize || 0) - (baseline.metrics.JSHeapUsedSize || 0);
  const deltaHeapMB = round2(deltaHeapBytes / BYTES_PER_MB);
  const deltaDomNodes = (current.metrics.Nodes || 0) - (baseline.metrics.Nodes || 0);
  const deltaLiveDomElements =
    typeof current.liveDomElements === "number" && typeof baseline.liveDomElements === "number"
      ? current.liveDomElements - baseline.liveDomElements
      : undefined;
  const prevUncollectedNodes =
    typeof baseline.metrics.Nodes === "number" && typeof baseline.liveDomElements === "number"
      ? Math.max(0, baseline.metrics.Nodes - baseline.liveDomElements)
      : undefined;
  const currUncollectedNodes =
    typeof current.metrics.Nodes === "number" && typeof current.liveDomElements === "number"
      ? Math.max(0, current.metrics.Nodes - current.liveDomElements)
      : undefined;
  const deltaUncollectedNodes =
    currUncollectedNodes !== undefined && prevUncollectedNodes !== undefined
      ? currUncollectedNodes - prevUncollectedNodes
      : undefined;
  const deltaEventListeners =
    (current.metrics.JSEventListeners || 0) - (baseline.metrics.JSEventListeners || 0);
  const deltaDocuments = (current.metrics.Documents || 0) - (baseline.metrics.Documents || 0);
  const deltaRuntimeErrors =
    typeof current.runtimeErrorsCount === "number" && typeof baseline.runtimeErrorsCount === "number"
      ? Math.max(0, current.runtimeErrorsCount - baseline.runtimeErrorsCount)
      : 0;

  const prevDetachedCount = baseline.heapSummary?.detachedDomNodes?.totalCount || 0;
  const currDetachedCount = current.heapSummary?.detachedDomNodes?.totalCount || 0;
  const deltaDetachedCount = currDetachedCount - prevDetachedCount;

  const growingConstructors = [];
  if (baseline.heapSummary?.allConstructorsMap && current.heapSummary?.allConstructorsMap) {
    for (const [name, currInfo] of current.heapSummary.allConstructorsMap.entries()) {
      const baseInfo = baseline.heapSummary.allConstructorsMap.get(name) || {
        count: 0,
        selfSizeBytes: 0
      };
      const deltaCount = currInfo.count - baseInfo.count;
      const deltaBytes = currInfo.selfSizeBytes - baseInfo.selfSizeBytes;
      if (deltaCount > 0 && deltaBytes > 0) {
        growingConstructors.push({
          name,
          type: currInfo.type,
          baselineCount: baseInfo.count,
          currentCount: currInfo.count,
          deltaCount,
          deltaBytes,
          deltaKB: round2(deltaBytes / BYTES_PER_KB)
        });
      }
    }
    growingConstructors.sort((a, b) => b.deltaBytes - a.deltaBytes || b.deltaCount - a.deltaCount);
  }

  const suspectedCauses = [];
  if (currDetachedCount > 0 && deltaDetachedCount > 0) {
    const topDet = (current.heapSummary?.detachedDomNodes?.items || [])
      .slice(0, 3)
      .map((d) => `${d.name} (x${d.count})`)
      .join(", ");
    suspectedCauses.push(
      `Detached DOM nodes grew by +${deltaDetachedCount} (total=${currDetachedCount}: ${topDet})`
    );
  } else if (currDetachedCount > 0) {
    suspectedCauses.push(`Found ${currDetachedCount} detached DOM node(s) retained in memory`);
  } else if (deltaUncollectedNodes !== undefined && deltaUncollectedNodes > 20) {
    suspectedCauses.push(
      `Retained Blink DOM nodes grew by +${deltaUncollectedNodes} beyond live DOM elements (live=${current.liveDomElements}, retained=${current.metrics.Nodes}) — suspected detached DOM subtree`
    );
  }

  if (deltaEventListeners > 5) {
    suspectedCauses.push(
      `JS Event Listeners grew by +${deltaEventListeners} (${baseline.metrics.JSEventListeners || 0} -> ${current.metrics.JSEventListeners || 0}) after GC`
    );
  }
  if (deltaDomNodes > 20) {
    suspectedCauses.push(
      `Live DOM nodes grew by +${deltaDomNodes} (${baseline.metrics.Nodes || 0} -> ${current.metrics.Nodes || 0}) after GC`
    );
  }
  if (deltaDocuments > 0) {
    suspectedCauses.push(
      `Retained Document instances grew by +${deltaDocuments} (possible leaked iframe or window reference)`
    );
  }
  if (deltaHeapMB >= 1.0) {
    const topGrower = growingConstructors[0]
      ? ` (top growing constructor: ${growingConstructors[0].name} +${growingConstructors[0].deltaKB} KB, +${growingConstructors[0].deltaCount} instances)`
      : "";
    suspectedCauses.push(`JS Heap grew by +${deltaHeapMB} MB after forced GC${topGrower}`);
  }
  if (deltaRuntimeErrors > 0) {
    suspectedCauses.push(
      `Captured +${deltaRuntimeErrors} new runtime console error(s)/exception(s) during leak test (total=${current.runtimeErrorsCount})`
    );
  }

  const leakSuspected =
    deltaDetachedCount > 0 ||
    currDetachedCount > 5 ||
    (deltaUncollectedNodes !== undefined && deltaUncollectedNodes > 20) ||
    deltaEventListeners > 10 ||
    deltaDocuments > 0 ||
    deltaHeapMB >= 1.0;

  let severity = "none";
  if (leakSuspected) {
    if (
      deltaHeapMB >= 5.0 ||
      deltaDetachedCount >= 10 ||
      (deltaUncollectedNodes !== undefined && deltaUncollectedNodes >= 500) ||
      deltaDocuments > 0 ||
      deltaEventListeners >= 50
    ) {
      severity = "high";
    } else if (
      deltaHeapMB >= 1.0 ||
      deltaDetachedCount > 0 ||
      (deltaUncollectedNodes !== undefined && deltaUncollectedNodes > 20) ||
      deltaEventListeners > 10
    ) {
      severity = "medium";
    } else {
      severity = "low";
    }
  }

  return {
    hasBaseline: true,
    elapsedMs: Math.max(0, current.timestamp - baseline.timestamp),
    leakSuspected,
    severity,
    deltas: {
      jsHeapUsedBytes: deltaHeapBytes,
      jsHeapUsedMB: deltaHeapMB,
      domNodes: deltaDomNodes,
      ...(deltaLiveDomElements !== undefined ? { liveDomElements: deltaLiveDomElements } : {}),
      ...(deltaUncollectedNodes !== undefined ? { detachedOrUncollectedNodes: deltaUncollectedNodes } : {}),
      jsEventListeners: deltaEventListeners,
      documents: deltaDocuments,
      detachedDomCount: deltaDetachedCount,
      ...(deltaRuntimeErrors > 0 ? { runtimeErrors: deltaRuntimeErrors } : {})
    },
    growingConstructors: growingConstructors.slice(0, 10),
    suspectedCauses
  };
}

/**
 * Take heap snapshot via CDP HeapProfiler, parse constructor & detached DOM breakdown,
 * and optionally record a baseline or compute a memory leak diff against the tab's baseline.
 * When Chrome's extension debugger blocks HeapProfiler.takeHeapSnapshot on a normal tab
 * (and no raw .heapsnapshot filePath is requested), falls back to runtime memory/DOM/listener
 * counters when available so baseline/diff leak workflows still operate on extension tabs.
 */
export async function takeHeapSnapshot(tabId, options = {}) {
  const action = String(options?.action || "snapshot").toLowerCase().trim();
  if (action === "gc") {
    return await collectGarbage(tabId);
  }

  // Force V8 GC before snapshot/baseline/diff by default so unreferenced objects do not skew leak detection
  const shouldCollectGarbage = options?.collectGarbage !== false && options?.forceGC !== false;
  let garbageCollected = false;
  let garbageCollectionWarning;
  if (shouldCollectGarbage) {
    try {
      await sendCdpCommand(tabId, "HeapProfiler.collectGarbage");
      garbageCollected = true;
    } catch (err) {
      if (isUnsupportedHeapProfilerError(err)) {
        garbageCollectionWarning = "HeapProfiler.collectGarbage is unavailable; captured the heap snapshot without forced garbage collection.";
        logDebug("Pre-snapshot GC unavailable; continuing without forced GC", err);
      } else {
        logDebug("Pre-snapshot GC error", err);
      }
    }
  }

  // Collect live runtime counters alongside the heap snapshot
  const metricsMap = {};
  try {
    const perfRes = await sendCdpCommand(tabId, "Performance.getMetrics");
    if (perfRes && Array.isArray(perfRes.metrics)) {
      for (const m of perfRes.metrics) {
        metricsMap[m.name] = m.value;
      }
    }
  } catch (err) {
    logDebug("Pre-snapshot Performance.getMetrics error", err);
  }

  const chunks = [];
  const chunkListener = (source, method, params) => {
    if (source.tabId === tabId && method === "HeapProfiler.addHeapSnapshotChunk") {
      chunks.push(params.chunk);
    }
  };
  chrome.debugger.onEvent.addListener(chunkListener);

  let usedRuntimeFallback = false;
  let fallbackNotice = undefined;
  try {
    await sendCdpCommand(tabId, "HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  } catch (err) {
    if (isUnsupportedHeapProfilerError(err)) {
      const hasRuntimeCounters =
        Object.keys(metricsMap).length > 0 &&
        (metricsMap.JSHeapUsedSize !== undefined || metricsMap.Nodes !== undefined);
      const canFallback =
        hasRuntimeCounters && !options?.filePath && options?.allowFallback !== false;
      if (!canFallback) {
        throw createHeapProfilerUnavailableError("HeapProfiler.takeHeapSnapshot", err);
      }
      usedRuntimeFallback = true;
      fallbackNotice =
        "Chrome's extension debugger does not expose HeapProfiler.takeHeapSnapshot on standard tabs; fell back to live CDP Performance.getMetrics + DOM/listener leak counters. Use an isolated DevTools context (negative tabId) if constructor-level V8 retainer graphs are required.";
    } else {
      throw err;
    }
  } finally {
    chrome.debugger.onEvent.removeListener(chunkListener);
  }

  let liveDomElements = undefined;
  if (usedRuntimeFallback) {
    const probe = await collectPageWebVitalsAndDomProbe(tabId, 2500);
    if (probe && !probe.__probeTimedOut) {
      liveDomElements = probe.domHealth?.totalElements;
      if (metricsMap.JSHeapUsedSize === undefined && probe.jsMemoryFallback?.usedJSHeapSize !== undefined) {
        metricsMap.JSHeapUsedSize = probe.jsMemoryFallback.usedJSHeapSize;
      }
      if (metricsMap.JSHeapTotalSize === undefined && probe.jsMemoryFallback?.totalJSHeapSize !== undefined) {
        metricsMap.JSHeapTotalSize = probe.jsMemoryFallback.totalJSHeapSize;
      }
    }
  }

  const totalLength = chunks.reduce((acc, c) => acc + (c ? c.length : 0), 0);
  const parsedHeap = usedRuntimeFallback ? null : parseV8HeapSnapshot(chunks, options?.maxConstructors);
  const runtimeErrors = getRuntimeErrorsSummary(tabId);
  const now = Date.now();

  const currentRecord = {
    timestamp: now,
    metrics: metricsMap,
    heapSummary: parsedHeap,
    ...(liveDomElements !== undefined ? { liveDomElements } : {}),
    runtimeErrorsCount: runtimeErrors.count
  };

  const prevBaseline = memoryBaselines.get(tabId) || null;
  const wantsDiff =
    action === "diff" ||
    action === "check_leak" ||
    action === "leak" ||
    Boolean(options?.compareWithBaseline);
  const firstDiffNeedsBaseline = !prevBaseline && wantsDiff;
  const wantsBaseline =
    action === "baseline" || Boolean(options?.recordBaseline) || (!prevBaseline && !wantsDiff) || firstDiffNeedsBaseline;

  let leakAnalysis = undefined;
  if (prevBaseline && (wantsDiff || !wantsBaseline)) {
    leakAnalysis = computeMemoryLeakDiff(prevBaseline, currentRecord);
  } else if (firstDiffNeedsBaseline) {
    leakAnalysis = {
      hasBaseline: false,
      leakSuspected: Boolean(parsedHeap && parsedHeap.detachedDomNodes.totalCount > 0),
      severity: parsedHeap && parsedHeap.detachedDomNodes.totalCount > 0 ? "medium" : "none",
      suspectedCauses:
        parsedHeap && parsedHeap.detachedDomNodes.totalCount > 0
          ? [`Found ${parsedHeap.detachedDomNodes.totalCount} detached DOM node(s) (no prior baseline recorded; saved current snapshot as baseline)`]
          : ["No prior baseline existed for this tab; saved current snapshot as baseline for subsequent diff calls."]
    };
  }

  if (wantsBaseline || firstDiffNeedsBaseline) {
    memoryBaselines.set(tabId, currentRecord);
  }

  const detachedOrUncollectedNodes =
    typeof metricsMap.Nodes === "number" && typeof liveDomElements === "number"
      ? Math.max(0, metricsMap.Nodes - liveDomElements)
      : undefined;

  const response = {
    success: true,
    tabId,
    action,
    snapshotMode: usedRuntimeFallback ? "runtime-counters-fallback" : "v8-heap-snapshot",
    ...(usedRuntimeFallback ? { heapProfilerSupported: false, fallbackNotice } : {}),
    garbageCollected,
    ...(garbageCollectionWarning ? { garbageCollectionWarning } : {}),
    baselineRecorded: Boolean(wantsBaseline || firstDiffNeedsBaseline),
    totalChunks: chunks.length,
    totalBytes: totalLength,
    runtimeCounters: {
      jsHeapUsedMB:
        metricsMap.JSHeapUsedSize !== undefined ? round2(metricsMap.JSHeapUsedSize / BYTES_PER_MB) : undefined,
      jsHeapTotalMB:
        metricsMap.JSHeapTotalSize !== undefined ? round2(metricsMap.JSHeapTotalSize / BYTES_PER_MB) : undefined,
      domNodes: metricsMap.Nodes,
      ...(liveDomElements !== undefined ? { liveDomElements } : {}),
      ...(detachedOrUncollectedNodes !== undefined ? { detachedOrUncollectedNodes } : {}),
      jsEventListeners: metricsMap.JSEventListeners,
      documents: metricsMap.Documents,
      frames: metricsMap.Frames,
      ...(runtimeErrors.count > 0 ? { consoleErrors: runtimeErrors.count } : {})
    },
    ...(runtimeErrors.count > 0 ? { runtimeErrors } : {}),
    message: usedRuntimeFallback
      ? `Captured runtime memory & DOM/listener leak counters (${action})`
      : `Heap snapshot captured (${totalLength} bytes across ${chunks.length} chunks)`
  };

  if (parsedHeap) {
    response.heapSummary = {
      totalNodes: parsedHeap.totalNodes,
      totalSelfSizeMB: parsedHeap.totalSelfSizeMB,
      topConstructors: parsedHeap.topConstructors,
      detachedDomNodes: parsedHeap.detachedDomNodes
    };
  }

  if (leakAnalysis) {
    response.leakAnalysis = leakAnalysis;
  }

  return response;
}
