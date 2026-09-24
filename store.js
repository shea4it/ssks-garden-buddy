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

function init(userDataDir) {
  file = path.join(userDataDir, 'settings.json');
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    saved = {};
  }
  data = merge(DEFAULTS, saved);
  return data;
}

function get() {
  return data;
}

function save() {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('Could not save settings:', err);
  }
}

function set(next) {
  data = merge(DEFAULTS, next);
  save();
  return data;
}

module.exports = { init, get, set, save };
