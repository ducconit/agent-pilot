#!/usr/bin/env node
/**
 * Agent Pilot - Tab Group Isolation & Security Boundary Verification
 *
 * Verifies that the agent is strictly confined to tabs within the
 * Agent Pilot tab group ('🤖 Agent Pilot') and prohibited from accessing,
 * manipulating, querying, or closing user tabs in other groups or ungrouped tabs.
 */

import { createRecorder } from "../../../scripts/lib/harness.mjs";
import {
  getAgentGroupIds,
  isTabInAgentGroup,
  getAgentGroupTabs,
  getTargetTabId
} from "../../../extensions/background/tab-manager.js";
import { tabsHandlers } from "../../../extensions/background/agent-handlers/tabs.js";
import { agentControlledTabs, AGENT_GROUP_TITLE } from "../../../extensions/background/constants.js";
import { executeBatchActions } from "../../../extensions/background/batch-executor.js";

const recorder = createRecorder({
  title: "📊 BẢNG TỔNG KẾT KIỂM THỬ TAB GROUP ISOLATION & BẢO MẬT:",
  itemKey: "feature",
  summaryStyle: "features",
  successMessage: "\n🎉 TAB GROUP ISOLATION ĐƯỢC XÁC MINH TUYỆT ĐỐI AN TOÀN!"
});

const record = recorder.record;

console.log("==================================================================");
console.log("🛡️ KIỂM THỬ BẢO MẬT: CHỈ CHO AGENT THAO TÁC TRÊN TAB GROUP CỦA NÓ");
console.log("==================================================================\n");

// Mock Chrome Environment
const mockTabs = [
  { id: 101, title: "Personal Email", url: "https://mail.google.com", active: true, windowId: 1, groupId: -1 },
  { id: 102, title: "Work Dashboard", url: "https://corp.internal", active: false, windowId: 1, groupId: 20 },
  { id: 201, title: "Agent Search", url: "https://google.com", active: false, windowId: 1, groupId: 10 },
  { id: 202, title: "Agent Target Page", url: "https://example.com", active: true, windowId: 1, groupId: 10 },
  { id: 301, title: "Agent In-Flight Tab", url: "about:blank", active: false, windowId: 1, groupId: -1 }
];

const mockGroups = [
  { id: 10, title: AGENT_GROUP_TITLE, color: "cyan", windowId: 1 },
  { id: 20, title: "Work Tasks", color: "blue", windowId: 1 }
];

globalThis.chrome = {
  tabGroups: {
    TAB_GROUP_ID_NONE: -1,
    query: async () => mockGroups
  },
  tabs: {
    get: async (id) => {
      const found = mockTabs.find((t) => t.id === Number(id));
      if (!found) throw new Error(`No tab with id: ${id}`);
      return found;
    },
    query: (queryInfo, cb) => {
      let res = [...mockTabs];
      if (queryInfo.active !== undefined) res = res.filter((t) => t.active === queryInfo.active);
      if (queryInfo.windowId !== undefined) res = res.filter((t) => t.windowId === queryInfo.windowId);
      if (queryInfo.groupId !== undefined) res = res.filter((t) => t.groupId === queryInfo.groupId);
      cb(res);
    },
    update: (id, props, cb) => {
      const tab = mockTabs.find((t) => t.id === id);
      if (tab) Object.assign(tab, props);
      cb(tab);
    },
    remove: (id, cb) => {
      const idx = mockTabs.findIndex((t) => t.id === id);
      if (idx !== -1) mockTabs.splice(idx, 1);
      cb();
    }
  },
  runtime: { lastError: null }
};

// Set up in-flight agent tab
agentControlledTabs.clear();
agentControlledTabs.add(201);
agentControlledTabs.add(202);
agentControlledTabs.add(301); // in-flight tab before group assignment

