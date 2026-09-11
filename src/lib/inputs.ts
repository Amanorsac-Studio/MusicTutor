/**
 * The mixer's fixed input slots.
 *
 * These exist from startup whether or not a device is assigned, so the Mixer
 * always shows a complete desk and every strip has a working fader — the same
 * way a hardware mixer has channels before anything is plugged in.
 */

export type InputSlot = {
  id: string;
  label: string;
  /** Shown under the name when nothing is assigned. */
  hint: string;
  /** Voice channels drive the ducking sidechain. */
  isVoice: boolean;
  /** Longer explanation for the Devices page. */
  help?: string;
};

export const INPUT_SLOTS: InputSlot[] = [
  {
    id: 'mic1',
    label: 'Microphone',
    hint: 'Teacher voice',
    isVoice: true,
    help: 'Your speaking microphone. This is what the ducking listens to.',
  },
  {
    id: 'mic2',
    label: 'Microphone 2',
    hint: 'Second voice or room mic',
    isVoice: true,
    help: 'A student mic, or a room mic for an acoustic piano.',
  },
  {
    id: 'inst1',
    label: 'Instrument in',
    hint: 'Line input from a keyboard or audio interface',
    isVoice: false,
    help: 'The audio outputs of a real keyboard, through an audio interface. '
      + 'Captured with all browser processing off, so the signal arrives clean.',
  },
  {
    id: 'inst2',
    label: 'App audio',
    hint: 'Sound from Kontakt or another instrument app',
    isVoice: false,
    help: 'To record what a plug-in host such as Kontakt is playing, route that '
      + 'app’s output into a virtual audio device and select it here.',
  },
];

export const findSlot = (id: string): InputSlot | undefined => INPUT_SLOTS.find(slot => slot.id === id);

/** Describe what a device actually granted, e.g. "48 kHz · stereo". */
export function describeInputQuality(channelCount?: number, sampleRate?: number): string {
  const parts: string[] = [];
  if (sampleRate) parts.push(`${Math.round(sampleRate / 100) / 10} kHz`);
  if (channelCount) parts.push(channelCount >= 2 ? 'stereo' : 'mono');
  return parts.join(' · ');
}
