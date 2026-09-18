/**
 * Agent Pilot - Content Script Human Input Lock Shield Module
 * ChatGPT Operator-style transparent barrier blocking trusted human input during agent actions
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.lockShield) return;
  window.__AP_INTERNAL__.__guards.lockShield = true;

  let isAgentBusy = false;
  let isSessionActive = false;
  let sessionName = "";
  let isAgentDispatching = false;
  let lockOverlayEl = null;
  let areBlockersAttached = false;

  const BLOCKED_INPUT_EVENTS = [
    "mousedown", "mouseup", "click", "dblclick", "contextmenu",
    "keydown", "keyup", "keypress",
    "wheel", "pointerdown", "pointerup",
    "touchstart", "touchend", "touchmove"
  ];

  function getActionDescription(action) {
    if (!action && isSessionActive) {
      return sessionName || "Session đang hoạt động (Sẵn sàng)";
    }
    switch (action) {
      case "page.click":
      case "click_cursor":
      case "browser_click":
        return "Đang click...";
      case "page.type":
      case "type_text":
      case "browser_type":
        return "Đang nhập dữ liệu...";
      case "page.moveMouse":
      case "move_cursor":
        return "Đang di chuyển chuột...";
      case "page.scroll":
      case "scroll_page":
      case "browser_scroll":
        return "Đang cuộn trang...";
      case "page.screenshot":
      case "browser_screenshot":
        return "Đang chụp ảnh...";
      case "tabs.update":
      case "browser_navigate":
        return "Đang chuyển trang...";
      default:
        return action ? `Đang thực thi: ${action}` : (isSessionActive ? (sessionName || "Session đang hoạt động") : "AI Agent đang thao tác...");
    }
  }

  function triggerEmergencyUnlock() {
    isSessionActive = false;
    setAgentBusyState(false);
    if (window.__AP_INTERNAL__.cursor?.setSessionActive) {
      window.__AP_INTERNAL__.cursor.setSessionActive(false);
    }
    try {
      chrome.runtime.sendMessage({ action: "agent_emergency_unlocked" }).catch((err) => {
        console.debug("[AgentPilot Shield] notify unlock rejected:", err);
      });
    } catch (err) {
      console.debug("[AgentPilot Shield] notify unlock error:", err);
    }
  }

  function showLockOverlay(action = "") {
    if (!lockOverlayEl) {
      lockOverlayEl = document.createElement("div");
      lockOverlayEl.id = "agent-pilot-lock-overlay";
      lockOverlayEl.innerHTML = `
        <div class="agent-pilot-lock-card">
          <div class="agent-pilot-lock-spinner"></div>
          <div class="agent-pilot-lock-info">
            <span class="agent-pilot-lock-title">
              <span>🤖</span>
              <span id="agent-pilot-lock-title-text">AI Agent</span>
            </span>
            <span class="agent-pilot-lock-separator">•</span>
            <span class="agent-pilot-lock-desc" id="agent-pilot-lock-action-desc">Đang thao tác...</span>
          </div>
          <button class="agent-pilot-unlock-btn" id="agent-pilot-emergency-unlock" title="Lấy lại quyền điều khiển thủ công (Phím Esc)">
            <span>🔓</span> Chiếm quyền
          </button>
        </div>
      `;
      (document.body || document.documentElement).appendChild(lockOverlayEl);

      const unlockBtn = lockOverlayEl.querySelector("#agent-pilot-emergency-unlock");
      if (unlockBtn) {
        unlockBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          triggerEmergencyUnlock();
        });
      }
    }

    const descEl = document.getElementById("agent-pilot-lock-action-desc");
    if (descEl) {
      const desc = getActionDescription(action);
      descEl.textContent = desc;
    }
    lockOverlayEl.style.display = "flex";
  }

  function hideLockOverlay() {
    if (lockOverlayEl) {
      lockOverlayEl.style.display = "none";
    }
  }

  function handleCaptureInput(e) {
    if (!isAgentBusy) return;

    // Allow synthetic events dispatched by Agent Pilot
    if (isAgentDispatching || !e.isTrusted) {
      return;
    }

    // Allow emergency takeover via Escape key
    if (e.key === "Escape") {
      e.stopImmediatePropagation();
      e.preventDefault();
      triggerEmergencyUnlock();
      return;
    }

    // Allow emergency takeover button clicks
    if (e.target && typeof e.target.closest === "function" && e.target.closest("#agent-pilot-emergency-unlock")) {
      return;
    }

    // Block human interactions during automated actions
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  function attachInputBlockers() {
    if (areBlockersAttached) return;
    areBlockersAttached = true;
    // Capture phase + passive:false on purpose: we must run BEFORE the page's own
    // listeners (capture phase) and we must be allowed to preventDefault() the event.
    // Passive listeners cannot call preventDefault (wheel/touch would be ignored), and
    // a bubble-phase listener could be stopped by a page handler first.
    BLOCKED_INPUT_EVENTS.forEach((evtName) => {
      window.addEventListener(evtName, handleCaptureInput, { capture: true, passive: false });
    });
  }

  function detachInputBlockers() {
    if (!areBlockersAttached) return;
    areBlockersAttached = false;
    BLOCKED_INPUT_EVENTS.forEach((evtName) => {
      window.removeEventListener(evtName, handleCaptureInput, { capture: true, passive: false });
    });
  }

  function setSessionActive(active, name = "") {
    isSessionActive = Boolean(active);
    sessionName = name || (isSessionActive ? "Session đang hoạt động" : "");
    if (isSessionActive) {
      isAgentBusy = true;
      attachInputBlockers();
      showLockOverlay(sessionName);
    } else {
      isAgentBusy = false;
      detachInputBlockers();
      hideLockOverlay();
    }
  }

  function setAgentBusyState(busy, action = "") {
    if (isSessionActive) {
      // During active session, lock shield remains visible continuously.
      // Granular actions update description, then revert to session standby on completion.
      if (busy) {
        attachInputBlockers();
        showLockOverlay(action || sessionName);
      } else {
        showLockOverlay(sessionName || "Session đang hoạt động (Sẵn sàng)");
      }
      return;
    }

    isAgentBusy = Boolean(busy);
    if (isAgentBusy) {
      attachInputBlockers();
      showLockOverlay(action);
    } else {
      detachInputBlockers();
      hideLockOverlay();
    }
  }

  window.__AP_INTERNAL__.shield = {
    setAgentBusyState,
    setSessionActive,
    isBusy: () => isAgentBusy,
    isSessionActive: () => isSessionActive,
    isDispatching: () => isAgentDispatching,
    setIsDispatching: (val) => { isAgentDispatching = Boolean(val); },
    getLockOverlayEl: () => lockOverlayEl,
    getActionDescription
  };
})();
