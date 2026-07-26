import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { VideoExporter } from "../../types";

export const exportConfig = {
  fps: 30,
  frameIntervalMs: 1000 / 30,
  defaultFilename: "export.mp4",
  directory: "frames",
  frameExtension: "png",
};

export class FfmpegVideoExporter implements VideoExporter {
  private static instance: FfmpegVideoExporter | null = null;
  private static loadPromise: Promise<void> | null = null;

  private ffmpeg: FFmpeg;
  private loaded = false;

  private constructor() {
    this.ffmpeg = new FFmpeg();
  }

  public static getInstance(): FfmpegVideoExporter {
    if (!FfmpegVideoExporter.instance) {
      FfmpegVideoExporter.instance = new FfmpegVideoExporter();
    }
    return FfmpegVideoExporter.instance;
  }

  public static async load(
    onLog?: (message: string) => void,
    onProgress?: (progress: number) => void,
  ): Promise<FfmpegVideoExporter> {
    const instance = FfmpegVideoExporter.getInstance();

    // Return immediately if already loaded
    if (instance.loaded) return instance;

    // Prevent multiple simultaneous loads
    if (FfmpegVideoExporter.loadPromise) {
      await FfmpegVideoExporter.loadPromise;
      return instance;
    }

    FfmpegVideoExporter.loadPromise = (async () => {
      // CRITICAL: Vite requires the 'esm' path, NOT 'umd'
      const baseURL =
        "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

      if (onLog) {
        instance.ffmpeg.on("log", ({ message }) => onLog(message));
      }

      if (onProgress) {
        instance.ffmpeg.on("progress", ({ progress }) => onProgress(progress));
      }

      await instance.ffmpeg.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          "text/javascript",
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          "application/wasm",
        ),
      });

      instance.loaded = true;
    })();

    await FfmpegVideoExporter.loadPromise;
    return instance;
  }

  public async exportVideo(fileUri: string): Promise<Blob> {
    if (!this.loaded) {
      throw new Error(
        "FFmpeg is not loaded. Call FfmpegVideoExporter.load() first.",
      );
    }

    const root = await navigator.storage.getDirectory();
    const framesDir = (await root.getDirectoryHandle(
      fileUri,
    )) as FileSystemDirectoryWithIterators;

    const frameNames: string[] = [];
    if (framesDir.keys) {
      for await (const name of framesDir.keys()) frameNames.push(name);
    } else if (framesDir.entries) {
      for await (const [name] of framesDir.entries()) frameNames.push(name);
    }

    frameNames.sort();

    if (frameNames.length === 0) {
      throw new Error("No frames found in the OPFS directory.");
    }

    // 1. Load OPFS Frames into FFmpeg's Virtual File System
    for (const name of frameNames) {
      const fileHandle = await framesDir.getFileHandle(name);
      const file = await fileHandle.getFile();
      // fetchFile correctly converts a File object to a Uint8Array for FFmpeg
      await this.ffmpeg.writeFile(name, await fetchFile(file));
    }

    // 2. Execute FFmpeg command
    // -framerate 30: Assumes you captured at 30fps
    // -i frame_%05d.png: Matches your padStart(5, '0') naming convention
    // -preset ultrafast: Crucial for WASM to prevent browser timeouts on long videos
    // -vf scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p:
    //   H.264/yuv420p requires even dimensions. Canvas heights can be odd.
    const exitCode = await this.ffmpeg.exec([
      "-framerate",
      `${exportConfig.fps}`,
      "-i",
      `frame_%05d.${exportConfig.frameExtension}`,
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      "-movflags",
      "+faststart",
      "output.mp4",
    ]);

    if (exitCode !== 0) {
      throw new Error(`FFmpeg encoding failed with exit code ${exitCode}.`);
    }

    // 3. Extract the encoded video
    const data = await this.ffmpeg.readFile("output.mp4");
    const videoBytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;

    if (videoBytes.byteLength === 0) {
      throw new Error("FFmpeg produced an empty MP4 file.");
    }

    const mp4Blob = new Blob([videoBytes], { type: "video/mp4" });

    // 4. Cleanup virtual file system to free up RAM
    for (const name of frameNames) {
      await this.ffmpeg.deleteFile(name);
    }
    await this.ffmpeg.deleteFile("output.mp4");

    return mp4Blob;
  }
}
