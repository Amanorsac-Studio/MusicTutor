/**
 * Interactive scene editor.
 *
 * Sources are laid out in 1920x1080 canvas coordinates and drawn here scaled to
 * whatever space the preview has. Dragging, resizing and snapping all work in
 * canvas units, so a layout built in a small window is identical at full
 * resolution in the recording.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  clampToCanvas, hitTest, resizeRect, snapRect,
  type Handle, type Rect, type SnapGuide, type Source,
} from '../lib/scene';
import type { CanvasSize } from '../lib/formats';
import { PianoKeyboard } from './PianoKeyboard';
import { cameraHub } from '../lib/cameraHub';
import { findBackdrop } from '../lib/backdrops';
import type { Accidental } from '../lib/chords';
import { drawStaff } from '../lib/drawStaff';
import { drawFretboard } from '../lib/drawFretboard';
import { BASS_TUNINGS } from '../lib/fretboard';
import { useStudio } from '../lib/useStudio';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export type SceneCanvasProps = {
  /** The active format's layout. */
  sources: Source[];
  /** The layout space these sources are positioned in. */
  canvas: CanvasSize;
  /** Editor magnification. 1 fits the available width. */
  viewZoom?: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (sources: Source[]) => void;
  /** Live playing state, for the keyboard and chord readout. */
  activeNotes: Set<number>;
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  accidental: Accidental;
  chordSymbol?: string;
  chordNumeral?: string;
  /** Disables editing — used while recording so a stray click cannot move a source. */
  locked?: boolean;
};

type DragState =
  | { mode: 'move'; id: string; startRect: Rect; originX: number; originY: number }
  | { mode: 'resize'; id: string; handle: Handle; startRect: Rect; originX: number; originY: number }
  | null;

