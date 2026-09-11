import { useEffect, useState } from 'react';
import {
  AlertTriangle, Eye, EyeOff, Plus, Radio, Square, Trash2, Wifi,
} from 'lucide-react';
import { Select } from '../components/Select';
import { Toggle } from '../components/common';
import { useStudio } from '../lib/useStudio';
import { liveStreamer } from '../lib/liveStream';
import {
  PLATFORMS, PLATFORM_IDS, createDestination, formatWarning, maskedUrl,
  normalizeDestinations, validateAll, STREAM_STORAGE_KEY,
  type Destination, type PlatformId, type StreamStatus, EMPTY_STATUS,
} from '../lib/streaming';
import { getFormat, type QualityLevel } from '../lib/formats';
import { formatDuration } from '../lib/settings';

/** Stream keys are secrets, so they live apart from the scene data. */
function loadDestinations(): Destination[] {
  try {
    const stored = localStorage.getItem(STREAM_STORAGE_KEY);
    return normalizeDestinations(stored ? JSON.parse(stored) : null);
  } catch {
    return [];
  }
}

function saveDestinations(destinations: Destination[]): void {
  try {
    localStorage.setItem(STREAM_STORAGE_KEY, JSON.stringify(destinations));
  } catch { /* private mode or quota */ }
}

