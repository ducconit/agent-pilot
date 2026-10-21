import fs from "node:fs/promises";
import { outputPath } from "./artifacts.mjs";

const recordings = new Map();
export async function screencast(page, key, options) {
  const action = options.action || "start";
  if (action === "start") {
    if (recordings.has(key)) throw new Error("A recording is already running on this tab");
    const fps = Number(options.fps ?? 20);
    if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error("fps must be between 1 and 60");
    const filePath = await outputPath(options.filePath || options.path, ".mp4", "recording");
    const reservation = await fs.open(filePath, "wx", 0o600); await reservation.close();
    try {
      const dimensions = await page.evaluate(() => ({ width: innerWidth * devicePixelRatio, height: innerHeight * devicePixelRatio }));
      const recorder = await page.record({ path: filePath, fps, maxWidth: Math.round(dimensions.width), maxHeight: Math.round(dimensions.height) });
      recordings.set(key, { recorder, filePath, started: Date.now() });
      return { success: true, action, path: filePath, fps, format: "mp4", encoder: "chrome" };
    } catch (error) {
      await fs.unlink(filePath).catch(() => {});
      if (/startScreenRecording.*(wasn't found|not found|not supported)/i.test(error.message)) throw new Error("Video recording requires an up-to-date Chrome with Page.startScreenRecording support; the Chrome encoder is used directly, with no FFmpeg installation");
      throw error;
    }
  }
  if (action !== "stop") throw new Error("Screencast action must be start or stop");
  const session = recordings.get(key);
  if (!session) throw new Error("No recording is running on this tab");
  try {
    await session.recorder.stop();
    return { success: true, action, path: session.filePath, bytes: (await fs.stat(session.filePath)).size, durationMs: Date.now() - session.started, format: "mp4" };
  } finally { recordings.delete(key); }
}
export async function stopAllRecordings() {
  await Promise.all([...recordings.values()].map(session => session.recorder.stop().catch(() => {})));
  recordings.clear();
}
