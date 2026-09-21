/**
 * The test-build gate.
 *
 * This is NOT the Amanorsac licence system, and must never be mistaken for it.
 * That system is server-signed proofs, one key per purchase, and it arrives
 * when the studio assigns MusicTutor an app id. This is something much smaller
 * for a closed test: one shared key handed to every tester, and a date after
 * which the build stops. It talks to no server.
 *
 * What it is worth: it keeps a test build from being used by people it was not
 * given to, and from living on after the test. A shared key can be passed on
 * and a clock can be set back, so it is a fence, not a lock. The key is held
 * here only as a hash, so it cannot be read out of the installed files.
 *
 * A build with no betaConfig.json beside this file is not a test build, and
 * the gate is simply open.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let config = null;
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'betaConfig.json'), 'utf8'));
} catch { /* not a test build */ }

const normalise = key => String(key ?? '').trim().toUpperCase().replace(/\s+/g, '');
const hashOf = key => crypto.createHash('sha256').update(`musictutor-test:${normalise(key)}`).digest('hex');

/** A day of slack, so a time-zone change or a clock correction is not read as tampering. */
const SLACK = 24 * 60 * 60 * 1000;

class BetaGate {
  constructor(stateFolder, now = () => Date.now()) {
    this.file = path.join(stateFolder, 'test-build.json');
    this.now = now;
  }

  get enabled() {
    return Boolean(config && config.keyHash && config.expiresAt);
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; }
  }

  write(state) {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(state));
    } catch { /* a gate that cannot remember asks again next time, which is safe */ }
  }

  /** Where things stand: open, waiting for the key, or over. */
  status() {
    if (!this.enabled) return { testBuild: false, state: 'open' };
    const expiresAt = Date.parse(config.expiresAt);
    const stored = this.read();
    const now = this.now();
    // The latest time this build has ever seen. A clock set back past it does
    // not bring an expired build back.
    const latest = Math.max(now, Number(stored.lastSeen) || 0);
    if (latest !== stored.lastSeen && stored.keyHash) this.write({ ...stored, lastSeen: latest });

    const base = { testBuild: true, expiresAt: config.expiresAt, daysLeft: Math.max(0, Math.floor((expiresAt - latest) / 86400000)) };
    if (latest > expiresAt || now + SLACK < (Number(stored.lastSeen) || 0)) return { ...base, daysLeft: 0, state: 'expired' };
    if (stored.keyHash === config.keyHash) return { ...base, state: 'open' };
    return { ...base, state: 'locked' };
  }

  /** Try a key. Only ever says yes or no. */
  activate(key) {
    if (!this.enabled) return this.status();
    if (hashOf(key) === config.keyHash) this.write({ keyHash: config.keyHash, lastSeen: this.now() });
    const status = this.status();
    return status.state === 'locked' ? { ...status, wrongKey: true } : status;
  }
}

module.exports = { BetaGate, hashOf, normalise };
