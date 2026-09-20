import { describe, expect, it } from 'vitest';
import { defaultScenes, missingDefaultScenes } from './defaultScenes';
import { normalizeScenes } from './scene';

describe('default scenes', () => {
  it('are PIANO and BASS', () => {
    expect(defaultScenes().map(scene => scene.name)).toEqual(['PIANO', 'BASS']);
  });

  it('come with something in them, in landscape and, for piano, portrait', () => {
    const [piano, bass] = defaultScenes();
    expect(piano.layouts.landscape?.map(source => source.kind)).toEqual(
      ['backdrop', 'camera', 'keyboard', 'camera', 'chord', 'text'],
    );
    expect(piano.layouts.portrait?.length).toBeGreaterThan(0);
    expect(bass.layouts.landscape?.map(source => source.kind)).toContain('fretboard');
  });

  it('survive the same clean-up stored scenes go through', () => {
    const built = defaultScenes();
    const again = normalizeScenes(JSON.parse(JSON.stringify(built)));
    expect(again.map(scene => scene.layouts.landscape?.length)).toEqual(built.map(scene => scene.layouts.landscape?.length));
  });

  it('carry no camera from the computer they were made on', () => {
    const cameras = defaultScenes().flatMap(scene =>
      Object.values(scene.layouts).flatMap(list => (list ?? []).filter(source => source.kind === 'camera')));
    expect(cameras.length).toBeGreaterThan(0);
    cameras.forEach(source => expect(source.props.deviceId).toBeUndefined());
  });

  it('are built fresh every time, so no two scenes ever share an id', () => {
    const ids = (scenes: ReturnType<typeof defaultScenes>) => scenes.flatMap(scene => [
      scene.id, ...Object.values(scene.layouts).flatMap(list => (list ?? []).map(source => source.id)),
    ]);
    const first = ids(defaultScenes());
    const second = ids(defaultScenes());
    expect(new Set([...first, ...second]).size).toBe(first.length + second.length);
  });

  it('can be edited without changing the next set that is built', () => {
    const [piano] = defaultScenes();
    piano.layouts.landscape![0].x = 999;
    expect(defaultScenes()[0].layouts.landscape![0].x).toBe(0);
  });
});

describe('missingDefaultScenes', () => {
  it('gives back only the ones that are gone', () => {
    const [piano] = defaultScenes();
    expect(missingDefaultScenes([piano]).map(scene => scene.name)).toEqual(['BASS']);
  });

  it('is empty when both are there, whatever the case', () => {
    const [piano, bass] = defaultScenes();
    expect(missingDefaultScenes([{ ...piano, name: 'piano ' }, bass])).toEqual([]);
  });

  it('brings back both after a clean slate', () => {
    expect(missingDefaultScenes([]).map(scene => scene.name)).toEqual(['PIANO', 'BASS']);
  });
});
