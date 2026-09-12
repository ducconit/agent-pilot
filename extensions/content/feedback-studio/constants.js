/**
 * Agent Pilot - Feedback Studio Constants & Shared Utilities
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};
  window.__AP_INTERNAL__.feedbackStudio = window.__AP_INTERNAL__.feedbackStudio || {};

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showToast(msg) {
    if (window.__AP_INTERNAL__.showToast) {
      window.__AP_INTERNAL__.showToast(msg);
    }
  }

  // Visual Palette for Pinned Regions & Feedback Badges (8 Distinct Colors)
  const PIN_COLORS = [
    { color: "#38bdf8", bg: "rgba(56, 189, 248, 0.12)", glow: "rgba(56, 189, 248, 0.3)" }, // Sky Blue
    { color: "#f59e0b", bg: "rgba(245, 158, 11, 0.12)", glow: "rgba(245, 158, 11, 0.3)" }, // Amber
    { color: "#10b981", bg: "rgba(16, 185, 129, 0.12)", glow: "rgba(16, 185, 129, 0.3)" }, // Emerald
    { color: "#a855f7", bg: "rgba(168, 85, 247, 0.12)", glow: "rgba(168, 85, 247, 0.3)" }, // Purple
    { color: "#f43f5e", bg: "rgba(244, 63, 94, 0.12)", glow: "rgba(244, 63, 94, 0.3)" },   // Rose
    { color: "#06b6d4", bg: "rgba(6, 182, 212, 0.12)", glow: "rgba(6, 182, 212, 0.3)" },   // Cyan
    { color: "#ec4899", bg: "rgba(236, 72, 153, 0.12)", glow: "rgba(236, 72, 153, 0.3)" }, // Pink
    { color: "#84cc16", bg: "rgba(132, 204, 22, 0.12)", glow: "rgba(132, 204, 22, 0.3)" }  // Lime
  ];

  /**
   * Free dragging controller for floating HUD toolbar and quick comment popover
   */
  function makeDraggable(element, handle, onStart) {
    if (!element || !handle) return;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initLeft = 0;
    let initTop = 0;

    handle.addEventListener("mousedown", (e) => {
      // Don't drag if clicking buttons, inputs, links, or textareas
      if (e.target.closest("button, input, textarea, a, select")) return;
      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = element.getBoundingClientRect();
      initLeft = rect.left;
      initTop = rect.top;

      if (typeof onStart === "function") {
        onStart(initLeft, initTop);
      } else {
        element.style.left = `${initLeft}px`;
        element.style.top = `${initTop}px`;
        element.style.right = "auto";
        element.style.bottom = "auto";
      }

      handle.style.cursor = "grabbing";
      document.body.style.userSelect = "none";

      const onMouseMove = (moveEvent) => {
        if (!isDragging) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        const elWidth = element.offsetWidth || 340;
        const elHeight = element.offsetHeight || 200;

        let newLeft = initLeft + dx;
        let newTop = initTop + dy;

        // Keep inside viewport bounds
        newLeft = Math.max(6, Math.min(window.innerWidth - elWidth - 6, newLeft));
        newTop = Math.max(6, Math.min(window.innerHeight - elHeight - 6, newTop));

        element.style.left = `${newLeft}px`;
        element.style.top = `${newTop}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        handle.style.cursor = "grab";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove, true);
        window.removeEventListener("mouseup", onMouseUp, true);
      };

      window.addEventListener("mousemove", onMouseMove, true);
      window.addEventListener("mouseup", onMouseUp, true);
    });
  }

  window.__AP_INTERNAL__.feedbackStudio.constants = {
    escapeHtml,
    showToast,
    PIN_COLORS,
    makeDraggable
  };
})();
