/**
 * Agent Pilot - Cross-Platform Browser Resolver
 * Dynamically resolves installed Chromium, Google Chrome, Microsoft Edge, or Brave
 * across Windows (win32), macOS (darwin), and Linux (linux).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

// Resolve a command name to its absolute path via the OS PATH (which/where).
function which(cmd) {
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(finder, [cmd], { encoding: "utf8" });
    return out.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  } catch (_) {
    return null;
  }
}

function findPlaywrightOrPuppeteerChromeForTesting() {
  const home = os.homedir();
  const roots = [
    path.join(home, ".cache", "puppeteer", "chrome"),
    path.join(home, ".cache", "ms-playwright")
  ];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
      for (const entry of entries) {
        const subCandidates = [
          path.join(root, entry.name, "chrome-linux64", "chrome"),
          path.join(root, entry.name, "chrome-linux", "chrome"),
          path.join(root, entry.name, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
          path.join(root, entry.name, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
          path.join(root, entry.name, "chrome-win64", "chrome.exe")
        ];
        for (const sub of subCandidates) {
          if (fs.existsSync(sub)) found.push(sub);
        }
      }
    } catch (_) {}
  }
  return found.sort().at(-1) || null;
}

/**
 * Resolve the path to a Chrome / Chromium executable
 * Prioritizes environment variables, Chrome for Testing (which supports
 * --load-extension and Page.startScreenRecording on Chrome 137+), then system install paths by OS.
 */
export function resolveChromiumBin() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  if (process.env.CHROMIUM_BIN && fs.existsSync(process.env.CHROMIUM_BIN)) {
    return process.env.CHROMIUM_BIN;
  }

  for (const cftCmd of ["google-chrome-for-testing", "chrome-for-testing"]) {
    const resolved = which(cftCmd);
    if (resolved) return resolved;
  }
  const cachedCft = findPlaywrightOrPuppeteerChromeForTesting();
  if (cachedCft) return cachedCft;

  // Prefer well-known browser command names found on PATH.
  const commandCandidates = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser"
  ];
  for (const cmd of commandCandidates) {
    const resolved = which(cmd);
    if (resolved) return resolved;
  }

  const platform = process.platform;
  const candidates = [];

  if (platform === "win32") {
    const programFiles = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env["LOCALAPPDATA"] || path.join(os.homedir(), "AppData", "Local");

    candidates.push(
      // Google Chrome
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      // Microsoft Edge (Pre-installed on Windows 10/11)
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      // Brave Browser
      path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      // Chromium
      path.join(localAppData, "Chromium", "Application", "chrome.exe")
    );
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      path.join(os.homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome")
    );
  } else {
    // Linux
    candidates.push(
      // System packages
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/bin/microsoft-edge",
      "/usr/bin/brave-browser",
      // Vendor install locations
      "/opt/google/chrome/chrome",
      "/usr/lib/chromium/chromium",
      "/usr/lib/chromium-browser/chromium-browser",
      // Flatpak exports
      "/var/lib/flatpak/exports/bin/com.google.Chrome",
      "/var/lib/flatpak/exports/bin/org.chromium.Chromium"
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Could not locate a Chrome/Chromium/Edge/Brave executable. " +
    "Set the CHROME_BIN or CHROMIUM_BIN environment variable to the browser binary path."
  );
}

/**
 * Return browser launch arguments tailored to the host platform
 * Avoids passing Linux-only flags (like --ozone-platform=x11) to Windows or macOS.
 */
export function getChromiumLaunchArgs(extDir) {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    // Puppeteer uses this opt-in when installing unpacked MV3 extensions.
    "--enable-unsafe-extension-debugging",
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`
  ];

  // Only apply X11 ozone platform on Linux when running with an X11 display
  if (process.platform === "linux" && (process.env.DISPLAY || process.env.XVFB_DISPLAY)) {
    args.push("--ozone-platform=x11");
  }

  // Containers/CI usually mount a tiny /dev/shm; Chrome crashes without this flag.
  if (process.env.CI) {
    args.push("--disable-dev-shm-usage");
  }

  return args;
}
