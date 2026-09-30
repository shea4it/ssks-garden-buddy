'use strict';

// Runs every unit suite (tests/*-test.js): plain Node, no Electron or game
// needed. `npm test` runs this, and so does the Tests workflow on GitHub.
// Exits non-zero if any suite fails.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const suites = fs.readdirSync(dir).filter((f) => /-test\.js$/.test(f)).sort();
let failed = 0;
for (const f of suites) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 120000 });
  const lines = `${r.stdout || ''}`.trim().split('\n').filter((l) => /passed|: ok/.test(l));
  if (r.status === 0) {
    console.log(`✓ ${f}${lines.length ? `  (${lines.join('; ')})` : ''}`);
  } else {
    failed += 1;
    console.log(`✗ ${f}\n${(r.stdout || '').trim()}\n${(r.stderr || '').trim()}`);
  }
}
console.log(`\n${suites.length - failed} of ${suites.length} suites passed.`);
process.exit(failed ? 1 : 0);
