'use strict';

// Settings live in the app's AppData folder, not the project folder, so they
// survive every rebuild and reinstall.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  alerts: {
    volume: 95,
    voiceVolume: 35,
    muted: false,
    voice: '',
    voicePref: '',
    voiceEngine: 'system',
    naturalVoice: '',
    voiceSpeakers: {},
    voiceEffect: 'none',
    snoozeUntil: 0,
    keepAwake: true,
    outputDevice: '',
    outputDeviceLabel: '',
    popups: true,
    quietHours: { enabled: false, from: '23:00', to: '08:00' },
    disabled: [],
    // Alerts that ring even during quiet hours and snooze (the 🌙 button).
    always: [],
    custom: [],
  },
  // The egg tracker. pity.js owns the shape and brings old saves up to date.
  pity: {
    counters: [
      { id: 'gold', name: 'Gold', kind: 'gold', egg: '', species: '', value: 0 },
      { id: 'rainbow', name: 'Rainbow', kind: 'rainbow', egg: '', species: '', value: 0 },
    ],
    totalHatches: 0,
    history: [],
    autoCount: true,
  },
  alertHistory: [],
  // Rooms you've saved in the Rooms tab: [{ id, name, addedAt }].
  rooms: { saved: [], showShared: true, clipboard: true },
  garden: {
    pets: {},
    totals: { gold: 0, rainbow: 0, coins: 0 },
    strength: {},
    since: null,
  },
  // Swap to one of your saved pet teams when the weather changes. Values are
  // the game's team ids; '' means "leave my pets alone".
  weatherTeams: {
    enabled: false,
    clear: '',
    rain: '',
    snow: '',
    thunder: '',
    dawn: '',
    amber: '',
  },
  // "When 95% of ready crops are Thunderstruck, switch to team X":
  // [{ id, on, metric, basis: 'ready'|'all', pct, teamId, weather: ''|kind }]
  teamTriggers: [],
  // Step out of the game while certain weather is on, so it can't mutate
  // your crops (weather only reaches crops while you're online).
  logoff: {
    enabled: false,
    kinds: [],
    rejoin: true,
    leadSeconds: 30,
  },
  // The panel sits on the right of the game ('attached') or in its own
  // window ('window').
  ui: { panel: 'attached', panelOpen: true, panelWidth: 430, tab: 'alerts' },
  gardenCountsVersion: 0,
  firstRunDone: false,
};

let file = null;
let data = null;
// Set when a damaged settings file was replaced at startup: { broken, recoveredFrom }.
let recovery = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(defaults, saved) {
  if (Array.isArray(defaults)) return Array.isArray(saved) ? saved : clone(defaults);
  if (defaults && typeof defaults === 'object') {
    const out = {};
    const src = saved && typeof saved === 'object' ? saved : {};
    for (const key of Object.keys(defaults)) out[key] = merge(defaults[key], src[key]);
    for (const key of Object.keys(src)) if (!(key in out)) out[key] = src[key];
    return out;
  }
  return saved === undefined ? defaults : saved;
}

// The newest daily backup's settings (backup.js writes backups/auto-YYYY-MM-DD.json
// and before-restore-<time>.json next to settings.json), or null.
function newestBackupSettings(userDataDir) {
  const dir = path.join(userDataDir, 'backups');
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => /^(auto-\d{4}-\d{2}-\d{2}|before-restore-\d+)\.json$/.test(f));
  } catch (err) {
    return null;
  }
  const stamp = (f) => {
    try {
      return fs.statSync(path.join(dir, f)).mtimeMs;
    } catch (err) {
      return 0;
    }
  };
  names.sort((a, b) => stamp(b) - stamp(a));
  for (const name of names) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (b && b.settings && typeof b.settings === 'object') return { name, settings: b.settings };
    } catch (err) {
      /* try the next one */
    }
  }
  return null;
}

function init(userDataDir) {
  file = path.join(userDataDir, 'settings.json');
  recovery = null;
  let saved = {};
  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    text = null; // first run: nothing saved yet
  }
  if (text !== null) {
    try {
      saved = JSON.parse(text);
      if (!saved || typeof saved !== 'object') throw new Error('not an object');
    } catch (err) {
      // A damaged file (a crash mid-write, say) used to mean starting from
      // scratch: egg counters, saved rooms, everything. Keep the damaged file
      // and carry on from the newest daily backup instead.
      const broken = `${file}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try {
        fs.renameSync(file, broken);
      } catch (e2) {
        /* the next save overwrites it */
      }
      const fallback = newestBackupSettings(userDataDir);
      saved = fallback ? fallback.settings : {};
      recovery = { broken: path.basename(broken), recoveredFrom: fallback ? fallback.name : null };
      console.error('Settings file was damaged:', err.message, fallback ? `restored ${fallback.name}` : 'started fresh');
    }
  }
  data = merge(DEFAULTS, saved);
  return data;
}

// What init() had to do about a damaged settings file, if anything.
function recovered() {
  return recovery;
}

function get() {
  return data;
}

/* Saving. save() only asks: the file is written a moment later, once for
 * however many asks came in, and in the background, so the main process
 * never sits on a disk write (it used to write on every garden update, and
 * the file had grown to the point where that was felt as input lag).
 * flush() writes right now, for quitting. */
const SAVE_DELAY_MS = 1500;
let saveTimer = null;
let writing = false;
let dirtyAgain = false;

function text() {
  return JSON.stringify(data, null, 2);
}

function writeSync(t) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, t, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    // On Windows the swap can be refused for a moment (an antivirus or
    // backup tool holding the file). Rather than lose the save, write
    // straight to the file.
    fs.writeFileSync(file, t, 'utf8');
    fs.rmSync(tmp, { force: true });
  }
}

async function writeAsync(t) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fs.promises.writeFile(tmp, t, 'utf8');
  try {
    await fs.promises.rename(tmp, file);
  } catch (err) {
    await fs.promises.writeFile(file, t, 'utf8');
    await fs.promises.rm(tmp, { force: true });
  }
}

function save() {
  if (!file) return;
  if (writing) {
    dirtyAgain = true;
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(writeSoon, SAVE_DELAY_MS);
}

function writeSoon() {
  saveTimer = null;
  if (!file || writing) return;
  let t;
  try {
    t = text();
  } catch (err) {
    console.error('Could not save settings:', err);
    return;
  }
  writing = true;
  writeAsync(t)
    .catch((err) => console.error('Could not save settings:', err))
    .then(() => {
      writing = false;
      if (dirtyAgain) {
        dirtyAgain = false;
        save();
      }
    });
}

// Writes now, on this thread: for quitting, and for anything that must be
// on disk before the next step (a backup, say).
function flush() {
  if (!file) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  dirtyAgain = false;
  try {
    writeSync(text());
  } catch (err) {
    console.error('Could not save settings:', err);
  }
}

function set(next) {
  data = merge(DEFAULTS, next);
  save();
  return data;
}

module.exports = { init, get, set, save, flush, recovered };
