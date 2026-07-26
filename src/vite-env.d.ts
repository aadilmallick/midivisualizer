/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

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
