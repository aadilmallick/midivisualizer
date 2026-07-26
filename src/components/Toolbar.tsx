import {
  Film,
  Layers,
  Music,
  Pause,
  Play,
  Sliders,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatTime } from "../features/layout/layoutUtils";

interface ToolbarProps {
  currentTime: number;
  duration: number;
  exportState: ExportState;
  fallSpeed: number;
  includeAudioInExport: boolean;
  isMuted: boolean;
  isPlaying: boolean;
  isReady: boolean;
  midiDevices: string[];
  particlesEnabled: boolean;
  onFallSpeedChange: (speed: number) => void;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onIncludeAudioInExportChange: (include: boolean) => void;
  onSeek: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onStartExport: () => void;
  onToggleMute: () => void;
  onToggleParticles: () => void;
  onTogglePlay: () => void;
  isPianoLoaded: boolean;
}

export const Toolbar = ({
  currentTime,
  duration,
  exportState,
  fallSpeed,
  includeAudioInExport,
  isMuted,
  isPlaying,
  isReady,
  midiDevices,
  particlesEnabled,
  onFallSpeedChange,
  onFileUpload,
  onIncludeAudioInExportChange,
  onSeek,
  onStartExport,
  onToggleMute,
  onToggleParticles,
  onTogglePlay,
  isPianoLoaded,
}: ToolbarProps) => (
  <header className="h-20 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-6 flex items-center justify-between z-20 shadow-xl">
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-gradient-to-tr from-amber-500 to-orange-600 rounded-xl shadow-lg shadow-orange-500/20">
          <Music className="w-6 h-6 text-slate-950 font-bold" />
        </div>
        <div>
          <h1 className="text-xl font-black tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-300">
            FlowKeys
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-xs text-slate-400 font-medium">
              {midiDevices.length > 0
                ? `MIDI Connected (${midiDevices[0]})`
                : "No Hardware MIDI Device"}
            </p>
          </div>
        </div>
      </div>
    </div>

    {/* Virtual Instrument Indicator */}
    <div className="hidden md:flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60 shadow-inner">
      <Layers className="w-4 h-4 text-amber-400" />
      <span className="text-xs font-semibold text-slate-300">
        Concert Grand Piano
      </span>
      <span
        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          isPianoLoaded
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-amber-500/20 text-amber-400 animate-pulse"
        }`}
      >
        {isPianoLoaded ? "HD Samples Ready" : "Loading Samples..."}
      </span>
    </div>

    <div className="flex-1 max-w-2xl mx-8 flex items-center gap-4">
      <span className="text-xs font-mono text-slate-400 w-12 text-right">
        {formatTime(currentTime)}
      </span>
      <input
        type="range"
        min="0"
        max={duration || 100}
        step="0.1"
        value={currentTime}
        onChange={onSeek}
        disabled={!isReady}
        className="flex-1 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400 focus:outline-none"
      />
      <span className="text-xs font-mono text-slate-400 w-12">
        {formatTime(duration)}
      </span>
    </div>

    <div className="flex items-center gap-3">
      <div className="hidden lg:flex items-center gap-2 bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-700/50">
        <Sliders className="w-4 h-4 text-slate-400" />
        <span className="text-xs text-slate-300 font-medium">Speed:</span>
        <input
          type="range"
          min="100"
          max="500"
          step="20"
          value={fallSpeed}
          onChange={(event) => onFallSpeedChange(Number(event.target.value))}
          className="w-16 h-1.5 bg-slate-700 rounded appearance-none cursor-pointer accent-orange-500"
        />
      </div>

      <button
        onClick={onToggleParticles}
        title="Toggle Particle Effects"
        className={`p-2.5 rounded-xl border transition-all ${
          particlesEnabled
            ? "bg-amber-500/10 border-amber-500/40 text-amber-400 shadow-md shadow-amber-500/10"
            : "bg-slate-800 border-slate-700 text-slate-400"
        }`}
      >
        <Sparkles className="w-5 h-5" />
      </button>

      <button
        onClick={onToggleMute}
        title="Toggle Mute"
        className={`p-2.5 rounded-xl border transition-all ${
          !isMuted
            ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
            : "bg-red-500/10 border-red-500/40 text-red-400"
        }`}
      >
        {isMuted ? (
          <VolumeX className="w-5 h-5" />
        ) : (
          <Volume2 className="w-5 h-5" />
        )}
      </button>

      <label className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-xl cursor-pointer transition-all text-sm font-semibold text-slate-200 shadow-md">
        <Upload className="w-4 h-4 text-amber-400" />
        <span className="hidden sm:inline">Upload MIDI</span>
        <input
          type="file"
          accept=".mid,.midi"
          onChange={onFileUpload}
          className="hidden"
        />
      </label>

      <label
        title="Include piano audio in exported MP4"
        className={`hidden xl:flex items-center gap-2 px-3 py-2 bg-slate-800/60 border border-slate-700/50 rounded-xl text-xs font-semibold text-slate-300 ${
          exportState !== "idle" ? "opacity-60" : "cursor-pointer"
        }`}
      >
        <input
          type="checkbox"
          checked={includeAudioInExport}
          disabled={exportState !== "idle"}
          onChange={(event) =>
            onIncludeAudioInExportChange(event.target.checked)
          }
          className="accent-amber-400"
        />
        <span>Audio</span>
      </label>

      <button
        onClick={onStartExport}
        disabled={!isReady || exportState !== "idle"}
        title="Export Video (OPFS)"
        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border transition-all shadow-md ${
          exportState !== "idle"
            ? "bg-red-500/10 border-red-500/40 text-red-400"
            : "bg-slate-800 hover:bg-slate-700/80 border-slate-700 text-slate-200"
        } ${!isReady ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <Film className="w-4 h-4 text-amber-400" />
        <span className="hidden sm:inline">Export Video</span>
      </button>

      <button
        onClick={onTogglePlay}
        disabled={!isReady}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-lg ${
          isPlaying
            ? "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/25"
            : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/25"
        } ${!isReady ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        {isPlaying ? (
          <>
            <Pause className="w-4 h-4 fill-slate-950" />
            <span>Pause</span>
          </>
        ) : (
          <>
            <Play className="w-4 h-4 fill-slate-950" />
            <span>Play</span>
          </>
        )}
      </button>
    </div>
  </header>
);
