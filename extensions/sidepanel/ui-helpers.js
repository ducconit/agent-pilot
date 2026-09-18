/**
 * Agent Pilot - Side Panel UI Helpers
 */

let toastTimer = null;

export function showToast(message) {
  const sidepanelToast = document.getElementById("sidepanel-toast");
  if (!sidepanelToast) return;
  sidepanelToast.textContent = message;
  sidepanelToast.classList.add("visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    sidepanelToast.classList.remove("visible");
    toastTimer = null;
  }, 2800);
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatParams(params) {
  if (!params) return "";
  try {
    if (typeof params !== "object") return String(params);
    const keys = Object.keys(params);
    if (keys.length === 0) return "";
    return keys.map((k) => {
      let val;
      try {
        val = JSON.stringify(params[k]);
      } catch (_) {
        val = String(params[k]);
      }
      return `${k}: ${val}`;
    }).join(", ");
  } catch (_) {
    return String(params);
  }
}
