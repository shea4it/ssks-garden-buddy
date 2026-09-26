const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { Readable } = require('stream');
const updater = require('../updater');
(async () => {
  // A response body whose write target is a directory that doesn't exist -> stream error, must reject not hang.
  const big = Buffer.alloc(2 * 1024 * 1024, 1);
  const body = Readable.from((async function* () { for (let i = 0; i < 40; i += 1) yield big; })());
  const fetchImpl = async () => ({ ok: true, status: 200, body, headers: new Map([['content-length', String(big.length * 40)]]) });
  const dest = path.join(os.tmpdir(), 'no-such-dir-' + Date.now(), 'x.exe');
  const t = setTimeout(() => { console.error('HUNG'); process.exit(1); }, 8000);
  let failed = null;
  try { await updater.download({ asset: { url: 'x', size: big.length * 40, sha256: null }, dest, fetchImpl }); } catch (e) { failed = e; }
  clearTimeout(t);
  assert(failed, 'download rejects on a write error');
  // Happy path still works and verifies the hash
  const crypto = require('crypto');
  const data = Buffer.alloc(3 * 1024 * 1024, 7);
  const body2 = Readable.from((async function* () { for (let i = 0; i < 3; i += 1) yield data.subarray(i * 1048576, (i + 1) * 1048576); })());
  const dest2 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gb-')), 'y.exe');
  const r = await updater.download({ asset: { url: 'x', size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') }, dest: dest2, fetchImpl: async () => ({ ok: true, status: 200, body: body2, headers: new Map() }) });
  assert(r.verified && r.bytes === data.length && fs.statSync(dest2).size === data.length, 'good download verified');
  console.log('updater drain: 2 checks passed');
})();