async function runTests() {
  // 1. getAgentGroupIds returns only Agent Pilot group IDs
  const groupIds = await getAgentGroupIds();
  record(
    "1. getAgentGroupIds identifies only Agent Pilot groups",
    groupIds.has(10) && !groupIds.has(20) && groupIds.size === 1,
    `Identified agent groups: [${Array.from(groupIds).join(", ")}], ignored user groups: [20]`
  );

  // 2. isTabInAgentGroup allows agent group tab (id: 201)
  const isAgentTabAllowed = await isTabInAgentGroup(201);
  record(
    "2. isTabInAgentGroup permits tabs in Agent Pilot group",
    isAgentTabAllowed === true,
    `Tab 201 (groupId: 10) allowed: ${isAgentTabAllowed}`
  );

  // 3. isTabInAgentGroup blocks foreign group tab (id: 102, group: Work Tasks)
  const isForeignTabBlocked = await isTabInAgentGroup(102);
  record(
    "3. isTabInAgentGroup strictly denies foreign group tabs (Work Tasks)",
    isForeignTabBlocked === false,
    `Tab 102 (groupId: 20) in user group 'Work Tasks' blocked: ${!isForeignTabBlocked}`
  );

  // 4. isTabInAgentGroup blocks ungrouped user tab (id: 101, Personal Email)
  const isUserPersonalTabBlocked = await isTabInAgentGroup(101);
  record(
    "4. isTabInAgentGroup strictly denies ungrouped user tabs (Personal Email)",
    isUserPersonalTabBlocked === false,
    `Tab 101 (Personal Email, groupId: -1) blocked: ${!isUserPersonalTabBlocked}`
  );

  // 5. isTabInAgentGroup permits in-flight agent tab (id: 301)
  const isInFlightAllowed = await isTabInAgentGroup(301);
  record(
    "5. isTabInAgentGroup permits freshly created agent tab during transition",
    isInFlightAllowed === true,
    `Tab 301 (agentControlled, groupId: -1) allowed: ${isInFlightAllowed}`
  );

  // 6. getAgentGroupTabs returns only agent tabs
  const agentTabs = await getAgentGroupTabs();
  const agentTabIds = agentTabs.map((t) => t.id);
  const leakedUserTabs = agentTabIds.filter((id) => id === 101 || id === 102);
  record(
    "6. getAgentGroupTabs isolates tabs exclusively to Agent Pilot group",
    agentTabIds.includes(201) && agentTabIds.includes(202) && leakedUserTabs.length === 0,
    `Returned agent tabs: [${agentTabIds.join(", ")}], leaked user tabs: [${leakedUserTabs.join(", ")}]`
  );

  // 7. getTargetTabId with explicit foreign tab throws Access Denied
  let deniedError = null;
  try {
    await getTargetTabId(102);
  } catch (err) {
    deniedError = err;
  }
  record(
    "7. getTargetTabId with foreign tabId throws Access Denied security error",
    !!deniedError && deniedError.message.includes("Access denied"),
    deniedError ? deniedError.message : "Failed to deny"
  );

  // 8. getTargetTabId with explicit user personal tab throws Access Denied
  let userDeniedError = null;
  try {
    await getTargetTabId(101);
  } catch (err) {
    userDeniedError = err;
  }
  record(
    "8. getTargetTabId with ungrouped user tabId throws Access Denied security error",
    !!userDeniedError && userDeniedError.message.includes("Access denied"),
    userDeniedError ? userDeniedError.message : "Failed to deny"
  );

  // 9. getTargetTabId with explicit agent tab resolves successfully
  const resolvedAgentTab = await getTargetTabId(201);
  record(
    "9. getTargetTabId with valid agent tabId resolves successfully",
    resolvedAgentTab === 201,
    `Resolved target tab: ${resolvedAgentTab}`
  );

  // 10. getTargetTabId with no tabId resolves to active agent tab (202), NEVER active user tab (101)
  const resolvedDefaultTab = await getTargetTabId(null);
  record(
    "10. getTargetTabId with omitted tabId finds active agent tab, NEVER user's active tab (101)",
    resolvedDefaultTab === 202,
    `Resolved default tab: ${resolvedDefaultTab} (active agent tab), user tab 101 avoided`
  );

  // 11. getTargetTabId with no agent tabs returns null (no fallback to user tab)
  agentControlledTabs.clear();
  const tempGroups = [...mockGroups];
  mockGroups.length = 0; // Simulate zero agent groups
  const nullFallback = await getTargetTabId(null);
  mockGroups.push(...tempGroups);
  agentControlledTabs.add(201);
  agentControlledTabs.add(202);
  record(
    "11. getTargetTabId with empty agent group returns null without hijacking user tab",
    nullFallback === null,
    `Returned: ${nullFallback}`
  );

  // 12. tabs.listAll returns ONLY agent tabs
  let listAllResult = null;
  const mockClient = {
    getAgentGroupTabs,
    getAgentGroupIds,
    isTabInAgentGroup,
    getTargetTabId
  };
  await tabsHandlers["tabs.listAll"](mockClient, {}, (res, err) => {
    listAllResult = res;
  });
  const listIds = (listAllResult || []).map((t) => t.tabId);
  const listContainsUser = listIds.includes(101) || listIds.includes(102);
  record(
    "12. tabs.listAll handler never exposes user tabs or foreign groups",
    !listContainsUser && listIds.includes(201) && listIds.includes(202),
    `Listed tabs: [${listIds.join(", ")}], contains user tabs: ${listContainsUser}`
  );

  // 13. tabs.query filters out foreign tabs
  let queryResult = null;
  await tabsHandlers["tabs.query"](mockClient, {}, (res, err) => {
    queryResult = res;
  });
  const queryIds = (queryResult || []).map((t) => t.id);
  const queryContainsUser = queryIds.includes(101) || queryIds.includes(102);
  record(
    "13. tabs.query handler strictly filters out user tabs and foreign groups",
    !queryContainsUser && queryIds.includes(201),
    `Queried tabs: [${queryIds.join(", ")}], contains user tabs: ${queryContainsUser}`
  );

  // 14. tabs.update on foreign tab returns Access Denied error
  let updateError = null;
  await tabsHandlers["tabs.update"](mockClient, { tabId: 102, url: "https://malicious.com" }, (res, err) => {
    updateError = err;
  });
  record(
    "14. tabs.update strictly rejects modifying foreign tab in user group",
    !!updateError && updateError.message.includes("Access denied"),
    updateError ? updateError.message : "Failed to reject update"
  );

  // 15. tabs.remove on foreign tab returns Access Denied error
  let removeError = null;
  await tabsHandlers["tabs.remove"](mockClient, { tabId: 101 }, (res, err) => {
    removeError = err;
  });
  record(
    "15. tabs.remove strictly rejects closing user's personal tab",
    !!removeError && removeError.message.includes("Access denied"),
    removeError ? removeError.message : "Failed to reject remove"
  );

  // 16. batch execution halts on foreign tab
  let batchHalted = false;
  try {
    await executeBatchActions({
      tabId: 102, // Foreign tab
      actions: [{ type: "scroll", deltaY: 100 }],
      stopOnError: true
    }, mockClient);
  } catch (bErr) {
    batchHalted = bErr.message.includes("Access denied");
  }
  record(
    "16. Batch pipeline halts immediately when targeting foreign tab",
    batchHalted === true,
    `Batch properly rejected foreign tab: ${batchHalted}`
  );

  recorder.summarize();
  recorder.exitIfFailed();
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
