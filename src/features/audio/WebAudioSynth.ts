export class WebAudioSynth {
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
