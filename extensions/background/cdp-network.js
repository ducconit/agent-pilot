/**
 * Agent Pilot - CDP Network & Emulation
 *
 * Environment emulation (CPU/network/color-scheme/viewport) and retrieval of
 * captured network request/response details.
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

/**
 * Return the captured request metadata plus request/response bodies when they
 * are available. The request metadata is captured by cdp-events while the
 * body calls deliberately remain lazy so normal network listing stays cheap.
 */
export async function getNetworkRequestDetail(tabId, requestId, options = {}, request = {}) {
  if (!requestId) throw new Error("requestId is required to inspect a network request");
  const detail = { ...request, requestId };

  if (options.includeRequestBody !== false && detail.postData === undefined) {
    try {
      const requestBody = await sendCdpCommand(tabId, "Network.getRequestPostData", { requestId });
      detail.postData = requestBody.postData;
    } catch (_) {
      // GET requests and requests whose body was not retained have no postData.
    }
  }

  if (options.includeResponseBody !== false) {
    const response = await getNetworkResponseBody(tabId, requestId);
    detail.responseBody = response.body;
    detail.base64Encoded = response.base64Encoded;
  }

  return detail;
}
