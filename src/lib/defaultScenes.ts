/**
 * The scenes a new installation starts with.
 *
 * PIANO and BASS are the two layouts the app was designed around: a keyboard
 * lesson with both cameras, the chord readout and a title, and a bass lesson
 * with the neck, the note display and a title. They are stored here without
 * ids and without camera devices. Ids are made fresh every time a scene is
 * built from them, so two scenes never share a source, and a camera belongs to
 * the computer it is plugged into, not to a layout that travels.
 */

import { createId, type Scene, type SceneLayouts, type Source } from './scene';

type SourceTemplate = Omit<Source, 'id'>;
type SceneTemplate = { name: string; layouts: Partial<Record<keyof SceneLayouts, SourceTemplate[]>> };

const TEMPLATES: SceneTemplate[] = [
  {
    name: 'PIANO',
    layouts: {
      landscape: [
        {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'backdrop',
          name: 'Backdrop',
          props: {
            backdrop: 'blue',
            radius: 0
          }
        },
        {
          x: 0,
          y: 613,
          width: 1920,
          height: 467,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'camera',
          name: 'Hand camera',
          props: {
            fit: 'cover',
            mirror: false,
            radius: 10,
            role: 'hand',
            zoom: 1,
            panX: 0,
            panY: 0
          }
        },
        {
          x: 0,
          y: 509,
          width: 1920,
          height: 318,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'keyboard',
          name: 'Virtual keyboard',
          props: {
            firstNote: 21,
            lastNote: 108,
            accent: '#ffa629',
            showLabels: 'c-only',
            namePlayed: true,
            radius: 12
          }
        },
        {
          x: 617,
          y: 0,
          width: 647,
          height: 508,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'camera',
          name: 'Face camera',
          props: {
            fit: 'cover',
            mirror: true,
            radius: 18,
            role: 'face',
            zoom: 1,
            panX: 0,
            panY: 0
          }
        },
        {
          x: 0,
          y: 0,
          width: 615,
          height: 514,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'chord',
          name: 'Chord readout',
          props: {
            color: '#ffffff',
            fontSize: 84,
            background: 'rgba(6,16,26,0.72)',
            chordMode: 'both',
            numeralScale: 1.58,
            align: 'left',
            radius: 14
          }
        },
        {
          x: 1263,
          y: 0,
          width: 657,
          height: 518,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'text',
          name: 'Text',
          props: {
            text: 'Lesson \ntitle',
            fontSize: 154,
            fontWeight: 700,
            align: 'center',
            color: '#ffffff',
            lineHeight: 1.15,
            background: 'transparent'
          }
        }
      ],
      portrait: [
        {
          x: 0,
          y: 0,
          width: 1080,
          height: 1920,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'backdrop',
          name: 'Backdrop',
          props: {
            backdrop: 'blue',
            radius: 0
          }
        },
        {
          x: 0,
          y: 1373,
          width: 1080,
          height: 263,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'camera',
          name: 'Hand camera',
          props: {
            fit: 'cover',
            mirror: false,
            radius: 10,
            role: 'hand',
            zoom: 1,
            panX: 0,
            panY: 0
          }
        },
        {
          x: 0,
          y: 1098,
          width: 1080,
          height: 179,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'keyboard',
          name: 'Virtual keyboard',
          props: {
            firstNote: 21,
            lastNote: 108,
            accent: '#ffa629',
            showLabels: 'c-only',
            namePlayed: true,
            radius: 12
          }
        },
        {
          x: 347,
          y: 309,
          width: 364,
          height: 286,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'camera',
          name: 'Face camera',
          props: {
            fit: 'cover',
            mirror: true,
            radius: 18,
            role: 'face',
            zoom: 1,
            panX: 0,
            panY: 0
          }
        },
        {
          x: 0,
          y: 312,
          width: 346,
          height: 289,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'chord',
          name: 'Chord readout',
          props: {
            color: '#ffffff',
            fontSize: 47,
            background: 'rgba(6,16,26,0.72)',
            chordMode: 'both',
            numeralScale: 1.58,
            align: 'left',
            radius: 14
          }
        },
        {
          x: 710,
          y: 315,
          width: 370,
          height: 291,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'text',
          name: 'Text',
          props: {
            text: 'Lesson \ntitle',
            fontSize: 87,
            fontWeight: 700,
            align: 'center',
            color: '#ffffff',
            lineHeight: 1.15,
            background: 'transparent'
          }
        }
      ]
    }
  },
  {
    name: 'BASS',
    layouts: {
      landscape: [
        {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'backdrop',
          name: 'Backdrop',
          props: {
            backdrop: 'studio',
            radius: 0
          }
        },
        {
          x: 0,
          y: 743,
          width: 1920,
          height: 337,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'fretboard',
          name: 'Bass fretboard',
          props: {
            accent: '#ffa629',
            background: 'rgba(6,16,26,0.78)',
            namePlayed: true,
            radius: 14
          }
        },
        {
          x: 0,
          y: 0,
          width: 1083,
          height: 742,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'camera',
          name: 'Face camera',
          props: {
            fit: 'cover',
            mirror: true,
            radius: 18,
            role: 'face',
            zoom: 1,
            panX: 0,
            panY: 0
          }
        },
        {
          x: 1075,
          y: 371,
          width: 845,
          height: 376,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'notes',
          name: 'Note display',
          props: {
            noteMode: 'names',
            color: '#ffffff',
            accent: '#ffa629',
            background: 'rgba(6,16,26,0.72)',
            align: 'center',
            radius: 16
          }
        },
        {
          x: 1053,
          y: 0,
          width: 867,
          height: 373,
          visible: true,
          locked: false,
          opacity: 1,
          kind: 'text',
          name: 'Text',
          props: {
            text: 'Lesson title',
            fontSize: 130,
            fontWeight: 700,
            align: 'center',
            color: '#ffffff',
            lineHeight: 1.15,
            background: 'transparent'
          }
        }
      ]
    }
  }
] as SceneTemplate[];

const build = (template: SceneTemplate): Scene => {
  const layouts: SceneLayouts = {};
  (Object.keys(template.layouts) as Array<keyof SceneLayouts>).forEach(format => {
    layouts[format] = (template.layouts[format] ?? []).map(source =>
      ({ ...source, id: createId(source.kind), props: { ...source.props } }) as Source);
  });
  return { id: createId('scene'), name: template.name, layouts };
};

/** Every default scene, freshly built. */
export const defaultScenes = (): Scene[] => TEMPLATES.map(build);

/** The default scenes whose names are not already taken, for restoring the ones that were deleted. */
export const missingDefaultScenes = (existing: Scene[]): Scene[] => {
  const taken = new Set(existing.map(scene => scene.name.trim().toLowerCase()));
  return TEMPLATES.filter(template => !taken.has(template.name.toLowerCase())).map(build);
};
