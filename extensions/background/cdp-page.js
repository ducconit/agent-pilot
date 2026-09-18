/**
 * Agent Pilot - CDP Page Operations
 *
 * Tab-level interactions that do not fit the input/network/perf groups:
 * file-input uploads and JavaScript dialog handling.
 */

import { activeDialogs } from "./constants.js";
import { sendCdpCommand } from "./cdp-connection.js";

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

/**
 * Upload files to an <input type="file"> element via CDP DOM.setFileInputFiles
 */
export async function uploadFileInput(tabId, selector, filePaths) {
  if (!selector) {
    throw new Error("selector is required for uploadFileInput");
  }
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error("filePaths must be a non-empty array of file paths");
  }

  // 1. Ask isolated content script to resolve selector/@ref and tag the element with a temporary data marker
  let resolvedSelector = selector;
  let marker = null;
  try {
    const markRes = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: "mark_upload_target", selector }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });
    if (markRes && markRes.success && markRes.marker) {
      marker = markRes.marker;
      resolvedSelector = `[data-agent-pilot-upload="${marker}"]`;
    }
  } catch (err) {
    console.debug("[AgentPilot] Could not mark upload target via content script:", err);
  }

  // 2. Locate element via CDP Runtime.evaluate and set files
  let objectId = null;
  try {
    const evalScript = `(() => {
      const el = document.querySelector(${JSON.stringify(resolvedSelector)});
      if (!el) throw new Error("Element not found for selector: " + ${JSON.stringify(selector)});
      if (el.tagName !== 'INPUT' || (el.type && el.type.toLowerCase() !== 'file')) {
        const fileInput = el.querySelector ? el.querySelector('input[type=file]') : null;
        if (fileInput) return fileInput;
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

    const nodeResult = await sendCdpCommand(tabId, "DOM.requestNode", { objectId });
    if (!nodeResult || !nodeResult.nodeId) {
      throw new Error("Failed to resolve DOM nodeId for file input element");
    }

    await sendCdpCommand(tabId, "DOM.setFileInputFiles", {
      files: filePaths,
      nodeId: nodeResult.nodeId
    });

    return {
      success: true,
      selector,
      files: filePaths,
      message: `Successfully set ${filePaths.length} file(s) on ${selector}`
    };
  } finally {
    // Always release the remote object and the temporary marker, even on failure.
    if (objectId) {
      sendCdpCommand(tabId, "Runtime.releaseObject", { objectId }).catch((err) => {
        console.debug("[AgentPilot] Runtime.releaseObject cleanup error ignored:", err);
      });
    }
    if (marker) {
      chrome.tabs.sendMessage(tabId, { action: "unmark_upload_target", marker }, () => {
        if (chrome.runtime.lastError) {
          console.debug("[AgentPilot] unmark_upload_target cleanup error ignored:", chrome.runtime.lastError);
        }
      });
    }
  }
}
