'use strict';

const {
  app,
  BaseWindow,
  WebContentsView,
  ipcMain,
  Menu,
  shell,
  powerSaveBlocker,
  powerMonitor,
  Notification,
  session,
  dialog,
  clipboard,
  screen,
} = require('electron');
// The side panel's default width in pixels.
const PANEL_WIDTH = 480;

/* Keeping going when something goes wrong (v0.54.1): anything unexpected in
 * the app itself, the panel's page or the game's page is logged instead of
 * quietly breaking things; a crashed panel or game page is reloaded. The
 * last 50 are kept and go in a saved sample, so a beta bug report shows what
 * happened. */
const ERROR_LOG = [];
function logError(where, err) {
  const msg = String((err && (err.stack || err.message)) || err || 'unknown').slice(0, 1500);
  ERROR_LOG.push({ at: new Date().toISOString(), where: String(where).slice(0, 60), msg });
  if (ERROR_LOG.length > 50) ERROR_LOG.shift();
  try {
    console.error(`[${where}]`, msg);
  } catch (e) {
    /* nowhere to print */
  }
}
process.on('uncaughtException', (err) => logError('app', err));
process.on('unhandledRejection', (err) => logError('app (promise)', err));

/* How long the app's own work takes (v0.73.1; the owner's game froze while
 * he moved plants). This process is Chromium's browser process: while it's
 * busy, no window (the game's included) gets new frames or input. So each
 * game report's handling is timed, by part, settings writes are timed, and
 * a 100 ms heartbeat notes any stall. All of it goes in a saved sample. */
const PERF = { since: Date.now(), status: { n: 0, total: 0, max: 0 }, parts: {}, slow: [], stalls: [], stallCount: 0, maxStall: 0, writes: { n: 0, total: 0, max: 0, bytes: 0 } };
function perfPart(parts, name, t0) {
  const t = performance.now();
  parts[name] = (parts[name] || 0) + (t - t0);
  return t;
}
function perfStatus(parts, total) {
  const st = PERF.status;
  st.n += 1;
  st.total += total;
  st.max = Math.max(st.max, total);
  for (const [k, v] of Object.entries(parts)) {
    const p = PERF.parts[k] || (PERF.parts[k] = { total: 0, max: 0 });
    p.total += v;
    p.max = Math.max(p.max, v);
  }
  if (total >= 40) {
    PERF.slow.push({ at: Date.now(), ms: Math.round(total), parts: Object.fromEntries(Object.entries(parts).filter(([, v]) => v >= 5).map(([k, v]) => [k, Math.round(v)])) });
    if (PERF.slow.length > 20) PERF.slow.shift();
  }
}
{
  let beat = performance.now();
  const heart = setInterval(() => {
    const now = performance.now();
    const lag = now - beat - 100;
    beat = now;
    if (lag < 60) return;
    PERF.stallCount += 1;
    PERF.maxStall = Math.max(PERF.maxStall, lag);
    PERF.stalls.push({ at: Date.now(), ms: Math.round(lag) });
    if (PERF.stalls.length > 30) PERF.stalls.shift();
  }, 100);
  if (heart.unref) heart.unref();
}
function perfWrite(ms, bytes) {
  PERF.writes.n += 1;
  PERF.writes.total += ms;
  PERF.writes.max = Math.max(PERF.writes.max, ms);
  PERF.writes.bytes = bytes;
}
function perfView() {
  const r = (x) => Math.round(x * 10) / 10;
  const st = PERF.status;
  return {
    minutes: r((Date.now() - PERF.since) / 60000),
    status: { n: st.n, avgMs: st.n ? r(st.total / st.n) : 0, maxMs: r(st.max) },
    parts: Object.fromEntries(Object.entries(PERF.parts).map(([k, v]) => [k, { avgMs: st.n ? r(v.total / st.n) : 0, maxMs: r(v.max) }])),
    slow: PERF.slow.slice(),
    stalls: { count: PERF.stallCount, maxMs: Math.round(PERF.maxStall), recent: PERF.stalls.slice() },
    writes: { n: PERF.writes.n, avgMs: PERF.writes.n ? r(PERF.writes.total / PERF.writes.n) : 0, maxMs: r(PERF.writes.max), kb: Math.round(PERF.writes.bytes / 1024) },
  };
}
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const store = require('./store');
const alerts = require('./alerts');
const tts = require('./tts');
const voices = require('./voices');
const petData = require('./pet-data');
const cropData = require('./crop-data');
const abilityData = require('./ability-data');
const sellTeam = require('./sell-team');
const harvestRule = require('./harvest-rule');
const stageEngine = require('./stage');
const hatches = require('./hatches');
const petRank = require('./pet-rank');
const weather = require('./weather');
const gameData = require('./game-data');
const petNames = require('./pet-names');
const pity = require('./pity');
const roomsMod = require('./rooms');
const backup = require('./backup');
const updater = require('./updater');
const { spawn } = require('child_process');
const fun = require('./fun');
const luck = require('./luck');
const budget = require('./budget');
const gardenPlan = require('./garden-plan');
const { plantMutRows, plantStateAt, pushReading } = require('./plant-muts');
const questLib = require('./quests');
const petGrowth = require('./pet-growth');
const events = require('./events');
const share = require('./share');

const GAME_URL = 'https://magicgarden.gg';
const GAME_HOST = 'magicgarden.gg';
const APP_ID = 'gg.local.magicgardenloader';
// The app's icon (v0.64.1) for its windows and notifications. The installed
// .exe carries it too (tools/after-pack.js); this covers running from the
// folder, Linux, and an .exe the build couldn't brand. Unpacked from the
// app's archive (asarUnpack) so Windows can read it as a real file.
function artFile(name) {
  const inAsar = path.join(__dirname, 'art', name);
  const unpacked = inAsar.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return fs.existsSync(unpacked) ? unpacked : inAsar;
}
const APP_ICON = artFile(process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png');
const APP_ICON_PNG = artFile('app-icon.png');

// The game window holds two views: the game on the left and, when attached,
// the panel (control.html, which is also the sound engine) on the right.
// The panel can also live in a window of its own. It's never destroyed while
// the app runs, so sounds never cut out when it moves.
let gameWindow = null;   // BaseWindow
let gameView = null;     // WebContentsView: the game
let panelView = null;    // WebContentsView: control.html
let panelWindow = null;  // BaseWindow, only when the panel is detached
let watcher = null;
let powerSaveId = null;
let quitting = false;
let gardenStatus = null;
let sessionCoins = null;

// Friendly names for the running totals in stats.petAbility.
const PET_TOTALS = {
  totalSellBoostBonusCoins: { label: '💰 Extra coins from Sell Boost', unit: 'coins', order: 1 },
  totalCoinsFound: { label: '🪙 Coins found', unit: 'coins', order: 2 },
  totalCoinsFromProduceEater: { label: '🐛 Coins from Crop Eater', unit: 'coins', order: 3 },
  secondsReducedPlantGrowth: { label: '🌱 Plants grew sooner by', unit: 'time', order: 4 },
  secondsReducedEggGrowth: { label: '🥚 Eggs hatched sooner by', unit: 'time', order: 5 },
  totalXpBoosted: { label: '⭐ XP given to your pets', unit: 'xp', order: 6 },
  totalHatchXpBoosted: { label: '🐣 XP given to new pets', unit: 'xp', order: 7 },
  totalHungerRestored: { label: '🍖 Hunger refilled', unit: 'hunger', order: 8 },
  totalHungerBoosted: { label: '🍖 Hunger saved', unit: 'hunger', order: 9 },
};   // { start, at }: the wallet when this session began
let parked = null;          // set while the app has stepped out of the game for weather

function isGameUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === GAME_HOST || host.endsWith('.' + GAME_HOST);
  } catch (err) {
    return false;
  }
}

function sendToControl(channel, payload) {
  if (panelView && !panelView.webContents.isDestroyed()) {
    panelView.webContents.send(channel, payload);
  }
}

/* ================================================================== *
 * User scripts
 * ================================================================== */

// Bundled scripts that start switched on.
const DEFAULT_ON = new Set(['anti-afk.js']);

// Scripts from earlier versions that have since moved into the app itself.
const RETIRED = new Set(['restock-alerts.js']);

const SEED_VERSION = 2;

function scriptsDir() {
  return path.join(app.getPath('userData'), 'scripts');
}

function scriptsConfigPath() {
  return path.join(app.getPath('userData'), 'scripts.json');
}

function bundledScriptsDir() {
  return path.join(__dirname, 'default-scripts');
}

function readScriptsConfig() {
  try {
    return JSON.parse(fs.readFileSync(scriptsConfigPath(), 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeScriptsConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(scriptsConfigPath()), { recursive: true });
    fs.writeFileSync(scriptsConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('Could not save script settings:', err);
  }
}

function hashFile(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (err) {
    return null;
  }
}

// Copy bundled scripts into the editable scripts folder. On later versions,
// a bundled script is refreshed only if you haven't edited your copy of it.
function seedScripts() {
  const dir = scriptsDir();
  fs.mkdirSync(dir, { recursive: true });

  let bundled = [];
  try {
    bundled = fs.readdirSync(bundledScriptsDir()).filter((f) => f.endsWith('.js'));
  } catch (err) {
    bundled = [];
  }

  const cfg = readScriptsConfig();
  let changed = false;

  for (const name of bundled) {
    if (RETIRED.has(name)) continue;
    const src = path.join(bundledScriptsDir(), name);
    const dest = path.join(dir, name);
    const srcHash = hashFile(src);
    const entry = cfg[name];

    if (!fs.existsSync(dest)) {
      if (entry === undefined) {
        fs.copyFileSync(src, dest);
        cfg[name] = { enabled: DEFAULT_ON.has(name), seededHash: srcHash };
        changed = true;
      }
      continue;
    }

    const destHash = hashFile(dest);
    if (entry && !entry.seededHash && destHash === srcHash) {
      entry.seededHash = srcHash;
      changed = true;
    } else if (entry && entry.seededHash && destHash === entry.seededHash && srcHash !== destHash) {
      fs.copyFileSync(src, dest);
      entry.seededHash = srcHash;
      changed = true;
    }
  }

  for (const name of RETIRED) {
    if (cfg[name] && cfg[name].enabled) {
      cfg[name].enabled = false;
      changed = true;
    }
  }

  if ((cfg._seedVersion || 1) < SEED_VERSION) {
    for (const name of DEFAULT_ON) if (cfg[name]) cfg[name].enabled = true;
    cfg._seedVersion = SEED_VERSION;
    changed = true;
  }

  if (changed) writeScriptsConfig(cfg);
}

function listScripts() {
  const cfg = readScriptsConfig();
  let files = [];
  try {
    files = fs.readdirSync(scriptsDir()).filter((f) => f.endsWith('.js') && !RETIRED.has(f));
  } catch (err) {
    files = [];
  }
  files.sort((a, b) => a.localeCompare(b));
  return files.map((name) => {
    let size = 0;
    try {
      size = fs.statSync(path.join(scriptsDir(), name)).size;
    } catch (err) {
      /* ignore */
    }
    return { name, enabled: Boolean(cfg[name] && cfg[name].enabled), size };
  });
}

function setScriptEnabled(name, enabled) {
  const cfg = readScriptsConfig();
  cfg[name] = Object.assign({}, cfg[name], { enabled: Boolean(enabled) });
  writeScriptsConfig(cfg);
}

function wrapScript(name, source) {
  const label = JSON.stringify(name);
  return `
(function () {
  try {
    ${source}
  } catch (err) {
    console.error('[MG Loader] Script ' + ${label} + ' failed:', err);
  }
})();
//# sourceURL=mg-loader/${name}
`;
}

async function injectScripts(contents) {
  if (!contents || contents.isDestroyed()) return [];
  if (!isGameUrl(contents.getURL())) return [];

  const results = [];
  for (const script of listScripts()) {
    if (!script.enabled) continue;
    try {
      const source = fs.readFileSync(path.join(scriptsDir(), script.name), 'utf8');
      await contents.executeJavaScript(wrapScript(script.name, source), true);
      results.push({ name: script.name, ok: true });
    } catch (err) {
      results.push({ name: script.name, ok: false, error: String(err) });
    }
  }
  return results;
}

/* ================================================================== *
 * Alerts
 * ================================================================== */

// 1.2B, 45.2M, 12.3K
function toastText(a) {
  if (a.kind === 'hunger') {
    const names = a.names || [];
    return {
      title: names.length === 1 ? `${names[0]} is hungry` : `${names.length} pets are hungry`,
      body: a.diet && a.diet.length
        ? `Nothing they eat is in the trough. Try: ${a.diet.join(', ')}.`
        : 'Nothing they eat is in the trough.',
    };
  }
  if (a.kind === 'weather' && a.night) {
    return { title: '🌙 Night has fallen', body: `The Spooky Shop is open over the Wishing Well${a.itemName ? `: ${a.itemName} in stock` : ''}. Nocturnal pets are stronger in the dark.` };
  }
  if (a.kind === 'weather') {
    return { title: `${a.label} event`, body: 'The weather has changed.' };
  }
  if (a.kind === 'hatch') {
    return { title: `🥚 You hatched a ${a.itemName}!`, body: `${a.label} counter logged and reset.` };
  }
  if (a.kind === 'grown') {
    return { title: `⭐ ${a.itemName} is fully grown!`, body: `STR ${a.strength}. Time to put a new pet out to grow?` };
  }
  const count = a.stock > 1 ? ` x${a.stock}` : '';
  return { title: `${a.itemName}${count} in stock`, body: `In the ${a.shop} shop.` };
}

function isSnoozed(settings) {
  return (settings.alerts.snoozeUntil || 0) > Date.now();
}

// Keeps the last 50 alerts, so a missed one can be looked up later.
function recordAlerts(list, muted) {
  const settings = store.get();
  const now = Date.now();
  for (const a of list) {
    let text = toastText(a).title;
    if (a.kind === 'pet') text = `${a.label === 'Rainbow' ? '🌈' : '🟡'} ${a.itemName || 'A pet'} turned a crop ${a.label}`;
    else if (a.kind === 'weather' && a.night) text = `🌙 Night: the Spooky Shop is open${a.itemName ? ` (${a.itemName} in stock)` : ''}`;
    else if (a.kind === 'weather') {
      const k = weather.BY_ID[weather.kindOf(a.label)];
      text = `${k ? k.emoji : '🌦️'} ${k ? k.label : a.label} started`;
    } else if (a.kind === 'hunger') text = `🍽️ ${text}`;
    else if (a.kind === 'hatch') text = `🥚 Hatched a ${a.itemName}!`;
    else if (a.kind === 'luck') text = `🍀 ${a.itemName}`;
    else if (a.kind === 'grown') text = `⭐ ${a.itemName} is fully grown (STR ${a.strength})`;
    else text = `🛒 ${text}`;
    settings.alertHistory.push({ at: now, text, muted: Boolean(muted) });
  }
  settings.alertHistory = settings.alertHistory.slice(-50);
  store.save();
  sendToControl('alerts:history', settings.alertHistory);
}

/* Daily quests (v0.65.0; quests.js). The game keeps today's three on your
 * slot; the panel's Quests tab shows them with a line of help each, from
 * what the app already knows: the shops, your ripe crops, your eggs, your
 * pets out, the weather. Each day is kept for 30 days, and an hour before
 * new quests a gentle reminder goes if any are left (Quests tab switch). */
const JOURNAL_TOTALS = { crops: 897, pets: 116 }; // wiki: 69 crops x 13, 29 pets x 4
function questsView(payload) {
  const dq = payload.dailyQuests;
  const now = Date.now();
  const st = watcher ? watcher.status() : null;
  const bucket = (payload.crops || []).find((x) => /garden/i.test(x.name)) || {};
  const j = payload.journal;
  const v = questLib.view(dq, {
    now,
    plants: Array.isArray(payload.gardenPlants) ? payload.gardenPlants : null,
    eggs: Array.isArray(payload.gardenEggs) ? payload.gardenEggs : null,
    shops: watcher ? watcher.shops() : null,
    pets: (payload.pets || []).map((p) => ({ name: p.name, species: p.species, abilities: p.abilities || [], strength: p.strength })),
    weatherKind: weather.kindOf(payload.weather),
    weather: st ? [st.current, ...(st.upcoming || [])].filter(Boolean) : [],
    readyValue: Number(bucket.readyValue) || 0,
    readyRule: harvestLock().mode,
    journal: j ? { crops: { logged: j.crops, total: Math.max(j.crops, JOURNAL_TOTALS.crops) }, pets: { logged: j.pets, total: Math.max(j.pets, JOURNAL_TOTALS.pets) } } : null,
    clock,
  });
  if (dq && dq.dayUTC) {
    const s = store.get();
    s.quests = Object.assign({ days: {}, remindDay: null }, s.quests);
    if (questLib.recordDay(s.quests.days, dq)) store.save();
    const days = s.quests.days;
    v.history = Object.assign(questLib.historySummary(days, questLib.dayUTC(now)), {
      recent: Object.keys(days).sort().reverse().slice(0, 14).map((k) => ({ day: k, tier: days[k].tier, quests: days[k].quests, bonus: days[k].bonus, bonusClaimed: days[k].bonusClaimed })),
    });
  }
  // The Haunt Quest (v0.66.0): snap haunts with the Camera, at night and in
  // weather, while the event runs.
  v.haunt = questLib.hauntView(payload.spookyQuest, { now, night: nightInfo(now), weather: st ? [st.current, ...(st.upcoming || [])].filter(Boolean) : [], ends: HAUNT_ENDS, clock });
  v.stats = payload.questStats || null;
  v.journal = j ? { crops: j.crops, pets: j.pets, cropTotal: Math.max(j.crops, JOURNAL_TOTALS.crops), petTotal: Math.max(j.pets, JOURNAL_TOTALS.pets) } : null;
  return v;
}
// An hour before new quests, once a day, if any are left or unclaimed.
function checkQuestReminder(now = Date.now(), view = null) {
  const q = view || (gardenStatus && gardenStatus.quests);
  if (!q || !q.loaded || q.stale || !q.day) return;
  const s = store.get();
  if ((s.ui || {}).questRemind === false) return;
  const left = q.resetAt - now;
  if (left > 60 * 60000 || left < 45 * 60000) return;
  s.quests = Object.assign({ days: {}, remindDay: null }, s.quests);
  if (s.quests.remindDay === q.day) return;
  const bonusLeft = q.bonus && q.bonus.state !== 'claimed';
  if (!q.left && !q.toClaim) return;
  s.quests.remindDay = q.day;
  store.save();
  const what = q.left
    ? `${q.left} quest${q.left === 1 ? '' : 's'} left${bonusLeft && q.bonus.reward ? `, for the bonus (${q.bonus.reward.replace(/^\S+\s/, '')})` : ''}`
    : `${q.toClaim} reward${q.toClaim === 1 ? '' : 's'} to claim at the Quest Booth`;
  recordNote(`📜 An hour until new quests: ${what}`);
  desktopNotify('📜 An hour until new quests', `${what.charAt(0).toUpperCase()}${what.slice(1)}.`, 'quests');
  return what;
}

/* Desktop notifications and being away (v0.64.2). Coming back to the
 * computer (the screen locked, the computer asleep, or nobody touching it
 * for 10 minutes, when the screen usually goes black) used to bring a pile
 * of Windows notifications about everything that happened meanwhile. Now,
 * while you're away, they're held back: alerts still sound and still go in
 * Recent alerts, and when you're back the panel shows one Welcome back line
 * instead. For half a minute after you're back the catch-up stays quiet
 * too. Anything that's already over (a weather that's ended) never pops
 * up, and no more than three pop up in half a minute. */
const AWAY_IDLE_S = 600;
const SETTLE_MS = Number(process.env.MG_SETTLE_MS) || 30000;
const BURST_MAX = 3;
const BURST_MS = 30000;
const presence = { away: null, settleUntil: 0, held: 0, lastTick: Date.now() };
const toastTimes = [];
function goAway(why, since) {
  if (presence.away) return;
  presence.away = { why, since: Math.min(Date.now(), since || Date.now()) };
  presence.held = 0;
  sendToControl('presence', { away: true, since: presence.away.since, why });
}
function comeBack() {
  if (!presence.away) return;
  const was = presence.away;
  presence.away = null;
  presence.settleUntil = Date.now() + SETTLE_MS;
  // After the catch-up, so what it brought is in Recent alerts too.
  setTimeout(() => {
    if (presence.away) return;
    sendToControl('presence', { away: false, since: was.since, back: Date.now(), held: presence.held, why: was.why });
  }, SETTLE_MS);
}
function checkPresence() {
  const now = Date.now();
  const gap = now - presence.lastTick;
  presence.lastTick = now;
  // The computer slept: the clock jumped while nothing ran.
  if (gap > 90000) goAway('asleep', now - gap);
  let state = 'unknown';
  try {
    state = powerMonitor.getSystemIdleState(AWAY_IDLE_S);
  } catch (err) {
    state = 'unknown';
  }
  if (state === 'locked') goAway('locked', now);
  else if (state === 'idle') goAway('idle', now - (Number(powerMonitor.getSystemIdleTime()) || AWAY_IDLE_S) * 1000);
  else if (state === 'active') comeBack();
}
function watchPresence() {
  setInterval(checkPresence, 15000);
  powerMonitor.on('suspend', () => goAway('asleep', Date.now()));
  powerMonitor.on('resume', () => setTimeout(checkPresence, 2000));
  powerMonitor.on('lock-screen', () => goAway('locked', Date.now()));
  powerMonitor.on('unlock-screen', comeBack);
}
function toastAllowed(meta) {
  const now = Date.now();
  if (presence.away || now < presence.settleUntil) {
    presence.held += 1;
    return false;
  }
  if (meta && meta.endsAt && Date.parse(meta.endsAt) <= now) return false;
  while (toastTimes.length && now - toastTimes[0] > BURST_MS) toastTimes.shift();
  if (toastTimes.length >= BURST_MAX) return false;
  toastTimes.push(now);
  return true;
}
// Every desktop notification goes through here.
function showToast(opts, meta) {
  if (!Notification.isSupported() || !toastAllowed(meta)) return false;
  const n = new Notification(Object.assign({ icon: APP_ICON_PNG }, opts));
  n.on('click', focusGame);
  n.show();
  return n;
}

// A line in Recent alerts that isn't an alert: a team swap, a log-off.
function recordNote(text, toastTitle) {
  const settings = store.get();
  settings.alertHistory.push({ at: Date.now(), text, note: true });
  settings.alertHistory = settings.alertHistory.slice(-50);
  store.save();
  sendToControl('alerts:history', settings.alertHistory);
  if (toastTitle && settings.alerts.popups && !isSnoozed(settings)) showToast({ title: toastTitle, body: text, silent: true });
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP])M/i, (m, a) => a.toLowerCase() + 'm');
}

// Quiet hours and snooze silence an alert, unless you've marked that alert
// "always" (the 🌙 button): then it rings anyway, say for a Moonbinder at
// 4am. Mute alerts still silences everything.
function isAlways(settings, ruleId) {
  return Array.isArray(settings.alerts.always) && settings.alerts.always.includes(ruleId);
}

function quietFor(settings, ruleId) {
  if (isAlways(settings, ruleId)) return false;
  return alerts.inQuietHours(settings) || isSnoozed(settings);
}

// What happened to each alert, for the diagnostic sample (v0.53.7): here,
// when it was sent to the panel or held back (and why); from the panel, what
// it did with each batch (played, failed, or skipped because nothing is
// audible). An alert that goes missing leaves a trail.
const ALERT_LOG = [];
function logAlert(entry) {
  ALERT_LOG.push(Object.assign({ at: Date.now() }, entry));
  if (ALERT_LOG.length > 40) ALERT_LOG.shift();
}
ipcMain.on('alerts:played', (event, report) => {
  if (report && typeof report === 'object') logAlert(Object.assign({ from: 'panel' }, report));
});

function handleAlerts(list) {
  const settings = store.get();
  const loud = list.filter((a) => !quietFor(settings, a.ruleId));
  const hushed = list.filter((a) => quietFor(settings, a.ruleId));
  const names = (l) => l.map((a) => a.itemName || a.label || a.ruleId);
  // Sound first: nothing after this (history, pop-ups) can keep it quiet.
  if (loud.length) sendToControl('alerts:play', loud);
  logAlert({ from: 'main', sent: names(loud), held: names(hushed), why: hushed.length ? (isSnoozed(settings) ? 'snoozed' : 'quiet hours') : undefined });
  try {
    if (hushed.length) recordAlerts(hushed, true);
    if (loud.length) recordAlerts(loud, false);
  } catch (err) {
    logAlert({ from: 'main', error: `recording: ${err && err.message}` });
  }
  try {
    const popups = list.filter((a) => !isSnoozed(settings) || isAlways(settings, a.ruleId));
    if (settings.alerts.popups && popups.length) {
      for (const a of popups.slice(0, 3)) showToast({ ...toastText(a), silent: true }, { endsAt: a.endsAt });
    }
    if (gameWindow && !gameWindow.isFocused()) gameWindow.flashFrame(true);
  } catch (err) {
    logAlert({ from: 'main', error: `pop-up: ${err && err.message}` });
  }
}

// The alert settings that can keep an alert quiet, for the sample.
function alertDiagnostics() {
  const s = store.get();
  const a = s.alerts || {};
  return {
    log: ALERT_LOG.slice(),
    history: (s.alertHistory || []).slice(-20),
    settings: {
      muted: a.muted, volume: a.volume, sfx: a.sfx, voiceEngine: a.voiceEngine, naturalVoice: a.naturalVoice, voice: a.voice, popups: a.popups,
      outputDevice: a.outputDeviceLabel || a.outputDevice || 'default',
      quietHours: a.quietHours, inQuietHours: alerts.inQuietHours(s), snoozedUntil: a.snoozeUntil || null, disabled: a.disabled, always: a.always,
    },
  };
}

/* ================================================================== *
 * Garden observer reports
 * ================================================================== */

// Mirrors the game's own warning: a pet at 10% hunger or less with nothing
// it eats in the feeding trough (see pet-data.js). Pets not in the wiki
// table fall back to "about 5 minutes left". One alert covers every hungry
// pet at once, and there's a 15 minute gap between alerts so three pets
// can't set off three announcements.
const HUNGER_GAP_MS = 15 * 60 * 1000;
let lastHungerAlert = 0;

function checkHunger(pets) {
  if (!Array.isArray(pets)) return;
  const hungry = pets.filter((p) => p && p.needsFood);
  if (!hungry.length) return;
  if (Date.now() - lastHungerAlert < HUNGER_GAP_MS) return;
  if (store.get().alerts.disabled.includes('pethungry')) return;
  lastHungerAlert = Date.now();

  const names = hungry.map((p) => String(p.name).slice(0, 40));
  const foods = [];
  for (const p of hungry) for (const f of p.diet || []) if (!foods.includes(f)) foods.push(f);
  handleAlerts([{
    ruleId: 'pethungry',
    tier: 'pet',
    kind: 'hunger',
    label: 'Hungry pets',
    names,
    diet: foods.slice(0, 4),
  }]);
}

let gardenSaveTimer = null;
function saveGardenSoon() {
  if (gardenSaveTimer) return;
  gardenSaveTimer = setTimeout(() => {
    gardenSaveTimer = null;
    store.save();
  }, 10000);
}

// How long until every crop in the garden is Gold or Rainbow, going by the
// Granter rates of the pets that are out. Assumes each proc lands on a crop
// that isn't Gold or Rainbow yet, so it's the optimistic end.
function gardenEta(status) {
  const garden = (status.crops || []).find((b) => /garden/i.test(b.name));
  if (!garden || !garden.total) return null;
  const rows = (status.abilities && status.abilities.rows) || [];
  const perHour = rows
    .filter((r) => r.id === 'GoldGranter' || r.id === 'RainbowGranter')
    .reduce((acc, r) => acc + (r.perHour || 0), 0);
  const remaining = Math.max(0, garden.total - (garden.special || 0));
  return {
    remaining,
    perHour,
    hours: perHour > 0 && remaining > 0 ? remaining / perHour : null,
    done: remaining === 0,
  };
}

// How long until every garden crop is full size (100). A Crop Size Boost
// proc grows every garden crop at once (wiki: "increase size of garden
// crops"), so the smallest crop decides: size points still needed, divided by
// the size points per hour all the boosting pets add up to. Boosts that only
// work in one kind of weather count only while that weather is on.
function sizeEta(status) {
  const garden = (status.crops || []).find((b) => /garden/i.test(b.name));
  if (!garden || !garden.sized) return null;
  const now = weather.kindOf(status.weather);
  const rows = ((status.abilities && status.abilities.rows) || []).filter((r) => r.sizeStep);
  const active = rows.filter((r) => !r.weather || weather.kindOf(r.weather) === now);
  const pointsPerHour = active.reduce((acc, r) => acc + (r.perHour || 0) * r.sizeStep, 0);
  const deficit = Math.max(0, 100 - (garden.sizeMin == null ? 100 : garden.sizeMin));
  return {
    total: garden.sized,
    atMax: garden.atMax || 0,
    average: garden.sizeSum / garden.sized,
    smallest: garden.sizeMin,
    boosters: rows.length,
    boostersNow: active.length,
    waitingFor: rows.filter((r) => r.weather && weather.kindOf(r.weather) !== now).map((r) => r.weather),
    pointsPerHour,
    hours: pointsPerHour > 0 && deficit > 0 ? deficit / pointsPerHour : null,
    done: deficit === 0,
  };
}

/* ================================================================== *
 * Weather pet teams
 *
 * When the weather changes, swap to the team you picked for it, using the
 * game's own ApplyPetTeam command (the same thing tapping the team in the game
 * does). It acts once per change of weather, so if you swap by hand
 * afterwards it leaves you alone until the weather changes again.
 * ================================================================== */

let lastTeamKey = null;
let pendingTeam = null;

function teamIsOut(team, pets) {
  const out = new Set((pets || []).map((p) => String(p.id)));
  return Boolean(team && team.members.length) && team.members.every((m) => out.has(m.petId));
}

async function applyTeam(teamId, why) {
  const st = gardenStatus;
  const team = st && (st.teams || []).find((t) => t.id === teamId);
  if (!gameWindow || gameWindow.isDestroyed() || parked) return { ok: false, reason: 'The game isn\'t open.' };
  if (!team) return { ok: false, reason: 'That team isn\'t in your game any more.' };
  if (teamIsOut(team, st.pets)) return { ok: true, already: true, team: team.name };
  // (No more "too many swaps" limit, v0.72.2: every swap is your own press,
  // one press, one swap, and the owner was being locked out of his own.)
  const now = Date.now();

  let result;
  try {
    result = await gameView.webContents.executeJavaScript(
      `window.__mgLoaderObserver && window.__mgLoaderObserver.applyPetTeam(${JSON.stringify(team.id)})`,
      true
    );
  } catch (err) {
    result = { ok: false, reason: String((err && err.message) || err) };
  }
  if (!result || !result.ok) return { ok: false, reason: (result && result.reason) || 'The game page didn\'t answer.' };
  pendingTeam = { id: team.id, name: team.name, why, at: now };
  return { ok: true, team: team.name };
}

/* Swap to your last team (v0.56.2): the game page works out which lineups
 * count as teams (garden-observer.js: when the Pet Hutch window closes, a
 * whole team goes out, you do something else, or you press the button;
 * v0.72.2, no timer) and sends 'lineup'; the one before is "last". Pressing
 * it twice swaps back again. Saved, so it survives a restart. */
