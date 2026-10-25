'use strict';

// A house-keeping audit (v0.59.6): things that slip through tests.
// Run: node tools/audit.js (prints); tests/audit-test.js checks the parts
// that must stay at zero.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const out = [];
const found = {};
const say = (title, items) => {
  found[title] = items;
  out.push(`\n== ${title}: ${items.length}${items.length ? '\n  ' + items.join('\n  ') : ''}`);
};

// 1. Runtime files the app loads, all in build.files.
const files = pkg.build.files;
const listed = (f) => files.some((p) => p === f || (p.endsWith('/**/*') && f.startsWith(p.slice(0, -4))));
const runtime = ['main.js', ...files.filter((f) => f.endsWith('.js'))];
const needed = new Set();
for (const f of runtime) {
  if (!fs.existsSync(path.join(root, f))) continue;
  const s = read(f);
  for (const m of s.matchAll(/require\('\.\/([^']+)'\)/g)) needed.add(m[1].endsWith('.js') || m[1].endsWith('.json') ? m[1] : `${m[1]}.js`);
  for (const m of s.matchAll(/path\.join\(__dirname, '([^']+\.(?:html|js|json))'\)/g)) needed.add(m[1]);
}
say('Loaded at runtime but not in build.files', [...needed].filter((f) => !listed(f)).sort());
say('In build.files but missing on disk', files.filter((f) => !f.includes('*') && !fs.existsSync(path.join(root, f))));

// 2. IPC: every channel the preloads use has a handler, and every handler a user.
const main = read('main.js');
const handled = new Set([...main.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g)].map((m) => m[1]));
const pushed = new Set([...main.matchAll(/(?:sendToControl|\.send)\('([^']+)'/g)].map((m) => m[1]));
const pre = ['preload-control.js', 'preload-game.js', 'preload-tabs.js'].filter((f) => fs.existsSync(path.join(root, f))).map(read).join('\n');
const used = new Set([...pre.matchAll(/ipcRenderer\.(?:invoke|send|sendSync)\('([^']+)'/g)].map((m) => m[1]));
const listened = new Set([...pre.matchAll(/(?:on|ipcRenderer\.on)\('([^']+)'/g)].map((m) => m[1]));
say('Preload calls with no main handler', [...used].filter((c) => !handled.has(c)).sort());
say('Main handlers no preload calls', [...handled].filter((c) => !used.has(c) && !/^garden:msg$/.test(c)).sort());
say('Main pushes nobody listens for', [...pushed].filter((c) => !listened.has(c) && /:/.test(c)).sort());

// 3. Panel element lookups that match no id (in the HTML or in a template).
const html = read('control.html');
const ids = new Set([...html.matchAll(/id="([^"$]+)"/g)].map((m) => m[1]));
const dynamicIds = [...html.matchAll(/id="([^"]*)\$\{/g)].map((m) => m[1]);
const looked = new Set([...html.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
say('$(id) lookups with no such id', [...looked].filter((id) => !ids.has(id) && !dynamicIds.some((p) => p && id.startsWith(p))).sort());

// 4. Functions never called (by name) anywhere in the app's code.
const code = { 'main.js': main, 'garden-observer.js': read('garden-observer.js'), 'control.html': html };
const all = Object.values(code).join('\n') + runtime.filter((f) => fs.existsSync(path.join(root, f))).map(read).join('\n');
const dead = [];
for (const [f, s] of Object.entries(code)) {
  for (const m of s.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)) {
    const name = m[1];
    const refs = (all.match(new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g')) || []).length;
    if (refs <= 1) dead.push(`${f}: ${name}`);
  }
}
say('Functions defined but never used', dead);

// 5. Panel renderers that rebuild innerHTML containing inputs on every
//    status (they can interrupt typing or dragging).
const rebuilds = [];
for (const m of html.matchAll(/function (render[A-Za-z]+)\(/g)) {
  const start = m.index;
  const body = html.slice(start, html.indexOf('\n}\n', start));
  if (/innerHTML\s*=/.test(body) && /<input|<select|<textarea/.test(body) && !/SIG|sig ===|=== .*Sig|unchanged|typing|activeElement/.test(body)) rebuilds.push(m[1]);
}
say('Renderers rebuilding inputs with no guard', rebuilds);
if (require.main === module) console.log(out.join('\n'));
module.exports = { found };
