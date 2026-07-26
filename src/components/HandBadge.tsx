interface HandBadgeProps {
  fileName: string;
  leftColor: string;
  rightColor: string;
  onLeftColorChange: (color: string) => void;
  onRightColorChange: (color: string) => void;
}

export const HandBadge = ({
  fileName,
  leftColor,
  rightColor,
  onLeftColorChange,
  onRightColorChange,
}: HandBadgeProps) => (
  <div className="absolute top-4 left-6 z-10 flex items-center gap-4 bg-slate-900/85 backdrop-blur-md px-4 py-2 rounded-xl border border-slate-800 text-xs text-slate-300 shadow-2xl">
    <label className="relative flex items-center gap-2 cursor-pointer group">
      <span
        className="w-3.5 h-3.5 rounded-full shadow-md transition-transform group-hover:scale-110"
        style={{
          backgroundColor: leftColor,
          boxShadow: `0 0 8px ${leftColor}`,
        }}
      />
      <span className="font-semibold text-slate-200 group-hover:text-white transition-colors">
        Left Hand
      </span>
      <input
        type="color"
        value={leftColor}
        onChange={(event) => onLeftColorChange(event.target.value)}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
      />
    </label>

    <label className="relative flex items-center gap-2 cursor-pointer group">
      <span
        className="w-3.5 h-3.5 rounded-full shadow-md transition-transform group-hover:scale-110"
        style={{
          backgroundColor: rightColor,
          boxShadow: `0 0 8px ${rightColor}`,
        }}
      />
      <span className="font-semibold text-slate-200 group-hover:text-white transition-colors">
        Right Hand
      </span>
      <input
        type="color"
        value={rightColor}
        onChange={(event) => onRightColorChange(event.target.value)}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
      />
    </label>

    {fileName && (
      <span className="text-slate-400 border-l border-slate-700/80 pl-3 font-medium truncate max-w-[200px]">
        {fileName}
      </span>
    )}
  </div>
);