function trackTeams(st) {
  // v0.56.5: "last" is the last settled lineup (the game page works it out
  // and sends it as 'lineup'); here it's only put on the status.
  if (!st) return;
  const t = store.get().teamsLast || {};
  st.lastTeam = Array.isArray(t.last) && t.last.length && t.lastLabel ? { name: t.lastLabel } : null;
  pushTeamButton(false);
}
// The lineup report from the game page: what settled, and the one before.
function noteLineup(p) {
  const clean = (a) => (Array.isArray(a) && a.length ? a.map(String).slice(0, 6) : null);
  const s = store.get();
  s.teamsLast = { settled: clean(p && p.settled), last: clean(p && p.last), lastLabel: p && p.lastLabel ? String(p.lastLabel).slice(0, 60) : null };
  store.save();
  if (gardenStatus) trackTeams(gardenStatus);
  if (gardenStatus) sendGardenStatus(gardenStatus);
}
// The rankings plus Pet Power by egg (v0.60.4): eggs from the live catalog
// when the app has read it, ties settled by the eggs you've hatched.
function rankPets(allPets, prefs, stageId) {
  const R = petRank.rank(allPets, prefs, { stage: stageId || (gardenStatus && gardenStatus.stage && gardenStatus.stage.id) || null });
  try {
    R.eggHunt = petRank.eggHunt(R, petData.allEggs(), allPets);
  } catch (err) {
    logError('which eggs to hunt', err);
    R.eggHunt = null;
  }
  return R;
}

// The overlays on the game use the panel's font (Nunito from v0.61.3, Inter
// since v0.67.0). The game page can't load the app's files, so the font goes
// in as data, named 'MG Inter' so it can't clash with the game's own fonts.
let OVERLAY_FONT_CSS = null;
function overlayFontCss() {
  if (OVERLAY_FONT_CSS != null) return OVERLAY_FONT_CSS;
  try {
    const b = fs.readFileSync(path.join(__dirname, 'fonts', 'inter-latin-opsz-normal.woff2')).toString('base64');
    OVERLAY_FONT_CSS = `@font-face{font-family:'MG Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,${b}) format('woff2');}`;
  } catch (err) {
    OVERLAY_FONT_CSS = '';
  }
  return OVERLAY_FONT_CSS;
}

/* When the trough runs out (v0.59.0: a countdown that moves). Each pet out
 * with a measured hunger rate eats when its hunger falls to its eating point
 * (learned from the last meal seen; until then, as soon as a full meal fits)
 * and a meal refills its last meal's amount (until seen, its whole max).
 * Meals are played out in time order, each taking one crop that pet eats,
 * until the trough is empty: that moment is emptyAt, and the panel and the
 * game count down to it. A pet with nothing it eats in the trough is listed
 * with its own time left. */
function troughForecast(pets, trough) {
  const out = (Array.isArray(pets) ? pets : []).filter((p) => p && p.known && p.maxHunger > 0);
  const items = trough && Array.isArray(trough.species) ? trough.species : [];
  const key = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
  const eats = (p, sp) => (p.diet || []).some((d) => key(sp).startsWith(key(d)));
  const left = {};
  for (const sp of items) left[sp] = (left[sp] || 0) + 1;
  let learning = false;
  const starving = [];
  const eaters = [];
  for (const p of out) {
    if (!items.some((sp) => eats(p, sp))) {
      starving.push({ name: p.name || p.species, species: p.species, secondsLeft: p.secondsLeft });
      continue;
    }
    if (!(p.perSecond > 0)) {
      learning = true;
      continue;
    }
    const meal = p.lastMeal > 0 ? p.lastMeal : p.maxHunger;
    const eatAt = p.eatAt != null && p.eatAt >= 0 ? p.eatAt : Math.max(0, p.maxHunger - meal);
    if (!(p.lastMeal > 0) || p.eatAt == null) learning = true;
    const hunger = Number(p.hunger) || 0;
    eaters.push({ p, rate: p.perSecond, meal, eatAt, next: Math.max(0, (hunger - eatAt) / p.perSecond) });
  }
  const edible = items.filter((sp) => out.some((p) => eats(p, sp))).length;
  let emptyIn = null;
  let eaten = 0;
  let perHour = 0;
  for (const e of eaters) perHour += (e.rate / e.meal) * 3600;
  for (let n = 0; n < 2000 && eaters.length; n += 1) {
    const e = eaters.reduce((a, b) => (b.next < a.next ? b : a));
    const sp = Object.keys(left).find((s) => left[s] > 0 && eats(e.p, s));
    if (!sp) {
      eaters.splice(eaters.indexOf(e), 1);
      continue;
    }
    left[sp] -= 1;
    eaten += 1;
    emptyIn = e.next;
    e.next += e.meal / e.rate;
  }
  if (eaten < edible) emptyIn = null;
  return { items: items.length, edible, perHour: perHour > 0 ? Math.round(perHour * 10) / 10 : null, emptyIn: emptyIn == null ? null : Math.round(emptyIn), emptyAt: emptyIn == null ? null : Date.now() + Math.round(emptyIn) * 1000, learning, starving, pets: out.length };
}
function fmtLeft(s) {
  if (s == null) return '';
  const m = Math.max(0, Math.round(s / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
let troughChipKey = '';
function pushTroughChip(t) {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const on = Boolean((store.get().ui || {}).troughHud);
  const urgent = Boolean(t && ((t.emptyIn != null && t.emptyIn < 30 * 60) || (t.starving || []).some((x) => x.secondsLeft != null && x.secondsLeft < 15 * 60)));
  const text = !t ? '' : t.emptyIn != null ? `🍽️ ${fmtLeft(t.emptyIn)}` : t.items === 0 ? '🍽️ empty' : '';
  // The chip counts down to emptyAt itself; resend when the moment shifts
  // by more than half a minute (each status refines it).
  const at = t && t.emptyAt ? Math.round(t.emptyAt / 30000) : null;
  const key = JSON.stringify([on, at, t && t.items === 0, urgent, t && t.learning]);
  if (key === troughChipKey) return;
  troughChipKey = key;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setTroughChip && window.__mgLoaderObserver.setTroughChip(${JSON.stringify({ on, text, urgent, emptyAt: t ? t.emptyAt : null, learning: Boolean(t && t.learning) })})`).catch(() => {});
}
// The swap button on the game (v0.56.4): on or off, and what it brings back.
let teamBtnKey = null;
function pushTeamButton(force) {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  // On unless you turn it off (back on by default in v0.63.11).
  const on = !(store.get().ui && store.get().ui.teamBtn === false);
  const last = gardenStatus && gardenStatus.lastTeam ? { name: gardenStatus.lastTeam.name } : null;
  const key = JSON.stringify([on, last]);
  if (!force && key === teamBtnKey) return;
  teamBtnKey = key;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setTeamButton && window.__mgLoaderObserver.setTeamButton(${JSON.stringify({ on, last })})`).catch(() => {});
}
/* Keys (v0.57.0). The action bar on the game: nine slots on 1-9, each an
 * action (garden-observer.js ACTIONS); and the app's own shortcuts, each
 * rebindable in the panel (Extras → Action bar & keys). */
const DEFAULT_BAR = [
  { key: { code: 'Digit1' }, action: 'pot', arg: null },
  { key: { code: 'Digit2' }, action: 'lastTeam', arg: null },
  { key: { code: 'Digit3' }, action: 'harvestMode', arg: null },
  { key: { code: 'Digit4' }, action: 'harvestLock', arg: null },
  { key: { code: 'Digit5' }, action: 'team', arg: { index: 0 } },
  { key: { code: 'Digit6' }, action: 'team', arg: { index: 1 } },
  { key: { code: 'Digit7' }, action: 'team', arg: { index: 2 } },
  { key: { code: 'Digit8' }, action: 'team', arg: { index: 3 } },
  { key: { code: 'Digit9' }, action: 'team', arg: { index: 4 } },
];
// The game's bag slots 1-9 on keys of their own (the bar has 1-9).
const DEFAULT_BAG_KEYS = Array.from({ length: 9 }, (_, i) => ({ code: `Digit${i + 1}`, shift: true }));
function bagKeysCfg() {
  const k = (store.get().ui || {}).bagKeys;
  return Array.isArray(k) && k.length === 9 ? k : DEFAULT_BAG_KEYS.map((x) => Object.assign({}, x));
}
const APP_KEYS = {
  panel: 'CmdOrCtrl+Shift+D', lastTeam: 'CmdOrCtrl+Shift+T', harvestLock: 'CmdOrCtrl+Shift+L', harvestMode: 'CmdOrCtrl+Shift+M',
  moneyBox: 'CmdOrCtrl+Shift+B', alerts: 'CmdOrCtrl+Shift+A', snooze: 'CmdOrCtrl+Shift+Z', luck: 'CmdOrCtrl+Shift+P',
  addHatch: 'CmdOrCtrl+Shift+H', scripts: 'CmdOrCtrl+Shift+S', runScripts: 'CmdOrCtrl+Shift+R',
};
function appKey(id) {
  const k = ((store.get().ui || {}).appKeys) || {};
  if (k[id] === '') return undefined;
  return typeof k[id] === 'string' ? k[id] : APP_KEYS[id];
}
function actionBarCfg() {
  const ui = store.get().ui || {};
  const b = ui.actionBar && typeof ui.actionBar === 'object' ? ui.actionBar : {};
  return { on: b.on !== false, shape: b.shape === 'line' ? 'line' : 'square', slots: Array.isArray(b.slots) && b.slots.length === 9 ? b.slots : DEFAULT_BAR.map((s) => Object.assign({}, s)) };
}
function pushActionBar(extra) {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const ui = store.get().ui || {};
  const v = Object.assign(actionBarCfg(), { potCommand: ui.potCommand || null, bagKeys: bagKeysCfg() }, extra || {});
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setActionBar && window.__mgLoaderObserver.setActionBar(${JSON.stringify(v)})`).catch(() => {});
  // And where the garden sits in the world, as learned so far (v0.57.6).
  const calib = ui.mapCalibBySlot && typeof ui.mapCalibBySlot === 'object' && Object.keys(ui.mapCalibBySlot).length ? ui.mapCalibBySlot : Array.isArray(ui.mapCalib) ? ui.mapCalib : [];
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setMapCalib && window.__mgLoaderObserver.setMapCalib(${JSON.stringify(calib)})`).catch(() => {});
}
// Quick plant (v0.56.15): the button on the game, on or off, and the seed picked.
function pushPlantButton(resetPlace) {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const ui = store.get().ui || {};
  const v = { on: ui.plantBtn === true, pick: typeof ui.plantPick === 'string' ? ui.plantPick : null, resetPlace: resetPlace === true };
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setPlantButton && window.__mgLoaderObserver.setPlantButton(${JSON.stringify(v)})`).catch(() => {});
}
function pushLineups() {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const t = store.get().teamsLast || {};
  const v = { settled: Array.isArray(t.settled) ? t.settled : null, last: Array.isArray(t.last) ? t.last : null, lastLabel: t.lastLabel || null };
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setLineups && window.__mgLoaderObserver.setLineups(${JSON.stringify(v)})`).catch(() => {});
}
async function swapToLastTeam() {
  if (!gameWindow || gameWindow.isDestroyed() || parked) return { ok: false, reason: 'The game isn\'t open.' };
  let r;
  try {
    r = await gameView.webContents.executeJavaScript('window.__mgLoaderObserver && window.__mgLoaderObserver.restoreLineup ? window.__mgLoaderObserver.restoreLineup() : null', true);
  } catch (err) {
    r = { ok: false, reason: String((err && err.message) || err) };
  }
  if (!r) return { ok: false, reason: 'The game page didn\'t answer.' };
  if (r.ok && !r.already) recordNote(`🐾 Back to ${r.team}`);
  return r;
}

function checkPendingTeam(st) {
  if (!pendingTeam) return;
  const team = (st.teams || []).find((t) => t.id === pendingTeam.id);
  if (team && teamIsOut(team, st.pets)) {
    recordNote(`🐾 Switched to ${pendingTeam.name}${pendingTeam.why ? ' ' + pendingTeam.why : ''}`);
    pendingTeam = null;
  } else if (Date.now() - pendingTeam.at > 20000) {
    recordNote(`⚠️ Tried to switch to ${pendingTeam.name}, but the game didn't change teams`, 'Pet team swap didn\'t work');
    pendingTeam = null;
  }
}

// The team to go back to after the weather: remembered when a weather team
// is swapped in, used when the weather ends and nothing is set for clear
// skies. Kept in settings (main-owned) so a restart mid-weather still
// returns. { from: teamId|null, fromName, to: the weather team's id }
function weatherReturn() {
  const s = store.get();
  return s.weatherReturn && typeof s.weatherReturn === 'object' ? s.weatherReturn : null;
}
function setWeatherReturn(v) {
  const s = store.get();
  if (v) s.weatherReturn = v;
  else delete s.weatherReturn;
  store.save();
}

/* Your usual clear-skies team (v0.75.1), for "Detect my usual team" as the
 * clear-skies pick: the last saved team you ran for 10 minutes in clear
 * skies. Harvesting unlocked's team doesn't count, and neither does time
 * while a clear-skies suggestion is waiting for you (whatever's out then
 * isn't your pick yet). Kept in settings (main-owned), so a restart keeps it. */
let USUAL_SETTLE_MS = 10 * 60000;
let clearRun = null; // { teamId, since, last }
function usualTeamState() {
  const s = store.get();
  if (!s.usualTeam || typeof s.usualTeam !== 'object') s.usualTeam = { teamId: null, name: null, at: null };
  return s.usualTeam;
}
function trackUsualTeam(st) {
  if (!st || !st.foundSelf || parked) {
    clearRun = null;
    return;
  }
  const waiting = Boolean(teamSuggestion && teamSuggestion.weather === 'clear');
  const out = weather.kindOf(st.weather) === 'clear' && !harvestLock().mode.on && !waiting
    ? (st.teams || []).find((t) => teamIsOut(t, st.pets))
    : null;
  const now = Date.now();
  // A gap in the game's reports (asleep, disconnected) starts the clock again.
  if (!out || !clearRun || clearRun.teamId !== out.id || now - clearRun.last > 120000) {
    clearRun = out ? { teamId: out.id, since: now, last: now } : null;
    return;
  }
  clearRun.last = now;
  if (now - clearRun.since < USUAL_SETTLE_MS) return;
  const u = usualTeamState();
  if (u.teamId !== out.id || u.name !== out.name) {
    Object.assign(u, { teamId: out.id, name: out.name, at: now });
    store.save();
  }
}
function usualTeam(st) {
  const u = usualTeamState();
  const t = u.teamId && st && (st.teams || []).find((x) => x.id === u.teamId);
  return t ? { id: t.id, name: t.name } : null;
}

function checkWeatherTeam(st) {
  const cfg = store.get().weatherTeams;
  if (!cfg || !cfg.enabled || parked || !st.foundSelf || !st.canSend) return;
  const kind = weather.kindOf(st.weather);
  if (kind === null) return; // weather we don't recognise: leave the pets alone
  // The weather alone (v0.63.11): the connection was in the key from the days
  // of swapping by itself (to swap again after a reconnect); for suggestions
  // it re-suggested, and notified, on every reconnect mid-weather.
  const key = kind;
  if (key === lastTeamKey) return;
  lastTeamKey = key;
  // A suggestion made for weather that's over goes away (v0.74.1): away for
  // the whole spell, you came back to "Put out your rain team?" under clear
  // skies. (So does "go back" once new weather starts.)
  if (teamSuggestion && teamSuggestion.weather && teamSuggestion.weather !== kind) clearTeamSuggestion();
  let teamId = cfg[kind];
  // "Detect my usual team" (v0.75.1); none learned yet: as if none was picked.
  if (teamId === 'auto') teamId = kind === 'clear' ? (usualTeam(st) || {}).id || null : null;
  const back = weatherReturn();
  if (kind === 'clear') {
    if (teamId) {
      setWeatherReturn(null);
    } else if (back && back.from) {
      // Nothing set for clear skies: put back the team from before the
      // weather, but only if the weather team is still out (a swap by hand
      // or by a trigger since then is left alone).
      setWeatherReturn(null);
      const weatherTeam = (st.teams || []).find((t) => t.id === back.to);
      if (weatherTeam && teamIsOut(weatherTeam, st.pets)) {
        suggestTeam(back.from, '(the weather is over)', '☀️', 'clear');
      }
      return;
    } else {
      setWeatherReturn(null);
      return;
    }
  } else if (teamId) {
    // Weather with a team set: remember what was out before (once per spell
    // of weather; rain turning to thunder keeps the first).
    if (!back) {
      const out = (st.teams || []).find((t) => teamIsOut(t, st.pets));
      setWeatherReturn({ from: out ? out.id : null, fromName: out ? out.name : null, to: teamId, at: Date.now() });
    } else {
      setWeatherReturn(Object.assign({}, back, { to: teamId }));
    }
  }
  if (!teamId) return;
  const why = kind === 'clear' ? '(the weather cleared)' : `for ${weather.label(kind)}`;
  suggestTeam(teamId, why, (weather.BY_ID[kind] && weather.BY_ID[kind].emoji) || '🌦️', kind);
}

/* Team suggestions (v0.60.0, fair play): the app never changes your pets by
 * itself. When the weather changes, when it's over, or when a team
 * trigger's goal is met, it suggests the team you chose: on the game (with a
 * Put out button), in the panel, and as a desktop notification. You press
 * the button. A suggestion clears once that team is out, or (a weather
 * one) once its weather is over; its desktop notification goes with it. */
let teamSuggestion = null;
let teamToast = null;
function closeTeamToast() {
  if (!teamToast) return;
  try {
    teamToast.close();
  } catch (err) {
    /* already gone */
  }
  teamToast = null;
}
// The same team for the same reason isn't suggested again within 15
// minutes, whatever asks (v0.63.11: one Thunderstorm suggested it 3 times).
let lastSuggested = null;
// forWeather: the weather a suggestion is for, so it can go when that does.
function suggestTeam(teamId, why, emoji, forWeather) {
  const st = gardenStatus;
  const team = st && (st.teams || []).find((t) => t.id === teamId);
  if (!team) return;
  if (teamIsOut(team, st.pets)) {
    clearTeamSuggestion();
    return;
  }
  const now = Date.now();
  if (lastSuggested && lastSuggested.teamId === teamId && lastSuggested.why === why && now - lastSuggested.at < 15 * 60000) return;
  lastSuggested = { teamId, why, at: now };
  teamSuggestion = { teamId, name: team.name, why: String(why || '').replace(/^\(|\)$/g, ''), emoji: emoji || '🐾', at: Date.now(), weather: forWeather || null };
  pushTeamSuggestion();
  closeTeamToast();
  // "your dawn team", not "your dawn team team" (v0.61.6)
  const teamWords = /team$/i.test(String(team.name).trim()) ? team.name : `${team.name} team`;
  recordNote(`💡 Suggested your ${teamWords} ${why}`);
  teamToast = desktopNotify(`${teamSuggestion.emoji} Put out your ${teamWords}?`, `Suggested ${teamSuggestion.why}. Press Put out on the game to switch.`, 'teams') || null;
}
function clearTeamSuggestion() {
  closeTeamToast();
  if (!teamSuggestion) return;
  teamSuggestion = null;
  pushTeamSuggestion();
}
function pushTeamSuggestion() {
  const contents = gameView && gameView.webContents;
  if (contents && !contents.isDestroyed()) contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.showTeamSuggest && window.__mgLoaderObserver.showTeamSuggest(${JSON.stringify(teamSuggestion)})`, true).catch(() => {});
  sendToControl('team:suggest', teamSuggestion);
}
// The player's answer (a click on the game or in the panel).
// (v0.63.7: no "Bring it back" after Not now: the owner found it annoying.)
async function answerTeamSuggestion(act) {
  const s = teamSuggestion;
  if (!s) return { ok: false, reason: 'Nothing suggested right now.' };
  clearTeamSuggestion();
  if (act !== 'apply') return { ok: true, dismissed: true };
  const r = await applyTeam(s.teamId, '(you pressed Put out)');
  if (!r.ok) recordNote(`⚠️ Couldn't put out ${s.name}: ${r.reason}`);
  return r;
}
// A suggestion goes away once its team is out (you swapped by hand, say).
function checkTeamSuggestion(st) {
  if (!teamSuggestion || !st) return;
  const team = (st.teams || []).find((t) => t.id === teamSuggestion.teamId);
  if (!team || teamIsOut(team, st.pets)) clearTeamSuggestion();
}

/* Weather you don't want (v0.60.2): a gentle ping when it starts, once per
 * spell of it: a note, a desktop notification, and a soft chime in the
 * panel. Its own switch (logoff.ping, on by default), apart from Ask me to
 * step away; the weather picked is logoff.kinds. */
let lastUnwanted = null;
function checkUnwantedWeather(st) {
  // Not while the game is away: missing weather reads as clear, and a
  // reconnect mid-rain would ping again (v0.63.3).
  if (!st || !st.foundSelf || st.weather == null) return;
  const l = store.get().logoff || {};
  const kind = st && weather.kindOf(st.weather);
  if (!kind || kind === 'clear' || !(l.kinds || []).includes(kind)) {
    lastUnwanted = null;
    return;
  }
  if (lastUnwanted === kind || l.ping === false || parked) return;
  lastUnwanted = kind;
  // That weather's own alert is on: it announces it already (v0.63.7).
  if (!((store.get().alerts || {}).disabled || []).includes(kind)) return;
  // Ask me to step away is on: its "about to start" said it (v0.63.11).
  if (l.enabled) return;
  const label = weather.label(kind);
  const emoji = (weather.BY_ID[kind] && weather.BY_ID[kind].emoji) || '🌦️';
  sendToControl('weather:ping', { kind, label, emoji, quiet: hushNow() });
  recordNote(`${emoji} ${label} started (weather you don't want)`);
  desktopNotify(`${emoji} ${label} started`, 'Weather you don\'t want on your garden.', 'weather');
}

/* Pet-food pots for weather (v0.63.0). Some pet food can't fill a pet's bar
 * unmutated (the owner's: Lychee, kept in pots). When a weather you'll stay
 * in for starts (not one you'd rather not have), the game gets a card to
 * plant those pots out, one press per pot; when it ends, a card to pot them
 * back up, one press each. The game page counts what's in the bag / garden
 * and only shows a card if there's something to do. */
let potWeatherKind;
// v0.63.4: pet food = what's in your trough (what you actually feed; the
// potted kinds if the trough's empty). It needs weather if even its largest
// unmutated size (base x max size) can't fill the bar of a pet you own that
// eats it. Owner: Lychee 50K x 2 = 100K < Capybara 150K; Cacao 375K fills
// a Phoenix's 300K; Eggplant 250K fills a Pig's 50K. Your ticks override it.
// The trough's last contents are remembered while the app runs, so a trough
// that's just run dry still knows your pet food. Never guessed from pots:
// you keep all sorts of plants in pots.
let lastTroughSpecies = [];
function petFoodCandidates(st) {
  const trough = [...new Set(((st && st.trough && st.trough.species) || []).filter(Boolean))];
  if (trough.length) lastTroughSpecies = trough;
  return lastTroughSpecies.slice();
}
function petFoodSuggested(st) {
  const CROPS = cropData.CROPS || {};
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const byNorm = {};
  for (const k of Object.keys(CROPS)) byNorm[norm(k)] = CROPS[k];
  const owned = [...new Set(((st && st.allPets) || []).map((p) => p.species))];
  return petFoodCandidates(st).filter((crop) => {
    const c = byNorm[norm(crop)];
    if (!c) return false;
    const most = c[0] * (c[1] || 1);
    return owned.some((sp) => {
      const e = petData.PETS[sp];
      return e && (e[1] || []).some((x) => norm(x) === norm(crop)) && most < e[0];
    });
  });
}
function petFoodNeedsWeather(st) {
  const ui = store.get().ui || {};
  return Array.isArray(ui.potWeatherSpecies) ? ui.potWeatherSpecies : petFoodSuggested(st);
}
function checkPotWeather(st) {
  // Only while the game is found and saying what the weather is: missing
  // weather reads as clear, so a disconnect would look like it ended
  // (v0.63.3).
  if (!st || !st.foundSelf || st.weather == null) return;
  const kind = weather.kindOf(st.weather) || 'clear';
  if (potWeatherKind === undefined) {
    potWeatherKind = kind;
    return;
  }
  if (kind === potWeatherKind) return;
  const prev = potWeatherKind;
  potWeatherKind = kind;
  // Off unless you turn it on (v0.63.4).
  if (parked || (store.get().ui || {}).potWeather !== true) return;
  const unwanted = new Set((store.get().logoff || {}).kinds || []);
  const species = petFoodNeedsWeather(st);
  if (!species.length) return;
  const info = (k) => ({ kind: k, label: weather.label(k), emoji: (weather.BY_ID[k] && weather.BY_ID[k].emoji) || '🌦️' });
  let msg = null;
  if (kind !== 'clear' && !unwanted.has(kind)) msg = Object.assign({ mode: 'plant', species }, info(kind));
  else if (prev && prev !== 'clear' && !unwanted.has(prev)) msg = Object.assign({ mode: 'pick', species }, info(prev));
  if (!msg) return;
  const contents = gameView && gameView.webContents;
  if (contents && !contents.isDestroyed()) contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.potWeather && window.__mgLoaderObserver.potWeather(${JSON.stringify(msg)})`, true).catch(() => {});
}

/* Desktop notifications (v0.60.0): weather (step away, it's over) and team
 * suggestions, each with its own switch (ui.desktopNotify). Clicking one
 * brings the app to the front. */
// Quiet hours or a snooze (v0.61.5): the newer pings make no sound then
// (their notes and notifications still show, silently).
function hushNow() {
  try {
    const s = store.get();
    return Boolean(alerts.inQuietHours(s) || isSnoozed(s));
  } catch (err) {
    return false;
  }
}
function desktopNotify(title, body, kind, meta) {
  try {
    const cfg = Object.assign({ on: true, weather: true, teams: true, quests: true }, (store.get().ui || {}).desktopNotify);
    if (!cfg.on || (kind && cfg[kind] === false)) return;
    return showToast({ title: String(title).slice(0, 120), body: String(body || '').slice(0, 240), silent: hushNow() }, meta);
  } catch (err) {
    logError('desktop notification', err);
  }
  return false;
}

/* ================================================================== *
 * Team triggers: swap teams when the garden reaches a goal
 *
 * A rule says "when N% of my (ready) crops are X, switch to team T",
 * optionally only during one kind of weather. It fires once when the goal is
 * reached, and re-arms when the garden drops back below it (you harvest and
 * replant, say). If a trigger's goal is met, it wins over the weather team.
 * ================================================================== */

const TRIGGER_METRICS = {
  wet: { label: 'Wet', keys: ['wet'] },
  chilled: { label: 'Chilled', keys: ['chilled'] },
  frozen: { label: 'Frozen', keys: ['frozen'] },
  thunderstruck: { label: 'Thunderstruck', keys: ['thunderstruck', 'thundercharged'] },
  dawnlit: { label: 'Dawnlit', keys: ['dawnlit', 'dawnbound'] },
  amberlit: { label: 'Amberlit', keys: ['amberlit', 'amberbound'] },
  hydro: { label: 'any hydro mutation', keys: ['wet', 'chilled', 'frozen', 'thunderstruck', 'thundercharged'] },
  lunar: { label: 'Dawnlit or Amberlit', keys: ['dawnlit', 'amberlit', 'dawnbound', 'amberbound'] },
  gold: { label: 'Gold', keys: ['gold'] },
  rainbow: { label: 'Rainbow', keys: ['rainbow'] },
  special: { label: 'Gold or Rainbow', keys: null },
  fullsize: { label: 'full size', keys: null },
};

// { pct, count, of } for a rule, or null when there's nothing to measure.
function triggerValue(st, rule) {
  const b = (st.crops || []).find((x) => /garden/i.test(x.name));
  const m = TRIGGER_METRICS[rule.metric];
  if (!b || !b.total || !m) return null;
  let count;
  if (rule.metric === 'fullsize') count = b.atMax || 0;
  else if (rule.metric === 'special') count = b.special != null ? b.special : (b.gold || 0) + (b.rainbow || 0);
  else count = m.keys.reduce((a, k) => a + ((b.mutations || {})[k] || 0), 0);
  // Growing crops catch weather too, just less often than ready ones (the
  // owner's experience; the rate difference isn't published). So the
  // default measure is every crop; a rule can choose ready crops instead.
  const weatherish = !['gold', 'rainbow', 'special', 'fullsize'].includes(rule.metric);
  const of = weatherish && rule.basis === 'ready' && b.matureKnown ? b.mature : rule.metric === 'fullsize' ? b.sized || b.total : b.total;
  if (!of) return null;
  return { pct: Math.min(100, (count / of) * 100), count: Math.min(count, of), of };
}

function describeTrigger(rule) {
  const m = TRIGGER_METRICS[rule.metric] || { label: rule.metric };
  return rule.metric === 'fullsize' ? `${rule.pct}% of crops are full size` : `${rule.pct}% of ${rule.basis === 'ready' ? 'ready ' : ''}crops are ${m.label}`;
}

const triggerFired = {};
let triggerConnection = null;

// Returns true if a trigger swapped teams this time.
function checkTriggers(st) {
  const all = (store.get().teamTriggers || []).filter((r) => r && r.id);
  // Every rule's current value, for the panel, even the ones switched off.
  st.triggerValues = {};
  for (const r of all) st.triggerValues[r.id] = triggerValue(st, r);
  const rules = all.filter((r) => r.on && r.teamId);
  if (!rules.length || parked || !st.foundSelf || !st.canSend) return false;
  if (st.connection !== triggerConnection) {
    triggerConnection = st.connection;
    for (const k of Object.keys(triggerFired)) delete triggerFired[k];
  }
  const kind = weather.kindOf(st.weather);
  let swapped = false;
  for (const rule of rules) {
    const v = st.triggerValues[rule.id];
    if (!v) continue;
    const met = v.pct >= Number(rule.pct || 100) - 1e-9;
    if (!met) {
      triggerFired[rule.id] = false;
      continue;
    }
    if (rule.weather && rule.weather !== kind) continue;
    if (triggerFired[rule.id] || swapped) continue;
    triggerFired[rule.id] = true;
    const team = (st.teams || []).find((t) => t.id === rule.teamId);
    if (!team || teamIsOut(team, st.pets)) continue;
    swapped = true;
    suggestTeam(rule.teamId, `(${describeTrigger(rule)})`, '🎯');
  }
  return swapped;
}

/* ================================================================== *
 * Logging off for weather
 *
 * Weather only mutates crops while you're online (magicgarden.wiki/Weather_Events),
 * so stepping out of the game keeps chosen weather off your crops. The game
 * window shows a small "back soon" page in the meantime, which closes the
 * game's connection the normal way, and comes back when the weather ends.
 * ================================================================== */

let parkTimer = null;
let rejoinTimer = null;
/* Spells of weather (v0.64.0). One question per spell of weather you don't
 * want, matched to the feed's own start time. stayedIn is the spell you
 * stayed in for: you pressed Stay in, didn't answer (that's staying in
 * too), or rejoined by hand mid-weather. feedSpells keeps the feed's last
 * spell of each kind after it ends: the game keeps reporting a weather for
 * a little while after the feed has moved on, and that's the same spell,
 * over, not a new one to ask about. */
let stayedIn = null; // { kind, startsAt, endsAt, at, synthetic }
const feedSpells = {};
const SPELL_GRACE_MS = 5 * 60000;
// synthetic: the spell was the app's stand-in while the feed was silent (it
// has no end time), so its start time is made up.
function stayIn(kind, startsAt, endsAt, synthetic) {
  if (!kind) return;
  stayedIn = { kind, startsAt: startsAt || null, endsAt: endsAt || null, at: Date.now(), synthetic: Boolean(synthetic || !endsAt) };
}
function isStayedIn(e) {
  if (!stayedIn || !e || stayedIn.kind !== e.kind) return false;
  if (e.startsAt && stayedIn.startsAt === e.startsAt) return true;
  // Two spells from the feed are the same only by their start time. With a
  // stand-in on either side (the feed went quiet, or came back), it's the
  // same spell if you answered just before it started or during it.
  if (!(e.synthetic || stayedIn.synthetic)) return false;
  const start = Date.parse(e.startsAt);
  const end = Date.parse(e.endsAt);
  if (!Number.isFinite(start)) return false;
  return stayedIn.at >= start - 3 * 60000 && (!Number.isFinite(end) || stayedIn.at <= end + SPELL_GRACE_MS);
}
function noteFeedSpell(cur) {
  if (cur && cur.kind && cur.kind !== 'clear' && cur.startsAt) feedSpells[cur.kind] = { kind: cur.kind, startsAt: cur.startsAt, endsAt: cur.endsAt };
}
// The feed's spell of this kind that's on now (from two minutes before its
// start to five after its end), if there is one.
function spellNow(kind, now) {
  const status = watcher ? watcher.status() : null;
  const evs = [status && status.current, ...((status && status.upcoming) || []), feedSpells[kind]];
  for (const e of evs) {
    if (!e || e.kind !== kind || !e.startsAt) continue;
    const s = Date.parse(e.startsAt);
    const en = Date.parse(e.endsAt) || s + 10 * 60000;
    if (now >= s - 2 * 60000 && now <= en + SPELL_GRACE_MS) return e;
  }
  return null;
}
let gameSpell = null; // the game's report standing in for the feed, kept steady

// Step away now (v0.64.2): the weather you're stepping away from. The feed's
// weather that's on; else the game's own (the feed can lag), with its end
// time when the feed knows the spell; else weather starting within 10
// minutes (stepping away a little early). Null: clear skies, a break.
const STEP_EARLY_MS = 10 * 60000;
function weatherToStepAwayFrom(now, feed, game) {
  const st = feed !== undefined ? feed : watcher ? watcher.status() : null;
  const gs = game !== undefined ? game : gardenStatus;
  const real = (e) => e && e.kind && e.kind !== 'clear';
  const cur = st && st.current;
  if (real(cur) && !(Date.parse(cur.endsAt) <= now)) return cur;
  const gk = gs && gs.connected !== false ? gs.weatherKind : null;
  if (gk && gk !== 'clear') {
    const spell = spellNow(gk, now);
    if (spell && !(Date.parse(spell.endsAt) <= now)) return spell;
    return { kind: gk, startsAt: null, endsAt: null };
  }
  return ((st && st.upcoming) || []).find((e) => real(e) && Date.parse(e.startsAt) - now <= STEP_EARLY_MS && !(Date.parse(e.endsAt) <= now)) || null;
}
// A step-away with no weather to wait out (Step away now on a clear sky).
const isBreak = (p) => !p || !p.kind || p.kind === 'clear';

function logoffKinds() {
  const l = store.get().logoff;
  return l && l.enabled ? new Set(l.kinds || []) : new Set();
}

function sendParked() {
  sendToControl('game:parked', parked);
}

function park(kind, untilIso, eventKey, manual) {
  if (!gameWindow || gameWindow.isDestroyed()) return;
  if (!manual && eventKey && isStayedIn({ kind, startsAt: eventKey, endsAt: untilIso })) return;
  const until = Date.parse(untilIso) || null;
  if (parked) {
    if (until && !parked.until) parked.until = until;
    sendParked();
    scheduleRejoin();
    return;
  }
  const label = kind && kind !== 'clear' ? weather.label(kind) : 'a break';
  parked = { kind, label, until, since: Date.now(), eventKey: eventKey || null, manual: Boolean(manual) };
  clearTimeout(parkTimer);
  const autoBack = false; // v0.60.0: you press Rejoin
  showParkedPage();
  recordNote(
    manual
      ? `🚪 Stepped away${kind && kind !== 'clear' ? ` for ${label}` : ''} (you pressed Step away now)`
      : `🚪 Stepped away for ${label}${until && autoBack ? `, back about ${clock(until + 10000)}` : ''}`,
    manual ? null : `Stepped away for ${label}`
  );
  sendParked();
  scheduleRejoin();
}

// The "back soon" page in the game window. Shown again whenever the end
// time becomes known, so its countdown is right.
function showParkedPage() {
  if (!parked || !gameWindow || gameWindow.isDestroyed()) return;
  const autoBack = false; // v0.60.0: you press Rejoin
  gameView.webContents.loadFile(path.join(__dirname, 'parked.html'), {
    // v0.60.3: a big countdown, then "Safe to join" (the page turns over by
    // itself at the end time; over=1 once the app knows it's over).
    query: {
      weather: parked.label,
      emoji: (weather.BY_ID[parked.kind] && weather.BY_ID[parked.kind].emoji) || '🌙',
      until: parked.until ? String(parked.until) : '',
      since: String(parked.since || Date.now()),
      kind: parked.kind || '',
      over: parked.overSaid ? '1' : '',
      start: parked.eventKey && Date.parse(parked.eventKey) ? String(Date.parse(parked.eventKey)) : '',
      reconnect: parked.autoBack ? '1' : '',
      ...nowWeatherQuery(),
      rejoin: autoBack ? '1' : '0',
    },
  });
}

// v0.60.0: no coming back by itself. When the weather's over, it says so
// (a note, a desktop notification, the page's Rejoin) and you press Rejoin.
function scheduleRejoin() {
  clearTimeout(rejoinTimer);
  if (isBreak(parked) || !parked.until) return;
  const wait = Math.max(1000, parked.until + 5000 - Date.now());
  rejoinTimer = setTimeout(weatherOver, wait);
}
function weatherOver() {
  if (!parked || parked.overSaid) return;
  parked.overSaid = true;
  // You pressed "Reconnect when it ends" for this weather (v0.60.5).
  if (parked.autoBack) {
    const label = parked.label;
    // One note and one notification (v0.63.7: it used to say it three ways).
    recordNote(`👋 Back in the game: ${label} is over (you asked to reconnect)`);
    desktopNotify('👋 Back in the game', `${label}'s over: reconnected, as you asked.`, 'weather');
    rejoin(false, true);
    return;
  }
  recordNote(`☀️ ${parked.label} is over: safe to join`);
  desktopNotify('☀️ Safe to join!', `${parked.label}'s over. Press Join the game whenever you're ready.`, 'weather');
  showParkedPage();
  sendToControl('weather:safe', { label: parked.label, emoji: (weather.BY_ID[parked.kind] && weather.BY_ID[parked.kind].emoji) || '🌦️', quiet: hushNow() });
  sendParked();
}

