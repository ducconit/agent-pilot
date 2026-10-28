/**
 * Agent Pilot - Content Script Toast Notification Module
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.toast) return;
  window.__AP_INTERNAL__.__guards.toast = true;

  // Shared config with local fallbacks (see content/config.js).
  const T = (window.__AP_CONFIG__ && window.__AP_CONFIG__.timeouts) || {};
  const TOAST_DURATION = T.toastMs || 3200;
  const TOAST_FADE_MS = T.toastFadeMs || 400;

  function showToast(message) {
    if (window.__AP_INTERNAL__.isHtmlDocument && !window.__AP_INTERNAL__.isHtmlDocument()) {
      return;
    }
    const existing = document.querySelector(".agent-pilot-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "agent-pilot-toast";
    const icon = document.createElement("span");
    icon.textContent = "🚀";
    const text = document.createElement("div");
    text.textContent = String(message ?? "");
    toast.appendChild(icon);
    toast.appendChild(text);
    (document.body || document.documentElement).appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.4s ease";
      setTimeout(() => toast.remove(), TOAST_FADE_MS);
    }, TOAST_DURATION);
  }

  window.__AP_INTERNAL__.showToast = showToast;
})();
