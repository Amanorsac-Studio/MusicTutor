/**
 * Turns the next build into a test build: one shared key, one end date.
 *
 *   node scripts/make-test-build.cjs            a new key, ending 30 days from now
 *   node scripts/make-test-build.cjs 14         a new key, ending in 14 days
 *   node scripts/make-test-build.cjs --off      back to an ordinary build
 *
 * The key is printed once and saved to installer/TEST_KEY.txt, which is not in
 * the repository. Only its hash goes into the build.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashOf } = require('../electron/beta.cjs');

const root = path.join(__dirname, '..');
const configFile = path.join(root, 'electron', 'betaConfig.json');

if (process.argv.includes('--off')) {
  fs.rmSync(configFile, { force: true });
  console.log('Test gate removed. The next build is an ordinary one.');
  process.exit(0);
}

const days = Math.max(1, Math.min(365, Number(process.argv[2]) || 30));
const block = () => crypto.randomBytes(2).toString('hex').toUpperCase();
// Deliberately not the shape of a real Amanorsac licence key, so that nobody
// ever types one into the other's box.
const key = `MTTEST-${block()}-${block()}-${block()}-${block()}`;

// To the end of the last day, so "30 days" never turns out to be 29 and a bit.
const end = new Date(Date.now() + days * 86400000);
end.setHours(23, 59, 59, 0);

fs.writeFileSync(configFile, JSON.stringify({ keyHash: hashOf(key), expiresAt: end.toISOString() }, null, 2) + '\n');

const note = [
  'MusicTutor test build',
  '',
  `Tester key:   ${key}`,
  `Works until:  ${end.toDateString()}`,
  '',
  'Everyone testing uses this same key. They type it once, the first time the',
  'app opens. After the date above this build stops opening.',
  '',
].join('\n');
fs.mkdirSync(path.join(root, 'installer'), { recursive: true });
fs.writeFileSync(path.join(root, 'installer', 'TEST_KEY.txt'), note);
console.log(note);