function rejoin(byHand, quiet) {
  clearTimeout(rejoinTimer);
  if (!parked) return;
  const was = parked;
  if (byHand && was.eventKey) stayIn(was.kind, was.eventKey, was.until ? new Date(was.until).toISOString() : null);
  parked = null;
  lastTeamKey = null;
  if (!quiet) recordNote(byHand || was.manual ? '👋 Back in the game' : `👋 Back in the game, ${was.label} is over`);
  sendParked();
  if (gameWindow && !gameWindow.isDestroyed()) gameView.webContents.loadURL(GAME_URL);
}

// Called with every shop-feed status. Parks now if chosen weather is on, or
// sets a timer to park shortly before the next one starts.
// The game's weather right now, for the stepped-away page (v0.61.1): it
// follows the game's weather while you're out (rainy if it's raining).
function nowWeatherInfo(cur) {
  const c = cur || (watcher && watcher.status().current) || null;
  const kind = c && c.kind && c.kind !== 'clear' ? c.kind : '';
  return { kind, label: kind ? weather.label(kind) : '', emoji: kind ? (weather.BY_ID[kind] && weather.BY_ID[kind].emoji) || '' : '', endsAt: kind ? Date.parse(c.endsAt) || 0 : 0 };
}
function nowWeatherQuery() {
  const w = nowWeatherInfo();
  return { now: w.kind, nowLabel: w.label, nowEmoji: w.emoji, nowEnds: w.endsAt ? String(w.endsAt) : '' };
}
let lastNowPushed = '';
function pushNowWeather(cur) {
  if (!parked || !gameView || gameView.webContents.isDestroyed()) return;
  const w = nowWeatherInfo(cur);
  const key = JSON.stringify(w);
  if (key === lastNowPushed) return;
  lastNowPushed = key;
  gameView.webContents.executeJavaScript(`window.__nowWeather && window.__nowWeather(${key})`).catch(() => {});
}

// When to ask about weather you don't want (v0.63.9): usually the lead plus
// 20 seconds to answer before it starts; but when a Dawn or Amber Moon runs
// right up to it (still on within a minute of it starting), only 10 seconds
// before: you almost never want to leave a moon event early.
const MOON_KINDS = new Set(['dawn', 'amber']);
function moonRunsUpTo(next, events) {
  const start = Date.parse(next && next.startsAt);
  if (!Number.isFinite(start)) return false;
  return (events || []).some((e) => e && e !== next && MOON_KINDS.has(e.kind)
    && Date.parse(e.startsAt) < start && Date.parse(e.endsAt) >= start - 60000);
}
function stepAskAt(next, events, lead) {
  const start = Date.parse(next.startsAt);
  return moonRunsUpTo(next, events) ? start - 10000 : start - lead - STEP_ASK_MS;
}

function planLogoff(status) {
  clearTimeout(parkTimer);
  const kinds = logoffKinds();
  if (!status) return;
  const now = Date.now();
  const cur = status.current;
  noteFeedSpell(cur);
  pushNowWeather(cur);

  if (parked) {
    if (isBreak(parked)) return;
    // Parked by the live game before the feed knew the end time: take it now.
    if (!parked.until && cur && cur.kind === parked.kind) {
      parked.until = Date.parse(cur.endsAt) || null;
      parked.eventKey = parked.eventKey || cur.startsAt;
      showParkedPage();
      sendParked();
      scheduleRejoin();
      return;
    }
    // The weather's over (v0.60.0): say so; you press Rejoin.
    const over = parked.until ? now >= parked.until : (!cur || cur.kind !== parked.kind) && now - parked.since > 120000;
    if (over) weatherOver();
    return;
  }
  if (!kinds.size) return;

  // Chosen weather is on: ask (v0.60.0: the app never steps out by itself).
  if (cur && cur.kind && kinds.has(cur.kind) && Date.parse(cur.endsAt) > now) {
    if (!stepAsk && !isStayedIn(cur)) askStepOut(cur, now);
    return;
  }

  const lead = Math.max(0, Number(store.get().logoff.leadSeconds) || 30) * 1000;
  const next = (status.upcoming || []).find((e) => e.kind && kinds.has(e.kind));
  if (next) {
    // Already asking about this one: its own timer carries on.
    if (stepAsk && stepAsk.eventKey === next.startsAt) return;
    if (isStayedIn(next)) return;
    const askAt = stepAskAt(next, [cur, ...(status.upcoming || [])], lead);
    if (askAt - now < 6 * 60 * 60 * 1000) {
      // Shortly before it starts, ask (Step away / Ignore). No answer: nothing
      // happens (v0.60.0); the card stays until the weather starts.
      parkTimer = setTimeout(() => askStepOut(next, askAt), Math.max(0, askAt - now));
    }
  }
}

/* "You're about to step out for upcoming weather": a 20-second card over the
 * game. Confirm steps out now, Ignore skips this weather event (the setting
 * stays on), no answer steps out when the countdown ends. The countdown gets
 * its full 20 seconds even when the warning comes late, but never runs past
 * the weather's start. */
const STEP_ASK_MS = 20000;
if (process.env.MG_TEST_DIR) {
  globalThis.__mgTest = Object.assign(globalThis.__mgTest || {}, {
    askStepOut: (next, at) => askStepOut(next, at),
    stepAsk: () => (stepAsk ? { label: stepAsk.label, until: stepAsk.until, eventKey: stepAsk.eventKey } : null),
    parked: () => parked,
    skipEvent: () => (stayedIn ? stayedIn.startsAt : null),
    stayedIn: () => stayedIn,
    checkLogoffFromGame: (w) => checkLogoffFromGame(Object.assign({}, gardenStatus, { weather: w })),
    noteFeedSpell: (e) => noteFeedSpell(e),
    stepOutAnswer: (act) => stepOutAnswer(act),
    rejoin: () => rejoin(true),
    weatherOver: () => weatherOver(),
    recheckWeatherTeam: (connection) => checkWeatherTeam(Object.assign({}, gardenStatus, { connection })),
    suggestedAt: () => (lastSuggested ? lastSuggested.at : null),
    namingRaw: () => JSON.parse(JSON.stringify(petNaming())),
    namingTier: (id) => namingTier(gardenStatus, id),
    usualSettle: (ms) => {
      USUAL_SETTLE_MS = ms;
    },
    plantMutRows: (plants) => plantMutRows(plants),
    plantStateAt: (h, end) => plantStateAt(h, end),
    recordMutations: (st, t) => recordMutations(st, t),
    autoBack: () => Boolean(parked && parked.autoBack),
    weatherToStepAwayFrom: (now, feed, game) => weatherToStepAwayFrom(now, feed, game),
    goAway: (why, since) => goAway(why, since),
    checkQuestReminder: (now, view) => checkQuestReminder(now, view),
    noteNight: (data, now) => noteNight(data, now),
    nightInfo: (now) => nightInfo(now),
    themeNow: (now) => themeNow(now),
    pushMapPin: () => pushMapPin(true),
    pushHatch: () => pushHatch(true),
    // The quest reminder test runs at any hour: in the last hour before the
    // reset the real reminder may already have gone today.
    perfView: () => perfView(),
    resetQuestRemind: () => {
      const q = store.get().quests;
      if (q) q.remindDay = null;
    },
    lastHatchBlocked: () => lastHatchBlocked,
    luckRaw: () => luckState(),
    recoverTypedLuck: () => recoverTypedLuck(),
    backupsDir: () => backupsDir(),
    alertHistory: () => store.get().alertHistory,
    noteEventSign: (id, now) => noteEventSign(id, now),
    resetEvents: () => {
      store.get().events = {};
    },
    resetNight: () => {
      nightOpenSince = null;
      const s = store.get();
      s.night = { lastStart: null, lastEnd: null };
    },
    petLookup: (sp) => petData.lookup(sp),
    catalogInfo: () => catalogInfo,
    questsView: (payload) => questsView(payload),
    comeBack: () => comeBack(),
    presence: () => ({ away: presence.away, held: presence.held, settling: Date.now() < presence.settleUntil }),
    toastAllowed: (meta) => toastAllowed(meta),
    resetToasts: () => {
      presence.settleUntil = 0;
      toastTimes.length = 0;
    },
    stepAwayNowFor: (ev) => park(ev.kind, ev.endsAt || null, ev.startsAt || null, true),
  });
}
let stepAsk = null;
function askStepOut(next, at) {
  if (parked || stepAsk || isStayedIn(next)) return;
  const now = Date.now();
  const start = Date.parse(next.startsAt) || now + STEP_ASK_MS;
  // The card stays up until the weather starts (or, if it's on already,
  // until it ends); then it just goes away.
  const end = Date.parse(next.endsAt) || start + 10 * 60 * 1000;
  const until = start > now ? Math.max(start, now + STEP_ASK_MS) : Math.max(end, now + STEP_ASK_MS);
  const label = weather.label(next.kind);
  const emoji = (weather.BY_ID[next.kind] && weather.BY_ID[next.kind].emoji) || '🌦️';
  stepAsk = { kind: next.kind, endsAt: next.endsAt, eventKey: next.startsAt, until, label, emoji };
  stepAsk.timer = setTimeout(() => stepOutAnswer('timeout'), Math.max(0, until - now));
  showStepAsk();
  desktopNotify(`${emoji} ${label} ${start > now ? 'is about to start' : 'is on'}`, 'You set this weather to step away from. Press Step away on the game, or Stay in.', 'weather', { endsAt: next.endsAt });
}
function showStepAsk() {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const info = stepAsk ? { label: stepAsk.label, emoji: stepAsk.emoji, until: stepAsk.until } : null;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.${info ? `showStepOut(${JSON.stringify(info)})` : 'hideStepOut()'}`, true).catch(() => {});
}
function stepOutAnswer(act) {
  if (!stepAsk) return false;
  const ask = stepAsk;
  clearTimeout(ask.timer);
  stepAsk = null;
  showStepAsk();
  if (act === 'ignore') {
    stayIn(ask.kind, ask.eventKey, ask.endsAt);
    recordNote(`🌦️ Staying in for ${ask.label} (you pressed Stay in). It'll ask again for the next one.`);
    return true;
  }
  // No answer: nothing happens (v0.60.0), and that's staying in for this
  // spell (v0.64.0: it used to ask again once the weather started).
  if (act === 'timeout') {
    stayIn(ask.kind, ask.eventKey, ask.endsAt);
    return true;
  }
  park(ask.kind, ask.endsAt, ask.eventKey);
  return true;
}

// The live game state notices weather the instant it starts, which can be a
// few seconds before the shop feed does.
function checkLogoffFromGame(st) {
  if (parked) return;
  const kind = weather.kindOf(st.weather);
  if (gameSpell && gameSpell.kind !== kind) gameSpell = null;
  if (!kind || kind === 'clear' || !logoffKinds().has(kind)) return;
  const now = Date.now();
  // Ask, don't step out (v0.60.0). Matched to the feed's spell (v0.64.0).
  const spell = spellNow(kind, now);
  if (spell) {
    const end = Date.parse(spell.endsAt);
    // Over by the feed: the game's still catching up. Never ask about a
    // weather that's over.
    if (Number.isFinite(end) && now > end) return;
    if (!stepAsk && !isStayedIn(spell)) askStepOut(spell, now);
    return;
  }
  // The feed says nothing about it (not loaded, or not answering): one
  // steady spell for as long as the game reports this weather.
  if (!gameSpell) gameSpell = { kind, startsAt: new Date(now).toISOString(), endsAt: null, synthetic: true };
  if (!stepAsk && !isStayedIn(gameSpell)) askStepOut(gameSpell, now);
}

/* ================================================================== *
 * Pets: strength, what each ability does, and how teams compare
 * ================================================================== */

// Strength the app works out for itself, unless you've typed one in for that
// pet (garden.strength holds those overrides).
function strengthFor(pet, all) {
  const override = (store.get().garden.strength || {})[pet.id];
  const auto = petData.strength(pet, all);
  return {
    strength: override || (auto ? auto.strength : abilityData.DEFAULT_STRENGTH),
    auto,
    override: override || null,
  };
}

function weatherMatcher(status) {
  const now = weather.kindOf(status && status.weather);
  return (w) => weather.kindOf(w) === now;
}

// Your best sell team: sell-team.js (v0.54.2).

function enrichPets(st) {
  const all = Array.isArray(st.allPets) ? st.allPets : [];
  const describeOne = (p) => {
    const s = strengthFor(p, all);
    const abilities = (p.abilities || []).map((id) => {
      const def = abilityData.lookup(id);
      return def ? Object.assign(abilityData.describe(def, s.strength), { gameId: id }) : { gameId: id, name: String(id), unknown: true, text: "isn't in the app's ability list yet" };
    });
    return Object.assign({}, p, {
      speciesName: petData.prettySpecies(p.species),
      strength: s.strength,
      maxStrength: s.auto ? s.auto.max : null,
      strengthEstimated: Boolean(s.auto && s.auto.estimated),
      strengthOverride: s.override,
      hoursToMax: s.auto ? s.auto.hoursToMax : null,
      abilityInfo: abilities,
    });
  };
  const matches = weatherMatcher(st);
  st.pets = (st.pets || []).map((p) => {
    const full = all.find((x) => x.id === p.id) || p;
    return Object.assign({}, describeOne(Object.assign({}, full, p)), { hunger: p.hunger, pct: p.pct, known: p.known, diet: p.diet, troughHasFood: p.troughHasFood, needsFood: p.needsFood, secondsLeft: p.secondsLeft, maxHunger: p.maxHunger, perSecond: p.perSecond || null, lastMeal: p.lastMeal || null, eatAt: p.eatAt == null ? null : p.eatAt });
  });
  st.allPets = all.map(describeOne);
  st.abilities = abilityData.summarise(st.pets, { weatherMatches: matches });
  // Time to max strength (v0.66.0), for the Pets tab.
  try {
    st.growth = petGrowth.view(st.allPets, st.pets, weather.kindOf(st.weather));
  } catch (err) {
    logError('pet growth', err);
  }
  // Each saved team, as it would be if you swapped it in now.
  st.teamSummaries = (st.teams || []).map((t) => {
    const members = t.members.map((m) => st.allPets.find((p) => p.id === m.petId)).filter(Boolean);
    return {
      id: t.id,
      name: t.name,
      missing: t.members.length - members.length,
      summary: abilityData.summarise(members, { weatherMatches: matches }),
    };
  });
  st.goals = abilityData.GOALS;
  st.idealSell = sellTeam.idealSellTeam(st.allPets, matches);
  // The pets out right now, for the reminder to put the best ones out.
  st.idealSell.outNow = sellTeam.fromRows(st.abilities.rows);
  // Pet rankings (pet-rank.js, v0.58.0): each ability's top 3, every pet's
  // value by the abilities you tick and weigh, and what to level next.
  // The weights follow your stage (v0.70.0): worked out here first (it only
  // reads the garden, coins, pets and sell team), and again below as before.
  let stageId = null;
  try {
    stageId = stageEngine.detect(stageEngine.signalsFrom(st), (store.get().stage || {}).pick).id;
  } catch (err) {
    stageId = null;
  }
  try {
    st.petRank = rankPets(st.allPets, (store.get().ui || {}).petPrefs || {}, stageId);
  } catch (err) {
    logError('pet rankings', err);
    st.petRank = null;
  }
  // The trough: when it runs out for the pets out now (v0.58.0).
  try {
    st.troughTimer = troughForecast(st.pets, st.trough);
    pushTroughChip(st.troughTimer);
  } catch (err) {
    logError('trough timer', err);
    st.troughTimer = null;
  }
  // Your stage in the game (stage.js, v0.56.0 beta): Auto from milestones,
  // or the one you picked.
  try {
    st.stage = stageEngine.detect(stageEngine.signalsFrom(st), (store.get().stage || {}).pick);
  } catch (err) {
    logError('stage', err);
    st.stage = null;
  }
}

/* ================================================================== *
 * The game's own data tables (see game-data.js), cached between runs
 * ================================================================== */

function catalogFile() {
  return path.join(app.getPath('userData'), 'game-catalog.json');
}

function applyCatalog(catalog, fresh) {
  if (!catalog || typeof catalog !== 'object') return;
  const cat = { pets: catalog.pets || {}, abilities: catalog.abilities || {}, eggs: catalog.eggs || {} };
  petData.setLive(cat);
  abilityData.setLive(cat);
  luck.setLive(cat);
  if (fresh) {
    try {
      fs.writeFileSync(catalogFile(), JSON.stringify(Object.assign({ savedAt: Date.now() }, cat)), 'utf8');
    } catch (err) {
      /* next time, then */
    }
    catalogInfo = { at: Date.now(), pets: Object.keys(cat.pets).length, abilities: Object.keys(cat.abilities).length, eggs: Object.keys(cat.eggs).length, fresh: true };
  }
  // Redo the pet numbers with the new tables straight away.
  if (gardenStatus) {
    enrichPets(gardenStatus);
    gardenStatus.eta = gardenEta(gardenStatus);
    gardenStatus.size = sizeEta(gardenStatus);
    sendGardenStatus(gardenStatus);
  }
  sendPity();
}

let catalogInfo = null;
function loadCatalogCache() {
  try {
    const cat = JSON.parse(fs.readFileSync(catalogFile(), 'utf8'));
    applyCatalog(cat, false);
    catalogInfo = { at: cat.savedAt || null, pets: Object.keys(cat.pets || {}).length, abilities: Object.keys(cat.abilities || {}).length, eggs: Object.keys(cat.eggs || {}).length, fresh: false };
  } catch (err) {
    catalogInfo = null;
  }
}

/* ================================================================== *
 * Egg tracker (pity.js holds the logic)
 * ================================================================== */

const pityUndo = [];

function pityState() {
  const s = store.get();
  s.pity = pity.migrate(s.pity);
  return s.pity;
}

function pityView() {
  const p = pityState();
  return {
    pity: p,
    stats: pity.stats(p),
    eggs: petData.allEggs(),
    species: Object.keys(petData.GROWTH),
    catalog: catalogInfo,
  };
}

function sendPity() {
  sendToControl('pity:state', pityView());
}

/* The secret: hatching a Rainbow version of an egg's rare pet (a Rainbow
 * Capybara, Phoenix, Turkey...) sets off a party: stacked discos, rainbow
 * mode, confetti, hearts and a big banner on the game screen, and a little
 * jingle plus a cheer in the panel. Not listed anywhere in the app. The sound
 * follows the Rainbow-pet alert's quiet hours and switch; the show always
 * plays. */
function secretRainbow(species) {
  const name = petData.prettySpecies(species);
  const settings = store.get();
  recordNote(`🌈✨ A RAINBOW ${name.toUpperCase()}!!`);
  const sound = !settings.alerts.disabled.includes('hatchrainbow') && !quietFor(settings, 'hatchrainbow');
  sendToControl('secret:rainbow', { name, sound });
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed() || !isGameUrl(contents.getURL())) return;
  const run = (js) => contents.executeJavaScript(js, true).catch(() => null);
  const fx = (n) => run(fun.script(n));
  // Rainbow mode is a toggle: make sure it ends up on, and off afterwards.
  fx('rainbow').then((on) => { if (on === false) fx('rainbow'); });
  const at = (ms, f) => setTimeout(f, ms);
  at(0, () => fx('disco'));
  at(250, () => run(fun.bannerScript(`🌈 RAINBOW ${name.toUpperCase()}! 🌈`)));
  at(700, () => fx('disco'));
  at(1400, () => fx('disco'));
  at(1800, () => fx('confetti'));
  at(3300, () => fx('hearts'));
  at(4800, () => fx('confetti'));
  at(6500, () => fx('disco'));
  at(8000, () => fx('confetti'));
  at(14500, () => fx('rainbow').then((on) => { if (on === true) fx('rainbow'); }));
}

/* Garden worth over time: one point every half hour while connected (the
 * latest reading in each half hour wins), about a month kept. The same for
 * what you've earned selling (the game's lifetime totals), which the budget
 * card turns into coins per day. */
const WORTH_EVERY = 30 * 60 * 1000;
const WORTH_KEEP = 1500;
function recordSeries(key, v, t, extra) {
  const s = store.get();
  const h = Array.isArray(s[key]) ? s[key] : (s[key] = []);
  const last = h[h.length - 1];
  if (!last || t - last.t >= WORTH_EVERY) {
    h.push(Object.assign({ t, v }, extra || {}));
    if (h.length > WORTH_KEEP) h.splice(0, h.length - WORTH_KEEP);
    return true;
  }
  Object.assign(last, { v }, extra || {});
  return false;
}
// Gold/Rainbow by the hour, from the game's own lifetime counters for the
// Gold and Rainbow Granter abilities (exact, whatever the activity log looks
// like). Each reading adds what they went up by since the last one to this
// hour; a gap over an hour (the app was closed) just resets the baseline, so
// a day's procs never land in one bar. Every watched hour is marked (w), so
// the rate counts only hours that were actually watched. Two weeks kept.
function recordGranters(st, t) {
  const pa = st.lifetime && st.lifetime.petAbility;
  if (!pa) return false;
  const gNow = Number(pa.GoldGranter) || 0;
  const rNow = Number(pa.RainbowGranter) || 0;
  const g = store.get().garden;
  g.hourly = g.hourly && typeof g.hourly === 'object' ? g.hourly : {};
  const last = g.granterLast;
  g.granterLast = { t, g: gNow, r: rNow };
  if (!last || t - last.t > 3600000 || gNow < last.g || rNow < last.r) return false;
  if (!g.hourlySince) g.hourlySince = last.t;
  const hr = Math.floor(t / 3600000);
  const b = g.hourly[hr] || (g.hourly[hr] = { g: 0, r: 0 });
  const dg = gNow - last.g;
  const dr = rNow - last.r;
  const fresh = !b.w;
  b.w = 1;
  b.g += dg;
  b.r += dr;
  const cutoff = Math.floor(t / 3600000) - 14 * 24;
  for (const k of Object.keys(g.hourly)) if (Number(k) < cutoff) delete g.hourly[k];
  return dg > 0 || dr > 0 || fresh;
}

// The Garden map's to-do (garden-plan.js), worked out again only when the
// garden changes (the status comes every few seconds).
let planKey = '';
let planLast = null;
function gardenPlanOf(plants, tiles) {
  if (!Array.isArray(plants)) return null;
  const key = JSON.stringify(plants) + '|' + Object.keys(tiles || {}).join(',');
  if (key !== planKey) {
    planKey = key;
    try {
      planLast = gardenPlan.plan(plants, Object.keys(tiles || {}));
    } catch (err) {
      console.error('Garden plan failed:', err);
      planLast = null;
    }
  }
  return planLast;
}

// How much of the garden carries each kind of mutation, over time (the
// Garden tab's "Mutations over time"): every 10 minutes (the latest reading
// in each 10 minutes wins), a week kept. n = crops in the garden; h, l, c =
// how many have a weather (hydro), a moon (lunar) and a Gold or Rainbow
// mutation. Shares, not counts, are what's charted, so a harvest or a
// replant doesn't read as mutations lost.
const MUT_EVERY = 10 * 60 * 1000;
const MUT_KEEP = 7 * 24 * 6;

/* Plant by plant (v0.64.0), so plants can be left out of the chart: each
 * plant kind's row [n, h, l, c, w, ch, f, th, d, a, g, r] (the same counts as
 * a reading, for that kind's crops only; trailing zeros dropped). A reading's
 * `s` holds only the rows that changed since the reading before it (0 = that
 * kind is gone); `sf: 1` marks a full set. No `s`: not tracked then. */
