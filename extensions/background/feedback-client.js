/**
 * Agent Pilot - Feedback Channel A/B transport client
 * Talks to the Go bridge HTTP endpoints and degrades gracefully:
 *  - Channel B (inbox): HTTP POST /api/feedback/save → chrome.storage.local fallback
 *  - Channel A (live):  HTTP POST /api/feedback/push → WebSocket → storage fallback
 */

import { getSecretFilterEnabled, LIMITS, logDebug } from "./constants.js";
import { sanitizeData } from "./secret-sanitizer.js";

/**
 * Save a feedback session into the shared inbox (filesystem via bridge).
 * Falls back to sanitized chrome.storage.local entries, bounded to the most
 * recent FALLBACK_FEEDBACK_SESSIONS so storage cannot grow without limit.
 */
export async function saveFeedbackInbox(client, payload) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (client.apiKey) headers["X-Agent-Pilot-Key"] = client.apiKey;
    const resp = await fetch(`http://127.0.0.1:${client.port}/api/feedback/save`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (data && data.success) {
      return { success: true, ...data, storage: "filesystem" };
    }
    throw new Error(data?.error || "Bridge server returned failure");
  } catch (err) {
    const timestamp = String(payload?.timestamp || Date.now());
    const key = `ap_feedback_${timestamp}`;
    const sanitizedPayload = sanitizeData(payload, getSecretFilterEnabled());
    await new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: sanitizedPayload }, () => {
          chrome.storage.local.get(null, (all) => {
            const feedbackKeys = Object.keys(all || {}).filter((k) => k.startsWith("ap_feedback_"));
            if (feedbackKeys.length > LIMITS.FALLBACK_FEEDBACK_SESSIONS) {
              // Timestamp keys share the same length, so lexical sort == chronological
              feedbackKeys.sort();
              const excess = feedbackKeys.slice(0, feedbackKeys.length - LIMITS.FALLBACK_FEEDBACK_SESSIONS);
              chrome.storage.local.remove(excess, () => resolve());
            } else {
              resolve();
            }
          });
        });
      } else {
        resolve();
      }
    });
    logDebug("saveFeedbackInbox fallback storage", err);
    return {
      success: true,
      storage: "extension_storage",
      sessionId: timestamp,
      warning: `Saved to browser extension storage (bridge server unreachable: ${err.message})`
    };
  }
}

/**
 * Push a feedback session live to a waiting agent (Channel A).
 * Order of transports: HTTP long-poll endpoint → WebSocket → persistent storage.
 */
export async function pushFeedbackLive(client, payload) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (client.apiKey) headers["X-Agent-Pilot-Key"] = client.apiKey;
    const resp = await fetch(`http://127.0.0.1:${client.port}/api/feedback/push`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (data && data.success) {
      return { success: true, ...data, channel: "http_push" };
    }
    throw new Error(data?.error || "Push failed");
  } catch (httpErr) {
    // Fallback: If HTTP endpoint is unavailable, try WebSocket transmission
    if (client.connected && client.ws && client.ws.readyState === WebSocket.OPEN) {
      client.send({
        type: "FEEDBACK_SUBMISSION",
        payload
      });
      return { success: true, channel: "ws_push", sessionId: String(payload?.timestamp || Date.now()) };
    }
    // If server is completely offline, fall back to persistent extension storage
    return await saveFeedbackInbox(client, payload);
  }
}
