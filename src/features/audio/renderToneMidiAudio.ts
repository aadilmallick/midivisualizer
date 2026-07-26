import { audioBufferToWavBlob } from "../../utils/audio";
import {
  pianoReverbOptions,
  pianoSampleBaseUrl,
  pianoSamples,
  toneJsCdnUrl,
} from "./pianoSamples";

export const loadToneJS = async (): Promise<void> => {
  if (window.Tone) return;

  await new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${toneJsCdnUrl}"]`,
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = toneJsCdnUrl;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Tone.js."));
    document.head.appendChild(script);
  });
};

export const renderMidiToWavBlob = async (
  midiData: MidiData,
  durationSeconds: number,
): Promise<Blob> => {
  await loadToneJS();

  if (!window.Tone) {
    throw new Error("Tone.js is not available for offline audio rendering.");
  }

  const renderDuration = Math.max(durationSeconds, midiData.duration, 0.1);
  const renderedBuffer = await window.Tone.Offline(async ({ transport }) => {
    const reverb = new window.Tone!.Reverb(pianoReverbOptions).toDestination();
    await reverb.generate();

    const sampler = new window.Tone!.Sampler({
      urls: pianoSamples,
      baseUrl: pianoSampleBaseUrl,
    }).connect(reverb);

    await window.Tone!.loaded();

    for (const note of midiData.notes) {
      const toneNote = window.Tone!.Frequency(note.midi, "midi").toNote();
      const velocity = Math.min(Math.max(note.velocity / 127, 0.1), 1);
      sampler.triggerAttackRelease(
        toneNote,
        note.duration,
        note.time,
        velocity,
      );
    }

    transport.start(0);
  }, renderDuration);

  const audioBuffer = renderedBuffer.get() as AudioBuffer;
  return audioBufferToWavBlob(audioBuffer);
};
