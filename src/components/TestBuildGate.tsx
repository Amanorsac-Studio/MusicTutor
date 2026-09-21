import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { BetaStatus } from '../types/desktop';

/**
 * The door on a test build.
 *
 * A test build asks once for the key every tester was given, and stops opening
 * after its end date. An ordinary build, and the app running in a browser, have
 * no gate at all: the children are shown straight away.
 *
 * The decision is made in the desktop shell, not here. This only shows it.
 */
export function TestBuildGate({ children }: { children: ReactNode }) {
  const bridge = window.pianoTutorDesktop;
  const [status, setStatus] = useState<BetaStatus | null>(bridge?.betaStatus ? null : { testBuild: false, state: 'open' });
  const [key, setKey] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!bridge?.betaStatus) return;
    let cancelled = false;
    void bridge.betaStatus()
      .then(next => { if (!cancelled) setStatus(next); })
      // If the shell cannot answer, a test build must not fall open.
      .catch(() => { if (!cancelled) setStatus({ testBuild: true, state: 'locked' }); });
    return () => { cancelled = true; };
  }, [bridge]);

  if (!status) return null;

  if (status.state === 'open') {
    return (
      <>
        {children}
        {status.testBuild && (
          <div className="test-ribbon" role="note">
            Test build · {!status.daysLeft ? 'ends today' : status.daysLeft === 1 ? '1 day left' : `${status.daysLeft} days left`}
          </div>
        )}
      </>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!bridge?.betaActivate || !key.trim()) return;
    setChecking(true);
    try {
      setStatus(await bridge.betaActivate(key));
    } finally {
      setChecking(false);
    }
  };

  const ends = status.expiresAt
    ? new Date(status.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="brand">
          <span className="brand-bars" aria-hidden="true">▮▮▮▮</span>
          <strong>Music<span>Tutor</span></strong>
        </div>

        {status.state === 'expired' ? (
          <>
            <h1>This test build has ended</h1>
            <p>
              Thank you for testing MusicTutor. This build stopped working on {ends}.
              Your lessons and recordings are still in Documents, Amanorsac Studio, MusicTutor.
              Ask Amanorsac Studio for the current version: hello@amanorsac.studio
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <h1>Enter your tester key</h1>
            <p>
              This is a test build of MusicTutor. Type the key you were given. You only
              need to do this once{ends ? `, and the build works until ${ends}` : ''}.
            </p>
            <input
              autoFocus
              aria-label="Tester key"
              placeholder="MTTEST-0000-0000-0000-0000"
              value={key}
              spellCheck={false}
              autoComplete="off"
              onChange={event => setKey(event.target.value)}
            />
            <button className="primary" type="submit" disabled={checking || !key.trim()}>
              {checking ? 'Checking…' : 'Open MusicTutor'}
            </button>
            <p className="gate-error" role="alert">
              {status.wrongKey ? 'That key is not right. Check it against the one you were sent and try again.' : ''}
            </p>
          </form>
        )}

        <button className="gate-close" onClick={() => bridge?.close()}>Close</button>
      </div>
    </div>
  );
}
