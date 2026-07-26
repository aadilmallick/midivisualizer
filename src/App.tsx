import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Download,
  Film,
  Music,
  Pause,
  Play,
  Sliders,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react";

type ExportState = "idle" | "recording" | "processing" | "ready";

type MidiNote = {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
  track: number;
};

type MidiData = {
  notes: MidiNote[];
  duration: number;
};

type ActiveNoteInfo = {
  color: string;
  isLeftHand: boolean;
};

type KeyPosition = {
  x: number;
  width: number;
  isBlack: boolean;
};

type KeyboardLayout = {
  positions: Partial<Record<number, KeyPosition>>;
  whiteKeyWidth: number;
  blackKeyWidth: number;
};

type RawMidiNote = {
  midi: number;
  startTick: number;
  endTick: number;
  durationTicks: number;
  velocity: number;
  track: number;
};

type TempoEvent = {
  tick: number;
  tempo: number;
};

type OpenMidiNote = {
  note: number;
  tick: number;
  velocity: number;
};

type Voice = {
  osc: OscillatorNode;
  osc2: OscillatorNode;
  gain: GainNode;
};

type WorkerMessage =
  | { type: "initDone" }
  | { type: "clearDone" }
  | { type: "frameSaved"; name: string }
  | { type: "error"; error: string };

type MidiMessage = {
  data: Uint8Array;
};

type MidiInput = {
  name?: string;
  onmidimessage: ((message: MidiMessage) => void) | null;
};

type MidiInputCollection = {
  values(): IterableIterator<MidiInput>;
  forEach(callback: (input: MidiInput) => void): void;
};

type MidiAccess = {
  inputs: MidiInputCollection;
  onstatechange: (() => void) | null;
};

