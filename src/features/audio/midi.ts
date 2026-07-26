export function parseMIDIArrayBuffer(buffer: ArrayBuffer): MidiData {
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
          const tempo = (view.getUint8(offset) << 16) |
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
      time += ((event.tick - prevTick) / ticksPerQuarterNote) *
        (currentTempo / 1000000);
      prevTick = event.tick;
      currentTempo = event.tempo;
    }
    time += ((tick - prevTick) / ticksPerQuarterNote) *
      (currentTempo / 1000000);
    return time;
  }

  const parsedNotes = rawNotes
    .map((note) => {
      const startTime = tickToSeconds(note.startTick);
      const endTime = tickToSeconds(note.endTick);
      return {
        midi: note.midi,
        time: startTime,
        duration: Math.max(endTime - startTime, 0.05),
        velocity: note.velocity,
        track: note.track,
      };
    })
    .sort((a, b) => a.time - b.time);

  const duration = parsedNotes.reduce(
    (max, note) => Math.max(max, note.time + note.duration),
    0,
  );
  return { notes: parsedNotes, duration };
}
