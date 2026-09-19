/**
 * Agent Pilot - Batch Action Handlers (registry)
 *
 * Domain modules own the implementations:
 *   - batch-navigation.js   open / navigate / close
 *   - batch-interaction.js  click / type / scroll / hover / drag / upload / dialog / fill
 *   - batch-observation.js  wait / screenshot / snapshot / evaluate / cdp / devtools
 *
 * This file only merges them and declares the alias table (aliases share the
 * same handler, preserving the original grouped-switch semantics). The
 * executor (batch-executor.js) consumes BATCH_ACTION_HANDLERS only.
 */

import { navigationHandlers } from "./batch-navigation.js";
import { interactionHandlers } from "./batch-interaction.js";
import { observationHandlers } from "./batch-observation.js";

export const BATCH_ACTION_HANDLERS = {
  ...navigationHandlers,
  ...interactionHandlers,
  ...observationHandlers,

  // Aliases: same implementation, different action name
  open_tab: navigationHandlers.open,
  "tabs.create": navigationHandlers.open,
  "tabs.update": navigationHandlers.navigate,
  close_tab: navigationHandlers.close,
  "tabs.remove": navigationHandlers.close,

  "page.click": interactionHandlers.click,
  "page.type": interactionHandlers.type,
  key: interactionHandlers.press_key,
  "page.scroll": interactionHandlers.scroll,
  "page.hover": interactionHandlers.hover,
  "page.drag": interactionHandlers.drag,
  upload_file: interactionHandlers.upload,
  handle_dialog: interactionHandlers.dialog,
  fill: interactionHandlers.fill_form,
  "page.fillform": interactionHandlers.fill_form,

  wait: observationHandlers.sleep,
  "page.screenshot": observationHandlers.screenshot,
  "page.snapshot": observationHandlers.snapshot,
  "page.getelement": observationHandlers.get_element,
  eval: observationHandlers.evaluate,
  get_devtools_data: observationHandlers.devtools
};
