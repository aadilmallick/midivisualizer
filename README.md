# FlowKeys 🎹

A real-time MIDI visualizer that brings musical performance to life through dynamic falling note animations and an interactive 88-key piano interface.

![MIDI Visualizer Demo](https://img.shields.io/badge/status-active-success)
![React](https://img.shields.io/badge/React-19.2.0-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- 🎹 **Real-time MIDI Input**: Connect any MIDI keyboard for live performance visualization
- 🎵 **MIDI File Playback**: Upload and play .mid files with synchronized audio and visuals
- 🎨 **Falling Note Animation**: Visual representation of notes falling toward the keyboard
- 🎼 **88-Key Piano Display**: Full piano keyboard with accurate white/black key positioning
- 🔊 **Audio Synthesis**: High-quality sound synthesis using Tone.js
- ⏯️ **Playback Controls**: Play, pause, and seek through MIDI files
- 📱 **Responsive Design**: Adapts to different screen sizes

## Tech Stack

- **Frontend Framework**: React 19.2.0 with TypeScript
- **Audio Engine**: [Tone.js](https://tonejs.github.io/) - Web Audio framework for synthesis and scheduling
- **MIDI Parsing**: [@tonejs/midi](https://github.com/Tonejs/Midi) - MIDI file parser
- **Graphics Rendering**: HTML5 Canvas API for 60fps animations
- **Styling**: Tailwind CSS 4.1.18
- **Build Tool**: Vite 7.3.1
- **Icons**: Lucide React

## High-Level Application Flow

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         User Input                           │
│                  (MIDI Device / File Upload)                 │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────────┐
         │   Input Processing Layer   │
         ├────────────┬───────────────┤
         │ Web MIDI   │  File Parser  │
         │ API        │  (@tonejs/    │
         │            │   midi)       │
         └────────────┴───────────────┘
                      │
                      ▼
         ┌────────────────────────────┐
         │   Audio Scheduling Layer   │
         │     (Tone.Transport &      │
         │      Tone.PolySynth)       │
         └────────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
         ▼                         ▼
┌────────────────┐      ┌─────────────────┐
│  Audio Output  │      │ Visualization   │
│   (Web Audio)  │      │  (Canvas API)   │
└────────────────┘      └─────────────────┘
```

### Data Flow

#### 1. **Initialization Phase** (src/App.tsx:65-112)
```
App Component Mount
  ├─→ Create PolySynth (Tone.js synthesizer)
  ├─→ Request MIDI device access (Web MIDI API)
  ├─→ Load @tonejs/midi library from CDN
  ├─→ Setup canvas resize handlers
  └─→ Start animation loop (requestAnimationFrame)
```

#### 2. **Real-Time MIDI Input Flow** (src/App.tsx:120-160)
```
MIDI Device Input
  ├─→ navigator.requestMIDIAccess()
  ├─→ onmidimessage event handler
  ├─→ Parse MIDI message (command, note, velocity)
  ├─→ Note On (0x90)
  │     └─→ triggerRealtimeAttack()
  │           ├─→ Add to realtimeActiveNotes Set
  │           └─→ synth.triggerAttack()
  └─→ Note Off (0x80)
        └─→ triggerRealtimeRelease()
              ├─→ Remove from realtimeActiveNotes Set
              └─→ synth.triggerRelease()
```

#### 3. **MIDI File Playback Flow** (src/App.tsx:163-213)
```
File Upload
  ├─→ Read file as ArrayBuffer
  ├─→ Parse with Midi library
  ├─→ Extract note data (time, duration, pitch, velocity)
  ├─→ Schedule events on Tone.Transport timeline
  │     └─→ For each note:
  │           Tone.Transport.schedule(
  │             synth.triggerAttackRelease,
  │             note.time
  │           )
  ├─→ Store midi data in midiData.current ref
  └─→ Set duration and mark ready for playback
```

#### 4. **Visualization Rendering Loop** (src/App.tsx:285-393)
```
requestAnimationFrame (60fps)
  ├─→ Get current transport time (Tone.Transport.seconds)
  ├─→ Clear canvas
  ├─→ Calculate active notes (notes currently playing)
  ├─→ Render falling notes
  │     ├─→ Calculate visibility window
  │     ├─→ For each note in MIDI data:
  │     │     ├─→ Check if in view window
  │     │     ├─→ Calculate Y position (time * NOTE_FALL_SPEED)
  │     │     └─→ Draw rectangle on canvas
  │     └─→ Add active notes to playbackActiveNotes Set
  ├─→ Render piano keyboard
  │     ├─→ Draw 52 white keys
  │     ├─→ Draw 36 black keys (offset positioning)
  │     └─→ Highlight active keys (from both Sets)
  ├─→ Draw "now line" (horizontal line at keyboard)
  └─→ Update progress slider
```

### Key Technical Components

#### Canvas Rendering System

The visualization uses a **coordinate system** where:
- **X-axis**: Maps MIDI notes (21-108) to horizontal positions across 88 keys
- **Y-axis**: Maps time to vertical space (future notes at top, current notes at bottom)
- **Note Fall Speed**: 150 pixels/second constant

**White Key Positioning** (src/App.tsx:265-282):
```typescript
// 52 white keys evenly distributed across canvas width
whiteKeyWidth = canvasWidth / 52
whiteKeyPosition = whiteKeyIndex * whiteKeyWidth
```

**Black Key Positioning**:
```typescript
// Black keys positioned at cracks between white keys
blackKeyWidth = whiteKeyWidth * 0.65
blackKeyPosition = (whiteKeyIndex * whiteKeyWidth) - (blackKeyWidth / 2)
```

#### Audio Synchronization

**Two Separate Note Tracking Systems**:
1. **`realtimeActiveNotes`**: Tracks notes from physical MIDI input
2. **`playbackActiveNotes`**: Tracks notes from file playback

This dual-system allows simultaneous visualization of:
- Live performance from connected MIDI devices
- Pre-recorded MIDI file playback

**Time-Based Scheduling**:
- Uses `Tone.Transport` as master clock
- All audio events scheduled relative to transport time
- Seeking updates transport position instantly
- Visual rendering synced to `Tone.Transport.seconds`

#### State Management

**React State** (UI updates):
- `isPlaying`: Playback state
- `isReady`: MIDI file loaded
- `currentTime`: Display time (text)
- `duration`: Total MIDI length
- `audioEnabled`: Audio context state

**Refs** (Performance-critical):
- `midiData`: Parsed MIDI file data
- `realtimeActiveNotes`: Active MIDI input notes
- `playbackActiveNotes`: Active playback notes
- `synth`: Tone.js synthesizer instance
- `reqRef`: Animation frame ID

Using refs for frequently-updated data prevents unnecessary re-renders during the 60fps animation loop.

## Project Structure

```
midivisualizer/
├── src/
│   ├── App.tsx           # Main application component
│   ├── main.tsx          # React entry point
│   └── index.css         # Global styles
├── public/
├── index.html            # HTML entry point
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── vite.config.ts        # Vite build configuration
```

## Setup & Installation

### Prerequisites
- Node.js 16+ and npm
- Modern web browser with Web Audio API support
- (Optional) MIDI keyboard/controller

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd midivisualizer

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Development Commands

- `npm run dev` - Start Vite dev server (http://localhost:5173)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Usage

### Real-Time MIDI Input

1. Connect your MIDI keyboard via USB
2. Grant browser MIDI access when prompted
3. The app will automatically detect and display "MIDI Active"
4. Click "Enable Audio" banner to activate sound
5. Play your keyboard - notes will appear in real-time

### MIDI File Playback

1. Click "Upload MIDI" button
2. Select a .mid or .midi file
3. Click "Play" to start playback
4. Use the progress bar to seek through the song
5. Press "Pause" to stop playback

## Configuration

### Visual Constants (src/App.tsx:17-33)

```typescript
VISUALIZER_HEIGHT = 600    // Canvas height in pixels
KEYBOARD_HEIGHT = 120      // Piano keyboard height
NOTE_FALL_SPEED = 150      // Pixels per second
KEY_COUNT = 88             // Total piano keys
FIRST_NOTE = 21            // A0 (lowest note)
LAST_NOTE = 108            // C8 (highest note)
```

### Color Palette (src/App.tsx:26-34)

```typescript
COLORS = {
  background: "#0f172a",    // Slate 900
  whiteKey: "#f8fafc",      // Slate 50
  blackKey: "#1e293b",      // Slate 800
  activeWhite: "#3b82f6",   // Blue 500
  activeBlack: "#2563eb",   // Blue 600
  fallingNote: "#60a5fa",   // Blue 400
  gridLines: "#1e293b"
}
```

## Browser Compatibility

- **Chrome/Edge**: Full support (recommended)
- **Firefox**: Full support
- **Safari**: Partial support (Web MIDI may require additional permissions)

**Required Browser APIs**:
- Web Audio API
- Web MIDI API
- Canvas API
- File API

## Performance Considerations

- **60 FPS Rendering**: Uses `requestAnimationFrame` for smooth animation
- **Efficient Note Culling**: Only renders notes in viewport window
- **Set-based Lookups**: O(1) active note checking
- **Direct DOM Manipulation**: Progress bar updates bypass React reconciliation
- **Audio Scheduling**: All audio events pre-scheduled on Transport timeline

## Future Enhancements

See [Issues](https://github.com/aadilmallick/midivisualizer/issues) for planned features:

- [#1 Add different note styling options](https://github.com/aadilmallick/midivisualizer/issues/1)
- [#2 Implement color picker for note customization](https://github.com/aadilmallick/midivisualizer/issues/2)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this project for learning and personal projects.

## Acknowledgments

- [Tone.js](https://tonejs.github.io/) - Powerful Web Audio framework
- [@tonejs/midi](https://github.com/Tonejs/Midi) - MIDI file parsing
- [Lucide React](https://lucide.dev/) - Beautiful icon library
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
