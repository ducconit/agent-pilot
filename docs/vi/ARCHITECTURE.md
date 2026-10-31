# 🏛️ Tài Liệu Kiến Trúc Hệ Thống Agent Pilot
**Phiên bản**: v1.3.0
**Mục tiêu**: Cung cấp giao diện kiểm soát trình duyệt hoàn chỉnh cho AI Coding Agent (Antigravity First), độ trễ thấp, không chiếm quyền focus, hỗ trợ CDP và phản hồi trực quan (Visual Feedback)
**Tác giả duy trì**: DNT ([github.com/ducconit](https://github.com/ducconit))

---

## 1. 🌐 Sơ Đồ Kiến Trúc Đa Tầng Tổng Thể (End-to-End Architecture)

Agent Pilot xây dựng cầu nối hai chiều khép kín, an toàn giữa các mô hình AI Agent (Antigravity, Claude Code, Cursor, OpenCode) và trình duyệt Chromium:

```mermaid
flowchart TB
    subgraph AgentLayer["🤖 1. TẦNG AI AGENT"]
        Agent["<b>AI Coding Agent</b><br/>(Google Antigravity / Claude Code / Cursor)"]
    end

    subgraph BridgeLayer["🌉 2. TẦNG CẦU NỐI & CLI (GOLANG STANDALONE ENGINE)"]
        direction TB
        ServerEntry["<b>Agent Pilot Engine (cli/agent-pilot)</b><br/>Port 58765 (Local Loopback 127.0.0.1)"]
        DualMode{"<b>Dual Mode Engine</b><br/>Port Busy?"}
        Master["<b>Master Mode</b><br/>Binds WebSocket ws://127.0.0.1:58765"]
        Forwarder["<b>Forwarder Mode</b><br/>Forwards Stdio to HTTP POST /api"]
        VerifyClient["<b>verifyClient Security Guard</b><br/>WebSocket Origin: chrome-ext & loopback nội bộ"]
        ServerRedactor["<b>Secret Redaction Filter</b><br/>Masks 13 Dedicated Regex Patterns with *"]
        InboxFS["<b>Local Inbox Storage</b><br/>~/.agent-pilot/inbox/feedback/"]
    end

    subgraph ExtensionLayer["🧩 3. TẦNG CHROME EXTENSION (MANIFEST V3)"]
        direction TB
        SW["<b>Background Service Worker (background.js)</b>"]
        WSClient["<b>Bridge Client</b><br/>(bridge-client.js)"]
        TabMgr["<b>Tab & Lock Manager</b><br/>(tab-manager.js)<br/>• Tab Groups '🤖 Agent Pilot'<br/>• runWithTabLock"]
        CDPMgr["<b>CDP Manager</b><br/>(cdp-manager.js)<br/>• chrome.debugger (v1.3)<br/>• Console, Network, Perf"]
        BatchExec["<b>Batch Executor</b><br/>(batch-executor.js)<br/>• Single Tool Call<br/>• omitDataUrls RAM Guard"]
        ShotSvc["<b>Screenshot Service</b><br/>(screenshot-service.js)<br/>• CDP Screen Capture<br/>• OffscreenCanvas Crop"]
        ClientRedactor["<b>Secret Sanitizer Layer</b><br/>(secret-sanitizer.js)<br/>• WeakSet Anti-Recursion"]
        SidePanel["<b>Side Panel UI</b><br/>(sidepanel.html/js)<br/>• Agent Monitor & Inspector<br/>• Screenshot Studio & Loupe"]
    end

    subgraph PageLayer["🖥️ 4. TẦNG TRANG WEB & DOM NỘI BỘ"]
        direction TB
        MainWorld["<b>Main World Bridge</b><br/>(main-world-bridge.js)<br/>Exposes window.__AGENT_PILOT__"]
        ContentScripts["<b>Isolated World Content Scripts</b>"]
        CursorSim["<b>Virtual Mouse Cursor</b><br/>(cursor-simulator.js)<br/>Cubic Ease-Out & Ripple"]
        LockShield["<b>Human Lock Shield</b><br/>(lock-shield.js)<br/>Prevents Human Interference"]
        DOMInspector["<b>DOM Inspector & Loupe</b><br/>(dom-inspector.js, eyedropper.js)"]
        FeedbackHUD["<b>Feedback Studio HUD & Pinned Layer</b><br/>(feedback-studio/*)<br/>Pins, Rect Boxes, Source Detection"]
        TargetDOM["<b>Target Web Page DOM</b><br/>(React / Vue / Astro / HTML)"]
    end

    %% Communication Links
    Agent -->|Stdio MCP JSON-RPC| ServerEntry
    Agent -.->|Direct HTTP POST /api| ServerEntry
    ServerEntry --> DualMode
    DualMode -->|No: First Process| Master
    DualMode -->|Yes: Port In Use| Forwarder
    Master --> VerifyClient
    VerifyClient -->|WebSocket Handshake| WSClient
    Forwarder -.->|HTTP POST /api| Master

    WSClient <--> SW
    SW --> TabMgr
    SW --> CDPMgr
    SW --> BatchExec
    SW --> ShotSvc
    SW --> ClientRedactor
    SW <--> SidePanel

    CDPMgr -->|chrome.debugger CDP Commands| TargetDOM
    ShotSvc -->|Page.captureScreenshot / OffscreenCanvas| TargetDOM
    TabMgr -->|Dynamic Script Injection| ContentScripts
    TabMgr -->|chrome.tabs.sendMessage| ContentScripts

    ContentScripts --> CursorSim
    ContentScripts --> LockShield
    ContentScripts --> DOMInspector
    ContentScripts --> FeedbackHUD

    CursorSim -->|Synthetic DOM Events| TargetDOM
    LockShield -->|Intercepts Pointer Events| TargetDOM
    DOMInspector -->|Extracts Selector/XPath/CSS| TargetDOM
    FeedbackHUD -->|Pins & Pinned Layer| TargetDOM

    MainWorld <-->|CustomEvent __AGENT_PILOT_REQ/RES__| ContentScripts
    FeedbackHUD -->|Channel B: Save Session| Master
    Master --> InboxFS
    Master --> ServerRedactor
```

---

## 2. ⏱️ Sơ Đồ Tuần Tự (Sequence Diagram) - Vòng Đời Lệnh Của Agent

Dưới đây là luồng thực thi chi tiết từng bước khi AI Agent gửi một lệnh tương tác (ví dụ: `browser_click` hoặc `browser_run_actions`) đến trình duyệt:

```mermaid
sequenceDiagram
    autonumber
    actor Agent as 🤖 AI Agent (Antigravity)
    participant Server as 🌉 Bridge Server (58765)
    participant Ext as 🧩 Extension Background
    participant Tab as 📑 Tab & Lock Manager
    participant Content as 📄 Content Script
    participant CDP as ⚡ Chrome DevTools (CDP)
    participant DOM as 🌐 Web Page DOM

    Note over Agent,Server: 1. KHỞI TẠO HOẶC GỬI LỆNH
    Agent->>Server: MCP call: browser_click({ selector: "#submit-btn", tabId: 101 })
    Server->>Server: Kiểm tra client hợp lệ (activeClientId)
    Server->>Ext: WebSocket JSON-RPC: { id: 42, method: "page.click", params: { ... } }

    Note over Ext,Tab: 2. PHÂN TÍCH & BẢO VỆ PHIÊN (TAB LOCK)
    Ext->>Tab: runWithTabLock(101, "click")
    Tab->>Content: chrome.tabs.sendMessage("SET_BUSY", { busy: true, action: "AI Click" })
    Content->>DOM: Hiển thị Viền Màn Hình Neon & Pill Hành Động (Subtle Indicator, pointer-events: none)

    Note over Ext,Content: 3. THAO TÁC CHUỘT ẢO & TƯƠNG TÁC DOM
    Ext->>Content: chrome.tabs.sendMessage("simulate_click", { selector: "#submit-btn" })
    Content->>DOM: querySelector("#submit-btn") & getBoundingClientRect()
    Content->>DOM: Di chuyển con trỏ chuột neon mượt mà (Cubic Ease-Out)
    Content->>DOM: Kích hoạt sóng lan tỏa (Ripple Effect) & Badge tọa độ (X, Y)
    Content->>DOM: Phát chuỗi DOM Events: pointerdown -> mousedown -> pointerup -> mouseup -> click
    DOM-->>Content: Sự kiện click đã được xử lý (Counter tăng)
    Content-->>Ext: { success: true, clicked: true, point: { x: 350, y: 220 } }

    Note over Ext,Tab: 4. NHẢ KHÓA & TRẢ DỮ LIỆU BẢO MẬT
    Tab->>Content: chrome.tabs.sendMessage("SET_BUSY", { busy: false })
    Content->>DOM: Ẩn Viền Neon & Thanh Pill Hành Động
    Ext->>Ext: sanitizeData(result) -> Quét 13 mẫu Regex chuyên biệt
    Ext-->>Server: WebSocket Response: { id: 42, result: { ... }, secretFilterEnabled: true }
    Server->>Server: sanitizeServerData(result) (Lớp lọc bảo mật thứ hai)
    Server-->>Agent: MCP Tool Response: { success: true, clicked: true }
```

---

## 3. 🎨 Sơ Đồ 3 Kênh Phản Hồi Trực Quan (3-Channel Visual Feedback)

Hệ thống cung cấp 3 kênh trao đổi hai chiều giữa người dùng và AI Agent khi kiểm thử giao diện:

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 Human Tester / Dev
    participant HUD as ✏️ Feedback Studio (In-Page HUD)
    participant Ext as 🧩 Extension Background
    participant Server as 🌉 Bridge Server (58765)
    participant Inbox as 💾 Local Inbox (~/.agent-pilot)
    actor Agent as 🤖 AI Agent (Antigravity)

    alt KÊNH A: Reactive Long-Polling (Live Agent Push)
        Agent->>Server: browser_wait_for_feedback({ timeout: 120 })
        Server-->>Server: Giữ kết nối chờ (pendingFeedbackWaiters)
        User->>HUD: Chọn vùng / Ghim điểm & Bấm "🚀 Gửi Agent"
        HUD->>Ext: chrome.runtime.sendMessage({ action: "push_feedback_live", payload })
        Ext->>Server: POST /api/feedback/push (resolve pending waiter)
        Server->>Inbox: Lưu session.json + item_*.png
        Server-->>Agent: Trả về kết quả tức thì (Component source, line, selector, note, images)
        Agent->>Agent: Tự động sửa code đúng file & dòng chỉ điểm
    else KÊNH B: Persistent Shared Inbox
        User->>HUD: Chọn nhiều vùng / component & Bấm "💾 Lưu Inbox"
        HUD->>Server: POST /api/feedback/save (session payload)
        Server->>Inbox: Ghi session.json, prompt.md (sạch, không base64), ảnh PNG
        Note over Agent,Inbox: Agent rảnh rỗi hoặc được yêu cầu kiểm tra feedback
        Agent->>Server: browser_get_pending_feedback({ limit: 5 })
        Server->>Inbox: Đọc các thư mục timestamp mới nhất
        Server-->>Agent: Trả về danh sách phiên kèm prompt Markdown & đường dẫn ảnh
    else KÊNH C: 1-Click Clipboard Prompt
        User->>HUD: Chọn vùng & Bấm "📋 Copy Prompt"
        HUD->>User: Ghi thẳng Markdown format chuẩn vào System Clipboard
        User->>Agent: Dán (Ctrl+V) vào khung chat bất kỳ
    end
```

---

## 4. 🛡️ Các Cơ Chế An Ninh & Phòng Thủ Trọng Yếu

1. **Khóa Nguồn Gốc WebSocket Server (`IsWebSocketOriginAllowed`)**:
   - Được hiện thực tại `IsWebSocketOriginAllowed` trong `cli/bridge/connections.go`.
   - Quá trình nâng cấp kết nối WebSocket (Upgrade) **chặn hoàn toàn** các origin web `localhost` và `127.0.0.1` từ trình duyệt để chống tấn công Cross-Site WebSocket Hijacking (CSWSH).
   - Chỉ cho phép các extension Chrome hợp lệ (`chrome-extension://<id>`) hoặc các tiến trình loopback nội bộ không mang header Origin (`Origin: ""`).
   - Extension ID có thể được ghim chặt chẽ qua biến môi trường `AGENT_PILOT_EXTENSION_ID`.
2. **Lớp Lọc Dữ Liệu Nhạy Cảm 2 Tầng (Dual-Layer Secret Redaction)**:
   - Tự động nhận diện và che giấu bằng dấu sao `*` với **13 mẫu Regex chuyên biệt** (bao gồm Private Keys RSA/EC/SSH/PGP, OpenAI, Anthropic, Google, GitHub, AWS, Stripe, Slack, JWT, Bearer token, thông tin URL Basic Auth `https://user:password@host` tại mẫu số 11, tham số URL secret và cặp khóa-giá trị nhạy cảm) cùng bộ từ điển 23 khóa thuộc tính nhạy cảm (`sensitivePropRegex`).
   - Bảo vệ chống tràn đệ quy vô tận bằng `WeakSet` (`[Circular]`) và giới hạn độ sâu đệ quy (`maxSanitizeDepth = 64`).
   - Lọc ở Service Worker trước khi truyền qua mạng và lọc dự phòng ở tầng Go server (`SanitizeData`) trước khi trả về cho LLM.
3. **Cách Ly Tuyệt Đối Giữa Main World & Content Script**:
   - `main-world-bridge.js` chạy trong ngữ cảnh của trang web (`world: "MAIN"`), cung cấp `window.__AGENT_PILOT__` nhưng hoàn toàn **không có quyền hạn `chrome.*`**.
   - Giao tiếp với Extension thông qua các sự kiện tùy biến `CustomEvent` (`__AGENT_PILOT_REQ__` và `__AGENT_PILOT_RES__`).
4. **Bảo Vệ Độc Quyền Theo Tab (Tab-Level Mutex Lock)**:
   - `runWithTabLock` ngăn chặn hai hành động của Agent hoặc một hành động của Agent và thao tác gõ/click của người dùng xung đột với nhau trên cùng một tab.
5. **Mô Hình Tin Cậy & Xác Thực Của Bridge (Bridge Trust & Authentication Model)**:
   - Bridge chỉ lắng nghe trên giao diện cục bộ `127.0.0.1:58765`. Mặc định không bắt buộc token xác thực để thuận tiện cho phát triển cục bộ.
   - Hệ thống **đã hỗ trợ bảo mật nâng cao** qua biến môi trường `AGENT_PILOT_API_KEY` (xác thực qua header `X-Agent-Pilot-Key`, `Authorization: Bearer <token>` cho HTTP và frame `HANDSHAKE` đầu tiên cho WebSocket) cùng khóa `AGENT_PILOT_EXTENSION_ID` ghim extension ID hợp lệ (khớp với `cli/bridge/auth.go`).
