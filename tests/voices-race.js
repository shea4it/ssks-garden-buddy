// voices.js (v0.50.2): lines in different voices and paces asked for at the
// same moment, with a warm start fired in the middle, all come back. Before
// the queue, a switch restarted Piper and every line in flight failed with
// "The voice was switched" (an alert speaking while you picked another voice).
// Needs the real engine and voices (see tests/README.md, Voice audit):
//   MG_PIPER_DIR=/tmp/pdir MG_PIPER_VOICES=/tmp/models node tests/voices-race.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const voices = require('../voices');

const { MG_PIPER_DIR, MG_PIPER_VOICES } = process.env;
if (!MG_PIPER_DIR || !MG_PIPER_VOICES) {
  console.log('voices-race: skipped (set MG_PIPER_DIR and MG_PIPER_VOICES)');
  process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgrace-'));
fs.cpSync(MG_PIPER_DIR, path.join(dir, 'voices', 'engine'), { recursive: true });
fs.mkdirSync(path.join(dir, 'voices', 'models'), { recursive: true });
for (const f of fs.readdirSync(MG_PIPER_VOICES)) fs.copyFileSync(path.join(MG_PIPER_VOICES, f), path.join(dir, 'voices', 'models', f));
voices.init(dir);
const jobs = [
  ['en_US-lessac-high', 'Moon binder. Moon binder is in the shop.', 'clear'],
  ['en_GB-cori-high', 'Dawn shop. The Dawn shop is open.', 'normal'],
  ['en_GB-alan-medium', 'Star weaver. Star weaver is in the shop.', 'clear'],
  ['en_GB-alba-medium', 'A crop turned gold.', 'clear'],
  ['en_US-lessac-high', 'Once more: Moon binder is in the shop.', 'normal'],
];
const lines = jobs.map(([id, text, pace]) => voices.synthesize(id, text, pace));
voices.warm('en_GB-alan-medium', 'normal');
Promise.allSettled(lines).then((res) => {
  voices.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  const bad = res.filter((r) => r.status !== 'fulfilled' || r.value.slice(0, 4).toString() !== 'RIFF');
  if (bad.length) throw new Error(`FAILED: ${bad.length} of ${res.length} lines: ${bad.map((r) => r.reason && r.reason.message).join('; ')}`);
  console.log(`voices-race: ${res.length} lines in 4 voices and 2 paces, all delivered`);
});
