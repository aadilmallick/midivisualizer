import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
// Using CDN for Midi to avoid build issues
// import { Midi } from '@tonejs/midi';
import {
  AlertCircle,
  Loader,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Upload,
  Volume2,
} from "lucide-react";

// --- Constants & Config ---
const VISUALIZER_HEIGHT = 600;
const KEYBOARD_HEIGHT = 120;
const NOTE_FALL_SPEED = 150; // Pixels per second
const KEY_COUNT = 88;
const FIRST_NOTE = 21; // A0
const LAST_NOTE = 108; // C8

// Color Palette
const COLORS = {
  background: "#0f172a", // Slate 900
  whiteKey: "#f8fafc", // Slate 50
  blackKey: "#1e293b", // Slate 800
  activeWhite: "#3b82f6", // Blue 500
  activeBlack: "#2563eb", // Blue 600
  fallingNote: "#60a5fa", // Blue 400
  gridLines: "#1e293b",
};

const App = () => {
  // --- State ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [loading, setLoading] = useState(false);
  const [midiAccess, setMidiAccess] = useState(null);
  const [error, setError] = useState(null);
  const [midiLibLoaded, setMidiLibLoaded] = useState(false);

  // New States for Audio & Seeking
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0); // Used for text display
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);

  // --- Refs ---
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const synth = useRef(null);
  const midiData = useRef(null);

  // We separate active notes into "Realtime" (played by user) and "Playback" (from file)
  // to ensure seeking works correctly without needing to rely on Tone.Draw callbacks
  const realtimeActiveNotes = useRef(new Set());
  const playbackActiveNotes = useRef(new Set());

  const reqRef = useRef(); // Animation frame ID
  const progressBarRef = useRef(null); // Ref for direct DOM manipulation of slider

  // --- Initialization ---
  useEffect(() => {
    // 1. Setup Synth
    synth.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 1 },
      volume: -10,
    }).toDestination();

    // 2. Setup Web MIDI
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess()
        .then(onMIDISuccess)
        .catch((err) => console.warn("MIDI Access Failed:", err));
    }

    // 3. Load @tonejs/midi from CDN
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@tonejs/midi";
    script.async = true;
    script.onload = () => {
      console.log("Midi parser loaded");
      setMidiLibLoaded(true);
    };
    script.onerror = () => {
      setError("Failed to load MIDI parser library.");
    };
    document.body.appendChild(script);

    // 4. Handle Resize
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      if (synth.current) synth.current.dispose();
      cancelAnimationFrame(reqRef.current);
      Tone.Transport.stop();
      Tone.Transport.cancel();
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  // --- Audio Context Handling ---
  const enableAudio = async () => {
    await Tone.start();
    setAudioEnabled(true);
  };

  // --- MIDI Device Handlers ---
  const onMIDISuccess = (access) => {
    setMidiAccess(access);
    const inputs = access.inputs.values();
    for (let input of inputs) {
      input.onmidimessage = getMIDIMessage;
    }
  };

  const getMIDIMessage = (message) => {
    // Removed the audioEnabled check here to prevent stale closure issues.
    // Visuals will work immediately, and audio will work once Tone context is running.

    const [command, note, velocity] = message.data;
    const cmd = command >> 4;

    // Note On (144)
    if (cmd === 9 && velocity > 0) {
      triggerRealtimeAttack(note, velocity / 127);
    } // Note Off (128)
    else if (cmd === 8 || (cmd === 9 && velocity === 0)) {
      triggerRealtimeRelease(note);
    }
  };

  const triggerRealtimeAttack = (note, velocity) => {
    if (synth.current && Tone.context.state === "running") {
      synth.current.triggerAttack(
        Tone.Frequency(note, "midi").toNote(),
        Tone.now(),
        velocity,
      );
    }
    realtimeActiveNotes.current.add(note);
  };

  const triggerRealtimeRelease = (note) => {
    if (synth.current && Tone.context.state === "running") {
      synth.current.triggerRelease(Tone.Frequency(note, "midi").toNote());
    }
    realtimeActiveNotes.current.delete(note);
  };

  // --- File Upload ---
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!midiLibLoaded || !window.Midi) {
      setError("MIDI parser library not yet loaded. Please wait a moment.");
      return;
    }

    setLoading(true);
    setFileName(file.name);
    setIsPlaying(false);
    Tone.Transport.stop();
    Tone.Transport.cancel();

    realtimeActiveNotes.current.clear();
    playbackActiveNotes.current.clear();

    try {
      // Auto-enable audio on upload if not already
      if (!audioEnabled) {
        await enableAudio();
      }

      const arrayBuffer = await file.arrayBuffer();
      const midi = new window.Midi(arrayBuffer);
      midiData.current = midi;
      setDuration(midi.duration);

      // Schedule Tone.js events purely for Audio
      // We handle Visuals in the draw loop for better seek performance
      midi.tracks.forEach((track) => {
        track.notes.forEach((note) => {
          Tone.Transport.schedule((time) => {
            synth.current.triggerAttackRelease(
              note.name,
              note.duration,
              time,
              note.velocity,
            );
          }, note.time);
        });
      });

      setIsReady(true);
      setLoading(false);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Failed to parse MIDI file.");
      setLoading(false);
    }
  };

  // --- Transport Controls ---
  const togglePlay = async () => {
    if (!audioEnabled) await enableAudio();

    if (isPlaying) {
      Tone.Transport.pause();
    } else {
      Tone.Transport.start();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    Tone.Transport.seconds = newTime;
    setCurrentTime(newTime);

    // Release any stuck synthesizer notes
    if (synth.current) {
      synth.current.releaseAll();
    }
  };

  const handleSeekStart = () => {
    setIsDraggingSlider(true);
    // Optional: Pause while seeking for smoother UX
  };

  const handleSeekEnd = () => {
    setIsDraggingSlider(false);
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  // --- Canvas Logic ---
  const isBlack = (note) => {
    const n = note % 12;
    return [1, 3, 6, 8, 10].includes(n);
  };

  const getKeyGeometry = (canvasWidth) => {
    const whiteKeyCount = 52;
    const whiteKeyWidth = canvasWidth / whiteKeyCount;
    const blackKeyWidth = whiteKeyWidth * 0.65;
    return { whiteKeyWidth, blackKeyWidth };
  };

  const getNoteX = (note, whiteKeyWidth) => {
    let whiteKeyIndex = 0;
    for (let i = FIRST_NOTE; i < note; i++) {
      if (!isBlack(i)) whiteKeyIndex++;
    }
    const offset = !isBlack(note) ? 0 : (whiteKeyWidth * 0.6);
    return (whiteKeyIndex * whiteKeyWidth) + offset;
  };

  // Main Draw Loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const { whiteKeyWidth, blackKeyWidth } = getKeyGeometry(width);

    // Update Slider Sync (if not dragging)
    const now = Tone.Transport.seconds;
    if (!isDraggingSlider && progressBarRef.current && isReady) {
      progressBarRef.current.value = now;
      // Update text display occasionally (every 10 frames roughly or just let react handle it?
      // Direct ref update is better for perf, but state for text is fine if we accept 60fps renders)
      // We'll update React state for the time display here, but maybe throttle it in a real app.
      // For this MVP, we will update it every frame.
      setCurrentTime(now);
    }

    // 1. Clear
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    // 2. Process MIDI Data for Visuals (Falling Notes + Active Playback Notes)
    playbackActiveNotes.current.clear(); // Reset frame's active playback notes

    if (midiData.current) {
      const viewWindow = (height - KEYBOARD_HEIGHT) / NOTE_FALL_SPEED;

      midiData.current.tracks.forEach((track) => {
        track.notes.forEach((note) => {
          // A. Identify if note is currently playing (for keyboard highlight)
          if (now >= note.time && now < note.time + note.duration) {
            playbackActiveNotes.current.add(note.midi);
          }

          // B. Draw Falling Note (Future)
          const timeUntilHit = note.time - now;
          if (timeUntilHit < viewWindow && timeUntilHit + note.duration > 0) {
            const y = (height - KEYBOARD_HEIGHT) -
              (timeUntilHit * NOTE_FALL_SPEED);
            const noteHeight = note.duration * NOTE_FALL_SPEED;

            const x = getNoteX(note.midi, whiteKeyWidth);
            const w = isBlack(note.midi) ? blackKeyWidth : whiteKeyWidth - 2;

            ctx.fillStyle = COLORS.fallingNote;
            // Simple opacity fade based on height
            ctx.globalAlpha = 0.8;
            ctx.fillRect(x, y - noteHeight, w, noteHeight);
            ctx.globalAlpha = 1.0;
          }
        });
      });
    }

    // 3. Draw Keyboard
    const keyTop = height - KEYBOARD_HEIGHT;

    // Draw White Keys
    let currentX = 0;
    for (let i = FIRST_NOTE; i <= LAST_NOTE; i++) {
      if (!isBlack(i)) {
        // Active if pressed by user OR playing from file
        const isActive = realtimeActiveNotes.current.has(i) ||
          playbackActiveNotes.current.has(i);

        ctx.fillStyle = isActive ? COLORS.activeWhite : COLORS.whiteKey;
        ctx.fillRect(currentX, keyTop, whiteKeyWidth - 1, KEYBOARD_HEIGHT);

        // 3D Shadow
        if (!isActive) {
          ctx.fillStyle = "#cbd5e1";
          ctx.fillRect(
            currentX,
            keyTop + KEYBOARD_HEIGHT - 5,
            whiteKeyWidth - 1,
            5,
          );
        }
        currentX += whiteKeyWidth;
      }
    }

    // Draw Black Keys
    for (let i = FIRST_NOTE; i <= LAST_NOTE; i++) {
      if (isBlack(i)) {
        const x = getNoteX(i, whiteKeyWidth);
        const isActive = realtimeActiveNotes.current.has(i) ||
          playbackActiveNotes.current.has(i);

        ctx.fillStyle = isActive ? COLORS.activeBlack : COLORS.blackKey;
        ctx.fillRect(x, keyTop, blackKeyWidth, KEYBOARD_HEIGHT * 0.65);

        // Highlight
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.fillRect(
          x + 2,
          keyTop,
          blackKeyWidth - 4,
          KEYBOARD_HEIGHT * 0.65 - 2,
        );
      }
    }

    // 4. "Now" Line
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, keyTop);
    ctx.lineTo(width, keyTop);
    ctx.stroke();

    reqRef.current = requestAnimationFrame(draw);
  }, [isReady, isDraggingSlider]); // Depend on dragging state to pause slider updates

  useEffect(() => {
    reqRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(reqRef.current);
  }, [draw]);

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 font-sans overflow-hidden">
      {/* Audio Enable Banner */}
      {!audioEnabled && (
        <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 py-3 flex items-center justify-between shadow-lg z-50">
          <div className="flex items-center gap-3">
            <Volume2 className="animate-pulse" />
            <span className="font-medium">
              Audio is currently muted. Click to enable sound for free play and
              playback.
            </span>
          </div>
          <button
            onClick={enableAudio}
            className="bg-white text-blue-600 px-4 py-1.5 rounded-full font-bold text-sm hover:bg-blue-50 transition-colors"
          >
            Enable Audio
          </button>
        </div>
      )}

      {/* Header */}
      <header className="flex flex-col gap-4 px-6 py-4 bg-slate-800 border-b border-slate-700 shadow-lg z-10">
        {/* Top Row: Logo & Main Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Music size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
                FlowKeys
              </h1>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                {midiAccess
                  ? (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      {" "}
                      MIDI Active
                    </span>
                  )
                  : <span>No MIDI Device</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {error && (
              <div className="flex items-center gap-2 px-3 py-1 bg-red-500/10 text-red-400 text-sm rounded-full border border-red-500/20">
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-700">
              <label
                className={`
                flex items-center gap-2 px-4 py-2 rounded-md cursor-pointer transition-all
                ${
                  loading || !midiLibLoaded
                    ? "opacity-50 cursor-wait"
                    : "hover:bg-slate-800"
                }
              `}
              >
                <Upload size={18} className="text-blue-400" />
                <span className="text-sm font-medium hidden md:inline">
                  Upload MIDI
                </span>
                <input
                  type="file"
                  accept=".mid,.midi"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={loading || !midiLibLoaded}
                />
              </label>

              <div className="w-px h-6 bg-slate-700 mx-1"></div>

              <button
                onClick={togglePlay}
                disabled={!isReady || loading}
                className={`
                  flex items-center gap-2 px-6 py-2 rounded-md font-medium transition-all
                  ${
                  !isReady
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                    : isPlaying
                    ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                }
                `}
              >
                {loading
                  ? <Loader size={18} className="animate-spin" />
                  : isPlaying
                  ? (
                    <>
                      <Pause size={18} fill="currentColor" />
                      <span>Pause</span>
                    </>
                  )
                  : (
                    <>
                      <Play size={18} fill="currentColor" />
                      <span>Play</span>
                    </>
                  )}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Row: Scrubber / Timeline (Only visible if file loaded) */}
        {isReady && (
          <div className="flex items-center gap-4 w-full">
            <span className="text-xs text-slate-400 w-10 text-right">
              {formatTime(currentTime)}
            </span>

            <input
              ref={progressBarRef}
              type="range"
              min="0"
              max={duration}
              step="0.01"
              defaultValue="0"
              onMouseDown={handleSeekStart}
              onTouchStart={handleSeekStart}
              onMouseUp={handleSeekEnd}
              onTouchEnd={handleSeekEnd}
              onChange={handleSeek}
              className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400"
            />

            <span className="text-xs text-slate-400 w-10">
              {formatTime(duration)}
            </span>
          </div>
        )}
      </header>

      {/* Main Visualizer Area */}
      <main className="flex-1 relative" ref={containerRef}>
        {!isReady && !midiAccess && !loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-slate-800/80 backdrop-blur-sm p-6 rounded-2xl border border-slate-700 text-center max-w-md mx-4">
              <p className="text-lg font-medium text-slate-200 mb-2">
                Ready to Play?
              </p>
              <p className="text-slate-400 text-sm mb-4">
                Connect a MIDI keyboard or upload a .mid file to start the
                visualization.
              </p>
              {!audioEnabled && (
                <div className="inline-flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
                  <Volume2 size={12} /> Click "Enable Audio" above to hear sound
                </div>
              )}
            </div>
          </div>
        )}

        <canvas
          ref={canvasRef}
          height={VISUALIZER_HEIGHT}
          className="w-full h-full block"
        />
      </main>
    </div>
  );
};

export default App;
