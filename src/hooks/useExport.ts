import { useCallback, useState } from "react";
import { getErrorMessage } from "../utils/error";
import { FfmpegVideoExporter } from "../features/export/FFMPEGVideoExporter";

export const downloadVideoFromOPFS = async (fileName?: string) => {
  try {
    const root = await navigator.storage.getDirectory();
    const videoFh = await root.getFileHandle("export.mp4");
    const file = await videoFh.getFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName ? fileName.replace(/\.[^/.]+$/, "") : "flowkeys"}_export.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);

    await root
      .removeEntry("frames", { recursive: true })
      .catch(() => undefined);
    return true;
  } catch (error) {
    console.error("Download error:", error);
    return false;
  }
};

export const useExport = () => {
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [exportMessage, setExportMessage] = useState("");
  const [exportProgress, setExportProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  const exportViaFFMPEGWASM = useCallback(async () => {
    try {
      setExportState("processing");
      setExportMessage(
        "Initializing FFmpeg WASM (loads ~31MB core on first run)...",
      );

      // 1. Initialize or get the Singleton FFmpeg Instance
      const exporter = await FfmpegVideoExporter.load(
        (message) => {
          // FFmpeg WASM logs "Aborted()" when its virtual process exits, even
          // after successful encodes. We check the actual exec exit code in the
          // exporter, so suppress this noisy lifecycle message here.
          if (message.trim() !== "Aborted()") {
            console.log("[FFmpeg LOG]", message);
          }
        },
        (progress) => {
          // Map FFmpeg progress (0.0 - 1.0) to UI progress (40% - 90%)
          // Leaving 0-40% for loading/traversing, and 90-100% for saving
          setExportProgress(40 + progress * 50);
          setExportMessage(`Encoding video... ${Math.round(progress * 100)}%`);
        },
      );

      setExportMessage("Reading frames from OPFS storage...");
      setExportProgress(10);

      // 2. Traverse OPFS for UI feedback
      const root = await navigator.storage.getDirectory();
      const framesDir = (await root.getDirectoryHandle(
        "frames",
      )) as FileSystemDirectoryWithIterators;
      const frameNames: string[] = [];

      if (framesDir.keys) {
        for await (const name of framesDir.keys()) frameNames.push(name);
      } else if (framesDir.entries) {
        for await (const [name] of framesDir.entries()) frameNames.push(name);
      }
      frameNames.sort();

      setExportMessage(
        `Found ${frameNames.length} frames. Writing to FFmpeg memory...`,
      );
      setExportProgress(20);

      // 3. Process frames and get MP4 blob
      const videoBlob = await exporter.exportVideo("frames");

      setExportProgress(90);
      setExportMessage("Saving compiled video to OPFS storage...");

      // 4. Save back to OPFS
      const videoFh = await root.getFileHandle("export.mp4", { create: true });
      const writable = await videoFh.createWritable();
      await writable.write(videoBlob);
      await writable.close();

      setExportProgress(100);
      setExportMessage("Video compilation complete!");
      setExportState("ready");
    } catch (error) {
      console.error("FFmpeg processing error:", error);
      setErrorMessage(`Video encoding failed: ${getErrorMessage(error)}`);
      setExportState("idle");
    }
  }, []);

  return {
    errorMessage,
    exportMessage,
    exportProgress,
    exportState,
    exportViaFFMPEGWASM,
    setErrorMessage,
    setExportState,
    setExportMessage,
    setExportProgress,
  };
};
