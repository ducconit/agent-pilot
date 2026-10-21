import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const artifactRoot = process.env.AGENT_PILOT_ARTIFACT_DIR || path.join(os.homedir(), ".agent-pilot", "artifacts");
export async function outputPath(requested, extension, prefix) {
  const destination = path.resolve(requested || path.join(artifactRoot, `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`));
  if (!destination.toLowerCase().endsWith(extension)) throw new Error(`Output file must end with ${extension}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  return destination;
}
export async function writeArtifact(filePath, data) {
  // Never silently overwrite a user's file.
  await fs.writeFile(filePath, data, { flag: "wx", mode: 0o600 });
  return { path: filePath, bytes: (await fs.stat(filePath)).size };
}
export function boundedJSON(value, { maxItems = 50, maxDepth = 7 } = {}) {
  const seen = new WeakSet();
  function visit(item, depth) {
    if (typeof item === "bigint") return String(item);
    if (item === null || typeof item !== "object") return typeof item === "function" ? undefined : item;
    if (item instanceof Error) return { error: item.message };
    if (seen.has(item)) return "[reference]";
    if (depth >= maxDepth) return "[nested data; inspect saved artifact]";
    seen.add(item);
    if (item instanceof Map) return Object.fromEntries([...item].slice(0, maxItems).map(([key, val]) => [String(key), visit(val, depth + 1)]));
    if (item instanceof Set) return [...item].slice(0, maxItems).map(val => visit(val, depth + 1));
    if (Array.isArray(item)) return item.slice(0, maxItems).map(val => visit(val, depth + 1));
    return Object.fromEntries(Object.entries(item).filter(([key]) => !["parent", "children", "callTree"].includes(key)).map(([key, val]) => [key, visit(val, depth + 1)]));
  }
  return visit(value, 0);
}
