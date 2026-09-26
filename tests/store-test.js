const fs = require('fs'); const path = require('path'); const os = require('os');
const assert = require('assert');
const store = require('../store');
let n = 0; const ok = (c, m) => { assert(c, m); n += 1; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-'));

// 1. fresh install: no file, no recovery
store.init(dir); ok(store.recovered() === null, 'fresh: no recovery'); ok(store.get().alerts.volume === 95, 'defaults');

// 2. normal save + reload (flush writes now)
store.get().pity.totalHatches = 123; store.get().rooms.saved.push({ id: 'Q9BD', name: 'x' }); store.flush();
store.init(dir); ok(store.get().pity.totalHatches === 123 && store.get().rooms.saved.length === 1, 'save/reload');

// 3. corrupt file, a backup exists -> recovered from it
fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
fs.writeFileSync(path.join(dir, 'backups', 'auto-2026-09-22.json'), JSON.stringify({ kind: 'magic-garden-loader-backup', settings: { pity: { totalHatches: 100 } } }));
fs.writeFileSync(path.join(dir, 'backups', 'auto-2026-09-23.json'), JSON.stringify({ kind: 'magic-garden-loader-backup', settings: { pity: { totalHatches: 122 }, rooms: { saved: [{ id: 'A1B2' }] } } }));
const later = new Date(Date.now() + 1000); fs.utimesSync(path.join(dir, 'backups', 'auto-2026-09-23.json'), later, later);
fs.writeFileSync(path.join(dir, 'settings.json'), '{"pity": {"totalHatches": 12');
store.init(dir);
const r = store.recovered();
ok(r && r.recoveredFrom === 'auto-2026-09-23.json', 'recovered from the newest backup: ' + JSON.stringify(r));
ok(store.get().pity.totalHatches === 122, 'backup settings in use');
ok(store.get().rooms.saved[0].id === 'A1B2', 'nested settings from the backup');
ok(store.get().alerts.volume === 95, 'defaults merged in');
ok(fs.readdirSync(dir).some((f) => f.startsWith('settings.json.broken-')), 'damaged file kept');
ok(!fs.existsSync(path.join(dir, 'settings.json')), 'damaged file moved aside');
store.flush(); ok(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))).pity.totalHatches === 122, 'next save writes a good file');

// 4. corrupt file, unreadable backup skipped, older good one used
fs.writeFileSync(path.join(dir, 'backups', 'auto-2026-09-24.json'), 'garbage');
const l2 = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, 'backups', 'auto-2026-09-24.json'), l2, l2);
fs.writeFileSync(path.join(dir, 'settings.json'), '');
store.init(dir); ok(store.recovered().recoveredFrom === 'auto-2026-09-23.json', 'skips a garbage backup');

// 5. corrupt file, no backups at all -> fresh, still reported
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-'));
fs.writeFileSync(path.join(dir2, 'settings.json'), 'null');
store.init(dir2); ok(store.recovered() && store.recovered().recoveredFrom === null, 'no backup: fresh but reported');
ok(store.get().alerts.volume === 95, 'defaults');

// 6. a valid file after a recovery: recovery cleared
store.init(dir); ok(store.recovered() === null, 'good file: recovery is null again');

// 7. rename fallback: make rename fail, the save must still land
const realRename = fs.renameSync; fs.renameSync = () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; };
store.get().pity.totalHatches = 999; store.flush(); fs.renameSync = realRename;
ok(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))).pity.totalHatches === 999, 'save survives a refused rename');
ok(!fs.existsSync(path.join(dir, 'settings.json.tmp')), 'tmp file cleaned up');
// 8. save() is coalesced and asynchronous: many asks, one write, a moment later.
(async () => {
  const realWrite = fs.promises.writeFile; let writes = 0;
  fs.promises.writeFile = async (...a) => { writes += 1; return realWrite(...a); };
  store.get().pity.totalHatches = 1; store.save();
  store.get().pity.totalHatches = 2; store.save();
  store.get().pity.totalHatches = 3; store.save();
  ok(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))).pity.totalHatches === 999, 'nothing written yet');
  await new Promise((r) => setTimeout(r, 2200));
  ok(writes === 1, 'three asks, one write: ' + writes);
  ok(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))).pity.totalHatches === 3, 'the latest state landed');
  // A change during the write is written again afterwards.
  let resolveWrite; fs.promises.writeFile = (...a) => new Promise((res) => { resolveWrite = () => res(realWrite(...a)); });
  store.get().pity.totalHatches = 4; store.save();
  await new Promise((r) => setTimeout(r, 1700)); // the write is now in flight (held)
  store.get().pity.totalHatches = 5; store.save();
  fs.promises.writeFile = async (...a) => realWrite(...a);
  resolveWrite();
  await new Promise((r) => setTimeout(r, 2200));
  ok(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))).pity.totalHatches === 5, 'a change during a write is written after it');
  // flush() cancels the timer and writes now.
  store.get().pity.totalHatches = 6; store.save(); store.flush();
  ok(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))).pity.totalHatches === 6, 'flush writes at once');
  await new Promise((r) => setTimeout(r, 1800));
  console.log(`store: ${n} checks passed`);
})();
