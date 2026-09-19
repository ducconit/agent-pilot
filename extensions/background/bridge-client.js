/**
 * Agent Pilot - AI Agent WebSocket Bridge Client
 * Connects to ws://127.0.0.1:<PORT> to receive commands from AI Agents (Antigravity)
 */

import { getSecretFilterEnabled } from "./constants.js";
import { sanitizeData, sanitizeDataWithMeta, AGENT_SECURITY_NOTICE } from "./secret-sanitizer.js";
import { AGENT_COMMAND_HANDLERS } from "./agent-handlers/index.js";
import { initializeTransport, installTransportMethods } from "./bridge-transport.js";
import { installCommandMethods } from "./bridge-commands.js";
import { installFeedbackMethods } from "./bridge-feedback.js";

export class AgentBridgeClient {
  constructor(broadcastFn = null) {
    initializeTransport(this, broadcastFn);
  }
  /**
   * Dispatch an agent command to its registered handler (see agent-handlers/).
   * The responder closure owns sanitization and activity broadcasting, so each
   * handler only implements its own domain logic.
   */
  async handleAgentMessage(msg) {
    const { id, method, params = {} } = msg;
    const respond = this.createResponder(id, method, params);

    const handler = AGENT_COMMAND_HANDLERS[method];
    if (!handler) {
      respond(null, new Error(`Unknown method: ${method}`));
      return;
    }

    try {
      await handler(this, params, respond);
    } catch (err) {
      respond(null, err);
    }
  }

  /**
   * Build the response callback for one agent request:
   * - masks secrets when the filter is enabled and reports masking metadata in the
   *   response envelope (array results lose attached properties through JSON.stringify)
   * - emits a sanitized AGENT_ACTION_LOG broadcast for the side-panel activity list
   */
  createResponder(id, method, params) {
    return (result, error = null) => {
      if (!id) return;
      const isFilterActive = getSecretFilterEnabled();
      let sanitizedResult = result;
      let maskedCount = 0;
      let maskedTypes = [];

      if (result !== undefined && result !== null) {
        const sanitized = sanitizeDataWithMeta(result, isFilterActive);
        sanitizedResult = sanitized.data;
        maskedCount = sanitized.maskedCount;
        maskedTypes = sanitized.types;
      }

      let sanitizedError = error ? (error.message || String(error)) : null;
      if (sanitizedError && isFilterActive) {
        const sanitizedErr = sanitizeDataWithMeta(sanitizedError, true);
        if (typeof sanitizedErr.data === "string") {
          sanitizedError = sanitizedErr.data;
        }
      }

      this.send({
        id,
        result: error ? undefined : sanitizedResult,
        error: sanitizedError,
        secretFilterEnabled: isFilterActive,
        ...(maskedCount > 0 ? {
          securityNotice: AGENT_SECURITY_NOTICE,
          maskedCount,
          maskedTypes
        } : {})
      });

      if (typeof this.broadcastFn === "function") {
        this.broadcastFn({
          type: "AGENT_ACTION_LOG",
          log: {
            id,
            method,
            params: sanitizeData(params, isFilterActive),
            timestamp: Date.now(),
            status: error ? "error" : "success",
            error: error ? (error.message || String(error)) : null
          }
        });
      }
    };
  }

}

// Composition keeps AgentBridgeClient's public method surface stable while each
// responsibility lives in a focused module.
installTransportMethods(AgentBridgeClient);
installCommandMethods(AgentBridgeClient);
installFeedbackMethods(AgentBridgeClient);
