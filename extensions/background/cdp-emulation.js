/** Shared emulation implementation for the extension and bundled DevTools host. */
import { sendCdpCommand } from "./cdp-connection.js";

export async function applyEmulation(send, options = {}) {
  const commands = [], applied = {};
  const add = (method, params) => commands.push([method, params]);
  if (options.cpuThrottlingRate !== undefined) {
    const rate = Number(String(options.cpuThrottlingRate).replace(/x$/i, ""));
    if (!Number.isFinite(rate) || rate < 1 || rate > 20) throw new Error("CPU rate must be between 1 and 20");
    add("Emulation.setCPUThrottlingRate", { rate });
    applied.cpuThrottlingRate = rate;
  }
  if (options.networkConditions !== undefined) {
    const presets = { offline: [true, 0, 0, 0], "slow-3g": [false, 400, 64000, 64000], "fast-3g": [false, 100, 204800, 96000], "slow-4g": [false, 150, 200000, 93750], "fast-4g": [false, 60, 1125000, 168750], none: [false, 0, -1, -1] };
    const value = options.networkConditions;
    const key = String(value).toLowerCase().replace(/\s+/g, "-").replace(/^(slow|fast)([34]g)$/, "$1-$2");
    let network = value;
    if (typeof value === "string") {
      if (!presets[key]) throw new Error(`Unknown network preset: ${value}`);
      const [offline, latency, downloadThroughput, uploadThroughput] = presets[key];
      network = { offline, latency, downloadThroughput, uploadThroughput };
    }
    if (!network || typeof network !== "object") throw new Error("Invalid network conditions");
    const params = { offline: !!network.offline, latency: Number(network.latency ?? 0), downloadThroughput: Number(network.downloadThroughput ?? -1), uploadThroughput: Number(network.uploadThroughput ?? -1) };
    if (!Number.isFinite(params.latency) || params.latency < 0 || !Number.isFinite(params.downloadThroughput) || params.downloadThroughput < -1 || !Number.isFinite(params.uploadThroughput) || params.uploadThroughput < -1) throw new Error("Invalid network throughput or latency");
    add("Network.emulateNetworkConditions", params);
    applied.networkConditions = params;
  }
  const media = [["colorScheme", "prefers-color-scheme", ["dark", "light"]], ["prefersReducedMotion", "prefers-reduced-motion", ["reduce", "no-preference"]], ["prefersContrast", "prefers-contrast", ["more", "less", "custom", "no-preference"]], ["forcedColors", "forced-colors", ["active", "none"]]];
  const features = [];
  for (const [key, name, valid] of media) {
    if (options[key] === undefined) continue;
    const value = String(options[key]).toLowerCase();
    if (![...valid, "auto", "default"].includes(value)) throw new Error(`Invalid ${key}: ${value}`);
    if (valid.includes(value)) features.push({ name, value });
    applied[key] = value;
  }
  if (media.some(([key]) => options[key] !== undefined)) add("Emulation.setEmulatedMedia", { media: "", features });
  if (options.geolocation !== undefined) {
    if (options.geolocation === null || options.geolocation === "") {
      add("Emulation.clearGeolocationOverride", {});
      applied.geolocation = null;
    } else {
      const geo = typeof options.geolocation === "string" ? { latitude: options.geolocation.split(",")[0], longitude: options.geolocation.split(",")[1] } : options.geolocation;
      const latitude = Number(geo.latitude), longitude = Number(geo.longitude), accuracy = Number(geo.accuracy ?? 1);
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0) throw new Error("Invalid geolocation");
      add("Emulation.setGeolocationOverride", { latitude, longitude, accuracy });
      applied.geolocation = { latitude, longitude, accuracy };
    }
  }
  if (options.userAgent !== undefined) {
    add("Emulation.setUserAgentOverride", { userAgent: String(options.userAgent || ""), ...(options.userAgentMetadata ? { userAgentMetadata: options.userAgentMetadata } : {}) });
    applied.userAgent = options.userAgent;
  }
  if (options.extraHttpHeaders !== undefined) {
    const headers = typeof options.extraHttpHeaders === "string" ? JSON.parse(options.extraHttpHeaders || "{}") : options.extraHttpHeaders;
    if (!headers || Array.isArray(headers) || typeof headers !== "object" || Object.entries(headers).some(([name, value]) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== "string" || /[\r\n]/.test(value))) throw new Error("extraHttpHeaders must contain valid HTTP header strings");
    add("Network.setExtraHTTPHeaders", { headers });
    applied.extraHttpHeaders = headers;
  }
  for (const [key, method] of [["timezoneId", "Emulation.setTimezoneOverride"], ["locale", "Emulation.setLocaleOverride"]]) {
    if (options[key] !== undefined) {
      add(method, { [key]: String(options[key] || "") });
      applied[key] = options[key];
    }
  }
  if (options.viewport !== undefined) {
    if (options.viewport === null) {
      add("Emulation.clearDeviceMetricsOverride", {});
      add("Emulation.setTouchEmulationEnabled", { enabled: false });
      applied.viewport = null;
    } else {
      const vp = options.viewport, width = Number(vp.width), height = Number(vp.height), deviceScaleFactor = Number(vp.deviceScaleFactor ?? 1);
      if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || !Number.isFinite(deviceScaleFactor) || deviceScaleFactor <= 0) throw new Error("Invalid viewport dimensions or deviceScaleFactor");
      add("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile: !!vp.mobile, screenOrientation: { type: vp.landscape ? "landscapePrimary" : "portraitPrimary", angle: vp.landscape ? 90 : 0 } });
      add("Emulation.setTouchEmulationEnabled", { enabled: !!vp.touch, maxTouchPoints: vp.touch ? 5 : 1 });
      applied.viewport = vp;
    }
  }
  // Validation above completes before any setting is changed.
  for (const [method, params] of commands) await send(method, params);
  return { success: true, applied };
}

const states = new Map();
export async function setEmulation(tabId, options = {}) {
  const merged = { ...states.get(tabId), ...options };
  const result = await applyEmulation((method, params) => sendCdpCommand(tabId, method, params), merged);
  states.set(tabId, merged);
  return result;
}
export function clearEmulationState(tabId) { states.delete(tabId); }
