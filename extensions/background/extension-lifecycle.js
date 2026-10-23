/** Validation and protocol helpers shared by extension lifecycle handlers. */

export const EXTENSION_LIFECYCLE_ACTIONS = Object.freeze([
  "list",
  "setEnabled",
  "toggle",
  "uninstall",
  "install",
  "reload",
  "triggerAction"
]);

const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

export function normalizeExtensionAction(rawAction) {
  const action = String(rawAction || "list").trim().toLowerCase();
  if (action === "enable") return "setEnabled";
  if (action === "disable") return "setEnabled";
  if (action === "setenabled") return "setEnabled";
  if (action === "install_extension") return "install";
  if (action === "reload_extension") return "reload";
  if (action === "trigger" || action === "trigger_action" || action === "trigger-action" || action === "triggeraction") return "triggerAction";
  return action;
}

export function validateExtensionId(rawId) {
  const extensionId = String(rawId || "").trim();
  if (!extensionId || extensionId.length > 256 || /[\u0000-\u001f\u007f\s]/.test(extensionId)) {
    throw new Error("extensionId is required and must not contain whitespace or control characters");
  }
  return extensionId;
}

export function validateUnpackedExtensionPath(rawPath) {
  const path = String(rawPath || "").trim();
  if (!path) throw new Error("path is required for installing an unpacked extension");
  if (!ABSOLUTE_PATH.test(path)) {
    throw new Error("path must be an absolute path to an unpacked extension directory");
  }
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error("path must not contain control characters");
  }
  return path;
}

export function isSelfExtension(extensionId, runtimeId) {
  return Boolean(extensionId && runtimeId && extensionId === runtimeId);
}

export function selectTabTargetId(targetInfos, context = {}) {
  const tabTargets = (Array.isArray(targetInfos) ? targetInfos : [])
    .filter(target => target?.type === "tab" && typeof target.targetId === "string" && target.targetId);
  if (tabTargets.length === 1) return tabTargets[0].targetId;

  const matches = tabTargets.filter(target => (
    (context.url === undefined || target.url === context.url) &&
    (context.title === undefined || target.title === context.title)
  ));
  if (matches.length === 1) return matches[0].targetId;
  if (!tabTargets.length) throw new Error("UNSUPPORTED_EXTENSION_API: Chrome did not expose a parent tab target");
  throw new Error("UNSUPPORTED_EXTENSION_API: Chrome exposed multiple parent tab targets and the selected tab could not be resolved");
}

export function extensionProtocolUnavailable(action, method, error) {
  const detail = error?.message || String(error || "unknown Chrome error");
  const unsupported = /not found|not supported|unknown command|method.*not|cannot find|not allowed/i.test(detail);
  const prefix = unsupported ? "UNSUPPORTED_EXTENSION_API" : "EXTENSION_API_ERROR";
  return new Error(`${prefix}: ${action} requires Chrome CDP ${method}; ${detail}`);
}
