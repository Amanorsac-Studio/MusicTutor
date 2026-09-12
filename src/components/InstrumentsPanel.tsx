import { useEffect, useMemo, useState } from 'react';
import { Cable, ExternalLink, Play, Plug, RotateCcw, Search } from 'lucide-react';
import {
  CABLE_DOWNLOADS, PLUGIN_EXTENSIONS, filterPlugins, findVirtualCables, formatLabel,
  looksLikeInstrument, sortPlugins, tidyName, type Plugin,
} from '../lib/plugins';
import { openExternal } from '../lib/openExternal';

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
      setMessage(`Started ${plugin.name}. Set its audio output to a virtual cable, then pick that cable below.`);
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

      <div className="tip">
        <Cable />
        <p>
          <b>The return path.</b> Windows will not let one app listen to another, so a
          plug-in's sound reaches this app through a virtual audio device. Set the
          instrument's output to the cable, then choose the same cable here and it
          arrives on the App audio slot.
          {cables.length ? '' : ' No virtual cable is installed yet.'}
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
        Plug-ins cannot run inside this app. Hosting a VST3 or CLAP means loading its
        binary on the audio thread, which needs a native plug-in host rather than a web
        one, so the standalone version plus a cable is the honest route. Run the
        instrument on WASAPI or ASIO with a 128 or 256 sample buffer to keep it in time
        with the keyboard.
      </p>
    </section>
  );
}
