import React, { useCallback, useEffect, useRef, useState } from "react";
import { WebAudioSynth } from "./features/audio/WebAudioSynth";
import { ParticlePool } from "./features/canvas/Particles";
import { pianoConstants } from "./utils/layout";
import {
  getLayout,
  getSparkColors,
  hexToRgba,
  isBlackKey,
} from "./features/layout/layoutUtils";
import { parseMIDIArrayBuffer } from "./features/audio/midi";
import { EnableAudioBanner } from "./components/EnableAudioBanner";
import { Toolbar } from "./components/Toolbar";
import { ErrorMessageBanner } from "./components/ErrorMessageBanner";
import { ExportOverlay } from "./components/ExportOverlay";
import { HandBadge } from "./components/HandBadge";
import { getErrorMessage } from "./utils/error";
import { downloadVideoFromOPFS, useExport } from "./hooks/useExport";
import { exportConfig } from "./features/export/FFMPEGVideoExporter";
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

const { FIRST_NOTE, LAST_NOTE, KEYBOARD_HEIGHT, HAND_SPLIT_NOTE } =
  pianoConstants;
// const EXPORT_FPS = exportConfig.fps;
const EXPORT_FRAME_INTERVAL_MS = exportConfig.frameIntervalMs;

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
  const lastExportCaptureTimeRef = useRef(0);
  const frameSavedHandlerRef = useRef<
    ((event: MessageEvent<WorkerMessage>) => void) | null
  >(null);
  const currentTimeRef = useRef(0);
  const lastUIUpdateRef = useRef(0);
  const isPlayingRef = useRef(false);
  const fallSpeedRef = useRef(240);
  const leftColorRef = useRef("#FF6F00");
  const rightColorRef = useRef("#FFD700");
  const leftColorRgbaRef = useRef(hexToRgba("#FF6F00", 0.22));
  const rightColorRgbaRef = useRef(hexToRgba("#FFD700", 0.22));
  const leftSparkColorsRef = useRef(getSparkColors("#FF6F00"));
  const rightSparkColorsRef = useRef(getSparkColors("#FFD700"));
  const particlesEnabledRef = useRef(true);
  const durationRef = useRef(0);
  const exportViaFFMPEGWASMRef = useRef<() => Promise<void>>(
    async () => undefined,
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [fallSpeed, setFallSpeed] = useState(240);
  const [isMuted, setIsMuted] = useState(false);
  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [leftColor, setLeftColor] = useState("#FF6F00");
  const [rightColor, setRightColor] = useState("#FFD700");
  const [audioEnabled, setAudioEnabled] = useState(false);

  const {
    exportState,
    exportMessage,
    exportProgress,
    errorMessage,
    exportViaFFMPEGWASM,
    setErrorMessage,
    setExportState,
    setExportMessage,
  } = useExport();

  const handleEnableAudio = useCallback(() => {
    audioSynth.current.init();
    setAudioEnabled(true);
  }, []);

  useEffect(() => {
    exportViaFFMPEGWASMRef.current = exportViaFFMPEGWASM;
  }, [exportViaFFMPEGWASM]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    fallSpeedRef.current = fallSpeed;
  }, [fallSpeed]);

  useEffect(() => {
    leftColorRef.current = leftColor;
    leftColorRgbaRef.current = hexToRgba(leftColor, 0.22);
    leftSparkColorsRef.current = getSparkColors(leftColor);
  }, [leftColor]);

  useEffect(() => {
    rightColorRef.current = rightColor;
    rightColorRgbaRef.current = hexToRgba(rightColor, 0.22);
    rightSparkColorsRef.current = getSparkColors(rightColor);
  }, [rightColor]);

  useEffect(() => {
    particlesEnabledRef.current = particlesEnabled;
  }, [particlesEnabled]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = performance.now();
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1);
    lastTimeRef.current = now;

    const isPlaying = isPlayingRef.current;
    const fallSpeed = fallSpeedRef.current;
    const leftColor = leftColorRef.current;
    const rightColor = rightColorRef.current;
    const particlesEnabled = particlesEnabledRef.current;
    const duration = durationRef.current;

    let timeSec = pausedTime.current;
    if (isPlaying) {
      timeSec = (now - playbackStartTime.current) / 1000;
      currentTimeRef.current = timeSec;

      if (now - lastUIUpdateRef.current > 100) {
        setCurrentTime(timeSec);
        lastUIUpdateRef.current = now;
      }

      if (timeSec >= duration) {
        isPlayingRef.current = false;
        setIsPlaying(false);
        pausedTime.current = duration;
        currentTimeRef.current = duration;
        setCurrentTime(duration);

        // Start encoding after all async canvas.toBlob frame writes have landed
        // in OPFS. Without this wait, FFmpeg can race the worker and encode an
        // incomplete image sequence.
        if (isExportingRef.current) {
          isExportingRef.current = false;
          window.setTimeout(() => {
            const waitForFrameWrites = async () => {
              const start = performance.now();
              while (
                (pendingFramesRef.current > 0 || isCapturingFrameRef.current) &&
                performance.now() - start < 10000
              ) {
                await new Promise((resolve) => window.setTimeout(resolve, 50));
              }

              await exportViaFFMPEGWASMRef.current();
            };

            void waitForFrameWrites();
          }, 300);
        }
      }
    } else {
      currentTimeRef.current = timeSec;
    }

    const prevTimeSec = lastTimeSec.current;
    lastTimeSec.current = timeSec;

    const width = canvas.width;
    const height = canvas.height;
    const hitLineY = height - KEYBOARD_HEIGHT;

    ctx.fillStyle = "#08090C";
    ctx.fillRect(0, 0, width, height);

    const { positions } = getLayout(width);
    const liveActiveMap = activeNotes.current;
    const playbackActiveMap = new Map<number, ActiveNoteInfo>();
    const sparkLH = leftSparkColorsRef.current;
    const sparkRH = rightSparkColorsRef.current;
    const visibleTimePast = timeSec - hitLineY / fallSpeed;
    const visibleTimeFuture = timeSec + hitLineY / fallSpeed;

    if (midiData.current) {
      const notes = midiData.current.notes;
      let startIdx = 0;

      while (
        startIdx < notes.length &&
        notes[startIdx].time + notes[startIdx].duration < visibleTimePast
      ) {
        startIdx++;
      }

      for (let i = startIdx; i < notes.length; i++) {
        const note = notes[i];
        if (note.time > visibleTimeFuture) break;

        const timeUntilHit = note.time - timeSec;
        const yBottom = hitLineY - timeUntilHit * fallSpeed;
        const noteHeight = note.duration * fallSpeed;
        const yTop = yBottom - noteHeight;

        if (yBottom > 0 && yTop < hitLineY) {
          const keyPos = positions[note.midi];
          if (!keyPos) continue;

          const isLeftHand = note.midi < HAND_SPLIT_NOTE;
          const mainColor = isLeftHand ? leftColor : rightColor;
          const x = keyPos.x + 2;
          const w = Math.max(keyPos.width - 4, 3);
          const drawTop = Math.max(yTop, 0);
          const drawBottom = Math.min(yBottom, hitLineY);
          const drawHeight = drawBottom - drawTop;

          if (drawHeight > 0) {
            ctx.strokeStyle = mainColor;
            ctx.lineWidth = 2.5;
            ctx.fillStyle = isLeftHand
              ? leftColorRgbaRef.current
              : rightColorRgbaRef.current;
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(x, drawTop, w, drawHeight, 6);
            } else {
              ctx.rect(x, drawTop, w, drawHeight);
            }
            ctx.fill();
            ctx.stroke();
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
          playbackActiveMap.set(note.midi, { color, isLeftHand });

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
      }
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

    const getActiveInfo = (midi: number) =>
      liveActiveMap.get(midi) ?? playbackActiveMap.get(midi);

    for (let midi = FIRST_NOTE; midi <= LAST_NOTE; midi++) {
      if (!isBlackKey(midi)) {
        const keyPos = positions[midi];
        if (!keyPos) continue;
        const activeInfo = getActiveInfo(midi);

        if (activeInfo) {
          ctx.fillStyle = activeInfo.color;
          ctx.fillRect(
            keyPos.x + 1,
            hitLineY,
            keyPos.width - 2,
            KEYBOARD_HEIGHT,
          );
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

    const blackHeight = KEYBOARD_HEIGHT * 0.62;
    const blackKeyGrad = ctx.createLinearGradient(
      0,
      hitLineY,
      0,
      hitLineY + blackHeight,
    );
    blackKeyGrad.addColorStop(0, "#1E293B");
    blackKeyGrad.addColorStop(1, "#0F172A");

    for (let midi = FIRST_NOTE; midi <= LAST_NOTE; midi++) {
      if (isBlackKey(midi)) {
        const keyPos = positions[midi];
        if (!keyPos) continue;
        const activeInfo = getActiveInfo(midi);

        if (activeInfo) {
          ctx.fillStyle = activeInfo.color;
          ctx.fillRect(keyPos.x, hitLineY, keyPos.width, blackHeight);
        } else {
          ctx.fillStyle = blackKeyGrad;
          ctx.fillRect(keyPos.x, hitLineY, keyPos.width, blackHeight);
        }
      }
    }

    // TODO: refactor to go into useExport hook
    if (
      isExportingRef.current &&
      workerRef.current &&
      !isCapturingFrameRef.current &&
      now - lastExportCaptureTimeRef.current >= EXPORT_FRAME_INTERVAL_MS
    ) {
      lastExportCaptureTimeRef.current = now;
      isCapturingFrameRef.current = true;
      canvas.toBlob((blob) => {
        if (blob && isExportingRef.current && workerRef.current) {
          const frameNum = String(exportFrameCountRef.current).padStart(5, "0");
          exportFrameCountRef.current++;
          pendingFramesRef.current++;
          workerRef.current.postMessage({
            type: "saveFrame",
            name: `frame_${frameNum}.${exportConfig.frameExtension}`,
            blob,
          });
        }
        isCapturingFrameRef.current = false;
      }, `image/${exportConfig.frameExtension}`);
    }
  }, []);

  // TODO: refactor this, put in features/audio/demosong.ts
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

    notes.sort((a, b) => a.time - b.time);
    midiData.current = { notes, duration: t };
    setFileName("Pachelbel Canon Demo");
    setDuration(t);
    durationRef.current = t;
    setCurrentTime(0);
    currentTimeRef.current = 0;
    pausedTime.current = 0;
    lastTimeSec.current = 0;
    setIsReady(true);
  }, []);

  // TODO: refactor these methods into its own useMidi.ts hook
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

  const loadMidiBuffer = useCallback(
    (buffer: ArrayBuffer, name: string) => {
      try {
        const parsed = parseMIDIArrayBuffer(buffer);
        midiData.current = parsed;
        setFileName(name);
        setDuration(parsed.duration);
        durationRef.current = parsed.duration;
        setCurrentTime(0);
        currentTimeRef.current = 0;
        pausedTime.current = 0;
        lastTimeSec.current = 0;
        isPlayingRef.current = false;
        setIsPlaying(false);
        setIsReady(true);
      } catch (error) {
        console.error("Failed to parse MIDI file", error);
        setErrorMessage(`Failed to parse MIDI file: ${getErrorMessage(error)}`);
      }
    },
    [setErrorMessage],
  );

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

  /**
   * TODO: refactor this to include export ref and filehandler ref and worker code
   * all in the useExport hook, refactor the state in that to use useReducer as well.
   */
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
      if (workerRef.current && frameSavedHandlerRef.current) {
        workerRef.current.removeEventListener(
          "message",
          frameSavedHandlerRef.current,
        );
        frameSavedHandlerRef.current = null;
      }
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

      frameSavedHandlerRef.current = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === "frameSaved") {
          pendingFramesRef.current = Math.max(0, pendingFramesRef.current - 1);
        }
      };
      workerRef.current.addEventListener(
        "message",
        frameSavedHandlerRef.current,
      );

      exportFrameCountRef.current = 0;
      pendingFramesRef.current = 0;
      lastExportCaptureTimeRef.current = 0;

      if (!audioEnabled) handleEnableAudio();

      pausedTime.current = 0;
      currentTimeRef.current = 0;
      setCurrentTime(0);
      lastTimeSec.current = 0;
      playbackStartTime.current = performance.now();
      isExportingRef.current = true;
      isPlayingRef.current = true;
      setIsPlaying(true);
    } catch (error) {
      console.error("Export initialization failed:", error);
      setErrorMessage(`Could not start export: ${getErrorMessage(error)}`);
      setExportState("idle");
      isExportingRef.current = false;
    }
  }, [
    audioEnabled,
    handleEnableAudio,
    setErrorMessage,
    setExportMessage,
    setExportState,
  ]);

  // TODO: refactor this to come straight from the useExport hook, with useReducer
  const downloadVideo = useCallback(async () => {
    const downloadSuccess = await downloadVideoFromOPFS(fileName);
    if (downloadSuccess) {
      setExportState("idle");
    } else {
      setErrorMessage("Failed to download video from OPFS storage.");
    }
  }, [fileName, setErrorMessage, setExportState]);

  const togglePlay = useCallback(() => {
    handleEnableAudio();
    if (isPlayingRef.current) {
      pausedTime.current = currentTimeRef.current;
      isPlayingRef.current = false;
      setIsPlaying(false);
      return;
    }

    if (currentTimeRef.current >= durationRef.current) {
      pausedTime.current = 0;
      currentTimeRef.current = 0;
      setCurrentTime(0);
      lastTimeSec.current = 0;
    }
    playbackStartTime.current = performance.now() - pausedTime.current * 1000;
    lastTimeSec.current = pausedTime.current;
    isPlayingRef.current = true;
    setIsPlaying(true);
  }, [handleEnableAudio]);

  const handleSeek = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newTime = parseFloat(event.target.value);
      setCurrentTime(newTime);
      currentTimeRef.current = newTime;
      pausedTime.current = newTime;
      lastTimeSec.current = newTime;
      if (isPlayingRef.current) {
        playbackStartTime.current = performance.now() - newTime * 1000;
      }
    },
    [],
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
      if (workerRef.current && frameSavedHandlerRef.current) {
        workerRef.current.removeEventListener(
          "message",
          frameSavedHandlerRef.current,
        );
      }
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
