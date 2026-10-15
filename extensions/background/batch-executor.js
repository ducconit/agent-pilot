/**
 * Agent Pilot - Batch Actions Execution Engine
 * Executes ordered sequences of browser actions in a single tool call.
 *
 * This module owns only orchestration: resolving the starting tab, running the
 * steps in order, applying stopOnError, and shaping the response envelope. The
 * individual action bodies live in ./batch-actions.js and the validation
 * helpers in ./batch-validation.js.
 */

import { getTargetTabId } from "./tab-manager.js";
import { BATCH_ACTION_HANDLERS } from "./batch-actions.js";

/**
 * Execute batch action list sequentially.
 *
 * Response contract:
 *   - Success: { success: true, totalActions, executedActions, durationMs, results }
 *   - Halted:  { success: false, error, failedStep, totalActions, executedActions,
 *                durationMs, results }
 * `results` is always the full history of attempted steps: every step that ran
 * is recorded (successes and failures alike), so callers can inspect the partial
 * effects of an aborted batch. `executedActions === results.length`.
 */
export async function executeBatchActions(params, bridgeClient = null) {
  const actions = Array.isArray(params.actions) ? params.actions : [];
  // stopOnError defaults to TRUE: an error halts the batch. Callers must pass
  // an explicit `stopOnError: false` to keep running and collect every failure.
  const stopOnError = params.stopOnError !== false;
  let currentTabId = null;
  try {
    currentTabId = await getTargetTabId(params.tabId, bridgeClient?.lastAgentTabId);
  } catch (err) {
    if (stopOnError) throw err;
  }
  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    const stepNum = i + 1;
    const type = (act.type || act.action || "").toLowerCase();
    const stepResult = { step: stepNum, type, success: false };

    try {
      const handler = BATCH_ACTION_HANDLERS[type];
      if (!handler) {
        throw new Error(`Unsupported batch action type: ${type}`);
      }
      // Handlers receive a context object they may mutate (notably currentTabId)
      // instead of closing over loop locals, so the executor stays the single
      // owner of mutable state.
      const ctx = { bridgeClient, currentTabId, params, stepResult, stepNum };
      await handler(ctx, act);
      currentTabId = ctx.currentTabId;
      results.push(stepResult);
    } catch (stepErr) {
      stepResult.success = false;
      stepResult.error = stepErr.message || String(stepErr);
      results.push(stepResult);

      if (stopOnError) {
        // Failure envelope: report where we stopped and how far we got, while
        // still returning every attempted step's result for partial reuse.
        return {
          success: false,
          error: `Batch execution halted at step ${stepNum} (${type}): ${stepErr.message || stepErr}`,
          failedStep: stepNum,
          totalActions: actions.length,
          executedActions: results.length,
          durationMs: Date.now() - startTime,
          results
        };
      }
    }
  }

  return {
    success: results.every(r => r.success),
    totalActions: actions.length,
    executedActions: results.length,
    durationMs: Date.now() - startTime,
    results
  };
}
