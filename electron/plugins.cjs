/**
 * Find the virtual instruments installed on this PC.
 *
 * Scanning only. The app does not load plug-ins: hosting a VST3 means running
 * its binary on the audio thread, which needs a native host built against the
 * plug-in standard. What this gives is a list of what is installed and a way to
 * start the standalone version, whose sound then comes back through a virtual
 * audio device.
 */

const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

/** Where installers put instruments on Windows. */
const SCAN_ROOTS = [
  { dir: 'C:/Program Files/Common Files/VST3', formats: ['.vst3'] },
  { dir: 'C:/Program Files/Common Files/CLAP', formats: ['.clap'] },
  { dir: 'C:/Program Files/VSTPlugins', formats: ['.vst3', '.dll'] },
  { dir: 'C:/Program Files/Steinberg/VSTPlugins', formats: ['.vst3', '.dll'] },
  { dir: 'C:/Program Files/Native Instruments', formats: ['.exe'] },
  { dir: 'C:/Program Files/Common Files/VST2', formats: ['.dll'] },
  { dir: 'C:/Program Files/Spectrasonics', formats: ['.exe'] },
  { dir: 'C:/Program Files/Arturia', formats: ['.exe'] },
  { dir: 'C:/Program Files/Toontrack', formats: ['.exe'] },
];

const NOT_AN_INSTRUMENT =
  /(uninstall|unins\d|setup|installer|updater|activat|licen[cs]|register|crash|report|helper|service|daemon|diagnos|repair|access)/i;

/** A folder deep enough that a full scan would take noticeable time. */
const MAX_DEPTH = 3;

/**
 * Whether this entry can be descended into.
 *
 * Installers commonly leave a junction rather than a real folder — Kontakt's
 * portable build is one — and a junction reports isDirectory() as false, so
 * checking the dirent alone silently skips whole makers.
 */
async function isFolder(full, entry) {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return (await fs.stat(full)).isDirectory();
  } catch {
    return false; // A junction pointing at something that is no longer there.
  }
}

/** One directory, recursively, collecting files with the wanted extensions. */
async function scanDirectory(dir, formats, vendor, depth, found, visited) {
  if (depth > MAX_DEPTH || found.length > 600) return;
  // Junctions can point back up the tree, so each real folder is walked once.
  let real;
  try {
    real = (await fs.realpath(dir)).toLowerCase();
  } catch {
    return;
  }
  if (visited.has(real)) return;
  visited.add(real);

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // Not installed, or not readable. Either way there is nothing here.
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const extension = path.extname(entry.name).toLowerCase();

    // A .vst3 is a folder on Windows as often as it is a file, and either way
    // it is the thing itself rather than something to look inside.
    if (formats.includes(extension)) {
      if (!NOT_AN_INSTRUMENT.test(entry.name)) {
        found.push({ path: full, fileName: entry.name, extension, vendor });
      }
      continue;
    }
    if (await isFolder(full, entry)) {
      await scanDirectory(full, formats, depth === 0 ? entry.name : vendor, depth + 1, found, visited);
    }
  }
}

/** Everything installed, as plain data for the renderer. */
async function scanPlugins() {
  const found = [];
  const visited = new Set();
  for (const root of SCAN_ROOTS) {
    await scanDirectory(root.dir, root.formats, undefined, 0, found, visited);
  }

  // The same instrument is often installed in two folders at once — a VST3 in
  // Common Files and a copy beside the maker's own — and listing it twice just
  // makes the list harder to read.
  const seen = new Set();
  return found.flatMap(item => {
    const key = `${item.fileName}|${item.extension}`.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      path: item.path,
      fileName: item.fileName,
      extension: item.extension,
      vendor: item.vendor,
      // Only a standalone executable can be started; a plug-in needs a host.
      launchable: item.extension === '.exe',
    }];
  });
}

/**
 * Start a standalone instrument.
 *
 * The path must be one this process found itself. The renderer is not trusted
 * to name an executable: that would turn a scan result into a way to run
 * anything on the machine.
 */
function launchPlugin(known, target) {
  const wanted = path.resolve(String(target ?? '')).toLowerCase();
  const match = known.find(item => item.launchable && path.resolve(item.path).toLowerCase() === wanted);
  if (!match) throw new Error('That instrument was not found in the scan.');

  const child = spawn(match.path, [], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(match.path),
  });
  child.unref();
  return match.path;
}

module.exports = { scanPlugins, launchPlugin, SCAN_ROOTS };
