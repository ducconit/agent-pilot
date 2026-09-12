/**
 * Agent Pilot - Main World Bridge Script (Manifest V3)
 * Exposes window.__AGENT_PILOT__ directly to the web page execution context
 */
(() => {
  if (window.__AGENT_PILOT__) return;

  function sendBridgeRequest(action, data = {}) {
    return new Promise((resolve) => {
      const reqId = "ap_" + Math.random().toString(36).substr(2, 9);
      function onResponse(e) {
        if (e.detail && e.detail.reqId === reqId) {
          window.removeEventListener("__AGENT_PILOT_RESP__", onResponse);
          resolve(e.detail.result);
        }
      }
      window.addEventListener("__AGENT_PILOT_RESP__", onResponse);
      window.dispatchEvent(new CustomEvent("__AGENT_PILOT_REQ__", {
        detail: { reqId, action, data }
      }));
    });
  }

  window.__AGENT_PILOT__ = {
    version: "1.0.0",
    moveMouse: (x, y, duration) => sendBridgeRequest("virtual_mouse_move", { x, y, duration }),
    click: (x, y) => sendBridgeRequest("virtual_mouse_click", { x, y }),
    type: (selector, text) => sendBridgeRequest("virtual_type", { selector, text }),
    scroll: (deltaX, deltaY) => sendBridgeRequest("virtual_scroll", { deltaX, deltaY }),
    toggleInspector: (enabled) => sendBridgeRequest("toggle_inspector", { enabled }),
    isInspectorActive: () => sendBridgeRequest("is_inspector_active", {}),
    getElement: (selector) => sendBridgeRequest("get_element_info", { selector }),
    pickColor: () => sendBridgeRequest("pick_color", {}),
    getCursorPosition: () => sendBridgeRequest("get_cursor_pos", {})
  };
})();
