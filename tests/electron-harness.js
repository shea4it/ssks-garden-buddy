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
  if (!fs0.existsSync(f)) fs0.writeFileSync(f, JSON.stringify({ worthHistory: worth, moneyHistory: money.concat([{ t: T - 26 * H0, c: 0.8e9, s: 0, f: 0 }, { t: T - 2 * H0, c: 1e9, s: 0, f: 0 }, { t: T - H0, c: 1.5e9, s: 1e9, f: 0 }]) }));
} catch (e) { out.errors.push('seed: ' + e); }
require('../main.js');
app.whenReady().then(async () => {
  const T0 = Date.now();
  try {
    await wait(5000);
    out.steps.push({ gameUrl: game() && game().getURL(), panelUrl: panel() && panel().getURL() });
    out.observer = await run(game(), 'Boolean(window.__mgLoaderObserver) && { welcomes: window.__mgLoaderObserver.welcomes, sockets: window.__mgLoaderObserver.sockets, canSend: !!window.__mgLoaderObserver.gameSocket }');
    const s1 = readSettings();
    out.afterBacklog = { syncConnection: s1.pity.syncConnection, lastEggsHatched: s1.pity.lastEggsHatched, totalHatches: s1.pity.totalHatches, trackedBase: s1.pity.trackedBase, gameBase: s1.pity.gameBase };
    // Stale copy of the settings as the panel would hold it: try to clobber pity/rooms/harvestLock through settings:set.
    const stale = JSON.parse(JSON.stringify(s1));
    stale.pity.totalHatches = 1; stale.rooms = { saved: [{ id: 'HACK' }], clipboard: false }; stale.harvestLock = { on: true, species: [] }; stale.worthHistory = [{ t: 1, v: 1 }];
    stale.alerts.volume = 42; stale.ui = { tab: 'rooms', panel: 'window', panelWidth: 999 }; stale.logoff = { enabled: true, kinds: ['rain'], rejoin: true, leadSeconds: 30 };
    const saved = await run(panel(), `window.app.setSettings(${JSON.stringify(stale)})`);
    out.whitelist = { volume: saved.alerts.volume, tab: saved.ui.tab, panel: saved.ui.panel, panelWidth: saved.ui.panelWidth, pityTotal: saved.pity.totalHatches, rooms: saved.rooms, harvestOn: saved.harvestLock && saved.harvestLock.on, worth: saved.worthHistory, logoff: saved.logoff.enabled, clipboard: saved.rooms.clipboard };
    await wait(6000); // the patch at 6 s and the status after it (2 s debounce) and the coins patch at 9 s
    const s2 = readSettings();
    out.afterPatch = { lastEggsHatched: s2.pity.lastEggsHatched, totalHatches: s2.pity.totalHatches, coinsSaved: s2.pity.syncConnection };
    out.status = await run(panel(), 'window.app.getGarden().then((g) => g && g.status && ({ session: g.status.session, eggsHatched: g.status.eggsHatched, connected: g.status.connected, foundSelf: g.status.foundSelf }))');
    // A team swap through the observer path still sends and translates (sanity for the wrapper, unchanged code).
    out.openExternal = 'not exercised';
    // Spending vs. earning: the feed has been counted, money is measured, and a
    // purchase made in the game page is noticed, priced and attributed.
    // Watch the hand map for 26 s (the stand-in hands over the pot 21 s after
    // its Welcome and the seed again at 26 s), sending the purchase meanwhile.
    const mapState = () => run(game(), "(() => { const b = document.getElementById('mg-spot-map'); return { present: !!b, shown: !!b && b.style.display !== 'none', text: b ? b.lastChild.textContent : null, held: window.__mgLoaderObserver.sample().held }; })()");
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
      progress: await run(panel(), "document.getElementById('moneyProgress').textContent"),
      unlockedSaved: readSettings().budget && readSettings().budget.unlocked,
    };
    // Extras: show it now / keep it hidden / automatic.
    const modeCheck = async (mode) => {
      const v2 = await run(panel(), `window.app.budgetSet({ unlockMode: '${mode}' }).then((v) => { BUDGET = v; budgetFetchedAt = Date.now(); renderBudget(); return v; })`);
      await wait(200);
      return { mode: v2.unlockMode, unlocked: v2.unlocked, tabShown: await run(panel(), "!document.querySelector('nav [data-tab=\"money\"]').hidden"), progress: await run(panel(), "document.getElementById('moneyProgress').textContent"), chip: await run(panel(), "document.querySelector('#moneyUnlock .chip.on') && document.querySelector('#moneyUnlock .chip.on').dataset.unlock") };
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
    // Weather teams: A out; Dawn swaps in B; clear skies (nothing set) swaps A back.
    const teamCmds = () => serverLog().filter((l) => l.cmd === 'ApplyPetTeam').map((l) => l.teamId);
    const S0 = await run(panel(), 'S');
    await run(panel(), `window.app.setSettings(Object.assign({}, S, { weatherTeams: Object.assign({}, S.weatherTeams, { enabled: true, dawn: 'teamB', clear: null }) }))`);
    await wait(2500);
    const t0 = teamCmds().length;
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Dawn' })");
    await wait(4500);
    const afterDawn = teamCmds().slice(t0);
    const ret = readSettings().weatherReturn;
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
    await wait(4500);
    const afterClear = teamCmds().slice(t0);
    // A swap by hand during the weather is left alone at the end.
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Dawn' })");
    await wait(4500);
    await run(game(), "window.__gameSend({ type: 'ApplyPetTeam', teamId: 'teamA' })");
    await wait(2500);
    const beforeClear2 = teamCmds().length;
    await run(game(), "window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
    await wait(4500);
    out.weatherTeams = { afterDawn, remembered: ret, afterClear, byHandThenClear: teamCmds().slice(beforeClear2), returnCleared: readSettings().weatherReturn === undefined, hadS: Boolean(S0) };
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
      // The saved teams dropdown (Pets tab): pets named in each option; the card follows the choice.
      await run(panel(), "showTab('pets'); renderPets()");
      await wait(400);
      out.teams = { options: await run(panel(), "[...document.querySelectorAll('#teamSelect option')].map((o) => o.textContent)"), card: await run(panel(), "(document.querySelector('.team-card-pick .rule-name') || {}).textContent") };
      await run(panel(), "(() => { const s = document.getElementById('teamSelect'); s.value = s.options[s.options.length - 1].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
      await wait(300);
      out.teams.afterPick = await run(panel(), "(document.querySelector('.team-card-pick .rule-name') || {}).textContent");
      out.teams.stageInGarden = await run(panel(), "!!document.querySelector('#tab-garden #moneyStage') && !document.querySelector('#tab-money #moneyStage')");
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
      // The buy-everything line: crossed once, remembered; the meter shows it.
      const bset = readSettings().budget || {};
      await run(panel(), 'refreshBudget(true)');
      await wait(800);
      out.everything = { crossedAt: Boolean(bset.everythingCrossedAt), best: bset.everythingBest, meter: await run(panel(), "(document.querySelector('.ev-status') || {}).textContent || null") };
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
    await wait(300);
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
  } catch (e) {
    out.errors.push('probe: ' + (e.stack || e));
  }
  fs.writeFileSync((process.env.MG_TEST_DIR || __dirname) + '/result.json', JSON.stringify(out, null, 2));
  app.exit(0);
});
