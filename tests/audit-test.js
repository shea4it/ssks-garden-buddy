'use strict';

// The house-keeping audit's must-be-zero parts (v0.59.6): every file the app
// loads is packaged, every IPC call has a handler (and every push a
// listener), and every panel element lookup has an element.
const { found } = require('../tools/audit');

let n = 0;
function ok(cond, what) {
  n += 1;
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exit(1);
  }
}
// Made in code, without an id="..." the audit can see.
const DYNAMIC_IDS = new Set(['shareAsk']);
const zero = (title, allow) => {
  const items = (found[title] || []).filter((x) => !(allow && allow.has(x)));
  ok(items.length === 0, `${title}: ${items.join(', ') || 'none'}`);
};
zero('Loaded at runtime but not in build.files');
zero('In build.files but missing on disk');
zero('Preload calls with no main handler');
zero('Main handlers no preload calls');
zero('Main pushes nobody listens for');
zero('$(id) lookups with no such id', DYNAMIC_IDS);
zero('Functions defined but never used');
console.log(`audit: ${n} checks passed`);
