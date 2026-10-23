#!/usr/bin/env node

import {
  extensionProtocolUnavailable,
  isSelfExtension,
  normalizeExtensionAction,
  selectTabTargetId,
  validateExtensionId,
  validateUnpackedExtensionPath
} from "../extensions/background/extension-lifecycle.js";

const failures = [];
function check(name, condition) {
  if (!condition) failures.push(name);
}

check("enable alias", normalizeExtensionAction("enable") === "setEnabled");
check("disable alias", normalizeExtensionAction("disable") === "setEnabled");
check("install alias", normalizeExtensionAction("install_extension") === "install");
check("reload alias", normalizeExtensionAction("reload_extension") === "reload");
check("trigger aliases", ["trigger", "trigger_action", "trigger-action", "triggeraction"].every(action => normalizeExtensionAction(action) === "triggerAction"));
check("default action", normalizeExtensionAction() === "list");
check("posix path", validateUnpackedExtensionPath("/tmp/example-extension") === "/tmp/example-extension");
check("windows path", validateUnpackedExtensionPath("C:\\work\\example-extension") === "C:\\work\\example-extension");
check("self extension", isSelfExtension("abcdefghijklmnopabcdefghijklmnop", "abcdefghijklmnopabcdefghijklmnop"));
check("different extension", !isSelfExtension("extension-a", "extension-b"));
check("tab target selection ignores page targets", selectTabTargetId([
  { type: "page", targetId: "page-target" },
  { type: "tab", targetId: "tab-target" }
]) === "tab-target");
check("tab target selection disambiguates by page metadata", selectTabTargetId([
  { type: "tab", targetId: "other-tab", url: "https://other.test", title: "Other" },
  { type: "tab", targetId: "selected-tab", url: "https://selected.test", title: "Selected" }
], { url: "https://selected.test", title: "Selected" }) === "selected-tab");
check("protocol error classification", extensionProtocolUnavailable("install", "Extensions.loadUnpacked", new Error("Unknown command")).message.startsWith("UNSUPPORTED_EXTENSION_API:"));

for (const invalid of ["", "relative/path", "bad\npath"]) {
  try {
    validateUnpackedExtensionPath(invalid);
    failures.push(`invalid path accepted: ${JSON.stringify(invalid)}`);
  } catch (_) {
    // expected
  }
}
for (const invalid of ["", "bad id", "bad\nid"]) {
  try {
    validateExtensionId(invalid);
    failures.push(`invalid extension id accepted: ${JSON.stringify(invalid)}`);
  } catch (_) {
    // expected
  }
}

if (failures.length) {
  console.error(`❌ Extension lifecycle checks failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("✅ Extension lifecycle validation and capability checks passed");
