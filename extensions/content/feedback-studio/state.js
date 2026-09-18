/**
 * Agent Pilot - Feedback Studio State Manager
 * Centralized reactive state container for feedback studio sessions and captured items.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};
  window.__AP_INTERNAL__.feedbackStudio = window.__AP_INTERNAL__.feedbackStudio || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.fsState) return;
  window.__AP_INTERNAL__.__guards.fsState = true;

  // Internal Session State
  let isFeedbackActive = false;
  let currentMode = "element"; // "element" | "region" | "screen" | "fullpage"
  let feedbackItems = [];
  let hoveredElement = null;
  let cropState = { dragging: false, startX: 0, startY: 0, currentRect: null };
  let pendingCapture = null;

  const state = {
    isActive: () => isFeedbackActive,
    setActive: (active) => {
      isFeedbackActive = Boolean(active);
    },

    getMode: () => currentMode,
    setMode: (mode) => {
      currentMode = mode;
    },

    getItems: () => [...feedbackItems],

    getItem: (id) => feedbackItems.find((it) => it.id === id) || null,

    addItem: (item) => {
      const schema = window.__AP_INTERNAL__.feedbackStudio.itemSchema;
      const newItem = schema
        ? schema.validateFeedbackItem(item)
        : { id: "fb_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5), ...item };
      newItem.timestamp = Date.now();
      feedbackItems.push(newItem);
      return newItem;
    },

    deleteItem: (id) => {
      const initialLength = feedbackItems.length;
      feedbackItems = feedbackItems.filter((item) => item.id !== id);
      return feedbackItems.length < initialLength;
    },

    updateComment: (id, newComment) => {
      const item = feedbackItems.find((it) => it.id === id);
      if (item) {
        item.comment = newComment;
        return true;
      }
      return false;
    },

    clearAll: () => {
      feedbackItems = [];
    },

    getHoveredElement: () => hoveredElement,
    setHoveredElement: (el) => {
      hoveredElement = el;
    },

    getCropState: () => cropState,
    setCropState: (newState) => {
      cropState = { ...cropState, ...newState };
    },
    resetCropState: () => {
      cropState = { dragging: false, startX: 0, startY: 0, currentRect: null };
    },

    getPendingCapture: () => pendingCapture,
    setPendingCapture: (cap) => {
      pendingCapture = cap;
    }
  };

  window.__AP_INTERNAL__.feedbackStudio.state = state;
})();
