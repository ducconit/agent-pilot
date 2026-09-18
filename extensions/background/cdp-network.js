/**
 * Agent Pilot - CDP Network & Emulation
 *
 * Environment emulation (CPU/network/color-scheme/viewport) and retrieval of
 * captured network response bodies.
 */

import { sendCdpCommand } from "./cdp-connection.js";

/**
 * Configure environment emulation: CPU, network throttling, color scheme, viewport
 */
export async function setEmulation(tabId, options = {}) {
  const applied = {};

  // 1. CPU Throttling
  if (options.cpuThrottlingRate !== undefined) {
    const rate = Number(options.cpuThrottlingRate) || 1;
    await sendCdpCommand(tabId, "Emulation.setCPUThrottlingRate", { rate });
    applied.cpuThrottlingRate = rate;
  }

  // 2. Network Conditions
  if (options.networkConditions !== undefined) {
    let netParams;
    const cond = options.networkConditions;
    if (typeof cond === "string") {
      // Named presets mirror DevTools' throttling profiles. Throughputs are in
      // bytes/sec (CDP wants bytes, the familiar figures are bits/sec), hence /8.
      const lower = cond.toLowerCase();
      if (lower === "offline") {
        netParams = { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 };
      } else if (lower === "slow-3g" || lower === "slow3g") {
        netParams = { offline: false, latency: 400, downloadThroughput: Math.round((500 * 1024) / 8), uploadThroughput: Math.round((500 * 1024) / 8) };
      } else if (lower === "fast-3g" || lower === "fast3g") {
        netParams = { offline: false, latency: 100, downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8), uploadThroughput: Math.round((750 * 1024) / 8) };
      } else {
        // Unknown preset name: disable throttling (-1 == unlimited).
        netParams = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
      }
    } else if (typeof cond === "object" && cond !== null) {
      netParams = {
        offline: !!cond.offline,
        latency: cond.latency || 0,
        downloadThroughput: cond.downloadThroughput !== undefined ? cond.downloadThroughput : -1,
        uploadThroughput: cond.uploadThroughput !== undefined ? cond.uploadThroughput : -1
      };
    }
    if (netParams) {
      await sendCdpCommand(tabId, "Network.emulateNetworkConditions", netParams);
      applied.networkConditions = netParams;
    }
  }

  // 3. Color Scheme
  if (options.colorScheme !== undefined) {
    const scheme = String(options.colorScheme).toLowerCase();
    // Only dark/light are meaningful; anything else clears the override.
    const validScheme = scheme === "dark" || scheme === "light" ? scheme : "";
    await sendCdpCommand(tabId, "Emulation.setEmulatedMedia", {
      media: "",
      features: validScheme ? [{ name: "prefers-color-scheme", value: validScheme }] : []
    });
    applied.colorScheme = validScheme || "default";
  }

  // 4. Viewport / Device Metrics (desktop defaults when a field is omitted)
  if (options.viewport) {
    const vp = options.viewport;
    await sendCdpCommand(tabId, "Emulation.setDeviceMetricsOverride", {
      width: Number(vp.width) || 1280,
      height: Number(vp.height) || 800,
      deviceScaleFactor: Number(vp.deviceScaleFactor) || 1,
      mobile: !!vp.mobile
    });
    applied.viewport = vp;
  }

  return { success: true, applied };
}

/**
 * Get response body for a specific network request
 */
export async function getNetworkResponseBody(tabId, requestId) {
  if (!requestId) {
    throw new Error("requestId is required to get network response body");
  }
  const result = await sendCdpCommand(tabId, "Network.getResponseBody", { requestId });
  let body = result.body;
  // Best-effort JSON parse: a plain-text body is returned as-is.
  if (!result.base64Encoded && typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (parseErr) {
      console.debug("[AgentPilot] Response body is plain text, not JSON:", parseErr);
    }
  }
  return {
    requestId,
    body,
    base64Encoded: !!result.base64Encoded
  };
}
