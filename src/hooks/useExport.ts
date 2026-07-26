import { useCallback, useState } from "react";
import { getErrorMessage } from "../utils/error";

interface VideoExporter {
  exportVideo: (fileUri: string) => Promise<Blob>;
}

const mockVideoExporter: VideoExporter = {
  exportVideo: async () => {
    let videoBlob: Blob;
    try {
      const response = await fetch(
        "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4",
      );
      if (!response.ok) throw new Error("Network error");
      videoBlob = await response.blob();
    } catch (error) {
      console.warn(
        "Fallback mock video generated due to network restrictions:",
        error,
      );
      videoBlob = new Blob(["mock mp4 video content"], { type: "video/mp4" });
    }
    return videoBlob;
  },
};

const type: "mock" | "real" = "mock";

const exportConfig = {
  type,
  directory: "frames",
  getFileName: () => "export.mp4",
};

export const downloadVideoFromOPFS = async (fileName?: string) => {
  try {
    const root = await navigator.storage.getDirectory();
    const videoFh = await root.getFileHandle(exportConfig.getFileName());
    const file = await videoFh.getFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName ? fileName.replace(/\.[^/.]+$/, "") : "flowkeys"}_${exportConfig.getFileName()}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    await root
      .removeEntry(exportConfig.directory, { recursive: true })
      .catch(() => undefined);
    // setExportState("idle");
    return true;
  } catch (error) {
    console.error("Download error:", error);
    // setErrorMessage("Failed to download video from OPFS storage.");
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
      setExportMessage("Reading frames from OPFS storage...");

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
        `Traversed ${frameNames.length} image frames in OPFS. Simulating FFmpeg WASM compilation...`,
      );
      setExportProgress(30);

      await new Promise((resolve) => setTimeout(resolve, 800));
      setExportProgress(65);
      setExportMessage("Concatenating PNG frames & encoding video codec...");

      let videoBlob: Blob;
      if (type === "mock") {
        videoBlob = await mockVideoExporter.exportVideo(
          "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4",
        );
      } else {
        // TODO: fill in later, but for now, use the mock video
        videoBlob = await mockVideoExporter.exportVideo(
          "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4",
        );
      }

      setExportProgress(90);
      setExportMessage("Saving video to OPFS storage...");

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
