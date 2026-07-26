import {
  pianoReverbOptions,
  pianoSampleBaseUrl,
  pianoSamples,
  toneJsCdnUrl,
} from "./pianoSamples";

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
      script.src = toneJsCdnUrl;
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
      this.reverb = new window.Tone.Reverb(pianoReverbOptions).toDestination();
      await this.reverb.generate();

      // Grand Piano Sampler (Salamander Grand Piano)
      this.sampler = new window.Tone.Sampler({
        urls: pianoSamples,
        baseUrl: pianoSampleBaseUrl,
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
