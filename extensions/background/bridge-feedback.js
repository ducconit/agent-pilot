/**
 * Agent Pilot - feedback transport facade
 *
 * The actual HTTP/WebSocket/storage fallback logic lives in feedback-client.js;
 * these tiny methods preserve the AgentBridgeClient public API.
 */

import { saveFeedbackInbox, pushFeedbackLive } from "./feedback-client.js";

export const feedbackMethods = {
  async saveFeedbackInbox(payload) {
    return await saveFeedbackInbox(this, payload);
  },

  async pushFeedbackLive(payload) {
    return await pushFeedbackLive(this, payload);
  }
};

export function installFeedbackMethods(ClientClass) {
  Object.assign(ClientClass.prototype, feedbackMethods);
}
