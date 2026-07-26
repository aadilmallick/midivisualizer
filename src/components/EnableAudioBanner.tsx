import { Volume2 } from "lucide-react";

interface EnableAudioBannerProps {
  onEnableAudio: () => void;
}

export const EnableAudioBanner = ({
  onEnableAudio,
}: EnableAudioBannerProps) => (
  <div className="bg-blue-600 px-6 py-2.5 flex items-center justify-between text-white shadow-md z-30 transition-all">
    <div className="flex items-center gap-3">
      <Volume2 className="w-5 h-5 animate-pulse text-amber-300" />
      <span className="text-sm font-medium">
        Audio is currently muted or uninitialized. Click to enable sound for
        free play and playback.
      </span>
    </div>
    <button
      onClick={onEnableAudio}
      className="px-4 py-1.5 bg-white text-blue-700 hover:bg-slate-100 font-bold text-xs rounded-full shadow-lg transition-all"
    >
      Enable Audio
    </button>
  </div>
);