function plantNamesOf(rows) {
  const out = {};
  for (const sp of Object.keys(rows || {})) {
    const found = cropData.lookup(sp);
    out[sp] = found && found.name ? found.name : String(sp).replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  return out;
}
function recordMutations(st, t) {
  const b = (st.crops || []).find((x) => /garden/i.test(x.name));
  if (!b || !b.total || !b.have) return false;
  const g = store.get().garden;
  const h = Array.isArray(g.mutHistory) ? g.mutHistory : (g.mutHistory = []);
  const mu = b.mutations || {};
  // The totals, and (v0.53.3) each mutation on its own for the separate
  // lines: wet, chilled, frozen, thunder (struck or charged), dawn and amber
  // (lit or bound), gold, rainbow.
  const p = {
    // Any weather / moon / colour (v0.56.14): since v0.54.7 `have` is the
    // harvest rule's ("Thundercharged or Frozen"), which made the chart's
    // totals smaller than their own parts.
    t, n: b.total, h: (b.any || b.have).hydro || 0, l: (b.any || b.have).lunar || 0, c: (b.any || b.have).color || 0,
    w: mu.wet || 0, ch: mu.chilled || 0, f: mu.frozen || 0, th: (mu.thunderstruck || 0) + (mu.thundercharged || 0),
    d: (mu.dawnlit || 0) + (mu.dawnbound || 0), a: (mu.amberlit || 0) + (mu.amberbound || 0), g: b.gold || 0, r: b.rainbow || 0,
  };
  // Plant by plant (v0.64.0): only what changed since the reading before.
  return pushReading(h, p, st.plantMuts && typeof st.plantMuts === 'object' ? st.plantMuts : null, MUT_EVERY, MUT_KEEP);
}

// Each sale against what the app expected (budget.saleCheckStep): the
// lifetime coins from selling crops, the value of the crops in your
// inventory, the room, and the sell boost of the pets out.
let saleCheckState = null;
function checkSale(st) {
  const pl = st.lifetime && st.lifetime.player;
  const inv = st.inventoryCrops;
  const sold = pl && Number(pl.totalEarningsSellCrops);
  if (!inv || !Number.isFinite(sold)) return;
  const rows = ((st.abilities && st.abilities.rows) || []).filter((r) => !r.weather);
  const snap = {
    t: Date.now(),
    sold,
    invV: Number(inv.v) || 0,
    invN: Number(inv.n) || 0,
    sized: Number(inv.sized) === Number(inv.n),
    roomPct: st.room && st.room.players ? Math.min(50, Math.max(0, st.room.players - 1) * 10) : 0,
    sellPct: rows.filter((r) => r.goal === 'sell' && r.sellChance).reduce((a, r) => a + (r.score || 0), 0),
  };
  const r = budget.saleCheckStep(saleCheckState, snap);
  saleCheckState = r.state;
  if (r.record) {
    const s = store.get();
    s.saleChecks = (Array.isArray(s.saleChecks) ? s.saleChecks : []).concat([r.record]).slice(-30);
    store.save();
  }
}

function recordWorth(st) {
  const t = Date.now();
  let changed = false;
  const granters = recordGranters(st, t);
  const muts = recordMutations(st, t);
  if (granters || muts) {
    changed = true;
    sendToControl('garden:stats', store.get().garden);
  }
  const b = (st.crops || []).find((x) => /garden/i.test(x.name));
  // With the garden's worth, how many crops were ready to sell (under the
  // rule), what they were worth, and how many crops there were: the
  // maturing rate for the estimated value is learned from these.
  const extra = b && b.missing ? { r: b.ready || 0, rv: Math.round(b.readyValue || 0), n: b.total || 0 } : null;
  if (b && b.value > 0) changed = recordSeries('worthHistory', Math.round(b.value), t, extra) || changed;
  // Money: the wallet, lifetime coins from selling, lifetime coins pets found.
  const pl = st.lifetime && st.lifetime.player;
  const pa = (st.lifetime && st.lifetime.petAbility) || {};
  const coins = st.wallet && Number(st.wallet.coins);
  if (pl && Number.isFinite(coins)) {
    const sold = (Number(pl.totalEarningsSellCrops) || 0) + (Number(pl.totalEarningsSellPet) || 0);
    const found = (Number(pa.totalCoinsFound) || 0) + (Number(pa.totalCoinsFromProduceEater) || 0);
    changed = budget.recordMoney(store.get(), { coins, sold, found }, t) || changed;
  }
  if (changed) store.save();
}

/* Spending vs. earning (budget.js): what the shops stock, counted from every
 * feed poll, and what you buy, from the game's own purchase commands. */
function shopStatsState() {
  const s = store.get();
  s.shopStats = budget.migrateStats(s.shopStats);
  return s.shopStats;
}
let statsSaveTimer = null;
/* Night (v0.66.0; worked out from the game's clock since v0.67.0, see
 * events.js). The Spooky Shop opening is noted too: it's a fallback for
 * night, and a sign the Haunt Event is running (for its theme). */
const NIGHT_LONG_MS = events.NIGHT_LONG_MS;
let nightOpenSince = null;
let lastThemeSig = '';
function noteEventSign(id, now = Date.now()) {
  const s = store.get();
  s.events = Object.assign({}, s.events);
  const prev = Number(s.events[id]) || 0;
  s.events[id] = now;
  // Saved at most every 10 minutes (it's a "seen lately" mark).
  if (now - prev > 10 * 60000) store.save();
}
function noteNight(data, now = Date.now()) {
  const sp = Object.entries((data && data.shops) || {}).find(([id]) => /^spooky/i.test(id));
  if (!sp) return;
  const open = Boolean(sp[1] && sp[1].open);
  const s = store.get();
  s.night = Object.assign({ lastStart: null, lastEnd: null }, s.night);
  if (open) noteEventSign('haunt', now);
  if (open && !nightOpenSince) {
    // Already open when the app started: it began some time before.
    const prev = s.night.lastStart;
    nightOpenSince = prev && now - prev < NIGHT_LONG_MS ? prev : now;
    if (s.night.lastStart !== nightOpenSince) {
      s.night.lastStart = nightOpenSince;
      store.save();
    }
  } else if (!open && nightOpenSince) {
    nightOpenSince = null;
    s.night.lastEnd = now;
    store.save();
  }
}
function nightInfo(now = Date.now()) {
  return events.nightInfo(now, nightOpenSince);
}
// The panel's look while an event runs (v0.67.0): its theme, unless the
// owner switched event themes off (Extras).
function themeNow(now = Date.now()) {
  const s = store.get();
  return events.theme(now, s.events || {}, (s.ui || {}).eventThemes !== false, nightInfo(now));
}
// The Haunt Event's end (the devs' note: Mon 9 Nov 2026, 7:00 PM Eastern).
const HAUNT_ENDS = events.EVENTS.find((e) => e.id === 'haunt').ends;
function feedStatus(st) {
  return st ? Object.assign({}, st, { night: nightInfo(), hauntEnds: Date.now() < HAUNT_ENDS ? HAUNT_ENDS : null, theme: themeNow() }) : st;
}

function onShopFeed(data) {
  try {
    noteNight(data);
  } catch (err) {
    logError('night', err);
  }
  if (budget.record(shopStatsState(), data) > 0 && !statsSaveTimer) {
    statsSaveTimer = setTimeout(() => {
      statsSaveTimer = null;
      store.save();
    }, 60000);
  }
}
// When the crops still growing will all be ready to sell, under the rule:
// the latest of whatever they still need. Ripening from the crops' own end
// times; full size and Gold/Rainbow from your pets' rates (the Garden tab's
// estimates); a weather or moon mutation from the next such event in the
// forecast (now, if it's on). null when any part can't be known.
function harvestHours(st, upcoming) {
  const g = (st.crops || []).find((b) => /garden/i.test(b.name));
  if (!g || !g.total || !g.missing) return null;
  if (g.ready >= g.total) return 0;
  const rule = readyRule();
  const now = Date.now();
  const cur = weather.kindOf(st.weather);
  const nextOf = (kinds) => {
    if (kinds.includes(cur)) return 0;
    const e = (upcoming || []).find((x) => kinds.includes(x.kind) && Date.parse(x.startsAt) > now);
    return e ? (Date.parse(e.startsAt) - now) / 3600000 : null;
  };
  const parts = [];
  if (g.missing.grow) parts.push(g.ripeBy ? Math.max(0, (g.ripeBy - now) / 3600000) : null);
  if (rule.size && g.missing.size) parts.push(st.size ? (st.size.done ? 0 : st.size.hours) : null);
  if (rule.color && g.missing.color) parts.push(st.eta ? (st.eta.done ? 0 : st.eta.hours) : null);
  if (rule.hydro && g.missing.hydro) parts.push(nextOf(['rain', 'snow', 'thunder']));
  if (rule.lunar && g.missing.lunar) parts.push(nextOf(['dawn', 'amber']));
  if (parts.some((h) => h == null || !Number.isFinite(h))) return null;
  return parts.length ? Math.max(...parts) : 0;
}

// When each step will be reached by all crops, for the crop-stage track:
// hours, 0 when every crop has it, null when unknown.
function stepHours(st, upcoming) {
  const g = (st.crops || []).find((b) => /garden/i.test(b.name));
  if (!g || !g.total || !g.have) return null;
  const now = Date.now();
  const cur = weather.kindOf(st.weather);
  const nextOf = (kinds) => {
    if (kinds.includes(cur)) return 0;
    const e = (upcoming || []).find((x) => kinds.includes(x.kind) && Date.parse(x.startsAt) > now);
    return e ? (Date.parse(e.startsAt) - now) / 3600000 : null;
  };
  const all = (k) => g.have[k] >= g.total;
  return {
    ripe: all('ripe') ? 0 : g.ripeBy ? Math.max(0, (g.ripeBy - now) / 3600000) : null,
    size: all('size') ? 0 : st.size ? (st.size.done ? 0 : st.size.hours) : null,
    hydro: all('hydro') ? 0 : nextOf(['rain', 'snow', 'thunder']),
    lunar: all('lunar') ? 0 : nextOf(['dawn', 'amber']),
    color: all('color') ? 0 : st.eta ? (st.eta.done ? 0 : st.eta.hours) : null,
    // which weather comes next of each kind, for the "next" line
    nextHydro: (upcoming || []).find((x) => ['rain', 'snow', 'thunder'].includes(x.kind) && Date.parse(x.startsAt) > now) || null,
    nextLunar: (upcoming || []).find((x) => ['dawn', 'amber'].includes(x.kind) && Date.parse(x.startsAt) > now) || null,
    weatherNow: cur,
  };
}

function readyRule() {
  // "Ready" is the harvest rule (v0.54.7): the Money tab gets its groups as
  // on / off for its step timings, and the rule in words.
  const md = harvestLock().mode;
  const list = (l) => l.map((k) => harvestRule.NAMES[k] || k).join(' or ');
  return {
    size: md.size, color: md.color !== 'any', hydro: md.hydro.length > 0, lunar: md.lunar.length > 0, words: harvestRule.describe(md),
    // Each step in the rule's own words, for the crop-stage track.
    // Three or more in a group read as the group (v0.56.0: "Wet or Chilled or
    // Frozen or…" overflowed the track).
    labels: { color: md.color === 'rainbow' ? 'Rainbow' : 'Gold / Rainbow', hydro: md.hydro.length && md.hydro.length < 3 ? list(md.hydro) : 'Weather', lunar: md.lunar.length && md.lunar.length < 3 ? list(md.lunar) : 'Moon' },
  };
}
function pushReadyRule() {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setReadyRule(${JSON.stringify(readyRule())})`).catch(() => {});
}

// What the plan needs from the live game: the wallet, the upcoming weather
// and the shops' next restocks (from the alert watcher).
function budgetContext() {
  const w = watcher ? watcher.status() : {};
  const garden = gardenStatus && Array.isArray(gardenStatus.crops) ? gardenStatus.crops.find((x) => /garden/i.test(x.name)) : null;
  return {
    now: Date.now(),
    wallet: gardenStatus && gardenStatus.wallet && Number.isFinite(Number(gardenStatus.wallet.coins)) ? Number(gardenStatus.wallet.coins) : undefined,
    gardenWorth: garden && garden.value > 0 ? garden.value : 0,
    // Crops in your bag, harvested but not sold (v0.63.10).
    bagWorth: gardenStatus && gardenStatus.inventoryCrops && Number(gardenStatus.inventoryCrops.v) > 0 ? Number(gardenStatus.inventoryCrops.v) : 0,
    // Steadier estimates (v0.63.10; see budget.steady).
    steady: true,
    garden: garden ? {
      total: garden.total, special: garden.special, gold: garden.gold, rainbow: garden.rainbow,
      ready: garden.ready || 0, readyValue: garden.readyValue || 0, growingValue: garden.growingValue || 0, growingPotential: garden.growingPotential || 0,
      missing: garden.missing || null,
      have: garden.have || null,
      harvestHours: gardenStatus ? harvestHours(gardenStatus, w.upcoming || []) : null,
      stepHours: gardenStatus ? stepHours(gardenStatus, w.upcoming || []) : null,
      // your pets' own Gold/Rainbow rate (crops an hour), from their abilities
      goldPerHour: gardenStatus && gardenStatus.eta && Number(gardenStatus.eta.perHour) > 0 ? Number(gardenStatus.eta.perHour) : null,
    } : null,
    readyRule: readyRule(),
    // Crops at what you'd get (v0.53.15): a full room (x1.5) with your best
    // sell pets out, unless that's turned off under "How crops are counted".
    saleMult: budget.options(store.get()).saleValue ? 1.5 * (gardenStatus && gardenStatus.idealSell && gardenStatus.idealSell.petPart > 1 ? gardenStatus.idealSell.petPart : 1) : 1,
    // false until the garden's report (with ready/growing) has arrived
    gardenLoaded: Boolean(garden && garden.missing),
    upcoming: w.upcoming || [],
    restocks: w.restocks || [],
    // Decor in stock right now, dearest first: what the "can I buy this?"
    // check offers with one tap.
    inStock: watcher ? watcher.current().filter((i) => /decor/i.test(i.type) && i.price >= 1e6).sort((a, b) => b.price - a.price) : [],
  };
}
// What the forecast was built from, every 5 minutes (v0.63.10), kept for
// samples: if the line jumps, the sample shows which input moved.
const forecastLog = [];
function noteForecast(view) {
  const f = view && view.foresight;
  if (!f) return;
  const now = Date.now();
  const last = forecastLog[forecastLog.length - 1];
  if (last && now - last.t < 5 * 60000) return;
  const e = f.estimate || {};
  const endPt = Array.isArray(f.line) && f.line.length ? f.line[f.line.length - 1] : null;
  forecastLog.push({
    t: now, mode: f.mode, wallet: f.wallet, available: f.available,
    ready: f.garden && f.garden.ready, bag: f.garden && f.garden.bag,
    pace: f.pace, perCrop: e.perCrop, perCropRaw: e.perCropRaw, perCropSrc: e.perCropSource,
    rate: e.rate, rateRaw: e.rateRaw, rateSrc: e.rateSource, canMature: e.canMature,
    endDay: endPt ? endPt[0] : null, endCoins: endPt ? endPt[1] : null,
  });
  if (forecastLog.length > 200) forecastLog.splice(0, forecastLog.length - 200);
}

// The view isn't free (it walks every counted shop item for every alert),
// and the panel, the money box and purchases all ask for it, so it is
// reused for a few seconds unless something just changed.
let viewCache = { at: 0, view: null };
function budgetView(fresh) {
  if (!fresh && viewCache.view && Date.now() - viewCache.at < 3000) return viewCache.view;
  let view = budget.view({ settings: store.get(), ctx: budgetContext() });
  // A new install's wants (v0.78.0): the defaults once the garden is known to
  // be worth 1B+; under that, the list starts empty.
  const bs = store.get().budget || {};
  if (bs.wantsPending && view.worthKnown) {
    const s = store.get();
    delete s.budget.wantsPending;
    if (view.netWorth >= 1e9) {
      s.budget.wantsSeeded = false;
      budget.seedWants(s);
    }
    store.save();
    view = budget.view({ settings: s, ctx: budgetContext() });
  }
  noteForecast(view);
  // Once the Money tab has opened it stays open (v0.78.0: that's as soon as
  // the wallet and garden are read; no note, there was no wait).
  if (view.unlockEarned && !(store.get().budget && store.get().budget.unlocked)) {
    const s = store.get();
    s.budget = Object.assign({}, s.budget, { unlocked: true });
    store.save();
  }
  viewCache = { at: Date.now(), view };
  return view;
}
// The game keeps, per shop, what you've bought in its current restock
// (slot.data.shopPurchases: {shop: {restockId, purchases: {itemId: n}}}).
// Every status update carries it; anything that grew since last time (or
// that appeared with a new restock) is a purchase, with the exact id and
// count, wherever it was made.
function applyShopPurchases(sp) {
  if (!sp || typeof sp !== 'object') return;
  const s = store.get();
  const seen = s.restockSeen && typeof s.restockSeen === 'object' ? s.restockSeen : (s.restockSeen = {});
  let last = null;
  for (const [shop, info] of Object.entries(sp)) {
    if (!info || typeof info !== 'object' || !info.restockId) continue;
    const purchases = info.purchases && typeof info.purchases === 'object' ? info.purchases : {};
    const prev = seen[shop];
    const same = Boolean(prev && prev.restockId === info.restockId);
    for (const [itemId, n] of Object.entries(purchases)) {
      const count = Math.floor(Number(n) || 0);
      const before = same && prev.purchases ? Math.floor(Number(prev.purchases[itemId]) || 0) : 0;
      const delta = count - before;
      if (delta > 0) {
        const entry = budget.recordPurchase(s, { at: Date.now(), command: { type: 'PurchaseShopItem', shop, itemId, quantity: delta } });
        if (entry) last = entry;
      }
    }
    seen[shop] = { restockId: String(info.restockId).slice(0, 60), purchases: Object.fromEntries(Object.entries(purchases).slice(0, 60).map(([k, v]) => [String(k).slice(0, 60), Math.floor(Number(v) || 0)])) };
  }
  if (last) {
    store.save();
    viewCache = { at: 0, view: null };
    sendToControl('budget:purchase', last);
  }
}

ipcMain.handle('budget:get', () => budgetView());
ipcMain.handle('budget:set', (event, change) => {
  budget.setOptions(store.get(), change && typeof change === 'object' ? change : {});
  store.save();
  if (change && change.readyRule) pushReadyRule();
  return budgetView(true);
});
ipcMain.handle('budget:whatIf', (event, price) => {
  const p = Number(price);
  if (!Number.isFinite(p) || p < 0) return null;
  return budget.whatIf(store.get(), budgetContext(), p);
});
ipcMain.handle('budget:resetPurchases', () => {
  budget.resetPurchases(store.get());
  store.save();
  viewCache = { at: 0, view: null };
  return budgetView(true);
});
ipcMain.handle('budget:plan', (event, change) => {
  budget.setPlan(store.get(), change && typeof change === 'object' ? change : {});
  store.save();
  pushBudgetHud(true);
  return budgetView(true);
});

/* The money box over the game (the observer draws it; this writes its
 * lines). Pushed with each status update, at most every 5 s, and at once
 * when the plan or the switch changes. */
function budgetHudOn() {
  const s = store.get();
  return !(s.ui && s.ui.budgetHud === false);
}
let hudPushedAt = 0;
let hudLast = '';
let hudWallet = null;
function pushBudgetHud(force) {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  // The lines only really move with the wallet, so: when it moved, or
  // every half minute (the "next opening" countdown), not on every update.
  const wallet = gardenStatus && gardenStatus.wallet ? Number(gardenStatus.wallet.coins) : null;
  if (!force && wallet === hudWallet && Date.now() - hudPushedAt < 30000) return;
  if (!force && Date.now() - hudPushedAt < 5000) return;
  hudPushedAt = Date.now();
  hudWallet = wallet;
  let payload = { shown: false, lines: [] };
  if (budgetHudOn()) {
    try {
      payload = { shown: true, lines: hudLines() };
    } catch (err) {
      payload = { shown: false, lines: [] };
    }
  }
  const text = JSON.stringify(payload);
  if (!force && text === hudLast) return;
  hudLast = text;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setBudgetHud(${text})`).catch(() => {});
}
// The money box (bottom right of the game): net worth (coins + garden), and
// the next weather with a countdown (or how long the weather that's on has
// left). The countdown ticks in the game page itself.
function hudLines() {
  const coins = gardenStatus && gardenStatus.wallet ? Number(gardenStatus.wallet.coins) || 0 : null;
  const b = gardenStatus && (gardenStatus.crops || []).find((x) => /garden/i.test(x.name));
  const garden = b && Number(b.value) > 0 ? Number(b.value) : 0;
  const lines = [];
  if (coins != null) {
    lines.push({ text: `💰 ${shortCoins(coins + garden)} net worth`, strong: true, big: true });
    lines.push({ text: `🪙 ${shortCoins(coins)} coins + 🌻 ${shortCoins(garden)} garden`, faint: true });
  }
  const st = watcher && watcher.status();
  const now = Date.now();
  const emojiOf = (kind) => (weather.BY_ID[kind] && weather.BY_ID[kind].emoji) || '🌦️';
  const cur = st && st.current;
  if (cur && cur.kind && cur.kind !== 'clear' && Date.parse(cur.endsAt) > now) {
    lines.push({ text: `${emojiOf(cur.kind)} ${weather.label(cur.kind)} now · {t} left`, at: Date.parse(cur.endsAt) });
  }
  const next = st && (st.upcoming || []).find((e) => e.kind && e.kind !== 'clear' && Date.parse(e.startsAt) > now);
  if (next && lines.length < 4) lines.push({ text: `${emojiOf(next.kind)} ${weather.label(next.kind)} in {t}`, at: Date.parse(next.startsAt) });
  return lines;
}
function shortCoins(n) {
  const v = Number(n) || 0;
  for (const [size, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (v >= size) return (v / size).toFixed(v / size >= 100 ? 0 : 1).replace(/\.0$/, '') + suffix;
  }
  return String(Math.round(v));
}
function setBudgetHud(on) {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { budgetHud: Boolean(on) });
  store.save();
  pushBudgetHud(true);
  sendToControl('budget:hud', budgetHudOn());
  buildMenu();
  return budgetHudOn();
}
ipcMain.handle('ui:budgetHud', (event, on) => setBudgetHud(on));

/* The open-spot map drawn over the game while you hold a pot (the observer
 * draws it; this only tells it whether to). */
function spotMapOn() {
  const s = store.get();
  return !(s.ui && s.ui.spotMap === false);
}
function pushSpotMap() {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setSpotMap(${spotMapOn()})`).catch(() => {});
}
/* The binder map drawn over the game during an Amber Moon or a Dawn
 * (v0.53.4): the observer draws it from the live garden; this tells it
 * whether one of those is on (and until when) and whether it's switched on. */
function binderMapOn() {
  const s = store.get();
  return !(s.ui && s.ui.binderMap === false);
}
let binderKey = '';
function pushBinderMap(force) {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const st = watcher && watcher.status();
  const cur = st && st.current;
  const now = Date.now();
  let ev = null;
  if (cur && (cur.kind === 'amber' || cur.kind === 'dawn') && Date.parse(cur.endsAt) > now) ev = { kind: cur.kind, endsAt: Date.parse(cur.endsAt) };
  else if (gardenStatus && (gardenStatus.weatherKind === 'amber' || gardenStatus.weatherKind === 'dawn')) ev = { kind: gardenStatus.weatherKind, endsAt: null };
  const key = JSON.stringify({ on: binderMapOn(), event: ev });
  if (!force && key === binderKey) return;
  binderKey = key;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setBinderMap && window.__mgLoaderObserver.setBinderMap(${key})`).catch(() => {});
}
// The Thunderstruck finder over the game (v0.53.8): the observer draws it
// while a Thundercharger pet is out; this only says whether it's switched on.
function thunderMapOn() {
  const s = store.get();
  return !(s.ui && s.ui.thunderMap === false);
}
function pushThunderMap() {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setThunderMap && window.__mgLoaderObserver.setThunderMap(${thunderMapOn()})`).catch(() => {});
}
// The riding map (v0.53.9) and where each corner map was moved to.
function mountMapOn() {
  const s = store.get();
  return !(s.ui && s.ui.mountMap === false);
}
function pushMountMap() {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const s = store.get();
  const pos = JSON.stringify((s.ui && s.ui.mapPos) || {});
  const folds = JSON.stringify((s.ui && s.ui.mapFold) || {});
  contents.executeJavaScript(`(() => { const o = window.__mgLoaderObserver; if (!o) return; if (o.setMapPositions) o.setMapPositions(${pos}, ${folds}); if (o.setMountMap) o.setMountMap(${mountMapOn()}); })()`).catch(() => {});
}
ipcMain.handle('ui:mountMap', (event, on) => {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { mountMap: Boolean(on) });
  store.save();
  pushMountMap();
  return mountMapOn();
});
ipcMain.handle('ui:thunderMap', (event, on) => {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { thunderMap: Boolean(on) });
  store.save();
  pushThunderMap();
  pushMountMap();
  return thunderMapOn();
});
ipcMain.handle('ui:binderMap', (event, on) => {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { binderMap: Boolean(on) });
  store.save();
  pushBinderMap(true);
  pushThunderMap();
  pushMountMap();
  return binderMapOn();
});
/* Keep the map on the game (v0.67.2): the view picked in the Garden tab
 * (ui.gardenMap) stays up over the game; the contextual maps still come up
 * as before. The value view is made here (the observer doesn't price
 * crops): each tile's worth as a shade, the ten best glowing gold, like the
 * Garden tab's. */
const MAP_VIEWS = ['spots', 'thunder', 'dawn', 'amber', 'value'];
function alwaysMapOn() {
  const s = store.get();
  return Boolean(s.ui && s.ui.alwaysMap === true);
}
function mapPinView() {
  const v = (store.get().ui || {}).gardenMap;
  return MAP_VIEWS.includes(v) ? v : 'spots';
}
function valueMap(st) {
  const plan = st && st.plan;
  const tiles = (st && st.gardenTiles) || {};
  if (!plan || !Array.isArray(plan.tiles)) return null;
  const byTile = new Map(plan.tiles.map((t) => [t.i, t]));
  const values = plan.tiles.map((t) => t.value).filter((v) => v > 0);
  if (!values.length) return null;
  const lo = Math.log10(Math.max(1, Math.min(...values)));
  const hi = Math.log10(Math.max(1, ...values));
  const shade = (v) => {
    const f = hi > lo ? Math.min(1, Math.max(0, (Math.log10(Math.max(1, v)) - lo) / (hi - lo))) : 1;
    const mix = (x, y) => Math.round(x + (y - x) * f);
    return `rgb(${mix(58, 255)},${mix(47, 211)},${mix(26, 92)})`;
  };
  const gems = new Set(plan.tiles.filter((t) => t.value > 0).sort((a, b) => b.value - a.value).slice(0, 10).map((t) => t.i));
  const looks = [];
  for (let i = 0; i < 200; i += 1) {
    const t = byTile.get(i);
    const k = tiles[i] || tiles[String(i)];
    looks.push(t && t.value > 0 ? { v: shade(t.value), gem: gems.has(i) } : { k: k ? String(k[0] || 'o') : null });
  }
  return {
    looks,
    right: `${values.length} plant${values.length === 1 ? '' : 's'}`,
    sum: 'Brighter tiles are worth more; the ten most valuable glow gold.',
    key: [['rgb(255,211,92)', '#ffd35c', 'most valuable'], ['rgb(156,129,59)', '', 'middling'], ['rgb(58,47,26)', '', 'least']],
  };
}
let mapPinKey = '';
let lastHatchBlocked = null;
function pushMapPin(force = false) {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const on = alwaysMapOn();
  const view = mapPinView();
  const value = on && view === 'value' ? valueMap(gardenStatus) : null;
  const msg = JSON.stringify({ on, view, value });
  if (!force && msg === mapPinKey) return;
  mapPinKey = msg;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setMapPin && window.__mgLoaderObserver.setMapPin(${msg})`).catch(() => {});
}
ipcMain.handle('ui:alwaysMap', (event, on) => {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { alwaysMap: Boolean(on) });
  store.save();
  pushMapPin(true);
  return alwaysMapOn();
});
ipcMain.handle('ui:spotMap', (event, on) => {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { spotMap: Boolean(on) });
  store.save();
  pushSpotMap();
  return spotMapOn();
});

ipcMain.handle('worth:get', () => {
  const h = store.get().worthHistory;
  return Array.isArray(h) ? h : [];
});

/* "Fully grown": a pet that's out reaching its max strength. Only pets the
 * app has seen still growing count, so updating doesn't set off a burst of
 * alerts for pets that were already grown. */
function checkGrown(st) {
  const g = store.get().garden;
  g.growing = g.growing && typeof g.growing === 'object' ? g.growing : {};
  let changed = false;
  for (const p of st.pets || []) {
    if (!p || !p.id || !p.maxStrength || p.strengthOverride) continue;
    const grown = p.strength >= p.maxStrength;
    if (!grown) {
      if (g.growing[p.id] == null) {
        g.growing[p.id] = p.strength;
        changed = true;
      }
      continue;
    }
    if (g.growing[p.id] != null) {
      delete g.growing[p.id];
      changed = true;
      const name = p.name && String(p.name).replace(/\s/g, '').toLowerCase() !== String(p.species || '').toLowerCase() ? p.name : (p.speciesName || p.species || 'A pet');
      handleAlerts([{ ruleId: 'petgrown', tier: 'pet', kind: 'grown', label: name, itemName: name, strength: p.strength }]);
    }
  }
  const ids = Object.keys(g.growing);
  if (ids.length > 300) for (const k of ids.slice(0, ids.length - 300)) delete g.growing[k];
  if (changed) store.save();
}

/* Bad Luck Protection (luck.js): per egg, plant and capsule. */

function luckState() {
  const s = store.get();
  s.luck = luck.migrate(s.luck);
  return s.luck;
}

/* Counts you typed, back from a backup (v0.72.1). 0.72.0 reset every counter
 * that hadn't had its result yet, counts the owner had typed included (his
 * Rainbow pet count, kept by hand from before the app). Once, on the first
 * start after that: the newest backup made before 0.72.0 gives them back,
 * plus every pull counted since (luck.recover). Saves upgraded straight from
 * 0.71 or earlier keep them in migrate and skip this. */
