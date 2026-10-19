/**
 * Agent Pilot - CDP Page Operations
 *
 * Tab-level interactions that do not fit the input/network/perf groups:
 * file-input uploads and JavaScript dialog handling.
 */

import { activeDialogs, attachedTabs, TIMEOUTS } from "./constants.js";
import { attachDebugger, sendCdpCommand } from "./cdp-connection.js";
import { sendTabMessageWithRetry } from "./tab-manager.js";

/**
 * Handle JavaScript dialog (alert, confirm, prompt)
 */
export async function handleJavaScriptDialog(tabId, accept = true, promptText = "") {
  const params = { accept: !!accept };
  if (typeof promptText === "string" && promptText.length > 0) {
    params.promptText = promptText;
  }
  await sendCdpCommand(tabId, "Page.handleJavaScriptDialog", params);
  activeDialogs.delete(tabId);
  return { success: true, accept: !!accept, promptText };
}

/**
 * Get active dialog on a tab
 */
export function getActiveDialog(tabId) {
  return activeDialogs.get(tabId) || null;
}

const FORBIDDEN_UPLOAD_PATH_SEGMENTS = [
  "/.ssh/",
  "/.aws/",
  "/.gnupg/",
  "/.kube/",
  "/.config/gcloud/",
  "/etc/shadow",
  "/etc/passwd",
  "/etc/gshadow",
  "/proc/",
  "/sys/"
];

function validateUploadFilePaths(filePaths) {
  for (const rawPath of filePaths) {
    if (typeof rawPath !== "string" || !rawPath.trim()) {
      throw new Error("Each file path must be a non-empty string");
    }
    const normalized = rawPath.replace(/\\/g, "/").toLowerCase();
    for (const seg of FORBIDDEN_UPLOAD_PATH_SEGMENTS) {
      if (normalized.includes(seg)) {
        throw new Error(`Upload rejected: access to sensitive path (${seg}) is forbidden`);
      }
    }
  }
}

/**
 * Execute synthetic file upload in the page's MAIN world using DataTransfer + File
 * when CDP debugger attachment is unavailable or when `via: "synthetic"` is requested.
 */
async function uploadFileInputSynthetic(tabId, resolvedSelector, originalSelector, filePayloads) {
  if (typeof chrome === "undefined" || !chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
    throw new Error("Synthetic file upload requires chrome.scripting.executeScript");
  }
  if (!Array.isArray(filePayloads) || filePayloads.length === 0) {
    throw new Error("Synthetic file upload requires pre-loaded filePayloads from the bridge");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (resolvedSel, origSel, payloads) => {
      try {
        const el = document.querySelector(resolvedSel) || document.querySelector(origSel);
        if (!el) {
          return { __upload_err: `Element not found for selector: ${origSel}` };
        }
        const isFileInput = (node) =>
          Boolean(node && node.tagName === "INPUT" && (!node.type || node.type.toLowerCase() === "file"));
        const findFileInputInScope = (root) => {
          if (!root) return null;
          if (isFileInput(root)) return root;
          if (root.querySelector) {
            const nested = root.querySelector("input[type=file]");
            if (nested) return nested;
          }
          if (
            root.parentElement &&
            root.parentElement !== document.body &&
            root.parentElement !== document.documentElement &&
            root.parentElement.querySelector
          ) {
            const sibling = root.parentElement.querySelector("input[type=file]");
            if (sibling) return sibling;
          }
          return null;
        };

        let targetInput = findFileInputInScope(el);
        if (!targetInput) {
          const beforeInputs = new Set(document.querySelectorAll("input[type=file]"));
          let capturedInput = null;
          const origClick = HTMLInputElement.prototype.click;
          HTMLInputElement.prototype.click = function (...args) {
            if (isFileInput(this)) {
              capturedInput = this;
              if (!this.isConnected && document.body) {
                this.style.display = "none";
                this.setAttribute("data-ap-temp-upload-input", "1");
                document.body.appendChild(this);
              }
              return;
            }
            return origClick.apply(this, args);
          };
          try {
            if (typeof el.click === "function") {
              el.click();
            } else {
              el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            }
          } finally {
            HTMLInputElement.prototype.click = origClick;
          }
          targetInput = capturedInput || findFileInputInScope(el);
          if (!targetInput) {
            for (const candidate of document.querySelectorAll("input[type=file]")) {
              if (!beforeInputs.has(candidate)) {
                targetInput = candidate;
                break;
              }
            }
          }
        }

        if (!isFileInput(targetInput)) {
          return { __upload_err: `Target element is not an <input type="file"> for selector: ${origSel}` };
        }

        const dt = new DataTransfer();
        for (const item of payloads) {
          const binaryStr = atob(item.base64 || "");
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const fileObj = new File([bytes], item.name || "upload.bin", {
            type: item.mimeType || "application/octet-stream",
            lastModified: Date.now()
          });
          dt.items.add(fileObj);
        }

        if (targetInput._valueTracker && typeof targetInput._valueTracker.setValue === "function") {
          targetInput._valueTracker.setValue("");
        }
        try {
          targetInput.files = dt.files;
        } catch (_) {
          Object.defineProperty(targetInput, "files", {
            value: dt.files,
            writable: true,
            configurable: true
          });
        }

        targetInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        targetInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

        return {
          __upload_ok: true,
          count: targetInput.files ? targetInput.files.length : dt.files.length
        };
      } catch (err) {
        return { __upload_err: err?.message || String(err) };
      }
    },
    args: [resolvedSelector, originalSelector, filePayloads]
  });

  const outcome = results && results[0] ? results[0].result : null;
  if (!outcome || outcome.__upload_err) {
    throw new Error(outcome?.__upload_err || `Synthetic file upload failed for selector: ${originalSelector}`);
  }
  return outcome;
}

