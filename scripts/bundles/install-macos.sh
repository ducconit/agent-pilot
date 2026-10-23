#!/usr/bin/env bash
# Agent Pilot — macOS One-Step Installer
# Gỡ Gatekeeper quarantine, cài CLI/MCP Server vào ~/.local/bin, kích hoạt launchd User Agent và cài Agent Skill.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_SRC="${SCRIPT_DIR}/skills/agent-pilot/scripts/agent-pilot"
INSTALL_DIR="${HOME}/.local/bin"
BINARY_DST="${INSTALL_DIR}/agent-pilot"

echo "=================================================================="
echo "🍎 AGENT PILOT — CÀI ĐẶT CHO macOS"
echo "=================================================================="

if [[ ! -f "${BINARY_SRC}" ]]; then
  echo "❌ Không tìm thấy tệp thực thi: ${BINARY_SRC}" >&2
  exit 1
fi

# Gỡ cờ cách ly Gatekeeper của macOS (com.apple.quarantine)
if command -v xattr >/dev/null 2>&1; then
  echo "→ Đang gỡ thuộc tính cách ly Gatekeeper (xattr -cr)..."
  xattr -cr "${SCRIPT_DIR}" 2>/dev/null || true
fi

mkdir -p "${INSTALL_DIR}"
chmod +x "${BINARY_SRC}"
cp -f "${BINARY_SRC}" "${BINARY_DST}"
chmod 0755 "${BINARY_DST}"
if command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "${BINARY_DST}" 2>/dev/null || true
fi
echo "✅ Đã cài đặt binary vào: ${BINARY_DST}"

# Cài đặt launchd User Agent
echo "→ Đang đăng ký dịch vụ chạy ngầm (launchd User Agent)..."
if ! "${BINARY_DST}" service install; then
  echo "⚠️ Không thể kích hoạt launchd tự động. Bạn có thể chạy thủ công: ${BINARY_DST} server"
fi

# Cài đặt Agent Skill
echo "→ Đang cài đặt Agent Skill..."
"${BINARY_DST}" skill install --force || true
"${BINARY_DST}" skill install --agy --force || true

echo ""
echo "=================================================================="
echo "🎉 HOÀN TẤT CÀI ĐẶT AGENT PILOT TRÊN macOS!"
echo "=================================================================="
echo "1. Mở Google Chrome -> chrome://extensions -> bật Developer mode"
echo "   -> bấm 'Load unpacked' và chọn thư mục: ${SCRIPT_DIR}/extensions"
echo ""
echo "2. Thêm cấu hình MCP Server sau (dùng đường dẫn tuyệt đối cho macOS GUI Apps)"
echo "   - Antigravity: ~/.gemini/config/mcp_config.json"
echo "   - Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json"
echo "   - Cursor: ~/.cursor/mcp.json"
echo ""
cat <<EOF
{
  "mcpServers": {
    "agent-pilot": {
      "command": "${BINARY_DST}",
      "args": ["mcp"]
    }
  }
}
EOF
echo "=================================================================="
