# PianoTutor Build Ledger

Last updated: August 29, 2026

This is the canonical status document. “Built” means code exists. “Tested” means it was exercised in the packaged Windows app. “Partial” means the interface works but the production media-engine behavior is not complete.

## Current artifacts

- Workspace: `C:\Users\amano\Documents\ChatGPT\Piano Tutor`
- Latest unpacked app: `installer\win-unpacked\PianoTutor.exe`
- Latest installer: `installer\PianoTutor-Setup-0.1.0.exe`
- Existing installed copy: `C:\Users\amano\AppData\Local\Programs\PianoTutor\PianoTutor.exe`

Important: the existing installed copy is dated August 28 and is older than the August 29 build. Until the new installer is run, the Desktop/Start Menu shortcut can open the outdated copy. The corrected unpacked app was launched directly and verified.

## Built and tested

### Windows desktop shell

- Electron desktop application with frameless native window controls.
- Five workspaces: Studio, Devices, Mixer, Library, and Settings.
- Vite production build and NSIS Windows packaging.
- Local application data, project, recording, and settings storage.

### Studio

- 88-key A0–C8 virtual piano with 52 white keys and 36 black keys.
- Pointer, computer-keyboard, and MIDI note highlighting.
- Built-in Web Audio polyphonic piano synthesizer.
- Web MIDI input and output enumeration; selected MIDI output receives note on/off messages.
- Editable scenes, scene creation/deletion, layout switching, layer visibility, lesson title, background, and highlight color.
- Live camera selection and preview.
- Recording controls shared with the top status and timer.

### Device discovery

- Windows camera, audio input, audio output, MIDI input, and MIDI output enumeration.
- Device refresh and media permission request flow.
- Primary and secondary camera selectors.
- Camera preview connection.
- Audio endpoint assignment selectors and monitoring-level control.

Hardware observed during packaged-app testing:

- Behringer UMC404HD 192k: 15 Windows capture endpoints enumerated.
- MODX-1: MIDI input detected and connected.
- Iriun Webcam and EOS Webcam Utility: camera endpoints detected.
- Iriun preview connection became active; Iriun itself displayed its “start Iriun Webcam” feed message.

### Recording

- Captures the PianoTutor application window plus the Windows default microphone/audio-input stream.
- Saves WebM recordings to `C:\Users\amano\Videos\PianoTutor`.
- A 24-second test recording saved successfully at 4,374,233 bytes.
- Recording appears in the Library after refresh.

### Library

- Reads real `.pianotutor.json` projects from `Documents\PianoTutor\Projects`.
- Creates and lists local projects.
- Reads real WebM/MP4/MOV files from `Videos\PianoTutor`.
- Opens project/recording files and their folders through Electron.

### Settings

- All settings categories navigate correctly.
- Recording, audio/MIDI, video, storage, shortcuts, plug-in, and appearance controls retain in-session state.
- Settings persist to Electron’s application user-data `settings.json`.
- Project and recording folder buttons open the actual Windows folders.
- MIDI rescan action is connected to Web MIDI discovery.

### Verification completed

- `npm test`: 1 UI integration test passed.
- `npm run build`: strict TypeScript and Vite build passed.
- `npm run build:windows`: NSIS installer build passed.
- Corrected unpacked executable launched and its exact process path was verified.
- Devices page enumerated the real Behringer, MODX, Iriun, and EOS endpoints after startup.
- Camera connection changed to active.
- Mixer mute state, Library project creation, Settings persistence, and recording save were exercised in the desktop UI.

## Partial—not production-complete

### Audio routing and Mixer

- Faders, mute, solo, limiter, monitoring, and ducking controls are interactive.
- They do **not yet control a shared low-latency multichannel audio graph**.
- Mixer meters are currently presentation values, not live RMS/peak measurements from every hardware channel.
- Voice ducking does not yet process the recorded instrument bus.
- Device-page audio assignments are saved as UI state but are not yet applied to a native ASIO/WASAPI routing engine.

### Cameras and scenes

- Camera discovery, selection, and preview are real.
- Scene/layout state changes are real inside the editor.
- The preview compositor is DOM/CSS based, not a GPU/native scene graph.
- Simultaneous dual-camera reliability depends on the drivers allowing concurrent streams and still needs hardware soak testing.

### Recording and export

- The current recorder produces WebM, not MP4/H.264.
- It records the composed app window and default input, not isolated camera/audio/MIDI source files.
- Recording startup can take several seconds while Electron negotiates capture.
- There is no crash-safe segmented recovery yet.

### Settings and diagnostics

- Settings persist, but some values are preferences for future native-engine work and do not yet reconfigure a native engine.
- Performance and plug-in status panels are informational; they are not full hardware benchmark or VST3 scan results.

## Remaining engineering work

1. Build a native JUCE audio/MIDI engine.
2. Add ASIO and WASAPI exclusive/shared device types, channel maps, sample-rate changes, and buffer-size changes.
3. Connect device assignments, mixer gains, mute/solo, meters, monitoring, limiter, and ducking to the shared audio graph.
4. Implement VST3 discovery, validation, hosting, state persistence, and crash isolation.
5. Add a licensed sampled-piano instrument or user-provided library support.
6. Replace DOM recording with a synchronized compositor/media pipeline.
7. Add FFmpeg MP4/H.264 encoding and hardware-encoder selection.
8. Record isolated cameras, audio buses, and timestamped MIDI alongside the program output.
9. Implement crash-safe segmented recording and recovery.
10. Add real scene/source persistence, project open/edit workflows, templates, exports, and autosave recovery.
11. Add live audio RMS/peak tests, device churn tests, A/V/MIDI sync tests, and 30/60-minute hardware soak tests.
12. Add application branding/icon, commercial code-signing identity, versioning, and updater strategy.

## Definition of full V1 completion

V1 is not complete until real hardware assignments drive the native audio/video graph; Mixer changes are audible and recorded; dual-camera scenes are composited reliably; isolated sources and MIDI remain synchronized; MP4/H.264 export works; projects recover after failure; and the hardware test matrix passes.
