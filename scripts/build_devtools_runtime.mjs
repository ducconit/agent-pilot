/** Build-time only: embed a verified Node executable and locked JS assets. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createZip } from "./lib/zip.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_VERSION = "24.13.0";
const architecture = { amd64: "x64", arm64: "arm64" };
export async function prepareDevtoolsRuntime({ goos = process.platform === "win32" ? "windows" : process.platform, goarch = process.arch === "x64" ? "amd64" : process.arch, release = false } = {}) {
  const nodeOS = goos === "windows" ? "win" : goos;
  if (!["linux", "darwin", "win"].includes(nodeOS) || !architecture[goarch]) throw new Error(`Unsupported runtime platform: ${goos}-${goarch}`);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pilot-runtime-"));
  const destination = path.join(root, "cli", "devtools", "payload", "runtime.zip");
  try {
    const executableName = goos === "windows" ? "node.exe" : "node";
    // Offline developer builds can opt into the build machine's executable.
    // Releases always use the pinned, checksum-verified distribution below.
    if (process.env.AGENT_PILOT_BUILD_NODE_BINARY && !release) {
      if (goos !== (process.platform === "win32" ? "windows" : process.platform) || goarch !== (process.arch === "x64" ? "amd64" : process.arch)) throw new Error("Cannot cross-build with the build machine's Node binary");
      fs.copyFileSync(process.env.AGENT_PILOT_BUILD_NODE_BINARY, path.join(stage, executableName));
    } else {
      const name = `node-v${NODE_VERSION}-${nodeOS}-${architecture[goarch]}`;
      const extension = nodeOS === "win" ? ".zip" : ".tar.gz";
      const url = `https://nodejs.org/dist/v${NODE_VERSION}/`;
      const cache = path.join(root, "dist", "runtime-cache");
      fs.mkdirSync(cache, { recursive: true });
      const archivePath = path.join(cache, name + extension), sumsPath = path.join(cache, `SHASUMS256-v${NODE_VERSION}.txt`);
      for (const [remote, local] of [["SHASUMS256.txt", sumsPath], [name + extension, archivePath]]) {
        if (fs.existsSync(local)) continue;
        const response = await fetch(url + remote, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`Cannot download build runtime: ${response.status} ${remote}`);
        fs.writeFileSync(local, Buffer.from(await response.arrayBuffer()));
      }
      const expected = fs.readFileSync(sumsPath, "utf8").split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(([, file]) => file === name + extension)?.[0];
      const actual = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
      if (!expected || expected !== actual) throw new Error(`Runtime checksum mismatch: ${archivePath}`);
      const unpack = path.join(stage, "distribution"); fs.mkdirSync(unpack);
      if (nodeOS === "win" && process.platform !== "win32") execFileSync("unzip", ["-q", archivePath, "-d", unpack]);
      else execFileSync("tar", ["-xf", archivePath, "-C", unpack]);
      const distribution = path.join(unpack, name);
      fs.copyFileSync(path.join(distribution, nodeOS === "win" ? "node.exe" : "bin/node"), path.join(stage, executableName));
      fs.copyFileSync(path.join(distribution, "LICENSE"), path.join(stage, "NODE-LICENSE.txt"));
      fs.rmSync(unpack, { recursive: true, force: true });
    }
    fs.chmodSync(path.join(stage, executableName), 0o755);
    const filter = source => !source.endsWith(".map") && !source.endsWith(".d.ts") && ![".bin", "test", "tests", ".cache"].includes(path.basename(source));
    if (!fs.existsSync(path.join(root, "node_modules", "lighthouse", "package.json"))) throw new Error("Missing build dependencies; run npm ci on the build machine");
    fs.cpSync(path.join(root, "node_modules"), path.join(stage, "node_modules"), { recursive: true, filter });
    fs.cpSync(path.join(root, "devtools"), path.join(stage, "devtools"), { recursive: true });
    fs.mkdirSync(path.join(stage, "scripts"));
    fs.copyFileSync(path.join(root, "scripts", "browser_resolver.mjs"), path.join(stage, "scripts", "browser_resolver.mjs"));
    fs.cpSync(path.join(root, "extensions", "background"), path.join(stage, "extensions", "background"), { recursive: true });
    fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ private: true, type: "module" }));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    createZip(stage, destination, { excludes: [], quiet: true });
    console.log(`Embedded DevTools runtime prepared for ${goos}-${goarch}`);
    return destination;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareDevtoolsRuntime({ goos: process.argv[2], goarch: process.argv[3] });
