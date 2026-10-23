#!/usr/bin/env node
/**
 * Read-only capability probe for Chromium's browser-scoped PWA CDP domain.
 *
 * Usage:
 *   node scripts/probe_pwa_protocol.mjs [manifest-id]
 *
 * The default manifest id is intentionally synthetic. A backend error such as
 * "Unknown web-app manifest id" proves that the PWA domain is reachable; it
 * does not install, launch, or uninstall an app.
 */

import puppeteer from "puppeteer-core";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveChromiumBin } from "./browser_resolver.mjs";
import { createPwaAdapterFromBrowser } from "../devtools/pwa.mjs";

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-pilot-pwa-probe-"));
const browser = await puppeteer.launch({
  executablePath: resolveChromiumBin(),
  headless: true,
  pipe: true,
  userDataDir,
  defaultViewport: null,
  args: process.env.AGENT_PILOT_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : []
});

try {
  const result = await createPwaAdapterFromBrowser(browser).probe({
    manifestId: process.argv[2] || "https://agent-pilot.invalid/pwa-probe"
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  await fs.rm(userDataDir, { recursive: true, force: true });
}