function recoverTypedLuck() {
  const l = luckState();
  if (l.recovered) return [];
  let found = null;
  try {
    found = backup.newestWhere(backupsDir(), (s) => Boolean(s.luck && s.luck.counters && !(s.luck.version >= 2)));
  } catch (err) {
    found = null;
  }
  const back = found ? luck.recover(l, found.settings.luck) : [];
  l.recovered = { at: Date.now(), from: found ? found.name : null, keys: back.map((b) => b.key) };
  store.save();
  if (back.length) {
    const d = found.savedAt ? new Date(found.savedAt) : null;
    const when = d && !Number.isNaN(d.getTime()) ? ` from your backup of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ' from your backup';
    const list = back.map((b) => `${b.name} (${b.v.toLocaleString()})`).join(', ');
    recordNote(`🍀 Your own luck counts are back${when}: ${list}. 0.72.0 had reset counts you typed by mistake; they count on from here.`);
  }
  return back;
}

function sendLuck() {
  sendToControl('luck:state', luckView());
  pushHatch();
}

/* The hatch countdown and egg locks (v0.69.0). Within 5 hatches of a rare,
 * Gold or Rainbow pet, a small counter shows over the game (and a Hatching
 * card on Home). Eggs you lock can't be hatched: the game page stops the
 * hatch and says so, with a button to the locks on the Luck tab. Only you
 * unlock them. */
function eggLocks() {
  const s = store.get();
  if (!Array.isArray(s.eggLock)) s.eggLock = [];
  return s.eggLock;
}
function luckView() {
  const v = luck.view(luckState());
  v.eggLocks = eggLocks().slice();
  v.watch = luck.hatchWatch(v, eggLocks());
  return v;
}
let hatchKey = '';
function pushHatch(force = false) {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const w = luck.hatchWatch(luck.view(luckState()), eggLocks());
  const msg = JSON.stringify({ rows: w.rows.slice(0, 4), locks: w.locks, shown: store.get().ui.hatchHud !== false });
  if (!force && msg === hatchKey) return;
  hatchKey = msg;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setHatchWatch && window.__mgLoaderObserver.setHatchWatch(${msg})`).catch(() => {});
}
ipcMain.handle('ui:hatchHud', (event, on) => {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { hatchHud: Boolean(on) });
  store.save();
  pushHatch(true);
  return s.ui.hatchHud;
});
ipcMain.handle('luck:eggLock', (event, egg, on) => {
  const id = String(egg || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  if (!id) return luckView();
  const s = store.get();
  const list = eggLocks().filter((x) => x.toLowerCase() !== id.toLowerCase());
  if (on) list.push(id);
  s.eggLock = list.slice(0, 30);
  store.save();
  pushHatch(true);
  sendLuck();
  return luckView();
});

// "Primed": the next pull of something is guaranteed. One heads-up per
// counter per streak, as an alert (so it has a sound, a 🌙 and a switch).
function checkPrimed() {
  const settings = store.get();
  for (const p of luck.newlyPrimed(luckState())) {
    const text = luck.describePrimed(p) + (p.estimated ? ' (estimated)' : '');
    if (settings.alerts.disabled.includes('luckprimed')) {
      recordNote(`🍀 ${text}`);
      continue;
    }
    const alert = { ruleId: 'luckprimed', tier: 'pet', kind: 'luck', label: 'Primed', itemName: text, luckType: p.type };
    const muted = quietFor(settings, 'luckprimed');
    recordAlerts([alert], muted);
    if (!muted) sendToControl('alerts:play', [alert]);
    if (settings.alerts.popups && (!isSnoozed(settings) || isAlways(settings, 'luckprimed'))) showToast({ title: '🍀 Bad Luck Protection primed', body: text, silent: true });
  }
}

// Gold/Rainbow/rare pets from eggs get a celebration; crop and capsule hits
// just go in the log (Gold crops come along all the time).
function celebrateLuck(events, quiet) {
  const hits = [];
  for (const e of events || []) {
    if (e.type === 'egg' || e.type === 'pet') {
      hits.push({ counter: e.target === 'gold' ? 'Gold' : e.target === 'rainbow' ? 'Rainbow' : luck.pretty(e.target), kind: e.kind === 'mutation' ? e.target : 'species', species: e.kind === 'species' ? e.target : e.species, egg: e.source, forced: e.forced });
    } else if (e.kind !== 'mutation') {
      recordNote(`🍀 ${luck.pretty(e.target)} from ${e.type === 'capsule' ? 'a ' : 'your '}${luck.pretty(e.source)}${e.type === 'plant' ? ' crop' : ''}${e.after != null ? ` after ${e.after} pulls` : ': its count starts now'}`);
    }
  }
  // Species from the egg event itself, for "Gold Capybara".
  celebrateHatch(hits, quiet);
}

function celebrateHatch(hits, quiet) {
  const settings = store.get();
  for (const h of hits || []) {
    const ruleId = h.kind === 'rainbow' ? 'hatchrainbow' : h.kind === 'gold' ? 'hatchgold' : 'hatchspecies';
    const who = petData.prettySpecies(h.species);
    const alert = {
      ruleId, tier: 'pet', kind: 'hatch', label: h.counter,
      itemName: h.kind === 'species' ? who : `${h.kind === 'rainbow' ? 'Rainbow' : 'Gold'} ${who}`,
    };
    if (settings.alerts.disabled.includes(ruleId)) continue;
    const muted = quiet || quietFor(settings, ruleId);
    recordAlerts([alert], muted);
    if (!muted) sendToControl('alerts:play', [alert]);
  }
}

/* ================================================================== *
 * Discord rooms (rooms.js)
 * ================================================================== */

let roomsClient = null;
function rooms() {
  if (!roomsClient) {
    roomsClient = roomsMod.createRooms({ fetchInfo: roomInfoFetch });
  }
  return roomsClient;
}

// Asks the game's room endpoint from inside the game page when it's open
// (same site, same login, exactly as the other mods do it), otherwise from
// the game's session in the background.
async function roomInfoFetch(infoPath) {
  const contents = gameView && gameView.webContents;
  if (contents && !contents.isDestroyed() && isGameUrl(contents.getURL()) && !parked) {
    const js = `fetch(${JSON.stringify(infoPath)}, { credentials: 'include', cache: 'no-store' })
      .then(async (r) => ({ status: r.status, body: await r.text() }))
      .catch((e) => ({ status: 0, body: String(e && e.message || e) }))`;
    return withTimeout(contents.executeJavaScript(js, true), 12000);
  }
  const ses = session.fromPartition('persist:magicgarden');
  const res = await withTimeout(ses.fetch('https://magicgarden.gg' + infoPath, { cache: 'no-store' }), 12000);
  return { status: res.status, body: await res.text() };
}

function savedRooms() {
  const s = store.get();
  s.rooms = s.rooms && typeof s.rooms === 'object' ? s.rooms : {};
  s.rooms.saved = Array.isArray(s.rooms.saved) ? s.rooms.saved : [];
  return s.rooms.saved;
}

// Settings from older versions, brought up to date once at startup.
// v0.50 rebuilt the alert sound: one volume (the voice is levelled against
// the sounds instead of having its own slider), sound effects full / soft /
// off, a "no voice" choice, and no "alarm" level. Runs once.
function migrateAlertSound(s) {
  const a = s.alerts || (s.alerts = {});
  if (a.soundVersion >= 2) return;
  a.soundVersion = 2;
  // Someone who had turned the voice all the way down wanted sounds only.
  if (a.voiceVolume === 0) {
    a.voiceEngine = 'off';
    // They weren't listening to it, so a note about its retirement is noise.
    delete a.retiredVoice;
    delete a.retiredTo;
  }
  if (!['full', 'soft', 'off'].includes(a.sfx)) a.sfx = 'full';
  if (!['clear', 'normal'].includes(a.pace)) a.pace = 'clear';
  for (const c of Array.isArray(a.custom) ? a.custom : []) {
    if (c && c.tier === 'alarm') c.tier = 'epic';
  }
  delete a.voiceVolume;
  delete a.voiceEffect;
  delete a.voiceSpeakers;
  store.save();
}

function migrateSettings() {
  const s = store.get();
  migrateAlertSound(s);
  s.ui = s.ui || {};
  if (!s.ui.panel) {
    s.ui.panel = 'attached';
    s.ui.panelOpen = true;
  }
  // The panel's default width (480; it was 430 until 0.48). Anyone still on
  // the old default moves up once; a width you chose yourself is kept.
  if (!s.ui.panelWidth) s.ui.panelWidth = PANEL_WIDTH;
  if (s.ui.panelWidth === 430 && !s.ui.width480) s.ui.panelWidth = PANEL_WIDTH;
  s.ui.width480 = true;
  delete s.ui.dock;
  // Left over from an unreleased draft of the spending card.
  delete s.earnHistory;
  // The owner's wants, in his order, become the plan once (editable after).
  budget.seedWants(s);
  // Purchases recorded before 0.29.1 were junk (the purchase command's
  // item is nested, so none were identified): cleared once.
  if (s.purchases && typeof s.purchases === 'object' && s.purchases.v !== budget.PURCHASES_VERSION) {
    budget.resetPurchases(s);
    setTimeout(() => recordNote('🛒 Buying patterns were reset: what was recorded before this version was incomplete. They fill in again from here.'), 6000);
  }
  pityState();
  store.save();
}

let lastCapsuleSig = '';

/* The garden status to the panel (v0.54.1): with a big garden it's ~180 KB,
 * and most of it (team summaries, the Garden map's plan, every pet) only
 * changes when you edit a team, move a plant or a pet levels. Those parts go
 * only when they've changed; the panel keeps its last copy (`sameAsBefore`
 * names them). When the panel's page (re)loads it has none, so all go. */
const STATUS_HEAVY = ['teamSummaries', 'plan', 'allPets', 'teams'];
let heavySent = {};
function sendGardenStatus(st) {
  if (!st || typeof st !== 'object') return sendToControl('garden:status', st);
  const out = Object.assign({}, st);
  const same = [];
  for (const k of STATUS_HEAVY) {
    if (!(k in st)) continue;
    const sig = JSON.stringify(st[k]);
    if (heavySent[k] === sig) {
      delete out[k];
      same.push(k);
    } else {
      heavySent[k] = sig;
    }
  }
  if (same.length) out.sameAsBefore = same;
  return sendToControl('garden:status', out);
}

function handleGardenMessage(type, payload) {
  if (!payload || typeof payload !== 'object') return;

  if (type === 'status') {
    const t0 = performance.now();
    const parts = {};
    let t = t0;
    // The observer's connection id (pageId:welcomes). Kept apart, because
    // gardenStatus.session below becomes the coins-this-session box.
    const connectionId = payload.session;
    gardenStatus = Object.assign({}, payload, { at: Date.now() });
    gardenStatus.pets = petData.describePets(payload.pets, payload.trough);
    t = perfPart(parts, 'pets', t);
    enrichPets(gardenStatus);
    t = perfPart(parts, 'enrichPets', t);
    gardenStatus.eta = gardenEta(gardenStatus);
    gardenStatus.size = sizeEta(gardenStatus);
    gardenStatus.weatherKind = weather.kindOf(gardenStatus.weather);
    t = perfPart(parts, 'eta', t);
    pushBinderMap(false);
    gardenStatus.plan = gardenPlanOf(payload.gardenPlants, payload.gardenTiles);
    if (alwaysMapOn() && mapPinView() === 'value') pushMapPin();
    t = perfPart(parts, 'plan', t);
    // Each plant kind's crops and mutations (v0.64.0), for leaving plants out
    // of Mutations over time; and their names.
    gardenStatus.plantMuts = plantMutRows(payload.gardenPlants);
    gardenStatus.plantNames = plantNamesOf(gardenStatus.plantMuts);
    // What harvest mode would let through right now (the panel shows it).
    gardenStatus.harvestMatch = harvestRule.count(payload.gardenPlants, harvestLock().mode);
    // Daily quests (v0.65.0): today's three in words, with help.
    gardenStatus.quests = questsView(gardenStatus);
    t = perfPart(parts, 'plantsQuests', t);
    // Today's Haunt Quest is a sign the Haunt Event is running (its theme).
    if (payload.spookyQuest && payload.spookyQuest.dayUTC === questLib.dayUTC(Date.now())) noteEventSign('haunt');
    delete gardenStatus.dailyQuests;
    delete gardenStatus.spookyQuest;
    delete gardenStatus.gardenEggs;
    delete gardenStatus.gardenPlants;
    if (gardenStatus.foundSelf) {
      checkGrown(gardenStatus);
      recordWorth(gardenStatus);
      t = perfPart(parts, 'grownWorth', t);
      checkSale(gardenStatus);
      applyShopPurchases(payload.shopPurchases);
      if (sharer && shareOn()) sharer.nudge().catch(() => {});
      t = perfPart(parts, 'saleShop', t);
      pushBudgetHud(false);
      t = perfPart(parts, 'budgetHud', t);
    }
    // Coins this session: net change in the wallet since the app first saw
    // it (spending counts against it, like in real life).
    const coins = gardenStatus.wallet && Number(gardenStatus.wallet.coins);
    if (Number.isFinite(coins)) {
      if (!sessionCoins) sessionCoins = { start: coins, at: Date.now() };
      const hours = (Date.now() - sessionCoins.at) / 3600000;
      gardenStatus.session = { change: coins - sessionCoins.start, hours, perHour: hours > 0.05 ? (coins - sessionCoins.start) / hours : null, since: sessionCoins.at };
    }
    // stats.petAbility mixes two kinds of number: how many times each ability
    // triggered (keyed by the ability's id), and running totals of what they
    // produced (total... in coins/hunger/XP, seconds... saved). Keep them apart.
    const procs = gardenStatus.lifetime && gardenStatus.lifetime.petAbility;
    if (procs && typeof procs === 'object') {
      const byName = {};
      const totals = [];
      for (const [id, n] of Object.entries(procs)) {
        const v = Number(n) || 0;
        if (/^(total|seconds)/.test(id)) {
          totals.push(Object.assign({ key: id, value: v }, PET_TOTALS[id] || {
            label: id.replace(/^total/, '').replace(/^seconds/, 'Seconds ').replace(/([a-z])([A-Z])/g, '$1 $2').trim(),
            unit: /^seconds/.test(id) ? 'time' : 'number',
          }));
          continue;
        }
        const def = abilityData.lookup(id);
        const name = def ? def.name : String(id).replace(/([a-z])([A-Z])/g, '$1 $2');
        byName[name] = (byName[name] || 0) + v;
      }
      gardenStatus.abilityProcs = Object.entries(byName).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
      gardenStatus.abilityTotals = totals.filter((t) => t.value > 0).sort((a, b) => (a.order || 99) - (b.order || 99));
    }

    checkHunger(gardenStatus.pets);
    // Follow the game's own hatch total, once this connection has caught up.
    {
      const p = pityState();
      if (p.autoCount && connectionId && connectionId === p.syncConnection) pity.syncTotal(p, gardenStatus.eggsHatched);
    }
    // Capsule totals only change when you open a capsule: count, save and
    // tell the panel then, not on every status (v0.54.1: this saved the
    // settings file every few seconds, all session).
    if (gardenStatus.capsulePulls && pityState().autoCount) {
      const sig = JSON.stringify(gardenStatus.capsulePulls);
      if (sig !== lastCapsuleSig) {
        lastCapsuleSig = sig;
        const ev = luck.onCapsuleStats(luckState(), gardenStatus.capsulePulls);
        if (ev.length) celebrateLuck(ev, false);
        checkPrimed();
        store.save();
        sendLuck();
      }
    }
    checkLogoffFromGame(gardenStatus);
    checkPendingTeam(gardenStatus);
    trackTeams(gardenStatus);
    trackUsualTeam(gardenStatus);
    gardenStatus.usualTeam = usualTeam(gardenStatus);
    flushNamingWait(gardenStatus);
    followStageRule(gardenStatus);
    if (checkTriggers(gardenStatus)) {
      // A trigger just swapped: don't let the weather team undo it.
      // (v0.74.1: the weather alone, as checkWeatherTeam keys it since
      // v0.63.11; with the connection in it the weather team came straight
      // back over the trigger's suggestion.)
      lastTeamKey = weather.kindOf(gardenStatus.weather);
    } else {
      checkWeatherTeam(gardenStatus);
      checkTeamSuggestion(gardenStatus);
      checkUnwantedWeather(gardenStatus);
      checkPotWeather(gardenStatus);
    }
    t = perfPart(parts, 'checks', t);
    sendGardenStatus(gardenStatus);
    t = perfPart(parts, 'toPanel', t);
    perfStatus(parts, t - t0);
    return;
  }

  if (type === 'hatch') {
    const p = pityState();
    const h = hatches.live(p, luckState(), payload);
    if (h.counted) {
      const events = h.events;
      // A Rainbow version of the egg's rare pet: the secret celebration
      // takes over from the usual Rainbow alert.
      const rare = events.some((e) => e.type === 'egg' && e.kind === 'species');
      const isRainbow = (e) => (e.type === 'pet' || e.type === 'egg') && e.kind === 'mutation' && e.target === 'rainbow';
      const rainbow = events.some(isRainbow);
      if (rare && rainbow) {
        celebrateLuck(events.filter((e) => !isRainbow(e) && !(e.type === 'egg' && e.kind === 'species')));
        secretRainbow(payload.species);
      } else {
        celebrateLuck(events);
      }
      checkPrimed();
    }
    store.save();
    sendPity();
    sendLuck();
    return;
  }

  if (type === 'cropPulls') {
    if (!pityState().autoCount) return;
    const l = luckState();
    for (const c of payload.crops || []) luck.onCrop(l, c);
    checkPrimed();
    store.save();
    sendLuck();
    return;
  }

  if (type === 'hatchBacklog') {
    const p = pityState();
    // From now on this connection's status updates keep the game's total.
    const r = hatches.backlog(p, luckState(), payload);
    store.save();
    sendPity();
    const total = r.counted + r.unknown;
    if (total > 0) recordNote(`🥚 Caught up on ${total} hatch${total === 1 ? '' : 'es'} from while the app was closed`);
    if (p.autoCount) {
      celebrateLuck(r.events, true);
      checkPrimed();
      store.save();
      sendLuck();
    }
    return;
  }

  if (type === 'catalog') {
    applyCatalog(payload, true);
    return;
  }

  // A purchase command went out (see budget.js). Only used as a fallback
  // while the game's own per-restock tally hasn't been seen yet.
  if (type === 'purchase') {
    if (store.get().restockSeen && Object.keys(store.get().restockSeen).length) return;
    const entry = budget.recordPurchase(store.get(), payload);
    store.save();
    viewCache = { at: 0, view: null };
    if (entry) sendToControl('budget:purchase', entry);
    return;
  }

  // A corner map dragged somewhere (or double-clicked back to the corner).
  // The swap button on the game was pressed (v0.56.4).
  if (type === 'lastTeam') {
    swapToLastTeam().then((r) => {
      const contents = gameView && gameView.webContents;
      if (contents && !contents.isDestroyed()) contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.teamSaid && window.__mgLoaderObserver.teamSaid(${JSON.stringify(r)})`).catch(() => {});
      sendToControl('teams:lastResult', r);
    });
    return;
  }
  // The action bar (v0.57.0): the potted-plant command it learned from your
  // own planting; a saved team; harvest mode or the lock.
  if (type === 'potCommand') {
    const p = payload && typeof payload === 'object' && typeof payload.type === 'string' ? payload : null;
    if (p) {
      const s = store.get();
      s.ui = Object.assign({}, s.ui, { potCommand: { type: p.type.slice(0, 60), idKey: String(p.idKey).slice(0, 40), slotKey: String(p.slotKey).slice(0, 40), extra: p.extra && typeof p.extra === 'object' ? p.extra : {} } });
      store.save();
      sendToControl('keys:state', keysState());
    }
    return;
  }
  // The garden tile you're on changed (v0.57.8): straight to the panel.
  if (type === 'meTile') {
    const t = payload && Number.isInteger(payload.t) ? payload.t : null;
    const gap = payload && Number.isInteger(payload.gap) ? payload.gap : null;
    if (gardenStatus) {
      gardenStatus.meTile = t;
      gardenStatus.meGap = gap;
    }
    sendToControl('garden:me', { t, gap });
    return;
  }
  // Where your garden sits in the world (v0.57.6): learned tile pairs.
  if (type === 'mapCalib') {
    const clean = (list) => (Array.isArray(list) ? list : []).filter((c) => c && Number.isInteger(c.i) && Number.isFinite(c.x) && Number.isFinite(c.y)).slice(-40).map((c) => ({ i: c.i, x: c.x, y: c.y }));
    const s = store.get();
    const bySlot = {};
    if (payload && payload.bySlot && typeof payload.bySlot === 'object') for (const [k, list] of Object.entries(payload.bySlot)) if (/^\d{1,2}$/.test(k)) bySlot[k] = clean(list);
    s.ui = Object.assign({}, s.ui, { mapCalib: clean(payload && payload.calib), mapCalibBySlot: bySlot });
    store.save();
    return;
  }
  if (type === 'barTeam') {
    if (payload && payload.teamId) applyTeam(String(payload.teamId), '(action bar)');
    return;
  }
  if (type === 'barToggle') {
    if (payload && payload.what === 'mode') setHarvestLock({ mode: { on: !harvestLock().mode.on } });
    else if (payload && payload.what === 'lock') setHarvestLock({ on: !(store.get().harvestLock && store.get().harvestLock.on) });
    return;
  }
  // The seed picked on the quick-plant button (v0.56.15).
  if (type === 'plantPick') {
    const sp = payload && typeof payload.species === 'string' ? payload.species.slice(0, 60) : null;
    const s = store.get();
    s.ui = Object.assign({}, s.ui, { plantPick: sp });
    store.save();
    return;
  }
  // The lineup you had out settled (v0.56.5).
  if (type === 'lineup') {
    noteLineup(payload);
    return;
  }
  if (type === 'mapPos') {
    const p = payload || {};
    if (typeof p.id === 'string' && /^mg-[a-z-]{1,30}$/.test(p.id)) {
      const s = store.get();
      const pos = Object.assign({}, s.ui && s.ui.mapPos);
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) pos[p.id] = { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
      else delete pos[p.id];
      s.ui = Object.assign({}, s.ui, { mapPos: pos });
      store.save();
    }
    return;
  }
  // A corner map folded to its title, or opened again (v0.53.16).
  if (type === 'mapFold') {
    const p = payload || {};
    if (typeof p.id === 'string' && /^mg-[a-z-]{1,30}$/.test(p.id)) {
      const s = store.get();
      const folds = Object.assign({}, s.ui && s.ui.mapFold);
      if (p.folded) folds[p.id] = true;
      else delete folds[p.id];
      s.ui = Object.assign({}, s.ui, { mapFold: folds });
      store.save();
    }
    return;
  }
  // Pets named by hatch number (v0.75.0): the rename command, learned from
  // one you did yourself; and each name the server took (or didn't).
  if (type === 'petNamingLearned') {
    const shape = cleanNamingShape(payload);
    if (!shape) return;
    const n = petNaming();
    const had = Boolean(n.shape);
    n.shape = shape;
    store.save();
    if (!had) recordNote(n.on ? '🏷️ Learned how the game names pets: new pets get their hatch number' : '🏷️ Learned how the game names pets');
    sendToControl('naming', namingView());
    pushPetNaming();
    return;
  }
  // New pets to give cute names (v0.77.0): named once ranked (flushNamingWait).
  if (type === 'petsToName') {
    const now = Date.now();
    for (const p of (payload && Array.isArray(payload.pets) ? payload.pets : []).slice(0, 20)) {
      if (!p || !p.id || namingWait.some((w) => w.id === String(p.id))) continue;
      namingWait.push({ id: String(p.id), species: String(p.species || ''), mutations: Array.isArray(p.mutations) ? p.mutations.map(String) : [], at: now });
    }
    if (gardenStatus) flushNamingWait(gardenStatus);
    setTimeout(() => flushNamingWait(gardenStatus, true), 9000);
    return;
  }
  if (type === 'petNamed') {
    const n = petNaming();
    const what = { at: Date.now(), species: String((payload && payload.species) || '').slice(0, 40), name: String((payload && payload.name) || '').slice(0, 20) };
    const petId = String((payload && payload.petId) || '');
    namingSent.delete(petId);
    if (namingBulk && namingBulk.ids.has(petId)) {
      if (payload && payload.ok) namingBulk.done += 1;
      else namingBulk.failed += 1;
      if (namingBulk.active && namingBulk.done + namingBulk.failed >= namingBulk.total) {
        namingBulk.active = false;
        recordNote(`🎀 Gave ${namingBulk.done} pet${namingBulk.done === 1 ? '' : 's'} cute names`);
      }
    }
    if (payload && payload.skipped) {
      sendToControl('naming', namingView());
      return;
    }
    if (payload && payload.ok) {
      n.named = (Number(n.named) || 0) + 1;
      n.last = what;
      n.failed = null;
      // Cute names are remembered so they aren't given again for a while.
      if (!/^\d+$/.test(what.name)) {
        n.recent = (Array.isArray(n.recent) ? n.recent : []).concat([what.name]).slice(-NAME_RECENT);
      }
    } else {
      const first = !n.failed;
      n.failed = Object.assign(what, { code: String((payload && payload.code) || '').slice(0, 80) || null });
      if (first) recordNote(`⚠️ The game didn't take the name ${what.name} for your ${what.species.replace(/([a-z])([A-Z])/g, '$1 $2')}`);
    }
    store.save();
    sendToControl('naming', namingView());
    return;
  }

  // Logged in on another device: a note (v0.60.0: the app no longer comes
  // back by itself afterwards).
  if (type === 'superseded') {
    recordNote('📱 You logged in on another device, so the game here was logged out. Reload it when you want to play here again.');
    return;
  }

  // A team suggestion answered on the game (v0.60.0).
  if (type === 'teamSuggest') {
    answerTeamSuggestion(payload && payload.act === 'apply' ? 'apply' : 'dismiss');
    return;
  }

  if (type === 'harvestBlocked') {
    sendToControl('harvest:blocked', payload);
    return;
  }

  // A hatch the egg lock stopped (v0.69.0), and its popup's button.
  if (type === 'hatchBlocked') {
    lastHatchBlocked = { at: Date.now(), egg: String((payload && payload.egg) || '') };
    return;
  }
  if (type === 'eggLockGo') {
    showControl('pity');
    sendToControl('luck:focusLock', String((payload && payload.egg) || ''));
    return;
  }
  // The guard locked pet food and re-sent the sale (or couldn't).
  if (type === 'stepOut') {
    stepOutAnswer(payload && payload.act === 'ignore' ? 'ignore' : 'confirm');
    return;
  }
  if (type === 'sellGuard') {
    const pretty = (x) => String(x).replace(/([a-z])([A-Z])/g, '$1 $2');
    if (payload.ok) {
      recordNote(`🐾 Kept your pet food: locked ${(payload.locked || []).map(pretty).join(', ') || 'it'}, sold the rest${payload.unlocked ? ', then unlocked it again for the trough' : ''}.`);
    } else if (Array.isArray(payload.soldAnyway) && payload.soldAnyway.length) {
      recordNote(`🐾 The game sold ${payload.soldAnyway.map(pretty).join(', ')} even though the app locked it. Until this is fixed, the app will stop sales with pet food in them instead of locking it for you: right-click your pet food to lock it, then sell. Please send a sample (Extras, 🛠 Troubleshooting).`, 'Pet food was sold');
    } else {
      recordNote(`🐾 Couldn't lock ${(payload.failed || []).map(pretty).join(', ') || 'your pet food'}${payload.error ? ` (${payload.error})` : ''}, so nothing was sold. Right-click to lock it and sell again; a sample (Extras, 🛠 Troubleshooting) would help.`, 'Sale stopped: pet food');
    }
    sendToControl('harvest:sellGuard', payload);
    return;
  }
  // The field name that locks a crop, learned by trying: kept for next time.
  if (type === 'lockField') {
    const lock = harvestLock();
    if (typeof payload.field === 'string' && /^[a-zA-Z]{1,20}$/.test(payload.field)) {
      lock.lockField = payload.field;
      store.save();
    }
    return;
  }

  if (type === 'sellBlocked') {
    const list = (Array.isArray(payload.crops) ? payload.crops : []).map((c) => `${String(c.species || '').replace(/([a-z])([A-Z])/g, '$1 $2')} ×${c.count}`).join(', ');
    recordNote(`🐾 Stopped a sale: ${list || 'crops of your potted plants'} aren't locked. Right-click them in your bag to lock them and sell again, or turn off "Never sell pet food".`, 'Sale stopped: pet food');
    sendToControl('harvest:sellBlocked', payload);
    return;
  }

  if (type === 'harvestLockFallback') {
    recordNote(`🔒 Harvest lock switched to its backup method for this session (the game answered "${String(payload.code || '').slice(0, 40)}"). Please report this.`);
    return;
  }

  if (type === 'commandResult') {
    if (!payload.ok && /^Wish:/.test(String(payload.what || '')) && seedRun && seedRun.running) {
      seedRun.rejected = payload.code || 'no reason given';
      return;
    }
    if (!payload.ok && pendingTeam) {
      recordNote(`⚠️ The game refused the switch to ${pendingTeam.name}${payload.code ? ` (${String(payload.code).slice(0, 40)})` : ''}`, 'Pet team swap didn\'t work');
      pendingTeam = null;
    }
    return;
  }

  // Coin Finder earnings, counted per pet. Saved on a timer, since these
  // land every few seconds.
  if (type === 'petCoins') {
    const g = store.get().garden;
    const key = String(payload.petId || payload.petName || 'pet').slice(0, 80);
    const pet = g.pets[key] || (g.pets[key] = { name: 'A pet', species: '', gold: 0, rainbow: 0, coins: 0 });
    pet.name = String(payload.petName || pet.name).slice(0, 60);
    pet.species = String(payload.species || pet.species).slice(0, 40);
    pet.coins = (pet.coins || 0) + Math.round(payload.coins);
    g.totals.coins = (g.totals.coins || 0) + Math.round(payload.coins);
    if (!g.since) g.since = Date.now();
    saveGardenSoon();
    sendToControl('garden:stats', g);
    return;
  }

  if (type === 'petMutation') {
    const kind = payload.kind === 'rainbow' ? 'rainbow' : 'gold';
    const settings = store.get();
    const g = settings.garden;
    if (!g.since) g.since = Date.now();

    const key = String(payload.petId || payload.petName || 'pet').slice(0, 80);
    const pet = g.pets[key] || (g.pets[key] = { name: 'A pet', species: '', gold: 0, rainbow: 0 });
    pet.name = String(payload.petName || pet.name).slice(0, 60);
    pet.species = String(payload.species || pet.species).slice(0, 40);
    pet[kind] += 1;
    g.totals[kind] += 1;
    store.save();
    sendToControl('garden:stats', g);

    const ruleId = kind === 'gold' ? 'petgold' : 'petrainbow';
    if (!settings.alerts.disabled.includes(ruleId)) {
      const alert = { ruleId, tier: 'pet', kind: 'pet', label: kind === 'gold' ? 'Gold' : 'Rainbow', itemName: pet.name };
      const muted = quietFor(settings, alert.ruleId);
      recordAlerts([alert], muted);
      if (!muted) sendToControl('alerts:play', [alert]);
    }
    return;
  }
}

/* ================================================================== *
 * Windows
 * ================================================================== */

function focusGame() {
  if (!gameWindow || gameWindow.isDestroyed()) return;
  if (gameWindow.isMinimized()) gameWindow.restore();
  gameWindow.show();
  gameWindow.focus();
  gameWindow.flashFrame(false);
  if (gameView && gameView.webContents && !gameView.webContents.isDestroyed()) gameView.webContents.focus();
}

/* ------------------------------------------------------------------ *
 * The panel: attached to the right side of the game, or in its own
 * window. ui.panel is 'attached' or 'window'; ui.panelOpen says whether
 * the attached panel is showing; ui.panelWidth is its width.
 * ------------------------------------------------------------------ */

const PANEL_MIN = 320;
const PANEL_MAX = 700;

function panelWidth() {
  const w = Number(store.get().ui.panelWidth) || PANEL_WIDTH;
  return Math.max(PANEL_MIN, Math.min(PANEL_MAX, w));
}

/* Panel size (v0.53.16): the panel keeps its layout width (ui.panelWidth,
 * in the panel's own pixels) and is drawn bigger or smaller with the
 * screen: 'auto' picks a zoom from the window's height (a 13" laptop's
 * ~700 px gets 0.8, a 1440p monitor's ~1400 gets 1.35), or a fixed size.
 * It never takes more than 42% of the window, so the game keeps the most. */
const PANEL_SIZES = { small: 0.85, medium: 1, large: 1.2, xlarge: 1.4 };
function panelScale(h) {
  const pick = store.get().ui.panelSize;
  if (PANEL_SIZES[pick]) return PANEL_SIZES[pick];
  return Math.round(Math.max(0.8, Math.min(1.35, (Number(h) || 900) / 900)) * 20) / 20;
}
let panelZoomNow = null;
function applyPanelZoom(z) {
  if (!panelView || panelView.webContents.isDestroyed()) return;
  const zoom = Math.round(Math.max(0.5, Math.min(2, z)) * 1000) / 1000;
  if (panelZoomNow === zoom && panelView.webContents.getZoomFactor() === zoom) return;
  panelZoomNow = zoom;
  panelView.webContents.setZoomFactor(zoom);
}

/* A second account (v0.55.0): another game in its own login (its own
 * cookie store, persist:magicgarden-2), in a tab above the game. Both keep
 * running: the one you're not on is hidden and muted, never paused
 * (backgroundThrottling off), and gets your scripts too (anti-AFK keeps it
 * active). The panel's features (alerts, money, garden, maps) follow
 * account 1; account 2's game page only tells the app its name, room and
 * whether it's connected, for its tab. */
const TAB_BAR = 30;
const ALT_PARTITION = 'persist:magicgarden-2';
let altView = null;
let tabsView = null;
let activeAccount = 1;
let altInfo = { name: null, room: null, players: null, at: 0 };

function accountsState() {
  const me = gardenStatus && gardenStatus.self;
  const fresh = (t) => Boolean(t && Date.now() - t < 30000);
  return {
    second: Boolean(altView),
    active: altView ? activeAccount : 1,
    accounts: [
      { n: 1, name: (me && me.name) || null, room: gardenStatus && gardenStatus.room ? gardenStatus.room.players : null, live: fresh(gardenStatus && gardenStatus.at) },
      ...(altView ? [{ n: 2, name: altInfo.name, room: altInfo.players, live: fresh(altInfo.at) }] : []),
    ],
  };
}
let accountsPushAt = 0;
function pushAccounts(force) {
  if (!force && Date.now() - accountsPushAt < 2000) return;
  accountsPushAt = Date.now();
  const st = accountsState();
  sendToControl('accounts:state', st);
  if (tabsView && !tabsView.webContents.isDestroyed()) tabsView.webContents.send('accounts:state', st);
}
function ensureTabsView() {
  if (tabsView || !gameWindow) return;
  tabsView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload-tabs.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  tabsView.setBackgroundColor('#1f1329');
  tabsView.webContents.on('will-navigate', (event) => event.preventDefault());
  tabsView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  tabsView.webContents.on('did-finish-load', () => pushAccounts(true));
  tabsView.webContents.loadFile(path.join(__dirname, 'tabs.html'));
  gameWindow.contentView.addChildView(tabsView);
}
// Keep the panel above the game views when views are added.
function panelOnTop() {
  if (panelView && gameWindow && gameWindow.contentView.children.includes(panelView)) {
    gameWindow.contentView.removeChildView(panelView);
    gameWindow.contentView.addChildView(panelView);
  }
}
function createAltView() {
  if (altView || !gameWindow || gameWindow.isDestroyed()) return;
  const view = new WebContentsView({
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: ALT_PARTITION,
      preload: path.join(__dirname, 'preload-game.js'),
    },
  });
  altView = view;
  altInfo = { name: null, room: null, players: null, at: 0 };
  view.setBackgroundColor('#2A1B36');
  gameWindow.contentView.addChildView(view);
  ensureTabsView();
  if (tabsView) {
    gameWindow.contentView.removeChildView(tabsView);
    gameWindow.contentView.addChildView(tabsView);
  }
  panelOnTop();
  const contents = view.webContents;
  contents
    .loadURL('about:blank')
    .catch(() => {})
    .then(() => withTimeout(installObserver(contents), 5000))
    .catch(() => {})
    .finally(() => {
      if (!contents.isDestroyed()) contents.loadURL(GAME_URL);
    });
  contents.on('did-finish-load', () => {
    injectScripts(contents);
    // The overlays' font (v0.61.3; Inter since v0.67.0), as data, under its
    // own name; and the event theme on the glass.
    if (isGameUrl(contents.getURL())) {
      contents.insertCSS(overlayFontCss()).catch(() => {});
      setTimeout(() => pushTheme(true), 1500);
    }
    relayoutSoon();
  });
  contents.on('render-process-gone', (event, details) => {
    logError('second account', `stopped: ${details && details.reason}`);
    if (details && details.reason !== 'clean-exit') {
      setTimeout(() => {
        if (!contents.isDestroyed()) contents.loadURL(GAME_URL).catch((err) => logError('second account', err));
      }, 1500);
    }
  });
  contents.on('devtools-closed', () => {
    if (!contents.isDestroyed()) installObserver(contents);
  });
  // Its log-in windows (Discord and so on) share its own cookie store.
  contents.setWindowOpenHandler(({ url }) => {
    if (isGameUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          backgroundColor: '#2A1B36',
          webPreferences: { partition: ALT_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { secondAccount: true });
  store.save();
  layout();
  buildMenu();
  pushAccounts(true);
}
function removeAltView() {
  if (!altView) return;
  const v = altView;
  altView = null;
  activeAccount = 1;
  try {
    gameWindow.contentView.removeChildView(v);
  } catch (err) {
    /* already gone */
  }
  try {
    v.webContents.close();
  } catch (err) {
    /* already gone */
  }
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { secondAccount: false });
  store.save();
  layout();
  buildMenu();
  pushAccounts(true);
}
function showAccount(n) {
  const want = n === 2 && altView ? 2 : 1;
  if (want === activeAccount) return;
  activeAccount = want;
  layout();
  const v = want === 2 ? altView : gameView;
  if (v && !v.webContents.isDestroyed()) v.webContents.focus();
  pushAccounts(true);
}
// Account 2's game page: only what its tab shows.
function handleAltMessage(type, payload) {
  if (type !== 'status' || !payload || typeof payload !== 'object') return;
  const me = payload.self;
  altInfo = {
    name: me && me.name ? String(me.name).slice(0, 40) : altInfo.name,
    room: payload.room ? payload.room.roomId : null,
    players: payload.room ? payload.room.players : null,
    at: Date.now(),
  };
  pushAccounts(false);
}

function layout() {
  if (!gameWindow || gameWindow.isDestroyed() || !gameView) return;
  const [w, h] = gameWindow.getContentSize();
  const ui = store.get().ui;
  const attached = ui.panel !== 'window' && panelView && gameWindow.contentView.children.includes(panelView);
  const showPanel = attached && ui.panelOpen !== false;
  const scale = panelScale(h);
  let pw = 0;
  if (showPanel) pw = Math.max(0, Math.min(Math.round(panelWidth() * scale), Math.round(w * 0.42), w - 480));
  // With a second account (v0.55.0): a tab bar on top of the game area and
  // the account you're on below it; the other keeps running, hidden and muted.
  const gw = Math.max(0, w - pw);
  const top = altView ? TAB_BAR : 0;
  gameView.setBounds({ x: 0, y: top, width: gw, height: Math.max(0, h - top) });
  gameView.setVisible(activeAccount === 1 || !altView);
  if (!gameView.webContents.isDestroyed()) gameView.webContents.setAudioMuted(Boolean(altView) && activeAccount !== 1);
  if (altView) {
    altView.setBounds({ x: 0, y: top, width: gw, height: Math.max(0, h - top) });
    altView.setVisible(activeAccount === 2);
    if (!altView.webContents.isDestroyed()) altView.webContents.setAudioMuted(activeAccount !== 2);
  }
  if (tabsView) {
    tabsView.setBounds({ x: 0, y: 0, width: gw, height: altView ? TAB_BAR : 0 });
    tabsView.setVisible(Boolean(altView));
  }
  if (attached) {
    panelView.setBounds({ x: w - pw, y: 0, width: pw, height: h });
    panelView.setVisible(showPanel);
    // The zoom that fits the panel's layout width into the room it got.
    if (pw > 0) applyPanelZoom(pw / panelWidth());
  }
}

// On Windows the window's inner area settles a moment after it opens (the
// menu bar and display scaling apply) without a resize event, which left the
// panel and game a little too tall until the window was resized by hand.
// So lay out again a few times as things settle.
let relayoutTimers = [];
function relayoutSoon() {
  for (const t of relayoutTimers) clearTimeout(t);
  relayoutTimers = [50, 250, 800, 2000].map((ms) => setTimeout(() => {
    layout();
    layoutPanelWindow();
  }, ms));
}

function layoutPanelWindow() {
  // Only when the panel is actually in its own window: after being popped out
  // and back, the hidden window still exists, and sizing the panel to it
  // would drag the attached panel over the game.
  if (!panelWindow || panelWindow.isDestroyed() || !panelView) return;
  if (!panelWindow.contentView.children.includes(panelView)) return;
  const [w, h] = panelWindow.getContentSize();
  panelView.setBounds({ x: 0, y: 0, width: w, height: h });
  // In its own window it takes the size you pick (or its height's auto).
  applyPanelZoom(panelScale(h));
}

function createPanelWindow() {
  panelWindow = new BaseWindow({
    width: panelWidth(),
    height: 820,
    minWidth: PANEL_MIN,
    minHeight: 480,
    show: false,
    backgroundColor: '#251730',
    title: "SSK's Garden Buddy",
    icon: APP_ICON,
  });
  panelWindow.setMenuBarVisibility(false);
  panelWindow.on('resize', layoutPanelWindow);
  panelWindow.on('resized', layoutPanelWindow);
  panelWindow.on('show', () => setTimeout(layoutPanelWindow, 50));
  panelWindow.on('focus', checkClipboardRoom);
  panelWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      panelWindow.hide();
    }
  });
  panelWindow.on('closed', () => {
    panelWindow = null;
  });
}

