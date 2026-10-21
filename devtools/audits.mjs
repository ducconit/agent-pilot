import fs from "node:fs/promises";
import path from "node:path";
import lighthouse, { snapshot, generateReport } from "lighthouse";
import { randomUUID } from "node:crypto";
import { artifactRoot, boundedJSON, writeArtifact } from "./artifacts.mjs";

const reports = new Map();
function auditSummary(audit) {
  const nodes = [];
  function collect(value) {
    if (!value || typeof value !== "object" || nodes.length >= 10) return;
    if (value.type === "node") { nodes.push({ selector: value.selector, snippet: value.snippet, explanation: value.explanation }); return; }
    for (const [key, item] of Object.entries(value)) if (key !== "subItems") {
      if (Array.isArray(item)) item.forEach(collect); else collect(item);
    }
  }
  collect(audit.details);
  return { id: audit.id, title: audit.title, description: audit.description, score: audit.score, scoreDisplayMode: audit.scoreDisplayMode, displayValue: audit.displayValue, explanation: audit.explanation, errorMessage: audit.errorMessage, nodes };
}

export async function runAudit(page, options = {}) {
  const mode = options.mode || "navigation";
  if (!["navigation", "snapshot"].includes(mode)) throw new Error("Lighthouse mode must be navigation or snapshot");
  if (!["desktop", "mobile"].includes(options.device || "desktop")) throw new Error("Lighthouse device must be desktop or mobile");
  const categories = options.categories || ["accessibility", "best-practices", "seo"];
  if (!Array.isArray(categories) || !categories.length || categories.some(c => !["performance", "accessibility", "best-practices", "seo"].includes(c))) throw new Error("Invalid Lighthouse categories");
  const directory = path.resolve(options.outputDirPath || artifactRoot);
  await fs.mkdir(directory, { recursive: true });
  const id = randomUUID();
  const jsonPath = path.join(directory, `lighthouse-${id}.json`), htmlPath = path.join(directory, `lighthouse-${id}.html`);
  const desktop = options.device !== "mobile";
  const flags = { logLevel: "silent", onlyCategories: categories, disableStorageReset: true, throttlingMethod: "provided", formFactor: desktop ? "desktop" : "mobile", screenEmulation: { disabled: true }, emulatedUserAgent: false };
  // A caller can audit its current responsive viewport; device selects Lighthouse
  // scoring assumptions without destroying the current page's emulation.
  const result = mode === "snapshot" ? await snapshot(page, { flags }) : await lighthouse(page.url(), flags, undefined, page);
  if (!result?.lhr) throw new Error("Lighthouse produced no report");
  const lhr = result.lhr;
  await writeArtifact(jsonPath, JSON.stringify(lhr, null, 2));
  await writeArtifact(htmlPath, generateReport(lhr, "html"));
  reports.set(id, { lhr, jsonPath, htmlPath });
  if (reports.size > 10) reports.delete(reports.keys().next().value);
  const failing = Object.values(lhr.audits).filter(a => typeof a.score === "number" && a.score < 1);
  return { reportId: id, mode, requestedUrl: lhr.requestedUrl, finalUrl: lhr.finalDisplayedUrl || lhr.finalUrl, lighthouseVersion: lhr.lighthouseVersion, scores: Object.fromEntries(Object.entries(lhr.categories).map(([key, category]) => [key, category.score === null ? null : Math.round(category.score * 100)])), runtimeError: lhr.runtimeError, warnings: lhr.runWarnings, failingAuditCount: failing.length, failingAudits: failing.slice(0, Math.min(100, Math.max(1, options.limit || 20))).map(auditSummary), jsonPath, htmlPath };
}

export async function analyzeAudit(options = {}) {
  let report = reports.get(options.reportId);
  if (!report && options.filePath) {
    const filePath = path.resolve(options.filePath);
    const lhr = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!lhr.audits || !lhr.categories || !lhr.lighthouseVersion) throw new Error("Not a Lighthouse JSON report");
    report = { lhr, jsonPath: filePath };
  }
  if (!report) throw new Error("Lighthouse report not found; provide reportId from an audit or filePath to its saved JSON");
  let audits = Object.values(report.lhr.audits);
  if (options.auditId) {
    const audit = report.lhr.audits[options.auditId];
    if (!audit) throw new Error(`Unknown auditId: ${options.auditId}`);
    const details = audit.details || {};
    const pageIdx = Math.max(0, Number(options.pageIdx) || 0), pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
    const items = details.items || [];
    return { ...auditSummary(audit), details: { ...details, items: boundedJSON(items.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize)) }, totalItems: items.length, pageIdx, pageSize, hasMore: (pageIdx + 1) * pageSize < items.length, jsonPath: report.jsonPath };
  }
  if (options.category) {
    const category = report.lhr.categories[options.category];
    if (!category) throw new Error(`Category not found: ${options.category}`);
    const ids = new Set(category.auditRefs.map(a => a.id));
    audits = audits.filter(a => ids.has(a.id));
  }
  if (options.failuresOnly !== false) audits = audits.filter(a => typeof a.score === "number" && a.score < 1);
  const pageIdx = Math.max(0, Number(options.pageIdx) || 0), pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
  return { audits: audits.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize).map(auditSummary), totalAudits: audits.length, pageIdx, pageSize, hasMore: (pageIdx + 1) * pageSize < audits.length, jsonPath: report.jsonPath };
}
