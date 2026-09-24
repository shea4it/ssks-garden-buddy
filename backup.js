'use strict';

// Backups of everything the app keeps: settings (alerts, weather teams, egg
// counts and history, pet counts, saved rooms...) and your scripts.
//
// A backup is one readable JSON file. The app also makes one by itself each
// day it runs and keeps the last 7, in the "backups" folder next to
// settings.json, so there's always something to go back to.

const fs = require('fs');
const path = require('path');

const KIND = 'magic-garden-loader-backup';
const KEEP_AUTO = 7;

function safeScriptName(name) {
  const base = path.basename(String(name || ''));
  return /^[\w .()-]{1,80}\.js$/.test(base) ? base : null;
}

function readScripts(dir) {
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  } catch (err) {
    return out;
  }
  for (const name of files) {
    try {
      const source = fs.readFileSync(path.join(dir, name), 'utf8');
      if (source.length < 1024 * 1024) out.push({ name, source });
    } catch (err) {
      /* skip unreadable */
    }
  }
  return out;
}

function make({ settings, scriptsDir, scriptsConfig, version }) {
  return {
    kind: KIND,
    version: 1,
    appVersion: version || null,
    savedAt: new Date().toISOString(),
    settings,
    scripts: readScripts(scriptsDir),
    scriptsConfig: scriptsConfig || null,
  };
}

// Checks a file is one of ours before anything is replaced. Returns
// { ok, reason, summary }.
function check(data) {
  if (!data || typeof data !== 'object' || data.kind !== KIND) {
    return { ok: false, reason: "That file isn't a Garden Buddy backup." };
  }
  if (!data.settings || typeof data.settings !== 'object') {
    return { ok: false, reason: 'That backup has no settings in it.' };
  }
  const s = data.settings;
  const pity = s.pity || {};
  return {
    ok: true,
    summary: {
      savedAt: data.savedAt || null,
      appVersion: data.appVersion || null,
      hatches: Number(pity.totalHatches) || 0,
      counters: Array.isArray(pity.counters) ? pity.counters.length : 0,
      scripts: Array.isArray(data.scripts) ? data.scripts.length : 0,
      rooms: s.rooms && Array.isArray(s.rooms.saved) ? s.rooms.saved.length : 0,
    },
  };
}

// Puts a backup's scripts back. Settings are restored by the caller (store).
function restoreScripts(data, scriptsDir) {
  let written = 0;
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const sc of Array.isArray(data.scripts) ? data.scripts : []) {
    const name = safeScriptName(sc && sc.name);
    if (!name || typeof sc.source !== 'string') continue;
    fs.writeFileSync(path.join(scriptsDir, name), sc.source, 'utf8');
    written += 1;
  }
  return written;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Once a day: backups/auto-YYYY-MM-DD.json, keeping the newest 7.
function autoBackup(dir, makeFn) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `auto-${stamp(new Date())}.json`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(makeFn(), null, 1), 'utf8');
  const autos = fs.readdirSync(dir).filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const old of autos.slice(0, Math.max(0, autos.length - KEEP_AUTO))) {
    try {
      fs.unlinkSync(path.join(dir, old));
    } catch (err) {
      /* next time */
    }
  }
  return file;
}

module.exports = { make, check, restoreScripts, autoBackup, safeScriptName, KIND };
