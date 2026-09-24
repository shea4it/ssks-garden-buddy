'use strict';

const {
  app,
  BaseWindow,
  WebContentsView,
  ipcMain,
  Menu,
  shell,
  powerSaveBlocker,
  Notification,
  session,
  dialog,
  clipboard,
} = require('electron');
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
const weather = require('./weather');
const gameData = require('./game-data');
const pity = require('./pity');
const roomsMod = require('./rooms');
const backup = require('./backup');
const updater = require('./updater');
const { spawn } = require('child_process');
const fun = require('./fun');
const luck = require('./luck');

const GAME_URL = 'https://magicgarden.gg';
const GAME_HOST = 'magicgarden.gg';
const APP_ID = 'gg.local.magicgardenloader';

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

// A line in Recent alerts that isn't an alert: a team swap, a log-off.
function recordNote(text, toastTitle) {
  const settings = store.get();
  settings.alertHistory.push({ at: Date.now(), text, note: true });
  settings.alertHistory = settings.alertHistory.slice(-50);
  store.save();
  sendToControl('alerts:history', settings.alertHistory);
  if (toastTitle && settings.alerts.popups && !isSnoozed(settings) && Notification.isSupported()) {
    const toast = new Notification({ title: toastTitle, body: text, silent: true });
    toast.on('click', focusGame);
    toast.show();
  }
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

function handleAlerts(list) {
  const settings = store.get();
  const loud = list.filter((a) => !quietFor(settings, a.ruleId));
  const hushed = list.filter((a) => quietFor(settings, a.ruleId));
  if (hushed.length) recordAlerts(hushed, true);
  if (loud.length) recordAlerts(loud, false);

  if (loud.length) sendToControl('alerts:play', loud);

  const popups = list.filter((a) => !isSnoozed(settings) || isAlways(settings, a.ruleId));
  if (settings.alerts.popups && popups.length && Notification.isSupported()) {
    for (const a of popups.slice(0, 3)) {
      const toast = new Notification({ ...toastText(a), silent: true });
      toast.on('click', focusGame);
      toast.show();
    }
  }

  if (gameWindow && !gameWindow.isFocused()) gameWindow.flashFrame(true);
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
const teamSends = [];

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

  // A safety valve: never more than 6 swaps in 10 minutes, whatever happens.
  const now = Date.now();
  while (teamSends.length && now - teamSends[0] > 10 * 60 * 1000) teamSends.shift();
  if (teamSends.length >= 6) return { ok: false, reason: 'Too many swaps in a short time, so this one was skipped.' };

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
  teamSends.push(now);
  pendingTeam = { id: team.id, name: team.name, why, at: now };
  return { ok: true, team: team.name };
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

function checkWeatherTeam(st) {
  const cfg = store.get().weatherTeams;
  if (!cfg || !cfg.enabled || parked || !st.foundSelf || !st.canSend) return;
  const kind = weather.kindOf(st.weather);
  if (kind === null) return; // weather we don't recognise: leave the pets alone
  const key = `${st.connection}:${kind}`;
  if (key === lastTeamKey) return;
  lastTeamKey = key;
  const teamId = cfg[kind];
  if (!teamId) return;
  const why = kind === 'clear' ? '(the weather cleared)' : `for ${weather.label(kind)}`;
  applyTeam(teamId, why).then((r) => {
    if (!r.ok) recordNote(`⚠️ Couldn't switch teams ${why}: ${r.reason}`);
  });
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
    applyTeam(rule.teamId, `(${describeTrigger(rule)})`).then((r) => {
      if (!r.ok) recordNote(`⚠️ Couldn't switch teams (${describeTrigger(rule)}): ${r.reason}`);
    });
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
let skipEvent = null;   // an event you chose to stay in for (pressed "Rejoin now")

function logoffKinds() {
  const l = store.get().logoff;
  return l && l.enabled ? new Set(l.kinds || []) : new Set();
}

function sendParked() {
  sendToControl('game:parked', parked);
}

function park(kind, untilIso, eventKey, manual) {
  if (!gameWindow || gameWindow.isDestroyed()) return;
  if (!manual && eventKey && eventKey === skipEvent) return;
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
  const autoBack = !manual && store.get().logoff.rejoin;
  showParkedPage();
  recordNote(
    manual
      ? '🚪 Logged off (you pressed Log off now)'
      : `🚪 Logged off for ${label}${until && autoBack ? `, back about ${clock(until + 10000)}` : ''}`,
    manual ? null : `Logged off for ${label}`
  );
  sendParked();
  scheduleRejoin();
}

// The "back soon" page in the game window. Shown again whenever the end
// time becomes known, so its countdown is right.
function showParkedPage() {
  if (!parked || !gameWindow || gameWindow.isDestroyed()) return;
  const autoBack = !parked.manual && store.get().logoff.rejoin;
  gameView.webContents.loadFile(path.join(__dirname, 'parked.html'), {
    query: {
      weather: parked.label,
      emoji: (weather.BY_ID[parked.kind] && weather.BY_ID[parked.kind].emoji) || '🌙',
      until: parked.until ? String(parked.until) : '',
      rejoin: autoBack ? '1' : '0',
    },
  });
}

function scheduleRejoin() {
  clearTimeout(rejoinTimer);
  if (!parked || parked.manual || !parked.until || !store.get().logoff.rejoin) return;
  const wait = Math.max(1000, parked.until + 10000 - Date.now());
  rejoinTimer = setTimeout(() => rejoin(false), wait);
}

function rejoin(byHand) {
  clearTimeout(rejoinTimer);
  if (!parked) return;
  const was = parked;
  if (byHand && was.eventKey) skipEvent = was.eventKey;
  parked = null;
  lastTeamKey = null;
  recordNote(byHand || was.manual ? '👋 Back in the game' : `👋 Back in the game, ${was.label} is over`);
  sendParked();
  if (gameWindow && !gameWindow.isDestroyed()) gameView.webContents.loadURL(GAME_URL);
}

// Called with every shop-feed status. Parks now if chosen weather is on, or
// sets a timer to park shortly before the next one starts.
function planLogoff(status) {
  clearTimeout(parkTimer);
  const kinds = logoffKinds();
  if (!status) return;
  const now = Date.now();
  const cur = status.current;

  if (parked) {
    if (parked.manual) return;
    // Parked by the live game before the feed knew the end time: take it now.
    if (!parked.until && cur && cur.kind === parked.kind) {
      parked.until = Date.parse(cur.endsAt) || null;
      parked.eventKey = parked.eventKey || cur.startsAt;
      showParkedPage();
      sendParked();
      scheduleRejoin();
      return;
    }
    // Still no end time, the feed shows the weather has moved on, and it's
    // been a couple of minutes: come back.
    if (!parked.until && (!cur || cur.kind !== parked.kind) && now - parked.since > 120000 && store.get().logoff.rejoin) {
      rejoin(false);
    }
    return;
  }
  if (!kinds.size) return;

  if (cur && cur.kind && kinds.has(cur.kind) && Date.parse(cur.endsAt) > now) {
    park(cur.kind, cur.endsAt, cur.startsAt);
    return;
  }

  const lead = Math.max(0, Number(store.get().logoff.leadSeconds) || 30) * 1000;
  const next = (status.upcoming || []).find((e) => e.kind && kinds.has(e.kind));
  if (next) {
    const at = Date.parse(next.startsAt) - lead;
    if (at - now < 6 * 60 * 60 * 1000) {
      parkTimer = setTimeout(() => park(next.kind, next.endsAt, next.startsAt), Math.max(0, at - now));
    }
  }
}

// The live game state notices weather the instant it starts, which can be a
// few seconds before the shop feed does.
function checkLogoffFromGame(st) {
  if (parked) return;
  const kind = weather.kindOf(st.weather);
  if (!kind || kind === 'clear' || !logoffKinds().has(kind)) return;
  const cur = watcher && watcher.status().current;
  const match = cur && cur.kind === kind ? cur : null;
  park(kind, match ? match.endsAt : null, match ? match.startsAt : null);
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
    return Object.assign({}, describeOne(Object.assign({}, full, p)), { hunger: p.hunger, pct: p.pct, known: p.known, diet: p.diet, troughHasFood: p.troughHasFood, needsFood: p.needsFood, secondsLeft: p.secondsLeft, maxHunger: p.maxHunger });
  });
  st.allPets = all.map(describeOne);
  st.abilities = abilityData.summarise(st.pets, { weatherMatches: matches });
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
  // Team ideas: the best three pets you own for each goal, and what that
  // team would do (weather-only abilities count in their own weather).
  const byId = Object.fromEntries(st.allPets.map((p) => [p.id, p]));
  st.recommendations = abilityData.recommend(st.allPets, (w) => weather.kindOf(w)).map((r) => {
    const team = r.picks.map((x) => byId[x.id]).filter(Boolean);
    const wantWeather = r.weather;
    return Object.assign(r, {
      summary: abilityData.summarise(team, { weatherMatches: (w) => (wantWeather ? weather.kindOf(w) === wantWeather : matches(w)) }),
    });
  });
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
    sendToControl('garden:status', gardenStatus);
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
 * latest reading in each half hour wins), about a month kept. */
const WORTH_EVERY = 30 * 60 * 1000;
const WORTH_KEEP = 1500;
function recordWorth(st) {
  const b = (st.crops || []).find((x) => /garden/i.test(x.name));
  if (!b || !(b.value > 0)) return;
  const s = store.get();
  const h = Array.isArray(s.worthHistory) ? s.worthHistory : (s.worthHistory = []);
  const t = Date.now();
  const v = Math.round(b.value);
  const last = h[h.length - 1];
  if (!last || t - last.t >= WORTH_EVERY) {
    h.push({ t, v });
    if (h.length > WORTH_KEEP) h.splice(0, h.length - WORTH_KEEP);
    store.save();
  } else {
    last.v = v;
  }
}

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

function sendLuck() {
  sendToControl('luck:state', luck.view(luckState()));
}

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
    if (settings.alerts.popups && Notification.isSupported() && (!isSnoozed(settings) || isAlways(settings, 'luckprimed'))) {
      const toast = new Notification({ title: '🍀 Bad Luck Protection primed', body: text, silent: true });
      toast.on('click', focusGame);
      toast.show();
    }
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
      recordNote(`🍀 ${luck.pretty(e.target)} from ${e.type === 'capsule' ? 'a ' : 'your '}${luck.pretty(e.source)}${e.type === 'plant' ? ' crop' : ''} after ${e.after} pulls`);
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
function migrateSettings() {
  const s = store.get();
  s.ui = s.ui || {};
  if (!s.ui.panel) {
    s.ui.panel = 'attached';
    s.ui.panelOpen = true;
  }
  if (!s.ui.panelWidth) s.ui.panelWidth = 430;
  delete s.ui.dock;
  pityState();
  store.save();
}

function handleGardenMessage(type, payload) {
  if (!payload || typeof payload !== 'object') return;

  if (type === 'status') {
    gardenStatus = Object.assign({}, payload, { at: Date.now() });
    gardenStatus.pets = petData.describePets(payload.pets, payload.trough);
    enrichPets(gardenStatus);
    gardenStatus.eta = gardenEta(gardenStatus);
    gardenStatus.size = sizeEta(gardenStatus);
    gardenStatus.weatherKind = weather.kindOf(gardenStatus.weather);
    if (gardenStatus.foundSelf) {
      checkGrown(gardenStatus);
      recordWorth(gardenStatus);
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
      if (p.autoCount && gardenStatus.session && gardenStatus.session === p.syncConnection) pity.syncTotal(p, gardenStatus.eggsHatched);
    }
    if (gardenStatus.capsulePulls && pityState().autoCount) {
      const ev = luck.onCapsuleStats(luckState(), gardenStatus.capsulePulls);
      if (ev.length) celebrateLuck(ev, false);
      checkPrimed();
      store.save();
      sendLuck();
    }
    checkLogoffFromGame(gardenStatus);
    checkPendingTeam(gardenStatus);
    if (checkTriggers(gardenStatus)) {
      // A trigger just swapped: don't let the weather team undo it.
      lastTeamKey = `${gardenStatus.connection}:${weather.kindOf(gardenStatus.weather)}`;
    } else {
      checkWeatherTeam(gardenStatus);
    }
    sendToControl('garden:status', gardenStatus);
    return;
  }

  if (type === 'hatch') {
    const p = pityState();
    const seen = payload.petId && p.seenIds.includes(payload.petId);
    pity.onHatch(p, payload);
    if (!seen && p.autoCount) {
      const events = luck.onEgg(luckState(), payload);
      // A Rainbow version of the egg's rare pet: the secret celebration
      // takes over from the usual Rainbow alert.
      const rare = events.some((e) => e.type === 'egg' && e.kind === 'species');
      const rainbow = events.some((e) => e.type === 'pet' && e.target === 'rainbow');
      if (rare && rainbow) {
        celebrateLuck(events.filter((e) => !(e.type === 'pet' && e.target === 'rainbow') && !(e.type === 'egg' && e.kind === 'species')));
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
    const r = pity.onBacklog(p, payload.hatches, payload.eggsHatched, payload.oldestLogAt);
    // From now on this connection's status updates keep the game's total.
    p.syncConnection = payload.connection;
    store.save();
    sendPity();
    const total = r.counted + r.unknown;
    if (total > 0) recordNote(`🥚 Caught up on ${total} hatch${total === 1 ? '' : 'es'} from while the app was closed`);
    if (p.autoCount) {
      const events = [];
      for (const h of r.fresh || []) events.push(...luck.onEgg(luckState(), h));
      if (r.unknown) luck.onUnknownHatches(luckState(), r.unknown);
      celebrateLuck(events, true);
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

  if (type === 'superseded') {
    onSuperseded(payload);
    return;
  }

  if (type === 'reclaim') {
    onReclaimAction(String(payload && payload.act));
    return;
  }

  if (type === 'harvestBlocked') {
    sendToControl('harvest:blocked', payload);
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
  const w = Number(store.get().ui.panelWidth) || 430;
  return Math.max(PANEL_MIN, Math.min(PANEL_MAX, w));
}

function layout() {
  if (!gameWindow || gameWindow.isDestroyed() || !gameView) return;
  const [w, h] = gameWindow.getContentSize();
  const ui = store.get().ui;
  const attached = ui.panel !== 'window' && panelView && gameWindow.contentView.children.includes(panelView);
  const showPanel = attached && ui.panelOpen !== false;
  const pw = showPanel ? Math.min(panelWidth(), Math.max(0, w - 480)) : 0;
  gameView.setBounds({ x: 0, y: 0, width: Math.max(0, w - pw), height: h });
  if (attached) {
    panelView.setBounds({ x: w - pw, y: 0, width: pw, height: h });
    panelView.setVisible(showPanel);
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
  return { mode: ui.panel === 'window' ? 'window' : 'attached', open: ui.panelOpen !== false, width: panelWidth() };
}

function setPanel(change) {
  const ui = store.get().ui;
  if (change.mode === 'window' || change.mode === 'attached') ui.panel = change.mode;
  if (typeof change.open === 'boolean') ui.panelOpen = change.open;
  if (change.width) ui.panelWidth = Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(Number(change.width))));
  store.save();
  placePanel(Boolean(change.show));
  return panelState();
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
  gameWindow = new BaseWindow({
    width: ui.panel === 'window' ? 1280 : 1280 + panelWidth(),
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#2A1B36',
    title: 'Magic Garden',
  });
  createGameView();
  wireGameWindow();
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

  contents.on('did-finish-load', () => {
    injectScripts(contents);
    relayoutSoon();
    pushHarvestLock();
    // Again once the game has had a moment (the observer is ready by then).
    setTimeout(pushHarvestLock, 3000);
  });

  // The "back soon" page links straight to the game. If you follow it (or
  // reload the game any other way), you're no longer parked.
  contents.on('did-navigate', (event, url) => {
    if (parked && isGameUrl(url)) {
      const was = parked;
      if (was.eventKey) skipEvent = was.eventKey;
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
    shell.openExternal(url);
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
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  panelView.setBackgroundColor('#251730');
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
      label: 'Panel',
      submenu: [
        { label: 'Show or hide the panel', accelerator: 'CmdOrCtrl+Shift+D', click: togglePanel },
        { label: 'Harvest lock', type: 'checkbox', checked: Boolean(store.get().harvestLock && store.get().harvestLock.on), accelerator: 'CmdOrCtrl+Shift+L', click: () => setHarvestLock({ on: !harvestLock().on }) },
        { type: 'separator' },
        { label: 'Attached to the game', type: 'radio', checked: store.get().ui.panel !== 'window', click: () => setPanel({ mode: 'attached', open: true }) },
        { label: 'In its own window', type: 'radio', checked: store.get().ui.panel === 'window', click: () => setPanel({ mode: 'window', show: true }) },
      ],
    },
    {
      label: 'Alerts',
      submenu: [
        { label: 'Open alerts', accelerator: 'CmdOrCtrl+Shift+A', click: () => showControl('alerts') },
        { label: 'Check the shops now', click: () => watcher && watcher.checkNow() },
        { type: 'separator' },
        { label: 'Snooze for 30 minutes', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendToControl('alerts:snooze', 30) },
        { label: 'Snooze for 1 hour', click: () => sendToControl('alerts:snooze', 60) },
        { label: 'Resume alerts', click: () => sendToControl('alerts:snooze', 0) },
      ],
    },
    {
      label: 'Eggs',
      submenu: [
        { label: 'Open Bad Luck Protection', accelerator: 'CmdOrCtrl+Shift+P', click: () => showControl('pity') },
        { label: 'Add one hatch by hand', accelerator: 'CmdOrCtrl+Shift+H', click: () => {
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
        { label: 'Open scripts', accelerator: 'CmdOrCtrl+Shift+S', click: () => showControl('scripts') },
        { label: 'Run enabled scripts now', accelerator: 'CmdOrCtrl+Shift+R', click: () => gameWindow && injectScripts(gameView.webContents) },
        { label: 'Open scripts folder', click: () => shell.openPath(scriptsDir()) },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
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

ipcMain.handle('settings:set', (event, next) => {
  if (!next || typeof next !== 'object') return store.get();
  if (store.get().firstRunDone) next.firstRunDone = true;
  next.gardenCountsVersion = store.get().gardenCountsVersion;
  next.alertHistory = store.get().alertHistory;
  // Pet counts are written here in the main process; never let a stale copy
  // from the window overwrite them.
  next.garden = store.get().garden;
  next.pity = store.get().pity;
  next.luck = store.get().luck;
  next.harvestLock = store.get().harvestLock;
  next.reclaim = store.get().reclaim;
  next.worthHistory = store.get().worthHistory;
  next.updates = store.get().updates;
  next.lastRunVersion = store.get().lastRunVersion;
  next.rooms = store.get().rooms;
  next.ui = Object.assign({}, next.ui, {
    panel: store.get().ui.panel, panelOpen: store.get().ui.panelOpen, panelWidth: store.get().ui.panelWidth,
  });
  const saved = store.set(next);
  if (watcher) planLogoff(watcher.status());
  return saved;
});

ipcMain.handle('weather:kinds', () => weather.KINDS);
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('teams:apply', async (event, teamId) => {
  const r = await applyTeam(String(teamId), '(you pressed Apply)');
  return r;
});
ipcMain.handle('game:parked', () => parked);
ipcMain.handle('game:logoffNow', () => {
  if (!parked) park(null, null, null, true);
  return parked;
});
ipcMain.handle('game:rejoin', () => {
  rejoin(true);
  return parked;
});

ipcMain.handle('alerts:rules', () => alerts.publicRules(store.get()));
ipcMain.handle('alerts:history', () => store.get().alertHistory);
ipcMain.handle('alerts:clearHistory', () => {
  store.get().alertHistory = [];
  store.save();
  return [];
});
ipcMain.handle('alerts:status', () => (watcher ? watcher.status() : null));
ipcMain.handle('alerts:checkNow', async () => {
  if (watcher) await watcher.checkNow();
  return watcher ? watcher.status() : null;
});

ipcMain.on('garden:msg', (event, msg) => {
  if (!event.senderFrame || !isGameUrl(event.senderFrame.url) || !msg) return;
  handleGardenMessage(msg.type, msg.payload);
});

ipcMain.handle('ui:panel', (event, change) => (change ? setPanel(change) : panelState()));

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
    sendToControl('garden:status', gardenStatus);
  }
  return g.strength;
});

ipcMain.handle('pity:get', () => pityView());
ipcMain.handle('luck:get', () => luck.view(luckState()));
ipcMain.handle('luck:set', (event, key, value) => {
  luck.set(luckState(), key, value);
  store.save();
  sendLuck();
  return luck.view(luckState());
});
ipcMain.handle('luck:options', (event, opts) => {
  const l = luckState();
  if (opts && typeof opts.startHalf === 'boolean') l.startHalf = opts.startHalf;
  if (opts && opts.notify && typeof opts.notify === 'object') Object.assign(l.notify, opts.notify);
  store.save();
  sendLuck();
  return luck.view(l);
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
 * Coming back after another device. When you log in somewhere else (your
 * phone), the game here is bumped off (close code 4250/4300). If you've
 * switched this on, the app waits the time you chose, then reloads the game,
 * which logs the other device out. Magic Circle's rule: no automatic
 * reconnect after being replaced unless the player explicitly asks for it,
 * because two sessions fighting can lose data. So: off by default, a
 * countdown with Come back now / Stay away, and if you're bumped again
 * within 10 minutes of the app coming back, it stops and waits for you.
 * ------------------------------------------------------------------ */

const RECLAIM_QUIET_MS = 10 * 60 * 1000;
const reclaimState = { timer: null, until: 0, lastReturnAt: 0, waiting: false };

function reclaimSettings() {
  const s = store.get();
  s.reclaim = Object.assign({ on: false, delaySec: 60 }, s.reclaim);
  return s.reclaim;
}

function showReclaim(info) {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.showReclaim(${JSON.stringify(info)})`, true).catch(() => {});
  sendToControl('reclaim:state', info);
}

function comeBack(why) {
  clearTimeout(reclaimState.timer);
  reclaimState.timer = null;
  reclaimState.waiting = false;
  reclaimState.lastReturnAt = Date.now();
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const url = isGameUrl(contents.getURL()) ? contents.getURL() : GAME_URL;
  recordNote(why === 'auto' ? '📱 Came back to the game (the other device was logged out)' : '📱 Came back to the game');
  sendToControl('reclaim:state', null);
  contents.loadURL(url);
}

function onSuperseded() {
  const cfg = reclaimSettings();
  if (parked) return;
  if (!cfg.on) {
    recordNote('📱 You logged in somewhere else, so the game here was logged out');
    return;
  }
  clearTimeout(reclaimState.timer);
  reclaimState.waiting = true;
  // Bumped again soon after coming back: you're using the other device.
  // Don't fight over the account; wait for you instead.
  if (reclaimState.lastReturnAt && Date.now() - reclaimState.lastReturnAt < RECLAIM_QUIET_MS) {
    recordNote('📱 Logged in somewhere else again, so the app will wait until you press Come back');
    showReclaim({ manual: true, message: "You're busy on the other device, so this will wait. Press Come back when you're done over there." });
    return;
  }
  const delay = Math.max(15, Math.min(3600, Number(cfg.delaySec) || 60)) * 1000;
  const until = Date.now() + delay;
  reclaimState.until = until;
  reclaimState.timer = setTimeout(() => comeBack('auto'), delay);
  recordNote(`📱 Logged in somewhere else: coming back here at ${clock(until)}`);
  showReclaim({ until });
}

function onReclaimAction(act) {
  if (act === 'now') return comeBack('manual');
  if (act === 'stay') {
    clearTimeout(reclaimState.timer);
    reclaimState.timer = null;
    showReclaim({ manual: true, message: "Staying away. Press Come back when you're done over there." });
    recordNote('📱 Staying logged out here until you press Come back');
  }
  return true;
}

ipcMain.handle('reclaim:get', () => Object.assign({}, reclaimSettings(), { waiting: reclaimState.waiting, until: reclaimState.timer ? reclaimState.until : null }));
ipcMain.handle('reclaim:set', (event, change) => {
  const cfg = reclaimSettings();
  if (change && typeof change.on === 'boolean') cfg.on = change.on;
  if (change && change.delaySec) cfg.delaySec = Math.max(15, Math.min(3600, Math.round(Number(change.delaySec))));
  if (!cfg.on) {
    clearTimeout(reclaimState.timer);
    reclaimState.timer = null;
  }
  store.save();
  return cfg;
});
ipcMain.handle('reclaim:act', (event, act) => onReclaimAction(String(act)));

/* ------------------------------------------------------------------ *
 * Harvest lock: tells the game page which harvests to stop (all of them
 * while the lock is on, and protected crops always). The page does the
 * stopping (garden-observer.js); nothing is ever sent.
 * ------------------------------------------------------------------ */

function harvestLock() {
  const s = store.get();
  s.harvestLock = Object.assign({ on: false, species: [] }, s.harvestLock);
  return s.harvestLock;
}

function pushHarvestLock() {
  const contents = gameView && gameView.webContents;
  if (!contents || contents.isDestroyed()) return;
  const lock = harvestLock();
  contents.executeJavaScript(`window.__mgLoaderObserver && window.__mgLoaderObserver.setHarvestLock(${JSON.stringify(lock)})`, true).catch(() => {});
}

function setHarvestLock(change) {
  const lock = harvestLock();
  if (change && typeof change.on === 'boolean') lock.on = change.on;
  if (change && Array.isArray(change.species)) lock.species = change.species.map(String).slice(0, 100);
  store.save();
  pushHarvestLock();
  sendToControl('harvest:lock', lock);
  buildMenu();
  return lock;
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
  next.ui = Object.assign({}, next.ui, { panel: keepUi.panel, panelOpen: keepUi.panelOpen, panelWidth: keepUi.panelWidth });
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
    if (mine.players == null) check = { ok: false, text: `Player-count lookups aren't working (${mine.error || 'no answer'}).`, sample: mine.sample };
    else if (Math.abs(mine.players - inState) <= 1) check = { ok: true, text: 'Player-count lookups are working.' };
    else check = { ok: false, text: `The lookup says ${mine.players} players here, the game says ${inState}.` };
  }
  lastRoomCheck = check;
  return {
    current: (gardenStatus && gardenStatus.room) || null,
    saved: saved.map((r) => Object.assign({}, r, roomsMod.describeId(r.id), byId[r.id] || {})),
    shared: candidates
      .map((r) => Object.assign({ name: roomsMod.describeId(r.id).label, names: r.names, reported: r.reported, updatedAt: r.updatedAt }, byId[r.id] || {}, { id: r.id }))
      // Only rooms the game confirms still have people in them.
      .filter((r) => r.players != null && r.players > 0),
    sharedError: shared.error,
    sharedOff: Boolean(shared.off),
    sharedTotal: shared.list.length,
    sharedStats: shared.stats || null,
    sharedChecked: candidates.length,
    check,
    at: Date.now(),
  };
});

let lastRoomCheck = null;

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
      JSON.stringify({ appVersion: app.getVersion(), observerLoaded: Boolean(sample), roomLookup: lastRoomCheck, lastStatus: gardenStatus, sample }, null, 2),
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
ipcMain.handle('voices:warm', (event, id) => voices.warm(String(id || '')));
ipcMain.handle('voices:synthesize', async (event, id, text, speaker) =>
  new Uint8Array(await voices.synthesize(String(id), String(text), speaker ? String(speaker) : undefined)));

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
  });

  app.whenReady().then(() => {
    store.init(app.getPath('userData'));
    voices.init(app.getPath('userData'));
    // The v0.18 voice lineup: remove downloads of voices that were retired,
    // and move anyone using one of them to Prudence (with a note saying so).
    try {
      voices.pruneUnused();
      const st = store.get();
      const ids = voices.CATALOG.map((v) => v.id);
      if (st.alerts.naturalVoice && !ids.includes(st.alerts.naturalVoice)) {
        st.alerts.retiredVoice = st.alerts.naturalVoice;
        st.alerts.naturalVoice = 'char-prudence';
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
    // Look for updates a little after starting, then every 6 hours.
    setTimeout(() => { if (updateSettings().auto) checkForUpdate(false); }, 20000);
    setInterval(() => { if (updateSettings().auto) checkForUpdate(false); }, UPDATE_EVERY);
    buildMenu();
    createGameWindow();
    createPanel();

    const settings = store.get();
    if (!settings.firstRunDone) {
      settings.firstRunDone = true;
      store.save();
    }

    watcher = alerts.createWatcher({
      getSettings: store.get,
      onAlerts: handleAlerts,
      onStatus: (status) => {
        sendToControl('alerts:status', status);
        planLogoff(status);
      },
    });
    watcher.start();

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
