/**
 * Virtual MIDI keyboard.
 *
 * Layout is geometric rather than hand-tuned: white keys tile the width evenly
 * and each black key is centred on the boundary between its neighbours, with
 * the small horizontal offsets a real keyboard has (C#/D# sit slightly left and
 * right of centre in their group of two, F#/G#/A# across their group of three).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isBlackKey, noteLabel, noteName, octaveOf, pitchClass, type Accidental } from '../lib/chords';

export type KeyRange = { first: number; last: number };

/** Standard sizes. 88 keys = A0..C8, the full acoustic piano compass. */
export const KEY_RANGES: Record<string, KeyRange> = {
  '25': { first: 48, last: 72 },
  '37': { first: 48, last: 84 },
  '49': { first: 36, last: 84 },
  '61': { first: 36, last: 96 },
  '76': { first: 28, last: 103 },
  '88': { first: 21, last: 108 },
};

/**
 * Offset (in white-key widths) applied to a black key relative to the boundary
 * it sits on. Mirrors the geometry of a real keyboard.
 */
const BLACK_KEY_NUDGE: Record<number, number> = {
  1: -0.09,  // C#
  3: 0.09,   // D#
  6: -0.11,  // F#
  8: 0,      // G#
  10: 0.11,  // A#
};

/** Computer-keyboard mapping, laid out like a piano across two rows. */
const COMPUTER_KEYS: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17,
};

export type PianoKeyboardProps = {
  /** Notes currently sounding, from any source (mouse, computer keys, MIDI). */
  active: Set<number>;
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  range?: KeyRange;
  accidental?: Accidental;
  /** Highlight colour for pressed keys. */
  accent?: string;
  /** Show note names on every white key rather than only on C. */
  showAllLabels?: boolean;
  /** Hide all key labels. */
  hideLabels?: boolean;
  /** Name each sounding note above its key, as a teaching callout. */
  namePlayed?: boolean;
  /** Stretch to fill the container instead of using a fixed key height. */
  fill?: boolean;
  compact?: boolean;
  /** Pitch classes to mark as belonging to the current key or scale. */
  highlightPitchClasses?: number[];
  /** Enable the computer-keyboard mapping. */
  computerKeys?: boolean;
  /** Octave offset applied to the computer-keyboard mapping. */
  computerKeyOctave?: number;
  className?: string;
};