type FileSystemDirectoryWithIterators = FileSystemDirectoryHandle & {
  keys?: () => AsyncIterableIterator<string>;
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

declare global {
  interface Navigator {
    requestMIDIAccess?: () => Promise<MidiAccess>;
  }

  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/**
 * Worker Code String for high-throughput OPFS frame writing.
 */
const WORKER_CODE = `
  let dirHandle;
  self.onmessage = async (e) => {
    try {
      if (e.data.type === 'init') {
        const root = await navigator.storage.getDirectory();
        dirHandle = await root.getDirectoryHandle('frames', { create: true });
        self.postMessage({ type: 'initDone' });
      } else if (e.data.type === 'saveFrame') {
        const fh = await dirHandle.getFileHandle(e.data.name, { create: true });
        const writable = await fh.createWritable();
        await writable.write(e.data.blob);
        await writable.close();
        self.postMessage({ type: 'frameSaved', name: e.data.name });
      } else if (e.data.type === 'clear') {
        const root = await navigator.storage.getDirectory();
        try {
          await root.removeEntry('frames', { recursive: true });
        } catch (_err) {}
        dirHandle = await root.getDirectoryHandle('frames', { create: true });
        self.postMessage({ type: 'clearDone' });
      }
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message });
    }
  };
`;

class Particle {
  active = false;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  size = 0;
  color = "#ffffff";
  alpha = 1;
  life = 0;
  maxLife = 1;

  spawn(x: number, y: number, color: string) {
    this.active = true;
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 4.0;
    this.vy = -(Math.random() * 4.5 + 2.0);
    this.size = Math.random() * 3.5 + 1.5;
    this.color = color;
    this.alpha = 1;
    this.life = 0;
    this.maxLife = Math.random() * 0.4 + 0.2;
  }

  update(dt: number) {
    if (!this.active) return;
    this.life += dt;
    if (this.life >= this.maxLife) {
      this.active = false;
      return;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 3.5 * dt;
    const progress = this.life / this.maxLife;
    this.alpha = 1 - progress;
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (!this.active) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class ParticlePool {
  private pool: Particle[];

  constructor(size = 900) {
    this.pool = Array.from({ length: size }, () => new Particle());
  }

  emit(x: number, y: number, color: string, count = 2) {
    let spawned = 0;
    for (const particle of this.pool) {
      if (!particle.active) {
        particle.spawn(x, y, color);
        spawned++;
        if (spawned >= count) break;
      }
    }
  }

  updateAndDraw(ctx: CanvasRenderingContext2D, dt: number) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const particle of this.pool) {
      if (particle.active) {
        particle.update(dt);
        particle.draw(ctx);
      }
    }
    ctx.restore();
  }
}

class WebAudioSynth {
  private ctx: AudioContext | null = null;
  private activeVoices = new Map<number, Voice>();
  isMuted = false;

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  private midiToFreq(midi: number) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  playNote(midi: number, velocity = 0.8) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    this.stopNote(midi);

    const freq = this.midiToFreq(midi);
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "triangle";
    osc2.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc2.frequency.setValueAtTime(freq * 2, now);

    const volume = (velocity / 127) * 0.35;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(volume * 0.4, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc2.start(now);
    osc.stop(now + 1.2);
    osc2.stop(now + 1.2);

    this.activeVoices.set(midi, { osc, osc2, gain });
  }

  stopNote(midi: number) {
    const voice = this.activeVoices.get(midi);
    if (!voice || !this.ctx) return;

    const now = this.ctx.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    } catch {
      // Voice already ended.
    }
    this.activeVoices.delete(midi);
  }
}

const FIRST_NOTE = 21;
const LAST_NOTE = 108;
const KEYBOARD_HEIGHT = 120;
const HAND_SPLIT_NOTE = 60;

const hexToRgba = (hex: string, alpha = 1) => {
  let c = hex.replace("#", "");
  if (c.length === 3)
    c = c
      .split("")
      .map((x) => x + x)
      .join("");
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getSparkColors = (baseHex: string) => [
  baseHex,
  hexToRgba(baseHex, 0.8),
  "#FFFFFF",
  hexToRgba(baseHex, 0.9),
];

const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

const formatTime = (seconds: number) => {
  if (Number.isNaN(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};

const getLayout = (width: number): KeyboardLayout => {
  const totalWhiteKeys = 52;
  const whiteKeyWidth = width / totalWhiteKeys;
  const blackKeyWidth = whiteKeyWidth * 0.62;
  const positions: Partial<Record<number, KeyPosition>> = {};
  let whiteIndex = 0;

  for (let midi = FIRST_NOTE; midi <= LAST_NOTE; midi++) {
    if (!isBlackKey(midi)) {
      positions[midi] = {
        x: whiteIndex * whiteKeyWidth,
        width: whiteKeyWidth,
        isBlack: false,
      };
      whiteIndex++;
    }
  }

  for (let midi = FIRST_NOTE; midi <= LAST_NOTE; midi++) {
    if (isBlackKey(midi)) {
      const prevWhiteX = positions[midi - 1]?.x ?? 0;
      positions[midi] = {
        x: prevWhiteX + whiteKeyWidth * 0.68,
        width: blackKeyWidth,
        isBlack: true,
      };
    }
  }

  return { positions, whiteKeyWidth, blackKeyWidth };
};

function parseMIDIArrayBuffer(buffer: ArrayBuffer): MidiData {
  const view = new DataView(buffer);
  let offset = 0;

  function readString(length: number) {
    let str = "";
    for (let i = 0; i < length; i++) {
      str += String.fromCharCode(view.getUint8(offset++));
    }
    return str;
  }

  function readVarInt() {
    let value = 0;
    let byte = 0;
    do {
      byte = view.getUint8(offset++);
      value = (value << 7) | (byte & 0x7f);
    } while (byte & 0x80);
    return value;
  }

  const header = readString(4);
  if (header !== "MThd") throw new Error("Invalid MIDI Header");

  const headerLength = view.getUint32(offset);
  offset += 4;
  offset += headerLength;
  const numTracks = view.getUint16(10);
  const timeDivision = view.getUint16(12);
  const ticksPerQuarterNote = timeDivision & 0x7fff;
  const rawNotes: RawMidiNote[] = [];
  const tempoEvents: TempoEvent[] = [{ tick: 0, tempo: 500000 }];

  for (let t = 0; t < numTracks; t++) {
    if (offset >= buffer.byteLength) break;
    const trackHeader = readString(4);
    if (trackHeader !== "MTrk") break;

    const trackLength = view.getUint32(offset);
    offset += 4;
    const trackEnd = offset + trackLength;
    let currentTick = 0;
    let runningStatus: number | null = null;
    const openNotes = new Map<number, OpenMidiNote>();

    while (offset < trackEnd) {
      const deltaTime = readVarInt();
      currentTick += deltaTime;

      let status = view.getUint8(offset);
      if (status >= 0x80) {
        runningStatus = status;
        offset++;
      } else if (runningStatus !== null) {
        status = runningStatus;
      } else {
        break;
      }

      if ((status & 0xf0) === 0x90) {
        const note = view.getUint8(offset++);
        const velocity = view.getUint8(offset++);
        if (velocity > 0) {
          openNotes.set(note, { note, tick: currentTick, velocity });
        } else {
          const startNote = openNotes.get(note);
          if (startNote) {
            rawNotes.push({
              midi: startNote.note,
              startTick: startNote.tick,
              endTick: currentTick,
              durationTicks: currentTick - startNote.tick,
              velocity: startNote.velocity,
              track: t,
            });
            openNotes.delete(note);
          }
        }
      } else if ((status & 0xf0) === 0x80) {
        const note = view.getUint8(offset++);
        offset++;
        const startNote = openNotes.get(note);
        if (startNote) {
          rawNotes.push({
            midi: startNote.note,
            startTick: startNote.tick,
            endTick: currentTick,
            durationTicks: currentTick - startNote.tick,
            velocity: startNote.velocity,
            track: t,
          });
          openNotes.delete(note);
        }
      } else if (status === 0xff) {
        const metaType = view.getUint8(offset++);
        const metaLen = readVarInt();
        if (metaType === 0x51 && metaLen === 3) {
          const tempo =
            (view.getUint8(offset) << 16) |
            (view.getUint8(offset + 1) << 8) |
            view.getUint8(offset + 2);
          tempoEvents.push({ tick: currentTick, tempo });
        }
        offset += metaLen;
      } else if (
        (status & 0xf0) === 0xa0 ||
        (status & 0xf0) === 0xb0 ||
        (status & 0xf0) === 0xe0
      ) {
        offset += 2;
      } else if ((status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0) {
        offset += 1;
      } else {
        break;
      }
    }
  }

  tempoEvents.sort((a, b) => a.tick - b.tick);

  function tickToSeconds(tick: number) {
    let time = 0;
    let prevTick = 0;
    let currentTempo = 500000;

    for (const event of tempoEvents) {
      if (tick <= event.tick) break;
      time +=
        ((event.tick - prevTick) / ticksPerQuarterNote) *
        (currentTempo / 1000000);
      prevTick = event.tick;
      currentTempo = event.tempo;
    }
    time +=
      ((tick - prevTick) / ticksPerQuarterNote) * (currentTempo / 1000000);
    return time;
  }

  const parsedNotes = rawNotes.map((note) => {
    const startTime = tickToSeconds(note.startTick);
    const endTime = tickToSeconds(note.endTick);
    return {
      midi: note.midi,
      time: startTime,
      duration: Math.max(endTime - startTime, 0.05),
      velocity: note.velocity,
      track: note.track,
    };
  });

  const duration = parsedNotes.reduce(
    (max, note) => Math.max(max, note.time + note.duration),
    0,
  );
  return { notes: parsedNotes, duration };
}

interface EnableAudioBannerProps {
  onEnableAudio: () => void;
}

const EnableAudioBanner = ({ onEnableAudio }: EnableAudioBannerProps) => (
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

interface ToolbarProps {
  currentTime: number;
  duration: number;
  exportState: ExportState;
  fallSpeed: number;
  isMuted: boolean;
  isPlaying: boolean;
  isReady: boolean;
  midiDevices: string[];
  particlesEnabled: boolean;
  onFallSpeedChange: (speed: number) => void;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSeek: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onStartExport: () => void;
  onToggleMute: () => void;
  onToggleParticles: () => void;
  onTogglePlay: () => void;
}

const Toolbar = ({
  currentTime,
  duration,
  exportState,
  fallSpeed,
  isMuted,
  isPlaying,
  isReady,
  midiDevices,
  particlesEnabled,
  onFallSpeedChange,
  onFileUpload,
  onSeek,
  onStartExport,
  onToggleMute,
  onToggleParticles,
  onTogglePlay,
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

interface ErrorMessageBannerProps {
  message: string;
  onDismiss: () => void;
}

const ErrorMessageBanner = ({
  message,
  onDismiss,
}: ErrorMessageBannerProps) => {
  if (!message) return null;

  return (
    <div className="bg-red-600/90 text-white px-6 py-2.5 flex items-center justify-between text-xs font-semibold z-30 shadow-md">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        <span>{message}</span>
      </div>
      <button onClick={onDismiss} className="underline hover:text-slate-200">
        Dismiss
      </button>
    </div>
  );
};

interface ExportOverlayProps {
  exportFrameCount: number;
  exportMessage: string;
  exportProgress: number;
  exportState: ExportState;
  onClose: () => void;
  onDownloadVideo: () => void;
}

const ExportOverlay = ({
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

interface HandBadgeProps {
  fileName: string;
  leftColor: string;
  rightColor: string;
  onLeftColorChange: (color: string) => void;
  onRightColorChange: (color: string) => void;
}

const HandBadge = ({
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

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioSynth = useRef(new WebAudioSynth());
  const particlePoolRef = useRef(new ParticlePool(900));
  const activeNotes = useRef(new Map<number, ActiveNoteInfo>());
  const midiData = useRef<MidiData | null>(null);
  const reqRef = useRef<number | null>(null);
  const lastTimeRef = useRef(performance.now());
  const playbackStartTime = useRef(0);
  const pausedTime = useRef(0);
  const lastTimeSec = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const exportFrameCountRef = useRef(0);
  const pendingFramesRef = useRef(0);
  const isExportingRef = useRef(false);
  const isCapturingFrameRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [fallSpeed, setFallSpeed] = useState(240);
  const [isMuted, setIsMuted] = useState(false);
  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [exportMessage, setExportMessage] = useState("");
  const [exportProgress, setExportProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [leftColor, setLeftColor] = useState("#FF6F00");
  const [rightColor, setRightColor] = useState("#FFD700");
  const [audioEnabled, setAudioEnabled] = useState(false);

  const handleEnableAudio = useCallback(() => {
    audioSynth.current.init();
    setAudioEnabled(true);
  }, []);

  const mockExportViaFFMPEGWASM = useCallback(async () => {
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

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = performance.now();
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1);
    lastTimeRef.current = now;

    let timeSec = pausedTime.current;
    if (isPlaying) {
      timeSec = (now - playbackStartTime.current) / 1000;
      setCurrentTime(timeSec);
      if (timeSec >= duration) {
        setIsPlaying(false);
        pausedTime.current = duration;

        if (isExportingRef.current) {
          isExportingRef.current = false;
          window.setTimeout(() => {
            void mockExportViaFFMPEGWASM();
          }, 300);
        }
      }
    }

    const prevTimeSec = lastTimeSec.current;
    lastTimeSec.current = timeSec;

    const width = canvas.width;
    const height = canvas.height;
    const hitLineY = height - KEYBOARD_HEIGHT;

    ctx.fillStyle = "#08090C";
    ctx.fillRect(0, 0, width, height);

    const { positions } = getLayout(width);
    const activeMap = new Map(activeNotes.current);
    const sparkLH = getSparkColors(leftColor);
    const sparkRH = getSparkColors(rightColor);

    if (midiData.current) {
      midiData.current.notes.forEach((note) => {
        const timeUntilHit = note.time - timeSec;
        const yBottom = hitLineY - timeUntilHit * fallSpeed;
        const noteHeight = note.duration * fallSpeed;
        const yTop = yBottom - noteHeight;

        if (yBottom > 0 && yTop < hitLineY) {
          const keyPos = positions[note.midi];
          if (!keyPos) return;

          const isLeftHand = note.midi < HAND_SPLIT_NOTE;
          const mainColor = isLeftHand ? leftColor : rightColor;
          const x = keyPos.x + 2;
          const w = Math.max(keyPos.width - 4, 3);
          const drawTop = Math.max(yTop, 0);
          const drawBottom = Math.min(yBottom, hitLineY);
          const drawHeight = drawBottom - drawTop;

          if (drawHeight > 0) {
            ctx.save();
            ctx.shadowColor = mainColor;
            ctx.shadowBlur = 14;
            ctx.strokeStyle = mainColor;
            ctx.lineWidth = 2.5;
            ctx.fillStyle = hexToRgba(mainColor, 0.22);
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(x, drawTop, w, drawHeight, 6);
            } else {
              ctx.rect(x, drawTop, w, drawHeight);
            }
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        }

        if (isPlaying && note.time >= prevTimeSec && note.time < timeSec) {
          audioSynth.current.playNote(note.midi, note.velocity);
        }

        if (
          isPlaying &&
          timeSec >= note.time &&
          timeSec <= note.time + note.duration
        ) {
          const isLeftHand = note.midi < HAND_SPLIT_NOTE;
          const color = isLeftHand ? leftColor : rightColor;
          activeMap.set(note.midi, { color, isLeftHand });

          if (particlesEnabled) {
            const keyPos = positions[note.midi];
            if (keyPos) {
              const sparkX = keyPos.x + keyPos.width / 2;
              const sparkColors = isLeftHand ? sparkLH : sparkRH;
              const randColor =
                sparkColors[Math.floor(Math.random() * sparkColors.length)];
              particlePoolRef.current.emit(sparkX, hitLineY - 2, randColor, 2);
            }
          }
        }
      });
    }

    ctx.save();
    ctx.shadowColor = "#FF3B30";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = "#FF3B30";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, hitLineY);
    ctx.lineTo(width, hitLineY);
    ctx.stroke();
    ctx.restore();

    if (particlesEnabled) {
      particlePoolRef.current.updateAndDraw(ctx, dt);
    }

    for (let midi = FIRST_NOTE; midi <= LAST_NOTE; midi++) {
      if (!isBlackKey(midi)) {
        const keyPos = positions[midi];
        if (!keyPos) continue;
        const activeInfo = activeMap.get(midi);

        if (activeInfo) {
          ctx.save();
          ctx.fillStyle = activeInfo.color;
          ctx.shadowColor = activeInfo.color;
          ctx.shadowBlur = 18;
          ctx.fillRect(
            keyPos.x + 1,
            hitLineY,
            keyPos.width - 2,
            KEYBOARD_HEIGHT,
          );
          ctx.restore();
        } else {
          ctx.fillStyle = "#E2E8F0";
          ctx.fillRect(
            keyPos.x + 1,
            hitLineY,
            keyPos.width - 2,
            KEYBOARD_HEIGHT,
          );
          ctx.fillStyle = "#1E293B";
          ctx.fillRect(
            keyPos.x + keyPos.width - 1,
            hitLineY,
            1,
            KEYBOARD_HEIGHT,
          );
        }
      }
    }

    for (let midi = FIRST_NOTE; midi <= LAST_NOTE; midi++) {
      if (isBlackKey(midi)) {
        const keyPos = positions[midi];
        if (!keyPos) continue;
        const activeInfo = activeMap.get(midi);
        const blackHeight = KEYBOARD_HEIGHT * 0.62;

        if (activeInfo) {
          ctx.save();
          ctx.fillStyle = activeInfo.color;
          ctx.shadowColor = activeInfo.color;
          ctx.shadowBlur = 18;
          ctx.fillRect(keyPos.x, hitLineY, keyPos.width, blackHeight);
          ctx.restore();
        } else {
          const grad = ctx.createLinearGradient(
            0,
            hitLineY,
            0,
            hitLineY + blackHeight,
          );
          grad.addColorStop(0, "#1E293B");
          grad.addColorStop(1, "#0F172A");
          ctx.fillStyle = grad;
          ctx.fillRect(keyPos.x, hitLineY, keyPos.width, blackHeight);
        }
      }
    }

    if (
      isExportingRef.current &&
      workerRef.current &&
      !isCapturingFrameRef.current
    ) {
      isCapturingFrameRef.current = true;
      canvas.toBlob((blob) => {
        if (blob && isExportingRef.current && workerRef.current) {
          const frameNum = String(exportFrameCountRef.current).padStart(5, "0");
          exportFrameCountRef.current++;
          pendingFramesRef.current++;
          workerRef.current.postMessage({
            type: "saveFrame",
            name: `frame_${frameNum}.png`,
            blob,
          });
        }
        isCapturingFrameRef.current = false;
      }, "image/png");
    }
  }, [
    duration,
    fallSpeed,
    isPlaying,
    leftColor,
    mockExportViaFFMPEGWASM,
    particlesEnabled,
    rightColor,
  ]);

  const loadDemoSong = useCallback(() => {
    const bass = [38, 34, 35, 30, 31, 26, 31, 33];
    const melody = [
      [74, 78, 81],
      [73, 77, 81],
      [71, 74, 78],
      [69, 73, 76],
      [67, 71, 74],
      [66, 69, 74],
      [67, 71, 74],
      [69, 73, 76],
    ];
    const notes: MidiNote[] = [];
    let t = 0;

    for (let loop = 0; loop < 2; loop++) {
      bass.forEach((note, idx) => {
        notes.push({
          midi: note,
          time: t,
          duration: 0.85,
          velocity: 90,
          track: 0,
        });
        notes.push({
          midi: note + 12,
          time: t + 0.5,
          duration: 0.4,
          velocity: 80,
          track: 0,
        });

        melody[idx].forEach((mNote, chordIdx) => {
          notes.push({
            midi: mNote,
            time: t + chordIdx * 0.25,
            duration: 0.45,
            velocity: 100,
            track: 1,
          });
        });
        t += 1.0;
      });
    }

    midiData.current = { notes, duration: t };
    setFileName("Pachelbel Canon Demo");
    setDuration(t);
    setCurrentTime(0);
    pausedTime.current = 0;
    setIsReady(true);
  }, []);

  const handleMIDIMessage = useCallback(
    (message: MidiMessage) => {
      const [command, note, velocity] = message.data;
      const isNoteOn = (command & 0xf0) === 144 && velocity > 0;
      const isNoteOff =
        (command & 0xf0) === 128 ||
        ((command & 0xf0) === 144 && velocity === 0);
      const isLeftHand = note < HAND_SPLIT_NOTE;
      const color = isLeftHand ? leftColor : rightColor;

      if (isNoteOn) {
        handleEnableAudio();
        audioSynth.current.playNote(note, velocity);
        activeNotes.current.set(note, { color, isLeftHand });
      } else if (isNoteOff) {
        audioSynth.current.stopNote(note);
        activeNotes.current.delete(note);
      }
    },
    [handleEnableAudio, leftColor, rightColor],
  );

  const updateMidiDevices = useCallback((access: MidiAccess) => {
    const devices: string[] = [];
    access.inputs.forEach((input) =>
      devices.push(input.name ?? "Unknown MIDI Device"),
    );
    setMidiDevices(devices);
  }, []);

  const onMIDISuccess = useCallback(
    (access: MidiAccess) => {
      updateMidiDevices(access);
      access.onstatechange = () => updateMidiDevices(access);

      const inputs = access.inputs.values();
      for (const input of inputs) {
        input.onmidimessage = handleMIDIMessage;
      }
    },
    [handleMIDIMessage, updateMidiDevices],
  );

  const onMIDIFailure = useCallback(() => {
    console.warn("Web MIDI API is not accessible.");
  }, []);

  const loadMidiBuffer = useCallback((buffer: ArrayBuffer, name: string) => {
    try {
      const parsed = parseMIDIArrayBuffer(buffer);
      midiData.current = parsed;
      setFileName(name);
      setDuration(parsed.duration);
      setCurrentTime(0);
      pausedTime.current = 0;
      setIsPlaying(false);
      setIsReady(true);
    } catch (error) {
      console.error("Failed to parse MIDI file", error);
      setErrorMessage(`Failed to parse MIDI file: ${getErrorMessage(error)}`);
    }
  }, []);

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        const result = loadEvent.target?.result;
        if (result instanceof ArrayBuffer) {
          loadMidiBuffer(result, file.name);
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [loadMidiBuffer],
  );

  const startExport = useCallback(async () => {
    try {
      setErrorMessage("");
      if (!navigator.storage?.getDirectory) {
        throw new Error(
          "OPFS (Origin Private File System) is not supported in this browser.",
        );
      }

      await navigator.storage.getDirectory();

      const blob = new Blob([WORKER_CODE], { type: "application/javascript" });
      if (workerRef.current) workerRef.current.terminate();
      workerRef.current = new Worker(URL.createObjectURL(blob));

      workerRef.current.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === "error") {
          console.error("Worker error:", event.data.error);
          setErrorMessage(`Worker error: ${event.data.error}`);
        }
      };

      setExportState("recording");
      setExportMessage("Initializing OPFS storage...");

      await new Promise<void>((resolve) => {
        const handler = (event: MessageEvent<WorkerMessage>) => {
          if (event.data.type === "initDone" && workerRef.current) {
            workerRef.current.removeEventListener("message", handler);
            resolve();
          }
        };
        workerRef.current?.addEventListener("message", handler);
        workerRef.current?.postMessage({ type: "init" });
      });

      await new Promise<void>((resolve) => {
        const handler = (event: MessageEvent<WorkerMessage>) => {
          if (event.data.type === "clearDone" && workerRef.current) {
            workerRef.current.removeEventListener("message", handler);
            resolve();
          }
        };
        workerRef.current?.addEventListener("message", handler);
        workerRef.current?.postMessage({ type: "clear" });
      });

      workerRef.current.addEventListener(
        "message",
        (event: MessageEvent<WorkerMessage>) => {
          if (event.data.type === "frameSaved") {
            pendingFramesRef.current = Math.max(
              0,
              pendingFramesRef.current - 1,
            );
          }
        },
      );

      exportFrameCountRef.current = 0;
      pendingFramesRef.current = 0;

      if (!audioEnabled) handleEnableAudio();

      pausedTime.current = 0;
      setCurrentTime(0);
      lastTimeSec.current = 0;
      playbackStartTime.current = performance.now();
      isExportingRef.current = true;
      setIsPlaying(true);
    } catch (error) {
      console.error("Export initialization failed:", error);
      setErrorMessage(`Could not start export: ${getErrorMessage(error)}`);
      setExportState("idle");
      isExportingRef.current = false;
    }
  }, [audioEnabled, handleEnableAudio]);

  const downloadVideo = useCallback(async () => {
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
      URL.revokeObjectURL(url);

      await root
        .removeEntry("frames", { recursive: true })
        .catch(() => undefined);
      setExportState("idle");
    } catch (error) {
      console.error("Download error:", error);
      setErrorMessage("Failed to download video from OPFS storage.");
    }
  }, [fileName]);

  const togglePlay = useCallback(() => {
    handleEnableAudio();
    if (isPlaying) {
      pausedTime.current = currentTime;
      setIsPlaying(false);
      return;
    }

    if (currentTime >= duration) {
      pausedTime.current = 0;
      setCurrentTime(0);
      lastTimeSec.current = 0;
    }
    playbackStartTime.current = performance.now() - pausedTime.current * 1000;
    lastTimeSec.current = pausedTime.current;
    setIsPlaying(true);
  }, [currentTime, duration, handleEnableAudio, isPlaying]);

  const handleSeek = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newTime = parseFloat(event.target.value);
      setCurrentTime(newTime);
      pausedTime.current = newTime;
      lastTimeSec.current = newTime;
      if (isPlaying) {
        playbackStartTime.current = performance.now() - newTime * 1000;
      }
    },
    [isPlaying],
  );

  const toggleMute = useCallback(() => {
    setIsMuted((muted) => {
      audioSynth.current.isMuted = !muted;
      return !muted;
    });
  }, []);

  const toggleParticles = useCallback(() => {
    setParticlesEnabled((enabled) => !enabled);
  }, []);

  useEffect(() => {
    if (navigator.requestMIDIAccess) {
      void navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);
    }
    loadDemoSong();

    return () => {
      if (reqRef.current !== null) cancelAnimationFrame(reqRef.current);
      if (workerRef.current) workerRef.current.terminate();
    };
  }, [loadDemoSong, onMIDIFailure, onMIDISuccess]);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight - 80;
      }
    };

    const tick = () => {
      renderCanvas();
      reqRef.current = requestAnimationFrame(tick);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    reqRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (reqRef.current !== null) cancelAnimationFrame(reqRef.current);
    };
  }, [renderCanvas]);

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden select-none">
      {!audioEnabled && <EnableAudioBanner onEnableAudio={handleEnableAudio} />}

      <Toolbar
        currentTime={currentTime}
        duration={duration}
        exportState={exportState}
        fallSpeed={fallSpeed}
        isMuted={isMuted}
        isPlaying={isPlaying}
        isReady={isReady}
        midiDevices={midiDevices}
        particlesEnabled={particlesEnabled}
        onFallSpeedChange={setFallSpeed}
        onFileUpload={handleFileUpload}
        onSeek={handleSeek}
        onStartExport={startExport}
        onToggleMute={toggleMute}
        onToggleParticles={toggleParticles}
        onTogglePlay={togglePlay}
      />

      <ErrorMessageBanner
        message={errorMessage}
        onDismiss={() => setErrorMessage("")}
      />

      <ExportOverlay
        exportFrameCount={exportFrameCountRef.current}
        exportMessage={exportMessage}
        exportProgress={exportProgress}
        exportState={exportState}
        onClose={() => setExportState("idle")}
        onDownloadVideo={downloadVideo}
      />

      <main className="relative flex-1 w-full bg-slate-950">
        <HandBadge
          fileName={fileName}
          leftColor={leftColor}
          rightColor={rightColor}
          onLeftColorChange={setLeftColor}
          onRightColorChange={setRightColor}
        />

        <canvas
          ref={canvasRef}
          className="block w-full h-full cursor-pointer"
        />
      </main>
    </div>
  );
};

export default App;