export function StreamPage() {
  const { settings, format, setNotice } = useStudio();
  const [destinations, setDestinations] = useState<Destination[]>(loadDestinations);
  const [status, setStatus] = useState<StreamStatus>(EMPTY_STATUS);
  const [ffmpegReady, setFfmpegReady] = useState<boolean | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => liveStreamer.subscribe(setStatus), []);
  useEffect(() => { void liveStreamer.available().then(setFfmpegReady); }, []);
  useEffect(() => { saveDestinations(destinations); }, [destinations]);

  const live = status.state === 'live' || status.state === 'starting';
  const problems = validateAll(destinations);
  const enabled = destinations.filter(destination => destination.enabled);

  const update = (id: string, patch: Partial<Destination>) =>
    setDestinations(current => current.map(item => (item.id === id ? { ...item, ...patch } : item)));

  const addDestination = (platform: PlatformId) =>
    setDestinations(current => [...current, createDestination(platform)]);

  const goLive = async () => {
    setBusy(true);
    const failure = await liveStreamer.start(destinations, {
      frameRate: settings.frameRate,
      level: settings.videoQuality as QualityLevel,
    });
    setBusy(false);
    if (failure) setNotice(failure);
  };

  const stop = async () => {
    setBusy(true);
    await liveStreamer.stop();
    setBusy(false);
  };

  return (
    <div className="workspace-page">
      <header>
        <div>
          <span className="eyebrow">GO LIVE</span>
          <h1>Stream</h1>
          <p>Push the composed scene to one or more platforms at once.</p>
        </div>
        {live ? (
          <button className="primary small danger" onClick={() => void stop()} disabled={busy}>
            <Square size={14} />Stop streaming
          </button>
        ) : (
          <button
            className="primary small"
            onClick={() => void goLive()}
            disabled={busy || !enabled.length || problems.length > 0 || ffmpegReady === false}
          ><Radio size={14} />{busy ? 'Connecting…' : 'Go live'}</button>
        )}
      </header>

      {ffmpegReady === false && (
        <div className="page-banner error">
          The bundled encoder could not be found, so streaming is unavailable in this build.
        </div>
      )}

      {!liveStreamer.supported && (
        <div className="page-banner">
          Streaming runs in the installed desktop app. In a browser preview there is no
          way to reach an RTMP server.
        </div>
      )}

      {status.state === 'error' && status.message && (
        <div className="page-banner error"><AlertTriangle size={14} /> {status.message}</div>
      )}

      <div className="page-grid">
        {/* Live status */}
        <section className="content-card span-two">
          <div className="card-title">
            <div>
              <Wifi />
              <span>
                <b>{live ? 'On air' : 'Offline'}</b>
                <small>
                  {live
                    ? `${status.destinations.join(', ')} · ${formatDuration(status.uptime * 1000)}`
                    : `${enabled.length} destination${enabled.length === 1 ? '' : 's'} ready`}
                </small>
              </span>
            </div>
            <span className={`status ${live ? '' : 'offline'}`}>{live ? 'LIVE' : 'IDLE'}</span>
          </div>

          <p className="panel-hint">
            The picture is the {getFormat(format).short.toLowerCase()} canvas at{' '}
            {getFormat(format).aspect}, encoded once as H.264 and sent to every destination.
            Streaming and recording can run together.
          </p>

          {problems.length > 0 && !live && (
            <div className="page-banner">
              {problems.length} destination{problems.length === 1 ? '' : 's'} not ready:{' '}
              {problems.map(problem => problem.message).join(' ')}
            </div>
          )}
        </section>

        {/* Destinations */}
        <section className="content-card span-two">
          <div className="card-title">
            <div><Radio /><span><b>Destinations</b><small>Stream keys are stored on this PC only</small></span></div>
          </div>

          {destinations.map(destination => {
            const platform = PLATFORMS[destination.platform];
            const warning = formatWarning(destination, format);
            const showing = revealed.has(destination.id);
            return (
              <div className="destination" key={destination.id}>
                <div className="destination-head">
                  <Toggle
                    value={destination.enabled}
                    onChange={value => update(destination.id, { enabled: value })}
                    label={`Stream to ${destination.name}`}
                    disabled={live}
                  />
                  <input
                    className="destination-name"
                    aria-label={`${destination.name} label`}
                    value={destination.name}
                    onChange={event => update(destination.id, { name: event.target.value })}
                  />
                  <Select
                    label={`${destination.name} platform`}
                    value={destination.platform}
                    disabled={live}
                    onChange={value => {
                      const next = value as PlatformId;
                      update(destination.id, {
                        platform: next,
                        server: PLATFORMS[next].server,
                        name: PLATFORMS[next].name,
                      });
                    }}
                    options={PLATFORM_IDS.map(id => ({ value: id, label: PLATFORMS[id].name }))}
                  />
                  <button
                    className="layer-toggle"
                    aria-label={`Remove ${destination.name}`}
                    disabled={live}
                    onClick={() => setDestinations(current =>
                      current.filter(item => item.id !== destination.id))}
                  ><Trash2 size={13} /></button>
                </div>

                <div className="destination-fields">
                  <label className="inspector-field">
                    <span>Ingest server</span>
                    <input
                      aria-label={`${destination.name} server`}
                      value={destination.server}
                      disabled={live}
                      placeholder={platform.server || 'rtmp://…'}
                      onChange={event => update(destination.id, { server: event.target.value })}
                    />
                  </label>
                  <label className="inspector-field">
                    <span>Stream key</span>
                    <span className="key-field">
                      <input
                        aria-label={`${destination.name} stream key`}
                        type={showing ? 'text' : 'password'}
                        value={destination.key}
                        disabled={live}
                        onChange={event => update(destination.id, { key: event.target.value })}
                      />
                      <button
                        aria-label={showing ? 'Hide stream key' : 'Show stream key'}
                        onClick={() => setRevealed(current => {
                          const next = new Set(current);
                          if (next.has(destination.id)) next.delete(destination.id);
                          else next.add(destination.id);
                          return next;
                        })}
                      >{showing ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                    </span>
                  </label>
                </div>

                <small className="field-hint">{platform.keyHint} · sends to {maskedUrl(destination)}</small>
                {platform.caveat && (
                  <div className="destination-caveat"><AlertTriangle size={13} />{platform.caveat}</div>
                )}
                {warning && <div className="destination-caveat mild">{warning}</div>}
              </div>
            );
          })}

          {!destinations.length && (
            <p className="panel-hint">No destinations yet. Add one below.</p>
          )}

          <div className="inspector-buttons">
            {PLATFORM_IDS.map(id => (
              <button key={id} disabled={live} onClick={() => addDestination(id)}>
                <Plus size={13} />{PLATFORMS[id].name}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
