// Test harness: points the app at the stand-in server, runs the real main.js,
// probes it after a while and writes /tmp/erun/result.json.
const { app, webContents } = require('electron');
const fs = require('fs');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP magicgarden.gg 127.0.0.1:8443');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('no-sandbox');
const out = { steps: [], errors: [] };
process.on('uncaughtException', (e) => out.errors.push('uncaught: ' + (e.stack || e)));
process.on('unhandledRejection', (e) => out.errors.push('unhandled: ' + ((e && e.stack) || e)));
const settingsFile = () => require('path').join(app.getPath('userData'), 'settings.json');
const readSettings = () => JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
const find = (pred) => webContents.getAllWebContents().find((w) => !w.isDestroyed() && pred(w.getURL()));
const game = () => find((u) => u.startsWith('https://magicgarden.gg'));
// The game view while stepped away (it shows parked.html, not the game).
const away = () => find((u) => /^file:.*parked\.html/.test(u));
const panel = () => find((u) => u.endsWith('control.html'));
const run = (w, js) => w.executeJavaScript(js, true);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Two hours of earnings history, so the budget card's income is ready at once
// (the stand-in's lifetime total, 3B, lands as the third point).
try {
  const fs0 = require('fs'); const p0 = require('path');
  const dir = app.getPath('userData'); fs0.mkdirSync(dir, { recursive: true });
  const f = p0.join(dir, 'settings.json');
  // Before that: a lead-in and three full harvest cycles (the garden climbs
  // 1B → 100B over 24 h, is harvested and sold for ~100B), the last harvest
  // 30 h ago, then a quiet garden of 20K. For the cycle learning.
  const H0 = 3600000; const T = Date.now();
  const worth = []; const money = [];
  const lastLow = T - 30 * H0;
  let sold = -4 * 99.98e9;
  for (let i = 0; i < 4; i += 1) {
    const st = lastLow - (4 - i) * 24.5 * H0;
    for (let h = 0; h <= 24; h += 0.5) {
      worth.push({ t: st + h * H0, v: 1e9 + 99e9 * (h / 24) });
      money.push({ t: st + h * H0, c: 0.8e9, s: sold, f: 0 });
    }
    sold += 99.98e9;
  }
  for (let t = lastLow; t < T - 26.5 * H0; t += 0.5 * H0) {
    worth.push({ t, v: 20000 });
    money.push({ t, c: 0.8e9, s: 0, f: 0 });
  }
  // ui.panelWidth 430: the old default, which should move up to 480 once.
  if (!fs0.existsSync(f)) fs0.writeFileSync(f, JSON.stringify({ ui: { panelWidth: 430 }, worthHistory: worth, moneyHistory: money.concat([{ t: T - 26 * H0, c: 0.8e9, s: 0, f: 0 }, { t: T - 2 * H0, c: 1e9, s: 0, f: 0 }, { t: T - H0, c: 1.5e9, s: 1e9, f: 0 }]) }));
} catch (e) { out.errors.push('seed: ' + e); }
// Coming back to the computer (v0.64.2): a short catch-up for the test.
process.env.MG_SETTLE_MS = process.env.MG_SETTLE_MS || '2500';
require('../main.js');
app.whenReady().then(async () => {
  const T0 = Date.now();
  try {
    await wait(5000);
    out.steps.push({ gameUrl: game() && game().getURL(), panelUrl: panel() && panel().getURL() });
    out.panelWidthAtStart = { saved: readSettings().ui && readSettings().ui.panelWidth, panel: await run(panel(), 'PANEL.width') };
    out.observer = await run(game(), 'Boolean(window.__mgLoaderObserver) && { welcomes: window.__mgLoaderObserver.welcomes, sockets: window.__mgLoaderObserver.sockets, canSend: !!window.__mgLoaderObserver.gameSocket }');
    // New user setup (v0.71.0): a fresh install opens it. Walk it like a new
    // player: each answer is set as it's tapped (and put back here, so the
    // rest of the run sees the defaults); Start closes it, on Home.
    out.setup = await run(panel(), `(async () => {
      const box = document.getElementById('setupSheet');
      const r = { shownAtStart: !box.hidden, first: box.dataset.step };
      const pause = () => new Promise((x) => setTimeout(x, 300));
      const click = async (sel) => { const b = box.querySelector(sel); if (b) b.click(); await pause(); return !!b; };
      const steps = [];
      await click('[data-wgo="next"]'); steps.push(box.dataset.step);
      r.stageOpts = box.querySelectorAll('[data-su="stage"]').length;
      await click('[data-su="stage"][data-val="mid"]');
      r.stageMid = !!box.querySelector('[data-su="stage"][data-val="mid"].on');
      await click('[data-su="stage"][data-val="auto"]');
      await click('[data-wgo="next"]'); steps.push(box.dataset.step);
      r.items = box.querySelectorAll('[data-witem]').length;
      const first = box.querySelector('[data-witem]').dataset.witem;
      await click('[data-witem="' + first + '"]'); r.offAfter = S.alerts.disabled.includes(first);
      await click('[data-witem="' + first + '"]'); r.backOn = !S.alerts.disabled.includes(first);
      await click('[data-wgo="next"]'); steps.push(box.dataset.step);
      r.sound = { vol: !!box.querySelector('#suVol'), voice: box.querySelectorAll('[data-su="voice"]').length, sfx: box.querySelectorAll('[data-su="sfx"]').length };
      await click('[data-wgo="next"]'); steps.push(box.dataset.step);
      r.kinds = box.querySelectorAll('[data-wkind]').length;
      await click('[data-su="wask"][data-val="ask"]'); r.askOn = S.logoff.enabled === true;
      await click('[data-su="wask"][data-val="ping"]'); r.askOff = S.logoff.enabled === false;
      await click('[data-wgo="next"]'); steps.push(box.dataset.step);
      const had = (LOCK.mode.hydro || []).includes('thunderstruck');
      await click('[data-hvhydro="thunderstruck"]'); r.hydroOn = (LOCK.mode.hydro || []).includes('thunderstruck') !== had;
      await click('[data-hvhydro="thunderstruck"]'); r.hydroOff = (LOCK.mode.hydro || []).includes('thunderstruck') === had;
      await click('[data-wgo="next"]'); steps.push(box.dataset.step);
      r.saleOpts = box.querySelectorAll('[data-su="sale"]').length;
      r.shareOpts = box.querySelectorAll('[data-su="share"]').length;
      await click('[data-wgo="next"]'); steps.push(box.dataset.step);
      await click('[data-su="start"][data-val="home"]');
      await click('[data-wgo="back"]'); r.back = box.dataset.step;
      await click('[data-wgo="next"]');
      await click('[data-wgo="next"]'); steps.push(box.dataset.step);
      r.summary = box.querySelectorAll('.su-sum-row').length;
      await click('[data-wgo="done"]');
      r.closed = box.hidden;
      r.tab = currentTab();
      r.steps = steps;
      showTab('alerts');
      return r;
    })()`);
    await wait(1800); // the store writes 1.5 s after a change
    out.setup.welcomedSaved = readSettings().ui.welcomed;
    out.setup.stageSaved = readSettings().stage;
    {
      const u = out.setup;
      const okSU = u.shownAtStart && u.first === 'hello' && u.steps.join() === 'account,alerts,sound,weather,harvest,selling,panel,done' && u.stageOpts === 4 && u.stageMid
        && u.items > 3 && u.offAfter && u.backOn && u.sound.vol && u.sound.voice === 2 && u.sound.sfx === 3 && u.kinds >= 5 && u.askOn && u.askOff && u.hydroOn && u.hydroOff
        && u.saleOpts === 2 && u.shareOpts === 2 && u.back === 'selling' && u.summary === 6 && u.closed && u.tab === 'home' && u.welcomedSaved === true && !(u.stageSaved && u.stageSaved.pick);
      if (!okSU) out.errors.push(`new user setup: ${JSON.stringify(u)}`);
    }
    const s1 = readSettings();
    out.afterBacklog = { syncConnection: s1.pity.syncConnection, lastEggsHatched: s1.pity.lastEggsHatched, totalHatches: s1.pity.totalHatches, trackedBase: s1.pity.trackedBase, gameBase: s1.pity.gameBase };
    // Stale copy of the settings as the panel would hold it: try to clobber pity/rooms/harvestLock through settings:set.
    const stale = JSON.parse(JSON.stringify(s1));
    stale.pity.totalHatches = 1; stale.rooms = { saved: [{ id: 'HACK' }], clipboard: false }; stale.harvestLock = { on: true, species: [] }; stale.worthHistory = [{ t: 1, v: 1 }];
    stale.alerts.volume = 42; stale.ui = { tab: 'rooms', panel: 'window', panelWidth: 999 }; stale.logoff = { enabled: true, kinds: ['rain'], rejoin: true, leadSeconds: 30 };
    const saved = await run(panel(), `window.app.setSettings(${JSON.stringify(stale)})`);
    out.whitelist = { volume: saved.alerts.volume, tab: saved.ui.tab, panel: saved.ui.panel, panelWidth: saved.ui.panelWidth, pityTotal: saved.pity.totalHatches, rooms: saved.rooms, harvestOn: saved.harvestLock && saved.harvestLock.on, worth: saved.worthHistory, logoff: saved.logoff.enabled, clipboard: saved.rooms.clipboard };
    await wait(6000); // the patch at 6 s and the status after it (2 s debounce) and the coins patch at 9 s
    // On launch: "Share your room with the public?". Tick "Don't ask me
    // again" and press Not now: nothing shared, and it won't ask again.
    out.shareAsk = { shown: await run(panel(), "!!document.getElementById('shareAsk')"), title: await run(panel(), "(document.getElementById('shareAskTitle') || {}).textContent || null") };
    await run(panel(), "(() => { const c = document.getElementById('shareAskNever'); if (c) c.checked = true; const b = document.getElementById('shareAskNo'); if (b) b.click(); })()");
    await wait(2200); // settings are written in a batch 1.5 s later
    out.shareAsk.after = { gone: await run(panel(), "!document.getElementById('shareAsk')"), askSaved: readSettings().rooms && readSettings().rooms.askShare, shareOn: Boolean(readSettings().rooms && readSettings().rooms.share) };
    const s2 = readSettings();
    out.afterPatch = { lastEggsHatched: s2.pity.lastEggsHatched, totalHatches: s2.pity.totalHatches, coinsSaved: s2.pity.syncConnection };
    out.status = await run(panel(), 'window.app.getGarden().then((g) => g && g.status && ({ session: g.status.session, eggsHatched: g.status.eggsHatched, connected: g.status.connected, foundSelf: g.status.foundSelf }))');
    // A team swap through the observer path still sends and translates (sanity for the wrapper, unchanged code).
    out.openExternal = 'not exercised';
    // Spending vs. earning: the feed has been counted, money is measured, and a
    // purchase made in the game page is noticed, priced and attributed.
    // Watch the hand map for 26 s (the stand-in hands over the pot 21 s after
    // its Welcome and the seed again at 26 s), sending the purchase meanwhile.
    const mapState = () => run(game(), "(() => { const b = document.getElementById('mg-map'); return { present: !!b, shown: !!b && b.style.display !== 'none' && b.dataset.ctx === 'spots', text: b ? (b.children[1] || b.lastChild).textContent : null, held: window.__mgLoaderObserver.sample().held }; })()");
    out.spotMap = { timeline: [] };
    let prev = '';
    for (let i = 0; i < 52; i += 1) {
      const m = await mapState();
      const key = `${m.shown}|${m.held && m.held.species}|${m.held && m.held.isPot}`;
      if (key !== prev) {
        out.spotMap.timeline.push({ t: Math.round((Date.now() - T0) / 100) / 10, shown: m.shown, held: m.held && m.held.species, isPot: m.held && m.held.isPot, text: m.text });
        prev = key;
      }
      if (i === 3) await run(game(), "window.__gameSend({ type: 'PurchaseShopItem', shopType: 'amber', itemId: 'MoonCelestial', quantity: 1 })");
      await wait(500);
    }
    // Keep the map on the game (v0.67.2): with the switch on, the view picked
    // in the Garden tab stays over the game; switched off, it goes back to
    // showing only when it applies.
    {
      const pinState = () => run(game(), "(() => { const b = document.getElementById('mg-map'); return { shown: !!b && b.style.display !== 'none', ctx: b ? b.dataset.ctx || null : null, text: b ? b.textContent.replace(/\\s+/g, ' ').slice(0, 140) : null, pin: window.__mgLoaderObserver.mapPin && { on: window.__mgLoaderObserver.mapPin.on, view: window.__mgLoaderObserver.mapPin.view } }; })()");
      const pick = (v) => run(panel(), `(() => { showTab('garden'); const b = document.querySelector('#gmView [data-val="${v}"]'); if (b) b.click(); return !!b; })()`);
      const mp = { before: await pinState() };
      await pick('spots');
      await wait(2200); // the panel saves in a batch
      mp.switchOn = await run(panel(), "(async () => { document.getElementById('alwaysMapOn').click(); await new Promise((r) => setTimeout(r, 600)); return document.getElementById('alwaysMapOn').getAttribute('aria-checked'); })()");
      await wait(600);
      mp.spots = await pinState();
      await pick('value');
      await wait(2400);
      mp.value = await pinState();
      mp.saved = { alwaysMap: readSettings().ui.alwaysMap, gardenMap: readSettings().ui.gardenMap };
      await run(panel(), "document.getElementById('alwaysMapOn').click()");
      await wait(900);
      mp.off = await pinState();
      await pick('spots');
      await wait(2200);
      mp.savedOff = readSettings().ui.alwaysMap;
      out.mapPin = mp;
      const okPin = mp.switchOn === 'true' && mp.spots.shown && /Open spots/.test(mp.spots.text || '') && mp.spots.pin.on && mp.spots.pin.view === 'spots'
        && mp.value.shown && /Garden value/.test(mp.value.text || '') && mp.value.pin.view === 'value' && mp.saved.alwaysMap === true && mp.saved.gardenMap === 'value'
        && mp.off.pin.on === false && mp.off.shown === mp.before.shown && (!mp.before.shown || mp.off.ctx === mp.before.ctx) && mp.savedOff === false;
      if (!okPin) out.errors.push(`keep the map on the game: ${JSON.stringify(mp)}`);
    }
    const b1 = await run(panel(), 'window.app.budgetGet()');
    const d1 = b1.periods && b1.periods[1];
    out.budget = {
      day: d1 && { ok: d1.ok, hours: Math.round(d1.hours * 10) / 10, earned: d1.earned, spent: d1.spent, kept: d1.kept, level: d1.verdict.level, tips: d1.verdict.tips.map((t) => t.kind) },
      week: b1.periods && b1.periods[7] && b1.periods[7].verdict.level,
      recent: b1.purchases && b1.purchases.recent.map((e) => ({ name: e.name, coins: e.coins, rules: e.rules })),
      unknown: b1.purchases && b1.purchases.unknown,
      moonbinderPattern: (b1.patterns || []).find((r) => r.ruleId === 'moonbinder'),
      afford: (b1.afford || []).slice(0, 3).map((a) => ({ label: a.label, price: a.price, level: a.level, costPerDay: a.costPerDay && Math.round(a.costPerDay / 1e6) / 1e3 + 'B', source: a.rate && a.rate.source, events: a.rate && a.rate.events, daysToBank: a.daysToBank && Math.round(a.daysToBank * 10) / 10 })),
      commandTypes: await run(game(), 'window.__mgLoaderObserver.commandTypes'),
    };
    await run(panel(), "showTab('garden'); refreshBudget(true)");
    await wait(800);
    out.budget.cardText = await run(panel(), "['moneyGrowth','moneyEngine','budgetPlan','budgetAfford','moneySplit','moneyStage'].map((id) => document.getElementById(id).textContent.replace(/\\s+/g, ' ').trim().slice(0, 160)).join(' | ')");
    // The hand map: hidden while a seed is held, shown while the pot is (12.5 s), hidden again (15.5 s).
    // The plan and the money box: star Moonbinder, check the sums and the box in the game page.
    const pv = await run(panel(), "window.app.budgetPlan({ add: 'moonbinder' })");
    const it = pv.plan.items[0];
    out.plan = { items: pv.plan.items.length, label: it && it.label, wallet: pv.plan.wallet, have: it && it.have, pct: it && Math.round(it.pct * 100), daysToFund: it && it.daysToFund && Math.round(it.daysToFund * 10) / 10, next: it && it.next && { label: it.next.label, inH: Math.round(it.next.inMs / 3600000), ready: it.next.readyByThen, shortBy: it.next.shortByThen }, free: pv.plan.free, delayH: pv.plan.delayHoursPerB && Math.round(pv.plan.delayHoursPerB * 10) / 10 };
    await wait(800);
    const hud = () => run(game(), "(() => { const b = document.getElementById('mg-money-box'); const c = document.getElementById('mg-corner'); return { present: !!b, shown: !!b && b.style.display !== 'none', lines: b ? [...b.children].map((x) => x.textContent) : [], inCorner: !!(b && c && b.parentNode === c) }; })()");
    out.plan.hud = await hud();
    // A picture of the money box (bottom right of the game).
    {
      const img = await game().capturePage();
      const sz = img.getSize();
      fs.writeFileSync((process.env.MG_TEST_DIR || __dirname) + '/money-box.png', img.crop({ x: Math.max(0, sz.width - 320), y: Math.max(0, sz.height - 220), width: Math.min(320, sz.width), height: Math.min(220, sz.height) }).toPNG());
      await wait(2200);
      out.plan.hudLater = await hud();
    }
    await run(panel(), "showTab('garden'); refreshBudget(true)");
    await wait(800);
    out.plan.panelText = await run(panel(), "document.getElementById('budgetPlan').textContent.replace(/\\s+/g, ' ').slice(0, 420)");
    out.plan.starText = await run(panel(), "[...document.querySelectorAll('[data-plan-star]')].map((b) => b.textContent).slice(0, 3)");
    // Purchases from the game's own tally: the Common Egg seen at connect and
    // the Legendary Egg added at 8 s, priced from the feed, attributed.
    const bp = await run(panel(), 'window.app.budgetGet()');
    out.tally = {
      recent: (bp.purchases.recent || []).map((e) => [e.name, e.qty, e.coins, e.rules.join('|')]),
      legendaryPattern: (bp.patterns || []).find((r) => r.ruleId === 'legendaryegg'),
      restockSeen: readSettings().restockSeen,
      // The stand-in's wallet is 2B, so the automatic rule wants 14 days; 26 h is not enough.
      unlocked: bp.unlocked, unlockDays: bp.unlockDays, netWorth: bp.netWorth, measuredHours: Math.round(bp.measuredHours),
      tabShown: await run(panel(), "!document.querySelector('nav [data-tab=\"money\"]').hidden"),
      progress: await run(panel(), "document.getElementById('moneyIntro').hidden ? '' : document.getElementById('moneyIntro').textContent.replace(/\\s+/g, ' ').slice(0, 160)"),
      unlockedSaved: readSettings().budget && readSettings().budget.unlocked,
    };
    // Extras: show it now / keep it hidden / automatic.
    const modeCheck = async (mode) => {
      const v2 = await run(panel(), `window.app.budgetSet({ unlockMode: '${mode}' }).then((v) => { BUDGET = v; budgetFetchedAt = Date.now(); renderBudget(); return v; })`);
      await wait(200);
      return { mode: v2.unlockMode, unlocked: v2.unlocked, tabShown: await run(panel(), "!document.querySelector('nav [data-tab=\"money\"]').hidden"), progress: await run(panel(), "document.getElementById('moneyIntro').hidden ? '' : 'welcome card'"), chip: await run(panel(), "document.querySelector('#moneyUnlock .chip.on') && document.querySelector('#moneyUnlock .chip.on').dataset.unlock") };
    };
    out.tally.modes = { on: await modeCheck('on'), off: await modeCheck('off'), auto: await modeCheck('auto') };
    // Reset: purchases go, the shop's seen counts stay, the tally seen is kept (no re-count).
    const rv = await run(panel(), 'window.app.budgetResetPurchases()');
    await wait(2500);
    out.tally.reset = { recent: rv.purchases.recent.length, total: rv.purchases.total.count, legendarySeen: (rv.patterns.find((r) => r.ruleId === 'legendaryegg') || {}).seen, legendaryBought: (rv.patterns.find((r) => r.ruleId === 'legendaryegg') || {}).bought, savedV: readSettings().purchases.v, savedCount: readSettings().purchases.total.count, restockSeenKept: !!readSettings().restockSeen.egg };
    await run(panel(), "window.app.budgetHudSetting(false)");
    await wait(500);
    out.plan.hudAfterOff = await hud();
    out.plan.settingSaved = readSettings().ui.budgetHud;
    // Never sell pet food: the player owns a Worm (eats Carrots, Apples...); the
    // inventory has 12 unfavourited Carrots, 4 favourited Apples, 2 Cactus.
    const serverLog = () => fs.readFileSync(process.env.MG_TEST_DIR ? process.env.MG_TEST_DIR + '/server.log' : '/tmp/erun/server.log', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const sellsSeen = () => serverLog().filter((l) => l.cmd === 'SellAllCrops').length;
    out.petFood = { lockBefore: await run(game(), 'window.__mgLoaderObserver.harvestLock') };
    await run(panel(), "window.app.harvestSet({ petFood: true })");
    await wait(800);
    out.petFood.lockAfter = await run(game(), 'window.__mgLoaderObserver.harvestLock');
    const before = sellsSeen();
    await run(game(), "window.__gameSend({ type: 'SellAllCrops' })");
    await wait(4500);
    const lockLog = serverLog().filter((l) => l.cmd === 'ToggleLockItem').length;
    out.petFood.guarded = {
      serverGotSell: sellsSeen() - before,
      lockCommandsSent: lockLog,
      gameSaleRefused: await run(game(), "window.__mgLoaderObserver.recentResults.find((r) => r.command === 'SellAllCrops' && r.ok === false)"),
      lockedNow: await run(game(), 'window.__mgLoaderObserver.sample().mySlot.data.inventory.favoritedItemIds'),
      lockField: await run(game(), 'window.__mgLoaderObserver.lockField'),
      saw: await run(game(), 'window.__mgLoaderObserver.lastSaleCheck'),
      bannerShown: await run(game(), "[...document.body.children].some((e) => /Kept your pet food/.test(e.textContent))"),
      shapes: await run(game(), 'Object.keys(window.__mgLoaderObserver.sample().inventoryShapes)'),
      // What's left in the bag: the pet food (Eggplant, Apple) must still be
      // there, locked by its own ids; Carrots and Cactus sold.
      cropsLeft: (serverLog().filter((l) => l.afterSell).slice(-1)[0] || {}).afterSell,
    };
    out.petFood.noted = (readSettings().alertHistory || []).slice(-1)[0] && (readSettings().alertHistory || []).slice(-1)[0].text;
    out.petFood.savedLockField = readSettings().harvestLock && readSettings().harvestLock.lockField;
    // A harvest afterwards still works (the count translation after a drop).
    await run(game(), "window.__gameSend({ type: 'HarvestCrop', slotsIndex: 3 })");
    await wait(1200);
    out.petFood.harvestAfterOk = serverLog().slice(-1)[0];
    await run(panel(), "window.app.harvestSet({ petFood: false })");
    await wait(800);
    const before2 = sellsSeen();
    await run(game(), "window.__gameSend({ type: 'SellAllCrops' })");
    await wait(1500);
    out.petFood.unguarded = { serverGotSell: sellsSeen() - before2 };
    // Layout: Money tab, section order, default folds with summaries, fold memory.
    await run(panel(), "showTab('money'); refreshBudget(true)");
    await wait(800);
    const folded = (key) => run(panel(), `document.querySelector('[data-fold="${key}"]').classList.contains('folded')`);
    const summary = (key) => run(panel(), `document.querySelector('[data-fold="${key}"] .fold-sum').textContent`);
    out.layout = {
      tabs: await run(panel(), "[...document.querySelectorAll('nav [data-tab]')].map((b) => b.dataset.tab)"),
      garden: await run(panel(), "[...document.querySelectorAll('#tab-garden > h2')].map((h) => h.dataset.fold)"),
      money: await run(panel(), "[...document.querySelectorAll('#tab-money > h2')].map((h) => h.dataset.fold)"),
      extras: await run(panel(), "[...document.querySelectorAll('#tab-scripts > h2')].map((h) => h.dataset.fold)"),
      alertsHasBackups: await run(panel(), "!!document.querySelector('#tab-alerts #backupSave')"),
      growthOpen: !(await folded('money/growth')),
      savingOpen: !(await folded('money/your-wants')),
      spendOpen: !(await folded('money/spend-or-save')),
      hudFolded: await folded('money/money-box-over-the-game'),
      statsFolded: await folded('garden/your-stats'),
      lockFolded: await folded('garden/harvest-lock'),
      sums: { growth: await summary('money/growth'), engine: await summary('money/money-engine'), saving: await summary('money/your-wants'), spend: await summary('money/spend-or-save'), week: await summary('money/this-week'), stage: await summary('garden/your-stage'), lock: await summary('garden/harvest-lock') },
      charts: await run(panel(), "({ growthSvg: !!document.querySelector('#moneyGrowth svg path'), engineBars: document.querySelectorAll('#moneyEngine svg rect').length, splitSegs: document.querySelectorAll('#moneySplit .m-bar i').length, steps: document.querySelectorAll('#moneyStage .m-step').length, here: (document.querySelector('#moneyStage .m-step.here') || {}).textContent, chips: [...document.querySelectorAll('#budgetAfford .add-chip')].map((c) => c.textContent.trim()).slice(0, 4) })"),
      planText: await run(panel(), "document.getElementById('budgetPlan').textContent.replace(/\\s+/g, ' ').slice(0, 120)"),
    };
    await run(panel(), "document.querySelector('[data-fold=\"money/this-week\"]').click()");
    await run(panel(), "document.querySelector('[data-fold=\"money/your-wants\"]').click()");
    await wait(2500);
    out.layout.afterClicks = { weekFolded: await folded('money/this-week'), savingFolded: await folded('money/your-wants'), saved: readSettings().ui.folds };
    // Room sharing: on -> one report with the room; off -> a closing report without it.
    const collects = () => serverLog().filter((l) => l.in === 'collect-state').map((l) => l.body);
    const c0 = collects().length;
    const shOn = await run(panel(), 'window.app.roomsShareSetting(true)');
    await wait(1500);
    const c1 = collects();
    const first = c1[c0];
    out.share = { setting: shOn.share, statusOn: shOn.status && shOn.status.on, reportsAfterOn: c1.length - c0, first, self: (await run(panel(), 'window.app.getGarden()')).status.self };
    const shOff = await run(panel(), 'window.app.roomsShareSetting(false)');
    await wait(1200);
    const c2 = collects();
    out.share.afterOff = { reports: c2.length - c1.length, last: c2[c2.length - 1], statusOn: shOff.status && shOff.status.on, saved: readSettings().rooms.share };
    // Crop lifecycle: 1 ready (gold, wet, dawnlit, full, ripe), 2 growing.
    await run(panel(), 'refreshBudget(true)');
    await wait(600);
    const g1 = await run(panel(), 'BUDGET.foresight.garden');
    await run(panel(), "window.app.budgetSet({ readyRule: { hydro: false, lunar: false } })");
    await wait(3500);
    await run(panel(), 'refreshBudget(true)');
    await wait(600);
    const g2 = await run(panel(), 'BUDGET.foresight.garden');
    const pr = await run(panel(), 'BUDGET.foresight.prediction');
    out.prediction = { cycles: pr.cycles, typicalHours: pr.typicalHours && Math.round(pr.typicalHours * 10) / 10, lastSold: pr.lastSold, elapsed: pr.elapsedHours && Math.round(pr.elapsedHours), valueSource: pr.valueSource, hours: pr.hours, hoursSource: pr.hoursSource, predictedGrowing: pr.predictedGrowing };
    out.prediction.strip = await run(panel(), "[...document.querySelectorAll('#moneyForesight .fs-step')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim())");
    out.prediction.learnedLine = await run(panel(), "(() => { const t = document.getElementById('moneyGrowth').textContent; const i = t.indexOf('🌾'); return i >= 0 ? t.slice(i, i + 90) : null; })()");
    out.prediction.pace = await run(panel(), "(document.querySelector('#moneyForesight .fs-pace') || {}).textContent");
    out.lifecycle = {
      strict: { ready: g1.readyCount, total: g1.total, readyValue: g1.ready, growing: g1.growing, potential: g1.potential, harvestHours: g1.harvestHours },
      relaxed: { ready: g2.readyCount, readyValue: g2.ready, growing: g2.growing },
      bar: await run(panel(), "(() => { const el = document.querySelector('#moneyGrowth .m-legend:last-of-type'); return document.getElementById('moneyGrowth').textContent.replace(/\\s+/g, ' ').slice(-220); })()"),
      chips: await run(panel(), "[...document.querySelectorAll('#readyRule [data-ready]')].map((c) => c.dataset.ready + ':' + c.classList.contains('on'))"),
    };
    await run(panel(), "window.app.budgetSet({ readyRule: { hydro: true, lunar: true } })");
    // Weather teams are suggestions (v0.60.0, fair play): the app never swaps
    // pets by itself. Dawn: no ApplyPetTeam, a suggestion (game card + panel);
    // Put out pressed on the game card: B goes out, the suggestion clears.
    // Clear skies: a suggestion back to A; ✕ sends nothing. Swapping by hand
    // to the suggested team clears it.
    const teamCmds = () => serverLog().filter((l) => l.cmd === 'ApplyPetTeam').map((l) => l.teamId);
    const S0 = await run(panel(), 'S');
    await run(panel(), `window.app.setSettings(Object.assign({}, S, { weatherTeams: Object.assign({}, S.weatherTeams, { enabled: true, dawn: 'teamB', clear: null }) }))`);
    await wait(2500);
    const sugg = () => run(panel(), '(async () => { const s = await window.app.teamSuggestion(); return s ? s.teamId : null; })()');
    const card = () => run(game(), "(() => { const c = document.getElementById('mg-team-suggest'); return Boolean(c && c.style.display !== 'none'); })()");
    const t0 = teamCmds().length;
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Dawn' })");
    await wait(4500);
    const onDawn = { commands: teamCmds().slice(t0), suggested: await sugg(), card: await card(), banner: await run(panel(), "!document.getElementById('teamSuggestBar').hidden") };
    // (v0.63.11) A reconnect mid-weather doesn't suggest (and notify) again.
    const TT = globalThis.__mgTest;
    const firstAt = TT.suggestedAt();
    TT.recheckWeatherTeam(98765);
    TT.recheckWeatherTeam(98766);
    await wait(600);
    const noRepeat = TT.suggestedAt() === firstAt && firstAt != null;
    await run(game(), "document.querySelector('#mg-team-suggest [data-act=apply]').click()");
    await wait(3000);
    const afterPress = { commands: teamCmds().slice(t0), suggested: await sugg(), card: await card() };
    const t1 = teamCmds().length;
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
    await wait(4500);
    const onClear = { commands: teamCmds().slice(t1), suggested: await sugg() };
    await run(panel(), "window.app.answerTeam('dismiss')");
    await wait(1000);
    const afterDismiss = { commands: teamCmds().slice(t1), suggested: await sugg() };

    // (Team B is still out: you dismissed going back. Put A out by hand first.)
    await run(game(), "window.__gameSend({ type: 'ApplyPetTeam', teamId: 'teamA' })");
    await wait(2500);
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
    await wait(3500);
    await run(panel(), "window.app.answerTeam('dismiss')");
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Dawn' })");
    await wait(4500);
    const t2 = teamCmds().length;
    const dawnAgain = await sugg();
    // (v0.63.7) Not now on the game card just closes it (no Bring it back).
    await run(game(), "document.querySelector('#mg-team-suggest [data-act=dismiss]').click()");
    await wait(900);
    const notNow = { suggested: await sugg(), card: await card() };
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
    await wait(3000);
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Dawn' })");
    await wait(4500);
    await run(game(), "window.__gameSend({ type: 'ApplyPetTeam', teamId: 'teamB' })");
    await wait(4000);
    const afterHandSwap = await sugg();
    const handOnly = teamCmds().slice(t2);
    // (v0.74.1) Away for a whole spell of rain: its suggestion goes when the
    // rain does, so you don't come back to "Put out your rain team?" under
    // clear skies. Nothing is sent.
    await run(panel(), `window.app.setSettings(Object.assign({}, S, { weatherTeams: Object.assign({}, S.weatherTeams, { enabled: true, dawn: 'teamB', rain: 'teamB', clear: null }) }))`);
    await run(game(), "window.__gameSend({ type: 'ApplyPetTeam', teamId: 'teamA' })");
    await wait(2500);
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
    await wait(2500);
    const t3 = teamCmds().length;
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Rain' })");
    await wait(4000);
    const awayRain = { suggested: await sugg(), card: await card() };
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
    await wait(4000);
    const awayOver = { suggested: await sugg(), card: await card(), banner: await run(panel(), "!document.getElementById('teamSuggestBar').hidden"), commands: teamCmds().slice(t3) };
    // (v0.75.1) Clear skies set to "Detect my usual team": A out in clear
    // skies long enough is your usual team; Dawn → B put out; when it
    // clears, A is suggested. B out while that waits doesn't count; dismissed,
    // B becomes your usual team. (The 10 minutes are 1.5 s here.)
    TT.usualSettle(1500);
    // (Picked the way the menu does it, so the panel's copy has it too. The
    // stand-in is quiet between commands, so a repeat of the same weather
    // nudges the game page into reporting, as a live room's traffic would.)
    await run(panel(), "(() => { S.weatherTeams = Object.assign({}, S.weatherTeams, { enabled: true, dawn: 'teamB', rain: 'teamB', clear: 'auto' }); save(); renderTeams(); return true; })()");
    const nudge = async (n) => {
      for (let i = 0; i < n; i += 1) {
        await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
        await wait(2600);
      }
    };
    await wait(1500);
    await nudge(3);
    const usualId = () => run(panel(), 'GARDEN_STATUS && GARDEN_STATUS.usualTeam ? GARDEN_STATUS.usualTeam.id : null');
    const detect = { usualA: await usualId(), hint: await run(panel(), "(() => { const d = document.querySelector('#teamPicks .team-pick .rule-desc'); return d ? d.textContent : null; })()"), opt: await run(panel(), "(document.querySelector('#teamPicks [data-team-kind=clear]') || {}).value || null") };
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Dawn' })");
    await wait(4000);
    detect.dawn = await sugg();
    await run(game(), "document.querySelector('#mg-team-suggest [data-act=apply]').click()");
    await wait(3000);
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
    await wait(4000);
    detect.cleared = await sugg();
    await nudge(2);
    detect.whileWaiting = await usualId();
    await run(panel(), "window.app.answerTeam('dismiss')");
    await wait(500);
    await nudge(3);
    detect.afterDismiss = await usualId();
    TT.usualSettle(600000);
    await run(panel(), "(() => { S.weatherTeams = Object.assign({}, S.weatherTeams, { clear: null }); save(); renderTeams(); return true; })()");
    out.weatherTeams = { onDawn, noRepeat, afterPress, onClear, afterDismiss, dawnAgain, notNow, afterHandSwap, handOnly, awayRain, awayOver, detect, hadS: Boolean(S0) };
    const wt = out.weatherTeams;
    const okWT = wt.noRepeat && wt.onDawn.commands.length === 0 && wt.onDawn.suggested === 'teamB' && wt.onDawn.card && wt.onDawn.banner
      && wt.afterPress.commands.join() === 'teamB' && wt.afterPress.suggested === null && !wt.afterPress.card
      && wt.onClear.commands.length === 0 && wt.onClear.suggested === 'teamA'
      && wt.afterDismiss.commands.length === 0 && wt.afterDismiss.suggested === null
      && wt.notNow.suggested === null && !wt.notNow.card
      && wt.dawnAgain === 'teamB' && wt.afterHandSwap === null && wt.handOnly.join() === 'teamB'
      && wt.awayRain.suggested === 'teamB' && wt.awayRain.card
      && wt.awayOver.suggested === null && !wt.awayOver.card && !wt.awayOver.banner && wt.awayOver.commands.length === 0
      && wt.detect.usualA === 'teamA' && /Detected:/.test(wt.detect.hint || '') && wt.detect.opt === 'auto' && wt.detect.dawn === 'teamB'
      && wt.detect.cleared === 'teamA' && wt.detect.whileWaiting === 'teamA' && wt.detect.afterDismiss === 'teamB';
    if (!okWT) out.errors.push(`weather teams should only suggest: ${JSON.stringify(wt)}`);
    // A picture of the Spend-or-save card with the owner's real numbers
    // (his 0.34.0 sample: wallet 36B, 121 of 270 crops ready worth 410.7B).
    {
      const budgetMod = require('../budget');
      const bs = { alerts: { custom: [], disabled: [] }, shopStats: budgetMod.emptyStats(), moneyHistory: [], worthHistory: [], purchases: null, budget: {} };
      budgetMod.seedWants(bs);
      const g = { total: 270, special: 176, gold: 85, rainbow: 91, ready: 121, readyValue: 410667500000, growingValue: 76591180000, growingPotential: 143951250000, missing: { grow: 3, size: 10, color: 94, hydro: 3, lunar: 81 }, harvestHours: null };
      // Half a day of readings with ~2 crops an hour maturing, for the estimate.
      bs.worthHistory = Array.from({ length: 25 }, (_, i) => ({ t: Date.now() - (12 - i * 0.5) * 3600000, v: 480e9, r: 97 + i, rv: (97 + i) * 3.39e9, n: 270 }));
      const fsReal = budgetMod.view({ settings: bs, ctx: { wallet: 35982699984, garden: g, pace: 0, gardenLoaded: true } }).foresight;
      const fsTight = budgetMod.view({ settings: bs, ctx: { wallet: 30e9, garden: { total: 10, ready: 0, readyValue: 0, growingValue: 0, growingPotential: 0 }, pace: 2e9, gardenLoaded: true } }).foresight;
      const shoot = async (name, fsObj) => {
        await run(panel(), `(() => { if (!window.__realRefresh) { window.__realRefresh = refreshBudget; refreshBudget = async () => {}; } BUDGET = Object.assign({}, BUDGET, { unlocked: true, inStock: [{ name: 'Marble Pedestal', price: 2e9, shop: 'amber' }], foresight: ${JSON.stringify(fsObj)} }); WHATIF = null; document.querySelector('nav [data-tab="money"]').hidden = false; showTab('money'); renderBudget(); renderWhatIf(); window.scrollTo(0, 0); document.querySelector('main').scrollTop = 0; })()`);
        await wait(500);
        const img = await panel().capturePage();
        fs.writeFileSync((process.env.MG_TEST_DIR || __dirname) + '/' + name + '.png', img.toPNG());
        await run(panel(), "document.getElementById('moneyGrowth').scrollIntoView()");
        await wait(300);
        fs.writeFileSync((process.env.MG_TEST_DIR || __dirname) + '/' + name + '-growth.png', (await panel().capturePage()).toPNG());
      };
      await shoot('money-real', fsReal);
      // The stage card with his garden (270 crops; the moon is the bottleneck).
      {
        const stCtx = { readyRule: { size: true, color: true, hydro: true, lunar: true }, garden: Object.assign({}, g, { have: { ripe: 267, size: 260, hydro: 267, lunar: 189, color: 176 }, stepHours: { ripe: 1, size: null, hydro: 0, lunar: 2.5, color: 77, nextLunar: { name: 'Amber Moon', startsAt: 'x' } } }) };
        const cropSt = budgetMod.cropStage(stCtx);
        const gameSt = budgetMod.stage({ garden: g }, 35982699984 + 487258680000);
        await run(panel(), `(() => { BUDGET = Object.assign({}, BUDGET, { stage: ${JSON.stringify(gameSt)}, cropStage: ${JSON.stringify(cropSt)} }); renderBudget(); document.getElementById('moneyStage').scrollIntoView(); })()`);
        await wait(400);
        fs.writeFileSync((process.env.MG_TEST_DIR || __dirname) + '/money-stage.png', (await panel().capturePage()).toPNG());
        out.cropStage = { here: cropSt.here, next: cropSt.next, game: gameSt.id };
      }
      await shoot('money-tight', fsTight);
      // And the what-if drawn on the real numbers: a 50B decoration.
      await run(panel(), `(() => { WHATIF = ${JSON.stringify(budgetMod.whatIf(bs, { wallet: 35982699984, garden: g, pace: 0, gardenLoaded: true }, 50e9, Date.now()))}; BUDGET = Object.assign({}, BUDGET, { foresight: ${JSON.stringify(fsReal)} }); renderForesight(); renderWhatIf(); document.getElementById('whatIfPrice').value = '50B'; })()`);
      await wait(400);
      fs.writeFileSync((process.env.MG_TEST_DIR || __dirname) + '/money-whatif.png', (await panel().capturePage()).toPNG());
      await run(panel(), '(() => { refreshBudget = window.__realRefresh; delete window.__realRefresh; WHATIF = null; })()');
      out.shots = { real: { mode: fsReal.mode, safe: fsReal.safeToSpend, signal: fsReal.signal, estimate: fsReal.estimate, allowances: fsReal.allowances.map((a) => Math.round(a.amount / 1e9)) }, tight: { mode: fsTight.mode, safe: fsTight.safeToSpend, signal: fsTight.signal } };
    }
    // Gold & Rainbow rate, from the game's own counters: GoldGranter 500 → 503
    // and RainbowGranter 140 → 141 land in this hour; a live-format log entry
    // (targetMutation, growSlotsAffected, no pet object) counts for "Made by
    // your pets".
    {
      const T = Date.now();
      await run(game(), "window.__gameSend({ type: '__TestStat', values: { GoldGranter: 503, RainbowGranter: 141 } })");
      await wait(3500);
      const before = readSettings().garden.totals || {};
      const live = [{ action: 'GoldGranter', timestamp: T - 60000, parameters: { targetMutation: 'Gold', growSlotsAffected: [{ species: 'Carrot', slotId: 4 }], petId: 'pet-1', petSpecies: 'Worm' } }];
      await run(game(), `window.__gameSend({ type: '__TestLog', entries: ${JSON.stringify(live)} })`);
      await wait(2500);
      const gs = readSettings().garden;
      const hs = Object.entries(gs.hourly || {}).map(([h, b]) => [Number(h) - Math.floor(T / 3600000), b.g, b.r, b.w || 0]).sort((a, b) => a[0] - b[0]);
      out.goldRate = { hourly: hs, since: Boolean(gs.hourlySince), totalsBefore: before, totalsAfter: gs.totals };
      // Saved teams as cards and the team builder (v0.59.8): the teams are
      // listed; picking another pet in the builder updates its card.
      await run(panel(), "showTab('pets'); TEAMS_SIG = ''; renderPets()");
      await wait(400);
      out.teams = { cards: await run(panel(), "[...document.querySelectorAll('#teamCompare .tm-card .tm-name')].map((t) => t.textContent)"), builderSlots: await run(panel(), "document.querySelectorAll('#teamCompare [data-build-slot]').length"), firstBuilt: await run(panel(), "(document.querySelector('#teamCompare .tm-card.build .tm-mem .nm b') || {}).textContent") };
      await run(panel(), "(() => { const s = document.querySelector('#teamCompare [data-build-slot=\\'0\\']'); s.value = s.options[s.options.length - 1].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
      await wait(300);
      out.teams.afterPick = await run(panel(), "(document.querySelector('#teamCompare .tm-card.build .tm-mem .nm b') || {}).textContent");
      out.teams.stageInGarden = await run(panel(), "!!document.querySelector('#tab-garden #moneyStage') && !document.querySelector('#tab-money #moneyStage')");
      // The Pets tab's views (v0.67.3): each shows its own sections, a jump
      // to a section opens its view, and the view is remembered.
      out.petViews = await run(panel(), `(async () => {
        showTab('pets');
        const vis = () => [...document.querySelectorAll('#tab-pets > h2')].filter((h) => getComputedStyle(h).display !== 'none').map((h) => String(h.dataset.fold || '').split('/')[1]);
        const res = {};
        for (const v of ['now', 'food', 'teams', 'rank', 'made']) {
          document.querySelector('#petViews [data-pv="' + v + '"]').click();
          await new Promise((r) => setTimeout(r, 60));
          res[v] = vis();
        }
        showPetsView('now', false);
        revealSection(document.querySelector('h2[data-fold="pets/pet-growth"]'));
        res.jump = document.getElementById('tab-pets').dataset.view;
        return res;
      })()`);
      await wait(2200); // the panel saves in a batch
      out.petViews.saved = readSettings().ui.petsView;
      await run(panel(), "showPetsView('now', true)");
      // Home (v0.68.0): the tab you're on, tapped again, goes Home (no tab
      // lit); the title goes Home too; it's remembered.
      out.home = await run(panel(), `(async () => {
        const tap = (t) => document.querySelector('nav [data-tab="' + t + '"]').click();
        showTab('alerts');
        tap('alerts');
        const r = { afterTap: currentTab(), none: !document.querySelector('nav [aria-selected="true"]') };
        await new Promise((x) => setTimeout(x, 150));
        r.hero = !!document.querySelector('#homeBox .hh');
        r.heads = [...document.querySelectorAll('#homeBox .hm-h')].map((h) => h.textContent);
        r.rows = document.querySelectorAll('#homeBox .hm-row').length;
        r.noSellNag = !/before you sell/.test(document.getElementById('homeBox').textContent);
        tap('weather');
        r.weather = currentTab();
        document.getElementById('homeLink').click();
        r.title = currentTab();
        return r;
      })()`);
      await wait(2200);
      out.home.saved = readSettings().ui.tab;
      await run(panel(), "showTab('alerts')");
      {
        const h = out.home;
        if (!(h.afterTap === 'home' && h.none && h.hero && h.rows > 0 && h.noSellNag && h.heads.some((x) => /Pets out/.test(x)) && h.weather === 'weather' && h.title === 'home' && h.saved === 'home')) out.errors.push(`home: ${JSON.stringify(h)}`);
      }
      // Egg locks and the hatch countdown (v0.69.0). The stand-in's garden has
      // a ripe Common Egg on tile 27.
      {
        const hatchesSeen = () => serverLog().filter((l) => l.cmd === 'HatchEgg').length;
        const el = {};
        // Bee 2 away on Common Eggs: on Home; on the game only while hatching
        // (v0.69.1: a warning at the top middle, not a box that stays up).
        const hatchPop = () => run(game(), "(() => { const b = document.getElementById('mg-hatch-box'); return b && b.style.display !== 'none' ? b.textContent : null; })()");
        const thr = await run(panel(), "(LUCK.groups.egg.find((g) => g.source === 'CommonEgg').rows.find((r) => r.target === 'Bee') || {}).threshold");
        await run(panel(), `window.app.luckSet('egg:CommonEgg:Bee', ${thr - 2})`);
        await wait(900);
        el.idle = await hatchPop();
        await run(panel(), "showTab('home')");
        await wait(300);
        el.homeHatch = await run(panel(), "[...document.querySelectorAll('#homeBox .hm-hatch')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())");
        // Lock it from Home's row.
        await run(panel(), "(() => { const b = document.querySelector('#homeBox .hm-hatch [data-egg-lock=\"CommonEgg\"]'); if (b) b.click(); return !!b; })()");
        await wait(900);
        el.saved = readSettings().eggLock;
        el.obsLocks = await run(game(), 'window.__mgLoaderObserver.eggLock');
        // Try to hatch it: stopped, the card says so.
        const before = hatchesSeen();
        await run(game(), "window.__gameSend({ type: 'HatchEgg', slot: 27 })");
        await wait(900);
        el.blocked = { serverGot: hatchesSeen() - before, card: await run(game(), "(document.getElementById('mg-egg-lock') || {}).textContent || null"), main: await run(panel(), 'true') };
        // Hatching: the warning is up, at the top middle (a stopped hatch
        // doesn't count down).
        el.countdown = await hatchPop();
        el.popAt = await run(game(), "(() => { const b = document.getElementById('mg-hatch-box'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top), mid: Math.round(r.left + r.width / 2), w: innerWidth }; })()");
        fs.writeFileSync((process.env.MG_TEST_DIR || __dirname) + '/egg-lock-card.png', (await game().capturePage()).toPNG());
        // Its button opens the locks on the Luck tab.
        await run(game(), "(() => { const b = [...document.querySelectorAll('#mg-egg-lock button')].find((x) => /egg locks/i.test(x.textContent)); if (b) b.click(); return !!b; })()");
        await wait(900);
        el.wentTo = await run(panel(), "({ tab: currentTab(), row: !!document.querySelector('#eggLocks [data-egg-row=\"CommonEgg\"].locked'), flashed: !!document.querySelector('#eggLocks [data-egg-row=\"CommonEgg\"].flash') })");
        // Unlock on the Luck tab: the hatch goes through.
        await run(panel(), "(() => { const s = document.querySelector('#eggLocks [data-egg-lock=\"CommonEgg\"]'); if (s) s.click(); return !!s; })()");
        await wait(1800); // the store writes 1.5 s after a change
        el.savedAfter = readSettings().eggLock;
        const before2 = hatchesSeen();
        await run(game(), "window.__gameSend({ type: 'HatchEgg', slot: 27 })");
        await wait(300);
        // A hatch that goes through brings the warning up too.
        el.afterHatch = await hatchPop();
        await wait(600);
        el.unlockedServerGot = hatchesSeen() - before2;
        // Nothing within 5: no warning, even while hatching.
        await run(panel(), "window.app.luckSet('egg:CommonEgg:Bee', 0)");
        await wait(800);
        el.countdownAfter = await hatchPop();
        await run(panel(), "showTab('alerts')");
        out.eggLock = el;
        const okEL = el.idle == null && /Bee/.test(el.countdown || '') && /2 to go/.test(el.countdown || '') && el.popAt && el.popAt.top < 120 && Math.abs(el.popAt.mid - el.popAt.w / 2) < 4
          && /Rare hatch soon/.test(el.countdown || '') && /Bee/.test(el.afterHatch || '') && el.homeHatch.some((t) => /Bee/.test(t) && /2 to go/.test(t))
          && (el.saved || []).includes('CommonEgg') && (el.obsLocks || []).includes('CommonEgg')
          && el.blocked.serverGot === 0 && /Common Egg is locked/.test(el.blocked.card || '')
          && el.wentTo.tab === 'pity' && el.wentTo.row && (el.savedAfter || []).length === 0 && el.unlockedServerGot === 1 && el.countdownAfter == null;
        if (!okEL) out.errors.push(`egg lock: ${JSON.stringify(el)}`);
      }
      // v0.72.1: counts you typed. 0.72.0 reset them; the newest backup from
      // before it brings them back (once), plus the pulls counted since. And
      // the misses box: a typed count is known; cleared, it waits.
      {
        const T = global.__mgTest;
        const tc = {};
        const l = T.luckRaw();
        delete l.recovered;
        l.counters['egg:SpookyEgg:Toad'] = { v: 0, pulls: 11, hits: 0, known: false };
        const dir = T.backupsDir();
        fs.mkdirSync(dir, { recursive: true });
        const file = require('path').join(dir, 'before-restore-1.json');
        fs.writeFileSync(file, JSON.stringify({ kind: 'magic-garden-loader-backup', version: 1, savedAt: new Date().toISOString(), settings: { luck: { counters: { 'egg:SpookyEgg:Toad': { v: 22, est: false, pulls: 1, hits: 0 } } } } }));
        tc.back = T.recoverTypedLuck();
        tc.again = T.recoverTypedLuck();
        tc.note = (T.alertHistory().slice(-1)[0] || {}).text || null;
        await run(panel(), 'window.app.luckOptions({}).then((v) => { LUCK = v; renderLuck(); return true; })');
        await wait(300);
        tc.row = await run(panel(), "(() => { const r = LUCK.groups.egg.find((g) => g.source === 'SpookyEgg').rows.find((x) => x.target === 'Toad'); return { known: r.known, typed: r.typed, value: r.value }; })()");
        tc.box = await run(panel(), "(document.querySelector('#luckEggs input[data-luck=\"egg:SpookyEgg:Toad\"]') || {}).value || null");
        // Type a Thunder Wolf count in its box; then clear it.
        await run(panel(), "(() => { showTab('pity'); const i = document.querySelector('#luckEggs input[data-luck=\"egg:ThunderEgg:ThunderWolf\"]'); i.focus(); i.value = '12'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
        await wait(600);
        tc.typed = await run(panel(), "(() => { const r = LUCK.groups.egg.find((g) => g.source === 'ThunderEgg').rows[0]; return { known: r.known, typed: r.typed, value: r.value }; })()");
        await run(panel(), "(() => { const i = document.querySelector('#luckEggs input[data-luck=\"egg:ThunderEgg:ThunderWolf\"]'); i.focus(); i.value = ''; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
        await wait(600);
        tc.cleared = await run(panel(), "(() => { const r = LUCK.groups.egg.find((g) => g.source === 'ThunderEgg').rows[0]; return { known: r.known, value: r.value }; })()");
        await run(panel(), "window.app.luckSet('egg:SpookyEgg:Toad', '')");
        await run(panel(), "showTab('alerts')");
        fs.unlinkSync(file);
        out.typedLuck = tc;
        const okTC = tc.back.length === 1 && tc.back[0].v === 32 && tc.again.length === 0 && /Toad \(32\)/.test(tc.note || '')
          && tc.row.known && tc.row.typed && tc.row.value === 32 && tc.box === '32'
          && tc.typed.known && tc.typed.typed && tc.typed.value === 12 && !tc.cleared.known && tc.cleared.value == null;
        if (!okTC) out.errors.push(`typed luck counts: ${JSON.stringify(tc)}`);
      }
      // v0.73.0: the harvest team. Turning Harvesting unlocked on puts it
      // out; off puts the pets before back (unless switched off, or you've
      // changed pets since). Stand-in teams: Farm = Worm pet-1, Dawn = Bunny pet-2.
      {
        const T = global.__mgTest;
        const ht = {};
        const petsOutNow = () => run(game(), "(window.__mgLoaderObserver.sample().mySlot.data.petSlots || []).map((p) => p.petSpecies).join(',')");
        const lockNow = () => run(panel(), 'window.app.harvestGet ? window.app.harvestGet() : LOCK');
        await run(panel(), "window.app.applyTeam('teamA')");
        await wait(3000);
        ht.start = await petsOutNow();
        await run(panel(), "window.app.harvestSet({ team: 'teamB', teamBack: true })");
        await run(panel(), 'window.app.harvestGet ? window.app.harvestGet().then((l) => { LOCK = l; renderLock(); return true; }) : true');
        await wait(400);
        ht.picker = await run(panel(), "(() => { const s = document.getElementById('hvTeam'); return { value: s.value, options: [...s.options].map((o) => o.textContent), backShown: !document.getElementById('hvTeamBackRow').hidden, desc: document.getElementById('hvTeamDesc').textContent }; })()");
        await run(panel(), 'window.app.harvestSet({ mode: { on: true } })');
        await wait(3000);
        ht.on = await petsOutNow();
        ht.before = (await lockNow()).teamBefore;
        await run(panel(), 'window.app.harvestSet({ mode: { on: false } })');
        await wait(3000);
        ht.off = await petsOutNow();
        // Switched off: the harvest team stays.
        await run(panel(), "window.app.harvestSet({ teamBack: false, mode: { on: true } })");
        await wait(3000);
        await run(panel(), 'window.app.harvestSet({ mode: { on: false } })');
        await wait(3000);
        ht.noBack = await petsOutNow();
        // Pets changed while it was on: they stay as you left them.
        await run(panel(), "window.app.applyTeam('teamA')");
        await wait(3000);
        await run(panel(), "window.app.harvestSet({ teamBack: true, mode: { on: true } })");
        await wait(3000);
        ht.on2 = await petsOutNow();
        await run(game(), "window.__mgLoaderObserver.putOut(['pet-3'])");
        await wait(3000);
        ht.changed = await petsOutNow();
        await run(panel(), 'window.app.harvestSet({ mode: { on: false } })');
        await wait(3000);
        ht.afterChanged = await petsOutNow();
        // No team: nothing moves.
        await run(panel(), "window.app.harvestSet({ team: null })");
        await run(panel(), 'window.app.harvestSet({ mode: { on: true } })');
        await wait(2500);
        ht.noTeam = await petsOutNow();
        await run(panel(), 'window.app.harvestSet({ mode: { on: false } })');
        await run(panel(), "window.app.applyTeam('teamA')");
        await wait(2500);
        ht.notes = (T.alertHistory() || []).slice(-12).map((h) => h.text).filter((t) => /Harvesting|harvest team|Back to/.test(t));
        out.harvestTeam = ht;
        const okHT = ht.start === 'Worm' && ht.picker.value === 'teamB' && ht.picker.options.includes('Dawn team') && ht.picker.backShown && /^Goes out when/.test(ht.picker.desc)
          && ht.on === 'Bunny' && (ht.before || []).join() === 'pet-1' && ht.off === 'Worm'
          && ht.noBack === 'Bunny' && ht.on2 === 'Bunny' && ht.changed === 'Sheep' && ht.afterChanged === 'Sheep' && ht.noTeam === 'Sheep'
          && ht.notes.some((t) => /Switched to Dawn team \(Harvesting unlocked\)/.test(t)) && ht.notes.some((t) => /Back to Farm team \(Harvesting locked again\)/.test(t));
        if (!okHT) out.errors.push(`harvest team: ${JSON.stringify(ht)}`);
      }
      {
        const pv = out.petViews;
        const okPV = pv.now.join() === 'your-team-right-now,pets-that-are-out' && pv.food.join() === 'food' && pv.teams.join() === 'your-saved-teams'
          && pv.rank.join() === 'pet-rankings,best-pets-for,pet-growth' && pv.made.join() === 'made-by-your-pets' && pv.jump === 'rank' && pv.saved === 'rank';
        if (!okPV) out.errors.push(`pets views: ${JSON.stringify(pv)}`);
      }
      // The new alerts are listed, and their Test buttons play without an error.
      out.newAlerts = await run(panel(), `(async () => {
        const txt = document.getElementById('itemRules').textContent;
        const errs = [];
        const onErr = (e) => errs.push(String(e.message || e));
        window.addEventListener('error', onErr);
        for (const id of ['xppotion', 'sunflower']) { const b = document.querySelector('[data-test="' + id + '"]'); if (b) b.click(); }
        await new Promise((r) => setTimeout(r, 1500));
        window.removeEventListener('error', onErr);
        return { xp: /XP Potion/.test(txt), sunflower: /Sunflower/.test(txt), sunflowerDesc: /Sunrise chime/.test(txt), buttons: !!document.querySelector('[data-test="xppotion"]') && !!document.querySelector('[data-test="sunflower"]'), errs };
      })()`);
      // "Edit what you want" and a want's icon on the chart open Your wants.
      out.editWants = await run(panel(), `(async () => {
        showTab('money');
        const h2 = document.querySelector('h2[data-fold="money/your-wants"]');
        if (h2 && !h2.classList.contains('folded')) h2.click();
        const folded0 = h2 && h2.classList.contains('folded');
        const btn = document.querySelector('.mc-edit');
        if (btn) btn.click();
        await new Promise((r) => setTimeout(r, 300));
        const openAfterButton = h2 && !h2.classList.contains('folded');
        const icon = document.querySelector('.money-chart [data-edit-want]');
        const id = icon && icon.getAttribute('data-edit-want');
        if (icon) icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 200));
        const row = id ? document.querySelector('.plan-item[data-want="' + id + '"]') : null;
        return { hadButton: !!btn, foldedBefore: folded0, openAfterButton, iconId: id, rowFlashed: !!(row && row.classList.contains('flash')) };
      })()`);
      // Hover read-outs: move the mouse over charts and read the box.
      {
        const hoverRead = async (tab, sel, fx) => {
          const r = await run(panel(), `(() => { showTab('${tab}'); const e = document.querySelector('${sel}'); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width * ${fx}, y: b.top + b.height * 0.45 }; })()`);
          if (!r) return null;
          await wait(300);
          panel().sendInputEvent({ type: 'mouseMove', x: Math.round(r.x), y: Math.round(r.y) });
          await wait(300);
          const text = await run(panel(), "(() => { const t = document.getElementById('chartTip'); return t && !t.hidden ? t.textContent.replace(/\\s+/g, ' ').trim() : null; })()");
          const dots = await run(panel(), `document.querySelectorAll('${sel} .hv-layer circle').length`);
          panel().sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
          await wait(200);
          return { text, dots };
        };
        out.hover = {
          money: await hoverRead('money', '#moneyForesight svg.money-chart', 0.7),
          growth: await hoverRead('money', '#moneyGrowth svg', 0.6),
          worth: await hoverRead('garden', '#worthChart svg', 0.5),
          gone: await run(panel(), "document.getElementById('chartTip').hidden"),
        };
        if (process.env.MG_TEST_DIR) {
          await run(panel(), "showTab('money'); document.querySelector('#moneyGrowth svg') && document.querySelector('#moneyGrowth svg').scrollIntoView({ block: 'center' })");
        }
      }
      // The buy-everything line: crossed once, remembered; the meter shows it.
      const bset = readSettings().budget || {};
      await run(panel(), 'refreshBudget(true)');
      await wait(800);
      out.everything = { crossedAt: Boolean(bset.everythingCrossedAt), best: bset.everythingBest, meter: await run(panel(), "(document.querySelector('.ev-status') || {}).textContent || null"),
        // A new install already past the line: noted quietly, no party.
        celebrated: (readSettings().alertHistory || []).some((a) => /crossed the buy-everything line/.test(a.text || '')) };
      // A picture with three days of made-up procs, to check the chart.
      const fake = {};
      const nowH = Math.floor(T / 3600000);
      for (let i = 0; i < 72; i += 1) fake[nowH - i] = { g: Math.max(0, Math.round(1.2 + Math.sin(i / 4) * 1.2 + (i % 5 === 0 ? 2 : 0))), r: i % 7 === 0 ? 1 : 0, w: 1 };
      for (let i = 30; i < 34; i += 1) delete fake[nowH - i]; // a gap: the game was closed
      await run(panel(), `(() => { GARDEN_STATS = Object.assign({}, GARDEN_STATS, { hourly: ${JSON.stringify(fake)}, hourlySince: ${T - 80 * 3600000} }); GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { eta: { remaining: 94, perHour: 1.21, hours: 77.4, done: false } }); showTab('garden'); GOLD_RANGE = 72; renderGoldRate(); document.getElementById('goldRate').scrollIntoView(); })()`);
      await wait(400);
      fs.writeFileSync((process.env.MG_TEST_DIR || __dirname) + '/gold-rate.png', (await panel().capturePage()).toPNG());
      await run(panel(), "GOLD_RANGE = 12; renderGoldRate(); document.getElementById('goldRate').scrollIntoView();");
      await wait(300);
      fs.writeFileSync((process.env.MG_TEST_DIR || __dirname) + '/gold-rate-12.png', (await panel().capturePage()).toPNG());
      await run(panel(), 'GOLD_RANGE = 12;');
      out.goldRate.text = await run(panel(), "document.getElementById('goldRate').textContent.replace(/\\s+/g, ' ').trim()");
    }
    await run(panel(), "window.app.spotMapSetting(false)");
    await wait(1800); // the store writes 1.5 s after a change
    out.spotMap.settingSaved = readSettings().ui.spotMap;
    out.budget.categories = (b1.periods[1].categories || {}) && { level: b1.periods[1].categories.level, rows: b1.periods[1].categories.rows.map((r) => [r.cat, Math.round(r.perDay / 1e6) / 1e3 + 'B']), keepPct: b1.periods[1].categories.keepPct };
    out.budget.splitText = await run(panel(), "document.getElementById('moneySplit').textContent.replace(/\\s+/g, ' ').slice(0, 200)");
    // Spend or save: the card, the chart, the default wants, a one-tap decor chip and a typed price.
    await run(panel(), "showTab('money'); refreshBudget(true)");
    await wait(900);
    const fsv = await run(panel(), 'BUDGET.foresight');
    out.foresight = {
      plan: readSettings().budget.plan,
      signal: fsv.signal, safe: fsv.safeToSpend, pace: fsv.pace, wallet: fsv.wallet,
      events: fsv.events.map((e) => [e.label, Math.round(e.t * 10) / 10, e.status]),
      cardText: await run(panel(), "document.getElementById('moneyForesight').textContent.replace(/\\s+/g, ' ').slice(0, 300)"),
      dots: await run(panel(), "document.querySelectorAll('#moneyForesight svg circle').length"),
      chips: await run(panel(), "[...document.querySelectorAll('#whatIfChips [data-whatif]')].map((c) => c.textContent.trim())"),
    };
    await run(panel(), "document.querySelector('#whatIfChips [data-whatif]') && document.querySelector('#whatIfChips [data-whatif]').click()");
    await wait(800);
    out.foresight.chipResult = { input: await run(panel(), "document.getElementById('whatIfPrice').value"), text: await run(panel(), "document.getElementById('whatIfResult').textContent"), dashed: await run(panel(), "!!document.querySelector('#moneyForesight path[stroke-dasharray]')") };
    await run(panel(), "(() => { const i = document.getElementById('whatIfPrice'); i.value = '500m'; i.dispatchEvent(new Event('input')); })()");
    await wait(900);
    out.foresight.typed = await run(panel(), "document.getElementById('whatIfResult').textContent");
    await run(panel(), "(() => { const i = document.getElementById('whatIfPrice'); i.value = ''; i.dispatchEvent(new Event('input')); })()");
    await wait(700);
    out.foresight.cleared = await run(panel(), "document.getElementById('whatIfResult').hidden");
    const s3 = readSettings();
    out.budget.saved = { statsItems: Object.keys((s3.shopStats && s3.shopStats.items) || {}), moneyPoints: (s3.moneyHistory || []).length, purchases: s3.purchases && s3.purchases.total, leftovers: { earnHistory: 'earnHistory' in s3, budget: 'budget' in s3 } };
    out.panelErrors = await run(panel(), 'window.__errs || null');
    // Mutations plant by plant (v0.64.0): the rows reach the panel, add up
    // to the garden's own count, and the record keeps them.
    out.plantMuts = await run(panel(), "(() => { const pm = GARDEN_STATUS && GARDEN_STATUS.plantMuts; const b = gardenBucket(GARDEN_STATUS) || {}; const sum = (i) => (pm ? Object.values(pm).reduce((a, r) => a + (r[i] || 0), 0) : null); return { kinds: pm ? Object.keys(pm).length : null, n: sum(0), total: b.total || null, gold: sum(10), bucketGold: b.gold || 0, named: GARDEN_STATUS && GARDEN_STATUS.plantNames ? Object.keys(GARDEN_STATUS.plantNames).length : null }; })()");
    {
      const mh = ((readSettings().garden || {}).mutHistory) || [];
      out.plantMuts.recorded = { readings: mh.length, withRows: mh.filter((p) => p.s).length, full: mh.filter((p) => p.sf).length };
    }
    // The Garden tab's views (v0.64.0): one at a time, remembered.
    out.gardenViews = await run(panel(), "(() => { showTab('garden'); const o = {}; for (const v of ['now', 'mutations', 'map', 'harvest', 'progress']) { document.querySelector(`#gardenViews [data-gv=\"${v}\"]`).click(); o[v] = [...document.querySelectorAll('#tab-garden > h2')].filter((h) => h.offsetParent).length; } document.querySelector('#gardenViews [data-gv=\"map\"]').click(); return o; })()");
    await wait(1500);
    out.gardenViews.saved = readSettings().ui.gardenView;
    await run(panel(), "document.querySelector('#gardenViews [data-gv=\"now\"]').click()");
    // Away from the computer (v0.64.2): notifications held while away and
    // for the catch-up after, then one Welcome back line; one for a weather
    // that's over never pops up; no more than three in half a minute.
    {
      const T = global.__mgTest;
      const iso = (ms) => new Date(Date.now() + ms).toISOString();
      T.resetToasts();
      const pres = { here: T.toastAllowed({}) };
      T.resetToasts();
      await run(panel(), "(() => { try { localStorage.setItem('gb.recapSnap', JSON.stringify({ at: Date.now(), ready: 1, worth: 1 })); } catch (e) {} const b = document.getElementById('recapBar'); b.hidden = true; b.innerHTML = ''; return true; })()");
      T.goAway('locked', Date.now() - 12 * 60000);
      pres.away = T.toastAllowed({});
      pres.awayAgain = T.toastAllowed({});
      pres.held = T.presence().held;
      await wait(300);
      pres.panelAway = await run(panel(), 'Boolean(AWAY)');
      T.comeBack();
      pres.settling = T.toastAllowed({});
      await wait(3500);
      pres.after = T.toastAllowed({});
      pres.over = T.toastAllowed({ endsAt: iso(-1000) });
      T.resetToasts();
      pres.burst = [T.toastAllowed({}), T.toastAllowed({}), T.toastAllowed({}), T.toastAllowed({})];
      T.resetToasts();
      pres.bar = await run(panel(), "(() => { const b = document.getElementById('recapBar'); return { shown: !b.hidden, text: b.innerText.replace(/\\s+/g, ' ').trim() }; })()");
      pres.panelBack = await run(panel(), '!AWAY');
      out.presence = pres;
      const okP = pres.here && !pres.away && !pres.awayAgain && pres.held >= 2 && pres.panelAway && !pres.settling && pres.after && !pres.over
        && pres.burst.join() === 'true,true,true,false' && pres.bar.shown && /Welcome back/.test(pres.bar.text) && /12m|12 m/.test(pres.bar.text) && pres.panelBack;
      if (!okP) out.errors.push(`away from the computer: ${JSON.stringify(pres)}`);
      await run(panel(), "(() => { const b = document.getElementById('recapBar'); b.hidden = true; b.innerHTML = ''; return true; })()");
    }
    // Daily quests (v0.65.0): the owner's quests in words, with help; the
    // reminder an hour before the reset, once a day, only when something's left.
    {
      const T = global.__mgTest;
      const fx = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'fixtures', 'quests-sample.json'), 'utf8'));
      const dq = JSON.parse(JSON.stringify(fx.dailyQuests));
      const now = Date.now();
      dq.dayUTC = new Date(now).toISOString().slice(0, 10);
      const v = T.questsView({ dailyQuests: dq, gardenPlants: [{ i: 0, sp: 'Ube', s: [['gold', 100, 1, 1]] }], gardenEggs: [{ egg: 'LegendaryEgg', at: now - 1 }], pets: [], crops: [] });
      const reset = v.resetAt;
      const s1 = readSettings();
      const before = s1.quests && s1.quests.remindDay;
      if (T.resetQuestRemind) T.resetQuestRemind();
      const tooEarly = T.checkQuestReminder(reset - 2 * 3600000, v);
      const said = T.checkQuestReminder(reset - 55 * 60000, v);
      const again = T.checkQuestReminder(reset - 50 * 60000, v);
      const doneView = Object.assign({}, v, { day: 'test-done', left: 0, toClaim: 0 });
      const nothingLeft = T.checkQuestReminder(reset - 55 * 60000, doneView);
      await wait(1800);
      const s2 = readSettings();
      out.quests = {
        texts: v.quests.map((x) => x.text), help: v.quests.map((x) => x.help), bonus: v.bonus, tier: v.tier,
        history: Boolean(s2.quests && s2.quests.days && s2.quests.days[dq.dayUTC]), tooEarly, said, again, nothingLeft, before,
        tab: await run(panel(), "(() => { showTab('quests'); QX_SIG = ''; renderQuests(); return { cards: [...document.querySelectorAll('#questList .qx-card')].map((c) => c.innerText.replace(/\\n+/g, ' | ')), head: document.getElementById('questHead').innerText.replace(/\\n+/g, ' | '), dot: !document.getElementById('questNavDot').hidden, stats: document.getElementById('questStats').innerText.replace(/\\n+/g, ' | ').slice(0, 300) }; })()"),
      };
      const okQ = v.quests.map((x) => x.text).join('|') === 'Buy 1 Rare Egg|Harvest 15 Divine or rarer crops|Hatch 10 eggs' && v.tier === 4 && out.quests.history
        && tooEarly === undefined && /2 quests left, for the bonus \(3× Amberlit Potion\)/.test(said || '') && again === undefined && nothingLeft === undefined
        // From the stand-in game, through the page and the app, to the tab.
        && /Harvest 2 Carrot crops/.test(out.quests.tab.cards[0]) && /ripe/.test(out.quests.tab.cards[0])
        && /Hatch 3 eggs/.test(out.quests.tab.cards[1]) && /1 ready to hatch/.test(out.quests.tab.cards[1]) && /Ready to claim!/.test(out.quests.tab.cards[2])
        && /Gold Potion/.test(out.quests.tab.cards[3]) && out.quests.tab.dot && /4/.test(out.quests.tab.stats)
        // The Haunt Quest (v0.66.0), from the stand-in game's spookyQuest.
        && out.quests.tab.cards.length === 5 && /Snap 8 haunts with your Camera/.test(out.quests.tab.cards[4]) && /3 \/ 8/.test(out.quests.tab.cards[4])
        && /Black Cat/.test(out.quests.tab.cards[4]) && /Haunt Event ends/.test(out.quests.tab.cards[4]) && /2 \| Haunt Quests/.test(out.quests.tab.stats);
      if (!okQ) out.errors.push(`daily quests: ${JSON.stringify(out.quests)}`);
      await run(panel(), "showTab('garden')");
    }
    // The Haunt Event (v0.66.0): the game's tables read from past 25 files
    // and a file only named in another; night learned from the Spooky Shop;
    // night on the Weather tab; time to max strength on the Pets tab.
    {
      const T = global.__mgTest;
      const haunt = {};
      for (let i = 0; i < 60 && !T.catalogInfo(); i += 1) await wait(500);
      haunt.catalog = T.catalogInfo();
      haunt.reader = await run(game(), "(() => { const d = window.__mgLoaderObserver.catalogDebug || {}; return { readCount: d.readCount, urlCount: d.urlCount, found: d.found, snippets: Object.keys(d.snippets || {}) }; })()");
      const moth = T.petLookup('Moth');
      haunt.mothHours = moth && moth.hours;
      // Night from the game's clock (v0.67.0): his night alert at 17:40:03.
      const t0 = Date.parse('2026-10-17T17:40:00Z');
      T.resetNight();
      const onNow = T.nightInfo(t0 + 15 * 60000);
      const after = T.nightInfo(t0 + 31 * 60000);
      // The Spooky Shop opening out of hours still counts, and marks the event.
      T.resetEvents();
      const odd = Date.now() - 60000;
      T.noteNight({ shops: { spooky: { open: true, items: [] } } }, odd);
      const shopNight = T.nightInfo(odd + 60000);
      T.resetNight();
      haunt.night = { onNow, after, shopNight, theme: T.themeNow(Date.parse('2026-10-20T12:00:00Z')), themeNextYear: T.themeNow(Date.parse('2027-10-12T00:00:00Z')) };
      haunt.panelNight = await run(panel(), `(() => {
        const soon = nightHtml({ night: { on: false, known: true, predicted: true, next: Date.now() + 3 * 3600000 + 60000, endsAt: Date.now() + 3.5 * 3600000 }, hauntEnds: Date.now() + 1e9 });
        const on = nightHtml({ night: { on: true, known: true, since: Date.now() - 60000, endsAt: Date.now() + 29 * 60000, next: Date.now() + 10 * 3600000 }, hauntEnds: Date.now() + 1e9 });
        const unknown = nightHtml({ night: { on: false, known: false }, hauntEnds: Date.now() + 1e9 });
        const over = nightHtml({ night: { on: false, known: true, next: Date.now() + 3600000 }, hauntEnds: null });
        const tiles = weatherTiles({ night: { on: false, known: true, predicted: true, next: Date.now() + 3600000 }, hauntEnds: Date.now() + 1e9 }).join('');
        const div = document.createElement('div');
        const txt = (h) => { div.innerHTML = h; return div.innerText.replace(/\\s+/g, ' ').trim(); };
        const rule = RULES.find((r) => r.id === 'night');
        return { soon: txt(soon), on: txt(on), unknown: txt(unknown), over, tiles: txt(tiles), rule: rule ? { kind: rule.kind, desc: ruleDesc(rule), sample: sampleAlert(rule).itemName } : null };
      })()`);
      const fx = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'fixtures', 'pets-1016.json'), 'utf8'));
      const growth = require('../pet-growth').view(fx.allPets, fx.allPets.filter((p) => fx.active.includes(p.id)), 'clear');
      haunt.growthLive = await run(panel(), "(() => { const g = GARDEN_STATUS && GARDEN_STATUS.growth; return g ? { rows: Array.isArray(g.rows), base: g.basePerMin } : null; })()");
      haunt.growthTab = await run(panel(), `(() => {
        showTab('pets');
        showPetsView('rank', false);
        const G = ${JSON.stringify(growth)};
        PG_SIG = '';
        renderPetGrowth(Object.assign({}, GARDEN_STATUS, { growth: G, allPets: ${JSON.stringify(fx.allPets)} }));
        const box = document.getElementById('petGrowth');
        const rows = [...box.querySelectorAll(':scope > .pg-list > .pg-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim());
        const out = { intro: box.querySelector('.pg-intro').innerText.replace(/\\s+/g, ' '), rows: rows.slice(0, 3), n: rows.length, more: (box.querySelector('details.more summary') || {}).innerText || '', foot: box.querySelector('.pg-foot').innerText, fold: (document.querySelector('h2[data-fold="pets/pet-growth"] .fold-sum') || {}).textContent || '' };
        PG_SIG = '';
        renderPetGrowth(GARDEN_STATUS);
        showPetsView('now', false);
        showTab('garden');
        return out;
      })()`);
      out.haunt = haunt;
      const g = haunt.growthTab;
      const okH = haunt.catalog && haunt.catalog.pets >= 5 && haunt.reader.readCount > 25 && haunt.reader.urlCount >= 31 && haunt.mothHours === 96
        && onNow.on && onNow.bonus === 20 && after.on === false && after.next === t0 + 10 * 3600000 && shopNight.on
        && haunt.night.theme && haunt.night.theme.id === 'spooky' && haunt.night.themeNextYear === null
        && /Next night (about |at ).* in 3h 0[01]m, for 30 minutes/.test(haunt.panelNight.soon) && /Night now until/.test(haunt.panelNight.on) && /Spooky Shop is open/.test(haunt.panelNight.on)
        && /every 10 hours for 30 minutes/.test(haunt.panelNight.unknown) && haunt.panelNight.over === '' && /Night/.test(haunt.panelNight.tiles) && /about/.test(haunt.panelNight.tiles)
        && haunt.panelNight.rule && haunt.panelNight.rule.kind === 'weather' && /Night has fallen/.test(haunt.panelNight.rule.desc) && haunt.panelNight.rule.sample === 'Spooky Egg'
        && haunt.growthLive && haunt.growthLive.rows && haunt.growthLive.base === 60
        && /XP Boost on the pets out \(your 2 Peacocks\)/.test(g.intro) && /grow \d(\.\d)?× as fast/.test(g.intro)
        && /OUT/.test(g.rows[0]) && /STR 58 → 86/.test(g.rows[0]) && /with your team/.test(g.rows[0]) && g.n === 8 && /more growing/.test(g.more)
        && /fully grown/.test(g.foot) && /growing · next in/.test(g.fold);
      if (!okH) out.errors.push(`haunt event: ${JSON.stringify(haunt)}`);
    }
    // Daily quests in the sample (v0.64.2): quest-looking state is found
    // wherever it sits, and a quest address the game fetches is noted.
    out.questProbe = await run(game(), `(async () => {
      const o = window.__mgLoaderObserver;
      const slots = (o.state && o.state.child && o.state.child.data && o.state.child.data.userSlots) || [];
      const me = slots.find((sl) => sl && (sl.userId === o.selfPlayerId || sl.playerId === o.selfPlayerId || (sl.data && sl.data.userId === o.selfPlayerId)));
      const prev = me && me.data ? me.data.dailyQuests : undefined;
      if (me && me.data) me.data.dailyQuests = { resetsAt: 1, quests: [{ id: 'q1', progress: 2, target: 5 }] };
      try { await fetch('/platform/v1/quests-probe-test'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 600));
      const q = o.sample().quests;
      if (me && me.data) { if (prev === undefined) delete me.data.dailyQuests; else me.data.dailyQuests = prev; }
      return { foundKeys: Object.keys(q.found || {}), json: (q.found && q.found['slot.data.dailyQuests'] || {}).json, fetches: (q.fetches || []).map((f) => f.url), gameFetchStillWorks: typeof window.fetch === 'function' };
    })()`);
    if (!(out.questProbe.foundKeys.includes('slot.data.dailyQuests') && /"target":5/.test(out.questProbe.json || '') && out.questProbe.fetches.some((u) => /quests-probe-test/.test(u)))) out.errors.push(`quest probe: ${JSON.stringify(out.questProbe)}`);
    // A shard on the garden map: its own colour and its real name.
    out.shardOnMap = await run(panel(), "(() => { showTab('garden'); renderGarden(); const cells = [...document.querySelectorAll('#spotMap i.s')]; const other = [...document.querySelectorAll('#spotMap i.o')].map((c) => c.title); return { shards: cells.map((c) => c.title), somethings: other, keyHasShard: !!document.querySelector('.spot-key .k-s') }; })()");
    // Stepping out for weather asks first: Ignore skips that event, Confirm
    // steps out (then come back). Last, because stepping out swaps the page.
    {
      const T = global.__mgTest;
      const iso = (ms) => new Date(Date.now() + ms).toISOString();
      const ev1 = { kind: 'rain', startsAt: iso(50000), endsAt: iso(300000) };
      T.askStepOut(ev1, Date.now() + 20000);
      await wait(700);
      const card = await run(game(), "(document.getElementById('__mgStepOut') || {}).textContent || null");
      await run(game(), "document.querySelector('#__mgStepOut [data-act=\"ignore\"]').click()");
      await wait(700);
      const afterIgnore = { asking: T.stepAsk(), parked: Boolean(T.parked()), skipped: T.skipEvent() === ev1.startsAt, cardGone: await run(game(), "!document.getElementById('__mgStepOut')") };
      const ev2 = { kind: 'rain', startsAt: iso(60000), endsAt: iso(300000) };
      T.askStepOut(ev2, Date.now() + 20000);
      await wait(700);
      await run(game(), "document.querySelector('#__mgStepOut [data-act=\"confirm\"]').click()");
      await wait(1200);
      const afterConfirm = { parked: T.parked() && T.parked().kind, asking: T.stepAsk() };
      T.rejoin();
      await wait(1500);
      // (v0.60.0) No answer: nothing happens. The question goes when its
      // time is up, and the app never steps out by itself.
      const ev3 = { kind: 'rain', startsAt: new Date(Date.now() + 1500).toISOString(), endsAt: new Date(Date.now() + 60000).toISOString() };
      T.askStepOut(ev3, Date.now());
      await wait(21500);
      const unanswered = { parked: Boolean(T.parked()), asking: T.stepAsk() };
      if (unanswered.parked) out.errors.push('step away: the app stepped out by itself');
      // (v0.64.0) One question per spell of weather you don't want.
      try { await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })"); } catch (e) { /* the page may be loading */ }
      await run(panel(), "window.app.setSettings(Object.assign({}, S, { logoff: Object.assign({}, S.logoff, { enabled: true, kinds: ['rain', 'thunder'] }) }))");
      await wait(1000);
      const spells = {};
      // Not answering counts as staying in: that spell isn't asked about again.
      spells.unansweredStayed = Boolean(T.stayedIn() && T.stayedIn().startsAt === ev3.startsAt);
      T.askStepOut(ev3, Date.now());
      await wait(300);
      spells.notAskedAgain = T.stepAsk() === null;
      // The owner's bug: the game still reports Rain just after the feed's
      // spell ended. That's the same spell, over: never asked about.
      T.noteFeedSpell({ kind: 'rain', startsAt: iso(-10 * 60000), endsAt: iso(-4000) });
      T.checkLogoffFromGame('Rain');
      T.checkLogoffFromGame('Rain');
      await wait(300);
      spells.afterEnd = T.stepAsk();
      // With no feed spell for it, the game's report stands in, steadily:
      // one question, and Stay in sticks.
      T.checkLogoffFromGame('Thunderstorm');
      await wait(300);
      spells.gameAsk = T.stepAsk() ? T.stepAsk().label : null;
      T.stepOutAnswer('ignore');
      await wait(300);
      T.checkLogoffFromGame('Thunderstorm');
      T.checkLogoffFromGame('Thunderstorm');
      await wait(300);
      spells.stayInSticks = T.stepAsk() === null;
      // The feed comes back mid-thunder with the real spell: still the one
      // you stayed in for.
      T.noteFeedSpell({ kind: 'thunder', startsAt: iso(-30000), endsAt: iso(300000) });
      T.checkLogoffFromGame('Thunderstorm');
      await wait(300);
      spells.feedBack = T.stepAsk() === null;
      T.checkLogoffFromGame('Sunny');
      const okSpells = spells.unansweredStayed && spells.notAskedAgain && spells.afterEnd === null && spells.gameAsk === 'Thunderstorm' && spells.stayInSticks && spells.feedBack;
      if (!okSpells) out.errors.push(`step away, one question per spell: ${JSON.stringify(spells)}`);
      // (v0.60.5) Reconnect when the weather ends: on the stepped-away page it
      // shows a few seconds in; pressed, the app reconnects when it ends; not
      // pressed, Safe to join and no reconnect. Only that page can ask.
      // (Every call here has a time limit, and after a rejoin the game page is
      // given time to load before it's used: a call into a page that's still
      // loading waits for it to finish.)
      const runT = (w, js, ms = 6000) => Promise.race([run(w, js), wait(ms).then(() => { throw new Error(`timed out: ${js.slice(0, 70)}`); })]);
      const settled = async () => {
        for (let i = 0; i < 60; i += 1) {
          const g = game();
          if (g && !g.isLoading()) {
            try {
              if (await Promise.race([run(g, 'Boolean(window.__mgLoaderObserver)'), wait(2000).then(() => false)])) return true;
            } catch (err) { /* not yet */ }
          }
          await wait(500);
        }
        return false;
      };
      const evR = { kind: 'rain', startsAt: iso(-1000), endsAt: iso(120000) };
      T.askStepOut(evR, Date.now());
      await wait(700);
      await runT(game(), "document.querySelector('#__mgStepOut [data-act=confirm]').click()");
      await wait(2000);
      const shownEarly = await runT(away(), "(() => { const r = document.getElementById('recon'); return Boolean(r && !r.hidden); })()");
      await wait(4500);
      const shownLater = await runT(away(), "(() => { const r = document.getElementById('recon'); return { shown: Boolean(r && !r.hidden), text: r ? r.innerText.trim() : null, popped: r ? r.classList.contains('pop') : false }; })()");
      // The game view, held before the intruder (also showing parked.html)
      // exists, so it can't be mistaken for it.
      const awayView = away();
      const { BrowserWindow } = require('electron');
      const intruder = new BrowserWindow({ show: false, webPreferences: { preload: require('path').join(__dirname, '..', 'preload-game.js'), sandbox: true } });
      await intruder.loadFile(require('path').join(__dirname, '..', 'parked.html'), { query: { weather: 'Rain', until: String(Date.now() + 60000) } });
      await intruder.webContents.executeJavaScript('window.mgLoaderBridge.parkedReconnect(true)');
      await wait(600);
      const ignoredFromElsewhere = !T.autoBack();
      intruder.destroy();
      await runT(awayView, "document.getElementById('reconBtn').click()");
      await wait(800);
      const pressed = { autoBack: T.autoBack(), text: await runT(awayView, "document.getElementById('reconOn').innerText.trim()") };
      T.weatherOver();
      await wait(2500);
      const reconnected = { parked: Boolean(T.parked()), url: (game() || away() || { getURL: () => '' }).getURL().slice(0, 40) };
      // Not pressed this time: Safe to join, still stepped away.
      const gameBack = await settled();
      const evS = { kind: 'rain', startsAt: iso(-1000), endsAt: iso(120000) };
      T.askStepOut(evS, Date.now());
      await wait(700);
      await runT(game(), "document.querySelector('#__mgStepOut [data-act=confirm]').click()");
      await wait(2000);
      T.weatherOver();
      await wait(2000);
      const notPressed = { parked: Boolean(T.parked()), safe: await runT(away(), "document.body.classList.contains('safe')"), autoBack: T.autoBack() };
      T.rejoin();
      await wait(1500);
      // Step away now (v0.64.2): for the weather that's on (or starting
      // within 10 minutes), with Reconnect when it ends; a break when clear.
      const pick = {
        feed: (T.weatherToStepAwayFrom(Date.now(), { current: { kind: 'snow', startsAt: iso(-60000), endsAt: iso(300000) }, upcoming: [] }, null) || {}).kind,
        game: (T.weatherToStepAwayFrom(Date.now(), { current: { kind: 'clear' }, upcoming: [] }, { connected: true, weatherKind: 'thunder' }) || {}).kind,
        soon: (T.weatherToStepAwayFrom(Date.now(), { current: null, upcoming: [{ kind: 'rain', startsAt: iso(300000), endsAt: iso(900000) }] }, null) || {}).kind,
        later: T.weatherToStepAwayFrom(Date.now(), { current: null, upcoming: [{ kind: 'rain', startsAt: iso(1800000), endsAt: iso(2400000) }] }, null),
        clear: T.weatherToStepAwayFrom(Date.now(), { current: { kind: 'clear' }, upcoming: [] }, { connected: true, weatherKind: 'clear' }),
      };
      await settled();
      T.stepAwayNowFor({ kind: 'rain', startsAt: iso(-1000), endsAt: iso(9000) });
      await wait(2000);
      const mEarly = await runT(away(), "(() => { const r = document.getElementById('recon'); return Boolean(r && !r.hidden); })()");
      await wait(4500);
      const mLater = await runT(away(), "(() => { const r = document.getElementById('recon'); return { shown: Boolean(r && !r.hidden), popped: r ? r.classList.contains('pop') : false, title: document.title }; })()");
      await runT(away(), "document.getElementById('reconBtn').click()");
      await wait(800);
      const mPressed = T.autoBack();
      await wait(9000);
      const manual = { pick, mEarly, mLater, mPressed, back: !T.parked() };
      const okM = pick.feed === 'snow' && pick.game === 'thunder' && pick.soon === 'rain' && pick.later === null && pick.clear === null && !mEarly && mLater.shown && mLater.popped && mPressed && manual.back;
      if (!okM) out.errors.push(`step away now with reconnect: ${JSON.stringify(manual)}`);
      await settled();
      const reconnect = { shownEarly, shownLater, ignoredFromElsewhere, pressed, reconnected, gameBack, notPressed, manual };
      const okR = !shownEarly && shownLater.shown && shownLater.popped && ignoredFromElsewhere && pressed.autoBack && !reconnected.parked && /magicgarden/.test(reconnected.url) && notPressed.parked && notPressed.safe && !notPressed.autoBack;
      if (!okR) out.errors.push(`reconnect when the weather ends: ${JSON.stringify(reconnect)}`);
      out.stepOut = { card, afterIgnore, afterConfirm, backIn: !T.parked(), unanswered, spells, reconnect };
    }
    // Pets named by hatch number (v0.75.0). Nothing until the app has seen
    // the game rename a pet once (the stand-in's own RenamePet, which the app
    // can't know beforehand); then each new pet with no name gets the game's
    // eggs-hatched count, a Double Hatch's extra pet the next number, a pet
    // that has a name keeps it, and off means off. The game's own commands
    // after the app's are renumbered with no gap or repeat.
    {
      const TN = globalThis.__mgTest;
      for (let i = 0; i < 40 && !(game() && !game().isLoading()); i += 1) await wait(500);
      await wait(7500);
      const renames = () => serverLog().filter((l) => l.renamed).map((l) => l.renamed + '=' + l.name + (l.ok ? '' : '!'));
      const count = () => run(game(), 'window.__mgLoaderObserver.naming.count');
      const r0 = renames().length;
      const logAt = serverLog().length;
      await run(panel(), 'window.app.namingSet({ on: true })');
      await wait(1200);
      const before = { learned: Boolean(TN.namingRaw().shape), line: await run(panel(), "document.getElementById('namingLine').textContent") };
      await run(game(), "window.__gameSend({ type: '__TestHatch', species: 'Toad' })");
      await wait(2500);
      const unlearnedRenames = renames().slice(r0);
      await run(game(), "window.__gameSend({ type: 'RenamePet', petItemId: 'pet-3', name: 'Bob' })");
      await wait(2500);
      const shape = TN.namingRaw().shape;
      const c1 = await count();
      await run(game(), "window.__gameSend({ type: '__TestHatch', species: 'Turtle' })");
      await wait(3000);
      await run(game(), "window.__gameSend({ type: '__TestHatch', species: 'Bee', double: 'Snail' })");
      await wait(4000);
      await run(game(), "window.__gameSend({ type: '__TestHatch', species: 'Ostrich', name: 'Hot Rod' })");
      await wait(2500);
      await run(game(), "window.__gameSend({ type: '__TestHatch', species: 'Worm' })");
      await wait(3000);
      const onRenames = renames().slice(r0);
      const line = await run(panel(), "document.getElementById('namingLine').textContent");
      const sw = await run(panel(), "document.getElementById('namingOn').getAttribute('aria-checked')");
      await run(panel(), 'window.app.namingSet({ on: false })');
      await wait(1200);
      await run(game(), "window.__gameSend({ type: '__TestHatch', species: 'Pig' })");
      await wait(3000);
      const offRenames = renames().slice(r0 + onRenames.length);
      // (v0.76.0; v0.77.0 picked by the app, ranked) The cute style: a
      // Double Hatch of two Pigs and a Rainbow Goat get three different safe
      // names, none a number; then "Name my unnamed pets" names every pet
      // with no name, and only those, and a second press has nothing to do.
      await run(panel(), "window.app.namingSet({ on: true, style: 'cute' })");
      await wait(1200);
      await run(game(), "window.__gameSend({ type: '__TestHatch', species: 'Pig', double: 'Pig' })");
      await wait(5000);
      await run(game(), "window.__gameSend({ type: '__TestHatch', species: 'Goat', mutations: ['Rainbow'] })");
      await wait(5000);
      const cuteRenames = renames().slice(r0 + onRenames.length + offRenames.length).map((x) => x.split('=')[1]);
      const SAFE = /^[A-Za-z]+( [A-Za-z]+)*$/;
      const cute = { names: cuteRenames, line: await run(panel(), "document.getElementById('namingLine').textContent"), seg: await run(panel(), "(() => { const b = document.querySelector('#namingStyle [aria-checked=true]'); return b ? b.dataset.val : null; })()"), recent: (TN.namingRaw().recent || []).slice(-3) };
      const okCute = cuteRenames.length === 3 && cuteRenames.every((n) => SAFE.test(n) && n.length <= 12) && new Set(cuteRenames).size === 3 && cute.seg === 'cute' && /7 named so far/.test(cute.line) && cute.recent.join() === cuteRenames.join();
      if (!okCute) out.errors.push(`cute pet names: ${JSON.stringify(cute)}`);
      await wait(2500);
      const petsNow = () => run(panel(), "(GARDEN_STATUS.allPets || []).map((p) => ({ id: p.id, name: p.name || null }))");
      const beforeBulk = await petsNow();
      const unnamedIds = beforeBulk.filter((p) => !p.name).map((p) => p.id).sort();
      const r1 = renames().length;
      const press = await run(panel(), "(async () => { const r = await window.app.namingBulk(); return { ok: r.ok, count: r.count, active: r.bulk && r.bulk.active }; })()");
      const midLine = await run(panel(), "(() => { renderNaming(); return document.getElementById('namingBulkLine').textContent; })()");
      for (let i = 0; i < 30 && renames().length - r1 < unnamedIds.length; i += 1) await wait(1000);
      await wait(4000);
      const bulkRenames = renames().slice(r1);
      const bulkIds = bulkRenames.map((x) => x.split('=')[0]).sort();
      const afterBulk = await petsNow();
      const again = await run(panel(), "(async () => { const r = await window.app.namingBulk(); return { ok: r.ok, count: r.count }; })()");
      const bulk = { unnamedIds, press, midLine, bulkRenames, view: await run(panel(), "(async () => (await window.app.namingGet()).bulk)()"), endLine: await run(panel(), "(() => { renderNaming(); return document.getElementById('namingBulkLine').textContent; })()"), stillUnnamed: afterBulk.filter((p) => !p.name).length, again };
      const keptNames = beforeBulk.filter((p) => p.name).every((p) => (afterBulk.find((q) => q.id === p.id) || {}).name === p.name);
      const okBulk = unnamedIds.length >= 2 && press.ok && press.count === unnamedIds.length && /Naming \d+ of \d+/.test(midLine) && bulkIds.join() === unnamedIds.join()
        && bulkRenames.every((x) => SAFE.test(x.split('=')[1])) && keptNames && bulk.stillUnnamed === 0 && bulk.view && !bulk.view.active && bulk.view.done === unnamedIds.length
        && /All your pets have names/.test(bulk.endLine) && again.ok && again.count === 0;
      if (!okBulk) out.errors.push(`name my unnamed pets: ${JSON.stringify(bulk)}`);
      out.namingBulk = bulk;
      const seqs = serverLog().slice(logAt).filter((l) => l.in === 'QuinoaCommand').map((l) => l.seq);
      const gapless = seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1);
      const h = (n) => 'hatched-' + n;
      // (onRenames[0] is your own rename of pet-3; the app's follow.)
      const ids = onRenames.slice(1).map((x) => x.split('=')[0]);
      const first = ids.length ? Number(ids[0].split('-')[1]) : 0;
      const want = [`${h(first)}=${c1 + 1}`, `${h(first + 1)}=${c1 + 2}`, `${h(first + 2)}=${c1 + 3}`, `${h(first + 4)}=${c1 + 5}`];
      out.naming = { before, unlearnedRenames, shape, c1, onRenames, want, line, sw, offRenames, cute, seqs, gapless, raw: TN.namingRaw() };
      const okN = !before.learned && /rename any pet once/.test(before.line) && unlearnedRenames.length === 0
        && shape && shape.type === 'RenamePet' && shape.idField === 'petItemId' && shape.nameField === 'name'
        && onRenames.slice(1).join() === want.join() && onRenames[0] === 'pet-3=Bob'
        && /4 named so far/.test(line) && /"\d+"/.test(line) && sw === 'true' && offRenames.length === 0 && gapless && seqs.length >= 8;
      if (!okN) out.errors.push(`pets named by hatch number: ${JSON.stringify(out.naming)}`);
    }
  } catch (e) {
    out.errors.push('probe: ' + (e.stack || e));
  }
  fs.writeFileSync((process.env.MG_TEST_DIR || __dirname) + '/result.json', JSON.stringify(out, null, 2));
  app.exit(0);
});
