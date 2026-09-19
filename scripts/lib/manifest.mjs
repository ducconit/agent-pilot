/**
 * Agent Pilot - Extension manifest helpers shared by the packers.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Collect every file path referenced by manifest.json and verify it exists.
 * @returns {{refs: number, missing: string[]}}
 */
export function validateManifestReferences(extDir, manifest) {
  const refs = new Set();
  const add = (p) => {
    if (typeof p === "string" && p) refs.add(p);
  };

  if (manifest.background) add(manifest.background.service_worker);
  for (const cs of manifest.content_scripts || []) {
    for (const f of cs.js || []) add(f);
    for (const f of cs.css || []) add(f);
  }
  if (manifest.side_panel) add(manifest.side_panel.default_path);
  for (const icon of Object.values(manifest.icons || {})) add(icon);

  const missing = [];
  for (const rel of refs) {
    if (!fs.existsSync(path.join(extDir, rel))) missing.push(rel);
  }
  return { refs: refs.size, missing };
}

export function readExtensionManifest(extDir) {
  return JSON.parse(fs.readFileSync(path.join(extDir, "manifest.json"), "utf-8"));
}
