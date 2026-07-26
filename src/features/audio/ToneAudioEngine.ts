/**
 * Tone.js Powered Concert Grand Piano Audio Engine
 */
export class ToneAudioEngine {
  public toneLoaded: boolean = false;
  public isMuted: boolean = false;
  public isPianoLoaded: boolean = false;
  private sampler: ToneSampler | null = null;
  private reverb: ToneReverb | null = null;
  private onPianoLoadCallback: (() => void) | null = null;

  constructor() {
    this.toneLoaded = false;
    this.isMuted = false;
    this.isPianoLoaded = false;
    this.sampler = null;
    this.reverb = null;
    this.onPianoLoadCallback = null;
  }

  async loadToneJS(): Promise<void> {
    if (window.Tone) {
      this.toneLoaded = true;
      return;
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js";
      script.onload = () => {
        this.toneLoaded = true;
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async init(onPianoLoad?: () => void): Promise<void> {
    this.onPianoLoadCallback = onPianoLoad || null;
    await this.loadToneJS();
    if (!window.Tone) return;

    if (window.Tone.context.state !== "running") {
      await window.Tone.start();
    }

    if (!this.reverb) {
      // Reverb & Master Bus Effects
      this.reverb = new window.Tone.Reverb({
        decay: 2.2,
        wet: 0.25,
      }).toDestination();
      await this.reverb.generate();

      // Grand Piano Sampler (Salamander Grand Piano)
      const pianoSamples: Record<string, string> = {
        A0: "A0.mp3",
        C1: "C1.mp3",
        "D#1": "Ds1.mp3",
        "F#1": "Fs1.mp3",
        A1: "A1.mp3",
        C2: "C2.mp3",
        "D#2": "Ds2.mp3",
        "F#2": "Fs2.mp3",
        A2: "A2.mp3",
        C3: "C3.mp3",
        "D#3": "Ds3.mp3",
        "F#3": "Fs3.mp3",
        A3: "A3.mp3",
        C4: "C4.mp3",
        "D#4": "Ds4.mp3",
        "F#4": "Fs4.mp3",
        A4: "A4.mp3",
        C5: "C5.mp3",
        "D#5": "Ds5.mp3",
        "F#5": "Fs5.mp3",
        A6: "A6.mp3",
        C7: "C7.mp3",
        C8: "C8.mp3",
      };

      this.sampler = new window.Tone.Sampler({
        urls: pianoSamples,
        baseUrl: "https://tonejs.github.io/audio/salamander/",
        onload: () => {
          this.isPianoLoaded = true;
          if (this.onPianoLoadCallback) this.onPianoLoadCallback();
        },
      }).connect(this.reverb);
    }
  }

  midiToNote(midi: number): string {
    if (!window.Tone) return "C4";
    return window.Tone.Frequency(midi, "midi").toNote();
  }

  playNote(midi: number, velocity: number = 90): void {
    if (this.isMuted || !window.Tone || !this.sampler || !this.isPianoLoaded)
      return;

    const note = this.midiToNote(midi);
    const vel = Math.min(Math.max(velocity / 127, 0.1), 1);

    try {
      this.sampler.triggerAttack(note, window.Tone.now(), vel);
    } catch {
      // Voice overlap protection
    }
  }

  stopNote(midi: number): void {
    if (this.isMuted || !window.Tone || !this.sampler || !this.isPianoLoaded)
      return;
    const note = this.midiToNote(midi);

    try {
      this.sampler.triggerRelease(note, window.Tone.now() + 0.1);
    } catch {
      // Voice stopped
    }
  }
}
