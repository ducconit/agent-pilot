#!/usr/bin/env bash
# Agent Pilot — Ubuntu / Linux One-Step Installer
# Cài đặt CLI/MCP Server vào ~/.local/bin, kích hoạt systemd --user service và cài Agent Skill.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_SRC="${SCRIPT_DIR}/agent-pilot"
INSTALL_DIR="${HOME}/.local/bin"
BINARY_DST="${INSTALL_DIR}/agent-pilot"

echo "=================================================================="
echo "🐧 AGENT PILOT — CÀI ĐẶT CHO UBUNTU / LINUX"
echo "=================================================================="

if [[ ! -f "${BINARY_SRC}" ]]; then
  echo "❌ Không tìm thấy tệp thực thi: ${BINARY_SRC}" >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}"
chmod +x "${BINARY_SRC}"
cp -f "${BINARY_SRC}" "${BINARY_DST}"
chmod 0755 "${BINARY_DST}"
echo "✅ Đã cài đặt binary vào: ${BINARY_DST}"

# Cài đặt systemd --user service
echo "→ Đang đăng ký dịch vụ chạy ngầm (systemd --user)..."
if ! "${BINARY_DST}" service install; then
  echo "⚠️ Không thể kích hoạt systemd --user tự động (có thể đang chạy trong container/SSH không có dbus)."
  echo "   Bạn có thể khởi chạy thủ công bằng lệnh: ${BINARY_DST} server"
fi

# Cài đặt Agent Skill
echo "→ Đang cài đặt Agent Skill..."
"${BINARY_DST}" skill install --force || true
"${BINARY_DST}" skill install --agy --force || true

echo ""
echo "=================================================================="
echo "🎉 HOÀN TẤT CÀI ĐẶT AGENT PILOT TRÊN UBUNTU / LINUX!"
echo "=================================================================="
echo "1. Mở Google Chrome -> chrome://extensions -> bật Developer mode"
echo "   -> bấm 'Load unpacked' và chọn thư mục: ${SCRIPT_DIR}/extensions"
echo ""
echo "2. Thêm cấu hình MCP Server sau vào AI Agent của bạn"
echo "   (Antigravity: ~/.gemini/config/mcp_config.json | Claude: ~/.config/Claude/claude_desktop_config.json | Cursor: ~/.cursor/mcp.json):"
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