// Moves the panel to where the settings say it should be. The page itself
// isn't reloaded, so nothing it's doing (a sound, a voice) is interrupted.
function placePanel(showIt) {
  if (!panelView || !gameWindow || gameWindow.isDestroyed()) return;
  const ui = store.get().ui;
  const inGame = gameWindow.contentView.children.includes(panelView);
  if (ui.panel === 'window') {
    if (inGame) gameWindow.contentView.removeChildView(panelView);
    if (!panelWindow || panelWindow.isDestroyed()) createPanelWindow();
    if (!panelWindow.contentView.children.includes(panelView)) panelWindow.contentView.addChildView(panelView);
    panelView.setVisible(true);
    layoutPanelWindow();
    if (showIt) {
      panelWindow.show();
      panelWindow.focus();
    }
  } else {
    if (panelWindow && !panelWindow.isDestroyed() && panelWindow.contentView.children.includes(panelView)) {
      panelWindow.contentView.removeChildView(panelView);
      panelWindow.hide();
    }
    if (!inGame) gameWindow.contentView.addChildView(panelView);
    if (showIt) ui.panelOpen = true;
  }
  layout();
  sendToControl('ui:panel', panelState());
}

function panelState() {
  const ui = store.get().ui;
  return { mode: ui.panel === 'window' ? 'window' : 'attached', open: ui.panelOpen !== false, width: panelWidth(), size: PANEL_SIZES[ui.panelSize] ? ui.panelSize : 'auto', zoom: panelZoomNow };
}

function setPanel(change) {
  const ui = store.get().ui;
  if (change.mode === 'window' || change.mode === 'attached') ui.panel = change.mode;
  if (typeof change.open === 'boolean') ui.panelOpen = change.open;
  if (change.width) ui.panelWidth = Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(Number(change.width))));
  if (typeof change.size === 'string') ui.panelSize = PANEL_SIZES[change.size] ? change.size : 'auto';
  store.save();
  placePanel(Boolean(change.show));
  return panelState();
}

const PANEL_ORDER = ['small', 'medium', 'large', 'xlarge'];
function zoomFocused(step) {
  const pc = panelView && !panelView.webContents.isDestroyed() ? panelView.webContents : null;
  if (pc && pc.isFocused()) {
    const cur = PANEL_SIZES[store.get().ui.panelSize] ? store.get().ui.panelSize : null;
    let next = 'auto';
    if (step !== 0) next = cur ? PANEL_ORDER[Math.max(0, Math.min(PANEL_ORDER.length - 1, PANEL_ORDER.indexOf(cur) + step))] : (step > 0 ? 'large' : 'small');
    const st = setPanel({ size: next });
    sendToControl('ui:panel', Object.assign({}, st, { sizeChanged: true }));
    return next;
  }
  const gc = gameView && !gameView.webContents.isDestroyed() ? gameView.webContents : null;
  if (!gc) return null;
  gc.setZoomLevel(step === 0 ? 0 : Math.max(-3, Math.min(3, gc.getZoomLevel() + step * 0.5)));
  return gc.getZoomLevel();
}

function togglePanel() {
  const ui = store.get().ui;
  if (ui.panel === 'window') {
    if (panelWindow && panelWindow.isVisible()) panelWindow.hide();
    else placePanel(true);
  } else {
    setPanel({ open: ui.panelOpen === false });
  }
}

function showControl(tab) {
  const ui = store.get().ui;
  if (ui.panel === 'window') placePanel(true);
  else setPanel({ open: true });
  if (tab) sendToControl('control:tab', tab);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

// Registers the garden observer to run before the game's own code on every
// page load. It needs a live page to talk to, so the window opens a blank
// page first. Opening the game console detaches it, so it's re-installed
// when the console closes. If any of this fails, the game still loads, just
// without garden tracking: nothing here is allowed to hold the game up.
async function installObserver(contents) {
  try {
    if (!contents || contents.isDestroyed() || contents.debugger.isAttached()) return false;
    // The observer runs in the game page and can't require modules, so the
    // crop price table and scoring function travel with it (crop-data.js).
    const prelude = cropData.browserSource() + gameData.browserSource();
    const source = prelude + fs.readFileSync(path.join(__dirname, 'garden-observer.js'), 'utf8');
    contents.debugger.attach('1.3');
    await withTimeout(contents.debugger.sendCommand('Page.enable'), 4000);
    await withTimeout(
      contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source }),
      4000
    );
    return true;
  } catch (err) {
    console.error('Garden observer could not be installed:', err);
    return false;
  }
}

function createGameWindow() {
  const ui = store.get().ui;
  // Fit the screen it opens on (v0.53.16): a 13" laptop at 150% scaling has
  // ~1280 x 680 to work with, less than the old fixed 1760 x 860. Small
  // screens open maximised.
  const area = screen.getPrimaryDisplay().workAreaSize;
  const wantW = ui.panel === 'window' ? 1280 : 1280 + Math.round(panelWidth() * panelScale(Math.min(900, area.height)));
  const small = area.width < 1500 || area.height < 860;
  gameWindow = new BaseWindow({
    width: Math.max(900, Math.min(wantW, area.width - 24)),
    height: Math.max(600, Math.min(900, area.height - 24)),
    minWidth: Math.min(900, area.width),
    minHeight: Math.min(600, area.height),
    backgroundColor: '#2A1B36',
    title: 'Magic Garden',
    icon: APP_ICON,
  });
  if (small && !process.env.MG_NO_MAXIMIZE) gameWindow.maximize();
  createGameView();
  wireGameWindow();
  // The second account comes back if it was open (v0.55.0).
  if (store.get().ui && store.get().ui.secondAccount) setTimeout(() => createAltView(), 1500);
  relayoutSoon();
}

// The game itself. Separate from the window so it can be rebuilt.
function createGameView() {
  const view = new WebContentsView({
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:magicgarden',
      preload: path.join(__dirname, 'preload-game.js'),
    },
  });
  gameView = view;
  view.setBackgroundColor('#2A1B36');
  gameWindow.contentView.addChildView(view);

  // The game page's title becomes the window's title, as a normal window does.
  view.webContents.on('page-title-updated', (event, title) => {
    if (gameWindow && !gameWindow.isDestroyed()) gameWindow.setTitle(title || 'Magic Garden');
  });

  // The garden observer has to be in place before the game opens its
  // connection, so it's registered to run first on every page load.
  const contents = view.webContents;
  contents
    .loadURL('about:blank')
    .catch(() => {})
    .then(() => withTimeout(installObserver(contents), 5000))
    .catch(() => {})
    .finally(() => {
      if (!contents.isDestroyed()) contents.loadURL(GAME_URL);
    });

  // A crashed game page is reloaded (not on a clean exit); a hang is noted.
  contents.on('render-process-gone', (event, details) => {
    logError('game page', `stopped: ${details && details.reason}`);
    if (details && details.reason !== 'clean-exit') {
      setTimeout(() => {
        if (!contents.isDestroyed()) contents.loadURL(GAME_URL).catch((err) => logError('game page', err));
      }, 1500);
    }
  });
  contents.on('unresponsive', () => logError('game page', 'stopped responding'));
  contents.on('did-finish-load', () => {
    injectScripts(contents);
    // The overlays' font (v0.61.3; Inter since v0.67.0), as data, under its
    // own name; and the event theme on the glass.
    if (isGameUrl(contents.getURL())) {
      contents.insertCSS(overlayFontCss()).catch(() => {});
      setTimeout(() => pushTheme(true), 1500);
    }
    relayoutSoon();
    pushHarvestLock();
    pushPetNaming();
    pushSpotMap();
    pushBinderMap(true);
    pushThunderMap();
    pushMountMap();
    pushMapPin(true);
    pushHatch(true);
    pushReadyRule();
    pushBudgetHud(true);
    pushLineups();
    pushTeamButton(true);
    pushPlantButton();
    pushActionBar();
    // Again once the game has had a moment (the observer is ready by then).
    setTimeout(() => {
      pushHarvestLock();
      pushPetNaming();
      pushSpotMap();
      pushBinderMap(true);
      pushThunderMap();
      pushMountMap();
      pushMapPin(true);
      pushHatch(true);
      pushReadyRule();
      pushBudgetHud(true);
      pushLineups();
      pushTeamButton(true);
      pushPlantButton();
      pushActionBar();
    }, 3000);
  });

  // The "back soon" page links straight to the game. If you follow it (or
  // reload the game any other way), you're no longer parked.
  contents.on('did-navigate', (event, url) => {
    if (parked && isGameUrl(url)) {
      const was = parked;
      if (was.eventKey) stayIn(was.kind, was.eventKey, was.until ? new Date(was.until).toISOString() : null);
      parked = null;
      clearTimeout(rejoinTimer);
      lastTeamKey = null;
      recordNote(`👋 Back in the game (you rejoined during ${was.label})`);
      sendParked();
    }
  });

  // Game pages that open a window (the login popup does) get a real
  // window, with the same session, as in a browser. Logging in closes that
  // popup by itself when it's done. Anything else opens in your browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (isGameUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          backgroundColor: '#2A1B36',
          webPreferences: { partition: 'persist:magicgarden', contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    // Only web links go to your browser: anything else a page might try to
    // open (a file:, a custom protocol) is ignored.
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // If the game page is ever closed out from under the app (a page calling
  // window.close(), say), put a fresh one in its place rather than leaving
  // a dead view behind.
  contents.on('destroyed', () => {
    if (quitting || !gameWindow || gameWindow.isDestroyed()) return;
    setTimeout(() => {
      if (quitting || !gameWindow || gameWindow.isDestroyed()) return;
      try {
        gameWindow.contentView.removeChildView(view);
      } catch (err) {
        /* already gone */
      }
      createGameView();
      if (panelView && gameWindow.contentView.children.includes(panelView)) {
        // Keep the panel on top of the new game view.
        gameWindow.contentView.removeChildView(panelView);
        gameWindow.contentView.addChildView(panelView);
      }
      layout();
    }, 200);
  });

  contents.on('devtools-closed', () => {
    if (!contents.isDestroyed()) installObserver(contents);
  });

}

function wireGameWindow() {
  gameWindow.on('focus', () => {
    if (gameWindow) gameWindow.flashFrame(false);
    checkClipboardRoom();
  });
  gameWindow.on('resize', layout);
  gameWindow.on('resized', layout);
  gameWindow.on('restore', layout);
  gameWindow.on('maximize', layout);
  gameWindow.on('unmaximize', layout);
  gameWindow.on('show', relayoutSoon);
  gameWindow.on('enter-full-screen', layout);
  gameWindow.on('leave-full-screen', layout);
  // Moving to a screen with different scaling changes the inner size too.
  gameWindow.on('moved', relayoutSoon);

  // Closing the game closes the whole app, alerts included.
  gameWindow.on('closed', () => {
    gameWindow = null;
    quitting = true;
    app.quit();
  });
  layout();
}

// The panel is also the sound engine, so it is created at startup and lives
// until the app quits, moving between the game window and its own window.
function createPanel() {
  panelView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-control.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  panelView.setBackgroundColor('#251730');
  // The panel only ever shows control.html: a web link opens in your browser
  // instead of replacing it, and a crashed panel comes back by itself.
  const pc = panelView.webContents;
  pc.on('will-navigate', (event, url) => {
    if (/^file:/i.test(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  pc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  pc.on('render-process-gone', (event, details) => {
    logError('panel', `stopped: ${details && details.reason}`);
    setTimeout(() => {
      if (!pc.isDestroyed()) pc.reload();
    }, 1000);
  });
  pc.on('did-start-loading', () => {
    heavySent = {};
  });
  panelView.webContents.loadFile(path.join(__dirname, 'control.html'));
  panelView.webContents.once('did-finish-load', relayoutSoon);
  placePanel(false);
}

/* ================================================================== *
 * Menu
 * ================================================================== */

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'Game',
      submenu: [
        { label: 'Reload game', accelerator: 'CmdOrCtrl+R', click: () => gameWindow && gameView.webContents.reload() },
        { label: 'Back to Magic Garden', click: () => (parked ? rejoin(true) : gameWindow && gameView.webContents.loadURL(GAME_URL)) },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
      ],
    },
    {
      label: 'Accounts',
      submenu: [
        { label: altView ? 'Second account is open' : 'Add a second account', enabled: !altView, click: () => { createAltView(); showAccount(2); } },
        { label: 'Switch account', accelerator: 'Ctrl+Tab', enabled: Boolean(altView), click: () => showAccount(activeAccount === 1 ? 2 : 1) },
        { label: 'Close the second account', enabled: Boolean(altView), click: () => removeAltView() },
      ],
    },
    {
      label: 'Panel',
      submenu: [
        { label: 'Show or hide the panel', accelerator: appKey('panel'), click: togglePanel },
        { label: 'Swap to last pet team', accelerator: appKey('lastTeam'), click: async () => sendToControl('teams:lastResult', await swapToLastTeam()) },
        { label: 'Harvest lock', type: 'checkbox', checked: Boolean(store.get().harvestLock && store.get().harvestLock.on), accelerator: appKey('harvestLock'), click: () => setHarvestLock({ on: !harvestLock().on }) },
        { label: 'Harvesting unlocked', type: 'checkbox', checked: Boolean(harvestLock().mode.on), accelerator: appKey('harvestMode'), click: () => setHarvestLock({ mode: { on: !harvestLock().mode.on } }) },
        { label: 'Money box over the game', type: 'checkbox', checked: budgetHudOn(), accelerator: appKey('moneyBox'), click: () => setBudgetHud(!budgetHudOn()) },
        { type: 'separator' },
        { label: 'Attached to the game', type: 'radio', checked: store.get().ui.panel !== 'window', click: () => setPanel({ mode: 'attached', open: true }) },
        { label: 'In its own window', type: 'radio', checked: store.get().ui.panel === 'window', click: () => setPanel({ mode: 'window', show: true }) },
      ],
    },
    {
      label: 'Alerts',
      submenu: [
        { label: 'Open alerts', accelerator: appKey('alerts'), click: () => showControl('alerts') },
        { label: 'Check the shops now', click: () => watcher && watcher.checkNow() },
        { type: 'separator' },
        { label: 'Snooze for 30 minutes', accelerator: appKey('snooze'), click: () => sendToControl('alerts:snooze', 30) },
        { label: 'Snooze for 1 hour', click: () => sendToControl('alerts:snooze', 60) },
        { label: 'Resume alerts', click: () => sendToControl('alerts:snooze', 0) },
      ],
    },
    {
      label: 'Eggs',
      submenu: [
        { label: 'Open Bad Luck Protection', accelerator: appKey('luck'), click: () => showControl('pity') },
        { label: 'Add one hatch by hand', accelerator: appKey('addHatch'), click: () => {
          pity.act(pityState(), { type: 'hatch' });
          store.save();
          sendPity();
          sendToControl('pity:hatch');
        } },
      ],
    },
    {
      label: 'Scripts',
      submenu: [
        { label: 'Open scripts', accelerator: appKey('scripts'), click: () => showControl('scripts') },
        { label: 'Run enabled scripts now', accelerator: appKey('runScripts'), click: () => gameWindow && injectScripts(gameView.webContents) },
        { label: 'Open scripts folder', click: () => shell.openPath(scriptsDir()) },
      ],
    },
    {
      label: 'View',
      submenu: [
        // Zoom follows focus (v0.54.1): in the panel it steps the panel's
        // size; in the game it zooms the game page. (The standard zoom roles
        // took these keys from the panel and zoomed it behind the layout's
        // back.)
        { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => zoomFocused(0) },
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: () => zoomFocused(1) },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => zoomFocused(-1) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          label: 'Game console',
          accelerator: isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
          click: () => gameWindow && gameView.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for updates…', click: () => { showControl('scripts'); checkForUpdate(true); } },
        { label: 'Download page', click: () => shell.openExternal(updater.PAGE_URL) },
        { label: 'Report a problem', click: () => shell.openExternal(`https://github.com/${updater.REPO}/issues`) },
        { type: 'separator' },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ================================================================== *
 * IPC
 * ================================================================== */

ipcMain.handle('settings:get', () => store.get());

// The panel sends its whole copy of the settings back. Only the parts it
// owns are taken from it; everything else (pet counts, egg counters, luck,
// worth history, the harvest lock, update state...) is written here in the
// main process, and a stale copy from the window must never overwrite it.
// A list of what the panel may change is safer than a list of what it may
// not: a setting added later is protected without anyone remembering to.
const PANEL_KEYS = ['alerts', 'weatherTeams', 'teamTriggers', 'logoff'];

ipcMain.handle('settings:set', (event, next) => {
  if (!next || typeof next !== 'object') return store.get();
  const current = store.get();
  const merged = Object.assign({}, current);
  for (const key of PANEL_KEYS) if (key in next) merged[key] = next[key];
  // Where the panel sits is decided here (ui:panel); the panel only picks the tab.
  merged.ui = Object.assign({}, current.ui, {
    tab: next.ui && next.ui.tab ? next.ui.tab : current.ui.tab,
    // Which panel sections you've folded or opened (the panel owns this too).
    folds: next.ui && next.ui.folds && typeof next.ui.folds === 'object'
      ? Object.fromEntries(Object.entries(next.ui.folds).slice(0, 120).map(([k, v]) => [String(k).slice(0, 60), Boolean(v)]))
      : current.ui.folds,
    // The Garden tab's view (v0.64.0).
    gardenView: next.ui && ['now', 'mutations', 'map', 'harvest', 'progress'].includes(next.ui.gardenView) ? next.ui.gardenView : current.ui.gardenView,
    // The Pets tab's view (v0.67.3).
    petsView: next.ui && ['now', 'food', 'teams', 'rank', 'made'].includes(next.ui.petsView) ? next.ui.petsView : current.ui.petsView,
    questRemind: next.ui && typeof next.ui.questRemind === 'boolean' ? next.ui.questRemind : current.ui.questRemind,
    // Event themes (v0.67.0): on unless switched off in Extras.
    eventThemes: next.ui && typeof next.ui.eventThemes === 'boolean' ? next.ui.eventThemes : current.ui.eventThemes,
    // The Garden map's view: to-do, value or spots.
    gardenMap: next.ui && ['todo', 'value', 'spots', 'thunder', 'dawn', 'amber'].includes(next.ui.gardenMap) ? next.ui.gardenMap : current.ui.gardenMap,
    // The Garden tab's mutation chart: which lines are on, and the range.
    mutChart: next.ui && next.ui.mutChart && typeof next.ui.mutChart === 'object'
      ? Object.assign(
        {
          hydro: next.ui.mutChart.hydro !== false,
          lunar: next.ui.mutChart.lunar !== false,
          color: next.ui.mutChart.color !== false,
          hours: [12, 24, 72, 168].includes(Number(next.ui.mutChart.hours)) ? Number(next.ui.mutChart.hours) : 24,
          // Stacked on or off (it wasn't kept before v0.64.0), and the
          // plants left out of the chart.
          stack: next.ui.mutChart.stack !== false,
          exclude: Array.isArray(next.ui.mutChart.exclude) ? [...new Set(next.ui.mutChart.exclude.map((x) => String(x).slice(0, 40)))].slice(0, 60) : [],
        },
        // The separate lines (v0.53.3), off unless ticked.
        Object.fromEntries(['wet', 'chilled', 'frozen', 'thunder', 'dawn', 'amber', 'gold', 'rainbow'].map((k) => [k, next.ui.mutChart[k] === true])),
      )
      : current.ui.mutChart,
  });
  // The clipboard switch is the one rooms setting the panel changes directly.
  if (next.rooms && typeof next.rooms === 'object' && typeof next.rooms.clipboard === 'boolean') {
    merged.rooms = Object.assign({}, current.rooms, { clipboard: next.rooms.clipboard });
  }
  const saved = store.set(merged);
  if (watcher) planLogoff(watcher.status());
  // The map kept on the game follows the view picked in the Garden tab.
  pushMapPin();
  return saved;
});

ipcMain.handle('weather:kinds', () => weather.KINDS);
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('teams:last', () => swapToLastTeam());
// Your stage (beta): off unless turned on in Extras → Beta features (v0.56.6).
function keysState() {
  const ui = store.get().ui || {};
  return { bar: actionBarCfg(), bagKeys: bagKeysCfg(), defaults: DEFAULT_BAR, appKeys: Object.fromEntries(Object.keys(APP_KEYS).map((k) => [k, appKey(k) || ''])), appDefaults: APP_KEYS, potLearned: Boolean(ui.potCommand), potCommand: ui.potCommand || null };
}
// The Garden tab's map card (v0.57.4): a map built by the game page.
ipcMain.handle('map:card', async (event, view) => {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed() || !['spots', 'thunder', 'dawn', 'amber'].includes(view)) return null;
  try {
    return await contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.mapCard ? window.__mgLoaderObserver.mapCard(${JSON.stringify(view)}) : null`, true);
  } catch (err) {
    return null;
  }
});
// Pet rankings (v0.58.0): which abilities count and how much; the trough chip.
ipcMain.handle('pets:prefs', (event, change) => {
  const c = change && typeof change === 'object' ? change : {};
  const s = store.get();
  const prefs = Object.assign({}, (s.ui && s.ui.petPrefs) || {});
  if (c.reset) for (const k of Object.keys(prefs)) delete prefs[k];
  else if (typeof c.key === 'string') prefs[c.key] = { on: c.on !== false, w: Math.max(0, Math.min(1, Number(c.w) || 0)) };
  s.ui = Object.assign({}, s.ui, { petPrefs: prefs });
  store.save();
  if (gardenStatus) {
    gardenStatus.petRank = rankPets(gardenStatus.allPets, prefs);
    sendGardenStatus(gardenStatus);
  }
  return gardenStatus ? gardenStatus.petRank : null;
});
ipcMain.handle('ui:troughHud', (event, on) => {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { troughHud: on === true });
  store.save();
  troughChipKey = '';
  if (gardenStatus) pushTroughChip(gardenStatus.troughTimer);
  return s.ui.troughHud;
});
// The team builder (v0.59.8): put these pets out.
ipcMain.handle('teams:putOut', async (event, ids) => {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return { ok: false, reason: 'The game isn\'t open.' };
  const list = (Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[\w-]{1,80}$/.test(x)).slice(0, 3);
  try {
    return await contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.putOut ? window.__mgLoaderObserver.putOut(${JSON.stringify(list)}) : { ok: false, reason: 'The game isn\\'t ready yet.' }`, true);
  } catch (err) {
    return { ok: false, reason: 'No answer from the game.' };
  }
});
ipcMain.handle('teams:suggestion', () => teamSuggestion);
ipcMain.handle('teams:answer', (event, act) => answerTeamSuggestion(act === 'apply' ? 'apply' : 'dismiss'));
// The first-run welcome is done (v0.63.2): kept in ui, which the panel's
// general save doesn't carry.
// Pet food that needs weather (v0.63.4): on / off (off by default) and your
// own ticks; reading it returns what's in use, the trough's kinds and what
// the rule suggests.
ipcMain.handle('ui:potWeather', (event, change) => {
  const s = store.get();
  const c = change && typeof change === 'object' ? change : {};
  const ui = Object.assign({}, s.ui);
  if (typeof c.on === 'boolean') ui.potWeather = c.on;
  if (Array.isArray(c.species)) ui.potWeatherSpecies = c.species.map(String).slice(0, 40);
  if (c.reset) delete ui.potWeatherSpecies;
  if (typeof c.on === 'boolean' || Array.isArray(c.species) || c.reset) {
    s.ui = ui;
    store.save();
  }
  const st = gardenStatus || {};
  return { on: ui.potWeather === true, species: petFoodNeedsWeather(st), custom: Array.isArray(ui.potWeatherSpecies), candidates: petFoodCandidates(st), suggested: petFoodSuggested(st) };
});
ipcMain.handle('ui:welcomed', (event, v) => {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { welcomed: v !== false });
  store.save();
  return s.ui.welcomed;
});
ipcMain.handle('ui:desktopNotify', (event, change) => {
  const s = store.get();
  const cur = Object.assign({ on: true, weather: true, teams: true, quests: true }, (s.ui || {}).desktopNotify);
  const c = change && typeof change === 'object' ? change : {};
  for (const k of ['on', 'weather', 'teams', 'quests']) if (typeof c[k] === 'boolean') cur[k] = c[k];
  s.ui = Object.assign({}, s.ui, { desktopNotify: cur });
  store.save();
  if (c.test) desktopNotify('🌱 Garden Buddy', 'Desktop notifications are on.', null);
  return cur;
});
ipcMain.handle('keys:get', () => keysState());
ipcMain.handle('keys:setBar', (event, change) => {
  const c = change && typeof change === 'object' ? change : {};
  const s = store.get();
  const cur = actionBarCfg();
  const next = { on: typeof c.on === 'boolean' ? c.on : cur.on, shape: c.shape === 'line' || c.shape === 'square' ? c.shape : cur.shape, slots: Array.isArray(c.slots) && c.slots.length === 9 ? c.slots : cur.slots };
  if (c.reset) next.slots = DEFAULT_BAR.map((x) => Object.assign({}, x));
  s.ui = Object.assign({}, s.ui, { actionBar: next });
  if (Array.isArray(c.bagKeys) && c.bagKeys.length === 9) s.ui.bagKeys = c.bagKeys.map((k) => (k && k.code ? { code: String(k.code), shift: Boolean(k.shift), ctrl: Boolean(k.ctrl), alt: Boolean(k.alt) } : null));
  if (c.resetBag) s.ui.bagKeys = null;
  if (c.forgetPot) s.ui.potCommand = null;
  store.save();
  pushActionBar(c.forgetPot ? { forgetPot: true } : null);
  return keysState();
});
ipcMain.handle('keys:setApp', (event, change) => {
  const c = change && typeof change === 'object' ? change : {};
  const s = store.get();
  const keys = Object.assign({}, (s.ui && s.ui.appKeys) || {});
  if (c.reset) {
    s.ui = Object.assign({}, s.ui, { appKeys: {} });
  } else if (typeof c.id === 'string' && c.id in APP_KEYS) {
    keys[c.id] = typeof c.accel === 'string' ? c.accel.slice(0, 40) : '';
    s.ui = Object.assign({}, s.ui, { appKeys: keys });
  }
  store.save();
  try {
    buildMenu();
  } catch (err) {
    logError('keys', err);
    // A key the menu won't take: back to the default for it.
    if (c.id) {
      delete keys[c.id];
      s.ui = Object.assign({}, s.ui, { appKeys: keys });
      store.save();
      buildMenu();
    }
  }
  return keysState();
});
ipcMain.handle('ui:plantBtnPlace', () => {
  pushPlantButton(true);
  return true;
});
ipcMain.handle('ui:plantBtn', (event, on) => {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { plantBtn: on === true });
  store.save();
  pushPlantButton();
  return s.ui.plantBtn;
});
ipcMain.handle('ui:stageOn', (event, on) => {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { stageOn: on === true });
  store.save();
  return s.ui.stageOn;
});
ipcMain.handle('ui:teamBtn', (event, on) => {
  const s = store.get();
  s.ui = Object.assign({}, s.ui, { teamBtn: on !== false });
  store.save();
  pushTeamButton(true);
  return s.ui.teamBtn;
});
ipcMain.handle('teams:apply', async (event, teamId) => {
  const r = await applyTeam(String(teamId), '(you pressed Apply)');
  return r;
});
ipcMain.handle('game:parked', () => parked);
ipcMain.handle('game:logoffNow', () => {
  if (!parked) {
    // v0.64.2: for the weather that's on (or about to start), so the
    // stepped-away page counts it down and offers "Reconnect when it ends";
    // a plain break when the sky's clear.
    const w = weatherToStepAwayFrom(Date.now());
    if (w) park(w.kind, w.endsAt || null, w.startsAt || null, true);
    else park(null, null, null, true);
  }
  return parked;
});
ipcMain.handle('game:rejoin', () => {
  rejoin(true);
  return parked;
});

