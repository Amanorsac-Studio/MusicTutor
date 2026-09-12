import { describe, expect, it } from 'vitest';
import {
  filterPlugins, findVirtualCables, formatLabel, isVirtualCable, looksLikeInstrument,
  sortPlugins, tidyName, type Plugin,
} from './plugins';

const plugin = (name: string, vendor?: string): Plugin =>
  ({ path: `C:/x/${name}`, name, vendor, format: 'vst3', launchable: false });

describe('tidyName', () => {
  it('drops the extension', () => {
    expect(tidyName('Omnisphere.vst3')).toBe('Omnisphere');
    expect(tidyName('Kontakt 8.exe')).toBe('Kontakt 8');
  });

  it('drops the bit depth installers add', () => {
    expect(tidyName('Serum_x64.dll')).toBe('Serum');
    expect(tidyName('Massive 64bit.vst3')).toBe('Massive');
  });

  it('drops the format when it is repeated in the name', () => {
    expect(tidyName('Pigments VST3.vst3')).toBe('Pigments');
  });

  it('turns underscores into spaces', () => {
    expect(tidyName('Analog_Lab_V.vst3')).toBe('Analog Lab V');
  });

  it('leaves an ordinary name alone', () => {
    expect(tidyName('Auto-Tune Pro.vst3')).toBe('Auto-Tune Pro');
  });
});

describe('looksLikeInstrument', () => {
  it('accepts a real instrument', () => {
    expect(looksLikeInstrument('Kontakt 8.exe')).toBe(true);
    expect(looksLikeInstrument('Omnisphere.dll')).toBe(true);
  });

  it('rejects the tools installers leave behind', () => {
    expect(looksLikeInstrument('Uninstall Kontakt.exe')).toBe(false);
    expect(looksLikeInstrument('NI Licensing Service.exe')).toBe(false);
    expect(looksLikeInstrument('CrashReporter.exe')).toBe(false);
    expect(looksLikeInstrument('Setup.exe')).toBe(false);
    // Inno Setup names its uninstaller this, and it sits beside the instrument.
    expect(looksLikeInstrument('unins000.exe')).toBe(false);
  });
});

describe('formatLabel', () => {
  it('spells each format the way the industry writes it', () => {
    expect(formatLabel('vst3')).toBe('VST3');
    expect(formatLabel('vst2')).toBe('VST2');
    expect(formatLabel('clap')).toBe('CLAP');
    expect(formatLabel('standalone')).toBe('Standalone');
  });
});

describe('sortPlugins', () => {
  it('groups by maker, then orders by name', () => {
    const sorted = sortPlugins([
      plugin('Zebra', 'u-he'),
      plugin('Pigments', 'Arturia'),
      plugin('Analog Lab', 'Arturia'),
    ]);
    expect(sorted.map(item => item.name)).toEqual(['Analog Lab', 'Pigments', 'Zebra']);
  });

  it('does not change the caller\'s array', () => {
    const original = [plugin('B'), plugin('A')];
    sortPlugins(original);
    expect(original.map(item => item.name)).toEqual(['B', 'A']);
  });
});

describe('filterPlugins', () => {
  const all = [plugin('Kontakt 8', 'Native Instruments'), plugin('Omnisphere', 'Spectrasonics')];

  it('matches the instrument name, ignoring case', () => {
    expect(filterPlugins(all, 'kontakt').map(item => item.name)).toEqual(['Kontakt 8']);
  });

  it('matches the maker too', () => {
    expect(filterPlugins(all, 'spectrasonics').map(item => item.name)).toEqual(['Omnisphere']);
  });

  it('returns everything for an empty search', () => {
    expect(filterPlugins(all, '   ')).toEqual(all);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterPlugins(all, 'zzz')).toEqual([]);
  });
});

describe('isVirtualCable', () => {
  it('recognises the common cables', () => {
    expect(isVirtualCable('CABLE Output (VB-Audio Virtual Cable)')).toBe(true);
    expect(isVirtualCable('VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)')).toBe(true);
    expect(isVirtualCable('BlackHole 2ch')).toBe(true);
  });

  it('does not mistake real hardware for a cable', () => {
    expect(isVirtualCable('Microphone (Focusrite USB Audio)')).toBe(false);
    expect(isVirtualCable('Line In (Realtek High Definition Audio)')).toBe(false);
  });

  it('picks the cables out of a device list', () => {
    const devices = [
      { id: '1', name: 'Microphone (Realtek)' },
      { id: '2', name: 'CABLE Output (VB-Audio Virtual Cable)' },
    ];
    expect(findVirtualCables(devices).map(device => device.id)).toEqual(['2']);
  });
});
