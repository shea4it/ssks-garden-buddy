'use strict';

// Chart harness (v0.51): runs the real app against the stand-in game, sets
// up the Money tab's forecast chart (and the Garden tab's mutation chart) in
// several data scenarios, and for each one:
//   - screenshots the chart (tests/shots/chart-<name>.png),
//   - measures every label on it and reports any that overlap each other,
//     run off the chart, or sit on an icon (tests/chart-result.json),
//   - hovers at a few spots, including over the want icons, and records
//     what pops up (the chart's read-out, and whether a native tooltip
//     would too).
// Run like the sound harness (tests/README.md), with tests/chart-shots.js.
const { app, webContents } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('host-resolver-rules', 'MAP magicgarden.gg 127.0.0.1:8443');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('no-sandbox');

const SHOTS = path.join(__dirname, 'shots');
const out = { errors: [], console: [], scenarios: {} };
process.on('uncaughtException', (e) => out.errors.push('uncaught: ' + (e.stack || e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (pred) => webContents.getAllWebContents().find((w) => !w.isDestroyed() && pred(w.getURL()));
const panel = () => find((u) => u.endsWith('control.html'));
const run = (js) => panel().executeJavaScript(js, true);

require('../main.js');

// The Money tab's state, as tests/tour.js builds it: a believable past
// week (a harvest-and-sell 4 days ago, then six buys) and the owner's
// 0.34.0 garden.
function moneyState(opts = {}) {
  const budgetMod = require('../budget');
  const bs = { alerts: { custom: [], disabled: [] }, shopStats: budgetMod.emptyStats(), moneyHistory: [], worthHistory: [], purchases: null, budget: {} };
  budgetMod.seedWants(bs);
  if (opts.moreWants) {
    // Every alert item wanted (a crowded icon row).
    const ids = require('../alerts').RULES.filter((x) => x.kind === 'item').map((x) => x.id);
    bs.budget.plan = bs.budget.plan.concat(ids.filter((id) => !bs.budget.plan.includes(id))).slice(0, 12);
  }
  const T = Date.now();
  const buys = [[-3.2, 'Mini Wizard Tower', 75e9, []], [-2.2, 'Moonbinder', 50e9, ['moonbinder']], [-1.5, 'Wind Turner', 100e9, ['windturner']], [-1.0, 'Dawnbinder', 10e9, ['dawnbinder']], [-0.6, 'Mini Fairy Keep', 25e9, []], [-0.3, 'Wind Spinner', 10e9, []]];
  bs.purchases = { log: buys.map(([d, name, coins, rules]) => ({ t: T + d * 86400000, id: name.replace(/ /g, ''), name, qty: 1, coins, rules })) };
  const days = opts.pastDays == null ? 7 : opts.pastDays;
  for (let i = 0; i <= days * 48; i += 1) {
    const t = T - days * 86400000 + i * 1800000;
    const d = (t - T) / 86400000;
    const spent = buys.filter((b) => b[0] <= d).reduce((a, b) => a + b[2], 0);
    const wallet = d < -4 ? 6e9 : 6e9 + 300e9 - spent;
    const rv = d < -4 ? 250e9 + (d + 7) * 20e9 : 10e9 + (d + 4) * 100e9;
    bs.moneyHistory.push({ t, c: Math.round(wallet), s: 0, f: 0 });
    bs.worthHistory.push({ t, v: rv + 70e9, r: Math.round(rv / 3.39e9), rv: Math.round(rv), n: 270 });
  }
  const g = { total: 270, special: 176, gold: 85, rainbow: 91, ready: 121, readyValue: 410.6675e9, growingValue: 76.59e9, growingPotential: 143.95e9,
    missing: { grow: 3, size: 10, color: 94, hydro: 3, lunar: 81 }, have: { ripe: 267, size: 260, hydro: 267, lunar: 189, color: 176 },
    harvestHours: null, goldPerHour: 1.21, stepHours: { ripe: 1, size: null, hydro: 0, lunar: 2.5, color: 77.4, nextLunar: { name: 'Amber Moon', startsAt: 'x' } } };
  const ctx = { wallet: opts.wallet || 35982699984, gardenWorth: 487.26e9, garden: g, pace: 0, gardenLoaded: true, readyRule: { size: true, color: true, hydro: true, lunar: true } };
  const fsx = budgetMod.view({ settings: bs, ctx }).foresight;
  if (opts.whatIf) return { fsx, whatIf: budgetMod.whatIf(bs, ctx, opts.whatIf) };
  return fsx;
}

// Every label and icon on a chart, and which overlap. Text boxes are
// measured on screen; a pair "overlaps" when their boxes intersect by more
// than 1.5 px each way.
const MEASURE = `(sel) => {
  const svg = document.querySelector(sel);
  if (!svg) return null;
  const sb = svg.getBoundingClientRect();
  const items = [];
  for (const el of svg.querySelectorAll('text')) {
    if (el.closest('.hv-layer') || el.closest('[data-edit-want]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    items.push({ kind: 'text', what: el.textContent.trim().slice(0, 40), r: [r.left, r.top, r.right, r.bottom] });
  }
  // The chart's dots (a line's "now" point, a purchase, a run-out): text on
  // one is a collision too.
  for (const el of svg.querySelectorAll('circle')) {
    if (el.closest('.hv-layer') || el.closest('[data-edit-want]') || Number(el.getAttribute('r')) < 3) continue;
    const r = el.getBoundingClientRect();
    items.push({ kind: 'dot', what: 'dot@' + Math.round(r.left - sb.left) + ',' + Math.round(r.top - sb.top), r: [r.left, r.top, r.right, r.bottom] });
  }
  for (const el of svg.querySelectorAll('[data-edit-want] circle[r="9"], .icon-hit')) {
    const r = el.getBoundingClientRect();
    items.push({ kind: 'icon', what: (el.closest('[data-edit-want]') || el).getAttribute('data-edit-want') || 'icon', r: [r.left, r.top, r.right, r.bottom] });
  }
  const hits = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i].r; const b = items[j].r;
      const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      const kinds = [items[i].kind, items[j].kind].sort().join('+');
      if (ox > 1.5 && oy > 1.5 && !['icon+icon', 'dot+dot', 'dot+icon'].includes(kinds)) hits.push(items[i].what + '  <->  ' + items[j].what);
      else if (items[i].kind === 'text' && items[j].kind === 'text' && oy > 4 && ox > -3) hits.push('touching: ' + items[i].what + '  |  ' + items[j].what);
    }
  }
  const outside = items.filter((it) => it.kind === 'text' && (it.r[0] < sb.left - 1 || it.r[2] > sb.right + 1 || it.r[1] < sb.top - 1 || it.r[3] > sb.bottom + 1)).map((it) => it.what);
  const titles = svg.querySelectorAll('title').length;
  return { labels: items.filter((i) => i.kind === 'text').map((i) => i.what), overlaps: hits, outside, nativeTitles: titles, size: [Math.round(sb.width), Math.round(sb.height)] };
}`;

async function shotOf(sel, name, pad = 8) {
  const r = await run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  if (!r) return null;
  await wait(350);
  const img = await panel().capturePage({ x: Math.max(0, Math.floor(r.x - pad)), y: Math.max(0, Math.floor(r.y - pad)), width: Math.ceil(r.w + pad * 2), height: Math.ceil(r.h + pad * 2) });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, `chart-${name}.png`), img.toPNG());
  return r;
}

// Hover at (fx, fy) of the element's box: what shows.
async function hoverAt(sel, fx, fy, name) {
  const r = await run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width * ${fx}, y: b.top + b.height * ${fy} }; })()`);
  if (!r) return null;
  await wait(300);
  panel().sendInputEvent({ type: 'mouseMove', x: Math.round(r.x), y: Math.round(r.y) });
  await wait(400);
  const seen = await run(`(() => {
    const tip = document.getElementById('chartTip');
    const el = document.elementFromPoint(${Math.round(r.x)}, ${Math.round(r.y)});
    const native = el && el.closest && el.closest('g, circle, path, text') && (el.closest('g') || el).querySelector && (el.closest('g') || el).querySelector(':scope > title');
    const card = document.getElementById('mcPop');
    return { chartTip: tip && !tip.hidden ? tip.innerText.replace(/\\n+/g, ' | ') : null,
      nativeTitle: native ? native.textContent.slice(0, 60) : null,
      iconPop: card && !card.hidden ? card.innerText.replace(/\\n+/g, ' | ') : null };
  })()`);
  const img = await panel().capturePage();
  fs.writeFileSync(path.join(SHOTS, `chart-hover-${name}.png`), img.toPNG());
  panel().sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
  await wait(200);
  return seen;
}

async function moneyScenario(name, fsx, extraJs = '') {
  await run(`(() => { BUDGET = Object.assign({}, BUDGET, { unlocked: true, foresight: ${JSON.stringify(fsx)} }); WHATIF = null; ${extraJs} renderBudget(); showTab('money'); })()`);
  await wait(600);
  const sel = '#moneyForesight svg.money-chart';
  const res = { measure: await run(`(${MEASURE})(${JSON.stringify(sel)})`) };
  await shotOf('#moneyForesight .fs-chart', `money-${name}`);
  await run("document.querySelector('main').scrollTop = 0");
  await shotOf('#moneyForesight .fs-top', `money-${name}-top`, 6);
  return res;
}

app.whenReady().then(async () => {
  try {
    await wait(12000);
    panel().on('console-message', (e, lvl, msg) => { if (lvl >= 2) out.console.push(msg.slice(0, 300)); });
    await run("(() => { const b = document.getElementById('shareAskNo'); if (b) b.click(); })()");
    await run("window.app.budgetSet({ unlockMode: 'on' }).then((v) => { BUDGET = v; renderBudget(); })");
    await wait(800);
    // Keep the numbers still: no refreshes over the scenarios.
    await run('window.__realRefresh = refreshBudget; refreshBudget = async () => {}; true');

    const MODE = process.env.MG_CHART || 'money';
    if (MODE === 'money' || MODE === 'all') {
      const week = moneyState();
      const S1 = await moneyScenario('week', week);
      S1.hover = {
        plot: await hoverAt('#moneyForesight svg.money-chart', 0.6, 0.3, 'plot'),
        past: await hoverAt('#moneyForesight svg.money-chart', 0.15, 0.3, 'past'),
        icon: await run(`(() => { const g = document.querySelector('#moneyForesight svg.money-chart [data-edit-want]'); if (!g) return null; const b = g.getBoundingClientRect(); const s = document.querySelector('#moneyForesight svg.money-chart').getBoundingClientRect(); return { fx: (b.left + b.width / 2 - s.left) / s.width, fy: (b.top + b.height / 2 - s.top) / s.height }; })()`),
      };
      if (S1.hover.icon) S1.hover.iconSeen = await hoverAt('#moneyForesight svg.money-chart', S1.hover.icon.fx, S1.hover.icon.fy, 'icon');
      out.scenarios.week = S1;
      out.scenarios.shortPast = await moneyScenario('short-past', moneyState({ pastDays: 0.25 }));
      out.scenarios.noPast = await moneyScenario('no-past', moneyState({ pastDays: 0 }));
      out.scenarios.crowded = await moneyScenario('crowded', moneyState({ moreWants: true }));
      out.scenarios.poor = await moneyScenario('poor', moneyState({ wallet: 2e9 }));
      // "Can I buy this?" for 300B: the dotted "without it" line appears.
      const wi = moneyState({ whatIf: 300e9 });
      out.scenarios.whatIf = await moneyScenario('whatif', wi.fsx, `WHATIF = ${JSON.stringify(wi.whatIf)};`.replace('WHATIF = null; ', ''));
      out.scenarios.whatIf.hasWithout = await run("Boolean(document.querySelector('#moneyForesight svg.money-chart path[stroke-dasharray=\"2 4\"]'))");
      // Buying everything runs out: the purple line dips under zero.
      const ro = moneyState();
      if (ro.everything && ro.everything.line) {
        ro.everything.line = ro.everything.line.map(([t, v]) => [t, v - 700e9 * Math.min(1, t / 6)]);
        const hit = ro.everything.line.find(([t, v]) => v < 0);
        ro.everything.runsOut = hit ? { t: hit[0], at: new Date(Date.now() + hit[0] * 86400000).toISOString() } : null;
      }
      out.scenarios.runsOut = await moneyScenario('runs-out', ro);
    }
    if (MODE === 'alerts') {
      // Alerts that come together are one announcement (v0.53.4). speak and
      // play are swapped for loggers: what's said and each sound's length,
      // in order.
      await run("(() => { window.__log = []; speak = async (t) => { window.__log.push('say: ' + t); await wait(40); }; play = async (s) => { window.__log.push('sound ' + (Math.round(s * 10) / 10) + 's'); await wait(15); }; return true; })()");
      const burst = (spec, split) => run(`(async () => {
        const mk = (x) => { if (x.raw) return x.raw; const r = RULES.find((q) => q.label === x.label || q.id === x.id); return { ruleId: r.id, label: r.label, kind: r.kind, tier: (S.alerts.levels || {})[r.id] || r.tier, sound: r.sound || null, itemName: x.itemName }; };
        window.__log = [];
        const list = ${JSON.stringify(spec)}.map(mk);
        const t0 = Date.now();
        if (${split ? 'true' : 'false'}) { enqueue(list.slice(0, 1)); await wait(200); enqueue(list.slice(1)); } else enqueue(list);
        await wait(60);
        while (playing) await wait(40);
        return { log: window.__log.slice(), took: Date.now() - t0 };
      })()`);
      const al = {};
      al.amberShop = await burst([{ id: 'amber' }, { label: 'Moonbinder' }, { label: 'Dawnbinder' }, { label: 'Starweaver' }, { label: 'Amber Egg' }, { label: 'Emberbloom' },
        { raw: { ruleId: 'petgold', label: 'Gold', kind: 'pet' } }, { raw: { ruleId: 'petgold', label: 'Gold', kind: 'pet' } }, { raw: { ruleId: 'hatchspecies', label: 'Rare pet', kind: 'pet', itemName: 'Capybara' } }]);
      al.twoItems = await burst([{ label: 'Moonbinder' }, { label: 'Starweaver' }]);
      al.oneItem = await burst([{ label: 'Dawnbreaker' }]);
      al.splitArrival = await burst([{ id: 'amber' }, { label: 'Moonbinder' }, { label: 'Emberbloom' }], true);
      // A Dawn shop with Ube in it (the owner's report, v0.53.7), and each alone.
      al.dawnUbe = await burst([{ id: 'dawn' }, { label: 'Ube' }]);
      al.ubeAlone = await burst([{ label: 'Ube' }]);
      al.dawnAlone = await burst([{ id: 'dawn' }]);
      al.dawnUbeSplit = await burst([{ id: 'dawn' }, { label: 'Ube' }], true);
      al.ruleUbe = await run("(() => { const r = RULES.find((q) => q.label === 'Ube' || q.id === 'ube'); return r ? { id: r.id, label: r.label, kind: r.kind, tier: r.tier, sound: r.sound } : null; })()");
      al.ruleDawn = await run("(() => { const r = RULES.find((q) => q.id === 'dawn'); return r ? { id: r.id, label: r.label, kind: r.kind, tier: r.tier, sound: r.sound } : null; })()");
      // The alert trail in the diagnostic sample (v0.53.7): the panel's
      // reports for the bursts above, and main's entries for any real alert
      // the stand-in's shop set off.
      await wait(3000);
      const samplePath = await run('window.app.gardenSample()');
      try {
        const smp = JSON.parse(fs.readFileSync(typeof samplePath === 'string' ? samplePath : samplePath.file || samplePath.path, 'utf8'));
        const lg = (smp.alertLog && smp.alertLog.log) || [];
        al.trail = { panel: lg.filter((e) => e.from === 'panel').slice(-4), main: lg.filter((e) => e.from === 'main').slice(-3), history: (smp.alertLog.history || []).slice(-3), settings: smp.alertLog.settings };
      } catch (err) {
        al.trail = { error: String(err), samplePath };
      }
      out.alerts = al;
    }
    if (MODE === 'owner') {
      // The owner's garden (tests/fixtures/garden-layout.json, v0.53.6): the
      // Garden map's to-do in the panel, and the binder map in the game
      // during a Dawn and an Amber Moon.
      const fx = require('./fixtures/garden-layout.json');
      const gp = require('../garden-plan');
      const plan = gp.plan(fx.plants, fx.occupied);
      const plantAt = new Map(fx.plants.map((p) => [p.i, p]));
      const kinds = {};
      for (const i of fx.occupied) kinds[i] = plantAt.has(i) ? ['p', plantAt.get(i).sp] : ['d', 'Decor'];
      const ow = {};
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      if (gw) await gw.loadURL('about:blank').catch(() => {});
      await wait(1200);
      await run(`(() => { renderGarden = function () {}; S.ui = Object.assign({}, S.ui, { gardenMap: 'todo' }); GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { at: Date.now(), gardenTiles: ${JSON.stringify(kinds)}, plan: ${JSON.stringify(plan)} }); showTab('garden'); const h2 = document.querySelector('h2[data-fold="garden/garden-map"]'); if (h2 && h2.classList.contains('folded')) h2.click(); GM_SEL = 107; spotHtml = ''; renderSpots(GARDEN_STATUS); document.getElementById('spotMap').scrollIntoView({ block: 'start' }); })()`);
      await wait(500);
      ow.todo = await run("document.getElementById('spotCount').innerText + ' | ' + document.getElementById('gmSummary').innerText");
      ow.tile107 = await run("document.getElementById('gmTile').innerText.replace(/\\n+/g, ' | ')");
      ow.binderOutlines = await run("document.querySelectorAll('#spotMap i.binder').length");
      await shotOf('.card:has(#spotMap)', 'owner-todo', 4);
      // Back to the game, with the owner's tiles in the observer's state.
      if (gw) await gw.loadURL('https://magicgarden.gg/r/TEST').catch(() => {});
      await wait(9000);
      const grun = (js) => gw.executeJavaScript(js, true);
      const tilesJs = `(() => {
        const obs = window.__mgLoaderObserver; const found = []; const seen = new Set();
        const walk = (o, d) => { if (!o || typeof o !== 'object' || seen.has(o) || d > 9) return; seen.add(o); if (o.tileObjects && typeof o.tileObjects === 'object' && !Array.isArray(o.tileObjects)) found.push(o); for (const k of Object.keys(o)) walk(o[k], d + 1); };
        walk(obs.state, 0);
        const fx = ${JSON.stringify(fx)};
        const T = {};
        const at = new Map(fx.plants.map((p) => [p.i, p]));
        for (const i of fx.occupied) {
          const p = at.get(i);
          T[i] = p ? { objectType: 'plant', species: p.sp, slots: p.s.map(([m, size, ripe]) => ({ species: p.sp, mutations: m ? m.split(',') : [], size, endTime: ripe ? Date.now() - 1000 : Date.now() + 1e7 })) } : { objectType: 'decor', decorId: 'WoodBench' };
        }
        for (const f of found) f.tileObjects = T;
        return found.length;
      })()`;
      const showEv = async (kind, shot) => {
        await grun(tilesJs);
        await grun(`window.__mgLoaderObserver.setBinderMap(${JSON.stringify({ on: true, event: { kind, endsAt: Date.now() + 8 * 60000 } })})`);
        await wait(600);
        const r = await grun("(() => { const b = document.getElementById('mg-map'); if (!b || b.style.display === 'none') return null; const q = b.getBoundingClientRect(); return { text: b.innerText.replace(/\\s+/g, ' ').trim(), pulses: b.querySelectorAll('i.pulse').length, rect: [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)] }; })()");
        if (r) {
          const img = await gw.capturePage();
          const [x, y, w, hh] = r.rect;
          fs.writeFileSync(path.join(SHOTS, shot), img.crop({ x: Math.max(0, x - 6), y: Math.max(0, y - 6), width: w + 12, height: hh + 12 }).toPNG());
        }
        return r;
      };
      fs.mkdirSync(SHOTS, { recursive: true });
      ow.dawn = await showEv('dawn', 'owner-binder-dawn.png');
      ow.amber = await showEv('amber', 'owner-binder-amber.png');
      out.owner = ow;
    }
    if (MODE === 'sellpets') {
      // \"In a full room\" with your best sell pets (v0.53.13).
      const sp = {};
      sp.real = await run('(() => { const t = GARDEN_STATUS && GARDEN_STATUS.idealSell; return t ? { petPart: t.petPart, pets: t.pets.map((p) => p.species) } : null; })()');
      const ideal = { petPart: 1.313, sellPct: 6.4, dh: 4, refund: 15.8, allOut: false, notOut: ['Capybara'], outNow: { petPart: 1.064 },
        pets: [{ species: 'Pig', sell: 3.2, dh: 0, refund: 0, out: true }, { species: 'Pig', sell: 3.2, dh: 0, refund: 0, out: true }, { species: 'Capybara', sell: 0, dh: 4, refund: 15.8, out: false }] };
      // The Garden card's lines, drawn right away from a status with that team.
      sp.garden = await run(`(() => { GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { at: Date.now(), idealSell: ${JSON.stringify(ideal)}, room: Object.assign({}, GARDEN_STATUS.room, { players: 2 }) }); showTab('garden'); renderGarden(); return [...document.querySelectorAll('#tab-garden .note')].map((n) => n.innerText).filter((t) => /room/i.test(t)); })()`);
      sp.estimate = await run(`(() => { GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { at: Date.now(), idealSell: ${JSON.stringify(ideal)}, room: Object.assign({}, GARDEN_STATUS.room, { players: 2 }) }); showTab('money'); renderBudget(); return [...document.querySelectorAll('.bonus-line')].map((n) => n.innerText.replace(/\\s+/g, ' ').trim()); })()`);
      // The reminder (v0.54.2): the Capybara in the hutch, then all out.
      sp.gardenMissing = await run(`(() => { GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { at: Date.now(), idealSell: ${JSON.stringify(ideal)} }); showTab('garden'); renderGarden(); return [...document.querySelectorAll('#tab-garden .note')].map((n) => n.innerText).filter((t) => /sell pets/i.test(t)); })()`);
      sp.moneyMissing = await run(`(() => { BUDGET = Object.assign({}, BUDGET, { saleMult: 1.5 * 1.313 }); showTab('money'); renderBudget(); return [...document.querySelectorAll('#moneyGrowth .note')].map((n) => n.innerText).filter((t) => /sell pets/i.test(t)); })()`);
      const allOut = Object.assign({}, ideal, { allOut: true, notOut: [], outNow: { petPart: 1.313 }, pets: ideal.pets.map((p) => Object.assign({}, p, { out: true })) });
      sp.gardenAllOut = await run(`(() => { GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { at: Date.now(), idealSell: ${JSON.stringify(allOut)} }); showTab('garden'); renderGarden(); return [...document.querySelectorAll('#tab-garden .note')].map((n) => n.innerText).filter((t) => /Best sell pets/i.test(t)); })()`);
      sp.moneyAllOut = await run(`(() => { showTab('money'); renderBudget(); return [...document.querySelectorAll('#moneyGrowth .note')].map((n) => n.innerText).filter((t) => /Best sell pets/i.test(t)); })()`);
      out.sellpets = sp;
    }
    if (MODE === 'numbers') {
      // Every money number on the Garden and Money tabs from one set of
      // inputs: the owner's garden at the time of their sample (v0.53.14).
      const budgetMod = require('../budget');
      const T = Date.now();
      const g = { name: 'garden', total: 270, ready: 225, value: 639.3e9, ripeValue: 639.3e9, readyValue: 574.3e9, growingValue: 65e9, growingPotential: 123.9e9,
        gold: 124, rainbow: 111, special: 235, mature: 270, matureKnown: true, sized: 270, sizeSum: 270 * 98, atMax: 260,
        missing: { grow: 0, size: 10, color: 21, hydro: 0, lunar: 18 }, have: { ripe: 270, size: 260, hydro: 270, lunar: 252, color: 235 },
        mutations: {}, unpriced: 0, unpricedSpecies: {}, goldPerHour: 1.21, stepHours: { ripe: 0, size: null, hydro: 0, lunar: 2.5, color: 17 } };
      const s = { alerts: { custom: [], disabled: [] }, shopStats: budgetMod.emptyStats(), moneyHistory: [], worthHistory: [], purchases: { log: [] }, budget: {} };
      budgetMod.seedWants(s);
      for (let i = 0; i <= 7 * 48; i += 1) {
        const t = T - 7 * 86400000 + i * 1800000;
        s.moneyHistory.push({ t, c: 11.4e9, s: 100e9 + i * 1e8, f: 0 });
        s.worthHistory.push({ t, v: 639.3e9, r: 225, rv: 574.3e9, n: 270 });
      }
      // Counted at what you'd get (v0.53.15): a full room x the owner's best
      // sell team (x1.313), and two sales already checked.
      const M = Number(process.env.MG_SALEMULT || 1.5 * 1.313);
      s.saleChecks = [{ t: T - 3600000, coins: 99e9, base: 60e9, crops: 20, roomPct: 50, sellPct: 10, expected: 99e9, ratio: 1 }, { t: T - 1800000, coins: 64e9, base: 40e9, crops: 12, roomPct: 50, sellPct: 10, expected: 66e9, ratio: 64 / 66 }];
      const ctx = { wallet: 11.4e9, gardenWorth: 639.3e9, garden: g, pace: 0, gardenLoaded: true, saleMult: M, readyRule: { size: true, color: true, hydro: true, lunar: true } };
      const view = budgetMod.view({ settings: s, ctx });
      const nm = {};
      nm.garden = await run(`(() => { renderGarden = function () {}; BUDGET = Object.assign({}, BUDGET, ${JSON.stringify(view)}, { unlocked: true }); GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { at: Date.now(), wallet: { coins: 11.4e9 }, crops: [${JSON.stringify(g)}], room: { players: 1 }, idealSell: { petPart: 1.313, pets: [{ species: 'Pig' }, { species: 'Pig' }, { species: 'Capybara' }] } }); showTab('garden'); return true; })()`);
      nm.gardenCard = await run(`(() => { const b = gardenBucket(GARDEN_STATUS); renderCropCard(GARDEN_STATUS, b); return [...document.querySelectorAll('#tab-garden .worth, #tab-garden .note')].map((n) => n.innerText).filter((t) => /worth|ready|room|average/i.test(t)).slice(0, 5); })()`);
      nm.money = await run(`(() => { BUDGET = Object.assign({}, BUDGET, ${JSON.stringify(view)}, { unlocked: true }); showTab('money'); renderBudget(); const q = (s) => [...document.querySelectorAll(s)].map((n) => n.innerText.replace(/\\s+/g, ' ').trim()); return { why: q('#moneyForesight .fs-why'), big: q('#moneyForesight .m-big').slice(0, 1), estimate: q('#moneyGrowth .bonus-line, #moneyGrowth .est-full, #moneyGrowth [class*="est"]').slice(0, 6), growth: q('#moneyGrowth .m-big, #moneyGrowth .m-legend, #moneyGrowth .note').slice(0, 6) }; })()`);
      await run("(() => { READY_OPEN = true; renderBudget(); document.getElementById('moneyGrowth').scrollIntoView({ block: 'start' }); return true; })()");
      await wait(400);
      await shotOf('#moneyGrowth', 'numbers-growth', 6);
      nm.view = { saleMult: view.saleMult, saleCheck: view.saleCheck, netWorth: view.netWorth, safe: view.foresight.safeToSpend, available: view.foresight.available, fullValue: view.foresight.estimate && view.foresight.estimate.fullValue, perCrop: view.foresight.estimate && view.foresight.estimate.perCrop, canMature: view.foresight.estimate && view.foresight.estimate.canMature };
      out.numbers = nm;
    }
    if (MODE === 'screens') {
      // The app at a 13\" laptop's size (150% and 125% scaling) and a 1440p
      // monitor's (v0.53.16), with the worst case over the game: an Amber
      // Moon (binder map), riding the Ostrich (capture map) and holding a
      // pot (open spots), on the owner's garden.
      const { BaseWindow } = require('electron');
      const fx = require('./fixtures/garden-layout.json');
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const win = BaseWindow.getAllWindows().find((w) => w.contentView && w.contentView.children.length >= 2) || BaseWindow.getAllWindows()[0];
      const crowd = `(() => {
        const obs = window.__mgLoaderObserver; const gardens = []; const slots = []; const seen = new Set();
        const walk = (o, d) => { if (!o || typeof o !== 'object' || seen.has(o) || d > 9) return; seen.add(o); if (o.tileObjects && typeof o.tileObjects === 'object' && !Array.isArray(o.tileObjects)) gardens.push(o); if (o.data && typeof o.data === 'object' && o.data.garden && Array.isArray(o.data.petSlots)) slots.push(o); for (const k of Object.keys(o)) walk(o[k], d + 1); };
        walk(obs.state, 0);
        const fx = ${JSON.stringify(fx)};
        const at = new Map(fx.plants.map((p) => [p.i, p]));
        const T = {};
        for (const i of fx.occupied) {
          const p = at.get(i);
          T[i] = p ? { objectType: 'plant', species: p.sp, slots: p.s.map(([m, size, ripe]) => ({ species: p.sp, mutations: m ? m.split(',') : [], size, endTime: ripe ? Date.now() - 1000 : Date.now() + 1e7 })) } : { objectType: 'decor', decorId: 'WoodBench' };
        }
        for (const g of gardens) g.tileObjects = T;
        for (const s of slots) {
          s.data.inventory = s.data.inventory || {};
          s.data.inventory.items = [{ toolId: 'PlanterPot', itemType: 'Tool', quantity: 5 }];
          s.notAuthoritative_selectedItemIndex = 0;
          s.data.petSlots = [{ id: 'mount', petSpecies: 'Ostrich', abilities: ['DawnCapture'], mutations: [], xp: 1 }];
          s.riddenPetId = 'mount';
        }
        obs.setSpotMap(true);
        obs.setMountMap(true);
        obs.setBinderMap({ on: true, event: { kind: 'amber', endsAt: Date.now() + 600000 } });
        return true;
      })()`;
      const sc = {};
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const [name, w, hh] of [['laptop150', 1280, 680], ['laptop125', 1536, 800], ['monitor1440', 2560, 1380]]) {
        win.setContentSize(w, hh);
        await wait(1500);
        await grun(crowd);
        await wait(900);
        const panelInfo = await run(`(() => ({ cssWidth: window.innerWidth, cssHeight: window.innerHeight, dpr: window.devicePixelRatio, sideways: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1 || document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth + 1, navFits: (() => { const n = document.querySelector('nav'); return n.scrollWidth <= n.clientWidth + 1; })(), tabs: [...document.querySelectorAll('nav button')].map((b) => Math.round(b.getBoundingClientRect().width)).join(',') }))()`);
        const gameInfo = await grun(`(() => { const c = document.getElementById('mg-corner'); const r = c ? c.getBoundingClientRect() : null; const maps = ['mg-map', 'mg-map', 'mg-map'].map((id) => { const b = document.getElementById(id); if (!b || b.style.display === 'none') return id + ':hidden'; const q = b.getBoundingClientRect(); return id + ':' + [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)].join('/'); }); return { w: innerWidth, h: innerHeight, scale: c ? c.style.transform : null, corner: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null, inside: r ? r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 : null, maps }; })()`);
        const pimg = await panel().capturePage();
        const gimg = await gw.capturePage();
        fs.writeFileSync(path.join(SHOTS, `screen-${name}-panel.png`), pimg.toPNG());
        fs.writeFileSync(path.join(SHOTS, `screen-${name}-game.png`), gimg.toPNG());
        sc[name] = { window: [w, hh], panel: panelInfo, game: gameInfo };
      }
      // Tap a map's title: it folds to one line, and back.
      const head = await grun("(() => { const b = document.getElementById('mg-map'); const hd = b.querySelector('.mg-map-head'); const r = hd.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2, h: Math.round(b.getBoundingClientRect().height) }; })()");
      gw.sendInputEvent({ type: 'mouseDown', x: Math.round(head.x), y: Math.round(head.y), button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseUp', x: Math.round(head.x), y: Math.round(head.y), button: 'left', clickCount: 1 });
      await wait(500);
      sc.fold = { before: head.h, after: await grun("Math.round(document.getElementById('mg-map').getBoundingClientRect().height)"), folded: await grun("document.getElementById('mg-map').classList.contains('mg-folded')"), saved: ((await run('window.app.getSettings()')).ui.mapFold || {})['mg-map'] || false };
      const head2 = await grun("(() => { const hd = document.querySelector('#mg-map .mg-map-head'); const r = hd.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; })()");
      gw.sendInputEvent({ type: 'mouseDown', x: Math.round(head2.x), y: Math.round(head2.y), button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseUp', x: Math.round(head2.x), y: Math.round(head2.y), button: 'left', clickCount: 1 });
      await wait(500);
      sc.fold.unfolded = !(await grun("document.getElementById('mg-map').classList.contains('mg-folded')"));
      // The panel's size setting.
      sc.sizes = {};
      for (const sz of ['small', 'xlarge', 'auto']) {
        await run(`window.app.panel({ size: '${sz}' })`);
        await wait(700);
        sc.sizes[sz] = await run('({ css: window.innerWidth, dpr: window.devicePixelRatio })');
      }
      out.screens = sc;
    }
    if (MODE === 'perf') {
      // Traffic over 40 s of the stand-in game (v0.54.1): status messages to
      // the panel and their size, and how often settings reach the disk.
      // Who asks for a save, by the calling function.
      const store = require('../store');
      const callers = {};
      const realSave = store.save;
      store.save = function countedSave() {
        const line = (new Error().stack || '').split('\n')[2] || '';
        const m = line.match(/at (\S+)/);
        const k = m ? m[1] : line.trim().slice(0, 60);
        callers[k] = (callers[k] || 0) + 1;
        return realSave.apply(this, arguments);
      };
      const dirp = require('electron').app.getPath('userData');
      const file = dirp;
      const seen = {};
      let writes = 0;
      let watcher = null;
      try {
        watcher = fs.watch(dirp, (ev, name) => { if (name && ev === 'rename' && /settings/.test(name) && !/tmp/.test(name)) { writes += 1; seen[name] = (seen[name] || 0) + 1; } });
      } catch (err) { /* no watch */ }
      await run("(() => { window.__perf = { n: 0, bytes: 0, max: 0 }; window.app.onGardenStatus((st) => { const s = JSON.stringify(st).length; window.__perf.n += 1; window.__perf.bytes += s; window.__perf.max = Math.max(window.__perf.max, s); }); return true; })()");
      const t0 = Date.now();
      await wait(40000);
      const p = await run('window.__perf');
      if (watcher) watcher.close();
      out.perf = { seconds: Math.round((Date.now() - t0) / 1000), statusMessages: p.n, avgKB: p.n ? Math.round(p.bytes / p.n / 102.4) / 10 : 0, maxKB: Math.round(p.max / 102.4) / 10, settingsDir: file, settingsWrites: writes, saveCallers: callers, files: seen, dir: fs.readdirSync(dirp).filter((n) => /json/.test(n)) };
    }
    if (MODE === 'flows') {
      // End-to-end QA of the flows no other harness drives (v0.54.1), through
      // the same calls the panel makes. Run with MG_TEST_DIALOGS=1.
      const { BaseWindow } = require('electron');
      const fl = {};
      const safe = async (name, fn) => {
        try {
          fl[name] = await fn();
        } catch (err) {
          fl[name] = { error: String(err && err.message || err) };
        }
      };
      const tmpDir = require('os').tmpdir();
      // 1. Backup, change, restore.
      await safe('backup', async () => {
        const file = path.join(tmpDir, `mg-backup-${Date.now()}.json`);
        const before = (await run('window.app.getSettings()')).alerts.volume;
        const saved = await run(`window.app.backupSave(${JSON.stringify(file)})`);
        await run(`(async () => { const s = await window.app.getSettings(); s.alerts.volume = ${before === 0.33 ? 0.44 : 0.33}; await window.app.setSettings(s); return true; })()`);
        const changed = (await run('window.app.getSettings()')).alerts.volume;
        const restored = await run(`window.app.backupRestore(${JSON.stringify(file)})`);
        await wait(1500);
        const after = (await run('window.app.getSettings()')).alerts.volume;
        return { saved: saved && saved.ok, bytes: fs.existsSync(file) ? fs.statSync(file).size : 0, before, changed, restored: restored && restored.ok, after, same: after === before };
      });
      // 2. The panel in its own window and back.
      await safe('popOut', async () => {
        const out1 = await run("window.app.panel({ mode: 'window', show: true })");
        await wait(1500);
        const wins = BaseWindow.getAllWindows().length;
        const alive1 = await run('1 + 1');
        const zoom1 = await run('window.devicePixelRatio');
        const out2 = await run("window.app.panel({ mode: 'attached', show: true })");
        await wait(1500);
        const alive2 = await run("document.querySelector('nav') ? 'nav ok' : 'no nav'");
        return { mode1: out1 && out1.mode, windows: wins, alive1, zoom1, mode2: out2 && out2.mode, alive2, cssWidth: await run('window.innerWidth') };
      });
      // 3. Rooms: save, rename, remove.
      await safe('rooms', async () => {
        const a = await run("window.app.roomsSave('QA42', 'QA room')");
        const b = await run("window.app.roomsSave('QA42', 'QA renamed')");
        const c = await run("window.app.roomsRemove('QA42')");
        const find = (l) => (Array.isArray(l) ? l : (l && l.list) || []).find((r) => r.id === 'QA42');
        return { saved: Boolean(find(a)), renamed: (find(b) || {}).name, removed: !find(c) };
      });
      // 4. A pet's strength by hand, then back to the app's own.
      await safe('strength', async () => {
        const g = await run('window.app.getGarden()');
        const pet = ((g.status && g.status.allPets) || [])[0];
        if (!pet) return { skipped: 'no pets' };
        await run(`window.app.setStrength(${JSON.stringify(pet.id)}, 77)`);
        await wait(2500);
        const g2 = await run('window.app.getGarden()');
        const p2 = ((g2.status && g2.status.allPets) || []).find((p) => p.id === pet.id) || {};
        await run(`window.app.setStrength(${JSON.stringify(pet.id)}, null)`);
        await wait(2500);
        const g3 = await run('window.app.getGarden()');
        const p3 = ((g3.status && g3.status.allPets) || []).find((p) => p.id === pet.id) || {};
        return { pet: pet.species, set: p2.strength, override: p2.strengthOverride, cleared: p3.strengthOverride == null, back: p3.strength };
      });
      // 5. A luck counter by hand.
      await safe('luck', async () => {
        const r = await run("window.app.luckSet('egg:MythicalEgg:Capybara', 33)");
        const v = await run('window.app.luckGet()');
        const row = ((v && v.groups && v.groups.egg) || []).flatMap((g) => g.rows).find((x) => x.target === 'Capybara');
        return { value: row && row.value, estimated: row && row.estimated, ok: Boolean(r) };
      });
      // 6. Clearing the alert history.
      await safe('history', async () => {
        await run('window.app.clearHistory()');
        const h2 = await run('window.app.getHistory()');
        return { left: Array.isArray(h2) ? h2.length : h2 };
      });
      // 7. Can I buy this?
      await safe('whatIf', async () => {
        const w = await run('window.app.budgetWhatIf(2e9)');
        return w ? { verdict: w.verdict, keys: Object.keys(w).slice(0, 8) } : null;
      });
      // 8. A script error in the panel reaches the log (and a saved sample).
      await safe('panelError', async () => {
        await run("setTimeout(() => { throw new Error('QA: a deliberate panel error'); }, 0); true");
        await wait(800);
        const file = await run('window.app.gardenSample()');
        const smp = JSON.parse(fs.readFileSync(typeof file === 'string' ? file : file.file || file.path, 'utf8'));
        return { logged: (smp.errors || []).some((e) => e.where === 'panel script' && /deliberate/.test(e.msg)), count: (smp.errors || []).length };
      });
      // 10. The View menu's zoom follows focus: the panel's size, or the game.
      await safe('zoomKeys', async () => {
        const { Menu } = require('electron');
        const item = (label) => {
          let hit = null;
          const walk = (m) => { for (const it of m.items) { if (it.label === label) hit = it; if (it.submenu) walk(it.submenu); } };
          walk(Menu.getApplicationMenu());
          return hit;
        };
        panel().focus();
        await wait(300);
        const focused = panel().isFocused();
        item('Zoom in').click();
        await wait(900);
        const s1 = (await run('window.app.getSettings()')).ui.panelSize;
        const z1 = await run('window.devicePixelRatio');
        item('Actual size').click();
        await wait(900);
        const s2 = (await run('window.app.getSettings()')).ui.panelSize;
        const gw2 = find((u) => u.startsWith('https://magicgarden.gg'));
        gw2.focus();
        await wait(300);
        item('Zoom in').click();
        await wait(300);
        const g1 = gw2.getZoomLevel();
        const s3 = (await run('window.app.getSettings()')).ui.panelSize;
        item('Actual size').click();
        await wait(300);
        return { panelFocused: focused, panelAfterZoomIn: s1, panelZoom: z1, panelAfterReset: s2, gameZoomIn: g1, panelUntouched: s3, gameAfterReset: gw2.getZoomLevel() };
      });
      // 9. The panel's page crashes: it comes back by itself.
      await safe('panelCrash', async () => {
        panel().forcefullyCrashRenderer();
        await wait(6000);
        const back = await run("document.querySelector('nav') ? 'panel back' : 'no nav'");
        const file = await run('window.app.gardenSample()');
        const smp = JSON.parse(fs.readFileSync(typeof file === 'string' ? file : file.file || file.path, 'utf8'));
        return { back, logged: (smp.errors || []).some((e) => e.where === 'panel' && /stopped/.test(e.msg)) };
      });
      out.flows = fl;
    }
    if (MODE === 'a11y') {
      // Accessibility audit of every tab (v0.54.1): controls without a name,
      // unlabelled fields and switches, and text contrast (WCAG ratio).
      const a = {};
      for (const tab of ['alerts', 'weather', 'garden', 'money', 'pets', 'pity', 'rooms', 'scripts']) {
        await run(`(() => { showTab('${tab}'); document.querySelectorAll('#tab-${tab} details').forEach((d) => { d.open = true; }); return true; })()`);
        await wait(700);
        a[tab] = await run(`(() => {
          const sec = document.getElementById('tab-${tab}');
          const vis = (el) => el.offsetParent !== null;
          const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim() || (el.labels && el.labels.length ? el.labels[0].textContent.trim() : '') || (el.getAttribute('aria-labelledby') ? 'labelledby' : '');
          const nameless = [...sec.querySelectorAll('button, [role=button], [role=switch], [role=radio], summary')].filter(vis).filter((el) => !name(el)).map((el) => el.outerHTML.slice(0, 90));
          const fields = [...sec.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(vis).filter((el) => !name(el) && !el.getAttribute('placeholder')).map((el) => el.outerHTML.slice(0, 90));
          // Contrast: each text colour against the nearest solid background.
          const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
          const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
          const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) return c; } return [37, 23, 48]; };
          const low = {};
          for (const el of [...sec.querySelectorAll('.note, .hint, .rule-desc, .where, small, .faint, .tick, .fold-sum')].filter(vis).slice(0, 400)) {
            const fg = rgb(getComputedStyle(el).color);
            const op = Number(getComputedStyle(el).opacity) || 1;
            const bg = bgOf(el);
            const mix = fg.slice(0, 3).map((v, i) => v * op + bg[i] * (1 - op));
            const L1 = lum(mix); const L2 = lum(bg);
            const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
            if (ratio < 4.5) { const k = el.className.split(' ')[0] + ' ' + getComputedStyle(el).color + ' on ' + bg.slice(0, 3).join(','); low[k] = Math.min(low[k] || 99, Math.round(ratio * 100) / 100); }
          }
          return { nameless: nameless.slice(0, 6), namelessCount: nameless.length, fields: fields.slice(0, 4), lowContrast: low };
        })()`);
      }
      out.a11y = a;
    }
    if (MODE === 'voicetime') {
      // The Dawn shop's voice with a slow downloaded voice (1.5 s a line),
      // with its line made while the sunrise plays (v0.54.3) and without.
      await run(`(() => {
        naturalVoice = () => ({ id: 'fake', tone: null });
        synthVoice = () => new Promise((r) => setTimeout(() => r(new Uint8Array(8)), 1500));
        playClip = async () => { await wait(200); };
        window.__prep = prepareSpeech;
        return true;
      })()`);
      const once = (spec) => run(`(async () => {
        const list = ${JSON.stringify(spec)}.map((x) => { const r = RULES.find((q) => q.id === x.id || q.label === x.label); return { ruleId: r.id, label: r.label, kind: r.kind, tier: (S.alerts.levels || {})[r.id] || r.tier, sound: r.sound || null }; });
        const got = [];
        const real = reportPlayed;
        reportPlayed = (rep) => { got.push(rep); real(rep); };
        enqueue(list);
        await wait(60);
        while (playing) await wait(40);
        reportPlayed = real;
        return got.find((r) => (r.played || []).some((x) => /dawn/i.test(x))) || got[0] || null;
      })()`);
      const vt = {};
      vt.dawnAhead = await once([{ id: 'dawn' }]);
      vt.shopAhead = await once([{ id: 'dawn' }, { label: 'Ube' }]);
      await run('(() => { prepareSpeech = () => {}; return true; })()');
      vt.dawnAfter = await once([{ id: 'dawn' }]);
      vt.shopAfter = await once([{ id: 'dawn' }, { label: 'Ube' }]);
      await run('(() => { prepareSpeech = window.__prep; return true; })()');
      out.voicetime = vt;
    }
    if (MODE === 'onemap') {
      // One map over the game (v0.54.3): the view follows what you're doing,
      // tabs for the rest, a tap on a tab switches, a pick holds until
      // something new comes up. On the owner's garden.
      const fx = require('./fixtures/garden-layout.json');
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const setup = (o) => grun(`(() => {
        const obs = window.__mgLoaderObserver; const gardens = []; const slots = []; const seen = new Set();
        const walk = (x, d) => { if (!x || typeof x !== 'object' || seen.has(x) || d > 9) return; seen.add(x); if (x.tileObjects && typeof x.tileObjects === 'object' && !Array.isArray(x.tileObjects)) gardens.push(x); if (x.data && typeof x.data === 'object' && x.data.garden && Array.isArray(x.data.petSlots)) slots.push(x); for (const k of Object.keys(x)) walk(x[k], d + 1); };
        walk(obs.state, 0);
        const fx = ${JSON.stringify(fx)};
        const o = ${JSON.stringify(o)};
        const at = new Map(fx.plants.map((p) => [p.i, p]));
        const T = {};
        for (const i of fx.occupied) {
          if ((o.open || []).includes(i)) continue;
          const p = at.get(i);
          T[i] = p ? { objectType: 'plant', species: p.sp, slots: p.s.map(([m, size, ripe]) => ({ species: p.sp, mutations: m ? m.split(',') : [], size, endTime: ripe ? Date.now() - 1000 : Date.now() + 1e7 })) } : { objectType: 'decor', decorId: 'WoodBench' };
        }
        for (const g of gardens) g.tileObjects = T;
        for (const s of slots) {
          const pets = [];
          if (o.wolf) pets.push({ id: 'wolf', petSpecies: 'ThunderWolf', abilities: ['Thundercharger'], mutations: [], xp: 1 });
          if (o.ostrich) pets.push({ id: 'ost', petSpecies: 'Ostrich', abilities: ['DawnCapture'], mutations: [], xp: 1 });
          s.data.petSlots = pets;
          s.riddenPetId = o.ride ? 'ost' : null;
          s.data.inventory = s.data.inventory || {};
          s.data.inventory.items = [{ toolId: 'CropCleanser', itemType: 'Tool', quantity: 9 }, { toolId: 'PlanterPot', itemType: 'Tool', quantity: 9 }];
          // The game's own way now (v0.54.5): the held item by id.
          s.heldItem = { itemId: o.pot ? 'PlanterPot' : null, decorRotation: 0 };
          delete s.notAuthoritative_selectedItemIndex;
        }
        obs.setBinderMap({ on: true, event: o.amber ? { kind: 'amber', endsAt: Date.now() + 600000 } : null });
        return true;
      })()`);
      const view = () => grun("(() => { const b = document.getElementById('mg-map'); if (!b || b.style.display === 'none') return null; const q = b.getBoundingClientRect(); return { ctx: b.dataset.ctx, title: b.querySelector('.mg-map-head span').textContent, tabs: [...b.querySelectorAll('.mg-tab')].map((t) => t.dataset.ctx), folded: b.classList.contains('mg-folded'), rect: [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)] }; })()");
      const om = {};
      await setup({ wolf: true });
      await wait(400);
      om.wolf = await view();
      await setup({ wolf: true, ostrich: true });
      await wait(400);
      om.wolfOstrich = await view();
      await setup({ wolf: true, ostrich: true, amber: true });
      await wait(400);
      om.plusAmber = await view();
      await setup({ wolf: true, ostrich: true, amber: true, ride: true });
      await wait(400);
      om.plusRide = await view();
      await setup({ wolf: true, ostrich: true, amber: true, ride: true, pot: true, open: [65, 190] });
      await wait(500);
      om.plusPot = await view();
      const img = await gw.capturePage();
      fs.mkdirSync(SHOTS, { recursive: true });
      const r = om.plusPot.rect;
      fs.writeFileSync(path.join(SHOTS, 'onemap-tabs.png'), img.crop({ x: Math.max(0, r[0] - 6), y: Math.max(0, r[1] - 6), width: r[2] + 12, height: r[3] + 12 }).toPNG());
      // Tap the Thunderstruck tab, for real.
      const tab = await grun("(() => { const t = document.querySelector('#mg-map .mg-tab[data-ctx=\"thunder\"]'); const q = t.getBoundingClientRect(); return { x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2) }; })()");
      gw.sendInputEvent({ type: 'mouseDown', x: tab.x, y: tab.y, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseUp', x: tab.x, y: tab.y, button: 'left', clickCount: 1 });
      await wait(500);
      om.tapped = await view();
      await grun('window.__mgLoaderObserver.setMountMap(true)');
      await wait(400);
      om.pickHolds = await view();
      // Something new: the pot put away. The pick gives way.
      await setup({ wolf: true, ostrich: true, amber: true, ride: true, pot: false });
      await wait(500);
      om.afterChange = await view();
      // Nothing going on: no map.
      await setup({});
      await wait(400);
      om.nothing = await view();
      // Folding it, by a tap on its title.
      await setup({ wolf: true });
      await wait(400);
      const hd = await grun("(() => { const t = document.querySelector('#mg-map .mg-map-head span'); const q = t.getBoundingClientRect(); return { x: Math.round(q.left + 20), y: Math.round(q.top + q.height / 2) }; })()");
      gw.sendInputEvent({ type: 'mouseDown', x: hd.x, y: hd.y, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseUp', x: hd.x, y: hd.y, button: 'left', clickCount: 1 });
      await wait(600);
      om.folded = (await view()).folded;
      om.foldSaved = ((await run('window.app.getSettings()')).ui.mapFold || {})['mg-map'] || false;
      gw.sendInputEvent({ type: 'mouseDown', x: hd.x, y: hd.y, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseUp', x: hd.x, y: hd.y, button: 'left', clickCount: 1 });
      await wait(600);
      // A place saved for one of the old maps carries over.
      await grun("window.__mgLoaderObserver.setMapPositions({ 'mg-thunder-map': { x: 0.1, y: 0.1 } }, {})");
      await wait(400);
      const iw = await grun('[innerWidth, innerHeight]');
      const moved = await view();
      om.carriedOver = { rect: moved.rect, expect: [Math.round(iw[0] * 0.1), Math.round(iw[1] * 0.1)] };
      // The held log, in a sample.
      const smp = await grun('window.__mgLoaderObserver.sample()');
      om.heldLog = (smp.heldLog || []).slice(-3);
      out.onemap = om;
    }
    if (MODE === 'harvestmode') {
      // Harvest mode (v0.54.4) end to end: the rule set from the panel, the
      // owner's garden in the observer, real HarvestCrop commands through the
      // game's socket; which are stopped and which go through.
      const rule = require('../harvest-rule');
      const fx = require('./fixtures/garden-layout.json');
      const mine = { on: true, color: 'goldOrRainbow', hydro: ['thundercharged'], lunar: ['amberbound'], size: true };
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const hm = {};
      hm.saved = (await run(`window.app.harvestSet({ mode: ${JSON.stringify(mine)} })`)).mode;
      await wait(500);
      hm.observer = await grun('window.__mgLoaderObserver.harvestLock.mode');
      await grun(`(() => {
        const obs = window.__mgLoaderObserver; const gardens = []; const seen = new Set();
        const walk = (x, d) => { if (!x || typeof x !== 'object' || seen.has(x) || d > 9) return; seen.add(x); if (x.tileObjects && typeof x.tileObjects === 'object' && !Array.isArray(x.tileObjects)) gardens.push(x); for (const k of Object.keys(x)) walk(x[k], d + 1); };
        walk(obs.state, 0);
        const fx = ${JSON.stringify(fx)};
        const at = new Map(fx.plants.map((p) => [p.i, p]));
        const T = {};
        for (const i of fx.occupied) {
          const p = at.get(i);
          T[i] = p ? { objectType: 'plant', species: p.sp, slots: p.s.map(([m, size, ripe]) => ({ species: p.sp, mutations: m ? m.split(',') : [], size, endTime: ripe ? Date.now() - 1000 : Date.now() + 1e7 })) } : { objectType: 'decor', decorId: 'WoodBench' };
        }
        for (const g of gardens) g.tileObjects = T;
        return true;
      })()`);
      // One crop of each kind: matching, and failing each way.
      const pick = (want) => {
        for (const p of fx.plants) for (let j = 0; j < p.s.length; j += 1) {
          const [m, size, ripe] = p.s[j];
          if (!ripe) continue;
          if (want(rule.miss(m ? m.split(',') : [], size, mine), m, size)) return { slot: p.i, idx: j, muts: m, size };
        }
        return null;
      };
      const cases = {
        match: pick((why) => why === null),
        noColour: pick((why) => why === 'not Gold or Rainbow'),
        notCharged: pick((why) => why === 'not Thundercharged'),
        notBound: pick((why) => why === 'not Amberbound'),
        notFull: pick((why) => why === 'not full size'),
      };
      hm.cases = {};
      for (const [name, c] of Object.entries(cases)) {
        if (!c) { hm.cases[name] = 'none in the garden'; continue; }
        const before = await grun('window.__mgLoaderObserver.recentOutgoing.filter((e) => e.blocked).length');
        await grun(`window.__gameSend({ type: 'HarvestCrop', slot: ${c.slot}, slotsIndex: ${c.idx} })`);
        await wait(250);
        const after = await grun('window.__mgLoaderObserver.recentOutgoing.filter((e) => e.blocked).length');
        const note = await grun("(() => { const el = document.getElementById('__mgHarvestNote'); return el && el.style.opacity !== '0' ? el.textContent : null; })()");
        hm.cases[name] = { crop: c.muts + ' @' + c.size, blocked: after > before, note: after > before ? note : null };
        await wait(1100);
      }
      hm.badge = await grun("(document.getElementById('__mgHarvestLock') || {}).textContent || null");
      hm.map = await grun("(() => { const b = document.getElementById('mg-map'); return b && b.style.display !== 'none' ? { ctx: b.dataset.ctx, text: b.innerText.replace(/\\s+/g, ' ').slice(0, 140) } : null; })()");
      // The panel: the rule, the live count, and the Your garden card.
      await run("(() => { showTab('garden'); const h = document.querySelector('h2[data-fold=\"garden/harvest-lock\"]'); if (h && h.classList.contains('folded')) h.click(); document.getElementById('harvestRule').scrollIntoView({ block: 'start' }); return true; })()");
      await wait(2500);
      hm.panelCount = await run("document.querySelector('#harvestRule .hv-match').innerText");
      hm.chipsOn = await run("[...document.querySelectorAll('#harvestRule .chip.on')].map((b) => b.textContent)");
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('#harvestRule', 'harvest-rule', 60);
      await run("(() => { GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { crops: [{ name: 'garden', total: 270, ready: 225, value: 639.3e9, ripeValue: 639.3e9, readyValue: 574.3e9, growingValue: 65e9, mature: 270, matureKnown: true, gold: 124, rainbow: 111, special: 235, missing: { grow: 0, size: 10, color: 21, hydro: 0, lunar: 18 }, have: { ripe: 270 } }], room: { players: 2 }, idealSell: { petPart: 1.313, pets: [{ species: 'Pig' }, { species: 'Pig' }, { species: 'Capybara' }], allOut: false, notOut: ['Capybara'], outNow: { petPart: 1.064 } } }); renderGarden = window.renderGarden || renderGarden; const b = gardenBucket(GARDEN_STATUS); renderCropCard(GARDEN_STATUS, b); document.getElementById('cropStats').scrollIntoView({ block: 'start' }); return true; })()");
      await wait(400);
      hm.gardenCard = await run("document.getElementById('cropStats').innerText.split('\\n').filter(Boolean).slice(0, 14)");
      await shotOf('#cropStats', 'your-garden', 6);
      await run("window.app.harvestSet({ mode: { on: false } })");
      out.harvestmode = hm;
    }
    if (MODE === 'levelnext') {
      // Level next on the Pets tab (pet-plan.js, v0.54.5), from MG_SAMPLE's
      // pets if given, else example pets; and the Garden map's to-do on the
      // owner's layout, explained, with the top plant open.
      const pp = require('../pet-plan');
      const ex = (id, sp, ab, s, m, h, w) => ({ id, species: sp, speciesName: sp, abilities: ab, strength: s, maxStrength: m, hoursToMax: h, where: w });
      const pets = process.env.MG_SAMPLE ? JSON.parse(fs.readFileSync(process.env.MG_SAMPLE, 'utf8')).lastStatus.allPets
        : [ex('p1', 'Pig', ['SellBoostII', 'GoldGranter'], 99, 99, 0, 'out'), ex('p2', 'Peacock', ['SellBoostIV', 'XPBoostII'], 56, 86, 144, 'hutch'), ex('p3', 'Bat', ['ThunderCoinFinder', 'ThunderBoost'], 69, 96, 88, 'hutch'), ex('p4', 'Capybara', ['ProduceRefund', 'DoubleHarvest'], 79, 81, 8, 'hutch')];
      const L = pp.recommend(pets);
      const ln = {};
      ln.fromSample = Boolean(process.env.MG_SAMPLE);
      ln.picks = L.picks.map((p) => `${p.species} ${p.strength}->${p.maxStrength}`);
      ln.panel = await run(`(() => { GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { levelNext: ${JSON.stringify(L)} }); showTab('pets'); renderPets(); document.getElementById('levelNext').scrollIntoView({ block: 'start' }); return document.getElementById('levelNext').innerText.split('\\n').filter(Boolean).slice(0, 16); })()`);
      await wait(400);
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('#levelNext', 'level-next', 8);
      // The Garden map's to-do, on the owner's layout.
      const fx = require('./fixtures/garden-layout.json');
      const gp = require('../garden-plan');
      const planned = gp.plan(fx.plants, fx.occupied);
      const kinds = {};
      const at = new Map(fx.plants.map((p) => [p.i, p]));
      for (const i of fx.occupied) kinds[i] = at.has(i) ? ['p', at.get(i).sp] : ['d', 'Decor'];
      ln.todo = await run(`(() => { renderGarden = function () {}; S.ui = Object.assign({}, S.ui, { gardenMap: 'todo' }); GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { at: Date.now(), gardenTiles: ${JSON.stringify(kinds)}, plan: ${JSON.stringify(planned)} }); GM_SEL = null; showTab('garden'); const h2 = document.querySelector('h2[data-fold="garden/garden-map"]'); if (h2 && h2.classList.contains('folded')) h2.click(); spotHtml = ''; renderSpots(GARDEN_STATUS); document.getElementById('spotMap').scrollIntoView({ block: 'start' }); return { big: document.getElementById('spotCount').innerText, sub: document.getElementById('gmSummary').innerText, tile: document.getElementById('gmTile').innerText.replace(/\\n+/g, ' | ').slice(0, 700), outlined: [...document.querySelectorAll('#spotMap i.sel')].map((c) => c.dataset.i) }; })()`);
      await wait(400);
      await shotOf('.card:has(#spotMap)', 'todo-explained', 4);
      out.levelnext = ln;
    }
    if (MODE === 'luck') {
      // The Luck tab in two states, built with luck.js itself: a late-game
      // account with counters at every stage, and a fresh one where every
      // counter still sits at its halfway estimate.
      const L = require('../luck');
      const late = L.migrate({});
      late.startHalf = true;
      for (const [key, v] of [['egg:MythicalEgg:Capybara', 39], ['egg:AmberEgg:Phoenix', 96], ['egg:AmberEgg:FireHorse', 22], ['egg:ThunderEgg:ThunderWolf', 30],
        ['egg:DawnEgg:Ostrich', 12], ['pet:AnyEgg:gold', 170], ['pet:AnyEgg:rainbow', 1100], ['capsule:DawnCapsule:Dawnbreaker', 380], ['capsule:DawnCapsule:Ube', 50],
        ['capsule:AmberCapsule:XPShard', 70], ['capsule:AmberCapsule:StrengthShard', 210], ['plant:Emberbloom:Embercrown', 470], ['plant:Sunflower:gold', 150], ['plant:Sunflower:rainbow', 400]]) L.set(late, key, v);
      const fresh = L.migrate({});
      fresh.startHalf = true;
      const lk = {};
      for (const [name, st] of [['late', late], ['fresh', fresh]]) {
        const view = L.view(st);
        await run(`(() => { LUCK = ${JSON.stringify(view)}; showTab('pity'); document.querySelector('main').scrollTop = 0; renderLuck(); })()`);
        await wait(500);
        lk[name] = {
          hero: await run("(() => { const h = document.querySelector('#luckPrimed .lk-hero'); return h ? ['.lk-icon', '.lk-kicker', '.lk-name', '.lk-line', '.lk-story'].map((s) => h.querySelector(s).innerText.replace(/\\s+/g, ' ')).join(' | ') : null; })()"),
          rows: await run("[...document.querySelectorAll('#luckPrimed .lk-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())"),
          gold: await run("[...document.querySelectorAll('#luckPrimed .lk-name, #luckPrimed .lk-row b')].some((e) => /^(gold|rainbow)$/i.test(e.innerText.trim()))"),
          notes: await run("[...document.querySelectorAll('#luckPrimed > .note')].map((n) => n.innerText)"),
          chips: await run("[...document.querySelectorAll('#luckEggs .luck-src summary')].slice(0, 5).map((s) => s.innerText.replace(/\\s+/g, ' '))"),
          hits: await run(`(() => { const els = [...document.querySelectorAll('#luckPrimed .lk-kicker, #luckPrimed .lk-name, #luckPrimed .lk-line, #luckPrimed .lk-story, #luckPrimed .lk-top, #luckPrimed .lk-when, #luckPrimed .lk-ic, #luckEggs summary > *')].filter((e) => e.offsetParent && e.getBoundingClientRect().width); const out = []; for (let a = 0; a < els.length; a += 1) for (let b = a + 1; b < els.length; b += 1) { if (els[a].contains(els[b]) || els[b].contains(els[a])) continue; const p = els[a].getBoundingClientRect(); const q = els[b].getBoundingClientRect(); if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 1.5 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 1.5) out.push(els[a].innerText.slice(0, 25) + ' <-> ' + els[b].innerText.slice(0, 25)); } return out; })()`),
        };
        await shotOf('#tab-pity .card', `luck-${name}`, 4);
        await run("document.getElementById('luckEggs').scrollIntoView({ block: 'start' })");
        await wait(300);
        await shotOf('#luckEggs', `luck-${name}-eggs`, 4);
      }
      out.luck = lk;
    }
    if (MODE === 'ux') {
      // A new player's view of three spots: the recent alerts with repeats,
      // the Garden map with no binder (the stand-in's garden), and the
      // Money engine before it has any history.
      const ux = {};
      const T = Date.now();
      const hist = [];
      for (let k = 0; k < 5; k += 1) hist.push({ at: T - (60 - k * 12) * 60000, text: '🛒 Legendary Egg in stock' });
      hist.push({ at: T - 5 * 60000, text: '🌧️ Rain' }, { at: T - 4 * 60000, text: '🛒 Moonbinder Pod in stock' }, { at: T - 3 * 60000, text: '🛒 Moonbinder Pod in stock' });
      await run(`(() => { HISTORY = ${JSON.stringify(hist)}; renderHistory(); showTab('alerts'); })()`);
      await wait(400);
      ux.history = await run("[...document.querySelectorAll('#historyList .history-item')].map((d) => d.innerText.replace(/\\s+/g, ' ').trim())");
      await shotOf('#historyList', 'ux-history', 6);
      await run("(() => { S.ui = Object.assign({}, S.ui); delete S.ui.gardenMap; showTab('garden'); const h2 = document.querySelector('h2[data-fold=\"garden/garden-map\"]'); if (h2 && h2.classList.contains('folded')) h2.click(); spotHtml = ''; renderSpots(GARDEN_STATUS); })()");
      await wait(500);
      ux.mapDefault = await run("document.querySelector('#gmView [aria-checked=\"true\"]').dataset.val");
      await run("(() => { S.ui.gardenMap = 'todo'; spotHtml = ''; renderSpots(GARDEN_STATUS); })()");
      ux.todoNoBinder = await run("document.getElementById('spotCount').innerText + ' | ' + document.getElementById('gmSummary').innerText");
      await shotOf('.card:has(#spotMap)', 'ux-map-nobinder', 4);
      await run("(() => { delete S.ui.gardenMap; showTab('money'); const h2 = document.querySelector('h2[data-fold=\"money/money-engine\"]'); if (h2 && h2.classList.contains('folded')) h2.click(); })()");
      await wait(400);
      ux.engine = await run("document.getElementById('moneyEngine').innerText");
      await shotOf('#moneyEngine', 'ux-engine', 6);
      out.ux = ux;
    }
    if (MODE === 'moneycard') {
      // The whole Spend or save? section, screenful by screenful.
      await run(`(() => { BUDGET = Object.assign({}, BUDGET, { unlocked: true, foresight: ${JSON.stringify(moneyState())} }); WHATIF = null; renderBudget(); showTab('money'); const h2 = document.querySelector('h2[data-fold="money/spend-or-save"]'); if (h2 && h2.classList.contains('folded')) h2.click(); })()`);
      await wait(700);
      const top = await run("(() => { const h = document.querySelector('h2[data-fold=\"money/spend-or-save\"]'); const m = document.querySelector('main'); m.scrollTop += h.getBoundingClientRect().top - m.getBoundingClientRect().top - 4; return m.scrollTop; })()");
      const V = await run("document.querySelector('main').clientHeight");
      const endY = await run("(() => { const h = document.querySelector('h2[data-fold=\"money/growth\"]'); const m = document.querySelector('main'); return m.scrollTop + h.getBoundingClientRect().top - m.getBoundingClientRect().top; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      let n = 0;
      for (let y = top; y < endY && n < 6; y += V - 60, n += 1) {
        await run(`document.querySelector('main').scrollTop = ${y}`);
        await wait(350);
        fs.writeFileSync(path.join(SHOTS, `moneycard-${n}.png`), (await panel().capturePage()).toPNG());
      }
      out.moneycard = { screens: n, text: await run("document.getElementById('moneyForesight').closest('section').innerText.slice(0, 3000)") };
      // The sentence under the number in each state, and the fold opened by
      // a real click.
      function state({ wallet, ready, potential, growing }) {
        const bs = { alerts: { custom: [], disabled: [] }, shopStats: require('../budget').emptyStats(), moneyHistory: [], worthHistory: [], purchases: { log: [] }, budget: {} };
        require('../budget').seedWants(bs);
        const T = Date.now();
        for (let i = 0; i <= 7 * 48; i += 1) {
          const t = T - 7 * 86400000 + i * 1800000;
          bs.moneyHistory.push({ t, c: wallet, s: 0, f: 0 });
          bs.worthHistory.push({ t, v: ready + growing, r: 100, rv: ready, n: 270 });
        }
        const g = { total: 270, special: 176, gold: 85, rainbow: 91, ready: 121, readyValue: ready, growingValue: growing, growingPotential: potential,
          missing: { grow: 3, size: 10, color: 94, hydro: 3, lunar: 81 }, have: { ripe: 267, size: 260, hydro: 267, lunar: 189, color: 176 },
          harvestHours: null, goldPerHour: 1.21, stepHours: { ripe: 1, size: null, hydro: 0, lunar: 2.5, color: 77.4 } };
        const ctx = { wallet, gardenWorth: ready + growing, garden: g, pace: 0, gardenLoaded: true, readyRule: { size: true, color: true, hydro: true, lunar: true } };
        return require('../budget').view({ settings: bs, ctx }).foresight;
      }
      
      const states = { free: moneyState(), setAside: state({ wallet: 36e9, ready: 411e9, potential: 144e9, growing: 77e9 }), short: state({ wallet: 20e9, ready: 25e9, potential: 30e9, growing: 10e9 }) };
      out.moneycard.why = {};
      for (const [k, f] of Object.entries(states)) {
        await run(`(() => { BUDGET = Object.assign({}, BUDGET, { foresight: ${JSON.stringify(f)} }); WHATIF = null; renderBudget(); document.querySelector('#moneyForesight').scrollIntoView({ block: 'start' }); })()`);
        await wait(400);
        out.moneycard.why[k] = { signal: f.signal, safe: f.safeToSpend, text: await run("(document.querySelector('#moneyForesight .fs-why') || {}).innerText || null") };
        await shotOf('#moneyForesight .fs-top', `moneycard-top-${k}`, 4);
        await shotOf('#moneyForesight .fs-why', `moneycard-why-${k}`, 4);
      }
      const sum = await run("(() => { const s = document.querySelector('#moneyForesight [data-fs-how]'); s.scrollIntoView({ block: 'center' }); const r = s.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; })()");
      await wait(300);
      for (const type of ['mouseDown', 'mouseUp']) panel().sendInputEvent({ type, x: Math.round(sum.x), y: Math.round(sum.y), button: 'left', clickCount: 1 });
      await wait(500);
      out.moneycard.howOpen = await run("document.querySelector('#moneyForesight .fs-how').open");
      await run('renderBudget(); true');
      await wait(300);
      out.moneycard.howStaysOpen = await run("document.querySelector('#moneyForesight .fs-how').open");
      await shotOf('#moneyForesight .fs-how', 'moneycard-how', 4);
      out.moneycard.page = await run('document.scrollingElement.scrollTop');
    }
    if (MODE === 'mut' || MODE === 'all') {
      const mut = {};
      // The real recording: the stand-in's garden gives readings.
      const real = await run('window.app.getSettings()');
      mut.recorded = ((real.garden && real.garden.mutHistory) || []).slice(-2);
      // A believable day: weather coverage climbing in steps with each rain
      // or snow (every ~50 min), moon jumping at the 4-hourly dawn / amber,
      // Gold/Rainbow creeping up; the app closed for 3 hours overnight; a
      // harvest 7 hours ago (fewer crops, shares reset lower), then regrowth.
      const T = Date.now();
      const hist = [];
      for (let i = 7 * 144; i >= 1; i -= 1) {
        const t = T - i * 600000;
        const hAgo = (T - t) / 3600000;
        if (hAgo > 14 && hAgo < 17) continue;               // not watched
        const since = hAgo > 7 ? (T - t) % (30 * 3600000) : 7 - hAgo; // cycle since the last harvest
        const cycleH = hAgo > 7 ? (30 - since / 3600000) : (7 - hAgo);
        const n = hAgo > 7 ? 270 : 150 + Math.round(cycleH * 10);
        const rains = Math.floor(cycleH / 0.85);
        const moons = Math.floor(cycleH / 4);
        const hp = Math.min(1, 1 - Math.pow(0.72, rains));
        const lp = Math.min(1, 1 - Math.pow(0.6, moons));
        const cp = Math.min(0.95, cycleH * 0.028);
        const H = Math.round(n * hp);
        const Lu = Math.round(n * lp);
        const C = Math.round(n * cp);
        // Each mutation on its own (0.53.3): Frozen takes over from Wet and
        // Chilled as the rains go on; Dawn outnumbers Amber two to one.
        const fr = Math.round(H * Math.min(0.8, rains * 0.09));
        const wt = Math.round((H - fr) * 0.55);
        const chl = Math.round((H - fr) * 0.3);
        const dw = Math.round(Lu * 0.66);
        const gd = Math.round(C * 0.45);
        hist.push({ t, n, h: H, l: Lu, c: C, w: wt, ch: chl, f: fr, th: H - fr - wt - chl, d: dw, a: Lu - dw, g: gd, r: C - gd });
      }
      const mins = (m) => new Date(T + m * 60000).toISOString();
      const upcoming = [
        { kind: 'rain', name: 'Rain', announced: true, startsAt: mins(25), endsAt: mins(35) },
        { kind: 'snow', name: 'Snow', announced: true, startsAt: mins(100), endsAt: mins(110) },
        { kind: 'dawn', name: 'Dawn', announced: true, startsAt: mins(190), endsAt: mins(205) },
        { kind: 'thunder', name: 'Thunderstorm', announced: true, startsAt: mins(260), endsAt: mins(270) },
        { kind: 'amber', name: 'Amber Moon', announced: false, startsAt: mins(420), endsAt: mins(435) },
      ];
      await run('window.__rg = renderGarden; renderGarden = function () {}; true');
      const setup = (hours, h, extra = '', lineSet = null, liveFrom = null) => `(() => { const last = ${JSON.stringify(h[h.length - 1] || null)}; const lf = ${JSON.stringify(liveFrom || h[h.length - 1] || null)}; GARDEN_STATUS = last ? Object.assign({}, GARDEN_STATUS, { at: Date.now(), crops: [{ name: 'garden', total: last.n, have: { hydro: last.h, lunar: last.l, color: last.c }, gold: lf.g, rainbow: lf.r, mutations: { wet: lf.w, chilled: lf.ch, frozen: lf.f, thunderstruck: lf.th, dawnlit: lf.d, amberlit: lf.a } }] }) : Object.assign({}, GARDEN_STATUS, { crops: [] }); GARDEN_STATS = Object.assign({}, GARDEN_STATS, { mutHistory: ${JSON.stringify(h)} }); STATUS = Object.assign({}, STATUS, { current: null, upcoming: ${JSON.stringify(upcoming)} }); MUT_UI = Object.assign(mutUi(), { hydro: true, lunar: true, color: true, wet: false, chilled: false, frozen: false, thunder: false, dawn: false, amber: false, gold: false, rainbow: false, hours: ${hours} }, ${JSON.stringify(lineSet || {})}); ${extra} showTab('garden'); const h2 = document.querySelector('h2[data-fold="garden/mutations-over-time"]'); if (h2 && h2.classList.contains('folded')) h2.click(); renderMutChart(); })()`;
      const scen = async (name, hours, h, extra, lineSet, liveFrom) => {
        await run(setup(hours, h, extra || '', lineSet, liveFrom));
        await wait(500);
        const r = { measure: await run(`(${MEASURE})('#mutChart svg.mut-chart')`) };
        r.checks = await run("[...document.querySelectorAll('#mutChart .mut-check')].map((l) => l.textContent.trim() + (l.classList.contains('on') ? ' [on]' : ''))");
        r.next = await run("[...document.querySelectorAll('#mutChart .mut-next div')].map((d) => d.textContent)");
        r.note = await run("(document.querySelector('#mutChart .note') || {}).textContent || null");
        await shotOf('#mutChart', `mut-${name}`, 6);
        return r;
      };
      mut.day = await scen('day', 24, hist);
      mut.day.hover = {
        past: await hoverAt('#mutChart svg.mut-chart', 0.45, 0.5, 'mut-past'),
        gap: await run(`(() => { const s = document.querySelector('#mutChart svg.mut-chart'); const sb = s.getBoundingClientRect(); const vb = s.viewBox.baseVal; const PADL = 32; const plotR = vb.width - 40; const tA = -24; const tB = 8; const xv = PADL + ((-15.5 - tA) / (tB - tA)) * (plotR - PADL); return xv / vb.width; })()`).then((fx) => hoverAt('#mutChart svg.mut-chart', fx, 0.5, 'mut-gap')),
        ahead: await run(`(() => { const s = document.querySelector('#mutChart svg.mut-chart'); const r = [...s.querySelectorAll('rect')].find((q) => q.getAttribute('fill') === '#7ab0e8'); if (!r) return null; const b = r.getBoundingClientRect(); const sb = s.getBoundingClientRect(); return { fx: (b.left + b.width / 2 - sb.left) / sb.width }; })()`),
      };
      if (mut.day.hover.ahead) mut.day.hover.aheadSeen = await hoverAt('#mutChart svg.mut-chart', mut.day.hover.ahead.fx, 0.5, 'mut-ahead');
      mut.week = await scen('week', 168, hist);
      mut.twelve = await scen('12h', 12, hist);
      // The separate lines: the hydro family split out, then all eight on
      // their own (the end labels give way to the legend), and a history
      // from before 0.53.3 (totals only) with a separate line ticked.
      mut.splitHydro = await scen('split-hydro', 24, hist, '', { lunar: false, color: false, wet: true, chilled: true, frozen: true, thunder: true });
      mut.splitAll = await scen('split-all', 24, hist, '', { hydro: false, lunar: false, color: false, wet: true, chilled: true, frozen: true, thunder: true, dawn: true, amber: true, gold: true, rainbow: true });
      mut.splitAll.endLabels = await run("document.querySelectorAll('#mutChart svg.mut-chart text.amt').length");
      mut.splitAll.paths = await run("[...document.querySelectorAll('#mutChart svg.mut-chart path.mc-glow')].map((p) => p.getAttribute('stroke'))");
      const old = hist.map((p) => ({ t: p.t, n: p.n, h: p.h, l: p.l, c: p.c }));
      mut.oldHistory = await scen('old-history', 24, old, '', { dawn: true, amber: true }, hist[hist.length - 1]);
      mut.oldHistory.subPaths = await run("[...document.querySelectorAll('#mutChart svg.mut-chart path.mc-glow')].filter((p) => ['#f9a8d4', '#fb923c'].includes(p.getAttribute('stroke'))).length");
      mut.fresh = await scen('fresh', 24, []);
      mut.justStarted = await scen('just-started', 24, [], "GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { at: Date.now(), crops: [{ name: 'garden', total: 270, have: { hydro: 200, lunar: 90, color: 60 } }] });");
      // Untick Weather: its line and its weather bands go; the choice is saved.
      await run(setup(24, hist));
      await wait(300);
      await run("(() => { const cb = document.querySelector('#mutChart [data-mutline=\"hydro\"]'); cb.click(); })()");
      await wait(900);
      mut.untick = {
        blueLines: await run("document.querySelectorAll('#mutChart svg.mut-chart path[stroke=\"#7ab0e8\"]').length"),
        blueBands: await run("document.querySelectorAll('#mutChart svg.mut-chart rect[fill=\"#7ab0e8\"]').length"),
        purpleLines: await run("document.querySelectorAll('#mutChart svg.mut-chart path[stroke=\"#c4b5fd\"]').length"),
        saved: (await run('window.app.getSettings()')).ui.mutChart,
      };
      await shotOf('#mutChart', 'mut-untick', 6);
      await run("(() => { const b = document.querySelector('#mutChart [data-mutrange=\"72\"]'); b.click(); })()");
      await wait(900);
      mut.range = (await run('window.app.getSettings()')).ui.mutChart;
      await run("(() => { document.querySelector('#mutChart [data-mutline=\"hydro\"]').click(); document.querySelector('#mutChart [data-mutrange=\"24\"]').click(); })()");
      // Real input (v0.51.1): a real click focuses the hidden checkbox, and
      // in 0.51.0 that scrolled the whole panel up and blanked the top.
      // Click every box off and on with the mouse, a range button, and Space
      // on a focused box; the page must never move and the header stays put.
      await run('renderGarden = window.__rg; true');
      await run("(() => { showTab('garden'); document.getElementById('mutChart').scrollIntoView({ block: 'center' }); })()");
      await wait(400);
      const pageState = () => run("(() => ({ page: document.scrollingElement.scrollTop, headerTop: Math.round(document.querySelector('header').getBoundingClientRect().top), boxes: [...document.querySelectorAll('#mutChart [data-mutline]')].map((c) => (c.checked ? 1 : 0)).join('') }))()");
      const realClick = async (sel) => {
        const b = await run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        for (const type of ['mouseDown', 'mouseUp']) panel().sendInputEvent({ type, x: Math.round(b.x), y: Math.round(b.y), button: 'left', clickCount: 1 });
        await wait(500);
        return pageState();
      };
      const clicks = [];
      for (let round = 0; round < 2; round += 1) {
        for (const id of ['hydro', 'lunar', 'color']) clicks.push(await realClick(`#mutChart label:has([data-mutline="${id}"])`));
      }
      clicks.push(await realClick('#mutChart [data-mutrange="12"]'));
      await run("document.querySelector('#mutChart [data-mutline=\"lunar\"]').focus()");
      panel().sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
      panel().sendInputEvent({ type: 'char', keyCode: ' ' });
      panel().sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
      await wait(500);
      clicks.push(await pageState());
      // The safety net on its own: scroll the page itself; it goes back.
      await run('document.scrollingElement.scrollTop = 300; true');
      await wait(300);
      const net = await pageState();
      mut.realInput = { clicks, net, pageEverMoved: clicks.some((s) => s.page !== 0 || s.headerTop !== 0) || net.page !== 0, boxesSeen: clicks.map((s) => s.boxes).join(' ') };
      await run("(() => { document.querySelector('#mutChart [data-mutline=\"lunar\"]').click(); })()");
      out.mut = mut;
    }
    if (MODE === 'map' || MODE === 'all') {
      const gm = {};
      // The real path: the stand-in's garden, through the observer and main.
      gm.real = await run(`(() => { const p = GARDEN_STATUS && GARDEN_STATUS.plan; return p ? { tiles: p.tiles.length, steps: p.tiles.map((t) => t.name + ': ' + t.step), summary: p.summary } : null; })()`);
      // A late-game garden: Moonbinders at 44 (left) and 155 (right), a
      // Dawnbinder at 128; Dawn-locked crops beside the 44 one, Amberlit ones
      // elsewhere, eggs and decor, two open spots (one beside a Moonbinder).
      const gp = require('../garden-plan');
      const plants = [];
      const tiles = {};
      const species = ['Dawnbreaker', 'Milkcap', 'Ube', 'StarCelestial', 'Marigold', 'Sunflower'];
      const base = { Dawnbreaker: 36e6, Milkcap: 9e6, Ube: 6e6, StarCelestial: 20e6, Marigold: 2.5e6, Sunflower: 1.9e6 };
      const mult = { wet: 2, chilled: 2, frozen: 6, thunderstruck: 5, dawnlit: 4, amberlit: 6, amberbound: 10, dawnbound: 7 };
      for (let i = 0; i < 200; i += 1) {
        if (i === 65 || i === 190) continue;                       // open
        if (i % 29 === 3) { tiles[i] = ['e', 'MythicalEgg']; continue; }
        if (i % 31 === 5) { tiles[i] = ['d', 'MiniFairyKeep']; continue; }
        let sp = species[(i * 7) % species.length];
        if (i === 44 || i === 155) sp = 'MoonCelestial';
        if (i === 128) sp = 'DawnCelestial';
        tiles[i] = ['p', sp];
        const h = (i * 13) % 10;
        const colour = h < 5 ? 'rainbow' : h < 8 ? 'gold' : '';
        const hydro = h < 7 ? 'frozen' : h < 8 ? 'wet' : '';
        let lunar = h % 3 === 0 ? 'dawnlit' : h % 3 === 1 ? 'amberlit' : '';
        if ([23, 24, 25, 43, 45, 63, 64].includes(i)) lunar = i % 2 ? 'dawnlit' : 'amberbound';
        const ripe = i % 17 === 0 ? 0 : 1;
        const size = i % 11 === 0 ? 82 : 100;
        const muts = [colour, hydro, lunar].filter(Boolean);
        const cm = (() => { const l = [mult[hydro], mult[lunar]].filter(Boolean); return l.length ? l.reduce((a, b) => a + b, 0) - l.length + 1 : 1; })();
        const b = sp.includes('Celestial') ? 22e6 : base[sp];
        const v = Math.round(b * (size / 100) * (colour === 'rainbow' ? 50 : colour === 'gold' ? 25 : 1) * cm);
        const n = sp === 'MoonCelestial' ? 3 : 1;
        plants.push({ i, sp, s: Array.from({ length: n }, () => [muts.join(','), size, ripe, v]) });
      }
      const plan = gp.plan(plants, Object.keys(tiles));
      // Stop the stand-in's live garden from replacing this one mid-test.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      if (gw) await gw.loadURL('about:blank').catch(() => {});
      await wait(1500);
      gm.summary = plan.summary;
      await run(`(() => { renderGarden = function () {}; GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { at: Date.now(), gardenTiles: ${JSON.stringify(tiles)}, plan: ${JSON.stringify(plan)} }); showTab('garden'); const h2 = document.querySelector('h2[data-fold="garden/garden-map"]'); if (h2 && h2.classList.contains('folded')) h2.click(); GM_SEL = null; spotHtml = ''; renderSpots(GARDEN_STATUS); document.getElementById('spotMap').scrollIntoView({ block: 'center' }); })()`);
      await wait(500);
      const realClick = async (sel) => {
        const b = await run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        if (!b) return false;
        await wait(200);
        for (const type of ['mouseDown', 'mouseUp']) panel().sendInputEvent({ type, x: Math.round(b.x), y: Math.round(b.y), button: 'left', clickCount: 1 });
        await wait(500);
        return true;
      };
      // Text inside the card that overlaps other text.
      const cardCheck = () => run(`(() => {
        const card = document.getElementById('spotMap').closest('.card');
        const els = [...card.querySelectorAll('.big-line, .seg button, #gmSummary, #gmKey span, .gm-tile .gt-name, .gm-tile .gt-top > span, .gt-where, .gt-muts, .gs-top > span, .gm-step li, .rule-name, .rule-desc')].filter((e) => e.offsetParent && e.getBoundingClientRect().width);
        const hits = [];
        for (let a = 0; a < els.length; a += 1) for (let b = a + 1; b < els.length; b += 1) {
          if (els[a].contains(els[b]) || els[b].contains(els[a])) continue;
          const p = els[a].getBoundingClientRect(); const q = els[b].getBoundingClientRect();
          if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 1.5 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 1.5) hits.push(els[a].textContent.trim().slice(0, 30) + ' <-> ' + els[b].textContent.trim().slice(0, 30));
        }
        const cr = card.getBoundingClientRect();
        const outside = els.filter((e) => { const r = e.getBoundingClientRect(); return r.right > cr.right + 1 || r.left < cr.left - 1; }).map((e) => e.textContent.trim().slice(0, 30));
        return { hits, outside, big: document.getElementById('spotCount').textContent, sub: document.getElementById('gmSummary').textContent, key: document.getElementById('gmKey').textContent };
      })()`);
      gm.views = {};
      for (const v of ['todo', 'value', 'spots']) {
        await realClick(`#gmView [data-val="${v}"]`);
        gm.views[v] = await cardCheck();
        gm.views[v].saved = (await run('window.app.getSettings()')).ui.gardenMap;
        await shotOf('.card:has(#spotMap)', `map-${v}`, 4);
      }
      await realClick('#gmView [data-val="todo"]');
      gm.tiles = {};
      for (const [name, i] of [['cleanse', plan.tiles.find((t) => t.step === 'cleanse')], ['pot', plan.tiles.find((t) => t.step === 'pot')], ['binder', plan.tiles.find((t) => t.step === 'binder')], ['wait', plan.tiles.find((t) => t.step === 'wait')], ['egg', { i: 3 }]].map(([n, t]) => [n, t && t.i])) {
        if (i == null) continue;
        await realClick(`#spotMap [data-i="${i}"]`);
        gm.tiles[name] = { i, text: (await run("document.getElementById('gmTile').innerText")).replace(/\n+/g, ' | '), check: (await cardCheck()).hits };
        await shotOf('#gmTile', `map-tile-${name}`, 8);
        await realClick(`#spotMap [data-i="${i}"]`);
      }
      gm.page = await run("document.scrollingElement.scrollTop");
      out.map = gm;
    }
  } catch (e) {
    out.errors.push('harness: ' + (e.stack || e));
  }
  fs.writeFileSync(path.join(__dirname, 'chart-result.json'), JSON.stringify(out, null, 2));
  app.exit(0);
});
