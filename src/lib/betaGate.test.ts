import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The gate lives in the desktop shell as CommonJS and reads its configuration
// from a file beside itself when it is first loaded, so each test writes that
// file and then loads the module fresh.
const require_ = createRequire(import.meta.url);
const modulePath = require_.resolve('../../electron/beta.cjs');
const configPath = path.join(path.dirname(modulePath), 'betaConfig.json');

type Status = { testBuild: boolean; state: 'open' | 'locked' | 'expired'; daysLeft?: number; wrongKey?: boolean };
type Gate = { enabled: boolean; status: () => Status; activate: (key: string) => Status };
type BetaModule = {
  BetaGate: new (folder: string, now?: () => number) => Gate;
  hashOf: (key: string) => string;
};

const load = (): BetaModule => {
  delete require_.cache[modulePath];
  return require_(modulePath) as BetaModule;
};

const KEY = 'MTTEST-1A2B-3C4D-5E6F';
const DAY = 86400000;
let saved: string | null = null;
let folder = '';

beforeEach(() => {
  saved = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
});

afterEach(() => {
  // Put back whatever was there: a real test build's key must survive the tests.
  if (saved === null) fs.rmSync(configPath, { force: true });
  else fs.writeFileSync(configPath, saved);
  delete require_.cache[modulePath];
});

const configure = (endsInDays: number, from = Date.now()) => {
  const { hashOf } = load();
  fs.writeFileSync(configPath, JSON.stringify({ keyHash: hashOf(KEY), expiresAt: new Date(from + endsInDays * DAY).toISOString() }));
  return load();
};

describe('test-build gate', () => {
  it('is simply open in a build that is not a test build', () => {
    fs.rmSync(configPath, { force: true });
    const gate = new (load().BetaGate)(folder);
    expect(gate.status()).toEqual({ testBuild: false, state: 'open' });
  });

  it('starts locked and says how long is left', () => {
    // The real end is the end of a day, so there are always some hours over.
    const gate = new (configure(30.5).BetaGate)(folder);
    expect(gate.status()).toMatchObject({ testBuild: true, state: 'locked', daysLeft: 30 });
  });

  it('turns away a wrong key, and says so', () => {
    const gate = new (configure(30).BetaGate)(folder);
    expect(gate.activate('MTTEST-0000-0000-0000')).toMatchObject({ state: 'locked', wrongKey: true });
  });

  it('opens for the right key, however it was typed', () => {
    const gate = new (configure(30).BetaGate)(folder);
    expect(gate.activate('  mttest-1a2b-3c4d-5e6f ')).toMatchObject({ state: 'open' });
  });

  it('remembers, so the key is only asked for once', () => {
    const { BetaGate } = configure(30);
    new BetaGate(folder).activate(KEY);
    expect(new BetaGate(folder).status().state).toBe('open');
  });

  it('stops on the end date, key or no key', () => {
    const { BetaGate } = configure(30);
    new BetaGate(folder).activate(KEY);
    expect(new BetaGate(folder, () => Date.now() + 31 * DAY).status()).toMatchObject({ state: 'expired', daysLeft: 0 });
    expect(new BetaGate(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-')), () => Date.now() + 31 * DAY).status().state).toBe('expired');
  });

  it('is not brought back by setting the clock back', () => {
    const { BetaGate } = configure(30);
    new BetaGate(folder).activate(KEY);
    // Seen once after the end…
    new BetaGate(folder, () => Date.now() + 40 * DAY).status();
    // …then the clock goes back to today.
    expect(new BetaGate(folder).status().state).toBe('expired');
  });

  it('does not take a small clock correction for tampering', () => {
    const { BetaGate } = configure(30);
    new BetaGate(folder, () => Date.now() + 3600000).activate(KEY);
    expect(new BetaGate(folder).status().state).toBe('open');
  });

  it('does not accept the key of a different test build', () => {
    const { BetaGate } = configure(30);
    new BetaGate(folder).activate(KEY);
    const { hashOf } = load();
    fs.writeFileSync(configPath, JSON.stringify({ keyHash: hashOf('MTTEST-9999-9999-9999'), expiresAt: new Date(Date.now() + 30 * DAY).toISOString() }));
    expect(new (load().BetaGate)(folder).status().state).toBe('locked');
  });

  it('keeps the key itself out of the build', () => {
    configure(30);
    expect(fs.readFileSync(configPath, 'utf8')).not.toContain('1A2B');
  });
});
