/**
 * Agent Pilot - Snip & Annotation Engine
 * Interactive on-screen drawing overlay providing Arrow, Box, Circle, Pen, Text, and Redact tools.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.snipAnnotator) return;
  window.__AP_INTERNAL__.__guards.snipAnnotator = true;

  const COLORS = {
    red: "#ef4444",
    yellow: "#f59e0b",
    green: "#10b981",
    blue: "#3b82f6",
    white: "#ffffff",
    black: "#000000"
  };

  class SnipAnnotator {
    constructor(canvasEl, containerEl) {
      this.canvas = canvasEl;
      this.container = containerEl;
      this.ctx = canvasEl.getContext("2d");
      this.activeTool = "arrow"; // "arrow" | "box" | "circle" | "pen" | "text" | "redact" | "select"
      this.color = COLORS.red;
      this.strokeWidth = 3;
      this.actions = [];
      this.isDrawing = false;
      this.startX = 0;
      this.startY = 0;
      this.currentAction = null;
      this.dpr = window.devicePixelRatio || 1;
      this.textInputEl = null;

      this.onActionsChanged = null;
      this.bindCanvasEvents();
    }

    setTool(tool) {
      if (this.textInputEl) {
        this.commitTextInput();
      }
      this.activeTool = tool;
    }

    setColor(colorHex) {
      this.color = colorHex;
    }

    setStrokeWidth(w) {
      this.strokeWidth = Number(w) || 3;
    }

    resize(width, height) {
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(width * this.dpr);
      this.canvas.height = Math.round(height * this.dpr);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.ctx.resetTransform?.();
      this.ctx.scale(this.dpr, this.dpr);
      this.redraw();
    }

    getCanvasPoint(e) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: Math.round(e.clientX - rect.left),
        y: Math.round(e.clientY - rect.top)
      };
    }

    bindCanvasEvents() {
      const onMouseDown = (e) => {
        if (e.button !== 0) return;
        if (this.activeTool === "select") return;

        // If clicking outside an active text input, commit it
        if (this.textInputEl && e.target !== this.textInputEl) {
          this.commitTextInput();
          if (this.activeTool === "text") return;
        }

        const pt = this.getCanvasPoint(e);
        this.startX = pt.x;
        this.startY = pt.y;

        if (this.activeTool === "text") {
          this.openTextInput(pt.x, pt.y);
          return;
        }

        this.isDrawing = true;

        if (this.activeTool === "pen") {
          this.currentAction = {
            type: "pen",
            points: [pt],
            color: this.color,
            strokeWidth: this.strokeWidth
          };
        } else {
          this.currentAction = {
            type: this.activeTool,
            x: pt.x,
            y: pt.y,
            w: 0,
            h: 0,
            from: { x: pt.x, y: pt.y },
            to: { x: pt.x, y: pt.y },
            color: this.color,
            strokeWidth: this.strokeWidth
          };
        }
      };

      const onMouseMove = (e) => {
        if (!this.isDrawing || !this.currentAction) return;
        const pt = this.getCanvasPoint(e);

        if (this.currentAction.type === "pen") {
          this.currentAction.points.push(pt);
        } else if (this.currentAction.type === "arrow") {
          this.currentAction.to = pt;
        } else {
          this.currentAction.x = Math.min(this.startX, pt.x);
          this.currentAction.y = Math.min(this.startY, pt.y);
          this.currentAction.w = Math.abs(pt.x - this.startX);
          this.currentAction.h = Math.abs(pt.y - this.startY);
        }
        this.redraw();
      };

      const onMouseUp = (e) => {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        if (this.currentAction) {
          const ca = this.currentAction;
          let isValid = false;

          if (ca.type === "pen" && ca.points.length > 1) {
            isValid = true;
          } else if (ca.type === "arrow") {
            const dist = Math.hypot(ca.to.x - ca.from.x, ca.to.y - ca.from.y);
            isValid = dist > 6;
          } else if (ca.w > 4 && ca.h > 4) {
            isValid = true;
          }

          if (isValid) {
            this.actions.push(ca);
            if (typeof this.onActionsChanged === "function") {
              this.onActionsChanged(this.actions.length);
            }
          }
          this.currentAction = null;
          this.redraw();
        }
      };

      this.canvas.addEventListener?.("mousedown", onMouseDown);
      if (typeof window !== "undefined" && window.addEventListener) {
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      }

      this._cleanupListeners = () => {
        this.canvas.removeEventListener?.("mousedown", onMouseDown);
        if (typeof window !== "undefined" && window.removeEventListener) {
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        }
        if (this.textInputEl) {
          this.textInputEl.remove();
          this.textInputEl = null;
        }
      };
    }

    openTextInput(x, y) {
      if (this.textInputEl) this.commitTextInput();

      const input = document.createElement("textarea");
      input.className = "agent-pilot-snip-text-input";
      input.placeholder = "Nhập ghi chú...";
      input.rows = 2;
      input.style.left = `${x}px`;
      input.style.top = `${y}px`;
      input.style.color = this.color;
      input.style.borderColor = this.color;

      input.onkeydown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          this.commitTextInput();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.cancelTextInput();
        }
      };

      input.onblur = () => {
        this.commitTextInput();
      };

      this.container.appendChild(input);
      this.textInputEl = input;
      if (typeof setTimeout !== "undefined") {
        setTimeout(() => input.focus(), 20);
      } else if (typeof input.focus === "function") {
        input.focus();
      }
    }

    commitTextInput() {
      if (!this.textInputEl) return;
      const input = this.textInputEl;
      this.textInputEl = null;
      input.onblur = null;
      input.onkeydown = null;

      const val = input.value.trim();
      const x = parseInt(input.style.left, 10) || 0;
      const y = parseInt(input.style.top, 10) || 0;
      if (val) {
        this.actions.push({
          type: "text",
          x,
          y: y + 14,
          text: val,
          color: this.color,
          fontSize: Math.max(13, 12 + this.strokeWidth * 1.5)
        });
        if (typeof this.onActionsChanged === "function") {
          this.onActionsChanged(this.actions.length);
        }
      }
      if (input.parentNode) {
        input.remove();
      }
      this.redraw();
    }

    cancelTextInput() {
      if (!this.textInputEl) return;
      const input = this.textInputEl;
      this.textInputEl = null;
      input.onblur = null;
      input.onkeydown = null;
      if (input.parentNode) {
        input.remove();
      }
    }

    undo() {
      this.cancelTextInput();
      if (this.actions.length > 0) {
        this.actions.pop();
        if (typeof this.onActionsChanged === "function") {
          this.onActionsChanged(this.actions.length);
        }
        this.redraw();
      }
    }

    clear() {
      this.cancelTextInput();
      this.actions = [];
      this.currentAction = null;
      if (typeof this.onActionsChanged === "function") {
        this.onActionsChanged(0);
      }
      this.redraw();
    }

    redraw() {
      const w = this.canvas.width / this.dpr;
      const h = this.canvas.height / this.dpr;
      this.ctx.clearRect(0, 0, w, h);

      for (const action of this.actions) {
        this.drawAction(action);
      }
      if (this.currentAction) {
        this.drawAction(this.currentAction);
      }
    }

    drawAction(action) {
      const ctx = this.ctx;
      ctx.save();

      if (action.type === "arrow") {
        const from = action.from;
        const to = action.to;
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const headLen = Math.max(12, action.strokeWidth * 3.8);

        ctx.strokeStyle = action.color;
        ctx.fillStyle = action.color;
        ctx.lineWidth = action.strokeWidth;
        ctx.lineCap = "round";

        // Shaft
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(
          to.x - headLen * Math.cos(angle - Math.PI / 6),
          to.y - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          to.x - headLen * Math.cos(angle + Math.PI / 6),
          to.y - headLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
      } else if (action.type === "box") {
        ctx.strokeStyle = action.color;
        ctx.lineWidth = action.strokeWidth;
        ctx.lineJoin = "round";
        ctx.strokeRect(action.x, action.y, action.w, action.h);
      } else if (action.type === "circle") {
        ctx.strokeStyle = action.color;
        ctx.lineWidth = action.strokeWidth;
        ctx.beginPath();
        const rx = Math.max(1, action.w / 2);
        const ry = Math.max(1, action.h / 2);
        const cx = action.x + rx;
        const cy = action.y + ry;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (action.type === "pen") {
        if (action.points && action.points.length > 0) {
          ctx.strokeStyle = action.color;
          ctx.lineWidth = action.strokeWidth;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(action.points[0].x, action.points[0].y);
          for (let i = 1; i < action.points.length; i++) {
            ctx.lineTo(action.points[i].x, action.points[i].y);
          }
          ctx.stroke();
        }
      } else if (action.type === "redact") {
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(action.x, action.y, action.w, action.h);
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(action.x, action.y, action.w, action.h);
      } else if (action.type === "text") {
        const text = action.text;
        const fontSize = action.fontSize || 14;
        ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
        const metrics = ctx.measureText(text);
        const padX = 6;
        const padY = 4;
        const boxH = fontSize + padY * 2;

        // Background pill
        ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
        ctx.fillRect(action.x - padX, action.y - fontSize + padY / 2, metrics.width + padX * 2, boxH);
        ctx.strokeStyle = action.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(action.x - padX, action.y - fontSize + padY / 2, metrics.width + padX * 2, boxH);

        // Text
        ctx.fillStyle = action.color;
        ctx.textBaseline = "middle";
        ctx.fillText(text, action.x, action.y);
      }

      ctx.restore();
    }

    toDataURL() {
      if (this.textInputEl) {
        this.commitTextInput();
      }
      return this.canvas.toDataURL("image/png");
    }

    destroy() {
      if (typeof this._cleanupListeners === "function") {
        this._cleanupListeners();
      }
    }
  }

  window.__AP_INTERNAL__.snipAnnotator = {
    COLORS,
    createSnipAnnotator: (canvasEl, containerEl) => new SnipAnnotator(canvasEl, containerEl)
  };
})();