/**
 * Upload files to an <input type="file"> element (or an upload trigger button/menuitem)
 * via CDP DOM.setFileInputFiles, with automatic MAIN-world DataTransfer fallback
 * when CDP cannot attach.
 */
export async function uploadFileInput(tabId, selector, filePaths, options = {}) {
  if (!selector) {
    throw new Error("selector is required for uploadFileInput");
  }
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error("filePaths must be a non-empty array of file paths");
  }
  validateUploadFilePaths(filePaths);

  const via = String(options?.via || "auto").toLowerCase().trim() || "auto";
  const filePayloads = Array.isArray(options?.filePayloads) ? options.filePayloads : null;
  const settleMs = TIMEOUTS.TAB_SCRIPT_INJECT_SETTLE_MS || 80;

  // 1. Ask isolated content script to resolve selector/@ref and tag the element with a temporary data marker
  let resolvedSelector = selector;
  let marker = null;
  try {
    const markRes = await sendTabMessageWithRetry(tabId, { action: "mark_upload_target", selector });
    if (markRes && markRes.success && markRes.marker) {
      marker = markRes.marker;
      resolvedSelector = `[data-agent-pilot-upload="${marker}"]`;
    }
  } catch (err) {
    console.debug("[AgentPilot] Could not mark upload target via content script:", err);
  }

  let objectId = null;
  try {
    if (via === "synthetic") {
      await uploadFileInputSynthetic(tabId, resolvedSelector, selector, filePayloads);
      await new Promise((r) => setTimeout(r, settleMs));
      return {
        success: true,
        via: "synthetic",
        selector,
        files: filePaths,
        message: `Successfully set ${filePaths.length} file(s) on ${selector} (synthetic DataTransfer)`
      };
    }

    // 2. Locate element (or trigger lazy/ephemeral file input creation) via CDP Runtime.evaluate and set files
    try {
      let attachError = null;
      if (!attachedTabs.has(tabId)) {
        const attachRes = await attachDebugger(tabId, options?.broadcastFn);
        if (attachRes && attachRes.success === false) {
          attachError = attachRes.error || `Debugger not attached to tab ${tabId}`;
        }
      }
      if (!attachedTabs.has(tabId)) {
        const reason = attachError || `Debugger not attached to tab ${tabId}`;
        throw new Error(reason.startsWith("CDP_UNAVAILABLE:") ? reason : `CDP_UNAVAILABLE: ${reason}`);
      }

      const evalScript = `(() => {
        const el = document.querySelector(${JSON.stringify(resolvedSelector)});
        if (!el) throw new Error("Element not found for selector: " + ${JSON.stringify(selector)});
        const isFileInput = (node) =>
          Boolean(node && node.tagName === 'INPUT' && (!node.type || node.type.toLowerCase() === 'file'));
        const findFileInputInScope = (root) => {
          if (!root) return null;
          if (isFileInput(root)) return root;
          if (root.querySelector) {
            const nested = root.querySelector('input[type=file]');
            if (nested) return nested;
          }
          if (root.parentElement && root.parentElement !== document.body && root.parentElement !== document.documentElement && root.parentElement.querySelector) {
            const sibling = root.parentElement.querySelector('input[type=file]');
            if (sibling) return sibling;
          }
          return null;
        };

        let found = findFileInputInScope(el);
        if (found) return found;

        // Dispatch hover/focus in case a framework directive lazily attaches <input type="file"> (e.g. xapFileSelectorTrigger)
        const beforeInputs = new Set(document.querySelectorAll('input[type=file]'));
        for (const target of [el, el.parentElement].filter(Boolean)) {
          target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false }));
          target.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        }
        found = findFileInputInScope(el);
        if (found) return found;
        for (const candidate of document.querySelectorAll('input[type=file]')) {
          if (!beforeInputs.has(candidate)) return candidate;
        }

        // Intercept dynamic <input type="file">.click() when clicking a trigger button/menuitem
        let capturedInput = null;
        const origClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function(...args) {
          if (isFileInput(this)) {
            capturedInput = this;
            if (!this.isConnected && document.body) {
              this.style.display = 'none';
              this.setAttribute('data-ap-temp-upload-input', '1');
              document.body.appendChild(this);
            }
            return;
          }
          return origClick.apply(this, args);
        };
        try {
          if (typeof el.click === 'function') {
            el.click();
          } else {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          }
        } finally {
          HTMLInputElement.prototype.click = origClick;
        }

        if (capturedInput) return capturedInput;
        found = findFileInputInScope(el);
        if (found) return found;
        for (const candidate of document.querySelectorAll('input[type=file]')) {
          if (!beforeInputs.has(candidate)) return candidate;
        }
        return el;
      })()`;

      const evalResult = await sendCdpCommand(tabId, "Runtime.evaluate", {
        expression: evalScript,
        returnByValue: false
      });

      if (evalResult && evalResult.exceptionDetails) {
        const desc = evalResult.exceptionDetails.exception?.description || evalResult.exceptionDetails.text || "Failed to find element";
        throw new Error(desc);
      }

      objectId = evalResult.result?.objectId;
      if (!objectId) {
        throw new Error("Failed to obtain remote object ID for selector: " + selector);
      }

      // Prefer passing objectId directly to DOM.setFileInputFiles so it works even when DOM.getDocument
      // has not been called yet on this tab. Fall back to DOM.getDocument + DOM.requestNode if needed.
      try {
        await sendCdpCommand(tabId, "DOM.setFileInputFiles", {
          files: filePaths,
          objectId
        });
      } catch (directErr) {
        console.debug("[AgentPilot] Direct objectId DOM.setFileInputFiles failed, trying DOM.getDocument + DOM.requestNode:", directErr);
        await sendCdpCommand(tabId, "DOM.getDocument", { depth: 0 }).catch((docErr) => {
          console.debug("[AgentPilot] DOM.getDocument fallback note:", docErr);
        });
        const nodeResult = await sendCdpCommand(tabId, "DOM.requestNode", { objectId });
        if (!nodeResult || !nodeResult.nodeId) {
          throw directErr || new Error("Failed to resolve DOM nodeId for file input element");
        }
        await sendCdpCommand(tabId, "DOM.setFileInputFiles", {
          files: filePaths,
          nodeId: nodeResult.nodeId
        });
      }

      // Reset React _valueTracker and dispatch input/change events on the file input so onchange handlers fire
      await sendCdpCommand(tabId, "Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function() {
          try {
            if (this._valueTracker && typeof this._valueTracker.setValue === 'function') {
              this._valueTracker.setValue('');
            }
            this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          } catch (_) {}
        }`
      }).catch((dispatchErr) => {
        console.debug("[AgentPilot] Dispatching change event on file input note:", dispatchErr);
      });

      await new Promise((r) => setTimeout(r, settleMs));

      return {
        success: true,
        via: "cdp",
        selector,
        files: filePaths,
        message: `Successfully set ${filePaths.length} file(s) on ${selector}`
      };
    } catch (cdpErr) {
      if (via !== "cdp" && filePayloads && filePayloads.length > 0 && typeof chrome !== "undefined" && chrome.scripting?.executeScript) {
        console.debug("[AgentPilot] CDP uploadFileInput failed, falling back to MAIN-world DataTransfer:", cdpErr);
        await uploadFileInputSynthetic(tabId, resolvedSelector, selector, filePayloads);
        await new Promise((r) => setTimeout(r, settleMs));
        return {
          success: true,
          via: "synthetic",
          fallback: true,
          cdpError: cdpErr?.message || String(cdpErr),
          selector,
          files: filePaths,
          message: `Successfully set ${filePaths.length} file(s) on ${selector} (synthetic fallback)`
        };
      }
      throw cdpErr;
    }
  } finally {
    // Always release the remote object and the temporary marker, even on failure.
    if (objectId) {
      sendCdpCommand(tabId, "Runtime.releaseObject", { objectId }).catch((err) => {
        console.debug("[AgentPilot] Runtime.releaseObject cleanup error ignored:", err);
      });
    }
    chrome.tabs.sendMessage(tabId, { action: "unmark_upload_target", marker: marker || "" }, () => {
      if (chrome.runtime.lastError) {
        console.debug("[AgentPilot] unmark_upload_target cleanup error ignored:", chrome.runtime.lastError);
      }
    });
  }
}
