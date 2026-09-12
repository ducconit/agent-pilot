/**
 * Agent Pilot - Quick Launcher Popup Script
 */

document.addEventListener("DOMContentLoaded", async () => {
  const popupTabTitle = document.getElementById("popup-tab-title");
  const btnOpenSidepanel = document.getElementById("btn-open-sidepanel");
  const btnQuickScreenshot = document.getElementById("btn-quick-screenshot");
  const btnQuickInspect = document.getElementById("btn-quick-inspect");
  const btnQuickColor = document.getElementById("btn-quick-color");
  const btnQuickNewtab = document.getElementById("btn-quick-newtab");

  let activeTab = null;

  chrome.runtime.sendMessage({ action: "get_active_tab" }, (res) => {
    if (res && res.tab) {
      activeTab = res.tab;
      popupTabTitle.textContent = activeTab.title || activeTab.url || "Active Tab";
    }
  });

  btnOpenSidepanel.onclick = async () => {
    if (activeTab && activeTab.id) {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        chrome.sidePanel.open({ tabId: activeTab.id }).then(() => {
          window.close();
        }).catch(() => {
          chrome.runtime.sendMessage({ action: "open_sidepanel", tabId: activeTab.id }, () => window.close());
        });
      } else {
        chrome.runtime.sendMessage({ action: "open_sidepanel", tabId: activeTab.id }, () => {
          window.close();
        });
      }
    }
  };

  btnQuickScreenshot.onclick = () => {
    chrome.runtime.sendMessage({ action: "capture_screenshot", mode: "visible" }, (res) => {
      if (res && res.dataUrl) {
        const a = document.createElement("a");
        a.href = res.dataUrl;
        a.download = `agent-pilot-quick-${Date.now()}.png`;
        a.click();
        window.close();
      }
    });
  };

  btnQuickInspect.onclick = () => {
    if (activeTab && activeTab.id) {
      chrome.tabs.sendMessage(activeTab.id, { action: "toggle_inspector", enabled: true }, () => {
        window.close();
      });
    }
  };

  btnQuickColor.onclick = () => {
    if (activeTab && activeTab.id) {
      chrome.tabs.sendMessage(activeTab.id, { action: "pick_color" }, () => {
        window.close();
      });
    }
  };

  btnQuickNewtab.onclick = () => {
    chrome.runtime.sendMessage({ action: "new_tab", url: "https://google.com" }, () => {
      window.close();
    });
  };
});
