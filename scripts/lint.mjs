#!/usr/bin/env node
/**
 * Agent Pilot - Syntax lint
 *
 * Runs `node --check` over every JavaScript file in extensions/ and scripts/.
 * Centralized here (instead of a long chain in package.json) so newly added
 * modules are always covered by `npm run lint` and CI.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_DIRS = ["extensions", "scripts", "devtools"];

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath);
    } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))) {
      files.push(entryPath);
    }
  }
}
for (const dir of TARGET_DIRS) {
  walk(path.join(ROOT_DIR, dir));
}
files.sort();

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    failed++;
    console.error(`❌ Syntax error: ${path.relative(ROOT_DIR, file)}`);
    const output = (err.stderr || err.stdout || "").toString().trim();
    if (output) console.error(output);
  }
}

if (failed > 0) {
  console.error(`\n❌ Syntax check failed for ${failed}/${files.length} files`);
  process.exit(1);
}
console.log(`✅ Syntax check passed for ${files.length} files`);
