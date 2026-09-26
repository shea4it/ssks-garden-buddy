'use strict';

// Screenshot tour: runs the real app against the stand-in game, opens every
// tab with every section unfolded, and captures each screenful into
// $MG_TEST_DIR/tour/<tab>-<n>.png (stitch them with tests/stitch.py).
// Run like the harness (see tests/README.md), with tests/tour.js instead.

const { app, webContents } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('host-resolver-rules', 'MAP magicgarden.gg 127.0.0.1:8443');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('no-sandbox');

const OUT = path.join(process.env.MG_TEST_DIR || __dirname, 'tour');
const find = (pred) => webContents.getAllWebContents().find((w) => !w.isDestroyed() && pred(w.getURL()));
const panel = () => find((u) => u.endsWith('control.html'));
const run = (w, js) => w.executeJavaScript(js, true);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
process.on('uncaughtException', (e) => errors.push(String(e.stack || e)));

require('../main.js');

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    await wait(14000); // the game connects, the garden reports, the feed is polled
    const p = panel();
    // MG_FRESH=1: exactly what a brand-new player sees (no sample, no
    // injected Money numbers, the Money tab still locked).
    const FRESH = Boolean(process.env.MG_FRESH);
    // Make the Money tab visible (it's locked for a new install).
    if (!FRESH) {
      await run(p, "window.app.budgetSet({ unlockMode: 'on' }).then((v) => { BUDGET = v; renderBudget(); })");
      await wait(800);
    }
    // A real garden (MG_SAMPLE = a garden-sample.json): its status replaces
    // the stand-in's for every render, so the Garden and Pets tabs show real
    // crops, pets and mutations.
    if (!FRESH && process.env.MG_SAMPLE && fs.existsSync(process.env.MG_SAMPLE)) {
      const st = JSON.parse(fs.readFileSync(process.env.MG_SAMPLE, 'utf8')).lastStatus;
      await run(p, `(() => { window.__SAMPLE = ${JSON.stringify(st)}; const real = renderGarden; renderGarden = function () { GARDEN_STATUS = Object.assign({}, window.__SAMPLE, { at: Date.now() }); return real.apply(this, arguments); }; renderGarden(); })()`);
      await wait(600);
    }
    // The owner's garden (his 0.34.0 sample) in the Money tab, estimate mode
    // from his pets' gold rate, with refreshes paused so it stays.
    if (!FRESH) {
      const budgetMod = require('../budget');
      const bs = { alerts: { custom: [], disabled: [] }, shopStats: budgetMod.emptyStats(), moneyHistory: [], worthHistory: [], purchases: null, budget: {} };
      budgetMod.seedWants(bs);
      // A believable past week: crops ripening, a harvest-and-sell 4 days
      // ago, then a Mini Wizard Tower, a Moonbinder, a Wind Turner, a
      // Dawnbinder and some smaller buys, ending at today's 36B + 411B.
      {
        const T = Date.now();
        const buys = [[-3.2, 'Mini Wizard Tower', 75e9, []], [-2.2, 'Moonbinder', 50e9, ['moonbinder']], [-1.5, 'Wind Turner', 100e9, ['windturner']], [-1.0, 'Dawnbinder', 10e9, ['dawnbinder']], [-0.6, 'Mini Fairy Keep', 25e9, []], [-0.3, 'Wind Spinner', 10e9, []]];
        bs.purchases = { log: buys.map(([d, name, coins, rules]) => ({ t: T + d * 86400000, id: name.replace(/ /g, ''), name, qty: 1, coins, rules })) };
        bs.moneyHistory = [];
        bs.worthHistory = [];
        for (let i = 0; i <= 7 * 48; i += 1) {
          const t = T - 7 * 86400000 + i * 1800000;
          const d = (t - T) / 86400000;
          const spent = buys.filter((b) => b[0] <= d).reduce((a, b) => a + b[2], 0);
          const wallet = d < -4 ? 6e9 : 6e9 + 300e9 - spent;
          const rv = d < -4 ? 250e9 + (d + 7) * 20e9 : 10e9 + (d + 4) * 100e9;
          bs.moneyHistory.push({ t, c: Math.round(wallet), s: 0, f: 0 });
          bs.worthHistory.push({ t, v: rv + 70e9, r: Math.round(rv / 3.39e9), rv: Math.round(rv), n: 270 });
        }
      }
      const g = { total: 270, special: 176, gold: 85, rainbow: 91, ready: 121, readyValue: 410.6675e9, growingValue: 76.59e9, growingPotential: 143.95e9,
        missing: { grow: 3, size: 10, color: 94, hydro: 3, lunar: 81 }, have: { ripe: 267, size: 260, hydro: 267, lunar: 189, color: 176 },
        harvestHours: null, goldPerHour: 1.21, stepHours: { ripe: 1, size: null, hydro: 0, lunar: 2.5, color: 77.4, nextLunar: { name: 'Amber Moon', startsAt: 'x' } } };
      const ctx = { wallet: 35982699984, gardenWorth: 487.26e9, garden: g, pace: 0, gardenLoaded: true, readyRule: { size: true, color: true, hydro: true, lunar: true } };
      const fsReal = budgetMod.view({ settings: bs, ctx }).foresight;
      const cropSt = budgetMod.cropStage(ctx);
      const gameSt = budgetMod.stage(ctx, 35982699984 + 487.26e9);
      await run(p, `(() => { window.__realRefresh = refreshBudget; refreshBudget = async () => {}; BUDGET = Object.assign({}, BUDGET, { unlocked: true, foresight: ${JSON.stringify(fsReal)}, stage: ${JSON.stringify(gameSt)}, cropStage: ${JSON.stringify(cropSt)} }); renderBudget(); })()`);
    }
    const tabs = await run(p, "[...document.querySelectorAll('nav [data-tab]')].map((b) => b.dataset.tab)");
    tabs.push('alerts-open');
    const index = [];
    for (const tab0 of tabs) {
      const tab = tab0;
      await run(p, `showTab('${tab0.replace('-open', '')}')`);
      await wait(700);
      // As a user first sees it (default folds); 'alerts-open' unfolds all.
      if (tab0.endsWith('-open')) await run(p, "[...document.querySelectorAll('main > section:not([hidden]) > h2.fold.folded')].forEach((h) => h.click())");
      await wait(600);
      const dims = await run(p, "(() => { const m = document.querySelector('main'); m.scrollTop = 0; return { h: m.scrollHeight, v: m.clientHeight }; })()");
      let n = 0;
      for (let top = 0; top < dims.h && n < 12; top += Math.max(200, dims.v - 40)) {
        await run(p, `document.querySelector('main').scrollTop = ${top}`);
        await wait(250);
        const img = await p.capturePage();
        const file = path.join(OUT, `${tab}-${String(n).padStart(2, '0')}.png`);
        fs.writeFileSync(file, img.toPNG());
        index.push({ tab, n, file, top });
        n += 1;
      }
    }
    // The money chart with "How to read this" open.
    if (!FRESH) {
      await run(p, "(() => { showTab('money'); document.querySelector('main').scrollTop = 0; MC_HOW_OPEN = true; renderBudget(); })()");
      await wait(500);
      fs.writeFileSync(path.join(OUT, 'how-open.png'), (await p.capturePage()).toPNG());
      await run(p, "(() => { MC_HOW_OPEN = false; renderBudget(); })()");
    }
    // The buy-everything meter short of the line (62%, best 80%).
    if (!FRESH) await run(p, "(() => { showTab('money'); const e = BUDGET.foresight.everything; Object.assign(e, { ratio: 0.62, income: e.perDay * 0.62, best: 0.8, crossedAt: null }); renderBudget(); document.querySelector('.ev-box').scrollIntoView({ block: 'center' }); })()");
    await wait(500);
    fs.writeFileSync(path.join(OUT, 'meter-short.png'), (await p.capturePage()).toPNG());
    fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ index, errors }, null, 1));
  } catch (err) {
    errors.push(String(err.stack || err));
    fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ errors }, null, 1));
  }
  app.exit(0);
});
