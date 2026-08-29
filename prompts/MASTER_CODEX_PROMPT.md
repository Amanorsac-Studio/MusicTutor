# MASTER CODEX PROMPT — BUILD PIANOTUTOR END TO END

You are the lead engineer for PianoTutor and have authority to execute the full implementation in this repository.

FIRST:
1. Read `docs/PRODUCT_ENGINEERING_SPEC.md`.
2. Read `docs/AUTONOMOUS_DEV_TEAM_PLAYBOOK.md`.
3. Inspect every file under `assets/renders/` and `assets/references/`.
4. Audit the existing repository before changing architecture.

MISSION:
Build PianoTutor from the repository's current state through a tested, packaged release candidate. Do not stop after planning, scaffolding, UI mockups, or partial implementation. Continue through the engineering gates and Definition of Done in the specification.

OPERATING MODE:
- Act as the coordinated dev team defined in the playbook.
- Use parallel/subagent execution when available; otherwise execute the roles sequentially.
- Make routine technical decisions yourself.
- Keep implementation documents and BUILD_STATUS current.
- Build/test/run continuously.
- Fix failures before accumulating new work.
- Do not fake core camera/audio/MIDI behavior.
- Do not put every feature on the Studio page. Use Studio, Devices, Mixer, Library and Settings.
- Prioritize media-engine stability and synchronization before visual polish.
- Preserve working code and migrate incrementally.
- If an external blocker exists, document it and continue everything else. Never stop merely to ask about a non-blocking choice.

NON-NEGOTIABLE PRODUCT REQUIREMENTS:
- Up to 2 cameras.
- 2 mono microphone paths.
- 2 stereo keyboard/line paths, with sensible multi-channel-interface routing.
- MIDI input and synchronized MIDI recording.
- Virtual MIDI keyboard with configurable note colors/themes.
- Built-in playable instrument sounds.
- Architecture for hosted third-party virtual instruments and external MIDI routing.
- Voice-triggered ducking of keyboard/MIDI instrument audio.
- Backgrounds, logo and persistent text overlays.
- Reusable scene/layout presets.
- Final composed recording and export.
- Strongly preferred isolated source retention and non-destructive project metadata.
- Autosave/crash recovery.
- Professional dark UI guided by supplied renders.
- Production packaging and documentation.

BEGIN NOW:
Create the implementation plan from the actual repository, then immediately execute it. Continue until the release candidate is produced or only clearly documented external blockers remain.
