# PianoTutor — Product, UX, Engineering & Delivery Specification
Version 1.0 — Codex Build Package

## 1. Product mission
PianoTutor is a purpose-built desktop production studio for piano and keyboard educators. It combines the scene composition model of broadcast software with MIDI visualization, multi-camera capture, a small audio mixer, built-in virtual instruments, lesson overlays, recording, and export. The product goal is simple: a teacher should be able to open the app, select devices, choose a lesson layout, teach once, and leave with a polished tutorial.

The product must not become a generic OBS clone or a full DAW/video editor. Its advantage is a constrained, opinionated workflow optimized for keyboard teaching.

## 2. Primary user journey
1. Launch or create a project.
2. Run first-use device setup.
3. Select up to two cameras.
4. Select up to two mono microphone inputs.
5. Select up to two stereo keyboard/line inputs.
6. Select MIDI input(s).
7. Choose whether MIDI drives a built-in sound, a hosted plug-in instrument, or an external MIDI destination.
8. Choose a tutorial scene/layout.
9. Customize background, logo, text, notation/chord panel, virtual keyboard and active-note colors.
10. Check meters and camera framing.
11. Enable voice ducking if desired.
12. Record the lesson.
13. Stop, review, trim head/tail if necessary, update editable overlays if supported by retained source data, and export.
14. Save project/scene as a reusable teaching preset.

## 3. Information architecture
Do not show every feature on one screen. Use five top-level workspaces:
- Studio — live composition canvas, scene switching, compact meters, record controls.
- Devices — cameras, microphones, stereo keyboard inputs, MIDI, monitoring and routing.
- Mixer — channel strips, buses, ducking, mute/solo, monitoring.
- Library — projects, recordings, autosaves, exports and templates.
- Settings — recording, performance, plug-ins, storage, shortcuts and app preferences.

A contextual inspector appears on the right in Studio when an object is selected. Advanced settings belong in dedicated pages/dialogs.

## 4. Studio workspace
### Canvas
- 16:9 composition by default; presets for 1920×1080 and 3840×2160.
- Optional 9:16 and 1:1 composition presets for social clips, without making them V1-critical.
- Canvas elements are selectable, movable, resizable, crop-able, hideable and lockable.
- Snapping, alignment guides, safe margins, fit/fill modes and reset-transform.
- Layer ordering.

### Source types
- Camera 1 / face camera.
- Camera 2 / overhead hands camera.
- Virtual MIDI keyboard (VMK).
- Background image or generated/static app background.
- Solid/gradient background.
- Logo/image overlay.
- Text overlay.
- Lesson title/subtitle.
- Optional chord/notation image or teaching card.
- Optional screen/window capture can be architected as a later source type.
- Optional media/backing-track source can be architected for later.

### Layout presets
Ship polished presets rather than an empty canvas:
- Face + VMK + Hands.
- Hands + VMK.
- Face + VMK.
- Logo/Title + VMK + Hands.
- Teaching Board + Face + VMK.
- Full Keyboard.
- Split teaching view.
- Custom.

Each preset should remain editable and saveable as a user preset.

## 5. Cameras
- Maximum two simultaneous camera inputs in V1.
- Device enumeration, hot-plug detection and reconnect handling.
- Per-camera resolution and frame-rate selection.
- 16:9 crop, fit/fill, mirror, rotate and transform.
- Preview thumbnail in Devices.
- Camera source can be placed anywhere in Studio.
- Independent enable/disable.
- Preserve isolated camera feeds during recording when multitrack/source recording is enabled.
- Clear disconnected-device state and recovery without crashing the recording session where possible.

## 6. Audio architecture
### Required inputs
- Mic 1: mono.
- Mic 2: mono.
- Keyboard/Line 1: stereo.
- Keyboard/Line 2: stereo.
- MIDI instrument audio bus: stereo.
- Optional backing/system audio bus is desirable if platform routing permits.

### Channel controls
- Input selector.
- Input gain/trim where supported.
- Meter.
- Fader.
- Mute and solo.
- Pan for mono channels; balance for stereo channels.
- Polarity where useful.
- Basic high-pass filter for microphones.
- Optional lightweight compressor/limiter presets for voice.
- Monitor enable and monitor level.
- Record-arm/source-record enable.

### Master
- Stereo master bus.
- Peak meters.
- Safety limiter to prevent export clipping.
- Master monitor level independent from recorded master where practical.

### Device constraints
Real hardware may expose all channels through one multi-channel interface rather than four independent OS devices. The routing model must therefore support both:
A. multiple independent devices where the platform/audio engine permits it; and
B. channel-pair assignment from one multi-channel interface.
Avoid promising sample-accurate aggregation of arbitrary unrelated audio devices unless the chosen audio backend explicitly supports it.

