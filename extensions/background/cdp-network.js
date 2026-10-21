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
export { setEmulation } from "./cdp-emulation.js";

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
