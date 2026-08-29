# Project Format

The current vertical slice keeps project state in memory. The native phase will use a versioned JSON project containing scene graph, device mappings, routing, mixer/ducking values, VMK settings, overlays, media references, recording metadata, and export history. Media files remain external and are referenced with relinkable paths.