## 7. Voice ducking
Voice ducking is a first-class feature.
- Trigger: Mic 1, Mic 2, or Mic bus.
- Targets: Keyboard 1, Keyboard 2, MIDI Instrument bus, or combined Instrument bus.
- Default reduction should be subtle (roughly 3–6 dB), not radio-style pumping.
- Simple modes: Light / Medium / Strong.
- Advanced controls: threshold/sensitivity, amount, attack, hold and release.
- Visual gain-reduction meter.
- Bypass.
- Duck only while voice activity exceeds threshold.
- Preset defaults should prioritize natural teaching speech over audible compression artifacts.

## 8. MIDI and virtual keyboard
### MIDI input
- Enumerate MIDI devices and allow selection.
- Live note-on/note-off, velocity and sustain.
- Optional MIDI channel filter.
- Octave/key labels.
- Sustain visualization.
- Active-note highlighting.
- Configurable active-note colors and keyboard theme.
- Adjustable displayed octave range.
- Optional chord/scale recognition layer after core MIDI is stable.

### MIDI recording
- Record raw MIDI events with timestamps synchronized to the recording timeline.
- Preserve note, velocity, sustain/control changes and channel data.
- Export Standard MIDI File where feasible.
- Retained MIDI should allow the VMK visualization to be re-rendered after recording.

### MIDI sound modes
Per MIDI source:
1. Built-In Instrument.
2. Hosted Plug-in Instrument.
3. External MIDI Device.
4. Visualization Only.

### Built-in sound library
V1 should include a curated, lightweight set:
- Acoustic Grand.
- Warm Grand.
- Bright Piano.
- Rhodes/Stage EP.
- Wurlitzer-style EP.
- Organ.
- Warm Pad.
- EP + Pad layer.

Do not ship dozens of low-quality presets. Prioritize fast loading, low CPU use, legal/licensed sample content, and useful teaching sounds.

### External instruments
Architecture should support third-party virtual instruments. Recommended desktop target:
- Windows: VST3 hosting.
- macOS: Audio Unit and/or VST3 if cross-platform architecture permits.
The plug-in host must scan safely, cache results, blacklist repeatedly crashing plug-ins, expose plug-in editor UI, support MIDI input and return stereo audio to the MIDI Instrument bus. Plug-in hosting is a major engineering subsystem; isolate it from the core UI and recording engine.

External hardware MIDI output should be available as a routing option where supported.

## 9. Visual MIDI keyboard
- Accurate 88-key-capable model, with configurable visible range.
- Responsive note illumination.
- User-selectable highlight palette.
- Velocity-sensitive glow/intensity is optional.
- C labels/octave labels.
- Sustain indicator.
- Hide/show black-key labels if added.
- Multiple visual themes: classic, dark, minimal.
- VMK is a visual source independent of the instrument sound generator.

## 10. Backgrounds, branding and text
- Curated built-in background pack: clean blue, dark studio, warm wood, minimal dark, gradient, classroom/studio, neutral light.
- User-imported image background.
- Background fit/fill/crop.
- Logo import with transparent PNG support.
- Persistent lesson text overlays.
- Title/subtitle fields.
- Font, size, weight, alignment, color, background plate, opacity and position.
- Save branding as a reusable preset.
- Avoid requiring generative AI at runtime; bundled backgrounds should be normal licensed app assets.

## 11. Recording system
### Record outputs
At minimum:
- Final composed video.
- Final stereo mix.
- MIDI event file/data.

Preferred source-retention mode:
- Camera 1 isolated video.
- Camera 2 isolated video.
- Mic 1 isolated audio.
- Mic 2 isolated audio.
- Keyboard 1 stereo audio.
- Keyboard 2 stereo audio.
- MIDI-instrument stereo audio.
- MIDI events.
- Scene/overlay metadata and transforms.

This creates a non-destructive project and permits post-recording corrections without reteaching.

### Recording controls
- Record, pause, stop.
- Configurable pre-roll/count-in.
- Recording timer.
- Disk-space estimate.
- Dropped-frame/overload warning.
- Keyboard shortcut and optional MIDI/pedal mapping for record/stop.
- Autosave project state before and during recording.
- Crash recovery of the most recent viable recording.

### Formats
- Default video: MP4/H.264 where licensing/encoder availability permits.
- Optional MOV/MKV intermediate strategy may be used internally for crash resilience.
- Audio: AAC in final video plus optional WAV source tracks.
- Configurable 1080p/30 default; 60 fps and 4K where hardware supports it.
- Encoder selection should use hardware acceleration when reliable, with software fallback.

