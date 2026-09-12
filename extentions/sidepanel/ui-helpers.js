/**
 * Agent Pilot - Side Panel UI Helpers
 */

export function showToast(message) {
  const sidepanelToast = document.getElementById("sidepanel-toast");
  if (!sidepanelToast) return;
  sidepanelToast.textContent = message;
  sidepanelToast.classList.add("visible");
  setTimeout(() => {
    sidepanelToast.classList.remove("visible");
  }, 2800);
}

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatParams(params) {
  if (!params) return "";
  if (typeof params !== "object") return String(params);
  const keys = Object.keys(params);
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}: ${JSON.stringify(params[k])}`).join(", ");
}
