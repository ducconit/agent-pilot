/**
 * Agent Pilot - Content Script Toast Notification Module
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  const TOAST_DURATION = 3200;

  function showToast(htmlMessage) {
    const existing = document.querySelector(".agent-pilot-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "agent-pilot-toast";
    toast.innerHTML = `<span>🚀</span><div>${htmlMessage}</div>`;
    (document.body || document.documentElement).appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.4s ease";
      setTimeout(() => toast.remove(), 400);
    }, TOAST_DURATION);
  }

  window.__AP_INTERNAL__.showToast = showToast;
})();
