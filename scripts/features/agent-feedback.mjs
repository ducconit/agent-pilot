/**
 * verify_agent_connection - Feature section: Visual UI Feedback over the bridge
 * (records 28-29).
 *
 * Channel B is the persistent shared inbox (save then read back). Channel A is
 * the reactive long-poll: a `wait` request stays open until a submission lands,
 * which the delayed save below triggers.
 */
export async function run({ bridgePort, httpPort, record }) {
  // 28. Visual UI Feedback (Channel B - Persistent Shared Inbox)
  const testFeedbackPayload = {
    timestamp: Date.now(),
    url: `http://127.0.0.1:${httpPort}/test-page.html`,
    title: "Agent Pilot Test Page",
    items: [
      {
        id: "item_conn_1",
        mode: "element",
        title: "Nút kiểm thử click",
        comment: "Thêm viền neon xanh cyan và hiệu ứng hover",
        component: {
          framework: "React",
          componentName: "TestButton",
          fileName: "src/components/TestButton.jsx",
          lineNumber: 18
        },
        dom: { selector: "#btn-click" },
        screenshotDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      }
    ]
  };

  let saveResp = null;
  let pendingResp = null;
  try {
    saveResp = await fetch(`http://127.0.0.1:${bridgePort}/api/feedback/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testFeedbackPayload)
    }).then(r => r.json());
    pendingResp = await fetch(`http://127.0.0.1:${bridgePort}/api/feedback/pending?sessionId=${testFeedbackPayload.timestamp}`, {
      headers: { "Content-Type": "application/json" }
    }).then(r => r.json());
  } catch (e) {
    console.error("Feedback fetch error:", e);
  }

  const savedSessionId = String(saveResp?.result?.sessionId || saveResp?.sessionId || "");
  const sessionsList = Array.isArray(pendingResp?.sessions) ? pendingResp.sessions : (pendingResp?.result?.sessions || []);
  const isChannelBVerified = Boolean(savedSessionId) &&
                            savedSessionId === String(testFeedbackPayload.timestamp) &&
                            (pendingResp?.success === true || pendingResp?.result?.success === true || Array.isArray(sessionsList)) &&
                            sessionsList.length >= 1;
  record("28. Visual UI Feedback (Channel B - Shared Inbox)", isChannelBVerified, `Saved session ${savedSessionId} with 1 item; retrieved from pending inbox`);

  // 29. Visual UI Feedback (Channel A - Live Reactive Long-Polling)
  let waitResolvedLive = false;
  let waitDataLive = null;

  const livePushPayload = {
    timestamp: Date.now() + 50,
    url: `http://127.0.0.1:${httpPort}/test-page.html`,
    title: "Agent Pilot Test Page - Live Push",
    items: [
      {
        id: "item_live_push",
        mode: "screen",
        title: "Toàn màn hình với ghi chú trực tiếp",
        comment: "Khoảng cách giữa nút và form quá gần",
        annotations: [{ x: 100, y: 100, comment: "Cần tăng margin-bottom: 24px" }]
      }
    ]
  };

  const waitPromise = fetch(`http://127.0.0.1:${bridgePort}/api/feedback/wait`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeout: 5 })
  }).then(r => r.json()).then(res => {
    waitResolvedLive = true;
    waitDataLive = res?.result || res;
  }).catch(e => {
    console.error("Wait feedback error:", e);
  });

  setTimeout(async () => {
    try {
      await fetch(`http://127.0.0.1:${bridgePort}/api/feedback/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(livePushPayload)
      });
    } catch (_) {}
  }, 100);

  await waitPromise;
  const isChannelAVerified = waitResolvedLive &&
                            waitDataLive?.success === true &&
                            waitDataLive?.channel === "reactive_channel_a" &&
                            String(waitDataLive?.sessionId) === String(livePushPayload.timestamp);
  record("29. Visual UI Feedback (Channel A - Reactive Long-Polling)", isChannelAVerified, `Long-poll resolved instantaneously upon submission (Session: ${waitDataLive?.sessionId})`);
}
