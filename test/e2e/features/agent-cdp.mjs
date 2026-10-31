/**
 * verify_agent_connection - Feature section: CDP attach + devtools.getData over
 * the agent bridge (records 15-16).
 */
import { sleep } from "../../../scripts/lib/harness.mjs";

export async function run({ sendAgentCommand, testPage, tabId, record }) {
  // 15. Test Agent Command: cdp.attach & devtools.getData
  const attachRes = await sendAgentCommand("cdp.attach", { tabId });
  record("15. Agent Command: cdp.attach", attachRes?.success === true, `CDP Attached to Tab ${tabId}`);

  // Trigger a console log and fetch devtools data over bridge
  if (testPage) {
    await testPage.evaluate(() => console.log("LOG_VIA_AGENT_PORT_58765_TOKEN"));
  }
  await sleep(600);

  const devtoolsRes = await sendAgentCommand("devtools.getData", { tabId });
  const hasLog = devtoolsRes?.console?.some(c => c.text.includes("LOG_VIA_AGENT_PORT_58765_TOKEN"));
  const hasPerf = devtoolsRes?.performance?.domNodes > 0 && typeof devtoolsRes?.performance?.jsHeapUsedMB === "number";
  record("16. Agent Command: devtools.getData", hasLog && hasPerf, `Captured ${devtoolsRes?.console?.length} logs & Performance (Heap: ${devtoolsRes?.performance?.jsHeapUsedMB} MB, Nodes: ${devtoolsRes?.performance?.domNodes})`);

  // 16b. Test Agent Commands: cdp.status & cdp.detach
  const statusRes = await sendAgentCommand("cdp.status", { tabId });
  const detachRes = await sendAgentCommand("cdp.detach", { tabId });
  const postDetachStatus = await sendAgentCommand("cdp.status", { tabId });
  record(
    "16b. Agent Command: cdp.status & cdp.detach",
    statusRes?.attached === true && detachRes?.success === true && postDetachStatus?.attached === false,
    `Initial attached: ${statusRes?.attached}, Detached: ${detachRes?.success}, Post-detach attached: ${postDetachStatus?.attached}`
  );
}
