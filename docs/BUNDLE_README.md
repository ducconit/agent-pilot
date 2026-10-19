# 🚀 Agent Pilot — Tài Liệu Gói Cài Đặt Theo Hệ Điều Hành (OS Bundles)

Mỗi gói phát hành (Release Bundle) của **Agent Pilot** được đóng gói riêng biệt cho từng hệ điều hành với **binary tĩnh (`CGO_ENABLED=0`)**, **script cài đặt tự động 1 lệnh** và **hướng dẫn cấu hình MCP Server / Background Service** chuyên biệt cho hệ điều hành đó:

## 📚 Chọn Tài Liệu Theo Hệ Điều Hành Của Bạn

| Hệ Điều Hành | Kiến Trúc Hỗ Trợ | Tài Liệu Hướng Dẫn Chuyên Biệt | Script Cài Đặt Đi Kèm | Dịch Vụ Chạy Ngầm |
| :--- | :--- | :--- | :--- | :--- |
| 🐧 **Ubuntu / Linux** | `linux-amd64`, `linux-arm64` | [**docs/bundles/README.ubuntu.md**](bundles/README.ubuntu.md) | `install.sh` | `systemd --user` (`~/.config/systemd/user/agent-pilot.service`) |
| 🍎 **macOS** | `darwin-arm64` (M1-M4), `darwin-amd64` (Intel) | [**docs/bundles/README.macos.md**](bundles/README.macos.md) | `install.sh` | `launchd` (`~/Library/LaunchAgents/com.agentpilot.bridge.plist`) |
| 🪟 **Windows** | `windows-amd64`, `windows-arm64` | [**docs/bundles/README.windows.md**](bundles/README.windows.md) | `install.ps1` | `Task Scheduler` (`AgentPilotBridge`) |

---

## 📦 Cấu Trúc Của Mỗi Gói Bundle

Khi chạy `npm run pack:bundle` (hoặc `npm run pack:bundle:ubuntu`, `npm run pack:bundle:macos`, `npm run pack:bundle:windows`), hệ thống tạo ra gói `.zip` tại `dist/bundles/` với cấu trúc:

```text
agent-pilot-{{VERSION}}-{{PLATFORM}}/
├── extensions/            Chrome Extension (Manifest V3) — nạp trực tiếp vào Chrome (Load unpacked)
├── {{BINARY_NAME}}        Agent Pilot CLI & MCP Server (agent-pilot hoặc agent-pilot.exe)
├── install.sh / .ps1      Script cài đặt 1 lệnh theo đúng hệ điều hành
├── skills/agent-pilot/    Agent Skill (SKILL.md + references + examples)
└── README.md              Bản hướng dẫn đã được biên dịch riêng cho {{PLATFORM}}
```

---

## 🛠️ Lệnh Đóng Gói Từng Bản Từ Mã Nguồn

```bash
# Đóng gói toàn bộ 3 hệ điều hành (6 kiến trúc):
npm run pack:bundle

# Hoặc đóng gói riêng từng bản theo hệ điều hành:
npm run pack:bundle:ubuntu    # Chỉ đóng gói bản Ubuntu/Linux (amd64 + arm64)
npm run pack:bundle:macos     # Chỉ đóng gói bản macOS (arm64 + amd64)
npm run pack:bundle:windows   # Chỉ đóng gói bản Windows (amd64 + arm64)
```

---
MIT License · Tác giả **DNT** ([@ducconit](https://github.com/ducconit)) · https://github.com/ducconit/agent-pilot-extension