## 12. Review and export
Keep editing intentionally small in V1.
- Playback.
- Head/tail trim.
- Set export in/out.
- Rename project.
- Change retained text/logo/VMK appearance if source-retention mode supports re-render.
- Export final tutorial.
- Export MIDI.
- Reveal output folder.
- Presets for YouTube 1080p and YouTube 4K.
- Later: social vertical reframing and chapter markers.

Do not build a timeline-based NLE in V1.

## 13. Projects and Library
Project stores:
- Scene graph and layout.
- Device mappings by stable identifiers.
- Audio routing.
- Mixer values.
- Ducking values.
- VMK settings.
- Instrument routing/preset.
- Text/logo/background references.
- Recording metadata.
- Source files.
- Export history.

Features:
- New/open/duplicate/delete project.
- Recent projects.
- Search/filter.
- Autosave.
- Recovery project after crash.
- Save Scene Preset.
- Save Device Preset.
- Save Branding Preset.
- Missing-media relink.

## 14. First-run setup
Wizard:
1. Welcome.
2. Select microphone(s).
3. Select keyboard/line audio.
4. Select MIDI keyboard.
5. Select camera(s).
6. Select monitoring output.
7. Audio/video test.
8. Choose default layout.
9. Ready.

Include a “Skip and configure later” route.

## 15. Settings
- Audio buffer size/sample rate.
- Camera defaults.
- Recording resolution/fps/encoder.
- Storage folder.
- Source-retention toggle.
- Plug-in folders/scan/rescan.
- MIDI mappings.
- Keyboard shortcuts.
- Appearance.
- Performance diagnostics.
- Reset warnings/preferences.

## 16. Performance and reliability
This is real-time media software. Reliability outranks decorative UI.
- Audio callback must never block on disk, network or UI.
- Separate real-time audio/MIDI processing from rendering and file I/O.
- Bounded queues/ring buffers.
- Video frames timestamped against a common monotonic clock.
- A/V/MIDI synchronization strategy documented and tested.
- Recording should degrade gracefully under load.
- Explicit CPU/GPU/disk indicators.
- Detect audio underruns and dropped video frames.
- Safe device reconfiguration.
- Recovery from camera unplug/replug.
- Autosave metadata frequently without touching real-time threads.
- Crash-safe recording container or segmented recording strategy.
- Unit/integration tests around timestamps, project serialization, routing and ducking.

## 17. Recommended implementation direction
Codex must inspect the target repository and platform requirements before finalizing technology. For a new native cross-platform desktop build, a strong default is:
- C++20.
- JUCE for audio/MIDI/device abstraction, VST3/AU hosting and application framework.
- Platform camera/video capture through JUCE capabilities or native/platform libraries where needed.
- FFmpeg or platform media frameworks for robust encoding/muxing, subject to distribution/licensing decisions.
- GPU-accelerated composition for the preview/output canvas.
- JSON project format with versioned schema.
- SQLite only if the Library requires richer indexing; otherwise start with filesystem + project metadata.

If the product is Windows-only initially, optimize for WASAPI/ASIO and VST3 first. If macOS is a launch requirement, CoreAudio/AU support must be planned from day one.

## 18. UX design principles
- Studio should be visually calm and immediately understandable.
- Do not place all routing, plug-in and ducking controls on the Studio page.
- Central preview is the hero.
- Left side: scenes/sources or compact project controls.
- Right side: contextual inspector.
- Bottom: transport and compact health meters.
- Dedicated Devices/Mixer screens carry complexity.
- Use progressive disclosure: simple defaults first, advanced controls behind expanders.
- Dark professional visual language, blue selection/accent, green healthy meters, amber warnings, red recording/errors.
- Large click targets and readable labels.
- No skeuomorphic DAW clutter.

## 19. Accessibility
- Full keyboard navigation for standard controls.
- Visible focus states.
- Tooltips/accessible names for icon-only buttons.
- Avoid conveying meter/status only by color.
- Scalable UI where practical.
- High-contrast text.
- Screen-reader-compatible labels for configuration pages where framework permits.

## 20. Security/privacy
- Camera/microphone permission handling must be explicit.
- No cloud upload by default.
- Projects remain local unless a future cloud feature is enabled.
- Do not collect raw audio/video telemetry.
- Crash reports must be opt-in or clearly disclosed and must not attach lesson media by default.
- Validate imported paths and plug-ins defensively.