ipcMain.handle('alerts:rules', () => alerts.publicRules(store.get()));

// Everything you could add an alert for, for the Alerts tab's dropdown:
// what the shops list right now (every item, in stock or not), everything
// the app has seen them list before, then a built-in list (decor, eggs)
// for weather shops that haven't opened while the app was watching.
// [{ name, itemId, shop, type, price, seen }], one per item name.
const EGG_SHOPS = { CommonEgg: 'egg', UncommonEgg: 'egg', RareEgg: 'egg', LegendaryEgg: 'egg', MythicalEgg: 'egg', DawnEgg: 'dawn', AmberEgg: 'amber', SnowEgg: 'snow', WinterEgg: 'snow', SpookyEgg: 'spooky' };
function itemCatalog() {
  const byName = new Map();
  const key = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const add = (it, seen) => {
    const k = key(it.name);
    if (!k || byName.has(k)) return;
    byName.set(k, { name: String(it.name).slice(0, 60), itemId: String(it.itemId || '').slice(0, 80), shop: String(it.shop || ''), type: String(it.type || ''), price: Number(it.price) > 0 ? Number(it.price) : null, seen });
  };
  for (const it of watcher ? watcher.listed() : []) add(it, true);
  const stats = budget.migrateStats(store.get().shopStats);
  for (const [itemId, it] of Object.entries(stats.items)) add({ itemId, name: it.name || itemId, shop: it.shop, type: it.type, price: it.price }, true);
  for (const d of budget.DECOR) add({ name: d.name, shop: d.shop, type: 'Decor', price: d.price }, false);
  for (const [id, e] of Object.entries(petData.EGGS)) add({ itemId: id, name: e.name, shop: EGG_SHOPS[id] || '', type: 'Egg' }, false);
  // The Haunt Event's egg, from the Spooky Shop (open at night).
  if (Date.now() < HAUNT_ENDS) add({ itemId: 'SpookyEgg', name: 'Spooky Egg', shop: 'spooky', type: 'Egg', price: 8e8 }, false);
  return [...byName.values()];
}
ipcMain.handle('alerts:catalog', () => itemCatalog());
ipcMain.handle('alerts:history', () => store.get().alertHistory);
ipcMain.handle('alerts:clearHistory', () => {
  store.get().alertHistory = [];
  store.save();
  return [];
});
ipcMain.handle('alerts:status', () => (watcher ? feedStatus(watcher.status()) : null));
ipcMain.handle('alerts:checkNow', async () => {
  if (watcher) await watcher.checkNow();
  return watcher ? feedStatus(watcher.status()) : null;
});

// "Reconnect when the weather ends" (v0.60.5): your press on the stepped-
// away page, for this weather only. Only from the game view showing that
// page, only while stepped away for weather (not a break).
ipcMain.on('parked:reconnect', (event, on) => {
  if (!gameView || event.sender !== gameView.webContents || isBreak(parked)) return;
  const url = (event.senderFrame && event.senderFrame.url) || '';
  if (!/^file:/.test(url) || !/parked\.html(\?|$)/.test(url)) return;
  parked.autoBack = on === true;
  recordNote(parked.autoBack ? `🔁 Reconnecting when ${parked.label} ends (you pressed it)` : `Not reconnecting when ${parked.label} ends`);
  sendParked();
  if (parked.autoBack && parked.overSaid) rejoin(false);
});
ipcMain.on('garden:msg', (event, msg) => {
  if (!event.senderFrame || !isGameUrl(event.senderFrame.url) || !msg) return;
  // Two accounts (v0.55.0): account 2's page only tells its tab about itself.
  if (altView && event.sender === altView.webContents) {
    handleAltMessage(msg.type, msg.payload);
    return;
  }
  handleGardenMessage(msg.type, msg.payload);
  if (msg.type === 'status' && altView) pushAccounts(false);
});
// Your stage (v0.56.0 beta): 'auto' or the stage you pick; the answer comes
// straight back, worked out from the last garden report.
ipcMain.handle('stage:set', (event, pick) => {
  const s = store.get();
  s.stage = { pick: ['early', 'mid', 'late'].includes(pick) ? pick : null };
  store.save();
  const st = gardenStatus ? stageEngine.detect(stageEngine.signalsFrom(gardenStatus), s.stage.pick) : stageEngine.detect({}, s.stage.pick);
  if (gardenStatus) {
    gardenStatus.stage = st;
    // The rankings' weights follow the stage (v0.70.0).
    try {
      gardenStatus.petRank = rankPets(gardenStatus.allPets, (s.ui || {}).petPrefs || {}, st.id);
      sendGardenStatus(gardenStatus);
    } catch (err) {
      logError('pet rankings', err);
    }
  }
  return st;
});
ipcMain.handle('accounts:get', () => accountsState());
ipcMain.handle('accounts:add', () => {
  createAltView();
  showAccount(2);
  return accountsState();
});
ipcMain.handle('accounts:remove', async () => {
  if (!altView) return accountsState();
  const r = process.env.MG_TEST_DIALOGS ? { response: 0 } : await dialog.showMessageBox(gameWindow, {
    type: 'question',
    buttons: ['Close it', 'Keep it'],
    defaultId: 1,
    cancelId: 1,
    message: 'Close the second account?',
    detail: 'Its game closes. It stays logged in, so adding it again picks up where it was.',
  });
  if (r.response === 0) removeAltView();
  return accountsState();
});
ipcMain.on('accounts:show', (event, n) => showAccount(Number(n)));

ipcMain.handle('ui:panel', (event, change) => (change ? setPanel(change) : panelState()));
// The panel's own script errors (v0.54.1), for the log.
ipcMain.on('panel:error', (event, e) => {
  if (e && typeof e === 'object') logError('panel script', `${String(e.message || '').slice(0, 400)}${e.where ? ` (${String(e.where).slice(0, 120)})` : ''}`);
});

ipcMain.handle('garden:get', () => ({ status: gardenStatus, stats: store.get().garden }));

// A strength you've typed in for one pet, overriding the worked-out one.
// Empty or 0 clears it.
ipcMain.handle('garden:strength', (event, petId, strength) => {
  const g = store.get().garden;
  g.strength = g.strength || {};
  const n = Math.round(Number(strength));
  if (!n) delete g.strength[String(petId)];
  else g.strength[String(petId)] = Math.max(1, Math.min(100, n));
  store.save();
  if (gardenStatus) {
    enrichPets(gardenStatus);
    gardenStatus.eta = gardenEta(gardenStatus);
    gardenStatus.size = sizeEta(gardenStatus);
    sendGardenStatus(gardenStatus);
  }
  return g.strength;
});

ipcMain.handle('pity:get', () => pityView());
ipcMain.handle('luck:get', () => luckView());
ipcMain.handle('luck:set', (event, key, value) => {
  luck.set(luckState(), key, value);
  store.save();
  sendLuck();
  return luckView();
});
ipcMain.handle('luck:options', (event, opts) => {
  const l = luckState();
  if (opts && opts.notify && typeof opts.notify === 'object') Object.assign(l.notify, opts.notify);
  store.save();
  sendLuck();
  return luckView();
});
ipcMain.handle('pity:act', (event, action) => {
  const p = pityState();
  pityUndo.push(JSON.stringify(p));
  if (pityUndo.length > 40) pityUndo.shift();
  let message;
  if (action && action.type === 'undo') {
    pityUndo.pop();
    const prev = pityUndo.pop();
    if (prev) {
      store.get().pity = pity.migrate(JSON.parse(prev));
      message = 'Undone.';
    } else message = 'Nothing to undo.';
  } else {
    message = pity.act(p, action);
  }
  store.save();
  sendPity();
  return { message, view: pityView() };
});

/* ------------------------------------------------------------------ *
 * Harvest lock: tells the game page which harvests to stop (all of them
 * while the lock is on, and protected crops always). The page does the
 * stopping (garden-observer.js); nothing is ever sent.
 * ------------------------------------------------------------------ */

function harvestLock() {
  const s = store.get();
  s.harvestLock = Object.assign({ on: false, species: [], petFood: false, lockField: null, team: null, teamBack: true, teamBefore: null, teamSwapped: null }, s.harvestLock);
  // Harvest mode (v0.54.4): only crops matching this rule can be harvested.
  // Since v0.54.7 the rule is also what "ready" means everywhere. Someone who
  // never set it starts from the old Money-tab ready rule (full size, Gold or
  // Rainbow, any weather, any moon unless they'd turned one off).
  if (!s.harvestLock.modeSet) {
    const cur = harvestRule.clean(s.harvestLock.mode);
    const untouched = cur.color === 'any' && !cur.hydro.length && !cur.lunar.length && !cur.size;
    if (untouched) {
      const old = (s.budget && s.budget.readyRule) || {};
      s.harvestLock.mode = Object.assign(cur, {
        color: old.color === false ? 'any' : 'goldOrRainbow',
        hydro: old.hydro === false ? [] : harvestRule.HYDRO.slice(),
        lunar: old.lunar === false ? [] : harvestRule.LUNAR.slice(),
        size: old.size !== false,
      });
    }
    s.harvestLock.modeSet = true;
  }
  s.harvestLock.mode = harvestRule.clean(s.harvestLock.mode);
  return s.harvestLock;
}


// The event theme on the game's overlays too (v0.67.0).
let pushedTheme = null;
function pushTheme(force = false) {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const t = themeNow();
  const id = t ? t.id : '';
  if (!force && pushedTheme === id) return;
  pushedTheme = id;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setTheme && window.__mgLoaderObserver.setTheme(${JSON.stringify(t ? { id: t.id } : null)})`, true).catch(() => {});
}
/* Pets named by hatch number (v0.75.0; the work is in garden-observer.js).
 * Settings: petNaming { on, shape: the game's rename command as learned from
 * your own rename, named, last, failed }. Off unless you turn it on. */
function petNaming() {
  const s = store.get();
  if (!s.petNaming || typeof s.petNaming !== 'object') s.petNaming = { on: false, style: 'number', shape: null, named: 0, last: null, failed: null };
  return s.petNaming;
}
// v0.76.0: style 'number' (the hatch number) or 'cute' (pet-names.js).
const namingStyle = (n) => (n && n.style === 'cute' ? 'cute' : 'number');
function namingView() {
  const n = petNaming();
  const st = gardenStatus;
  const unnamed = st && st.foundSelf && Array.isArray(st.allPets) ? st.allPets.filter((p) => !p.name).length : null;
  const b = namingBulk;
  return {
    on: Boolean(n.on),
    style: namingStyle(n),
    learned: Boolean(n.shape),
    named: Number(n.named) || 0,
    last: n.last || null,
    failed: n.failed || null,
    unnamed,
    bulk: b ? { active: b.active, total: b.total, done: b.done, failed: b.failed } : null,
  };
}

/* Cute names, picked here (v0.77.0): pet-names.js, ranked by Pet Power at
 * max against your other pets (your best 10% grand names, the next 30%
 * fancy ones), never a name one of your pets has or one given in the last
 * 1,500 (petNaming.recent). */
const NAME_RECENT = 1500;
let namingWait = []; // new pets the game page asked names for: { id, species, mutations, at }
let namingSent = new Map(); // petId → name sent to the game page, until it answers
let namingBulk = null; // "Name my unnamed pets": { active, ids:Set, total, done, failed }
function namingTier(st, id) {
  const rk = (st && st.petRank && st.petRank.ranking) || [];
  const vals = rk.map((x) => Number(x.atMax) || 0).filter((v) => v > 0);
  const me = rk.find((x) => x.id === id);
  const v = me ? Number(me.atMax) || 0 : 0;
  if (!(v > 0) || vals.length < 3) return 'normal';
  const share = vals.filter((x) => x < v).length / vals.length;
  return share >= 0.9 ? 'top' : share >= 0.6 ? 'high' : 'normal';
}
function cuteNames(st, pets) {
  const n = petNaming();
  const taken = ((st && st.allPets) || []).map((p) => p.name).filter(Boolean)
    .concat(Array.isArray(n.recent) ? n.recent : [], [...namingSent.values()]);
  return pets.map((p) => {
    const name = petNames.pick({ species: p.species, mutations: p.mutations }, { tier: namingTier(st, p.id), taken });
    taken.push(name);
    return { petId: p.id, species: p.species, name };
  });
}
function sendNamesToGame(list, bulk) {
  const contents = gameView && gameView.webContents;
  if (!list.length || !contents || contents.isDestroyed()) return Promise.resolve(0);
  for (const j of list) namingSent.set(j.petId, j.name);
  return contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.queuePetNames ? window.__mgLoaderObserver.queuePetNames(${JSON.stringify(list)}, ${bulk ? 'true' : 'false'}) : 0`, true).catch(() => 0);
}
// New pets wait here until the game's report has them ranked (their Pet
// Power), at most 8 s; then they're named.
function flushNamingWait(st, force) {
  if (!namingWait.length) return;
  const ranked = new Set((((st && st.petRank && st.petRank.ranking) || [])).map((x) => x.id));
  const now = Date.now();
  const ready = namingWait.filter((p) => force || ranked.has(p.id) || now - p.at > 8000);
  if (!ready.length) return;
  namingWait = namingWait.filter((p) => !ready.includes(p));
  sendNamesToGame(cuteNames(st, ready), false);
}
function cleanNamingShape(p) {
  if (!p || typeof p.type !== 'string' || typeof p.idField !== 'string' || typeof p.nameField !== 'string') return null;
  const extra = {};
  for (const [k, v] of Object.entries((p.extra && typeof p.extra === 'object') ? p.extra : {}).slice(0, 10)) {
    if (typeof v === 'number' || typeof v === 'boolean') extra[String(k).slice(0, 40)] = v;
  }
  return { type: p.type.slice(0, 60), idField: p.idField.slice(0, 40), nameField: p.nameField.slice(0, 40), extra };
}
function pushPetNaming() {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const n = petNaming();
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setPetNaming && window.__mgLoaderObserver.setPetNaming(${JSON.stringify({ on: Boolean(n.on), style: namingStyle(n), shape: n.shape || null })})`, true).catch(() => {});
}
ipcMain.handle('naming:get', () => namingView());
// "Name my unnamed pets" (v0.77.0): a cute name for every pet of yours that
// has none, one at a time. Pets with a name are never touched.
ipcMain.handle('naming:bulk', async () => {
  const n = petNaming();
  const st = gardenStatus;
  if (!n.shape) return Object.assign(namingView(), { ok: false, reason: 'Rename any pet once in the game first, so the app learns how.' });
  if (!st || !st.foundSelf || !st.canSend) return Object.assign(namingView(), { ok: false, reason: 'The game isn\'t connected.' });
  const pets = (st.allPets || []).filter((p) => !p.name && !namingSent.has(p.id));
  if (!pets.length) return Object.assign(namingView(), { ok: true, count: 0 });
  const list = cuteNames(st, pets);
  namingBulk = { active: true, ids: new Set(list.map((j) => j.petId)), total: list.length, done: 0, failed: 0 };
  await sendNamesToGame(list, true);
  sendToControl('naming', namingView());
  return Object.assign(namingView(), { ok: true, count: list.length });
});
ipcMain.handle('naming:bulkStop', async () => {
  const contents = gameView && gameView.webContents;
  if (contents && !contents.isDestroyed()) await contents.executeJavaScript('window.__mgLoaderObserver && window.__mgLoaderObserver.stopPetNames ? window.__mgLoaderObserver.stopPetNames() : 0', true).catch(() => 0);
  if (namingBulk) {
    for (const id of namingBulk.ids) namingSent.delete(id);
    namingBulk.active = false;
  }
  sendToControl('naming', namingView());
  return namingView();
});
ipcMain.handle('naming:set', (event, change) => {
  const n = petNaming();
  if (change && typeof change.on === 'boolean') n.on = change.on;
  if (change && ['number', 'cute'].includes(change.style)) n.style = change.style;
  if (change && change.forget) n.shape = null;
  if (change && change.on) n.failed = null;
  store.save();
  pushPetNaming();
  sendToControl('naming', namingView());
  return namingView();
});

function pushHarvestLock() {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const lock = harvestLock();
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setHarvestLock(${JSON.stringify(lock)})`, true).catch(() => {});
}

// What "ready" means by stage, for a new install until you pick your own
// (v0.78.0, the first-run test: a new player's ripe Carrot never counted as
// ready under the late-game rule, so Home said 0 ready and Harvesting
// unlocked let nothing come off). Early: ripe. Mid: Gold or Rainbow, full
// size. Late: the full rule, as before.
function readyRuleFor(stageId) {
  if (stageId === 'late') return { color: 'goldOrRainbow', hydro: harvestRule.HYDRO.slice(), lunar: harvestRule.LUNAR.slice(), size: true };
  if (stageId === 'mid') return { color: 'goldOrRainbow', hydro: [], lunar: [], size: true };
  return { color: 'any', hydro: [], lunar: [], size: false };
}
// While the rule is still the app's pick (modeAuto), it follows your stage.
function followStageRule(st) {
  const lock = harvestLock();
  if (!lock.modeAuto || !st || !st.stage || !st.stage.id) return;
  const want = readyRuleFor(st.stage.id);
  const cur = lock.mode || {};
  const same = cur.color === want.color && cur.size === want.size && (cur.hydro || []).join() === want.hydro.join() && (cur.lunar || []).join() === want.lunar.join();
  if (!same) setHarvestLock({ mode: want }, true);
}
// A new install's defaults (v0.78.0): the ready rule by stage, and the
// action bar off until you turn it on (in the setup or Extras).
// The wants list waits too: the late-game defaults (Moonbinder 50B...) only
// once the garden turns out to be worth 1B+; a new player starts with an
// empty list (otherwise "safe to spend" said save all 1.9K for a Moonbinder).
function freshInstallDefaults(s) {
  s.harvestLock = Object.assign({}, s.harvestLock, { mode: Object.assign({ on: false }, readyRuleFor('early')), modeSet: true, modeAuto: true });
  s.ui = Object.assign({}, s.ui, { actionBar: Object.assign({}, (s.ui || {}).actionBar, { on: false }) });
  s.budget = Object.assign({}, s.budget, { plan: [], wantsSeeded: true, wantsMythic: true, wantsAmber: true, wantsPending: true });
}

function setHarvestLock(change, auto) {
  const lock = harvestLock();
  const wasOn = Boolean(lock.mode && lock.mode.on);
  if (change && typeof change.on === 'boolean') lock.on = change.on;
  if (change && typeof change.petFood === 'boolean') lock.petFood = change.petFood;
  if (change && Array.isArray(change.species)) lock.species = change.species.map(String).slice(0, 100);
  if (change && change.mode && typeof change.mode === 'object') lock.mode = harvestRule.clean(Object.assign({}, lock.mode, change.mode));
  // Your own pick of what "ready" means ends the app's pick by stage.
  if (!auto && change && change.mode && ['color', 'hydro', 'lunar', 'size'].some((k) => k in change.mode)) lock.modeAuto = false;
  // The harvest team (v0.73.0): a saved team to put out with Harvesting
  // unlocked, and whether the pets before come back when it's turned off.
  if (change && 'team' in change) lock.team = change.team ? String(change.team).slice(0, 80) : null;
  if (change && typeof change.teamBack === 'boolean') lock.teamBack = change.teamBack;
  const isOn = Boolean(lock.mode && lock.mode.on);
  if (!wasOn && isOn) harvestTeamOut(lock);
  if (wasOn && !isOn) harvestTeamBack(lock);
  store.save();
  pushHarvestLock();
  // The rule is what "ready" means: the Money tab counts again.
  viewCache.view = null;
  sendToControl('harvest:lock', lock);
  buildMenu();
  return lock;
}

/* Harvest team (v0.73.0, the owner: "set a team for harvest mode that auto
 * swaps out when you turn it on"). Turning Harvesting unlocked on is your
 * press, and it puts out your harvest team (one swap); the pets you had out
 * are remembered. Turning it off puts them back (one swap), unless you've
 * changed pets since or switched that off. Nothing happens on its own. */
function petIdsOut() {
  return ((gardenStatus && gardenStatus.pets) || []).map((p) => String(p.id)).filter(Boolean).sort();
}
function harvestTeamOut(lock) {
  lock.teamBefore = null;
  lock.teamSwapped = null;
  if (!lock.team) return;
  const team = gardenStatus && (gardenStatus.teams || []).find((t) => t.id === lock.team);
  if (!team) {
    recordNote('⚠️ Your harvest team isn\'t in your game any more: pick another in the Garden tab.');
    return;
  }
  if (teamIsOut(team, gardenStatus.pets)) return;
  const before = petIdsOut();
  lock.teamBefore = before.length ? before : null;
  lock.teamSwapped = team.id;
  applyTeam(team.id, '(Harvesting unlocked)').then((r) => {
    if (r && r.ok) return;
    const l = harvestLock();
    if (l.teamSwapped === team.id) {
      l.teamBefore = null;
      l.teamSwapped = null;
      store.save();
    }
    recordNote(`⚠️ Couldn't put out ${team.name}: ${(r && r.reason) || 'the game page didn\'t answer'}`);
  }).catch(() => {});
}
function harvestTeamBack(lock) {
  const before = lock.teamBefore;
  const swapped = lock.teamSwapped;
  lock.teamBefore = null;
  lock.teamSwapped = null;
  if (lock.teamBack === false || !before || !before.length || !swapped) return;
  // Only if the harvest team is still what's out: pets you changed since stay.
  const team = gardenStatus && (gardenStatus.teams || []).find((t) => t.id === swapped);
  if (!team || !teamIsOut(team, gardenStatus.pets)) return;
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed() || parked) return;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.putOut ? window.__mgLoaderObserver.putOut(${JSON.stringify(before)}) : null`, true).then((r) => {
    if (r && r.ok && !r.already) recordNote(`🐾 Back to ${r.team} (Harvesting locked again)`);
    else if (r && !r.ok) recordNote(`⚠️ Couldn't put your pets back: ${r.reason}`);
  }).catch(() => {});
}

ipcMain.handle('harvest:get', () => harvestLock());
ipcMain.handle('harvest:set', (event, change) => setHarvestLock(change));

/* ------------------------------------------------------------------ *
 * Seed deleter: throws unwanted seeds into the wishing well, the same
 * command the game sends when you do it by hand, one seed at a time.
 * After each seed it waits to see the count in your inventory go down
 * before sending the next, and stops at the first sign of trouble. Only
 * seeds in the inventory (never the Seed Silo). Only ever runs when you
 * press Delete, and never more than you asked for.
 * ------------------------------------------------------------------ */

const SEED_GAP_MS = 350;
let seedRun = null;

function sendSeedRun() {
  sendToControl('seeds:run', seedRun && {
    species: seedRun.species, target: seedRun.target, done: seedRun.done,
    running: seedRun.running, error: seedRun.error, stopped: seedRun.stopped,
  });
}

async function runSeedDelete(species, count) {
  const contents = gameView && gameView.webContents;
  const page = (js) => contents.executeJavaScript(js, true);
  const q = JSON.stringify(String(species));
  seedRun = { species, target: count, done: 0, running: true, error: null, stopped: false, cancel: false, rejected: null };
  sendSeedRun();
  try {
    for (let i = 0; i < count; i += 1) {
      if (seedRun.cancel) {
        seedRun.stopped = true;
        break;
      }
      if (!contents || contents.isDestroyed() || !isGameUrl(contents.getURL()) || parked) throw new Error('the game closed');
      const before = await page(`window.__mgLoaderObserver ? window.__mgLoaderObserver.seedCount(${q}) : -1`);
      if (before < 0) throw new Error("can't see the game");
      if (before === 0) break;
      const r = await page(`window.__mgLoaderObserver.wishSeed(${q})`);
      if (!r || !r.ok) throw new Error((r && r.reason) || 'the game page didn\'t answer');
      // Wait for the game to confirm (the seed count drops).
      let after = before;
      for (let t = 0; t < 30 && after >= before; t += 1) {
        await new Promise((res) => setTimeout(res, 100));
        if (seedRun.rejected) throw new Error(`the game refused it (${seedRun.rejected})`);
        after = await page(`window.__mgLoaderObserver.seedCount(${q})`);
      }
      if (after >= before) throw new Error("the game didn't take the seed");
      seedRun.done += 1;
      sendSeedRun();
      await new Promise((res) => setTimeout(res, SEED_GAP_MS));
    }
  } catch (err) {
    seedRun.error = String((err && err.message) || err);
  }
  seedRun.running = false;
  sendSeedRun();
  if (seedRun.done) {
    const name = cropData.lookup(species) ? cropData.lookup(species).name : String(species).replace(/([a-z])([A-Z])/g, '$1 $2');
    recordNote(`🗑️ Threw ${seedRun.done} ${name} seed${seedRun.done === 1 ? '' : 's'} into the wishing well${seedRun.error ? ` (stopped: ${seedRun.error})` : seedRun.stopped ? ' (you stopped it)' : ''}`);
  }
}

ipcMain.handle('seeds:delete', (event, species, count) => {
  if (seedRun && seedRun.running) return { ok: false, reason: 'Already deleting.' };
  const have = (gardenStatus && gardenStatus.seeds && gardenStatus.seeds.inventory && gardenStatus.seeds.inventory[species]) || 0;
  const n = Math.floor(Number(count) || 0);
  if (!species || n < 1) return { ok: false, reason: 'Pick a seed and how many.' };
  if (n > have) return { ok: false, reason: `You only have ${have} in your inventory.` };
  runSeedDelete(String(species), n);
  return { ok: true };
});

ipcMain.handle('seeds:stop', () => {
  if (seedRun && seedRun.running) seedRun.cancel = true;
  return true;
});

/* ------------------------------------------------------------------ *
 * Updates (updater.js). Checks GitHub at startup and every 6 hours (if
 * automatic checks are on) or when asked; never installs without the player
 * pressing Update now.
 * ------------------------------------------------------------------ */

const UPDATE_EVERY = 6 * 60 * 60 * 1000;
const upd = { checking: false, info: null, error: null, downloading: false, progress: 0, total: 0, ready: null, checkedAt: 0 };

function updateSettings() {
  const s = store.get();
  s.updates = Object.assign({ auto: true, notified: null }, s.updates);
  return s.updates;
}

function sendUpdate() {
  sendToControl('update:state', updateView());
}

function updateView() {
  return {
    current: app.getVersion(),
    platform: process.platform,
    auto: updateSettings().auto,
    checking: upd.checking,
    info: upd.info,
    error: upd.error,
    downloading: upd.downloading,
    progress: upd.progress,
    total: upd.total,
    ready: upd.ready,
    checkedAt: upd.checkedAt,
  };
}

