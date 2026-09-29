// voices.js (v0.50): the four voices, retired voices mapped to the closest
// new one (preferring what's already downloaded), and old downloads pruned.
// Plain Node; no Piper needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const voices = require('../voices');

let n = 0;
const ok = (cond, what) => {
  if (!cond) throw new Error('FAILED: ' + what);
  n += 1;
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgv-'));
voices.init(dir);
const models = path.join(dir, 'voices', 'models');
const put = (model) => {
  fs.writeFileSync(path.join(models, model + '.onnx'), 'x');
  fs.writeFileSync(path.join(models, model + '.onnx.json'), '{}');
};

ok(voices.CATALOG.map((v) => v.name).join() === 'Leah,Cori,Alan,Alba', 'four voices, clearest first');
ok(voices.CATALOG.every((v) => v.tone && typeof v.tone.presence === 'number' && v.tone.air <= 0), 'each voice has its measured tone');
ok(voices.CATALOG.map((v) => (v.noise ? v.noise.join('/') : '-')).join() === '0/0.5,0.4/0.5,-,0.4/0.5', 'measured randomness: Leah 0, Cori and Alba 0.4, Alan default');
ok(voices.CATALOG.every((v) => !v.effect && !v.persona && !v.speakers), 'no effects, characters or speakers');
ok(voices.CATALOG.every((v) => v.dir && v.id.startsWith(v.dir.split('/')[1])), 'each download path matches its id');
ok(voices.PACES.clear.length > voices.PACES.normal.length, 'the clear pace is slower');

// Nothing downloaded: the closest match is suggested, nothing to use yet.
let r = voices.replacementFor('char-spike');
ok(r.to === 'en_GB-alan-medium' && r.use === null, 'Spike -> Alan suggested, none downloaded');
ok(voices.replacementFor('en_US-ryan-high').to === 'en_GB-alan-medium', 'Ryan (v0.50.0-1) -> Alan');
// The old effect voices were Leah's download: they move over at once.
put('en_US-lessac-high');
r = voices.replacementFor('fun-radio');
ok(r.to === 'en_US-lessac-high' && r.use === 'en_US-lessac-high', 'Radio -> Leah, already there');
// The closest isn't downloaded but another is: use that one.
r = voices.replacementFor('char-poppy');
ok(r.to === 'en_GB-cori-high' && r.use === 'en_US-lessac-high', 'Poppy -> Cori suggested, Leah used meanwhile');
// An id nobody knows: the clearest voice.
ok(voices.replacementFor('who-knows').to === 'en_US-lessac-high', 'unknown -> Leah');

// Retired downloads are removed; current ones kept.
put('en_GB-semaine-medium');
put('en_GB-vctk-medium');
put('en_US-ryan-high');
const removed = voices.pruneUnused().sort();
ok(removed.join() === 'en_GB-semaine-medium,en_GB-vctk-medium,en_US-ryan-high', 'retired downloads removed (Ryan too)');
ok(fs.existsSync(path.join(models, 'en_US-lessac-high.onnx')), 'Leah kept');
const listed = voices.list();
ok(listed.voices.find((v) => v.id === 'en_US-lessac-high').installed && !listed.voices.find((v) => v.id === 'en_GB-cori-high').installed, 'list() says what is downloaded');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`voices: ${n} checks passed`);
