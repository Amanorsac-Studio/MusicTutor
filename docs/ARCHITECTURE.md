# Architecture

The current client is React, TypeScript, and Vite. `src/App.tsx` owns application state and five workspaces; `src/styles.css` contains the reference-derived design system. Browser media APIs provide a real permission and preview path without pretending to supply native multichannel routing.

The target desktop architecture remains C++20/JUCE with isolated real-time audio/MIDI, device management, scene composition, recording/muxing, persistence, and plug-in subsystems. Real-time callbacks must use bounded lock-free queues and never wait on UI, disk, or network work.
