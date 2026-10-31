/**
 * verify_agent_connection - Feature section: batch action engine over WebSocket
 * and over the HTTP API (records 23-24).
 *
 * A single batch.run call drives an open -> wait -> click -> type -> devtools ->
 * screenshot -> close sequence, proving one tool call can perform a whole flow.
 */
import http from "node:http";
import { TIMEOUTS, LOCAL_HOST } from "../../../scripts/lib/config.mjs";

export async function run({ sendAgentCommand, bridgePort, httpPort, getSelectedInstanceId, record }) {
  // 23. Test Batch Action Execution via WebSocket (batch.run)
  // Sequence: open -> wait_for_selector -> click -> type (with clear) -> devtools -> screenshot -> close
  const batchRes = await sendAgentCommand("batch.run", {
    actions: [
      { type: "open", url: `http://${LOCAL_HOST}:${httpPort}/test-page.html`, loadTimeout: TIMEOUTS.BATCH_LOAD_MS },
      { type: "wait_for_selector", selector: "#btn-sample-click", timeoutMs: TIMEOUTS.WAIT_FOR_SELECTOR_MS },
      { type: "click", selector: "#btn-sample-click" },
      { type: "type", selector: "#test-search-input", text: "Batch Action Automation Verified", clear: true },
      { type: "devtools", devtoolsType: "performance" },
      { type: "screenshot", label: "batch_test" },
      { type: "close" }
    ]
  }, TIMEOUTS.BATCH_RUN_MS);

  const isBatchSuccess = batchRes?.success === true &&
                         batchRes?.results?.length === 7 &&
                         batchRes?.results[0]?.type === "open" &&
                         batchRes?.results[1]?.type === "wait_for_selector" &&
                         batchRes?.results[2]?.type === "click" &&
                         batchRes?.results[3]?.type === "type" &&
                         batchRes?.results[4]?.type === "devtools" &&
                         batchRes?.results[4]?.performance?.domNodes > 0 &&
                         batchRes?.results[5]?.dataUrl?.startsWith("data:image/png;base64,") &&
                         batchRes?.results[6]?.type === "close";

  record("23. Batch Actions Engine (Single Tool Call)", isBatchSuccess, `Executed 7-step batch (open -> wait -> click -> type -> devtools -> screenshot -> close) in ${batchRes?.durationMs}ms`);

  // 24. Test Batch Actions via HTTP REST API (POST /api method: batch.run)
  const httpBatchParams = {
    actions: [
      { type: "open", url: `http://${LOCAL_HOST}:${httpPort}/test-page.html` },
      { type: "wait_for_selector", selector: "#btn-sample-click" },
      { type: "devtools" },
      { type: "close" }
    ]
  };
  const selectedInstanceId = getSelectedInstanceId();
  if (selectedInstanceId) {
    httpBatchParams.instanceId = selectedInstanceId;
  }

  const httpBatchRes = await new Promise((resolve) => {
    const req = http.request(`http://${LOCAL_HOST}:${bridgePort}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, (res) => {
      let b = "";
      res.on("data", c => b += c);
      res.on("end", () => {
        try { resolve(JSON.parse(b)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.write(JSON.stringify({
      method: "batch.run",
      params: httpBatchParams
    }));
    req.end();
  });

  const isHttpBatchSuccess = httpBatchRes?.success === true &&
                             httpBatchRes?.result?.success === true &&
                             httpBatchRes?.result?.executedActions === 4 &&
                             Array.isArray(httpBatchRes?.result?.results[2]?.console) &&
                             httpBatchRes?.result?.results[2]?.performance?.domNodes > 0;
  record("24. Batch Actions HTTP API Endpoint", isHttpBatchSuccess, `Executed 4 actions (including default devtools) via HTTP /api in ${httpBatchRes?.result?.durationMs}ms`);
}
