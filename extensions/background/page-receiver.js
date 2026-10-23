/**
 * Page-context operations need a content-script receiver. Chrome does not
 * inject the extension content script into data: documents, so fail before a
 * retry loop produces a vague "receiving end does not exist" error.
 */
export async function assertContentReceiverAvailable(tabId, operation) {
  const tab = await chrome.tabs.get(tabId);
  const url = String(tab?.url || "");
  if (url.toLowerCase().startsWith("data:")) {
    throw new Error(
      `DATA_URL_UNSUPPORTED: ${operation} needs an extension content receiver, but data: pages do not receive the Agent Pilot content script; serve the page from http://localhost or use an isolated DevTools context for DOM/CDP capture.`
    );
  }
}
