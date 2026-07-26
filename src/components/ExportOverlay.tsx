import { Download } from "lucide-react";

interface ExportOverlayProps {
  exportFrameCount: number;
  exportMessage: string;
  exportProgress: number;
  exportState: ExportState;
  onClose: () => void;
  onDownloadVideo: () => void;
}

export const ExportOverlay = ({
  exportFrameCount,
  exportMessage,
  exportProgress,
  exportState,
  onClose,
  onDownloadVideo,
}: ExportOverlayProps) => {
  if (exportState === "idle") return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-center bg-slate-900/90 backdrop-blur-md p-8 rounded-2xl border border-slate-800 shadow-2xl min-w-[340px]">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center space-x-3">
          {exportState === "recording" && (
            <span className="w-3.5 h-3.5 bg-red-500 rounded-full animate-pulse mr-2" />
          )}
          {exportState === "recording"
            ? "Video exporting..."
            : exportState === "processing"
            ? "Processing Video..."
            : "Export Complete!"}
        </h2>

        {exportState === "recording" && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-slate-300">
              Capturing video frames into OPFS storage...
            </p>
            <span className="text-xs text-amber-400 font-mono">
              Frames captured: {exportFrameCount}
            </span>
          </div>
        )}

        {exportState === "processing" && (
          <div className="w-full flex flex-col items-center">
            <div className="text-emerald-400 font-medium mb-3 text-xs text-center">
              {exportMessage}
            </div>
            {exportProgress > 0 && (
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden border border-slate-700">
                <div
                  className="bg-emerald-500 h-full transition-all duration-300"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
            )}
            <div className="text-slate-400 text-xs mt-2 font-mono">
              {exportProgress}%
            </div>
          </div>
        )}

        {exportState === "ready" && (
          <div className="flex flex-col items-center space-y-4">
            <p className="text-sm text-slate-300">
              Your MP4 video has been compiled and stored in OPFS.
            </p>
            <button
              onClick={onDownloadVideo}
              className="flex items-center space-x-2 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl shadow-lg transition-all"
            >
              <Download className="w-5 h-5" />
              <span>Download Video</span>
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white text-xs underline transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
