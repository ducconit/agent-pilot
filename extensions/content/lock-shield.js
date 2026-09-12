/**
 * Agent Pilot - Content Script Human Input Lock Shield Module
 * ChatGPT Operator-style transparent barrier blocking trusted human input during agent actions
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  let isAgentBusy = false;
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
    switch (action) {
      case "page.click":
      case "click_cursor":
      case "browser_click":
        return "Đang thực hiện click phần tử...";
      case "page.type":
      case "type_text":
      case "browser_type":
        return "Đang nhập dữ liệu tự động...";
      case "page.moveMouse":
      case "move_cursor":
        return "Đang di chuyển con trỏ chuột...";
      case "page.scroll":
      case "scroll_page":
      case "browser_scroll":
        return "Đang cuộn nội dung trang...";
      case "page.screenshot":
      case "browser_screenshot":
        return "Đang chụp ảnh màn hình...";
      case "tabs.update":
      case "browser_navigate":
        return "Đang chuyển hướng trang...";
      default:
        return action ? `Đang thực thi: ${action}` : "AI Agent đang thực hiện thao tác...";
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
            <div class="agent-pilot-lock-title">
              <span>🤖</span>
              <span id="agent-pilot-lock-title-text">AI Agent đang thao tác...</span>
            </div>
            <div class="agent-pilot-lock-desc" id="agent-pilot-lock-action-desc">
              Vui lòng không can thiệp chuột hoặc bàn phím lúc này.
            </div>
          </div>
          <button class="agent-pilot-unlock-btn" id="agent-pilot-emergency-unlock" title="Lấy lại quyền điều khiển thủ công">
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
          setAgentBusyState(false);
          try {
            chrome.runtime.sendMessage({ action: "agent_emergency_unlocked" }).catch(() => {});
          } catch (_) {}
        });
      }
    }

    const descEl = document.getElementById("agent-pilot-lock-action-desc");
    if (descEl) {
      const desc = getActionDescription(action);
      descEl.textContent = `${desc} Vui lòng không can thiệp.`;
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

    // Allow emergency takeover button clicks
    if (e.target && typeof e.target.closest === "function" && e.target.closest("#agent-pilot-emergency-unlock")) {
      return;
    }

    // Block human interactions
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  function attachInputBlockers() {
    if (areBlockersAttached) return;
    areBlockersAttached = true;
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

  function setAgentBusyState(busy, action = "") {
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
    isBusy: () => isAgentBusy,
    isDispatching: () => isAgentDispatching,
    setIsDispatching: (val) => { isAgentDispatching = Boolean(val); },
    getLockOverlayEl: () => lockOverlayEl,
    getActionDescription
  };
})();
