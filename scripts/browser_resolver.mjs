/**
 * Agent Pilot - Cross-Platform Browser Resolver
 * Dynamically resolves installed Chromium, Google Chrome, Microsoft Edge, or Brave
 * across Windows (win32), macOS (darwin), and Linux (linux).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Resolve the path to a Chrome / Chromium executable
 * Prioritizes environment variables, then system install paths by OS.
 */
export function resolveChromiumBin() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  if (process.env.CHROMIUM_BIN && fs.existsSync(process.env.CHROMIUM_BIN)) {
    return process.env.CHROMIUM_BIN;
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
      // Common Puppeteer/test cache locations
      "/tmp/browsers/chromium/linux-1696738/chrome-linux/chrome",
      // System packages
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/bin/microsoft-edge",
      "/usr/bin/brave-browser"
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback if none found
  if (platform === "win32") {
    return path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe");
  } else if (platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  } else {
    return "/tmp/browsers/chromium/linux-1696738/chrome-linux/chrome";
  }
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
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`
  ];

  // Only apply X11 ozone platform on Linux when running with an X11 display
  if (process.platform === "linux" && (process.env.DISPLAY || process.env.XVFB_DISPLAY)) {
    args.push("--ozone-platform=x11");
  }

  return args;
}
