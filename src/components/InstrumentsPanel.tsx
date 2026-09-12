import { useEffect, useMemo, useState } from 'react';
import { Cable, ExternalLink, Play, Plug, RotateCcw, Search, Speaker } from 'lucide-react';
import {
  CABLE_DOWNLOADS, PLUGIN_EXTENSIONS, filterPlugins, findVirtualCables, formatLabel,
  looksLikeInstrument, sortPlugins, tidyName, type Plugin,
} from '../lib/plugins';
import { openExternal } from '../lib/openExternal';
import { audioEngine } from '../lib/audioEngine';

/**
 * Virtual instruments installed on this PC.
 *
 * The app does not host plug-ins. Loading a VST3 means running its binary on
 * the audio thread against the plug-in standard, which needs a native host;
 * Chromium cannot do it, and a button that pretends to would be worse than
 * none. What this panel does is find what is installed, start the standalone
 * version where there is one, and set up the return path in a single click.
 */
export function InstrumentsPanel({
  audioInputs, onRouteCable, routedDeviceId,
}: {
  audioInputs: Array<{ id: string; name: string }>;
  /** Assign a device to the App audio slot. */
  onRouteCable: (deviceId: string, name: string) => void;
  routedDeviceId?: string;
}) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<'idle' | 'scanning' | 'done' | 'unavailable'>('idle');
  const [message, setMessage] = useState('');
  const [capturing, setCapturing] = useState(false);

  /** Take whatever the computer is playing as a mixer channel. */
  const captureDesktop = async () => {
    setCapturing(true);
    const channel = await audioEngine.captureDesktopAudio();
    setCapturing(false);
    setMessage(channel.error
      ? channel.error
      : 'Desktop audio is on the mixer. Anything this PC plays is now in the lesson.');
  };

  const scan = async () => {
    const desktop = window.pianoTutorDesktop;
    if (!desktop?.scanPlugins) { setState('unavailable'); return; }
    setState('scanning');
    try {
      const found = await desktop.scanPlugins();
      setPlugins(sortPlugins(found
        .filter(item => looksLikeInstrument(item.fileName))
        .map(item => ({
          path: item.path,
          name: tidyName(item.fileName),
          format: PLUGIN_EXTENSIONS[item.extension] ?? 'vst2',
          vendor: item.vendor,
          launchable: item.launchable,
        }))));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The scan failed.');
    }
    setState('done');
  };

  useEffect(() => { void scan(); }, []);

  const launch = async (plugin: Plugin) => {
    try {
      await window.pianoTutorDesktop?.launchPlugin?.(plugin.path);
      setMessage(`Started ${plugin.name}. Set its output to the cable, then pick the cable below.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That instrument would not start.');
    }
  };

  const shown = useMemo(() => filterPlugins(plugins, query).slice(0, 60), [plugins, query]);
  const cables = findVirtualCables(audioInputs);
  const launchable = plugins.filter(plugin => plugin.launchable).length;

  return (
    <section className="content-card span-two">
      <div className="card-title">
        <div>
          <Plug />
          <span>
            <b>Virtual instruments</b>
            <small>
              {state === 'scanning' ? 'Scanning…'
                : state === 'unavailable' ? 'Available in the installed desktop app'
                  : `${plugins.length} installed · ${launchable} can be started from here`}
            </small>
          </span>
        </div>
        <button className="icon-btn" onClick={() => void scan()} aria-label="Rescan instruments">
          <RotateCcw size={16} />
        </button>
      </div>

      <label className="plugin-search">
        <Search size={14} />
        <input
          aria-label="Search instruments"
          value={query}
          placeholder="Search Kontakt, Omnisphere, a maker…"
          onChange={event => setQuery(event.target.value)}
        />
      </label>

      {message && <div className="destination-caveat mild">{message}</div>}

      <div className="plugin-list">
        {shown.map(plugin => (
          <div className="plugin-row" key={plugin.path}>
            <span className={`plugin-tag ${plugin.format}`}>{formatLabel(plugin.format)}</span>
            <span>
              <b>{plugin.name}</b>
              <small>{plugin.vendor ?? 'Installed'}</small>
            </span>
            {plugin.launchable ? (
              <button className="subtle-btn" onClick={() => void launch(plugin)}>
                <Play size={12} />Launch
              </button>
            ) : (
              <small className="plugin-note">Needs a host</small>
            )}
          </div>
        ))}
        {state === 'done' && !shown.length && (
          <p className="panel-hint">
            {plugins.length ? 'Nothing matches that search.' : 'No instruments found in the usual folders.'}
          </p>
        )}
      </div>

      <label className="section-label">Getting the sound in</label>

      <div className="cable-rows">
        <div>
          <Speaker size={14} />
          <span>
            <b>Capture everything this PC plays</b>
            <small>Nothing to install. Picks up any app, not just instruments.</small>
          </span>
          <button className="subtle-btn" onClick={() => void captureDesktop()}>
            {capturing ? 'Starting…' : 'Capture'}
          </button>
        </div>
      </div>
      <small className="field-hint">
        The simplest route, and the one to try first. Use a cable instead when you need
        one app on its own rather than the whole desktop.
      </small>

      <div className="tip">
        <Cable />
        <p>
          <b>Or use a virtual cable.</b> Install one, set it as the instrument's output,
          then choose it here.
          {cables.length ? '' : ' None is installed yet — the links below are free.'}
        </p>
      </div>

      {cables.length ? (
        <div className="cable-rows">
          {cables.map(cable => (
            <div key={cable.id}>
              <Cable size={14} />
              <span>
                <b>{cable.name}</b>
                <small>{routedDeviceId === cable.id ? 'Carrying sound into the app' : 'Virtual audio device'}</small>
              </span>
              <button
                className="subtle-btn"
                disabled={routedDeviceId === cable.id}
                onClick={() => onRouteCable(cable.id, cable.name)}
              >{routedDeviceId === cable.id ? 'In use' : 'Use for App audio'}</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="inspector-buttons">
          {CABLE_DOWNLOADS.map(download => (
            <button key={download.url} onClick={() => void openExternal(download.url)}>
              <ExternalLink size={12} />{download.name}
            </button>
          ))}
        </div>
      )}

      <p className="panel-hint">
        Plug-ins do not run inside this app. Launch the instrument, set its audio output
        to the cable, and pick that cable above.
      </p>
    </section>
  );
}
