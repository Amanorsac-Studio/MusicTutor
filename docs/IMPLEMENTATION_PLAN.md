# Implementation Plan

## Current vertical slice

1. Establish the five-workspace shell.
2. Implement the teaching workflow and supplied visual system.
3. Add browser media preview, keyboard interaction, mixer, and ducking controls.
4. Compile, launch, and exercise the production UI.

## Native media phase

1. Create a C++20/JUCE Windows target with WASAPI/ASIO and VST3.
2. Implement lock-free audio/MIDI routing and a shared monotonic clock.
3. Prove one camera, mic, stereo keyboard pair, and MIDI concurrently.
4. Add GPU scene composition and crash-safe FFmpeg recording.
5. Expand to full V1 I/O, source retention, recovery, and plug-in isolation.
6. Run hardware soak tests and package/sign the installer.
