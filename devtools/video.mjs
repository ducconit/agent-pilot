import fs from "node:fs/promises";
import { outputPath } from "./artifacts.mjs";

const recordings = new Map();

function recordingClient(page) {
  const client = page.mainFrame()?.client;
  if (!client) throw new Error("The target page does not expose a CDP client for video recording");
  return client;
}

async function finishRecording(session) {
  const { client, stream, file } = session;
  try {
    await client.send("Page.stopScreenRecording");
    let eof = false;
    let bytes = 0;
    while (!eof) {
      const chunk = await client.send("IO.read", { handle: stream });
      eof = Boolean(chunk.eof);
      if (!chunk.data) continue;
      const data = Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8");
      await file.write(data);
      bytes += data.length;
    }
    return bytes;
  } finally {
    await client.send("IO.close", { handle: stream }).catch(() => {});
    await file.close().catch(() => {});
  }
}

export async function screencast(page, key, options) {
  const action = options.action || "start";
  if (action === "start") {
    if (recordings.has(key)) throw new Error("A recording is already running on this tab");
    const fps = Number(options.fps ?? 20);
    if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error("fps must be between 1 and 60");
    const filePath = await outputPath(options.filePath || options.path, ".mp4", "recording");
    const file = await fs.open(filePath, "wx", 0o600);
    try {
      const client = recordingClient(page);
      const result = await client.send("Page.startScreenRecording", {
        frameRate: fps,
        ...(Number.isFinite(Number(options.maxWidth)) ? { maxWidth: Math.round(Number(options.maxWidth)) } : {}),
        ...(Number.isFinite(Number(options.maxHeight)) ? { maxHeight: Math.round(Number(options.maxHeight)) } : {})
      });
      if (!result?.stream) throw new Error("Chrome did not return a screen recording stream");
      recordings.set(key, { client, stream: result.stream, file, filePath, started: Date.now() });
      return { success: true, action, path: filePath, fps, format: "mp4", encoder: "chrome" };
    } catch (error) {
      await file.close().catch(() => {});
      await fs.unlink(filePath).catch(() => {});
      if (/startScreenRecording.*(wasn't found|not found|not supported)/i.test(error.message)) throw new Error("Video recording requires an up-to-date Chrome with Page.startScreenRecording support; the Chrome encoder is used directly, with no FFmpeg installation");
      throw error;
    }
  }
  if (action !== "stop") throw new Error("Screencast action must be start or stop");
  const session = recordings.get(key);
  if (!session) throw new Error("No recording is running on this tab");
  try {
    const bytes = await finishRecording(session);
    return { success: true, action, path: session.filePath, bytes, durationMs: Date.now() - session.started, format: "mp4" };
  } finally { recordings.delete(key); }
}
export async function stopAllRecordings() {
  await Promise.all([...recordings.values()].map(session => finishRecording(session).catch(() => {})));
  recordings.clear();
}
