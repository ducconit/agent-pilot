import assert from "node:assert/strict";
import { createWebMcpRuntime, executeWebMcpTool, listWebMcpTools, WebMcpError } from "../../../devtools/webmcp.mjs";

function createFixturePage() {
  const calls = [];
  const tools = [
    {
      name: "search_catalog",
      description: "Search the fixture catalog",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"]
      },
      annotations: { readOnly: true },
      frame: { id: "hidden-frame-handle" },
      async execute(input) {
        calls.push(input);
        return { id: "invocation-1", status: "Completed", output: { matches: [input.query] } };
      }
    },
    {
      name: "failing_tool",
      description: "A fixture tool that reports a protocol error",
      async execute() {
        return { id: "invocation-2", status: "Error", errorText: "fixture rejected input", exception: { description: "fixture exception" } };
      }
    },
    {
      name: "throwing_tool",
      description: "A fixture tool that rejects",
      async execute() { throw new Error("fixture crashed"); }
    }
  ];
  return { page: { webmcp: { tools: () => tools } }, calls };
}

let checks = 0;
async function test(name, work) {
  await work();
  checks++;
  console.log(`PASS ${name}`);
}

const fixture = createFixturePage();
await test("lists serializable WebMCP metadata", async () => {
  const result = await listWebMcpTools(fixture.page);
  assert.equal(result.tools.length, 3);
  assert.deepEqual(result.tools[0], {
    name: "search_catalog",
    description: "Search the fixture catalog",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    annotations: { readOnly: true }
  });
  assert.equal(result.tools[0].frame, undefined);
});

await test("executes object input and preserves completed result", async () => {
  const result = await executeWebMcpTool(fixture.page, { toolName: "search_catalog", input: { query: "lamp" } });
  assert.deepEqual(result, {
    toolName: "search_catalog",
    invocationId: "invocation-1",
    status: "Completed",
    output: { matches: ["lamp"] }
  });
  assert.deepEqual(fixture.calls, [{ query: "lamp" }]);
});

await test("parses the JSON-string input used by Chrome DevTools MCP", async () => {
  const result = await executeWebMcpTool(fixture.page, { toolName: "search_catalog", input: '{"query":"book"}' });
  assert.deepEqual(result.output, { matches: ["book"] });
});

await test("returns structured protocol errors", async () => {
  const result = await executeWebMcpTool(fixture.page, { toolName: "failing_tool" });
  assert.deepEqual(result, {
    toolName: "failing_tool",
    invocationId: "invocation-2",
    status: "Error",
    errorText: "fixture rejected input",
    exception: { description: "fixture exception" },
    error: "fixture exception"
  });
});

await test("normalizes rejected tool execution into a structured error", async () => {
  const result = await executeWebMcpTool(fixture.page, { toolName: "throwing_tool" });
  assert.equal(result.status, "Error");
  assert.equal(result.errorText, "fixture crashed");
  assert.deepEqual(result.exception, { name: "Error", description: "fixture crashed" });
});

await test("rejects invalid input before invoking the page tool", async () => {
  await assert.rejects(
    executeWebMcpTool(fixture.page, { toolName: "search_catalog", input: "[1,2]" }),
    error => error instanceof WebMcpError && error.code === "INVALID_INPUT"
  );
  await assert.rejects(
    executeWebMcpTool(fixture.page, { toolName: "search_catalog", input: "not-json" }),
    error => error instanceof WebMcpError && error.code === "INVALID_INPUT"
  );
  assert.equal(fixture.calls.length, 2);
});

await test("reports unavailable runtimes and unknown tools with stable codes", async () => {
  await assert.rejects(listWebMcpTools({}), error => error.code === "WEBMCP_UNAVAILABLE");
  await assert.rejects(
    executeWebMcpTool(fixture.page, { toolName: "missing_tool" }),
    error => error.code === "TOOL_NOT_FOUND"
  );
});

await test("exposes a reusable page-scoped runtime object", async () => {
  const runtime = createWebMcpRuntime(fixture.page);
  assert.equal(typeof runtime.list, "function");
  assert.equal(typeof runtime.execute, "function");
  assert.equal((await runtime.list()).tools[0].name, "search_catalog");
});

console.log(`${checks} WebMCP checks passed`);
