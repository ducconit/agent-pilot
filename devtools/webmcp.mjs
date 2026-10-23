/**
 * Small adapter around Puppeteer's experimental WebMCP page API.
 *
 * The adapter deliberately does not know about MCP transports, tool registries,
 * or response formatting. It only turns a page's WebMCP registry into safe,
 * serializable metadata and preserves the structured invocation result exposed
 * by Puppeteer.
 */

const INVOCATION_STATUSES = new Set(["Completed", "Canceled", "Error"]);

export class WebMcpError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WebMcpError";
    this.code = code;
    this.details = details;
  }
}

function assertPage(page) {
  if (!page || typeof page !== "object") {
    throw new WebMcpError("INVALID_PAGE", "A Puppeteer page is required");
  }
  if (!page.webmcp || typeof page.webmcp.tools !== "function") {
    throw new WebMcpError(
      "WEBMCP_UNAVAILABLE",
      "WebMCP is unavailable on this page; use a supported Chrome/Puppeteer runtime",
    );
  }
}

function cloneSerializable(value, fallback = undefined) {
  if (value === undefined) return fallback;
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return fallback;
    }
  }
}

function normalizeTool(tool) {
  if (!tool || typeof tool !== "object" || typeof tool.name !== "string" || !tool.name.trim()) {
    return null;
  }
  return {
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    ...(tool.inputSchema !== undefined ? { inputSchema: cloneSerializable(tool.inputSchema, {}) } : {}),
    ...(tool.annotations !== undefined ? { annotations: cloneSerializable(tool.annotations, {}) } : {})
  };
}

function readTools(page) {
  let tools;
  try {
    tools = page.webmcp.tools();
  } catch (error) {
    throw new WebMcpError("DISCOVERY_FAILED", `Could not list WebMCP tools: ${error.message}`, { cause: error });
  }
  if (!Array.isArray(tools)) {
    throw new WebMcpError("DISCOVERY_FAILED", "The WebMCP runtime returned an invalid tools list");
  }
  return tools;
}

/**
 * List page WebMCP tools without leaking Puppeteer tool/frame objects.
 *
 * @param {object} page Puppeteer Page with the experimental `webmcp` API.
 * @returns {Promise<{tools: Array<{name: string, description: string, inputSchema?: object, annotations?: object}>}>}
 */
export async function listWebMcpTools(page) {
  assertPage(page);
  return {
    tools: readTools(page).map(normalizeTool).filter(Boolean)
  };
}

function parseInput(input) {
  if (input === undefined) return {};
  if (typeof input === "string") {
    let parsed;
    try {
      parsed = JSON.parse(input || "{}");
    } catch (error) {
      throw new WebMcpError("INVALID_INPUT", `input must be valid JSON: ${error.message}`);
    }
    input = parsed;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new WebMcpError("INVALID_INPUT", "input must be a JSON object");
  }
  return input;
}

function normalizeException(exception) {
  if (!exception || typeof exception !== "object") return undefined;
  return cloneSerializable(exception, { description: String(exception) });
}

function normalizeInvocationResult(toolName, result) {
  if (!result || typeof result !== "object") {
    return { toolName, status: "Completed", output: result };
  }

  const status = INVOCATION_STATUSES.has(result.status) ? result.status : "Error";
  const exception = normalizeException(result.exception);
  const error = exception?.description || exception?.value || result.errorText;
  return {
    toolName,
    ...(result.id !== undefined ? { invocationId: result.id } : {}),
    status,
    ...(result.output !== undefined ? { output: cloneSerializable(result.output, result.output) } : {}),
    ...(result.errorText !== undefined ? { errorText: String(result.errorText) } : {}),
    ...(exception ? { exception } : {}),
    ...(error !== undefined ? { error: String(error) } : {})
  };
}

/**
 * Execute one page WebMCP tool.
 *
 * `input` may be an object or the JSON string accepted by Chrome DevTools MCP.
 * Object/JSON-shape validation happens here; the page's WebMCP implementation
 * remains the authority for the tool's declared inputSchema.
 *
 * @param {object} page Puppeteer Page with the experimental `webmcp` API.
 * @param {{toolName: string, input?: object|string, signal?: AbortSignal}} params
 * @returns {Promise<{toolName: string, invocationId?: string, status: string, output?: unknown, errorText?: string, exception?: object, error?: string}>}
 */
export async function executeWebMcpTool(page, params = {}) {
  assertPage(page);
  if (typeof params.toolName !== "string" || !params.toolName.trim()) {
    throw new WebMcpError("INVALID_TOOL_NAME", "toolName is required");
  }
  const input = parseInput(params.input);
  const rawTool = readTools(page).find(tool => tool?.name === params.toolName);
  if (!rawTool || typeof rawTool.execute !== "function") {
    throw new WebMcpError("TOOL_NOT_FOUND", `WebMCP tool not found: ${params.toolName}`, { toolName: params.toolName });
  }

  try {
    const result = await rawTool.execute(input, params.signal ? { signal: params.signal } : undefined);
    return normalizeInvocationResult(params.toolName, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      toolName: params.toolName,
      status: "Error",
      errorText: message,
      error: message,
      exception: { name: error?.name || "Error", description: message }
    };
  }
}

/**
 * Convenience object for callers that keep one page-scoped runtime adapter.
 */
export function createWebMcpRuntime(page) {
  return {
    list: () => listWebMcpTools(page),
    execute: params => executeWebMcpTool(page, params)
  };
}

export const webMcpInvocationStatuses = Object.freeze([...INVOCATION_STATUSES]);
