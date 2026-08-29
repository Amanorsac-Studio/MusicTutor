import { AudioLines, Gauge, Piano, Sparkles, WandSparkles } from 'lucide-react';
import { Select } from '../components/Select';
import { Toggle, VerticalMeter, formatDb } from '../components/common';
import { useStudio } from '../lib/useStudio';
import { faderToGain, gainToDb } from '../lib/audioEngine';

export function Mixer() {
  const {
    channels, levels, settings, updateSettings,
    setChannelGain, setChannelMuted, setChannelSolo, setDuckingTrigger,
  } = useStudio();

  const inputChannels = channels.filter(channel => channel.kind !== 'master');
  const anySolo = inputChannels.some(channel => channel.soloed);
  const duckingActive = settings.ducking &&
    inputChannels.some(channel => channel.isVoice && !channel.muted && (levels[channel.id]?.rms ?? -60) > -38);

  return (
    <div className="workspace-page mixer-page">
      <header>
        <div>
          <span className="eyebrow">LIVE AUDIO</span>
          <h1>Mixer</h1>
          <p>Balance the lesson mix without leaving the teaching workflow.</p>
        </div>
        <div className="header-status">
          <i className={levels.master ? 'live' : ''} />
          {levels.master ? `Audio engine running · master ${formatDb(levels.master.rms)} dBFS` : 'Audio engine idle'}
        </div>
      </header>

      <div className="mixer-layout">
        <section className="mixing-board">
          {inputChannels.map(channel => {
            const audible = !channel.muted && (!anySolo || channel.soloed);
            const level = levels[channel.id];
            return (
              <div className={`channel-strip ${audible ? '' : 'silenced'}`} key={channel.id}>
                <div className="strip-head">
                  <span className={`channel-icon ${channel.kind === 'instrument' ? 'instrument' : ''}`}>
                    {channel.kind === 'instrument' ? <Piano /> : <AudioLines />}
                  </span>
                  <b>{channel.label}</b>
                  <small>
                    {channel.error
                      ? channel.error
                      : channel.connected
                        ? channel.isVoice ? 'Voice · ducking trigger' : 'Program audio'
                        : 'Not connected'}
                  </small>
                </div>

                <VerticalMeter level={audible ? level : undefined} label={`${channel.label} level`} />

                <input
                  className="vertical-range"
                  aria-label={`${channel.label} fader`}
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(channel.gain * 100)}
                  onChange={event => setChannelGain(channel.id, Number(event.target.value) / 100)}
                />
                <b className="db">{formatDb(gainToDb(faderToGain(channel.gain)))} dB</b>

                <div className="strip-buttons">
                  <button
                    aria-label={`Mute ${channel.label}`}
                    aria-pressed={channel.muted}
                    className={channel.muted ? 'active mute' : ''}
                    onClick={() => setChannelMuted(channel.id, !channel.muted)}
                  >M</button>
                  <button
                    aria-label={`Solo ${channel.label}`}
                    aria-pressed={channel.soloed}
                    className={channel.soloed ? 'active solo' : ''}
                    onClick={() => setChannelSolo(channel.id, !channel.soloed)}
                  >S</button>
                </div>
              </div>
            );
          })}

          <div className="channel-strip master">
            <div className="strip-head">
              <span className="channel-icon"><Gauge /></span>
              <b>Master</b>
              <small>Stereo output</small>
            </div>
            <VerticalMeter level={levels.master} label="Master level" />
            <input
              className="vertical-range"
              aria-label="Master fader"
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.masterLevel * 100)}
              onChange={event => updateSettings({ masterLevel: Number(event.target.value) / 100 })}
            />
            <b className="db">{formatDb(gainToDb(faderToGain(settings.masterLevel)))} dB</b>
            <button
              className={`limiter ${settings.limiter ? '' : 'off'}`}
              aria-pressed={settings.limiter}
              onClick={() => updateSettings({ limiter: !settings.limiter })}
            >LIMITER {settings.limiter ? 'ON' : 'OFF'}</button>
          </div>
        </section>

        <aside className="duck-card">
          <div className="card-title">
            <div><Sparkles /><span><b>Voice ducking</b><small>Natural space for speech</small></span></div>
            <Toggle value={settings.ducking} onChange={value => updateSettings({ ducking: value })} label="Voice ducking" />
          </div>

          <div
            className={`gain-ring ${duckingActive ? 'ducking' : ''}`}
            style={{ ['--amount' as string]: `${(Math.abs(settings.duckingAmountDb) / 24) * 360}deg` }}
          >
            <span><b>{settings.duckingAmountDb.toFixed(1)}</b><small>dB reduction</small></span>
          </div>

          <label htmlFor="duck-strength">
            Strength <b>{Math.abs(settings.duckingAmountDb) < 5 ? 'Light' : Math.abs(settings.duckingAmountDb) < 12 ? 'Medium' : 'Strong'}</b>
          </label>
          <input
            id="duck-strength"
            type="range"
            min={0}
            max={24}
            value={Math.abs(settings.duckingAmountDb)}
            onChange={event => updateSettings({ duckingAmountDb: -Number(event.target.value) })}
          />

          <div className="field-row">
            <span>Trigger</span>
            <Select
              label="Ducking trigger"
              value={inputChannels.find(channel => channel.isVoice)?.id ?? ''}
              onChange={value => setDuckingTrigger(value)}
              options={inputChannels
                .filter(channel => channel.kind === 'input')
                .map(channel => ({ value: channel.id, label: channel.label }))}
              emptyLabel="Assign a microphone first"
            />
          </div>

          <div className="duck-stats">
            <span><b>20 ms</b><small>Attack</small></span>
            <span><b>180 ms</b><small>Release</small></span>
            <span><b>−38 dB</b><small>Threshold</small></span>
          </div>

          <div className={`tip ${duckingActive ? 'active' : ''}`}>
            <WandSparkles />
            <p>
              <b>{duckingActive ? 'Ducking now' : 'Teaching preset'}</b><br />
              {duckingActive
                ? 'Speech detected — the instrument bus is being held back.'
                : 'Tuned for clear speech without audible pumping.'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