async function checkForUpdate(byHand) {
  if (upd.checking || upd.downloading) return updateView();
  upd.checking = true;
  upd.error = null;
  sendUpdate();
  try {
    upd.info = await updater.check({ currentVersion: app.getVersion(), platform: process.platform });
    upd.checkedAt = Date.now();
    const cfg = updateSettings();
    if (upd.info.available && cfg.notified !== upd.info.latest) {
      cfg.notified = upd.info.latest;
      store.save();
      recordNote(`✨ Version ${upd.info.display} is out: Extras → Updates`, byHand ? null : `SSK's Garden Buddy ${upd.info.display} is out`);
    }
  } catch (err) {
    upd.error = byHand ? `Couldn't check for updates (${String((err && err.message) || err).slice(0, 80)}).` : null;
  }
  upd.checking = false;
  sendUpdate();
  return updateView();
}

async function installUpdate() {
  const info = upd.info;
  if (!info || !info.available) return { ok: false, reason: 'No update to install.' };
  if (!info.asset) {
    // No download for this system in the release: send them to the page.
    shell.openExternal(updater.PAGE_URL);
    return { ok: true, openedPage: true };
  }
  if (upd.downloading) return { ok: false, reason: 'Already downloading.' };
  upd.downloading = true;
  upd.error = null;
  upd.progress = 0;
  upd.total = info.asset.size || 0;
  sendUpdate();
  const dir = process.platform === 'darwin' ? app.getPath('downloads') : app.getPath('temp');
  const dest = path.join(dir, info.asset.name);
  try {
    await updater.download({
      asset: info.asset,
      dest,
      onProgress: (got, total) => {
        upd.progress = got;
        upd.total = total;
        sendUpdate();
      },
    });
  } catch (err) {
    upd.downloading = false;
    upd.error = String((err && err.message) || err).slice(0, 160);
    sendUpdate();
    return { ok: false, reason: upd.error };
  }
  upd.downloading = false;
  upd.ready = { path: dest, platform: process.platform };
  // Remembered so it can be removed once the update has gone through.
  updateSettings().pending = { path: dest, from: app.getVersion(), at: Date.now() };
  store.save();
  sendUpdate();
  if (process.env.MG_TEST_UPDATE_NOINSTALL) return { ok: true, ready: dest };
  if (process.platform === 'win32' || process.env.MG_TEST_UPDATE_SPAWN) {
    // The installer replaces the app and opens it again; this copy steps
    // aside first. Settings live in their own folder and stay.
    recordNote(`✨ Installing version ${info.display}…`);
    // The same flags electron-updater gives the installer: --updated makes it
    // close this app quietly if it's still running (otherwise it can ask "is
    // running, click OK to close" when it starts faster than we quit), and
    // --force-run opens the new version when it's done.
    const args = ['--updated', '--force-run'];
    if (process.env.MG_TEST_UPDATE_SPAWN) {
      fs.writeFileSync(process.env.MG_TEST_UPDATE_SPAWN, JSON.stringify({ file: dest, args }));
      return { ok: true, installing: true, test: true };
    }
    try {
      spawn(dest, args, { detached: true, stdio: 'ignore' }).unref();
    } catch (err) {
      upd.error = `Couldn't start the installer (${String(err.message || err).slice(0, 80)}). It's saved at ${dest}.`;
      sendUpdate();
      return { ok: false, reason: upd.error };
    }
    setTimeout(() => {
      quitting = true;
      app.quit();
    }, 600);
    return { ok: true, installing: true };
  }
  if (process.platform === 'darwin') {
    // Without a paid Apple certificate an app can't replace itself, so the
    // new version opens for the player to drag into Applications.
    shell.openPath(dest);
    return { ok: true, openedDmg: true };
  }
  shell.showItemInFolder(dest);
  return { ok: true };
}

// After an update: remove the installer the app downloaded, once it's clear
// the update went through (this copy is newer than the one that downloaded
// it). An update that didn't finish keeps its file for a retry, for a week.
async function cleanUpAfterUpdate() {
  const cfg = updateSettings();
  const p = cfg.pending;
  if (!p || !p.path) return;
  const done = updater.compareVersions(app.getVersion(), p.from) > 0;
  const stale = Date.now() - (p.at || 0) > 7 * 24 * 3600 * 1000;
  if (!done && !stale) return;
  try {
    if (fs.existsSync(p.path)) {
      // In Downloads (Mac): to the Trash. In the temp folder: just remove it.
      if (path.dirname(p.path) === app.getPath('downloads')) await shell.trashItem(p.path).catch(() => fs.rmSync(p.path, { force: true }));
      else fs.rmSync(p.path, { force: true });
    }
  } catch (err) {
    /* try again next start */
    return;
  }
  delete cfg.pending;
  store.save();
}

// Installers downloaded from the website that are still sitting in
// Downloads (browsers number repeats: "... (1).exe"). Only ever offered;
// moved to the Recycle Bin / Trash when the player says so.
const OLD_INSTALLER = /^SSKs-Garden-Buddy-(Windows|Mac|Setup-[\d.]+|[\d.]+-(arm64|x64))( \(\d+\))?\.(exe|dmg)$/i;
function oldInstallers() {
  let dir;
  try {
    dir = app.getPath('downloads');
  } catch (err) {
    return [];
  }
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return [];
  }
  const keep = upd.ready && upd.ready.path;
  const out = [];
  for (const name of names) {
    if (!OLD_INSTALLER.test(name)) continue;
    const full = path.join(dir, name);
    if (full === keep) continue;
    try {
      const st = fs.statSync(full);
      if (st.isFile()) out.push({ name, path: full, size: st.size });
    } catch (err) {
      /* skip */
    }
  }
  return out;
}

ipcMain.handle('update:oldInstallers', () => {
  const list = oldInstallers();
  return { count: list.length, bytes: list.reduce((a, f) => a + f.size, 0), names: list.map((f) => f.name) };
});
ipcMain.handle('update:tidy', async () => {
  let moved = 0;
  let bytes = 0;
  for (const f of oldInstallers()) {
    try {
      await shell.trashItem(f.path);
      moved += 1;
      bytes += f.size;
    } catch (err) {
      /* leave it */
    }
  }
  return { moved, bytes };
});

ipcMain.handle('update:get', () => updateView());
ipcMain.handle('update:check', () => checkForUpdate(true));
ipcMain.handle('update:install', () => installUpdate());
ipcMain.handle('update:auto', (event, on) => {
  updateSettings().auto = Boolean(on);
  store.save();
  sendUpdate();
  return updateView();
});

/* ------------------------------------------------------------------ *
 * Backups (backup.js)
 * ------------------------------------------------------------------ */

function backupsDir() {
  return path.join(app.getPath('userData'), 'backups');
}

function makeBackup() {
  return backup.make({
    settings: store.get(),
    scriptsDir: scriptsDir(),
    scriptsConfig: readScriptsConfig(),
    version: app.getVersion(),
  });
}

function backupWindow() {
  const s = store.get().ui;
  return s.panel === 'window' && panelWindow && !panelWindow.isDestroyed() ? panelWindow : gameWindow;
}

// testPath skips the file dialogs; only honoured when the test harness asks.
ipcMain.handle('backup:save', async (event, testPath) => {
  let file = process.env.MG_TEST_DIALOGS && testPath ? testPath : null;
  if (!file) {
    const d = new Date();
    const name = `Magic Garden backup ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    const r = await dialog.showSaveDialog(backupWindow(), {
      title: 'Save a backup',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'Backup', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    file = r.filePath;
  }
  try {
    fs.writeFileSync(file, JSON.stringify(makeBackup(), null, 1), 'utf8');
    return { ok: true, file };
  } catch (err) {
    return { ok: false, reason: String(err.message || err) };
  }
});

ipcMain.handle('backup:restore', async (event, testPath) => {
  let file = process.env.MG_TEST_DIALOGS && testPath ? testPath : null;
  if (!file) {
    const r = await dialog.showOpenDialog(backupWindow(), {
      title: 'Restore a backup',
      defaultPath: app.getPath('documents'),
      filters: [{ name: 'Backup', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    file = r.filePaths[0];
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, reason: "That file couldn't be read." };
  }
  const c = backup.check(data);
  if (!c.ok) return c;
  if (!process.env.MG_TEST_DIALOGS) {
    const when = c.summary.savedAt ? new Date(c.summary.savedAt).toLocaleString() : 'an unknown date';
    const answer = await dialog.showMessageBox(backupWindow(), {
      type: 'question',
      buttons: ['Restore', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Replace everything with this backup?',
      detail: `Saved ${when}: ${c.summary.hatches.toLocaleString()} hatches tracked, ${c.summary.counters} egg counters, ${c.summary.rooms} saved rooms, ${c.summary.scripts} scripts.\n\nYour current settings are saved to the backups folder first, just in case.`,
    });
    if (answer.response !== 0) return { ok: false, canceled: true };
  }
  // A copy of what's being replaced, just in case.
  try {
    fs.mkdirSync(backupsDir(), { recursive: true });
    fs.writeFileSync(path.join(backupsDir(), `before-restore-${Date.now()}.json`), JSON.stringify(makeBackup(), null, 1), 'utf8');
  } catch (err) {
    /* carry on */
  }
  const keepUi = store.get().ui;
  const next = JSON.parse(JSON.stringify(data.settings));
  // Where the panel sits is about this computer, not the backup.
  next.ui = Object.assign({}, next.ui, { panel: keepUi.panel, panelOpen: keepUi.panelOpen, panelWidth: keepUi.panelWidth, panelSize: keepUi.panelSize });
  store.set(next);
  pityState();
  store.save();
  backup.restoreScripts(data, scriptsDir());
  if (data.scriptsConfig && typeof data.scriptsConfig === 'object') writeScriptsConfig(data.scriptsConfig);
  // Show the restored settings: reload the panel (a second or two of quiet).
  if (panelView && !panelView.webContents.isDestroyed()) setTimeout(() => panelView.webContents.reload(), 300);
  recordNote('💾 Restored a backup');
  return { ok: true, summary: c.summary };
});

// Just-for-fun effects (fun.js): only on this screen, nothing sent to the game.
ipcMain.handle('fun:play', async (event, name) => {
  const js = fun.script(String(name));
  const contents = gameView && gameView.webContents;
  if (!js || !contents || contents.isDestroyed() || !isGameUrl(contents.getURL())) return { ok: false };
  try {
    const result = await contents.executeJavaScript(js, true);
    return { ok: true, result };
  } catch (err) {
    return { ok: false };
  }
});

ipcMain.handle('backup:folder', () => {
  fs.mkdirSync(backupsDir(), { recursive: true });
  shell.openPath(backupsDir());
  return true;
});

// Rooms other players have shared (see rooms.js), fetched at most once a
// minute. Off if the owner switches "Show rooms other players share" off.
let sharedCache = { at: 0, list: [], error: null };
async function sharedRooms() {
  const s = store.get();
  if (s.rooms && s.rooms.showShared === false) return { list: [], error: null, off: true };
  if (Date.now() - sharedCache.at < 60000) return sharedCache;
  try {
    const res = await fetch(roomsMod.COMMUNITY_URL, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    sharedCache = { at: Date.now(), list: roomsMod.parseCommunity(rows), stats: roomsMod.communityStats(rows), error: null };
  } catch (err) {
    sharedCache = { at: Date.now(), list: sharedCache.list, error: String((err && err.message) || err).slice(0, 80) };
  }
  return sharedCache;
}

ipcMain.handle('rooms:refresh', async () => {
  const here = gardenStatus && gardenStatus.room && gardenStatus.room.roomId;
  const saved = savedRooms();
  const shared = await sharedRooms();
  const savedIds = new Set(saved.map((r) => r.id));
  // The most promising 20 (most players, a seat free), re-checked with the
  // game's own count.
  const candidates = shared.list
    .filter((r) => r.id !== here && !savedIds.has(r.id))
    .sort((a, b) => (b.reported < 6) - (a.reported < 6) || b.reported - a.reported)
    .slice(0, 20);
  const results = await rooms().refresh([...(here ? [here] : []), ...saved.map((r) => r.id), ...candidates.map((r) => r.id)]);
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  // The room you're in doubles as a check that lookups work: the game says
  // how many players are here, and the endpoint should agree.
  let check = null;
  if (here && byId[here]) {
    const mine = byId[here];
    const inState = gardenStatus.room.players;
    const how = mine.status ? ` (HTTP ${mine.status}${mine.closed ? ', which the app reads as "closed"' : ''}${mine.path ? ', ' + mine.path : ''})` : '';
    if (mine.players == null) check = { ok: false, text: `Player-count lookups aren't working (${mine.error || 'no answer'}${mine.status ? `, HTTP ${mine.status}` : ''}).`, sample: mine.sample, path: mine.path };
    else if (Math.abs(mine.players - inState) <= 1) check = { ok: true, text: 'Player-count lookups are working.', path: mine.path };
    else check = { ok: false, text: `The lookup says ${mine.players} players here${how}, the game says ${inState}.`, sample: mine.sample, path: mine.path };
    // Whatever the lookup says, the game knows how many people are in the
    // room you're in: show that.
    byId[here] = { players: Math.max(0, Math.min(6, Number(inState) || 0)), closed: false, fromGame: true, status: mine.status };
  }
  lastRoomCheck = check;
  // When the lookup can't answer (the endpoint is gone) or is known to be
  // wrong (it said 0 for the room you're standing in), a 0 for another room
  // means nothing: show it as unknown rather than empty, and where the
  // community list has a count for that room (rooms shared through Arie's
  // mod report their own numbers), use that.
  // Broken if it disagreed with the game about the room you're in (then
  // it stays so for the session), or if every path has proven dead: either
  // way, counts come from the community list, in a room or not.
  if (check && !check.ok) lookupKnownBroken = true;
  const lookupBroken = lookupKnownBroken || rooms().lookupDead();
  const community = Object.fromEntries(shared.list.map((r) => [r.id, r]));
  for (const id of Object.keys(byId)) {
    if (id === here) continue;
    const r = byId[id];
    const c = community[id];
    if ((r.players == null || (lookupBroken && r.players === 0)) && c && c.reported > 0) {
      byId[id] = Object.assign({}, r, { players: c.reported, closed: false, viaCommunity: true, error: null, full: c.reported >= 6, bonusIfJoined: roomsMod.bonusIfJoined(c.reported) });
    } else if (lookupBroken && r.players === 0) {
      byId[id] = Object.assign({}, r, { players: null, closed: false, error: 'the game\'s count lookup is not answering', full: false, bonusIfJoined: null });
    }
  }
  return {
    current: (gardenStatus && gardenStatus.room) || null,
    saved: saved.map((r) => Object.assign({}, r, roomsMod.describeId(r.id), byId[r.id] || {})),
    shared: candidates
      .map((r) => Object.assign({ name: roomsMod.describeId(r.id).label, names: r.names, reported: r.reported, updatedAt: r.updatedAt }, byId[r.id] || {}, { id: r.id }))
      // Only rooms the game confirms still have people in them.
      .filter((r) => r.players != null && r.players > 0),
    sharedError: shared.error,
    lookupBroken,
    sharedOff: Boolean(shared.off),
    sharedTotal: shared.list.length,
    sharedStats: shared.stats || null,
    sharedChecked: candidates.length,
    check,
    at: Date.now(),
  };
});

let lastRoomCheck = null;
let lookupKnownBroken = false;

ipcMain.handle('rooms:save', (event, id, name) => {
  const roomId = String(id || '').trim().slice(0, 120);
  if (!roomId) return savedRooms();
  const list = savedRooms();
  const existing = list.find((r) => r.id === roomId);
  const label = String(name || '').trim().slice(0, 40) || roomsMod.describeId(roomId).label;
  if (existing) existing.name = label;
  else list.push({ id: roomId, name: label, addedAt: Date.now() });
  store.save();
  return list;
});

// Copied a room code (in Discord, say)? When the app comes to the front,
// look at the clipboard once: if it holds a room link or code, offer to
// join or save it. Nothing else on the clipboard is looked at or kept.
let lastClipboardRoom = null;
function roomFromText(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 300) return null;
  let m = /magicgarden\.gg\/r\/([A-Za-z0-9-]{2,120})/i.exec(t);
  if (m) return m[1];
  m = /^(i-\d{8,}-gc-\d{8,}-\d{8,})$/.exec(t);
  if (m) return m[1];
  m = /^([A-Z0-9]{4})$/.exec(t);
  if (m && /[A-Z]/.test(m[1])) return m[1];
  return null;
}

function checkClipboardRoom() {
  const s = store.get();
  if (s.rooms && s.rooms.clipboard === false) return;
  let text = '';
  try {
    text = clipboard.readText();
  } catch (err) {
    return;
  }
  const id = roomFromText(text);
  if (!id || id === lastClipboardRoom) return;
  lastClipboardRoom = id;
  const here = gardenStatus && gardenStatus.room && gardenStatus.room.roomId;
  if (id === here) return;
  const saved = savedRooms().some((r) => r.id === id);
  sendToControl('rooms:clipboard', { id, saved });
}

ipcMain.handle('rooms:checkClipboard', () => {
  lastClipboardRoom = null;
  checkClipboardRoom();
  return true;
});

/* Sharing your room on the community list (share.js), opt-in. What it
 * reads from the game: your id and name, your coins, the room you're in
 * and how many are in it. */
let sharer = null;
function shareSnapshot() {
  const st = gardenStatus || {};
  const me = st.self || {};
  const room = st.room || {};
  return {
    playerId: me.id || null,
    playerName: me.name || null,
    coins: st.wallet && Number.isFinite(Number(st.wallet.coins)) ? Number(st.wallet.coins) : undefined,
    roomId: st.connected && room.roomId ? room.roomId : null,
    playersCount: Number.isFinite(Number(room.players)) ? Number(room.players) : undefined,
    isPrivate: false,
  };
}
function shareOn() {
  const s = store.get();
  return Boolean(s.rooms && s.rooms.share);
}
function ensureSharer() {
  if (sharer) return sharer;
  sharer = share.createSharer({
    getSnapshot: shareSnapshot,
    version: app.getVersion(),
    onEvent: (e) => {
      if (e.kind === 'stopped') {
        const s = store.get();
        s.rooms = Object.assign({ saved: [] }, s.rooms, { share: false });
        store.save();
        recordNote(`🎮 Room sharing stopped: the community list refused this account (${e.error}). If you also use Arie's mod, it reports your room itself.`, 'Room sharing stopped');
      }
      sendToControl('rooms:share', sharer.status());
    },
  });
  return sharer;
}
function applyShareSetting() {
  const sh = ensureSharer();
  if (shareOn()) sh.start().catch(() => {});
  else sh.stop('off').catch(() => {});
}
ipcMain.handle('rooms:shareSetting', (event, on) => {
  const s = store.get();
  s.rooms = Object.assign({ saved: [] }, s.rooms, { share: Boolean(on) });
  store.save();
  applyShareSetting();
  return { share: Boolean(on), status: ensureSharer().status() };
});
ipcMain.handle('rooms:shareStatus', () => ensureSharer().status());

// "Share your room with the public?" on launch: false = don't ask again.
ipcMain.handle('rooms:askShare', (event, ask) => {
  const s = store.get();
  s.rooms = Object.assign({ saved: [] }, s.rooms, { askShare: Boolean(ask) });
  store.save();
  return s.rooms.askShare;
});

ipcMain.handle('rooms:clipboardSetting', (event, on) => {
  const s = store.get();
  s.rooms = Object.assign({ saved: [] }, s.rooms, { clipboard: Boolean(on) });
  store.save();
  return s.rooms.clipboard;
});

ipcMain.handle('rooms:showShared', (event, on) => {
  const s = store.get();
  s.rooms = Object.assign({ saved: [] }, s.rooms, { showShared: Boolean(on) });
  sharedCache.at = 0;
  store.save();
  return s.rooms.showShared;
});

ipcMain.handle('rooms:remove', (event, id) => {
  const s = store.get();
  s.rooms.saved = savedRooms().filter((r) => r.id !== String(id));
  store.save();
  return s.rooms.saved;
});

ipcMain.handle('rooms:join', (event, id) => {
  const roomId = String(id || '').trim();
  if (!roomId || !gameView) return false;
  if (parked) {
    parked = null;
    clearTimeout(rejoinTimer);
    sendParked();
  }
  lastTeamKey = null;
  recordNote(`🎮 Joined room ${roomId.length > 20 ? roomId.slice(0, 12) + '…' : roomId}`);
  gameView.webContents.loadURL(roomsMod.joinUrl(roomId));
  return true;
});

ipcMain.handle('garden:reset', (event, key) => {
  const g = store.get().garden;
  if (key && g.pets[key]) {
    g.totals.gold = Math.max(0, g.totals.gold - (g.pets[key].gold || 0));
    g.totals.rainbow = Math.max(0, g.totals.rainbow - (g.pets[key].rainbow || 0));
    g.totals.coins = Math.max(0, (g.totals.coins || 0) - (g.pets[key].coins || 0));
    delete g.pets[key];
  } else if (!key) {
    g.pets = {};
    g.totals = { gold: 0, rainbow: 0, coins: 0 };
    g.since = null;
  }
  store.save();
  return g;
});

ipcMain.handle('garden:sample', async () => {
  if (!gameWindow) return { ok: false, reason: 'The game window is closed.' };
  try {
    const sample = await gameView.webContents.executeJavaScript(
      'window.__mgLoaderObserver ? window.__mgLoaderObserver.sample() : null',
      true
    );
    const file = path.join(app.getPath('userData'), 'garden-sample.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ appVersion: app.getVersion(), perf: perfView(), forecastLog: forecastLog.slice(-120), observerLoaded: Boolean(sample), roomLookup: lastRoomCheck, alerts: watcher ? watcher.diagnostics() : null, errors: ERROR_LOG.slice(), saleChecks: (store.get().saleChecks || []).slice(-10), keys: (() => {
        // The action bar, bag keys and the potted-plant command (v0.57.2).
        const ui = store.get().ui || {};
        return { bar: actionBarCfg(), bagKeys: bagKeysCfg(), potCommand: ui.potCommand || '(built in: PlantGardenPlant)', appKeys: ui.appKeys || {} };
      })(), hatchCounters: (() => {
        // The hatch trackers (v0.56.11), so a paper tally can be checked
        // against them: each counter, the audit, and the recent hatches.
        const p = pityState();
        const l = luckState();
        return { audit: luck.audit(l), luck: l.counters, pity: { totalHatches: p.totalHatches, lastEggsHatched: p.lastEggsHatched, gameBase: p.gameBase, trackedBase: p.trackedBase, autoCount: p.autoCount, byEgg: p.byEgg, counters: p.counters, recent: (p.recent || []).slice(-60) } };
      })(), alertLog: alertDiagnostics(), maps: (() => { const u = store.get().ui || {}; return { spotMap: u.spotMap, binderMap: u.binderMap, thunderMap: u.thunderMap, mountMap: u.mountMap, alwaysMap: u.alwaysMap, gardenMap: u.gardenMap, mapPos: u.mapPos }; })(), lastStatus: gardenStatus, sample }, null, 2),
      'utf8'
    );
    shell.showItemInFolder(file);
    return { ok: true, file };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  }
});

ipcMain.handle('tts:supported', () => tts.supported());
ipcMain.handle('tts:warm', () => {
  tts.warm();
  return tts.status();
});
ipcMain.handle('tts:synthesize', async (event, req) => new Uint8Array(await tts.synthesize(req)));

ipcMain.handle('voices:list', () => voices.list());
ipcMain.handle('voices:download', async (event, id) => {
  await voices.download(String(id), (phase, received, total) => {
    sendToControl('voices:progress', { id, phase, received, total });
  });
  return voices.list();
});
ipcMain.handle('voices:remove', (event, id) => {
  voices.remove(String(id));
  return voices.list();
});
ipcMain.handle('voices:warm', (event, id, pace) => voices.warm(String(id || ''), String(pace || '')));
ipcMain.handle('voices:synthesize', async (event, id, text, pace) =>
  new Uint8Array(await voices.synthesize(String(id), String(text), String(pace || ''))));

// Quiets the game's own sound while an alert is speaking, so the voice
// doesn't have to compete with the music. The panel turns it on at the start
// of an alert and off at the end; a safety timer turns it off regardless.
let duckTimer = null;
ipcMain.handle('game:duck', (event, on) => {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return false;
  clearTimeout(duckTimer);
  contents.setAudioMuted(Boolean(on));
  if (on) duckTimer = setTimeout(() => {
    if (!contents.isDestroyed()) contents.setAudioMuted(false);
  }, 60000);
  return true;
});

ipcMain.handle('scripts:list', () => listScripts());
ipcMain.handle('scripts:toggle', (event, name, enabled) => {
  setScriptEnabled(name, enabled);
  return listScripts();
});
ipcMain.handle('scripts:run', () => (gameWindow ? injectScripts(gameView.webContents) : []));
ipcMain.handle('scripts:openFolder', () => shell.openPath(scriptsDir()));

ipcMain.handle('game:reload', () => gameWindow && gameView.webContents.reload());
ipcMain.handle('game:devtools', () => gameWindow && gameView.webContents.toggleDevTools());
ipcMain.handle('game:focus', () => focusGame());

// After a click in the panel, keys go back to the game (so Space harvests
// instead of pressing the last button clicked). Only the keyboard moves: a
// minimized game stays minimized.
ipcMain.handle('game:keys', () => {
  if (!gameWindow || gameWindow.isDestroyed() || gameWindow.isMinimized()) return false;
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return false;
  // In its own window the panel has the window focus, so the game's window
  // has to take it back; attached, the game is already in the focused window.
  if (store.get().ui.panel === 'window' || !gameWindow.isFocused()) gameWindow.focus();
  contents.focus();
  return true;
});

/* ================================================================== *
 * Lifecycle
 * ================================================================== */

// The app was called "Magic Garden Loader" before v0.22. Electron keeps
// each app's data in a folder named after it, so on the first start under
// the new name, move the old folder over (settings, egg counts, backups,
// voices, and the game login). Must happen before anything uses the folder.
function moveOldDataFolder() {
  try {
    const now = app.getPath('userData');
    const old = path.join(app.getPath('appData'), 'Magic Garden Loader');
    if (path.resolve(now) === path.resolve(old)) return;
    if (!fs.existsSync(path.join(old, 'settings.json'))) return;
    if (fs.existsSync(path.join(now, 'settings.json'))) return;
    if (!fs.existsSync(now)) {
      fs.renameSync(old, now);
    } else {
      fs.cpSync(old, now, { recursive: true, force: false, errorOnExist: false });
    }
  } catch (err) {
    /* start fresh rather than not start */
  }
}
moveOldDataFolder();

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', focusGame);

  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  app.on('before-quit', () => {
    quitting = true;
    tts.stop();
    voices.stop();
    if (sharer) sharer.stop('quit').catch(() => {});
    // Saves are written in the background; whatever is pending lands now.
    store.flush();
  });
  app.on('will-quit', () => store.flush());

  app.whenReady().then(() => {
    store.init(app.getPath('userData'));
    store.onWrite(perfWrite);
    voices.init(app.getPath('userData'));
    try {
      watchPresence();
    } catch (err) {
      logError('presence', err);
    }
    setInterval(() => {
      try {
        checkQuestReminder();
      } catch (err) {
        logError('quest reminder', err);
      }
    }, 60000);
    // The v0.50 voice lineup: remove downloads of voices that were retired,
    // and move anyone using one of them to the closest new voice that's
    // downloaded (the old effect voices were Leah underneath, so they move
    // straight over). With none downloaded, alerts use the computer's voice
    // until one is; the Alerts tab says so once.
    try {
      voices.pruneUnused();
      const st = store.get();
      const ids = voices.CATALOG.map((v) => v.id);
      if (st.alerts.naturalVoice && !ids.includes(st.alerts.naturalVoice)) {
        const { to, use } = voices.replacementFor(st.alerts.naturalVoice);
        st.alerts.retiredVoice = st.alerts.naturalVoice;
        st.alerts.retiredTo = use || to;
        st.alerts.naturalVoice = use || '';
        if (!use && st.alerts.voiceEngine === 'natural') st.alerts.voiceEngine = 'system';
        store.save();
      }
    } catch (err) {
      /* not worth stopping for */
    }

    // Pet counts from before v0.6.0 could include a gold pet eating a gold
    // crop from the trough. Start them fresh, once.
    const st = store.get();
    if ((st.gardenCountsVersion || 0) < 2) {
      st.garden.pets = {};
      st.garden.totals = { gold: 0, rainbow: 0, coins: 0 };
      st.garden.since = null;
      st.gardenCountsVersion = 2;
      store.save();
    }
    seedScripts();
    migrateSettings();
    try {
      recoverTypedLuck();
    } catch (err) {
      /* the counts stay as they are */
    }
    try {
      backup.autoBackup(backupsDir(), makeBackup);
    } catch (err) {
      /* not worth stopping for */
    }
    loadCatalogCache();
    // "Updated to 0.22.1" once, after an update.
    {
      const st = store.get();
      if (st.lastRunVersion && updater.compareVersions(app.getVersion(), st.lastRunVersion) > 0) {
        setTimeout(() => recordNote(`🎉 Updated to version ${app.getVersion()}`), 4000);
      }
      st.lastRunVersion = app.getVersion();
      store.save();
    }
    // The settings file was damaged and replaced at startup: say so.
    {
      const r = store.recovered();
      if (r) {
        setTimeout(() => recordNote(r.recoveredFrom
          ? `💾 The settings file was damaged, so the newest backup (${r.recoveredFrom}) was put back. The damaged file is kept as ${r.broken}.`
          : `💾 The settings file was damaged and no backup was found, so the app started fresh. The damaged file is kept as ${r.broken}.`,
        'Settings restored from a backup'), 5000);
      }
    }
    // Remove the installer from an update that has gone through.
    setTimeout(() => cleanUpAfterUpdate(), 8000);
    if (shareOn()) setTimeout(applyShareSetting, 10000);
    // Look for updates a little after starting, then every 6 hours.
    setTimeout(() => { if (updateSettings().auto) checkForUpdate(false); }, 20000);
    setInterval(() => { if (updateSettings().auto) checkForUpdate(false); }, UPDATE_EVERY);
    buildMenu();
    createGameWindow();
    createPanel();

    const settings = store.get();
    if (!settings.firstRunDone) {
      settings.firstRunDone = true;
      // A brand-new install (nothing saved before): its own defaults.
      if (!(settings.alertHistory || []).length && !(settings.moneyHistory || []).length && !(settings.ui && settings.ui.welcomed)) freshInstallDefaults(settings);
      store.save();
    }

    watcher = alerts.createWatcher({
      getSettings: store.get,
      onAlerts: handleAlerts,
      onData: onShopFeed,
      onStatus: (status) => {
        const st = feedStatus(status);
        lastThemeSig = JSON.stringify([st.theme, st.night && st.night.on]);
        sendToControl('alerts:status', st);
        planLogoff(status);
      },
    });
    watcher.start();
    // The theme and night change with the clock (v0.67.0): the panel hears
    // straight away, not only at the next shop check.
    setInterval(() => {
      if (!watcher) return;
      const st = feedStatus(watcher.status());
      pushTheme();
      const sig = JSON.stringify([st.theme, st.night && st.night.on]);
      if (sig === lastThemeSig) return;
      lastThemeSig = sig;
      sendToControl('alerts:status', st);
    }, 20000);

    powerSaveId = powerSaveBlocker.start('prevent-app-suspension');

    app.on('activate', () => {
      if (gameWindow) focusGame();
    });
  });

  app.on('window-all-closed', () => {
    if (watcher) watcher.stop();
    if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
      powerSaveBlocker.stop(powerSaveId);
    }
    app.quit();
  });
}
