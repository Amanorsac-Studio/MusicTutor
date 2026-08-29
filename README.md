# PianoTutor Studio

PianoTutor is an installable Windows lesson-production studio for piano educators. The desktop application includes Studio, device setup, mixer with voice ducking, project library, and recording settings.

## Install on Windows

Run `installer/PianoTutor-Setup-0.1.0.exe`. The installer can create Desktop and Start Menu shortcuts.

## Run for development

```powershell
npm install
npm run desktop:dev
```

This opens PianoTutor in its native frameless desktop window.

## Production build

```powershell
npm run build
npm run build:windows
```

The Windows installer is written to `installer/`.

## Implemented

- Five workspaces: Studio, Devices, Mixer, Library, Settings.
- Editable lesson title, scenes, layer visibility, keyboard theme, and save feedback.
- Interactive virtual piano via pointer or the `A–;` keyboard row.
- Recording state and timer shared across workspaces.
- Real browser camera/microphone permission and preview path.
- Mixer, voice ducking, monitoring, library, source-retention preferences, and diagnostics UI.
- Real lesson recording of the PianoTutor window and microphone to `Videos\PianoTutor` as WebM.
- Built-in playable piano synthesizer and USB MIDI note input.
- `Ctrl+S` project persistence to `Documents\PianoTutor\Projects`.

## Scope boundary

This is a real installable Windows desktop shell using Electron. The deeper native media engine is not yet JUCE-based: ASIO/WASAPI multichannel capture, VST3 hosting, real FFmpeg recording, isolated sources, A/V/MIDI synchronization, crash recovery, and hardware soak tests remain the next engineering phase.

See `docs/BUILD_STATUS.md` and `FINAL_DELIVERY_REPORT.md` for exact status.
