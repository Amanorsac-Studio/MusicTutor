/**
 * Interactive scene editor.
 *
 * Sources are laid out in 1920x1080 canvas coordinates and drawn here scaled to
 * whatever space the preview has. Dragging, resizing and snapping all work in
 * canvas units, so a layout built in a small window is identical at full
 * resolution in the recording.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CANVAS_HEIGHT, CANVAS_WIDTH, clampToCanvas, hitTest, resizeRect, snapRect,
  type Handle, type Rect, type Scene, type SnapGuide, type Source,
} from '../lib/scene';
import { PianoKeyboard } from './PianoKeyboard';
import { cameraHub } from '../lib/cameraHub';
import type { Accidental } from '../lib/chords';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export type SceneCanvasProps = {
  scene: Scene;
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
  scene, selectedId, onSelect, onChange, activeNotes, onNoteOn, onNoteOff,
  accidental, chordSymbol, chordNumeral, locked = false,
}: SceneCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [dragging, setDragging] = useState(false);

  /** Convert a client-space delta into canvas units. */
  const scale = useCallback((): number => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return 1;
    return CANVAS_WIDTH / rect.width;
  }, []);

  const updateSource = useCallback((id: string, patch: Partial<Source>) => {
    onChange(scene.sources.map(source => (source.id === id ? { ...source, ...patch } : source)));
  }, [onChange, scene.sources]);

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
      const others = scene.sources.filter(s => s.id !== drag.id && s.visible);

      if (drag.mode === 'move') {
        const moved = { ...drag.startRect, x: drag.startRect.x + dx, y: drag.startRect.y + dy };
        // Alt disables snapping for fine placement.
        const snapped = event.altKey ? { rect: moved, guides: [] } : snapRect(moved, others);
        setGuides(snapped.guides);
        updateSource(drag.id, clampToCanvas(snapped.rect));
      } else {
        const resized = resizeRect(drag.startRect, drag.handle, dx, dy, event.shiftKey);
        setGuides([]);
        updateSource(drag.id, clampToCanvas(resized));
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
  }, [dragging, scale, scene.sources, updateSource]);

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
    const hit = hitTest(scene.sources, x, y);
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
      const source = scene.sources.find(s => s.id === selectedId);
      if (!source || source.locked) return;
      event.preventDefault();
      updateSource(selectedId, clampToCanvas({
        x: source.x + delta[0], y: source.y + delta[1], width: source.width, height: source.height,
      }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, locked, scene.sources, updateSource]);

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */

  const percent = (value: number, total: number) => `${(value / total) * 100}%`;

  return (
    <div
      ref={frameRef}
      className={`scene-canvas ${locked ? 'is-locked' : ''}`}
      onPointerDown={onBackgroundPointerDown}
      role="application"
      aria-label="Scene canvas"
    >
      {scene.sources.map(source => {
        if (!source.visible) return null;
        const selected = source.id === selectedId;
        return (
          <div
            key={source.id}
            className={`scene-source kind-${source.kind} ${selected ? 'selected' : ''} ${source.locked ? 'locked' : ''}`}
            style={{
              left: percent(source.x, CANVAS_WIDTH),
              top: percent(source.y, CANVAS_HEIGHT),
              width: percent(source.width, CANVAS_WIDTH),
              height: percent(source.height, CANVAS_HEIGHT),
              opacity: source.opacity,
              borderRadius: `${((source.props.radius ?? 0) / CANVAS_WIDTH) * 100}%`,
            }}
            onPointerDown={source.kind === 'keyboard' ? undefined : beginMove(source)}
          >
            <SourceBody
              source={source}
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
            ? { left: percent(guide.position, CANVAS_WIDTH) }
            : { top: percent(guide.position, CANVAS_HEIGHT) }}
        />
      ))}

      {!scene.sources.length && (
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
  source, activeNotes, onNoteOn, onNoteOff, accidental, chordSymbol, chordNumeral,
}: {
  source: Source;
  activeNotes: Set<number>;
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  accidental: Accidental;
  chordSymbol?: string;
  chordNumeral?: string;
}) {
  const { props } = source;

  switch (source.kind) {
    case 'color':
      return <div className="source-fill" style={{ background: props.background ?? '#0b1a2b' }} />;

    case 'camera':
      return <CameraView deviceId={props.deviceId} fit={props.fit ?? 'cover'} mirror={props.mirror} name={source.name} />;

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
            fontSize: `${((props.fontSize ?? 72) / CANVAS_WIDTH) * 100}cqw`,
            fontWeight: props.fontWeight ?? 700,
            lineHeight: props.lineHeight ?? 1.15,
          }}
        >
          <span>{props.text || ' '}</span>
        </div>
      );

    case 'chord':
      return (
        <div
          className="source-chord"
          style={{
            background: props.background && props.background !== 'transparent' ? props.background : undefined,
            color: props.color ?? '#fff',
            alignItems: props.align === 'center' ? 'center' : props.align === 'right' ? 'flex-end' : 'flex-start',
            fontSize: `${((props.fontSize ?? 84) / CANVAS_WIDTH) * 100}cqw`,
          }}
        >
          <b>{chordSymbol || '—'}</b>
          {props.showRoman && chordNumeral && <i>{chordNumeral}</i>}
        </div>
      );

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
          fill
          computerKeys
        />
      );

    default:
      return null;
  }
}

/** Shows a camera from the shared hub, keeping one stream per device. */
function CameraView({
  deviceId, fit, mirror, name,
}: { deviceId?: string; fit: 'cover' | 'contain' | 'stretch'; mirror?: boolean; name: string }) {
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

  return (
    <div className="source-camera" data-fit={fit} data-mirror={mirror ? 'yes' : 'no'}>
      <video ref={videoRef} className="source-video" muted playsInline autoPlay />
      {status !== 'ready' && (
        <span className="source-placeholder">
          <small>{status === 'error' ? 'Camera unavailable' : deviceId ? 'Starting…' : `${name}: choose a device`}</small>
        </span>
      )}
    </div>
  );
}
