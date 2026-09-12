/**
 * Virtual instruments installed on this PC.
 *
 * The app cannot load a VST3 or CLAP plug-in itself. Hosting one means running
 * its binary inside the audio thread, which needs a native host written against
 * the plug-in standard — Chromium has no way to do it, and pretending otherwise
 * would be a button that never works.
 *
 * What it can do is find what is installed, launch the standalone version where
 * one exists, and route its sound back in through a virtual audio device. That
 * is two clicks instead of a set-up guide.
 */

export type PluginFormat = 'vst3' | 'vst2' | 'clap' | 'standalone';

export type Plugin = {
  /** Absolute path to the plug-in or the standalone executable. */
  path: string;
  /** Display name, with the extension and version noise removed. */
  name: string;
  format: PluginFormat;
  /** Maker, taken from the folder it was installed into. */
  vendor?: string;
  /** True when this entry can be started as its own window. */
  launchable: boolean;
};

/** Extensions worth reporting, and what each one is. */
export const PLUGIN_EXTENSIONS: Record<string, PluginFormat> = {
  '.vst3': 'vst3',
  '.dll': 'vst2',
  '.clap': 'clap',
  '.exe': 'standalone',
};

export const formatLabel = (format: PluginFormat): string =>
  ({ vst3: 'VST3', vst2: 'VST2', clap: 'CLAP', standalone: 'Standalone' })[format];

/**
 * Tidy an installed file name into something readable.
 *
 * Installers decorate names with the format, the bit depth and sometimes a
 * version, none of which a teacher picking an instrument wants to read.
 */
export function tidyName(fileName: string): string {
  return fileName
    .replace(/\.(vst3|dll|clap|exe)$/i, '')
    .replace(/[_.]+/g, ' ')
    .replace(/\b(x64|x86|win64|win32|64 ?bit|32 ?bit|64|32)\b/gi, '')
    .replace(/\b(vst3?|clap|standalone)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Things found in plug-in folders that are not instruments.
 *
 * Installers leave uninstallers, updaters and support tools alongside the real
 * thing, and offering to launch an uninstaller would be actively unhelpful.
 */
const NOT_AN_INSTRUMENT = /(uninstall|unins\d|setup|installer|updater|activat|licen[cs]|register|crash|report|helper|service|daemon|diagnos|repair)/i;

export const looksLikeInstrument = (name: string): boolean => !NOT_AN_INSTRUMENT.test(name);

/** Sort by maker then name, so a big collection reads as a list, not a heap. */
export function sortPlugins(plugins: Plugin[]): Plugin[] {
  return [...plugins].sort((a, b) => {
    const vendor = (a.vendor ?? '').localeCompare(b.vendor ?? '');
    return vendor !== 0 ? vendor : a.name.localeCompare(b.name);
  });
}

/** Narrow a list by a typed query, matched against the name and the maker. */
export function filterPlugins(plugins: Plugin[], query: string): Plugin[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return plugins;
  return plugins.filter(plugin =>
    plugin.name.toLowerCase().includes(needle) || (plugin.vendor ?? '').toLowerCase().includes(needle));
}

/**
 * Audio devices that are virtual cables rather than real hardware.
 *
 * These are the ones that can carry a plug-in's output back into the app, so
 * they are worth offering first rather than leaving buried in a long list.
 */
const CABLE_NAMES = /(vb-audio|vb audio|cable output|cable input|voicemeeter|virtual audio|vac |virtual cable|loopback|blackhole|soundflower|asio link)/i;

export const isVirtualCable = (deviceName: string): boolean => CABLE_NAMES.test(deviceName);

export function findVirtualCables<T extends { id: string; name: string }>(devices: T[]): T[] {
  return devices.filter(device => isVirtualCable(device.name));
}

/** Where each virtual cable is downloaded from, for when none is installed. */
export const CABLE_DOWNLOADS = [
  { name: 'VB-Audio Cable', url: 'https://vb-audio.com/Cable/', note: 'Free, one cable, simplest to set up.' },
  { name: 'VoiceMeeter', url: 'https://vb-audio.com/Voicemeeter/', note: 'Free, several cables and a mixer.' },
];