export function PianoKeyboard({
  active,
  onNoteOn,
  onNoteOff,
  range = KEY_RANGES['88'],
  accidental = 'sharp',
  accent = '#1d9cff',
  showAllLabels = false,
  hideLabels = false,
  namePlayed = false,
  fill = false,
  compact = false,
  highlightPitchClasses,
  computerKeys = false,
  computerKeyOctave = 0,
  className = '',
}: PianoKeyboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** Notes this component is holding down, so it only releases its own. */
  const held = useRef(new Set<number>());
  const pointerDown = useRef(false);
  const [hovered, setHovered] = useState<number | null>(null);

  const { whites, blacks, whiteIndexOf } = useMemo(() => {
    const whiteList: number[] = [];
    const blackList: number[] = [];
    const indexMap = new Map<number, number>();
    for (let note = range.first; note <= range.last; note++) {
      if (isBlackKey(note)) blackList.push(note);
      else {
        indexMap.set(note, whiteList.length);
        whiteList.push(note);
      }
    }
    return { whites: whiteList, blacks: blackList, whiteIndexOf: indexMap };
  }, [range.first, range.last]);

  /** Left edge of a black key as a percentage of total width. */
  const blackKeyLeft = useCallback(
    (note: number): number => {
      // The boundary a black key straddles is the one after the white key below it.
      let below = note - 1;
      while (below >= range.first && isBlackKey(below)) below--;
      const index = whiteIndexOf.get(below);
      if (index === undefined) return 0;
      const nudge = BLACK_KEY_NUDGE[pitchClass(note)] ?? 0;
      return ((index + 1 + nudge) / whites.length) * 100;
    },
    [range.first, whiteIndexOf, whites.length],
  );

  const press = useCallback(
    (note: number, velocity: number) => {
      if (held.current.has(note)) return;
      held.current.add(note);
      onNoteOn(note, velocity);
    },
    [onNoteOn],
  );

  const release = useCallback(
    (note: number) => {
      if (!held.current.has(note)) return;
      held.current.delete(note);
      onNoteOff(note);
    },
    [onNoteOff],
  );

  const releaseAll = useCallback(() => {
    [...held.current].forEach(note => {
      held.current.delete(note);
      onNoteOff(note);
    });
  }, [onNoteOff]);

  /**
   * Velocity from where the key was struck: near the pivot (top) is quiet, the
   * front edge is loud, as on a weighted keyboard.
   */
  const velocityFromEvent = (event: React.PointerEvent<HTMLElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.height) return 0.72;
    const depth = (event.clientY - rect.top) / rect.height;
    return Math.min(1, Math.max(0.25, 0.4 + depth * 0.6));
  };

  // A pointer released anywhere — including outside the keyboard — must end the
  // note. Without this, dragging off a key leaves it sounding forever.
  useEffect(() => {
    const stop = () => {
      pointerDown.current = false;
      releaseAll();
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, [releaseAll]);

  // Release everything if the component unmounts mid-press.
  useEffect(() => releaseAll, [releaseAll]);

  // Computer-keyboard input, ignored while the user is typing in a field.
  useEffect(() => {
    if (!computerKeys) return;
    const isTyping = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
    };
    const base = 60 + computerKeyOctave * 12;

    const down = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;
      const offset = COMPUTER_KEYS[event.key.toLowerCase()];
      if (offset === undefined) return;
      event.preventDefault();
      press(base + offset, 0.72);
    };
    const up = (event: KeyboardEvent) => {
      const offset = COMPUTER_KEYS[event.key.toLowerCase()];
      if (offset === undefined) return;
      release(base + offset);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [computerKeys, computerKeyOctave, press, release]);

  const handlePointerDown = (note: number) => (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    pointerDown.current = true;
    press(note, velocityFromEvent(event));
  };

  // Glissando: sliding across the keys plays each one in turn.
  const handlePointerEnter = (note: number) => (event: React.PointerEvent<HTMLElement>) => {
    setHovered(note);
    if (!pointerDown.current) return;
    press(note, velocityFromEvent(event));
  };

  const handlePointerLeave = (note: number) => () => {
    setHovered(current => (current === note ? null : current));
    if (pointerDown.current) release(note);
  };

  const inScale = (note: number) =>
    highlightPitchClasses ? highlightPitchClasses.includes(pitchClass(note)) : false;

  const keyClasses = (note: number, black: boolean) => {
    const classes = [black ? 'pk-black' : 'pk-white'];
    if (active.has(note)) classes.push('pk-active');
    if (inScale(note)) classes.push('pk-in-scale');
    if (hovered === note) classes.push('pk-hover');
    if (pitchClass(note) === 0) classes.push('pk-c');
    return classes.join(' ');
  };

  const whiteWidth = 100 / Math.max(1, whites.length);

  return (
    <div
      ref={containerRef}
      className={`piano-keyboard ${compact ? 'pk-compact' : ''} ${fill ? 'pk-fill' : ''} ${className}`}
      style={{ ['--pk-accent' as string]: accent }}
      role="group"
      aria-label={`Virtual piano keyboard, ${noteLabel(range.first, accidental)} to ${noteLabel(range.last, accidental)}`}
    >
      {namePlayed && (
        <div className="pk-callouts" aria-hidden="true">
          {[...active].sort((a, b) => a - b).map(note => {
            // Position the name over the key it belongs to.
            const left = isBlackKey(note)
              ? blackKeyLeft(note) + (whiteWidth * 0.62) / 2
              : ((whiteIndexOf.get(note) ?? 0) + 0.5) * whiteWidth;
            if (note < range.first || note > range.last) return null;
            return (
              <span key={note} className="pk-callout" style={{ left: `${left}%` }}>
                {noteName(note, accidental)}
              </span>
            );
          })}
        </div>
      )}
      <div className="pk-felt" aria-hidden="true" />
      <div className="pk-keys">
        <div className="pk-white-row">
          {whites.map(note => (
            <button
              key={note}
              type="button"
              className={keyClasses(note, false)}
              style={{ width: `${whiteWidth}%` }}
              aria-label={noteLabel(note, accidental)}
              aria-pressed={active.has(note)}
              onPointerDown={handlePointerDown(note)}
              onPointerEnter={handlePointerEnter(note)}
              onPointerLeave={handlePointerLeave(note)}
              onContextMenu={event => event.preventDefault()}
            >
              <span className="pk-label">
                {hideLabels
                  ? ''
                  : showAllLabels
                    ? noteName(note, accidental)
                    : pitchClass(note) === 0
                      ? `C${octaveOf(note)}`
                      : ''}
              </span>
            </button>
          ))}
        </div>
        <div className="pk-black-row" aria-hidden="false">
          {blacks.map(note => (
            <button
              key={note}
              type="button"
              className={keyClasses(note, true)}
              style={{ left: `${blackKeyLeft(note)}%`, width: `${whiteWidth * 0.62}%` }}
              aria-label={noteLabel(note, accidental)}
              aria-pressed={active.has(note)}
              onPointerDown={handlePointerDown(note)}
              onPointerEnter={handlePointerEnter(note)}
              onPointerLeave={handlePointerLeave(note)}
              onContextMenu={event => event.preventDefault()}
            >
              {showAllLabels && !hideLabels && <span className="pk-label pk-black-label">{noteName(note, accidental)}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