## 21. V1 acceptance criteria
A release candidate is not complete until a tester can:
- Configure two cameras.
- Configure two mono microphone channels.
- Configure two stereo keyboard/line channels or assign equivalent channel pairs from a multi-channel interface.
- Configure a MIDI keyboard.
- Play a built-in piano sound from MIDI with low enough latency for teaching.
- Display accurate VMK note highlights.
- Route MIDI to a supported external/hosted instrument if that feature is included in the release target.
- Build a scene with face camera, hands camera, VMK, background, logo and text.
- Save/reopen the project with layout intact.
- Enable voice ducking and hear a natural reduction of the instrument bus while speaking.
- Record a 30-minute 1080p lesson without A/V drift beyond the documented tolerance, crashes or corrupt output.
- Retain MIDI synchronized with the recording.
- Export a playable tutorial video.
- Recover a useful project/recording after a simulated app crash during recording.
- Reconnect a temporarily disconnected camera/device with clear UI feedback.
- Complete the core workflow without reading documentation.

## 22. Test matrix
Automated:
- Project schema migration.
- MIDI timestamp ordering.
- Ducking envelope behavior.
- Audio routing graph.
- Device identifier persistence.
- Scene serialization.
- Filename/path safety.
- Recording state machine.
- Crash-recovery metadata.

Manual/hardware:
- Single USB audio interface.
- Multi-channel interface.
- USB microphone + interface combinations.
- Two USB cameras.
- Webcam + capture card.
- 30/60 fps combinations.
- 44.1/48 kHz.
- 128/256/512 buffer sizes.
- MIDI USB keyboard.
- Sustain pedal.
- VST3/AU instrument.
- Device unplug/replug.
- Low disk space.
- CPU/GPU stress.
- 30/60/120 minute recordings.

## 23. Delivery phases
Phase 0 — repository audit and technical spike:
- Confirm OS targets, framework, licensing, encoder strategy and device APIs.
- Prototype simultaneous audio + MIDI + two-camera timestamp capture.
- Prototype VMK rendering.
- Prove one stable 30-minute recording before polishing UI.

Phase 1 — vertical slice:
- Project, one camera, one mic, one stereo keyboard, MIDI, VMK, built-in piano, scene canvas, record/export.

Phase 2 — full V1 I/O:
- Camera 2, Mic 2, Keyboard 2, mixer, ducking, presets, background/logo/text.

Phase 3 — non-destructive capture:
- Isolated source recording, project recovery, review/trim, re-render overlays.

Phase 4 — plug-in/external instruments:
- VST3/AU host, scanning, crash isolation/blacklist, routing.

Phase 5 — hardening:
- Long-duration tests, device churn, performance optimization, accessibility, installer/signing, update path, documentation.

Do not polish every screen before the media engine passes stability gates.

## 24. Out of scope for initial V1
- Full multitrack DAW.
- Full nonlinear video editor.
- Cloud collaboration.
- Livestream platform integration.
- AI-generated lessons.
- Automatic transcription.
- Marketplace.
- Mobile version.
These may become later roadmap items.

## 25. Definition of done
“Done” means shippable, not merely compiling:
- Production build succeeds from a clean checkout.
- Automated tests pass.
- No placeholder UI in core workflows.
- No mocked media devices in release paths.
- Installer/package is produced for the target OS.
- App launches on a clean test machine.
- Permissions and device setup work.
- 30-minute and 60-minute soak recordings pass.
- Exported video/audio/MIDI are valid.
- Crash recovery is verified.
- README/build instructions are accurate.
- User quick-start is included.
- Known limitations are documented.
- Release artifacts are collected into /dist or the repository’s standard release folder.

## 26. Visual references
Use assets/renders/01_primary_studio_mockup.png as the primary structural reference.
Use assets/renders/02_alternate_studio_mockup.png for alternate visual hierarchy.
Use assets/renders/03_routing_and_ducking_mockup.png as a feature-density reference ONLY. Do not copy its “everything on one page” layout; split those controls into Devices and Mixer.
The original tutorial screenshots in assets/references demonstrate the teaching composition problem, not the final UI.

## 27. Product decisions Codex should not silently change
- Maximum two cameras in V1.
- Two mono mic paths.
- Two stereo keyboard/line paths.
- MIDI is distinct from keyboard audio.
- Built-in MIDI sounds are required.
- External virtual-instrument path is part of the architecture.
- Voice ducking is required.
- VMK customization is required.
- Final composed recording + synchronized MIDI is required.
- Source retention is strongly preferred and should be implemented once the vertical slice is stable.
- Complexity must be separated across workspaces rather than displayed on one page.
