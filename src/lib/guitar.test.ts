import { describe, expect, it } from 'vitest';
import { guitarShape, shapeNotes, shapeReach } from './guitar';
import { CHORD_SHAPES, type ChordQuality } from './chordTrack';

const QUALITIES = Object.keys(CHORD_SHAPES) as ChordQuality[];

describe('guitarShape', () => {
  it('only ever sounds notes that belong to the chord, for every chord there is', () => {
    for (let root = 0; root < 12; root += 1) {
      QUALITIES.forEach(quality => {
        const allowed = CHORD_SHAPES[quality].map(interval => (root + interval) % 12);
        const sounded = shapeNotes(guitarShape(root, quality)).filter((n): n is number => n !== null);
        expect(sounded.length, `${root} ${quality}`).toBeGreaterThanOrEqual(3);
        sounded.forEach(note => expect(allowed, `${root} ${quality} sounds ${note % 12}`).toContain(note % 12));
        expect(sounded.map(note => note % 12), `${root} ${quality} has its root`).toContain(root);
      });
    }
  });

  it('puts the root at the bottom of a barre shape', () => {
    const lowest = shapeNotes(guitarShape(5, 'maj')).find(note => note !== null);
    expect((lowest as number) % 12).toBe(5);
  });

  it('uses the open shape everyone knows where there is one', () => {
    expect(guitarShape(7, 'maj')).toEqual([3, 2, 0, 0, 0, 3]);
    expect(guitarShape(9, 'min')).toEqual([-1, 0, 2, 2, 1, 0]);
  });

  it('stays within reach of one hand', () => {
    for (let root = 0; root < 12; root += 1) {
      QUALITIES.forEach(quality => {
        const frets = guitarShape(root, quality).filter(fret => fret > 0);
        expect(Math.max(...frets) - Math.min(...frets), `${root} ${quality}`).toBeLessThanOrEqual(4);
      });
    }
  });

  it('asks for enough neck to draw the shape on', () => {
    expect(shapeReach(guitarShape(0, 'maj'))).toBeGreaterThanOrEqual(5);
    expect(shapeReach(guitarShape(3, 'maj'))).toBeGreaterThan(Math.max(...guitarShape(3, 'maj')));
  });
});
