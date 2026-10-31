<script setup>
import { withBase } from 'vitepress'
</script>

# 📊 Đo Lường Hiệu Năng: MCP vs Standalone CLI (Benchmarks)

Tài liệu này ghi lại kết quả thực nghiệm so sánh giữa **MCP Server** (`stdio` JSON-RPC) và **Standalone CLI** (`agent-pilot`) trên cùng môi trường Chrome và kịch bản tự động hóa trình duyệt tương đương.

---

## 🔬 Phương Pháp Đo Lường

Cả hai giao thức đều được kiểm thử qua bridge `http://127.0.0.1:58766` trên cùng trang mẫu (`example.com`) với chuỗi 7 bước thao tác giống hệt nhau:

1. **`open`**: Mở một tab nền được kiểm soát và chờ trang tải xong.
2. **`snapshot`**: Chụp danh sách các phần tử DOM tương tác (tối đa 20 phần tử).
3. **`scroll`**: Cuộn khung nhìn xuống 300px.
4. **`evaluate`**: Thực thi biểu thức lấy `title`, `url`, `links` và `textLength`.
5. **`performance metrics`**: Thu thập chỉ số Core Web Vitals, kích thước bộ nhớ heap và sức khỏe DOM.
6. **`screenshot`**: Chụp ảnh màn hình khung nhìn hiện tại qua CDP.
7. **`close`**: Đóng tab và giải phóng bộ nhớ.

Video và ảnh chụp màn hình thực tế trong quá trình benchmark:
- <a :href="withBase('/artifacts/browser-comparison/mcp-example-com.mp4')" target="_blank" rel="noopener">🎬 Video thực thi qua MCP</a> · <a :href="withBase('/artifacts/browser-comparison/mcp-example-com.png')" target="_blank" rel="noopener">🖼️ Ảnh chụp MCP</a>
- <a :href="withBase('/artifacts/browser-comparison/cli-example-com.mp4')" target="_blank" rel="noopener">🎬 Video thực thi qua CLI</a> · <a :href="withBase('/artifacts/browser-comparison/cli-example-com.png')" target="_blank" rel="noopener">🖼️ Ảnh chụp CLI</a>

<div class="ap-feature-grid">
  <div class="ap-feature-card">
    <div class="ap-feature-badge">VIDEO THỰC THI QUA MCP</div>
    <video controls preload="metadata" :poster="withBase('/artifacts/browser-comparison/mcp-example-com.png')" style="width: 100%; border-radius: 6px; margin-top: 0.5rem;">
      <source :src="withBase('/artifacts/browser-comparison/mcp-example-com.mp4')" type="video/mp4" />
    </video>
  </div>
  <div class="ap-feature-card">
    <div class="ap-feature-badge">VIDEO THỰC THI QUA CLI</div>
    <video controls preload="metadata" :poster="withBase('/artifacts/browser-comparison/cli-example-com.png')" style="width: 100%; border-radius: 6px; margin-top: 0.5rem;">
      <source :src="withBase('/artifacts/browser-comparison/cli-example-com.mp4')" type="video/mp4" />
    </video>
  </div>
</div>

> **Ghi chú về "Token Proxy"**: Chỉ số ước lượng token đầu ra được tính theo công thức `ceil(raw_bytes / 4)`, phản ánh dung lượng dữ liệu mà ngữ cảnh mô hình AI phải đọc (chưa bao gồm system prompt ẩn và suy luận nội bộ).

---

## 📈 Tổng Hợp Kết Quả

| Kênh Giao Tiếp | Lệnh Thành Công | Thử Lại / Lỗi | Tổng Lệnh | Dung Lượng Thô | Ước Lượng Token | Độ Trễ Thực Thi | Thời Lượng Quay Màn Hình |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **MCP stdio** (`port 58766`) | 7 | 0 | 7 | 8,361 bytes | ≈ 2,091 tokens | 1.419 s | 68.1 s |
| **CLI** (`port 58766`) | 7 | 1 / 1 | 8 | 3,992 bytes | ≈ 998 tokens | 1.329 s | 61.1 s |

- **Tiết kiệm ngữ cảnh (Context Savings)**: Kết quả đầu ra của CLI tiêu tốn **ít hơn ~52.3% dung lượng dữ liệu** so với MCP.
- **Tốc độ (Speed)**: CLI thực thi **nhanh hơn ~6.3%** về tổng độ trễ phản hồi.

---

## 🔍 Chi Tiết Độ Trễ & Dung Lượng Từng Bước

| Bước Thao Tác | Độ Trễ / Dung Lượng MCP | Độ Trễ / Dung Lượng CLI | Ghi Chú |
| :--- | :---: | :---: | :--- |
| `open` | 1,148 ms / 1,186 B | 1,157 ms / 531 B | Cả hai đều chờ trạng thái trang sẵn sàng |
| `snapshot` | 5 ms / 782 B | 10 ms / 417 B | Phản hồi MCP kèm thêm metadata `_meta` |
| `scroll` | 154 ms / 667 B | 4 ms / 44 B | Cuộn mượt qua Synthetic DOM |
| `scroll retry` | — | 7 ms / 67 B | CLI thử lại với cờ hợp lệ |
| `evaluate` | 4 ms / 842 B | 8 ms / 231 B | Lấy tiêu đề, URL, liên kết, độ dài văn bản |
| `performance metrics` | 5 ms / 3,404 B | 9 ms / 2,519 B | Core Web Vitals + sức khỏe DOM |
| `screenshot` | 95 ms / 842 B | 123 ms / 133 B | CLI lưu thẳng ra tệp và chỉ trả về đường dẫn |
| `close` | 8 ms / 638 B | 11 ms / 50 B | Phản hồi MCP bao gồm metadata |

---

## 💡 Khuyến Nghị Khi Cấu Hình Cho AI Agent

1. **Ưu tiên dùng Skills + CLI (`agent-pilot`) khi cần tiết kiệm tối đa Token**:
   - Lý tưởng cho các AI coding agent có quyền chạy terminal (*Claude Code, Cursor, Windsurf, Google Antigravity, OpenCode, Codex*).
   - Dữ liệu trả về tinh gọn giúp giảm tải cho cửa sổ ngữ cảnh (context window) trong các phiên làm việc dài.
2. **Dùng MCP (`agent-pilot mcp`) cho các ứng dụng Desktop / IDE chỉ hỗ trợ Tool Calling**:
   - Phù hợp với *Claude Desktop, Zed, Continue* hoặc khi không cấp quyền chạy lệnh shell trực tiếp.
   - Cung cấp kiểm tra kiểu dữ liệu đầu vào chặt chẽ và thông tin truy vết chi tiết.

3. **Quy tắc chạy đồng thời nhiều Agent (Concurrency Rule)**:
   - Khi chạy nhiều agent đồng thời, luôn truyền cờ `--tab <id>` và `--port <58765>` rõ ràng để tránh xung đột tab giữa các agent.