export function SceneCanvas({
  sources, canvas, viewZoom = 1, selectedId, onSelect, onChange, activeNotes, onNoteOn, onNoteOff,
  accidental, chordSymbol, chordNumeral, locked = false,
}: SceneCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [dragging, setDragging] = useState(false);

  /** Convert a client-space delta into canvas units. */
  const scale = useCallback((): number => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return 1;
    return canvas.width / rect.width;
  }, [canvas.width]);

  const updateSource = useCallback((id: string, patch: Partial<Source>) => {
    onChange(sources.map(source => (source.id === id ? { ...source, ...patch } : source)));
  }, [onChange, sources]);

  /**
   * Size the canvas to the largest box of the right shape that fits the space,
   * then apply the zoom.
   *
   * CSS cannot express this on its own: aspect-ratio with both a max-width and
   * a max-height has no intrinsic size to shrink from, and constraining one
   * axis while fixing the other just squashes the picture. Measuring is exact,
   * and it is what makes portrait and square fill the window at 100% instead of
   * needing to be zoomed out by hand.
   */
  useLayoutEffect(() => {
    const parent = frameRef.current?.parentElement;
    if (!parent) return;

    const fit = () => {
      const style = getComputedStyle(parent);
      const available = {
        width: parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: parent.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      };
      if (available.width <= 0 || available.height <= 0) return;
      const scale = Math.min(available.width / canvas.width, available.height / canvas.height) * viewZoom;
      setBox({
        width: Math.max(1, Math.floor(canvas.width * scale)),
        height: Math.max(1, Math.floor(canvas.height * scale)),
      });
    };

    fit();

    // ResizeObserver is the right tool but is not universal — jsdom has none —
    // so fall back to window resizes rather than letting the editor fail.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [canvas.width, canvas.height, viewZoom]);

  /* ---------------------------------------------------------------- *
   * Pointer interaction
   * ---------------------------------------------------------------- */

  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const factor = scale();
      const dx = (event.clientX - drag.originX) * factor;
      const dy = (event.clientY - drag.originY) * factor;
      const others = sources.filter(s => s.id !== drag.id && s.visible);

      if (drag.mode === 'move') {
        const moved = { ...drag.startRect, x: drag.startRect.x + dx, y: drag.startRect.y + dy };
        // Alt disables snapping for fine placement.
        const snapped = event.altKey ? { rect: moved, guides: [] } : snapRect(moved, others, canvas);
        setGuides(snapped.guides);
        updateSource(drag.id, clampToCanvas(snapped.rect, canvas));
      } else {
        const resized = resizeRect(drag.startRect, drag.handle, dx, dy, event.shiftKey);
        setGuides([]);
        updateSource(drag.id, clampToCanvas(resized, canvas));
      }
    };

    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      setGuides([]);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, scale, sources, updateSource, canvas]);

  const beginMove = (source: Source) => (event: React.PointerEvent) => {
    if (locked || source.locked) return;
    // The keyboard is playable, so only its border starts a drag.
    event.stopPropagation();
    onSelect(source.id);
    dragRef.current = {
      mode: 'move', id: source.id,
      startRect: { x: source.x, y: source.y, width: source.width, height: source.height },
      originX: event.clientX, originY: event.clientY,
    };
    setDragging(true);
  };

  const beginResize = (source: Source, handle: Handle) => (event: React.PointerEvent) => {
    if (locked || source.locked) return;
    event.stopPropagation();
    event.preventDefault();
    onSelect(source.id);
    dragRef.current = {
      mode: 'resize', id: source.id, handle,
      startRect: { x: source.x, y: source.y, width: source.width, height: source.height },
      originX: event.clientX, originY: event.clientY,
    };
    setDragging(true);
  };

  /** Click empty canvas to deselect; click through to the topmost source. */
  const onBackgroundPointerDown = (event: React.PointerEvent) => {
    if (locked) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = scale();
    const x = (event.clientX - rect.left) * factor;
    const y = (event.clientY - rect.top) * factor;
    const hit = hitTest(sources, x, y);
    onSelect(hit ? hit.id : null);
  };

  /* ---------------------------------------------------------------- *
   * Keyboard nudging
   * ---------------------------------------------------------------- */

  useEffect(() => {
    if (!selectedId || locked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const step = event.shiftKey ? 20 : 2;
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      };
      const delta = deltas[event.key];
      if (!delta) return;
      const source = sources.find(s => s.id === selectedId);
      if (!source || source.locked) return;
      event.preventDefault();
      updateSource(selectedId, clampToCanvas({
        x: source.x + delta[0], y: source.y + delta[1], width: source.width, height: source.height,
      }, canvas));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, locked, sources, updateSource, canvas]);

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */

  const percent = (value: number, total: number) => `${(value / total) * 100}%`;

  return (
    <div
      ref={frameRef}
      className={`scene-canvas ${locked ? 'is-locked' : ''}`}
      // Sized to fit the space in both directions. A portrait canvas is taller
      // than the shell is deep, so constraining width alone left it running off
      // the bottom until you zoomed out.
      style={box.width ? { width: box.width, height: box.height } : undefined}
      onPointerDown={onBackgroundPointerDown}
      role="application"
      aria-label="Scene canvas"
    >
      {sources.map(source => {
        if (!source.visible) return null;
        const selected = source.id === selectedId;
        return (
          <div
            key={source.id}
            className={`scene-source kind-${source.kind} ${selected ? 'selected' : ''} ${source.locked ? 'locked' : ''}`}
            style={{
              left: percent(source.x, canvas.width),
              top: percent(source.y, canvas.height),
              width: percent(source.width, canvas.width),
              height: percent(source.height, canvas.height),
              opacity: source.opacity,
              borderRadius: `${((source.props.radius ?? 0) / canvas.width) * 100}%`,
            }}
            onPointerDown={source.kind === 'keyboard' ? undefined : beginMove(source)}
          >
            <SourceBody
              source={source}
              canvasWidth={canvas.width}
              activeNotes={activeNotes}
              onNoteOn={onNoteOn}
              onNoteOff={onNoteOff}
              accidental={accidental}
              chordSymbol={chordSymbol}
              chordNumeral={chordNumeral}
            />

            {/* A playable keyboard needs a drag strip, since its face plays notes. */}
            {source.kind === 'keyboard' && !locked && !source.locked && (
              <button
                className="scene-drag-strip"
                aria-label={`Move ${source.name}`}
                onPointerDown={beginMove(source)}
              >⠿</button>
            )}

            {selected && !locked && !source.locked && HANDLES.map(handle => (
              <span
                key={handle}
                className={`scene-handle handle-${handle}`}
                onPointerDown={beginResize(source, handle)}
                role="presentation"
              />
            ))}
          </div>
        );
      })}

      {guides.map((guide, index) => (
        <span
          key={`${guide.axis}-${guide.position}-${index}`}
          className={`snap-guide ${guide.axis}`}
          style={guide.axis === 'x'
            ? { left: percent(guide.position, canvas.width) }
            : { top: percent(guide.position, canvas.height) }}
        />
      ))}

      {!sources.length && (
        <div className="scene-empty">
          <b>Empty scene</b>
          <small>Add a source from the left panel to start building your layout.</small>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Source rendering
 * ------------------------------------------------------------------ */

function SourceBody({
  source, canvasWidth, activeNotes, onNoteOn, onNoteOff, accidental, chordSymbol, chordNumeral,
}: {
  source: Source;
  canvasWidth: number;
  activeNotes: Set<number>;
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  accidental: Accidental;
  chordSymbol?: string;
  chordNumeral?: string;
}) {
  const { props } = source;

  switch (source.kind) {
    case 'backdrop':
      return <div className="source-fill" style={{ background: findBackdrop(props.backdrop).css }} />;

    case 'color':
      return <div className="source-fill" style={{ background: props.background ?? '#0b1a2b' }} />;

    case 'camera':
      return (
        <CameraView
          deviceId={props.deviceId}
          fit={props.fit ?? 'cover'}
          mirror={props.mirror}
          zoom={props.zoom ?? 1}
          panX={props.panX ?? 0}
          panY={props.panY ?? 0}
          name={source.name}
        />
      );

    case 'image':
      return props.src
        ? <img
            className="source-image"
            src={props.src}
            alt={source.name}
            // CSS has no "stretch" keyword; fill is the equivalent behaviour.
            style={{ objectFit: props.fit === 'stretch' ? 'fill' : props.fit ?? 'contain' }}
          />
        : <div className="source-placeholder"><small>No image chosen</small></div>;

    case 'text':
      return (
        <div
          className="source-text"
          style={{
            background: props.background && props.background !== 'transparent' ? props.background : undefined,
            color: props.color ?? '#fff',
            justifyContent: props.align === 'center' ? 'center' : props.align === 'right' ? 'flex-end' : 'flex-start',
            textAlign: props.align ?? 'left',
            // Font size is in canvas units; cqw makes it scale with the preview.
            fontSize: `${((props.fontSize ?? 72) / canvasWidth) * 100}cqw`,
            fontWeight: props.fontWeight ?? 700,
            lineHeight: props.lineHeight ?? 1.15,
          }}
        >
          <span>{props.text || ' '}</span>
        </div>
      );

    case 'chord': {
      const mode = props.chordMode ?? 'both';
      const base = props.fontSize ?? 84;
      const numeralSize = base * Math.min(3, Math.max(0.2, props.numeralScale ?? 0.5));
      const showName = mode !== 'numerals';
      const showNumeral = mode !== 'names' && Boolean(chordNumeral);
      return (
        <div
          className="source-chord"
          style={{
            background: props.background && props.background !== 'transparent' ? props.background : undefined,
            color: props.color ?? '#fff',
            alignItems: props.align === 'center' ? 'center' : props.align === 'right' ? 'flex-end' : 'flex-start',
          }}
        >
          {showName && (
            <b style={{ fontSize: `${(base / canvasWidth) * 100}cqw` }}>{chordSymbol || '—'}</b>
          )}
          {showNumeral && (
            <i style={{ fontSize: `${(numeralSize / canvasWidth) * 100}cqw` }}>{chordNumeral}</i>
          )}
        </div>
      );
    }

    case 'keyboard':
      return (
        <PianoKeyboard
          active={activeNotes}
          onNoteOn={onNoteOn}
          onNoteOff={onNoteOff}
          range={{ first: props.firstNote ?? 21, last: props.lastNote ?? 108 }}
          accidental={accidental}
          accent={props.accent ?? '#1d9cff'}
          showAllLabels={props.showLabels === 'all'}
          hideLabels={props.showLabels === 'none'}
          namePlayed={props.namePlayed !== false}
          fill
          computerKeys
        />
      );

    case 'fretboard':
      return (
        <FretboardView
          accidental={accidental}
          accent={props.accent ?? '#ffa629'}
          background={props.background ?? 'rgba(6,16,26,0.78)'}
          showReadout={props.namePlayed !== false}
        />
      );

    case 'staff':
      return (
        <StaffView
          active={activeNotes}
          liveLabel={chordSymbol}
          accidental={accidental}
          accent={props.accent ?? '#ffa629'}
          ink={props.color ?? '#0d1420'}
          paper={props.background ?? 'rgba(255,255,255,0.94)'}
          nameNotes={props.namePlayed !== false}
        />
      );

    default:
      return null;
  }
}

/**
 * The staff preview, drawn with the same renderer the recording uses so the
 * editor cannot drift from the output.
 *
 * The backing canvas is a fixed size and stretched by CSS: the staff scales
 * cleanly, and it saves watching the element for size changes.
 */
function StaffView({
  active, liveLabel, accidental, accent, ink, paper, nameNotes,
}: {
  active: Set<number>;
  liveLabel?: string;
  accidental: Accidental;
  accent: string;
  ink: string;
  paper: string;
  nameNotes: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // A key that changes whenever the sounding notes do, so the effect reruns
  // without depending on a Set's identity.
  const notes = [...active].sort((a, b) => a - b).join(',');

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const sounding = notes ? notes.split(',').map(Number) : [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStaff(ctx, { width: canvas.width, height: canvas.height }, {
      columns: [{ id: 'live', notes: sounding, label: liveLabel, live: true }],
      accidental,
      accent,
      ink,
      paper,
      showLabels: nameNotes,
    });
  }, [notes, liveLabel, accidental, accent, ink, paper, nameNotes]);

  return <canvas className="source-staff" ref={ref} width={760} height={400} />;
}

/** Shows a camera from the shared hub, keeping one stream per device. */
function CameraView({
  deviceId, fit, mirror, zoom, panX, panY, name,
}: {
  deviceId?: string; fit: 'cover' | 'contain' | 'stretch'; mirror?: boolean;
  zoom: number; panX: number; panY: number; name: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'idle' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!deviceId) { setStatus('idle'); return; }
    let cancelled = false;

    void cameraHub.acquire(deviceId).then(() => {
      if (cancelled) return;
      const error = cameraHub.errorFor(deviceId);
      if (error) { setStatus('error'); return; }
      const element = videoRef.current;
      if (!element) return;
      // Several views share one stream; attaching it is enough, and the element
      // stays React's to own so it is never removed behind React's back.
      element.srcObject = cameraHub.stream(deviceId) ?? null;
      void element.play().catch(() => {});
      setStatus('ready');
    });

    return () => {
      cancelled = true;
      if (videoRef.current) videoRef.current.srcObject = null;
      cameraHub.release(deviceId);
    };
  }, [deviceId]);

  // Zoom is a scale about a pan-shifted origin, matching applyZoom on canvas.
  const factor = Math.max(1, zoom);
  const shift = (pan: number) => `${(-Math.min(1, Math.max(-1, pan)) * (factor - 1) * 50) / factor}%`;

  return (
    <div className="source-camera" data-fit={fit} data-mirror={mirror ? 'yes' : 'no'}>
      <video
        ref={videoRef}
        className="source-video"
        muted
        playsInline
        autoPlay
        style={factor > 1
          ? { transform: `scale(${factor}) translate(${shift(panX)}, ${shift(panY)})` }
          : undefined}
      />
      {status !== 'ready' && (
        <span className="source-placeholder">
          <small>{status === 'error' ? 'Camera unavailable' : deviceId ? 'Starting…' : `${name}: choose a device`}</small>
        </span>
      )}
    </div>
  );
}

/**
 * The neck preview, drawn with the recording's own renderer.
 *
 * It reads the bass note from the studio itself rather than through props, as
 * the note changes many times a second and threading it through every layer of
 * the editor would re-render all of them each time.
 */
function FretboardView({
  accidental, accent, background, showReadout,
}: {
  accidental: Accidental;
  accent: string;
  background: string;
  showReadout: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { bassNote, bassPosition, settings } = useStudio();
  const midi = bassNote?.midi ?? null;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFretboard(ctx, { width: canvas.width, height: canvas.height }, {
      tuning: BASS_TUNINGS[settings.bassTuning],
      midi,
      position: bassPosition,
      keyRoot: settings.keyRoot,
      accidental,
      accent,
      background,
      showReadout,
    });
  }, [midi, bassPosition, settings.bassTuning, settings.keyRoot, accidental, accent, background, showReadout]);

  return <canvas className="source-staff" ref={ref} width={1400} height={336} />;
}
