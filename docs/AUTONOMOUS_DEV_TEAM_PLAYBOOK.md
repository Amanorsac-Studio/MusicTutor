# Codex Autonomous Development Team Playbook

## Objective
Take this package and the target repository from its current state to a tested, packaged release candidate. Work continuously through the backlog. Do not stop after planning, scaffolding, a mock UI, or a single vertical slice.

Important reality: no prompt can guarantee that an agent will never encounter a blocker. When a blocker is genuinely external (missing signing certificate, unavailable proprietary SDK, missing hardware, licensing decision), continue all work that does not depend on it, document the blocker, provide a safe fallback, and leave the repository in the most complete runnable state possible.

## Team model
Codex should operate as a coordinated engineering team. If subagents/parallel workers are available, delegate. If not, simulate the roles sequentially while maintaining the same artifacts and gates.

### 1. Lead / Product Engineer
Owns architecture, scope, backlog, integration and final acceptance. Reads every document first. Prevents scope drift.

### 2. Real-Time Audio/MIDI Engineer
Owns device enumeration, channel routing, buses, monitoring, MIDI timestamps, built-in instruments, plug-in hosting and ducking. Must protect the real-time thread.

### 3. Video/Composition Engineer
Owns camera capture, canvas scene graph, transforms, GPU composition, A/V sync, source retention, recording and encoding.

### 4. UX/UI Engineer
Owns workspaces, reusable components, responsive layout, inspector, setup wizard, states and accessibility. Uses the renders as direction, not as a requirement to put everything on one page.

### 5. Persistence/Library Engineer
Owns project schema, autosave, migrations, recovery, library, relinking and export metadata.

### 6. QA/Release Engineer
Owns automated tests, device simulations where possible, soak-test tooling, logs/diagnostics, installer/package, clean-machine checklist and release notes.

## Mandatory execution loop
1. Audit repository and existing code. Never overwrite working architecture blindly.
2. Write/update `docs/IMPLEMENTATION_PLAN.md` with architecture, milestones, risks and concrete file-level tasks.
3. Create/update `docs/DECISIONS.md` for architectural decisions and unresolved external constraints.
4. Create/update `docs/BUILD_STATUS.md` as the single source of truth for progress.
5. Implement the smallest end-to-end media vertical slice first.
6. Build and run tests after each meaningful subsystem.
7. Fix compile/test failures immediately; do not stack failures.
8. Integrate subsystem work frequently.
9. Run the app and exercise the actual workflow, not only unit tests.
10. Continue milestone by milestone until Definition of Done is met or only external blockers remain.
11. At the end, produce `FINAL_DELIVERY_REPORT.md` describing what works, tests run, known limitations, exact build/run instructions and release artifact locations.

## No-stop rules
- Do not ask the user to approve routine engineering decisions already resolved by the spec.
- Do not stop to report progress after every milestone.
- Do not return merely because a plan is complete.
- Do not leave TODO placeholders in core paths when the implementation can be completed.
- Do not replace difficult media functionality with fake data in production code.
- Do not claim a feature works unless it has been built and exercised.
- When uncertain, choose the simplest architecture consistent with the spec and record the decision.
- When a dependency is unavailable, isolate it behind an interface and complete the rest of the system.
- Prefer a working, tested V1 over speculative features.

## Engineering gates
### Gate A: Capture proof
One camera + one mic + one stereo keyboard + MIDI can run concurrently and timestamps are coherent.

### Gate B: Record proof
30-minute 1080p recording succeeds with valid output and documented sync tolerance.

### Gate C: Teaching proof
VMK responds to MIDI; built-in sound works; face/hands/VMK scene records.

### Gate D: Full I/O proof
2 cameras, 2 mono mics, 2 stereo keyboard paths, MIDI bus and monitor routing work within documented platform constraints.

### Gate E: Ducking proof
Speech produces natural configurable attenuation of instrument bus without clicks/pumping.

### Gate F: Persistence proof
Save/reopen/autosave/recovery restore the teaching project.

### Gate G: Source-retention proof
Isolated sources and MIDI are synchronized and usable for re-render/review.

### Gate H: Release proof
Clean build, tests, installer/package, quick-start, soak tests and final report.

Do not proceed to heavy cosmetic polish while an earlier media/reliability gate is failing.

## Required repository documents
- README.md
- docs/IMPLEMENTATION_PLAN.md
- docs/ARCHITECTURE.md
- docs/DECISIONS.md
- docs/BUILD_STATUS.md
- docs/DEVICE_SUPPORT.md
- docs/PROJECT_FORMAT.md
- docs/TEST_PLAN.md
- docs/USER_QUICK_START.md
- FINAL_DELIVERY_REPORT.md

## Final response behavior
When all possible work is complete, provide one concise delivery summary with:
- build status,
- release artifact path,
- tests/soak tests performed,
- remaining external blockers only,
- exact command to run/build.
