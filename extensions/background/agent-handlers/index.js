/**
 * Agent Pilot - Agent bridge handler registry
 * Maps an agent method name to its handler implementation.
 * Aliases preserve the legacy method names that previously fell through
 * switch-cases in bridge-client.js.
 */

import { tabsHandlers } from "./tabs.js";
import { cdpHandlers } from "./cdp.js";
import { pageInputHandlers } from "./page-input.js";
import { pageSessionHandlers } from "./page-session.js";
import { pageQueryHandlers } from "./page-query.js";
import { devtoolsHandlers } from "./devtools.js";
import { systemHandlers } from "./system.js";
import { devtoolsProtocolHandlers } from "./devtools-protocol.js";
import { serviceWorkerHandlers } from "./service-workers.js";

export const AGENT_COMMAND_HANDLERS = Object.freeze({
  ...tabsHandlers,
  ...cdpHandlers,
  ...pageInputHandlers,
  ...pageSessionHandlers,
  ...pageQueryHandlers,
  ...devtoolsHandlers,
  ...systemHandlers,
  ...devtoolsProtocolHandlers,
  ...serviceWorkerHandlers,

  // Legacy aliases (same implementation, different method name)
  "tabs.list": tabsHandlers["tabs.listAll"],
  "evaluate": pageInputHandlers["page.evaluate"],
  "page.key": pageInputHandlers["page.pressKey"],
  "page.wait": pageInputHandlers["page.waitFor"],
  "page.upload": pageInputHandlers["page.uploadFile"],
  "dialog.handle": pageSessionHandlers["page.handleDialog"],
  "agent.setBusy": pageSessionHandlers["page.setBusy"],
  "session.stop": pageSessionHandlers["session.end"],
  "batch.execute": pageQueryHandlers["batch.run"],
  "runtime.reload": systemHandlers["extension.reload"]
});
