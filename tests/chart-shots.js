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
      // The top of the Money tab, as a player first sees it (v0.55.0 sweep).
      await run("(() => { showTab('money'); document.getElementById('tab-money').scrollIntoView({ block: 'start' }); return true; })()");
      await wait(400);
      fs.writeFileSync(path.join(SHOTS, 'money-top.png'), (await panel().capturePage()).toPNG());
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
    if (MODE === 'teambtn') {
      // The swap button on the game (v0.73.1, placed only when something
      // changed): where it sits, dragged, docked back with a double-click.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const gb = () => grun("(() => { const b = document.getElementById('mg-team-btn'); if (!b || b.style.display === 'none') return null; const q = b.getBoundingClientRect(); return { anchor: b.dataset.anchor || 'saved', x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width) }; })()");
      await wait(8000);
      const tb = { start: await gb() };
      const q = tb.start;
      gw.sendInputEvent({ type: 'mouseDown', x: q.x + 20, y: q.y + 10, button: 'left', clickCount: 1 });
      for (let k = 1; k <= 6; k += 1) gw.sendInputEvent({ type: 'mouseMove', x: q.x + 20 + k * 20, y: q.y + 10 + k * 15, modifiers: ['leftButtonDown'] });
      gw.sendInputEvent({ type: 'mouseUp', x: q.x + 140, y: q.y + 100, button: 'left', clickCount: 1 });
      await wait(800);
      tb.dragged = await gb();
      await wait(2500);
      tb.draggedLater = await gb();
      const q2 = tb.dragged;
      gw.sendInputEvent({ type: 'mouseDown', x: q2.x + 20, y: q2.y + 10, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseUp', x: q2.x + 20, y: q2.y + 10, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseDown', x: q2.x + 20, y: q2.y + 10, button: 'left', clickCount: 2 });
      gw.sendInputEvent({ type: 'mouseUp', x: q2.x + 20, y: q2.y + 10, button: 'left', clickCount: 2 });
      await wait(3000);
      tb.docked = await gb();
      // A saved sample carries the app's timing (v0.73.1).
      await run('window.app.gardenSample()');
      await wait(500);
      const sf = path.join(require('electron').app.getPath('userData'), 'garden-sample.json');
      const sj = JSON.parse(fs.readFileSync(sf, 'utf8'));
      tb.samplePerf = { main: Boolean(sj.perf && sj.perf.status && sj.perf.stalls), page: Boolean(sj.sample && sj.sample.perf && sj.sample.perf.jobs && sj.sample.perf.jobs.report) };
      out.teambtn = tb;
      const ok = tb.start && tb.dragged && Math.abs(tb.dragged.x - (tb.start.x + 120)) <= 3 && Math.abs(tb.dragged.y - (tb.start.y + 90)) <= 3 && tb.draggedLater.x === tb.dragged.x && tb.draggedLater.y === tb.dragged.y && tb.docked.x === tb.start.x && tb.docked.y === tb.start.y && tb.samplePerf.main && tb.samplePerf.page;
      if (!ok) out.errors.push(`team button: ${JSON.stringify(tb)}`);
    }
    if (MODE === 'freeze') {
      // The owner's freeze while moving plants (v0.73.1): a late-game garden
      // (MG_BIG_GARDEN=1 on the stand-in), a pot-and-replant every ~1.6 s for
      // a minute, and what the app costs: the main process's stalls and its
      // time per game report, the game page's long tasks and the app's share
      // of them, and the game page's frame gaps.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const T = global.__mgTest;
      await wait(9000);
      await run("(() => { const b = document.querySelector('#setupSheet [data-wgo=\"skip\"]'); if (b && !document.getElementById('setupSheet').hidden) b.click(); return true; })()");
      for (let i = 0; i < 12; i += 1) {
        if (await run("(() => { const b = document.getElementById('shareAskNo'); if (b) b.click(); return Boolean(b); })()")) break;
        await wait(300);
      }
      await wait(3000);
      const fz = { label: process.env.MG_FREEZE_LABEL || 'default' };
      // A game-sized page (MG_FREEZE_DOM=1): thousands of elements, many with
      // "pet", "modal" or "popover" in their class like a real UI kit, and
      // something on it changing every frame, so anything that reads the
      // layout pays for a fresh one, the way it does on the live game.
      if (process.env.MG_FREEZE_DOM) {
        await grun(`(() => {
          const root = document.createElement('div');
          root.id = 'fakeGameUi';
          root.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:hidden;';
          const kinds = ['pet-slot', 'chakra-popover__popper', 'chakra-modal__overlay', 'inventory-item', 'hotbar-cell', 'tooltip', 'carpet-tile', 'competitor-row'];
          let html = '';
          for (let i = 0; i < 2500; i += 1) html += '<div class="' + kinds[i % kinds.length] + '" style="position:absolute;left:' + (i % 50) * 18 + 'px;top:' + Math.floor(i / 50) * 12 + 'px;width:16px;height:10px;font-size:9px">' + (i % 7 ? '' : 'Pet ' + i) + '<span><b>x</b></span></div>';
          root.innerHTML = html;
          document.body.appendChild(root);
          const cells = root.children;
          let k = 0;
          const spin = () => { const c = cells[k % cells.length]; c.style.width = (14 + (k % 5)) + 'px'; k += 1; if (!window.__fzStop) requestAnimationFrame(spin); };
          requestAnimationFrame(spin);
          return true;
        })()`);
        await wait(1000);
      }
      fz.before = { main: T.perfView(), page: await grun('window.__mgLoaderObserver.perfView()') };
      await grun("(() => { window.__fz = { frames: 0, gaps: 0, max: 0, over50: 0, over100: 0 }; let last = performance.now(); const loop = (t) => { const g = t - last; last = t; window.__fz.frames += 1; window.__fz.max = Math.max(window.__fz.max, g); if (g > 50) window.__fz.over50 += 1; if (g > 100) window.__fz.over100 += 1; if (!window.__fzStop) requestAnimationFrame(loop); }; requestAnimationFrame(loop); return true; })()");
      const send = (cmd) => grun(`window.__gameSend(${JSON.stringify(cmd)})`);
      // A plant goes into a pot and down on an open spot, then back, and on.
      const big = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'big-garden.json'), 'utf8'));
      const taken = new Set(big.plants.map((p) => p.i));
      const open = [];
      for (let i = 0; i < 200; i += 1) if (!taken.has(i)) open.push(i);
      const where = big.plants.slice(0, 40).map((p) => p.i);
      const t0 = Date.now();
      let moves = 0;
      for (let k = 0; Date.now() - t0 < 60000; k += 1) {
        const pair = k % (2 * open.length);
        const spot = open[Math.floor(pair / 2) % open.length];
        const home = where[Math.floor(k / 2) % where.length];
        const from = pair % 2 === 0 ? home : spot;
        const to = pair % 2 === 0 ? spot : home;
        await send({ type: 'SetSelectedItem', itemId: 'PlanterPot', decorRotation: 0 });
        await wait(300);
        await send({ type: 'PotPlant', slot: from, plantItemId: 'mv-' + k });
        await wait(500);
        await send({ type: 'SetSelectedItem', itemId: 'mv-' + k, decorRotation: 0 });
        await wait(300);
        await send({ type: 'PlantGardenPlant', slot: to, itemId: 'mv-' + k });
        await wait(500);
        moves += 1;
      }
      await grun('window.__fzStop = true');
      fz.moves = moves;
      fz.frames = await grun('window.__fz');
      fz.after = { main: T.perfView(), page: await grun('window.__mgLoaderObserver.perfView()') };
      out.freeze = fz;
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
      // Where the grid is on screen (v0.56.7): it must not move between views.
      const grid = () => grun("(() => { const b = document.getElementById('mg-map'); if (!b || b.style.display === 'none') return null; const g = b.children[2].getBoundingClientRect(); return [Math.round(g.left), Math.round(g.top), Math.round(g.width), Math.round(g.height)].join(','); })()");
      // The game's page counts padding inside widths (v0.56.8); the stand-in
      // does the same here, and the grid must stay inside the box in every view.
      await grun("(() => { const s = document.createElement('style'); s.textContent = '*, *::before, *::after { box-sizing: border-box; }'; document.head.appendChild(s); return true; })()");
      const fits = () => grun("(() => { const b = document.getElementById('mg-map'); if (!b || b.style.display === 'none') return null; const B = b.getBoundingClientRect(); const g = b.children[2].getBoundingClientRect(); const k = b.lastChild.getBoundingClientRect(); return g.left >= B.left && g.right <= B.right - 1 && k.right <= B.right - 1 && k.bottom <= B.bottom; })()");
      om.fits = {};
      om.grid = {};
      // The owner's case: a capture pet out, then a pot picked up.
      await setup({ ostrich: true });
      await wait(400);
      om.grid.captureOut = await grid();
      const snap = async (name) => {
        const r = await grun("(() => { const q = document.getElementById('mg-map').getBoundingClientRect(); return [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)]; })()");
        fs.mkdirSync(SHOTS, { recursive: true });
        const img = await gw.capturePage();
        fs.writeFileSync(path.join(SHOTS, `${name}.png`), img.crop({ x: Math.max(0, r[0] - 4), y: Math.max(0, r[1] - 4), width: r[2] + 8, height: r[3] + 8 }).toPNG());
      };
      await wait(400);
      await snap('map-capture');
      om.fits.captureOut = await fits();
      await setup({ ostrich: true, pot: true, open: [65, 190] });
      await wait(400);
      om.grid.thenPot = await grid();
      await wait(400);
      await snap('map-spots');
      om.fits.thenPot = await fits();
      await setup({ wolf: true });
      await wait(400);
      om.wolf = await view();
      om.grid.wolf = await grid();
      om.fits.wolf = await fits();
      await setup({ wolf: true, ostrich: true });
      await wait(400);
      om.wolfOstrich = await view();
      om.grid.wolfOstrich = await grid();
      om.fits.wolfOstrich = await fits();
      await setup({ wolf: true, ostrich: true, amber: true });
      await wait(400);
      om.plusAmber = await view();
      om.grid.plusAmber = await grid();
      om.fits.plusAmber = await fits();
      await setup({ wolf: true, ostrich: true, amber: true, ride: true });
      await wait(400);
      om.plusRide = await view();
      om.grid.plusRide = await grid();
      om.fits.plusRide = await fits();
      await setup({ wolf: true, ostrich: true, amber: true, ride: true, pot: true, open: [65, 190] });
      await wait(500);
      om.plusPot = await view();
      om.grid.plusPot = await grid();
      om.fits.plusPot = await fits();
      // During the Amber Moon with a pot in hand (v0.54.6): the binder map,
      // with the open spots on it.
      om.potOnBinder = await grun("(() => { const b = document.getElementById('mg-map'); const cells = b.querySelectorAll('div > i'); const at = (i) => { const c = [...b.querySelectorAll('i')].filter((x) => x.parentElement && x.parentElement.children.length === 100)[0]; return null; }; const grid = [...b.querySelectorAll('i')].filter((x) => !x.closest('span')); const bg = (i) => grid[i] ? getComputedStyle(grid[i]).backgroundColor : null; return { line: b.children[1] ? b.children[1].textContent : '', open65: bg(65), open190: bg(190), key: b.lastChild.textContent }; })()");
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
      if (om.folded) {
        const hd2 = await grun("(() => { const t = document.querySelector('#mg-map .mg-title'); const q = t.getBoundingClientRect(); return { x: Math.round(q.left + 20), y: Math.round(q.top + q.height / 2) }; })()");
        if (await grun("document.getElementById('mg-map').classList.contains('mg-folded')")) {
          gw.sendInputEvent({ type: 'mouseDown', x: hd2.x, y: hd2.y, button: 'left', clickCount: 1 });
          gw.sendInputEvent({ type: 'mouseUp', x: hd2.x, y: hd2.y, button: 'left', clickCount: 1 });
          await wait(500);
        }
      }
      await setup({ ostrich: true });
      await wait(400);
      om.grid.movedCapture = await grid();
      await setup({ ostrich: true, pot: true, open: [65, 190] });
      await wait(400);
      om.grid.movedThenPot = await grid();
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
      // The harvest team picker (v0.73.0), with the new user setup closed.
      await run("(() => { const b = document.querySelector('#setupSheet [data-wgo=\"skip\"]'); if (b && !document.getElementById('setupSheet').hidden) b.click(); return true; })()");
      for (let i = 0; i < 12; i += 1) {
        if (await run("(() => { const b = document.getElementById('shareAskNo'); if (b) b.click(); return Boolean(b); })()")) break;
        await wait(300);
      }
      await run("window.app.harvestSet({ team: 'teamB', teamBack: true }).then((l) => { LOCK = l; showTab('garden'); showGardenView('harvest', false); renderLock(); document.getElementById('hvTeam').scrollIntoView({ block: 'center' }); return true; })");
      await wait(500);
      hm.teamPicker = await run("(() => { const s = document.getElementById('hvTeam'); const r = s.getBoundingClientRect(); const card = s.closest('.card').getBoundingClientRect(); return { value: s.value, desc: document.getElementById('hvTeamDesc').textContent, inside: r.right <= card.right + 0.5, back: !document.getElementById('hvTeamBackRow').hidden }; })()");
      await shotOf('div.card[data-gview="harvest"]', 'harvest-team', 4);
      await run("window.app.harvestSet({ team: null }).then((l) => { LOCK = l; renderLock(); return true; })");
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
    if (MODE === 'ready') {
      // One \"ready\" (v0.54.7): the harvest rule decides it everywhere. A
      // fresh profile starts from the old ready rule; with the owner's rule
      // and garden, the Garden tab's ready tile and the Harvesting & ready
      // count agree, and the words say the rule.
      const fx = require('./fixtures/garden-layout.json');
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const rd = {};
      rd.freshRule = (await run('window.app.harvestGet()')).mode;
      const mine = { color: 'goldOrRainbow', hydro: ['thundercharged', 'frozen'], lunar: ['amberbound'], size: true };
      await run(`window.app.harvestSet({ mode: ${JSON.stringify(mine)} })`);
      await grun(`(() => {
        const obs = window.__mgLoaderObserver; const gardens = []; const seen = new Set();
        const walk = (x, d) => { if (!x || typeof x !== 'object' || seen.has(x) || d > 9) return; seen.add(x); if (x.tileObjects && typeof x.tileObjects === 'object' && !Array.isArray(x.tileObjects)) gardens.push(x); for (const k of Object.keys(x)) walk(x[k], d + 1); };
        walk(obs.state, 0);
        const fx = ${JSON.stringify(fx)};
        const at = new Map(fx.plants.map((p) => [p.i, p]));
        const T = {};
        for (const i of fx.occupied) { const p = at.get(i); T[i] = p ? { objectType: 'plant', species: p.sp, slots: p.s.map(([m, size, ripe]) => ({ species: p.sp, mutations: m ? m.split(',') : [], size, endTime: ripe ? Date.now() - 1000 : Date.now() + 1e7 })) } : { objectType: 'decor', decorId: 'WoodBench' }; }
        for (const g of gardens) g.tileObjects = T;
        obs.setHarvestLock(Object.assign({}, obs.harvestLock));
        return true;
      })()`);
      await wait(6000);
      rd.counts = await run("(() => { const b = gardenBucket(GARDEN_STATUS); const hm = GARDEN_STATUS.harvestMatch || {}; return { gardenTileReady: b && b.ready, harvestCard: hm.crops, ripe: hm.ripe, total: b && b.total }; })()");
      rd.tile = await run("(() => { showTab('garden'); renderGarden(); const t = [...document.querySelectorAll('#cropStats .gc-stat')].find((x) => /ready/.test(x.textContent)); return t ? { shows: t.innerText.replace(/\\n/g, ' '), tooltip: t.title } : null; })()");
      rd.harvestCard = await run("document.querySelector('#harvestRule .hv-match') ? document.querySelector('#harvestRule .hv-match').innerText : null");
      rd.summary = await run("(document.querySelector('h2[data-fold=\"garden/harvest-lock\"] .fold-sum') || {}).textContent || null");
      const view = await run('window.app.budgetGet()');
      rd.stageLabels = (view.cropStage && view.cropStage.steps || []).map((s) => `${s.label}${s.required ? '' : ' (not asked)'}: ${s.count}`);
      rd.moneyLine = await run("(() => { READY_OPEN = true; showTab('money'); renderBudget(); const n = [...document.querySelectorAll('#moneyGrowth .note')].find((x) => /Ready means/.test(x.textContent)); return n ? n.innerText : null; })()");
      out.ready = rd;
    }
    if (MODE === 'accounts') {
      // A second account (v0.55.0): its own login, a tab bar, both live, the
      // panel following account 1. Run with MG_TEST_DIALOGS=1.
      const { BaseWindow, webContents, Menu } = require('electron');
      const ac = {};
      const games = () => webContents.getAllWebContents().filter((c) => /magicgarden\.gg/.test(c.getURL()) && !c.getURL().includes('about:'));
      const tabsWc = () => webContents.getAllWebContents().find((c) => /tabs\.html$/.test(c.getURL()));
      ac.before = await run('window.app.accountsGet()');
      const selfBefore = await run('GARDEN_STATUS && GARDEN_STATUS.self ? GARDEN_STATUS.self.id : null');
      ac.added = await run('window.app.accountsAdd()');
      await wait(9000);
      const g = games();
      ac.gamePages = g.length;
      ac.separateLogins = g.length === 2 && g[0].session !== g[1].session;
      ac.stores = g.map((c) => (c.session.getStoragePath() || '').split(/[\\/]/).slice(-1)[0]);
      ac.state = await run('window.app.accountsGet()');
      const tw = tabsWc();
      ac.tabs = tw ? await tw.executeJavaScript("[...document.querySelectorAll('.tab')].map((t) => t.innerText.trim() + (t.classList.contains('on') ? ' [on]' : ''))") : null;
      const win = BaseWindow.getAllWindows().find((w) => w.contentView && w.contentView.children.length >= 3);
      ac.views = win ? win.contentView.children.map((v) => ({ y: v.getBounds().y, h: v.getBounds().height, muted: v.webContents && v.webContents.isAudioMuted ? v.webContents.isAudioMuted() : null, url: v.webContents ? v.webContents.getURL().replace(/^https?:\/\//, '').slice(0, 24) : '' })) : null;
      ac.pageVisibility = await Promise.all(games().map((c) => c.executeJavaScript('document.visibilityState')));
      // Switch with the menu's Ctrl+Tab item.
      const item = (label) => { let hit = null; const walk = (mm) => { for (const it of mm.items) { if (it.label === label) hit = it; if (it.submenu) walk(it.submenu); } }; walk(Menu.getApplicationMenu()); return hit; };
      item('Switch account').click();
      await wait(600);
      ac.afterSwitch = (await run('window.app.accountsGet()')).active;
      ac.mutedAfterSwitch = games().map((c) => c.isAudioMuted());
      ac.visibilityAfterSwitch = await Promise.all(games().map((c) => c.executeJavaScript('document.visibilityState')));
      // Hidden for a while: still live?
      await wait(12000);
      ac.hiddenStillLive = (await run('window.app.accountsGet()')).accounts.map((a) => a.live);
      ac.panelStillAccount1 = (await run('GARDEN_STATUS && GARDEN_STATUS.self ? GARDEN_STATUS.self.id : null')) === selfBefore;
      ac.savedOpen = Boolean((await run('window.app.getSettings()')).ui.secondAccount);
      // The panel's section.
      ac.panel = await run("(() => { showTab('scripts'); renderAccounts(); return document.getElementById('accountsList').innerText.split('\\n').filter(Boolean); })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      if (tw) fs.writeFileSync(path.join(SHOTS, 'accounts-tabs.png'), (await tw.capturePage()).toPNG());
      await shotOf('#accountsCard', 'accounts-card', 6);
      ac.removed = await run('window.app.accountsRemove()');
      await wait(1500);
      ac.afterRemove = { pages: games().length, savedOpen: Boolean((await run('window.app.getSettings()')).ui.secondAccount), tabsBarHeight: win.contentView.children.filter((v) => v.webContents && /tabs\.html$/.test(v.webContents.getURL())).map((v) => v.getBounds().height) };
      out.accounts = ac;
    }
    if (MODE === 'stage') {
      // Your stage (v0.56.0 beta): Auto on the stand-in's small garden, a
      // real click on Late and back, what each stage leads with.
      const sg = {};
      const click = async (sel) => {
        const r = await run(`(() => { const b = document.querySelector('${sel}'); const q = b.getBoundingClientRect(); return { x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2) }; })()`);
        panel().sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
        panel().sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
        await wait(900);
      };
      const read = () => run(`(() => ({
        stage: GARDEN_STATUS && GARDEN_STATUS.stage ? { id: GARDEN_STATUS.stage.id, auto: GARDEN_STATUS.stage.auto, picked: GARDEN_STATUS.stage.picked } : null,
        seg: [...document.querySelectorAll('#stageSeg button')].map((b) => b.textContent + (b.classList.contains('on') ? ' [on]' : '')),
        strip: [...document.querySelectorAll('#stageStrip .ss-item')].map((b) => b.innerText.replace(/\\n/g, ' · ')),
        gardenFirst: [...document.querySelectorAll('#tab-garden > h2')].slice(0, 3).map((h) => h.dataset.fold + (h.classList.contains('stage-lead') ? ' ★' : '')),
        petsFirst: [...document.querySelectorAll('#tab-pets > h2')].slice(0, 2).map((h) => h.dataset.fold),
      }))()`);
      await wait(4000);
      // Off by default (v0.56.6): no bar, every tab in its own order.
      const order = () => run("[...document.querySelectorAll('#tab-garden > h2')].map((h) => h.dataset.fold.split('/')[1])");
      sg.byDefault = { barShown: await run("getComputedStyle(document.getElementById('stageBar')).display !== 'none'"), garden: await order() };
      const turn = (on) => run(`(async () => { const v = await window.app.stageOnSet(${on}); S.ui = Object.assign({}, S.ui, { stageOn: v }); renderStageBar(); renderBudget(); return v; })()`);
      sg.turnedOn = await turn(true);
      await wait(800);
      sg.auto = await read();
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('#stageBar', 'stage-bar-auto', 4);
      await click('#stageSeg [data-val="late"]');
      sg.late = await read();
      sg.savedPick = ((await run('window.app.getSettings()')).stage || {}).pick;
      await shotOf('#stageBar', 'stage-bar-late', 4);
      // A strip number jumps to where it's explained.
      await click('#stageStrip .ss-item');
      sg.jumped = await run("document.querySelector('nav [aria-selected=\"true\"]').dataset.tab");
      await click('#stageSeg [data-val="auto"]');
      sg.backToAuto = await read();
      sg.card = await run("(() => { showTab('garden'); renderBudget(); const h = document.querySelector('h2[data-fold=\"garden/your-stage\"]'); if (h && h.classList.contains('folded')) h.click(); document.getElementById('moneyStage').scrollIntoView({ block: 'start' }); return document.getElementById('moneyStage').innerText.split('\\n').filter(Boolean).slice(0, 12); })()");
      await wait(400);
      await shotOf('#moneyStage', 'stage-card', 6);
      // How far into the stage (v0.56.1): her account (early in Late) and
      // the owner's (deep in Late), rendered straight from the engine.
      const stg = require('../stage');
      const views = {
        gf: stg.detect({ netWorth: 211e9, crops: 150, colorShare: 0.45, celestials: 10, binders: 2, granters: 8, sellPart: 1 }),
        owner: stg.detect({ netWorth: 1.27e12, crops: 270, colorShare: 0.87, celestials: 13, binders: 5, granters: 2, sellPart: 1.313 }),
      };
      for (const [who, G] of Object.entries(views)) {
        sg[who] = await run(`(() => {
          GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { stage: ${JSON.stringify(G)} });
          renderStageBar();
          showTab('garden');
          renderBudget();
          return {
            seg: [...document.querySelectorAll('#stageSeg button')].map((b) => b.textContent),
            strip: [...document.querySelectorAll('#stageStrip .ss-item')].map((b) => b.innerText.replace(/\\n/g, ' · ')),
            gardenLead: [...document.querySelectorAll('#tab-garden > h2.stage-lead')].map((h) => h.dataset.fold.split('/')[1]),
            card: document.getElementById('moneyStage').innerText.split('\\n').filter(Boolean).slice(8, 16),
          };
        })()`);
        if (who === 'gf') {
          await shotOf('#stageBar', 'stage-bar-gf', 4);
          await run("document.getElementById('moneyStage').scrollIntoView({ block: 'start' })");
          await wait(300);
          await shotOf('#moneyStage', 'stage-card-gf', 6);
        }
      }
      // Off again: the bar goes and every tab is back in its own order.
      await turn(false);
      await wait(600);
      sg.turnedOff = { barShown: await run("getComputedStyle(document.getElementById('stageBar')).display !== 'none'"), garden: await order(), stars: await run("document.querySelectorAll('h2.stage-lead').length"), saved: (await run('window.app.getSettings()')).ui.stageOn };
      sg.restored = JSON.stringify(sg.turnedOff.garden) === JSON.stringify(sg.byDefault.garden);
      out.stage = sg;
    }
    if (MODE === 'lastteam') {
      // Swap to your last pet team (v0.56.2), on the stand-in's teams: real
      // swaps, a real click on the button, the menu's shortcut.
      const { Menu } = require('electron');
      const lt = {};
      const outTeam = () => run("(() => { const st = GARDEN_STATUS || {}; const out = new Set((st.pets || []).map((p) => String(p.id))); const t = (st.teams || []).find((x) => x.members.length && x.members.every((m) => out.has(m.petId))); return t ? t.name : null; })()");
      const btn = () => run("(() => { const b = document.getElementById('lastTeamBtn'); return { title: b.title, dim: b.classList.contains('none') }; })()");
      await wait(5000);
      const teams = await run("(GARDEN_STATUS.teams || []).map((t) => ({ id: t.id, name: t.name }))");
      lt.teams = teams.map((t) => t.name);
      lt.outAtStart = await outTeam();
      lt.buttonAtStart = await btn();
      const other = teams.find((t) => t.name !== lt.outAtStart);
      await run(`window.app.applyTeam(${JSON.stringify(other.id)})`);
      await wait(7000);
      lt.afterSwap = { out: await outTeam(), last: await run('GARDEN_STATUS.lastTeam && GARDEN_STATUS.lastTeam.name'), button: await btn() };
      // The button, clicked for real.
      // Window coordinates: the panel's own, times its zoom.
      const r = await run("(() => { const q = document.getElementById('lastTeamBtn').getBoundingClientRect(); const z = window.devicePixelRatio || 1; return { x: Math.round((q.left + q.width / 2) * z), y: Math.round((q.top + q.height / 2) * z) }; })()");
      panel().sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      panel().sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await wait(7000);
      lt.afterButton = { out: await outTeam(), last: await run('GARDEN_STATUS.lastTeam && GARDEN_STATUS.lastTeam.name'), toast: await run("(document.querySelector('.toast') || {}).textContent || null") };
      // The menu item (Ctrl+Shift+T).
      let item = null;
      const walk = (mm) => { for (const it of mm.items) { if (it.label === 'Swap to last pet team') item = it; if (it.submenu) walk(it.submenu); } };
      walk(Menu.getApplicationMenu());
      lt.menu = item ? item.accelerator : null;
      if (item) item.click();
      await wait(7000);
      lt.afterMenu = { out: await outTeam(), last: await run('GARDEN_STATUS.lastTeam && GARDEN_STATUS.lastTeam.name') };
      lt.saved = (await run('window.app.getSettings()')).teamsLast;
      // The button on the game (v0.56.4).
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const gb = () => grun("(() => { const b = document.getElementById('mg-team-btn'); if (!b || b.style.display === 'none') return null; const q = b.getBoundingClientRect(); return { text: b.textContent, dim: b.style.opacity, anchor: b.dataset.anchor || 'saved', x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height) }; })()");
      lt.gameBtn = await gb();
      const outBefore = await outTeam();
      const p = lt.gameBtn;
      gw.sendInputEvent({ type: 'mouseDown', x: p.x + 20, y: p.y + 10, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseUp', x: p.x + 20, y: p.y + 10, button: 'left', clickCount: 1 });
      // The note shows for about two seconds after the app answers.
      let note = null;
      for (let k = 0; k < 20 && !note; k += 1) {
        await wait(250);
        note = await grun("(() => { const n = [...document.querySelectorAll('div')].find((d) => /^🐾/.test(d.textContent || '') && d.style.opacity === '1'); return n ? n.textContent : null; })()");
      }
      await wait(6000);
      lt.gameClick = { before: outBefore, after: await outTeam(), note, btn: (await gb()).text };
      fs.mkdirSync(SHOTS, { recursive: true });
      const shot = await gw.capturePage();
      const b2 = await gb();
      fs.writeFileSync(path.join(SHOTS, 'team-btn-game.png'), shot.crop({ x: Math.max(0, b2.x - 10), y: Math.max(0, b2.y - 10), width: Math.min(360, b2.w + 260), height: b2.h + 20 }).toPNG());
      // Drag it, then double-click it back.
      const q = await gb();
      gw.sendInputEvent({ type: 'mouseDown', x: q.x + 20, y: q.y + 10, button: 'left', clickCount: 1 });
      for (let k = 1; k <= 6; k += 1) gw.sendInputEvent({ type: 'mouseMove', x: q.x + 20 + k * 20, y: q.y + 10 + k * 15, modifiers: ['leftButtonDown'] });
      gw.sendInputEvent({ type: 'mouseUp', x: q.x + 140, y: q.y + 100, button: 'left', clickCount: 1 });
      await wait(800);
      lt.dragged = { moved: await gb(), saved: ((await run('window.app.getSettings()')).ui.mapPos || {})['mg-team-btn'] || null, teamUnchanged: (await outTeam()) === lt.gameClick.after };
      const q2 = await gb();
      const teamBeforeDbl = await outTeam();
      gw.sendInputEvent({ type: 'mouseDown', x: q2.x + 20, y: q2.y + 10, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseUp', x: q2.x + 20, y: q2.y + 10, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseDown', x: q2.x + 20, y: q2.y + 10, button: 'left', clickCount: 2 });
      gw.sendInputEvent({ type: 'mouseUp', x: q2.x + 20, y: q2.y + 10, button: 'left', clickCount: 2 });
      await wait(7000);
      lt.reset = { at: await gb(), saved: ((await run('window.app.getSettings()')).ui.mapPos || {})['mg-team-btn'] || null, teamUnchanged: (await outTeam()) === teamBeforeDbl };
      await run('window.app.teamBtnSet(false)');
      await wait(600);
      lt.switchedOff = await gb();
      await run('window.app.teamBtnSet(true)');
      out.lastteam = lt;
    }
    if (MODE === 'lineup') {
      // The swap button (v0.72.2): a lineup counts as a team when the Pet
      // Hutch window closes, a whole team goes out, you do something else,
      // or you press the button. No timer, no limit. On the stand-in's
      // hutch (Sheep pet-3, Horse pet-4) and teams (Farm = Worm pet-1, Dawn
      // = Bunny pet-2); the hutch window is a stand-in dialog.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const send = (cmd) => grun(`window.__gameSend(${JSON.stringify(cmd)})`);
      const moveOn = () => send({ type: 'HarvestCrop', slotsIndex: 3 });
      const hutch = (out, inn) => send({ type: 'SwapPetFromStorage', petSlotId: out, storagePetId: inn, storageId: 'PetHutch' });
      const openHutch = () => grun("(() => { const d = document.createElement('div'); d.id = 'standInHutch'; d.setAttribute('role', 'dialog'); d.style.cssText = 'position:fixed;left:240px;top:140px;width:320px;height:220px;background:#333;color:#fff;z-index:5;padding:10px'; d.textContent = 'Pet Hutch'; document.body.appendChild(d); return true; })()");
      const closeHutch = () => grun("(() => { const d = document.getElementById('standInHutch'); if (d) d.remove(); return true; })()");
      const state = () => grun("(() => { const o = window.__mgLoaderObserver; const s = o.sample().mySlot; const name = (ids) => (ids || []).join(','); return { out: (s.data.petSlots || []).map((p) => p.petSpecies).join(','), settled: name(o.lineups.settled), last: o.lineups.lastLabel, btn: (document.getElementById('mg-team-btn') || {}).textContent || null, open: o.hutch.open }; })()");
      const press = async () => {
        const b = await grun("(() => { const q = document.getElementById('mg-team-btn').getBoundingClientRect(); return { x: Math.round(q.left + 20), y: Math.round(q.top + q.height / 2) }; })()");
        gw.sendInputEvent({ type: 'mouseDown', x: b.x, y: b.y, button: 'left', clickCount: 1 });
        gw.sendInputEvent({ type: 'mouseUp', x: b.x, y: b.y, button: 'left', clickCount: 1 });
      };
      const ln = {};
      await wait(5000);
      ln.start = await state();
      // 1. In the hutch, one by one: nothing counts until the window closes.
      await openHutch();
      await wait(900);
      await hutch('pet-1', 'pet-3');
      await wait(1200);
      ln.inHutch = await state();
      await hutch('pet-3', 'pet-4');
      await wait(1200);
      ln.inHutch2 = await state();
      await closeHutch();
      await wait(1600);
      ln.closed = await state();
      // 2. Press: back right away; press again: back again.
      await press();
      await wait(1600);
      ln.press1 = await state();
      await press();
      await wait(1600);
      ln.press2 = await state();
      // 3. Two presses at once: the second waits for the first to land.
      const r1 = await run('window.app.lastTeam()');
      const r2 = await run('window.app.lastTeam()');
      ln.fast = { r1, r2 };
      await wait(1600);
      ln.afterFast = await state();
      // 4. No limit: eight presses in a row, each one swaps.
      const many = [];
      for (let i = 0; i < 8; i += 1) {
        many.push(await run('window.app.lastTeam()'));
        await wait(1300);
      }
      ln.many = many.map((r) => (r && r.ok ? r.team : (r && r.reason) || null));
      // 5. Swapped by hand with no hutch window seen: a press counts what's out.
      ln.beforeHand = await state();
      await hutch('pet-1', 'pet-3');
      await wait(1200);
      ln.handNoWindow = await state();
      await press();
      await wait(1600);
      ln.handPressed = await state();
      // 6. Doing something else after swapping counts it too.
      await hutch('pet-1', 'pet-4');
      await wait(900);
      await moveOn();
      await wait(1200);
      ln.movedOn = await state();
      // 7. One of your saved teams from the game: counts as soon as it's out.
      await send({ type: 'ApplyPetTeam', teamId: 'teamB' });
      await wait(1600);
      ln.gameTeam = await state();
      out.lineup = ln;
      const okLn = ln.start.settled === 'pet-1' && ln.inHutch.out === 'Sheep' && ln.inHutch.settled === 'pet-1' && ln.inHutch.open && /Farm team/.test(ln.inHutch.btn || '')
        && ln.inHutch2.settled === 'pet-1' && ln.closed.settled === 'pet-4' && ln.closed.last === 'Farm team' && !ln.closed.open && /Farm team/.test(ln.closed.btn || '')
        && ln.press1.out === 'Worm' && ln.press1.last === 'Horse' && /Horse/.test(ln.press1.btn || '') && ln.press2.out === 'Horse' && ln.press2.last === 'Farm team'
        && ln.fast.r1.ok && ln.fast.r2.busy && ln.afterFast.out === 'Worm'
        && ln.many.every((t, i) => t === (i % 2 ? 'Farm team' : 'Horse')) && ln.beforeHand.out === 'Worm'
        && ln.handNoWindow.out === 'Sheep' && ln.handNoWindow.settled === 'pet-1' && /Farm team/.test(ln.handNoWindow.btn || '')
        && ln.handPressed.out === 'Worm' && ln.handPressed.last === 'Sheep'
        && ln.movedOn.settled === 'pet-4' && ln.movedOn.last === 'Farm team' && ln.gameTeam.settled === 'pet-2' && ln.gameTeam.last === 'Horse';
      if (!okLn) out.errors.push(`lineup: ${JSON.stringify(ln)}`);
    }
    if (MODE === 'mapmatrix') {
      // Every combination that matters (v0.56.10): Dawn / Amber Moon, a pot
      // in hand, the Thunder Wolf, Ostrich and Phoenix out or ridden, on the
      // owner's garden. Open spots: 86 (beside a Moonbinder), 10 (beside a
      // Dawnbinder), 0 and 2 (elsewhere). Each: the view, tabs, words, a shot.
      const fx = require('./fixtures/garden-layout.json');
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      await grun("(() => { const s = document.createElement('style'); s.textContent = '*, *::before, *::after { box-sizing: border-box; }'; document.head.appendChild(s); return true; })()");
      const OPEN = [86, 10, 0, 2];
      const setup = (o) => grun(`(() => {
        const obs = window.__mgLoaderObserver; const gardens = []; const slots = []; const seen = new Set();
        const walk = (x, d) => { if (!x || typeof x !== 'object' || seen.has(x) || d > 9) return; seen.add(x); if (x.tileObjects && typeof x.tileObjects === 'object' && !Array.isArray(x.tileObjects)) gardens.push(x); if (x.data && typeof x.data === 'object' && x.data.garden && Array.isArray(x.data.petSlots)) slots.push(x); for (const k of Object.keys(x)) walk(x[k], d + 1); };
        walk(obs.state, 0);
        const fx = ${JSON.stringify(fx)};
        const o = ${JSON.stringify(o)};
        const at = new Map(fx.plants.map((p) => [p.i, p]));
        const T = {};
        for (const i of fx.occupied) {
          if ((o.pot || o.empty) && ${JSON.stringify(OPEN)}.includes(i)) continue;
          const p = at.get(i);
          T[i] = p ? { objectType: 'plant', species: p.sp, slots: p.s.map(([m, size, ripe]) => ({ species: p.sp, mutations: m ? m.split(',') : [], size, endTime: ripe ? Date.now() - 1000 : Date.now() + 1e7 })) } : { objectType: 'decor', decorId: 'WoodBench' };
        }
        for (const g of gardens) g.tileObjects = T;
        for (const s of slots) {
          const pets = [];
          if (o.wolf) pets.push({ id: 'wolf', petSpecies: 'ThunderWolf', abilities: ['Thundercharger'], mutations: [], xp: 1 });
          if (o.ostrich) pets.push({ id: 'ost', petSpecies: 'Ostrich', abilities: ['DawnCapture'], mutations: [], xp: 1 });
          if (o.phoenix) pets.push({ id: 'phx', petSpecies: 'Phoenix', abilities: ['AmberCapture'], mutations: [], xp: 1 });
          s.data.petSlots = pets;
          s.riddenPetId = o.ride || null;
          s.data.inventory = s.data.inventory || {};
          s.data.inventory.items = [{ toolId: 'PlanterPot', itemType: 'Tool', quantity: 9 }];
          s.heldItem = { itemId: o.pot ? 'PlanterPot' : null, decorRotation: 0 };
        }
        obs.mapPick = null;
        obs.setBinderMap({ on: true, event: o.event ? { kind: o.event, endsAt: Date.now() + 600000 } : null });
        return true;
      })()`);
      const read = () => grun("(() => { const b = document.getElementById('mg-map'); if (!b || b.style.display === 'none') return null; return { ctx: b.dataset.ctx, title: b.querySelector('.mg-title').textContent, right: b.querySelector('.mg-map-head span:last-child') ? [...b.querySelectorAll('.mg-map-head > div:first-child > span')].pop().textContent : '', tabs: [...b.querySelectorAll('.mg-tab')].map((t) => t.textContent), line: b.children[1].textContent, key: [...b.lastChild.children].map((x) => x.textContent).join(' | ') }; })()");
      const cases = [
        ['pot', { pot: true }], ['phoenix', { phoenix: true }], ['phoenixEmpty', { phoenix: true, empty: true }], ['ostrich', { ostrich: true }], ['wolf', { wolf: true }],
        ['potPhoenix', { pot: true, phoenix: true }], ['potWolf', { pot: true, wolf: true }],
        ['amber', { event: 'amber' }], ['amberPot', { event: 'amber', pot: true }], ['amberPhoenix', { event: 'amber', phoenix: true }], ['amberRidePhoenix', { event: 'amber', phoenix: true, ride: 'phx' }],
        ['amberOstrich', { event: 'amber', ostrich: true }], ['amberWolf', { event: 'amber', wolf: true }],
        ['dawn', { event: 'dawn' }], ['dawnPot', { event: 'dawn', pot: true }], ['dawnOstrich', { event: 'dawn', ostrich: true }], ['dawnRideOstrich', { event: 'dawn', ostrich: true, ride: 'ost' }],
      ];
      const mm = {};
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const [name, o] of cases) {
        await setup(o);
        await wait(700);
        mm[name] = await read();
        const r = await grun("(() => { const b = document.getElementById('mg-map'); if (!b || b.style.display === 'none') return null; const q = b.getBoundingClientRect(); return [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)]; })()");
        if (r) {
          const img = await gw.capturePage();
          fs.writeFileSync(path.join(SHOTS, `mm-${name}.png`), img.crop({ x: Math.max(0, r[0] - 3), y: Math.max(0, r[1] - 3), width: r[2] + 6, height: r[3] + 6 }).toPNG());
        }
      }
      out.mapmatrix = mm;
    }
    if (MODE === 'luckaudit') {
      // The Luck tab's hatch check (v0.56.11), both ways.
      const la = {};
      for (const [name, audit] of [
        ['allOnEggs', { perEgg: { MythicalEgg: 412, LegendaryEgg: 655, RareEgg: 180, CommonEgg: 26 }, seen: 1273, all: 1273, allTime: true, unattributed: 0, since: { at: Date.now(), all: 0, seen: 0, unattributed: 0 } }],
        ['someMissed', { perEgg: { MythicalEgg: 410, LegendaryEgg: 650 }, seen: 1060, all: 1064, allTime: true, unattributed: 4, since: { at: Date.now(), all: 0, seen: 0, unattributed: 0 } }],
      ]) {
        la[name] = await run(`(() => { LUCK = Object.assign({}, LUCK || { groups: {}, notify: {}, hits: [] }, { audit: ${JSON.stringify(audit)} }); showTab('pity'); renderLuck(); const d = document.querySelector('#luckAudit details'); if (d) d.open = true; return document.getElementById('luckAudit').innerText.replace(/\\n+/g, ' | '); })()`);
      }
      out.luckaudit = la;
    }
    if (MODE === 'mutfix') {
      // The owner's numbers (v0.56.14 sample): 193 crops; Thunderstruck 81,
      // Thundercharged 70, Frozen 31; Dawnbound 47, Dawnlit 6, Amberbound 35,
      // Amberlit 25; Gold 59, Rainbow 53. Their rule asks for Thundercharged or
      // Frozen, so the old total (the rule's) was 101 = 52% against Thunder's
      // 78%. A reading saved that way, then the live one, both through the chart.
      const T = Date.now();
      const old = { t: T - 3600000, n: 193, h: 101, l: 82, c: 112, w: 0, ch: 0, f: 31, th: 151, d: 53, a: 60, g: 59, r: 53 };
      const cur = { name: 'garden', total: 193, mature: 183, gold: 59, rainbow: 53, special: 112, have: { ripe: 183, hydro: 101, lunar: 82, color: 112 }, any: { hydro: 182, lunar: 113, color: 112 }, mutations: { thundercharged: 70, thunderstruck: 81, frozen: 31, dawnbound: 47, dawnlit: 6, amberbound: 35, amberlit: 25, gold: 59, rainbow: 53 } };
      const mf = await run(`(() => {
        S.garden = Object.assign({}, S.garden, { mutHistory: [${JSON.stringify(old)}] });
        GARDEN_STATS = Object.assign({}, GARDEN_STATS, { mutHistory: [${JSON.stringify(old)}] });
        GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { at: Date.now(), crops: [${JSON.stringify(cur)}] });
        MUT_UI = Object.assign(mutUi(), { hydro: true, wet: true, frozen: true, thunder: true, lunar: true, color: true });
        showTab('garden');
        renderGarden();
        const chips = [...document.querySelectorAll('.mut-legend .mut-check')].map((x) => x.innerText.replace(/\\s+/g, ' ').trim());
        const notes = [...document.querySelectorAll('#mutChart ~ .note, .mut-next, .note')].map((x) => x.innerText).filter((t) => /without|Gold\\/Rainbow/.test(t)).slice(0, 3);
        return { chips, notes, caption: /Every crop in the garden at its base value/.test(document.body.innerText) };
      })()`);
      out.mutfix = mf;
    }
    if (MODE === 'quickplant') {
      // Quick plant (v0.56.15) with the real mouse, on the stand-in (Carrot
      // x3, Tomato x5 in the bag; the game plants with PlantSeed).
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const qp = {};
      const btn = () => grun("(() => { const b = document.getElementById('mg-plant-btn'); if (!b || b.style.display === 'none') return null; const q = b.getBoundingClientRect(); const m = b.firstChild.getBoundingClientRect(); const p = b.lastChild.getBoundingClientRect(); return { text: b.firstChild.textContent, x: Math.round(q.left), y: Math.round(q.top), main: [Math.round(m.left + 15), Math.round(m.top + m.height / 2)], pick: [Math.round(p.left + p.width / 2), Math.round(p.top + p.height / 2)] }; })()");
      const click = (xy) => {
        gw.sendInputEvent({ type: 'mouseDown', x: xy[0], y: xy[1], button: 'left', clickCount: 1 });
        gw.sendInputEvent({ type: 'mouseUp', x: xy[0], y: xy[1], button: 'left', clickCount: 1 });
      };
      const note = () => grun("(() => { const n = [...document.querySelectorAll('div')].find((d) => /^🌱 /.test(d.textContent || '') && d.style.opacity === '1' && d.id !== 'mg-plant-btn'); return n ? n.textContent : null; })()");
      const garden = () => grun("(() => { const s = window.__mgLoaderObserver.sample().mySlot; const t = s.data.garden.tileObjects || {}; const seeds = (s.data.inventory.items || []).filter((x) => x && x.itemType === 'Seed').map((x) => x.species + ' x' + x.quantity); return { tiles: Object.keys(t).length, tomatoes: Object.entries(t).filter(([, v]) => v && v.species === 'Tomato').map(([k]) => Number(k)), seeds }; })()");
      await run('window.app.plantBtnSet(true)'); // off by default since v0.57.0 (the action bar plants)
      await wait(5000);
      qp.start = Object.assign({ button: await btn() }, await garden());
      click(qp.start.button.main);
      await wait(300);
      qp.noPick = await note();
      click((await btn()).pick);
      await wait(400);
      qp.list = await grun("[...document.querySelectorAll('#mg-plant-list [data-sp]')].map((r) => r.innerText.replace(/\\s+/g, ' '))");
      fs.mkdirSync(SHOTS, { recursive: true });
      const b0 = await btn();
      fs.writeFileSync(path.join(SHOTS, 'quickplant.png'), (await gw.capturePage()).crop({ x: Math.max(0, b0.x - 6), y: Math.max(0, b0.y - 6), width: 240, height: 110 }).toPNG());
      const row = await grun("(() => { const r = [...document.querySelectorAll('#mg-plant-list [data-sp]')].find((x) => x.dataset.sp === 'Tomato').getBoundingClientRect(); return [Math.round(r.left + 20), Math.round(r.top + r.height / 2)]; })()");
      click(row);
      await wait(500);
      qp.picked = { button: (await btn()).text, saved: (await run('window.app.getSettings()')).ui.plantPick };
      // Spam four clicks.
      const main = (await btn()).main;
      for (let k = 0; k < 4; k += 1) {
        click(main);
        await wait(80);
      }
      await wait(2500);
      qp.afterSpam = Object.assign({ button: (await btn()).text }, await garden());
      qp.sent = await grun("(() => { const o = window.__mgLoaderObserver; return { plantSeeds: o.recentOutgoing.filter((e) => e.command === 'PlantSeed').length, results: (o.recentResults || []).filter((r) => /PlantSeed/.test(JSON.stringify(r))).map((r) => r.ok) }; })()");
      // The last one, then none left.
      click(main);
      await wait(2200);
      click(main);
      await wait(300);
      qp.runOut = { note: await note(), garden: await garden() };
      // Drag, double-click back, switch off.
      const p0 = await btn();
      gw.sendInputEvent({ type: 'mouseDown', x: p0.main[0], y: p0.main[1], button: 'left', clickCount: 1 });
      for (let k = 1; k <= 6; k += 1) gw.sendInputEvent({ type: 'mouseMove', x: p0.main[0] + k * 20, y: p0.main[1] + k * 12, modifiers: ['leftButtonDown'] });
      gw.sendInputEvent({ type: 'mouseUp', x: p0.main[0] + 120, y: p0.main[1] + 72, button: 'left', clickCount: 1 });
      await wait(600);
      const p1 = await btn();
      qp.dragged = { from: [p0.x, p0.y], to: [p1.x, p1.y], saved: Boolean(((await run('window.app.getSettings()')).ui.mapPos || {})['mg-plant-btn']), stillOne: (await garden()).tomatoes.length };
      await run('window.app.plantBtnPlace()');
      await wait(800);
      const p2 = await btn();
      qp.putBack = { at: [p2.x, p2.y], backWhereItWas: p2.x === p0.x && p2.y === p0.y, saved: Boolean(((await run('window.app.getSettings()')).ui.mapPos || {})['mg-plant-btn']) };
      await run('window.app.plantBtnSet(false)');
      await wait(600);
      qp.switchedOff = await btn();
      await run('window.app.plantBtnSet(true)');
      out.quickplant = qp;
    }
    if (MODE === 'actionbar') {
      // The action bar (v0.57.0) with real keys on the game: keys 1-9, the
      // game not seeing bound keys, typing not taken, learning the potted-plant
      // command from one hand-planted pot, planting until the pots run out,
      // rebinding from the panel (a real key press), app shortcuts.
      const { Menu } = require('electron');
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const ab = {};
      const key = (keyCode, mods) => {
        gw.focus();
        gw.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods || [] });
        gw.sendInputEvent({ type: 'char', keyCode, modifiers: mods || [] });
        gw.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods || [] });
      };
      const garden = () => grun("(() => { const s = window.__mgLoaderObserver.sample().mySlot; const t = s.data.garden.tileObjects || {}; return { pots: window.__mgLoaderObserver.bagSummary().potted, planted: Object.entries(t).filter(([, v]) => v && ['Tulip', 'Daffodil', 'Eggplant', 'Apple'].includes(v.species) && v.slots && v.slots[0] && v.slots[0].size === 60).map(([k, v]) => k + ':' + v.species) }; })()");
      const note = () => grun("(() => { const n = [...document.querySelectorAll('div')].find((d) => /^(🪴|🌱|🐾) /.test(d.textContent || '') && d.style.opacity === '1' && !d.id); return n ? n.textContent : null; })()");
      await wait(5000);
      // What reaches the game: a listener the way a game would add one.
      await grun("(() => { window.__gameKeys = []; document.addEventListener('keydown', (e) => window.__gameKeys.push(e.code + (e.shiftKey ? '+shift' : ''))); return true; })()");
      ab.bar = await grun("(() => { const b = document.getElementById('mg-action-bar'); if (!b) return null; return { slots: [...b.querySelectorAll('.mg-slot')].map((c) => c.querySelector('.k').textContent + ' ' + c.querySelector('.ic').textContent + (c.querySelector('.n').textContent ? '×' + c.querySelector('.n').textContent : '') + (c.style.opacity !== '1' ? ' (dim)' : '')) }; })()");
      // The game's own PlantGardenPlant is built in (v0.57.2): key 1 plants
      // from the first press, before any pot is planted by hand.
      key('1');
      await wait(1800);
      ab.firstPress = await garden();
      key('0'); // not bound: the game keeps it
      await wait(200);
      ab.gameSaw = await grun('window.__gameKeys.slice()');
      // Plant one potted Tulip by hand: the app learns the command.
      await grun("window.__gameSend({ type: 'PlantGardenPlant', itemId: 'pot-1', slot: 12, rotation: 0 })");
      await wait(1500);
      ab.learned = (await run('window.app.getSettings()')).ui.potCommand;
      ab.afterHand = await garden();
      // Now key 1 plants the rest, one per press, then says none are left.
      key('1');
      await wait(1800);
      key('1');
      await wait(1800);
      ab.afterKeys = await garden();
      key('1');
      await wait(1800);
      key('1');
      await wait(1800);
      ab.allPlanted = await garden();
      key('1');
      await wait(400);
      ab.runOut = await note();
      // The game's bag slots: Shift+3 reaches the game as a plain 3, and
      // the bar's slot 3 (harvest mode) doesn't fire.
      const modeBefore = Boolean(((await run('window.app.getSettings()')).harvestLock || {}).mode && (await run('window.app.getSettings()')).harvestLock.mode.on);
      await grun('window.__gameKeys = []');
      key('3', ['shift']);
      await wait(800);
      ab.bagKey = { gameSaw: await grun('window.__gameKeys.slice()'), modeUnchanged: Boolean(((await run('window.app.getSettings()')).harvestLock || {}).mode && (await run('window.app.getSettings()')).harvestLock.mode.on) === modeBefore };
      // Typing in a box: keys go to the box, not the bar.
      await grun("(() => { const i = document.createElement('input'); i.id = 'chatbox'; document.body.appendChild(i); i.focus(); return true; })()");
      key('3');
      await wait(300);
      ab.typing = await grun("document.getElementById('chatbox').value");
      await grun("document.getElementById('chatbox').blur()");
      // Rebind slot 2 from the panel with a real key press (Shift+Q).
      await run("(() => { showTab('scripts'); const b = document.querySelector('.kb-key[data-slot=\"1\"]'); b.click(); return true; })()");
      await wait(300);
      panel().focus();
      panel().sendInputEvent({ type: 'keyDown', keyCode: 'Q', modifiers: ['shift'] });
      panel().sendInputEvent({ type: 'keyUp', keyCode: 'Q', modifiers: ['shift'] });
      await wait(900);
      ab.rebound = await run("KEYS.bar.slots[1].key");
      // Rebind bag slot 1 from the panel (Alt+1).
      await run("(() => { const b = document.querySelector('.kb-key[data-bag=\"0\"]'); b.click(); return true; })()");
      await wait(300);
      panel().focus();
      panel().sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers: ['alt'] });
      panel().sendInputEvent({ type: 'keyUp', keyCode: '1', modifiers: ['alt'] });
      await wait(900);
      ab.bagRebound = await run('KEYS.bagKeys[0]');
      ab.menuRow = await run("[...document.querySelectorAll('#barSlots .kb-row')].slice(0, 3).map((r) => r.querySelector('.kb-key').textContent + ' | ' + r.querySelector('select').selectedOptions[0].textContent)");
      await run("(() => { document.getElementById('keysCard').scrollIntoView({ block: 'start' }); return true; })()");
      await wait(300);
      await shotOf('#keysCard', 'keys-card', 6);
      // App shortcut: rebind Swap to last pet team.
      await run("window.app.keysSetApp({ id: 'lastTeam', accel: 'CmdOrCtrl+Alt+Y' })");
      let item = null;
      const walk = (mm) => { for (const it of mm.items) { if (it.label === 'Swap to last pet team') item = it; if (it.submenu) walk(it.submenu); } };
      walk(Menu.getApplicationMenu());
      ab.menuAccel = item ? item.accelerator : null;
      const b = await grun("(() => { const q = document.getElementById('mg-action-bar').getBoundingClientRect(); return [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)]; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, 'action-bar.png'), (await gw.capturePage()).crop({ x: Math.max(0, b[0] - 6), y: Math.max(0, b[1] - 6), width: b[2] + 12, height: b[3] + 12 }).toPNG());
      out.actionbar = ab;
    }
    if (MODE === 'harvestfix') {
      // v0.57.3: (1) protecting Thunderpeel doesn't protect Stormcap; (2)
      // harvest mode takes over from the lock and protections, which are back
      // when it's off; (3) the engaged look; no 🔁 up top.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const hf = {};
      await wait(4000);
      await grun(`(() => {
        const obs = window.__mgLoaderObserver; const gardens = []; const seen = new Set();
        const walk = (x, d) => { if (!x || typeof x !== 'object' || seen.has(x) || d > 9) return; seen.add(x); if (x.tileObjects && typeof x.tileObjects === 'object' && !Array.isArray(x.tileObjects)) gardens.push(x); for (const k of Object.keys(x)) walk(x[k], d + 1); };
        walk(obs.state, 0);
        const ripe = (sp) => ({ species: sp, mutations: ['Gold'], size: 100, endTime: Date.now() - 1000 });
        const T = { 10: { objectType: 'plant', species: 'ThunderCelestial', slots: [ripe('ThunderCelestial'), ripe('ThunderCelestialShroomPlant')] }, 20: { objectType: 'plant', species: 'Sunflower', slots: [ripe('Sunflower')] } };
        for (const g of gardens) g.tileObjects = T;
        return true;
      })()`);
      const tryHarvest = async (slot, idx) => {
        const before = await grun('window.__mgLoaderObserver.recentOutgoing.filter((e) => e.blocked).length');
        await grun(`window.__gameSend({ type: 'HarvestCrop', slot: ${slot}, slotsIndex: ${idx} })`);
        await wait(300);
        return (await grun('window.__mgLoaderObserver.recentOutgoing.filter((e) => e.blocked).length')) > before ? 'blocked' : 'harvested';
      };
      const set = async (change) => { await run(`window.app.harvestSet(${JSON.stringify(change)})`); await wait(700); };
      // (v0.57.5) The tag is really hidden when off; the 🧺 up top toggles it.
      const look = () => run(`(() => { const t = document.getElementById('hvEngaged'); const b = document.getElementById('modeBtn'); return { tagShown: getComputedStyle(t).display !== 'none', button: b.classList.contains('engaged'), buttonColour: getComputedStyle(b).backgroundColor, on: (LOCK.mode || {}).on === true }; })()`);
      await set({ mode: { on: false } });
      hf.offLook = await look();
      const mb = await run("(() => { const q = document.getElementById('modeBtn').getBoundingClientRect(); const z = window.devicePixelRatio || 1; return [Math.round((q.left + q.width / 2) * z), Math.round((q.top + q.height / 2) * z)]; })()");
      panel().sendInputEvent({ type: 'mouseDown', x: mb[0], y: mb[1], button: 'left', clickCount: 1 });
      panel().sendInputEvent({ type: 'mouseUp', x: mb[0], y: mb[1], button: 'left', clickCount: 1 });
      await wait(900);
      hf.buttonOn = await look();
      await shotOf('.head-btns', 'mode-button-on', 4);
      panel().sendInputEvent({ type: 'mouseDown', x: mb[0], y: mb[1], button: 'left', clickCount: 1 });
      panel().sendInputEvent({ type: 'mouseUp', x: mb[0], y: mb[1], button: 'left', clickCount: 1 });
      await wait(900);
      hf.buttonOff = await look();
      // (1) Thunderpeel protected, lock and mode off.
      await set({ on: false, species: ['ThunderCelestial'], mode: { on: false } });
      hf.protectThunderpeel = { thunderpeel: await tryHarvest(10, 0), stormcap: await tryHarvest(10, 1) };
      await set({ species: ['ThunderCelestialShroomPlant'] });
      hf.protectStormcap = { thunderpeel: await tryHarvest(10, 0), stormcap: await tryHarvest(10, 1) };
      // (2) Lock on and Sunflower protected; then harvest mode (any ripe crop).
      await set({ on: true, species: ['Sunflower'], mode: { on: false } });
      hf.lockOn = await tryHarvest(20, 0);
      await set({ mode: { on: true, color: 'any', hydro: [], lunar: [], size: false } });
      hf.modeOn = { sunflower: await tryHarvest(20, 0), saved: await run('(async () => { const l = await window.app.harvestGet(); return { lockOn: l.on, species: l.species }; })()') };
      hf.badge = await grun("(() => { const el = document.getElementById('__mgHarvestLock'); return el ? { text: el.textContent, bg: el.style.background } : null; })()");
      // The panel while engaged.
      hf.panel = await run(`(() => { showTab('garden'); const h = document.querySelector('h2[data-fold="garden/harvest-lock"]'); if (h && h.classList.contains('folded')) h.click(); const sw = document.getElementById('harvestModeOn'); return { switchOn: sw.getAttribute('aria-checked'), switchColour: getComputedStyle(sw).backgroundColor, engaged: !document.getElementById('hvEngaged').hidden, paused: !document.getElementById('hvPaused').hidden, dimmed: [...document.querySelectorAll('.hv-pausable')].every((e) => e.classList.contains('paused')), topButtons: [...document.querySelectorAll('.head-btns button')].map((b) => b.textContent.trim()) }; })()`);
      await run("(() => { document.getElementById('harvestModeOn').scrollIntoView({ block: 'center' }); return true; })()");
      await wait(300);
      await shotOf('.card:has(#harvestModeOn)', 'harvest-engaged', 6);
      // Harvest mode off: the lock and protection are back.
      await set({ mode: { on: false } });
      hf.modeOff = await tryHarvest(20, 0);
      await set({ on: false });
      hf.lockOffProtected = await tryHarvest(20, 0);
      out.harvestfix = hf;
    }
    if (MODE === 'gmcard') {
      // The Garden map card (v0.57.4): the four game maps and Value, on the
      // owner's layout, with nothing popping up over the game (no pot in
      // hand, no Wolf, no event): the card builds them anyway.
      const fx = require('./fixtures/garden-layout.json');
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      await grun("(() => { const s = document.createElement('style'); s.textContent = '*, *::before, *::after { box-sizing: border-box; }'; document.head.appendChild(s); return true; })()");
      await wait(4000);
      await grun(`(() => {
        const obs = window.__mgLoaderObserver; const gardens = []; const slots = []; const seen = new Set();
        const walk = (x, d) => { if (!x || typeof x !== 'object' || seen.has(x) || d > 9) return; seen.add(x); if (x.tileObjects && typeof x.tileObjects === 'object' && !Array.isArray(x.tileObjects)) gardens.push(x); if (x.data && typeof x.data === 'object' && x.data.garden && Array.isArray(x.data.petSlots)) slots.push(x); for (const k of Object.keys(x)) walk(x[k], d + 1); };
        walk(obs.state, 0);
        const fx = ${JSON.stringify(fx)};
        const at = new Map(fx.plants.map((p) => [p.i, p]));
        const T = {};
        for (const i of fx.occupied) {
          if ([86, 10, 0, 2].includes(i)) continue;
          const p = at.get(i);
          T[i] = p ? { objectType: 'plant', species: p.sp, slots: p.s.map(([m, size, ripe]) => ({ species: p.sp, mutations: m ? m.split(',') : [], size, endTime: ripe ? Date.now() - 1000 : Date.now() + 1e7 })) } : { objectType: 'decor', decorId: 'WoodBench' };
        }
        for (const g of gardens) g.tileObjects = T;
        for (const s of slots) { s.data.petSlots = []; s.heldItem = { itemId: null }; }
        obs.setBinderMap({ on: true, event: null });
        return true;
      })()`);
      await wait(800);
      const gc = {};
      fs.mkdirSync(SHOTS, { recursive: true });
      await run("(() => { showTab('garden'); const h = document.querySelector('h2[data-fold=\"garden/garden-map\"]'); if (h && h.classList.contains('folded')) h.click(); document.getElementById('spotMap').scrollIntoView({ block: 'center' }); return true; })()");
      gc.overGame = await grun("(() => { const b = document.getElementById('mg-map'); return b && b.style.display !== 'none' ? b.dataset.ctx : 'nothing showing'; })()");
      for (const view of ['spots', 'thunder', 'dawn', 'amber', 'value']) {
        const r = await run(`(() => { const b = document.querySelector('#gmView [data-val="${view}"]').getBoundingClientRect(); const z = window.devicePixelRatio || 1; return [Math.round((b.left + b.width / 2) * z), Math.round((b.top + b.height / 2) * z)]; })()`);
        panel().sendInputEvent({ type: 'mouseDown', x: r[0], y: r[1], button: 'left', clickCount: 1 });
        panel().sendInputEvent({ type: 'mouseUp', x: r[0], y: r[1], button: 'left', clickCount: 1 });
        await wait(1500);
        gc[view] = await run(`(() => ({ on: document.querySelector('#gmView [aria-checked="true"]') ? document.querySelector('#gmView [aria-checked="true"]').dataset.val : null, title: document.getElementById('spotCount').innerText, line: document.getElementById('gmSummary').innerText.slice(0, 120), key: [...document.querySelectorAll('#gmKey span')].map((s) => s.innerText).join(' | ').slice(0, 160), cells: document.querySelectorAll('#spotMap i').length, glowing: [...document.querySelectorAll('#spotMap i')].filter((i) => /rgba|#/.test(i.style.boxShadow || '') && !/inset 0px 0px 3px/.test(i.style.boxShadow)).length }))()`);
        await shotOf('.card:has(#spotMap)', `gmcard-${view}`, 6);
      }
      out.gmcard = gc;
    }
    if (MODE === 'whereami') {
      // Where you are (v0.57.6): movement read for your own id; the garden
      // learned from harvests you make standing next to tiles; the ring on
      // the maps. The stand-in's garden sits at world x 8 (left bed) and 9 +
      // col (right bed, one tile of path between), y 5 + row.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const send = (cmd) => grun(`window.__gameSend(${JSON.stringify(cmd)})`);
      const world = (i) => { const col = i % 20; const row = Math.floor(i / 20); return { x: 8 + col + (col >= 10 ? 1 : 0), y: 5 + row }; };
      // As the real game does it (v0.57.7): your own movement goes OUT from
      // the game (the server doesn't echo it back). The message layout is a
      // guess; the reader is generic. moveIn uses the incoming path instead.
      const moveTo = async (x, y) => { await grun(`window.__mgLoaderObserver.gameSocket.send(JSON.stringify({ type: 'PlayerMove', seq: Date.now(), tile: { x: ${x}, y: ${y} } }))`); await wait(300); };
      const moveIn = async (x, y) => { await send({ type: '__movePlayer', x, y }); await wait(300); };
      const wa = {};
      await wait(4500);
      wa.before = await grun('({ me: window.__mgLoaderObserver.meTile, calib: window.__mgLoaderObserver.calibInfo() })');
      // Harvest by hand next to tiles: standing one to the side, or on it.
      const pairs = [[23, 1, 0], [45, 0, 1], [67, -1, 0], [131, 1, 0], [152, 0, -1], [118, 0, 0]];
      for (const [i, ox, oy] of pairs) {
        const w = world(i);
        await moveTo(w.x + ox, w.y + oy);
        await send({ type: 'HarvestCrop', slot: i, slotsIndex: 0 });
        await wait(250);
      }
      wa.learned = await grun('({ pairs: window.__mgLoaderObserver.mapCalib.length, info: window.__mgLoaderObserver.calibInfo(), saved: null })');
      wa.saved = ((await run('window.app.getSettings()')).ui.mapCalib || []).length;
      const at = async (i) => { const w = world(i); await moveTo(w.x, w.y); return grun('window.__mgLoaderObserver.meTile'); };
      wa.onTiles = { 47: await at(47), 115: await at(115), 0: await at(0), 199: await at(199) };
      await moveTo(2, 2);
      wa.offGarden = await grun('window.__mgLoaderObserver.meTile');
      // The panel card shows the ring.
      await moveTo(world(47).x, world(47).y);
      await wait(4000);
      wa.card = await run(`(async () => { showTab('garden'); S.ui = Object.assign({}, S.ui, { gardenMap: 'spots' }); GM_CARD.view = null; renderSpots(GARDEN_STATUS); await new Promise((r) => setTimeout(r, 900)); const me = document.querySelector('#spotMap i.me'); return { me: me ? Number(me.dataset.i) : null, hint: !document.getElementById('gmMe').hidden }; })()`);
      // The map over the game: with a pot in hand the spots map shows; the ring is on your tile.
      await grun(`(() => {
        const obs = window.__mgLoaderObserver; const slots = []; const seen = new Set();
        const walk = (x, d) => { if (!x || typeof x !== 'object' || seen.has(x) || d > 9) return; seen.add(x); if (x.data && typeof x.data === 'object' && x.data.garden && Array.isArray(x.data.petSlots)) slots.push(x); for (const k of Object.keys(x)) walk(x[k], d + 1); };
        walk(obs.state, 0);
        // Hold a potted plant the stand-in really has (its own bag updates
        // keep it), so the spots map shows however long the test runs.
        for (const s of slots) { const pot = (s.data.inventory.items || []).find((it) => it && it.itemType === 'Plant' && it.id); s.heldItem = { itemId: pot ? pot.id : null }; }
        obs.setBinderMap({ on: true, event: null });
        return true;
      })()`);
      await wait(1800); // the map takes a moment to appear
      // Each check makes sure a pot is in hand and the map is refreshed first,
      // so it tests where the ring is, not when the map gets round to showing.
      const ring = async () => {
        await grun(`(() => {
          const obs = window.__mgLoaderObserver; const slots = []; const seen = new Set();
          const walk = (x, d) => { if (!x || typeof x !== 'object' || seen.has(x) || d > 9) return; seen.add(x); if (x.data && typeof x.data === 'object' && x.data.garden && Array.isArray(x.data.petSlots)) slots.push(x); for (const k of Object.keys(x)) walk(x[k], d + 1); };
          walk(obs.state, 0);
          for (const s of slots) { const pot = (s.data.inventory.items || []).find((it) => it && it.itemType === 'Plant' && it.id); s.heldItem = { itemId: pot ? pot.id : null }; }
          obs.setBinderMap({ on: true, event: null });
          return true;
        })()`);
        await wait(500);
        return grun("(() => { const b = document.getElementById('mg-map'); if (!b || b.style.display === 'none') return { map: null }; const cells = [...b.children[2].children]; const k = cells.findIndex((c) => c.classList.contains('mg-me')); return { map: b.dataset.ctx, ring: k }; })()");
      };
      wa.overGame = await ring();
      wa.debug = await grun('(() => { const o = window.__mgLoaderObserver; return { meTile: o.meTile, selfPos: o.selfPos, refresh: o.refreshMe() }; })()');
      wa.afterRefresh = await ring();
      await moveIn(world(115).x, world(115).y);
      await wait(300);
      wa.overGameMoved = await ring();
      wa.outgoing = await grun('Object.keys(window.__mgLoaderObserver.outgoingShape || {})');
      // (v0.57.8) A quick walk, then stop: the ring is on the last tile at
      // once, over the game and (moments later) on the panel's card.
      await run("(() => { showTab('garden'); S.ui = Object.assign({}, S.ui, { gardenMap: 'spots' }); GM_CARD.view = null; renderSpots(GARDEN_STATUS); return true; })()");
      await wait(1500);
      const walkTo = [60, 61, 62, 63, 64];
      for (const i of walkTo) {
        const w = world(i);
        await grun(`window.__mgLoaderObserver.gameSocket.send(JSON.stringify({ type: 'PlayerMove', tile: { x: ${w.x}, y: ${w.y} } }))`);
        await wait(40);
      }
      await wait(60);
      wa.quickWalk = { overGame: await ring(), meTile: await grun('window.__mgLoaderObserver.meTile') };
      await wait(400);
      wa.quickWalk.card = await run("(() => { const me = document.querySelector('#spotMap i.me'); return me ? Number(me.dataset.i) : null; })()");
      // (v0.57.9) Between the beds: world x 18 is the walkway (left bed ends
      // at 17, right starts at 19); row 3 is y 8.
      await grun("window.__mgLoaderObserver.gameSocket.send(JSON.stringify({ type: 'PlayerMove', tile: { x: 18, y: 8 } }))");
      await wait(500);
      wa.walkway = { meTile: await grun('window.__mgLoaderObserver.meTile'), meGap: await grun('window.__mgLoaderObserver.meGap'), overGame: await ring(), card: await run("(() => { const me = document.querySelector('#spotMap .me'); return me ? (me.dataset.gap != null ? 'gap row ' + me.dataset.gap : 'tile ' + me.dataset.i) : null; })()") };
      const w9 = world(69);
      await grun(`window.__mgLoaderObserver.gameSocket.send(JSON.stringify({ type: 'PlayerMove', tile: { x: ${w9.x}, y: ${w9.y} } }))`);
      await wait(500);
      // (v0.57.10) Harvest mode on: the map over the game switches to its
      // harvest view; the ring must stay.
      await grun(`(() => {
        const obs = window.__mgLoaderObserver; const slots = []; const seen = new Set();
        const walk = (x, d) => { if (!x || typeof x !== 'object' || seen.has(x) || d > 9) return; seen.add(x); if (x.data && typeof x.data === 'object' && x.data.garden && Array.isArray(x.data.petSlots)) slots.push(x); for (const k of Object.keys(x)) walk(x[k], d + 1); };
        walk(obs.state, 0);
        for (const s of slots) s.heldItem = { itemId: null };
        return true;
      })()`);
      await run("window.app.harvestSet({ mode: { on: true, color: 'any', hydro: [], lunar: [], size: false } })");
      await wait(1500);
      wa.harvestMode = {
        meTile: await grun('window.__mgLoaderObserver.meTile'),
        view: await grun("(() => { const b = document.getElementById('mg-map'); if (!b || b.style.display === 'none') return null; const cells = [...b.children[2].children]; return { ctx: b.dataset.ctx, ring: cells.findIndex((c) => c.classList.contains('mg-me')), classes: cells.slice(60, 75).map((c) => c.className).filter(Boolean).slice(0, 4) }; })()"),
        refresh: await grun('window.__mgLoaderObserver.refreshMe()'),
      };
      // (v0.57.10) A harvest-mode sweep: crops clicked while walking, the
      // position you last reported lagging four tiles behind. The learned
      // garden must not slide (that made the marker vanish).
      const fitOf = () => grun('(() => { const s = window.__mgLoaderObserver.sample().movement; return JSON.stringify(s.fit); })()');
      wa.sweep = { fitBefore: await fitOf() };
      for (let k = 0; k < 15; k += 1) {
        const i = 20 * (2 + (k % 6)) + 2 + (k % 7);
        const w = world(i);
        await grun(`window.__mgLoaderObserver.gameSocket.send(JSON.stringify({ type: 'PlayerMove', tile: { x: ${w.x - 4}, y: ${w.y} } }))`);
        await send({ type: 'HarvestCrop', slot: i, slotsIndex: 0 });
        await wait(60);
      }
      await wait(400);
      wa.sweep.fitAfter = await fitOf();
      const w69 = world(69);
      await grun(`window.__mgLoaderObserver.gameSocket.send(JSON.stringify({ type: 'PlayerMove', tile: { x: ${w69.x}, y: ${w69.y} } }))`);
      await wait(400);
      wa.sweep.markerOn69 = await grun('window.__mgLoaderObserver.meTile');
      // And if the left bed really were somewhere else (consistent pairs, all
      // three tiles further right), it re-learns rather than holding on.
      // Standing still for each (1.6 s): accurate positions that disagree.
      for (let k = 0; k < 7; k += 1) {
        const i = 20 * (1 + k) + 3;
        const w = world(i);
        await grun(`window.__mgLoaderObserver.gameSocket.send(JSON.stringify({ type: 'PlayerMove', tile: { x: ${w.x + 3}, y: ${w.y} } }))`);
        await wait(1600);
        await send({ type: 'HarvestCrop', slot: i, slotsIndex: 0 });
        await wait(60);
      }
      await wait(300);
      wa.sweep.relearned = await fitOf();
      await run("window.app.harvestSet({ mode: { on: false } })");
      await wait(600);
      wa.backOnBed = { meTile: await grun('window.__mgLoaderObserver.meTile'), meGap: await grun('window.__mgLoaderObserver.meGap'), overGame: await ring(), card: await run("(() => { const me = [...document.querySelectorAll('#spotMap .me')]; return me.map((x) => (x.dataset.gap != null ? 'gap ' + x.dataset.gap : 'tile ' + x.dataset.i)); })()") };
      const b = await grun("(() => { const q = document.getElementById('mg-map').getBoundingClientRect(); return [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)]; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, 'whereami.png'), (await gw.capturePage()).crop({ x: Math.max(0, b[0] - 4), y: Math.max(0, b[1] - 4), width: b[2] + 8, height: b[3] + 8 }).toPNG());
      out.whereami = wa;
    }
    if (MODE === 'pets58') {
      // v0.58.0: the rankings card on the owner's 49 pets, the trough card and
      // its chip on the game, the action bar as a 3x3 square.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const petRank = require('../pet-rank');
      const owner = require('./fixtures/pets.json');
      const R = petRank.rank(owner, {});
      const p58 = {};
      await wait(4500);
      await run(`(() => { showTab('pets'); for (const k of ['pets/pet-rankings', 'pets/food']) { const h = document.querySelector('h2[data-fold="' + k + '"]'); if (h && h.classList.contains('folded')) h.click(); } GARDEN_STATUS = Object.assign({}, GARDEN_STATUS, { petRank: ${JSON.stringify(R)}, troughTimer: { items: 9, edible: 9, perHour: 1.5, emptyIn: 21600, learning: false, starving: [{ name: 'Hot Rod', species: 'Ostrich', secondsLeft: 2280 }], pets: 3 } }); renderPetRank(); renderTrough(GARDEN_STATUS); return true; })()`);
      await wait(300);
      await run("(() => { const d = document.getElementById('prNext'); if (d) d.open = true; return true; })()");
      p58.card = await run("(() => ({ labels: [...document.querySelectorAll('#petRank .pr-label, #petRank details > summary')].map((x) => x.textContent), picks: [...document.querySelectorAll('#petRank .pr-pick')].map((x) => x.innerText.replace(/\\n/g, ' ')).slice(0, 6), rows: [...document.querySelectorAll('#petRank .pr-row')].slice(0, 5).map((x) => x.innerText.replace(/\\n/g, ' ')) }))()");
      p58.trough = await run("document.getElementById('troughTimer').innerText.replace(/\\n+/g, ' | ')");
      // (v0.59.0) The countdown moves, a second at a time.
      await run("(() => { GARDEN_STATUS.troughTimer = Object.assign({}, GARDEN_STATUS.troughTimer, { emptyAt: Date.now() + 6 * 3600000, learning: false }); renderTrough(GARDEN_STATUS); return true; })()");
      const t1 = await run("document.getElementById('ttLeft').textContent");
      await wait(2200);
      const t2 = await run("document.getElementById('ttLeft').textContent");
      p58.countdown = [t1, t2];
      // The cards that are out and Best pets for (stand-in pets), and the instant tip.
      p58.petsOut = await run("[...document.querySelectorAll('#petCards details.po summary')].map((s) => s.innerText.replace(/\\n+/g, ' | ')).slice(0, 3)");
      p58.bestFor = await run("[...document.querySelectorAll('#goalRank .bp-row')].map((s) => s.innerText.replace(/\\n+/g, ' | ')).slice(0, 3)");
      p58.tip = await run("(() => { const s = document.querySelector('#petRank .pr-ab .tip'); return s ? s.dataset.tip : null; })()");
      p58.pictures = await run("(() => { const imgs = [...document.querySelectorAll('#petRank img.pet-img')]; return { count: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, src: imgs[0] ? imgs[0].getAttribute('src') : null }; })()");
      p58.ages = await run("[...document.querySelectorAll('#petRank .pr-row small')].map((x) => x.textContent).slice(0, 3)");
      await run("(() => { document.getElementById('petRank').scrollIntoView({ block: 'start' }); return true; })()");
      await wait(300);
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('#petRank', 'pet-rank', 6);
      await shotOf('#troughTimer', 'trough', 6);
      await run("(() => { const h = document.querySelector('h2[data-fold=\"pets/pets-that-are-out\"]'); if (h && h.classList.contains('folded')) h.click(); const d = document.querySelector('#petCards details.po'); if (d) d.open = true; document.getElementById('petCards').scrollIntoView({ block: 'start' }); return true; })()");
      await wait(300);
      await shotOf('#petCards', 'pets-out', 6);
      // Unticking an ability goes through main.js and changes the ranking.
      const fam = await run("(GARDEN_STATUS.petRank.families.find((f) => f.on) || {}).key");
      const r2 = await run(`window.app.petPrefs({ key: ${JSON.stringify(fam)}, on: false, w: 0.5 })`);
      p58.untick = { family: fam, savedOff: ((await run('window.app.getSettings()')).ui.petPrefs || {})[fam], answer: r2 ? (r2.families.find((f) => f.key === fam) || {}).on : 'no answer (stand-in has no such pet)' };
      await run("window.app.petPrefs({ reset: true })");
      // The trough chip on the game.
      await run('window.app.troughHudSet(true)');
      await wait(5000);
      p58.chip = await grun("(() => { const c = document.getElementById('mg-trough-chip'); return c && c.style.display !== 'none' ? c.textContent : null; })()");
      await run('window.app.troughHudSet(false)');
      await wait(800);
      p58.chipOff = await grun("(() => { const c = document.getElementById('mg-trough-chip'); return c && c.style.display !== 'none' ? c.textContent : null; })()");
      // The action bar: a 3x3 square by default, a line when chosen.
      const shape = () => grun("(() => { const b = document.getElementById('mg-action-bar'); if (!b) return null; const q = b.getBoundingClientRect(); return { display: b.style.display, cols: b.style.gridTemplateColumns, w: Math.round(q.width), h: Math.round(q.height) }; })()");
      p58.barSquare = await shape();
      const bq = await grun("(() => { const q = document.getElementById('mg-action-bar').getBoundingClientRect(); return [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)]; })()");
      fs.writeFileSync(path.join(SHOTS, 'bar-square.png'), (await gw.capturePage()).crop({ x: Math.max(0, bq[0] - 4), y: Math.max(0, bq[1] - 4), width: bq[2] + 8, height: bq[3] + 8 }).toPNG());
      await run("window.app.keysSetBar({ shape: 'line' })");
      await wait(600);
      p58.barLine = await shape();
      await run("window.app.keysSetBar({ shape: 'square' })");
      out.pets58 = p58;
    }
    if (MODE === 'steady') {
      // v0.59.6: What counts doesn't bounce. The card isn't rebuilt by
      // statuses with the same data, the note isn't clamped, and while a
      // slider is held a rebuild waits for the release. The mutations chart
      // isn't rebuilt on every status either.
      const petRank = require('../pet-rank');
      const R = petRank.rank(require('./fixtures/pets.json'), {});
      const st = {};
      await wait(4500);
      await run(`(() => { showTab('pets'); const h = document.querySelector('h2[data-fold="pets/pet-rankings"]'); if (h && h.classList.contains('folded')) h.click(); window.__petRankOverride = ${JSON.stringify(R)}; PR_SIG = ''; renderPetRank(); document.getElementById('prWhat').open = true; const note = document.querySelector('#prWhat .note'); const slider = document.querySelector('#prWhat input[type=range]'); note.__mark = 1; slider.__mark = 1; return true; })()`);
      // Real statuses keep arriving (each re-runs renderPetRank): ~8 s of them.
      await wait(8000);
      st.sameData = await run("(() => { const note = document.querySelector('#prWhat .note'); const slider = document.querySelector('#prWhat input[type=range]'); return { noteKept: note && note.__mark === 1, sliderKept: slider && slider.__mark === 1, clamped: note ? note.classList.contains('clamp') : null, open: document.getElementById('prWhat').open }; })()");
      // Hold a slider while the data changes: no rebuild until it's let go.
      await run("(() => { const s = document.querySelector('#prWhat input[type=range]'); s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); const r = JSON.parse(JSON.stringify(window.__petRankOverride)); r.ranking[0].value += 0.25; window.__petRankOverride = r; renderPetRank(); return true; })()");
      st.whileHeld = await run("(() => { const s = document.querySelector('#prWhat input[type=range]'); return { sliderKept: s && s.__mark === 1, pending: PR_PENDING }; })()");
      await run("(() => { window.dispatchEvent(new PointerEvent('pointerup')); return true; })()");
      await wait(300);
      st.afterRelease = await run("(() => { const s = document.querySelector('#prWhat input[type=range]'); const top = document.querySelector('#petRank .pr-pod.first .cu'); return { rebuilt: !(s && s.__mark === 1), stillOpen: document.getElementById('prWhat').open, topNow: top ? Number(top.dataset.to) : null, pending: PR_PENDING }; })()");
      // The mutations chart over a few statuses.
      await run("(() => { showTab('garden'); return true; })()");
      await wait(2000); // let it draw at its real width first
      const mh = () => run("(() => { const h = (GARDEN_STATS && GARDEN_STATS.mutHistory) || []; return JSON.stringify([h.length, h[h.length - 1]]); })()");
      const before = await mh();
      await run("(() => { const b = document.getElementById('mutChart'); if (b && b.firstElementChild) b.firstElementChild.__mark = 1; return true; })()");
      await wait(7000);
      st.mutChart = await run("(() => { const b = document.getElementById('mutChart'); return b && b.firstElementChild ? { kept: b.firstElementChild.__mark === 1 } : { kept: 'no chart' }; })()");
      st.mutChart.historyChanged = (await mh()) !== before;
      st.mutChart.history = [before, await mh()];
      out.steady = st;
    }
    if (MODE === 'racelock') {
      // v0.59.7: plant a potted plant and harvest it in the same instant
      // (before the server's confirmation reaches the app), as the girlfriend
      // did with a protected Ube. Commands use the game's new HarvestCrop
      // shape (with cropItemId).
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const rl = {};
      await wait(4500);
      const bag = await grun("(() => { const s = window.__mgLoaderObserver.sample(); const items = (window.__mgLoaderObserver.state.child.data.userSlots[0].data.inventory.items || []); return items.filter((it) => it && it.itemType === 'Plant').map((it) => ({ id: it.id, species: it.species })); })()");
      const tiles = await grun("Object.keys(window.__mgLoaderObserver.state.child.data.userSlots[0].data.garden.tileObjects)");
      const empty = [];
      for (let i = 150; i < 200 && empty.length < 3; i += 1) if (!tiles.includes(String(i))) empty.push(i);
      rl.pot = bag[0];
      rl.emptyTiles = empty;
      const set = async (change) => { await run(`window.app.harvestSet(${JSON.stringify(change)})`); await wait(700); };
      const lastHarvest = () => grun("(() => { const r = window.__mgLoaderObserver.recentOutgoing.filter((e) => /Harvest/.test(JSON.stringify(e))); const e = r[r.length - 1]; return e ? { blocked: Boolean(e.blocked), neutered: Boolean(e.neutered) } : null; })()");
      // 1. The race: protect the pot's species; plant and harvest in one go.
      await set({ on: false, species: [rl.pot.species], mode: { on: false } });
      await grun(`(() => { window.__gameSend({ type: 'PlantGardenPlant', slot: ${empty[0]}, itemId: ${JSON.stringify(rl.pot.id)} }); window.__gameSend({ type: 'HarvestCrop', slot: ${empty[0]}, slotsIndex: 0, cropItemId: 'new-item-1' }); return true; })()`);
      await wait(1500);
      rl.race = Object.assign(await lastHarvest(), { plantStillThere: await grun(`Boolean(window.__mgLoaderObserver.state.child.data.userSlots[0].data.garden.tileObjects['${empty[0]}'])`) });
      // 2. Lock on, a harvest it can't identify: stopped.
      await set({ on: true, species: [], mode: { on: false } });
      await grun(`window.__gameSend({ type: 'HarvestCrop', slot: ${empty[1]}, slotsIndex: 0, cropItemId: 'new-item-2' })`);
      await wait(800);
      rl.lockUnknown = await lastHarvest();
      // 3. Nothing guarding: an unidentified harvest goes through as before.
      await set({ on: false, species: [], mode: { on: false } });
      await grun(`window.__gameSend({ type: 'HarvestCrop', slot: ${empty[2]}, slotsIndex: 0, cropItemId: 'new-item-3' })`);
      await wait(800);
      rl.unguarded = await lastHarvest();
      // 4. The ordinary case: the planted (now confirmed) pot, protected.
      await set({ on: false, species: [rl.pot.species], mode: { on: false } });
      await grun(`window.__gameSend({ type: 'HarvestCrop', slot: ${empty[0]}, slotsIndex: 0, cropItemId: 'new-item-4' })`);
      await wait(800);
      rl.knownProtected = await lastHarvest();
      await set({ on: false, species: [], mode: { on: false } });
      out.racelock = rl;
    }
    if (MODE === 'teams59') {
      // v0.59.8: saved teams as cards and the team builder.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const petRank = require('../pet-rank');
      const owner = require('./fixtures/pets.json');
      const R = petRank.rank(owner, {});
      const ids = R.ranking.map((x) => String(x.id));
      const tm = {};
      await wait(4500);
      // A. The look, with the owner's pets and three teams made of them.
      const fakeTeams = [{ id: 't1', name: 'Money team', members: [ids[0], ids[1], ids[2]].map((petId) => ({ petId })) }, { id: 't2', name: 'Growing', members: [ids[3], ids[4], ids[5]].map((petId) => ({ petId })) }, { id: 't3', name: 'Weather', members: [ids[6], ids[7], ids[8]].map((petId) => ({ petId })) }];
      await run(`(() => { showTab('pets'); const h = document.querySelector('h2[data-fold="pets/your-saved-teams"]'); if (h && h.classList.contains('folded')) h.click(); const st = Object.assign({}, GARDEN_STATUS, { petRank: ${JSON.stringify(R)}, allPets: ${JSON.stringify(owner)}, teams: ${JSON.stringify(fakeTeams)}, teamSummaries: ${JSON.stringify(fakeTeams.map((t) => ({ id: t.id, name: t.name })))}, pets: ${JSON.stringify([ids[0], ids[1], ids[2]].map((id) => ({ id })))} }); GARDEN_STATUS = st; BUILD = null; TEAMS_SIG = ''; renderSavedTeams(st); document.getElementById('teamCompare').scrollIntoView({ block: 'start' }); return true; })()`);
      await wait(250);
      tm.look = await run("(() => ({ cards: [...document.querySelectorAll('#teamCompare .tm-card')].map((c) => c.querySelector('.tm-name').innerText.replace(/\\n/g, ' ') + ' = ' + c.querySelector('.tm-pp').innerText.replace(/\\n/g, '')), chips: [...document.querySelectorAll('#teamCompare .tm-card')][0].querySelectorAll('.tm-chip').length, builder: document.querySelectorAll('#teamCompare [data-build-slot]').length }))()");
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('#teamCompare', 'teams', 6);
      // The order of the Pets tab.
      tm.order = await run("[...document.querySelectorAll('#tab-pets > h2')].map((h) => h.textContent.trim())");
      // B. The builder with the stand-in's own pets: two out, one from the hutch.
      await wait(5000);
      const sp = await grun("(() => { const d = window.__mgLoaderObserver.state.child.data.userSlots[0].data; const out = (d.petSlots || []).map((p) => String(p.id)); const hutch = []; for (const s of (d.inventory.storages || [])) for (const it of (s.items || [])) if (it && it.id) hutch.push(String(it.id)); return { out, hutch }; })()");
      tm.standIn = sp;
      // The stand-in has one pet out: swap it for one from the hutch.
      await run(`(() => { BUILD = ${JSON.stringify([sp.hutch[0]])}; TEAMS_SIG = ''; renderSavedTeams(GARDEN_STATUS); return true; })()`);
      const before = await grun("window.__mgLoaderObserver.recentOutgoing.filter((e) => /SwapPetFromStorage/.test(JSON.stringify(e))).length");
      const b = await run("(() => { const q = document.querySelector('#teamCompare [data-put-out]'); q.scrollIntoView({ block: 'center' }); const r = q.getBoundingClientRect(); const z = window.devicePixelRatio || 1; return [Math.round((r.left + r.width / 2) * z), Math.round((r.top + r.height / 2) * z)]; })()");
      panel().sendInputEvent({ type: 'mouseDown', x: b[0], y: b[1], button: 'left', clickCount: 1 });
      panel().sendInputEvent({ type: 'mouseUp', x: b[0], y: b[1], button: 'left', clickCount: 1 });
      await wait(1500);
      tm.putOut = { swapsSent: (await grun("window.__mgLoaderObserver.recentOutgoing.filter((e) => /SwapPetFromStorage/.test(JSON.stringify(e))).length")) - before, toast: await run("(() => { const t = document.querySelector('.toast'); return t ? t.textContent : null; })()") };
      await wait(2500);
      tm.nowOut = await grun("(window.__mgLoaderObserver.state.child.data.userSlots[0].data.petSlots || []).map((p) => String(p.id))");
      out.teams59 = tm;
    }
    if (MODE === 'sweep') {
      // v0.59.9: a sweep of every tab, every fold open, on the owner's real
      // sample (MG_SAMPLE), for text and layout slips.
      const sample = JSON.parse(fs.readFileSync(process.env.MG_SAMPLE || path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      st.petRank = require('../pet-rank').rank(st.allPets || [], {});
      const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
      const a = src.indexOf('function troughForecast(');
      // eslint-disable-next-line no-new-func
      const troughForecast = new Function(`${src.slice(a, src.indexOf('\nfunction fmtLeft(', a))}; return troughForecast;`)();
      st.troughTimer = troughForecast(st.pets, st.trough);
      st.at = Date.now();
      st.connected = true;
      await wait(4500);
      await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(st)}; renderGarden(); renderStageBar(); return true; })()`);
      await wait(800);
      const tabs = await run("[...document.querySelectorAll('section[id^=tab-]')].map((s) => s.id.slice(4))");
      const found = [];
      // The Garden tab a view at a time (v0.64.0).
      const pages = [];
      for (const tab of tabs) for (const v of tab === 'garden' ? ['now', 'mutations', 'map', 'harvest', 'progress'] : [null]) pages.push([tab, v]);
      for (const [tab, view] of pages) {
        await run(`(() => { showTab('${tab}'); ${view ? `showGardenView('${view}', false);` : ''} for (const h of document.querySelectorAll('#tab-${tab} h2.folded')) h.click(); for (const d of document.querySelectorAll('#tab-${tab} details')) d.open = true; return true; })()`);
        await wait(900);
        const f = await run(`(() => {
          const sec = document.getElementById('tab-${tab}');
          const out = [];
          const lines = sec.innerText.split('\\n').map((l) => l.trim()).filter(Boolean);
          const BAD = [[/\\b(NaN|undefined|Infinity)\\b|\\[object Object\\]|\\$\\{|\\bnull\\b/, 'broken value'], [/·\\s*·|\\(\\s*\\)|,\\s*,|^\\s*[·,]|[·,]\\s*$/, 'stray separator'], [/(?<![\\d.])1 (crops|pets|plants|eggs|seeds|hours|days|minutes|times|teams|spots|tiles|harvests|mutations)\\b/, 'plural after 1'], [/\\b(0|[2-9]|\\d{2,}) (crop|pet|plant|egg|seed|hour|day|minute|team|spot|tile|harvest|mutation)\\b(?![s'-])/, 'singular after many'], [/\\s{2,}/, 'double space']];
          for (const l of lines) for (const [re, kind] of BAD) if (re.test(l)) out.push({ kind, text: l.slice(0, 140) });
          for (const el of sec.querySelectorAll('*')) {
            if (!el.offsetParent || el.clientWidth === 0) continue;
            const cs = getComputedStyle(el);
            if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'visible' && cs.textOverflow !== 'ellipsis' && !['SVG', 'svg', 'CANVAS'].includes(el.tagName) && el.children.length < 30) out.push({ kind: 'spills sideways', text: (el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ')[0] : el.tagName) + ' ' + (el.scrollWidth - el.clientWidth) + 'px: ' + (el.innerText || '').slice(0, 60).replace(/\\n/g, ' ') });
          }
          for (const img of sec.querySelectorAll('img')) if (img.offsetParent && img.complete && img.naturalWidth === 0) out.push({ kind: 'picture failed', text: img.getAttribute('src') });
          return out;
        })()`);
        for (const x of f) found.push(Object.assign({ tab: view ? `${tab}/${view}` : tab }, x));
        fs.mkdirSync('/tmp/sweep', { recursive: true });
        fs.writeFileSync(`/tmp/sweep/${tab}${view ? `-${view}` : ''}.txt`, await run(`document.getElementById('tab-${tab}').innerText`));
      }
      const ids = await run("(() => { const seen = {}; for (const el of document.querySelectorAll('[id]')) seen[el.id] = (seen[el.id] || 0) + 1; return Object.entries(seen).filter(([, n]) => n > 1).map(([id, n]) => id + ' x' + n); })()");
      for (const id of ids) found.push({ tab: '-', kind: 'duplicate id', text: id });
      out.sweep = { tabs, found };
    }
    if (MODE === 'extras') {
      // v0.60.1: Extras as tiles, with real clicks.
      const ex = {};
      await wait(4000);
      const click = async (sel) => {
        const r = await run(`(() => { const q = document.querySelector(${JSON.stringify(sel)}); q.scrollIntoView({ block: 'center' }); const b = q.getBoundingClientRect(); const z = window.devicePixelRatio || 1; return [Math.round((b.left + b.width / 2) * z), Math.round((b.top + b.height / 2) * z)]; })()`);
        panel().sendInputEvent({ type: 'mouseDown', x: r[0], y: r[1], button: 'left', clickCount: 1 });
        panel().sendInputEvent({ type: 'mouseUp', x: r[0], y: r[1], button: 'left', clickCount: 1 });
        await wait(400);
      };
      const foldsBefore = await run('JSON.stringify((S.ui || {}).folds || {})');
      await run("showTab('scripts')");
      await wait(500);
      ex.grid = await run("(() => ({ tiles: [...document.querySelectorAll('#exGrid .ex-tile')].map((t) => t.innerText.replace(/\\n/g, ' | ')), sectionsShowing: [...document.querySelectorAll('#tab-scripts > h2')].filter((h) => getComputedStyle(h).display !== 'none').length }))()");
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('#tab-scripts', 'extras-grid', 6);
      await click('#exGrid [data-ex="scripts/action-bar-keys"]');
      ex.open = await run("(() => ({ shown: [...document.querySelectorAll('#tab-scripts > h2')].filter((h) => getComputedStyle(h).display !== 'none').map((h) => h.childNodes[0].textContent.trim()), keysCard: getComputedStyle(document.getElementById('keysCard')).display !== 'none', keyRows: document.querySelectorAll('#keysCard [data-slot], #keysCard select').length, back: !document.getElementById('exBack').hidden, gridHidden: document.getElementById('exGrid').hidden }))()");
      await shotOf('#tab-scripts', 'extras-pane', 6);
      await click('#tab-scripts > h2[data-fold="scripts/action-bar-keys"]');
      ex.titleClick = await run("({ folded: document.querySelector('#tab-scripts > h2[data-fold=\"scripts/action-bar-keys\"]').classList.contains('folded'), keysCard: getComputedStyle(document.getElementById('keysCard')).display !== 'none' })");
      await run("document.getElementById('exBackBtn').focus(); document.getElementById('exBackBtn').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
      await wait(500);
      ex.focusCheck = await run("(() => { showTab('scripts'); openExtras('scripts/backups'); document.getElementById('exBackBtn').click(); const now = document.activeElement ? (document.activeElement.dataset.ex || document.activeElement.tagName) : null; return new Promise((r) => setTimeout(() => r({ now, later: document.activeElement ? (document.activeElement.dataset.ex || document.activeElement.tagName) : null, hasFocus: document.hasFocus() }), 200)); })()");
      ex.escape = await run("({ grid: !document.getElementById('exGrid').hidden, focused: document.activeElement ? (document.activeElement.dataset.ex || document.activeElement.id || document.activeElement.tagName) : null, sectionsShowing: [...document.querySelectorAll('#tab-scripts > h2')].filter((h) => getComputedStyle(h).display !== 'none').length })");
      ex.foldsUnchanged = (await run('JSON.stringify((S.ui || {}).folds || {})')) === foldsBefore;
      out.extras = ex;
    }
    if (MODE === 'ping') {
      // v0.60.2: a gentle ping when weather you don't want starts; PP's
      // explainer; Harvesting unlocked on the game's badge.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const pg = {};
      await wait(4500);
      await run("(() => { window.__toasts = []; const t0 = toast; window.toast = toast = (m) => { window.__toasts.push(m); return t0(m); }; return true; })()");
      // (v0.63.7) The rain alert on: it announces rain already, so no ping.
      await run("window.app.setSettings(Object.assign({}, S, { alerts: Object.assign({}, S.alerts, { disabled: (S.alerts.disabled || []).filter((x) => x !== 'rain') }), logoff: Object.assign({}, S.logoff, { kinds: ['rain'], ping: true, enabled: false }) }))");
      await wait(1500);
      await grun("window.__gameSend({ type: '__TestWeather', weather: 'Rain' })");
      await wait(4000);
      pg.alertOn = { toasts: await run('window.__toasts.slice()') };
      await grun("window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
      await wait(3000);
      await run('window.__toasts = []');
      // The rain alert off (the owner's setup): the gentle ping is the one heads-up.
      await run("window.app.setSettings(Object.assign({}, S, { alerts: Object.assign({}, S.alerts, { disabled: [...new Set([...(S.alerts.disabled || []), 'rain'])] }), logoff: Object.assign({}, S.logoff, { kinds: ['rain'], ping: true, enabled: false }) }))");
      await wait(1500);
      await grun("window.__gameSend({ type: '__TestWeather', weather: 'Rain' })");
      await wait(4000);
      pg.on = { toasts: await run('window.__toasts.slice()'), note: (await run("(document.getElementById('recentList') || document.body).innerText")).includes('Rain started') };
      await grun("window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
      await wait(3000);
      // Rain still picked, the ping off: the only difference is the ping.
      await run("window.app.setSettings(Object.assign({}, S, { alerts: Object.assign({}, S.alerts, { disabled: [...new Set([...(S.alerts.disabled || []), 'rain'])] }), logoff: Object.assign({}, S.logoff, { kinds: ['rain'], ping: false, enabled: false }) }))");
      await wait(1500);
      await run('window.__toasts = []');
      await grun("window.__gameSend({ type: '__TestWeather', weather: 'Rain' })");
      await wait(4000);
      pg.off = { toasts: await run('window.__toasts.slice()') };
      pg.saved = (await run('window.app.getSettings()')).logoff;
      // (v0.61.5) Quiet hours spanning now: the ping comes marked quiet (the
      // note shows, no chime); outside them it isn't.
      const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const from = hm(new Date(Date.now() - 3600000));
      const to = hm(new Date(Date.now() + 3600000));
      await grun("window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
      await wait(2500);
      await run(`window.app.setSettings(Object.assign({}, S, { alerts: Object.assign({}, S.alerts, { disabled: [...new Set([...(S.alerts.disabled || []), 'rain'])], quietHours: { enabled: true, from: '${from}', to: '${to}' } }), logoff: Object.assign({}, S.logoff, { kinds: ['rain'], ping: true }) }))`);
      await wait(1500);
      await run('window.__lastWeatherPing = null; window.__toasts = []');
      await grun("window.__gameSend({ type: '__TestWeather', weather: 'Rain' })");
      await wait(4000);
      pg.quietHours = { ping: await run('window.__lastWeatherPing'), toast: await run('window.__toasts.slice()') };
      const R = require('../pet-rank').rank(require('./fixtures/pets.json'), {});
      await run(`(() => { showTab('pets'); const h = document.querySelector('h2[data-fold="pets/pet-rankings"]'); if (h && h.classList.contains('folded')) h.click(); window.__petRankOverride = ${JSON.stringify(R)}; PR_SIG = ''; renderPetRank(); return true; })()`);
      await wait(500);
      pg.ppOpen = await run("(() => { const d = document.getElementById('prWhatPP'); if (!d) return null; d.open = true; return d.querySelector('.note').textContent.slice(0, 90); })()");
      pg.pp = await run("(() => { const d = document.getElementById('prWhatPP'); return d ? d.querySelector('summary').textContent : null; })()");
      await run("window.app.harvestSet({ mode: { on: true, color: 'any', hydro: [], lunar: [], size: false } })");
      await wait(1500);
      pg.badge = await grun("(() => { const el = document.getElementById('__mgHarvestLock'); return el ? el.textContent : null; })()");
      pg.button = await run("document.getElementById('modeBtn').title");
      await run("window.app.harvestSet({ mode: { on: false } })");
      out.ping = pg;
    }
    if (MODE === 'parked') {
      // v0.60.3: the stepped-away page: a big countdown, then Safe to join.
      const { BrowserWindow } = require('electron');
      const pk = {};
      fs.mkdirSync(SHOTS, { recursive: true });
      const w = new BrowserWindow({ width: 760, height: 560, show: false, webPreferences: { sandbox: true } });
      const now = Date.now();
      const states = {
        rain: { weather: 'Rain', emoji: '🌧️', kind: 'rain', since: String(now - 120000), until: String(now + 272000) },
        thunder: { weather: 'Thunderstorm', emoji: '⛈️', kind: 'thunder', since: String(now - 300000), until: String(now + 95000) },
        unknown: { weather: 'Snow', emoji: '❄️', kind: 'snow', since: String(now - 60000), until: '' },
        safe: { weather: 'Rain', emoji: '🌧️', kind: 'rain', since: String(now - 600000), until: String(now - 5000), over: '1' },
      };
      for (const [name, query] of Object.entries(states)) {
        await w.loadFile(path.join(__dirname, '..', 'parked.html'), { query });
        await wait(name === 'safe' ? 1200 : 1300);
        pk[name] = await w.webContents.executeJavaScript("({ safe: document.body.classList.contains('safe'), text: document.body.innerText.replace(/\\n+/g, ' | ').slice(0, 160) })");
        fs.writeFileSync(path.join(SHOTS, `parked-${name}.png`), (await w.webContents.capturePage()).toPNG());
      }
      // (v0.61.1) The game's weather right now on the break / safe view.
      const ww = new BrowserWindow({ width: 760, height: 560, show: true, x: 0, y: 0, webPreferences: { sandbox: true } });
      const nowStates = {
        breakRain: { weather: 'a break', emoji: '🌙', since: String(Date.now() - 60000), now: 'rain', nowLabel: 'Rain', nowEmoji: '🌧️', nowEnds: String(Date.now() + 1500000) },
        safeSnow: { weather: 'Rain', emoji: '🌧️', kind: 'rain', since: String(Date.now() - 600000), until: String(Date.now() - 5000), over: '1', now: 'snow', nowLabel: 'Snow', nowEmoji: '❄️', nowEnds: String(Date.now() + 900000) },
        breakClear: { weather: 'a break', emoji: '🌙', since: String(Date.now() - 60000) },
      };
      for (const [name, query] of Object.entries(nowStates)) {
        await ww.loadFile(path.join(__dirname, '..', 'parked.html'), { query });
        await wait(1500);
        pk[name] = await ww.webContents.executeJavaScript("({ cls: document.body.className, sky: document.getElementById('sky').textContent, sub: document.getElementById('safeSub').textContent })");
        fs.writeFileSync(path.join(SHOTS, `parked-${name}.png`), (await ww.webContents.capturePage()).toPNG());
      }
      // Live: the weather changes while you're on the page.
      await ww.webContents.executeJavaScript("window.__nowWeather({ kind: 'thunder', label: 'Thunderstorm', emoji: '⛈️', endsAt: Date.now() + 600000 })");
      await wait(400);
      pk.liveThunder = await ww.webContents.executeJavaScript("({ cls: document.body.className, sky: document.getElementById('sky').textContent, sub: document.getElementById('safeSub').textContent })");
      ww.destroy();
      // (v0.60.5) The Reconnect button, with the game view's preload (the
      // bridge): it floats in a few seconds in; and its pressed look.
      // (Shown: a hidden window doesn't run animations, so the button would
      // stay at the start of its fade-in.)
      const wb = new BrowserWindow({ width: 760, height: 560, show: true, x: 0, y: 0, webPreferences: { sandbox: true, preload: path.join(__dirname, '..', 'preload-game.js') } });
      const rq = { weather: 'Rain', emoji: '🌧️', kind: 'rain', since: String(Date.now() - 60000), until: String(Date.now() + 240000), start: String(Date.now() - 1000) };
      await wb.loadFile(path.join(__dirname, '..', 'parked.html'), { query: rq });
      await wait(1500);
      pk.reconEarly = await wb.webContents.executeJavaScript("!document.getElementById('recon').hidden");
      await wait(4500);
      pk.reconLater = await wb.webContents.executeJavaScript("({ shown: !document.getElementById('recon').hidden, text: document.getElementById('recon').innerText.trim() })");
      fs.writeFileSync(path.join(SHOTS, 'parked-recon.png'), (await wb.webContents.capturePage()).toPNG());
      await wb.loadFile(path.join(__dirname, '..', 'parked.html'), { query: Object.assign({}, rq, { reconnect: '1' }) });
      await wait(1000);
      pk.reconArmed = await wb.webContents.executeJavaScript("document.getElementById('reconOn').innerText.replace(/\\s+/g, ' ').trim()");
      fs.writeFileSync(path.join(SHOTS, 'parked-armed.png'), (await wb.webContents.capturePage()).toPNG());
      wb.destroy();
      // It turns over by itself when the countdown ends.
      await w.loadFile(path.join(__dirname, '..', 'parked.html'), { query: { weather: 'Rain', emoji: '🌧️', kind: 'rain', since: String(Date.now() - 60000), until: String(Date.now() + 2000) } });
      await wait(600);
      const before = await w.webContents.executeJavaScript("document.body.classList.contains('safe')");
      await wait(3000);
      pk.turnsOver = { before, after: await w.webContents.executeJavaScript("document.body.classList.contains('safe')"), join: await w.webContents.executeJavaScript("document.getElementById('join').getAttribute('href')") };
      w.destroy();
      out.parked = pk;
    }
    if (MODE === 'eggpp') {
      // v0.60.4: Pet Power by egg, on the owner's pets.
      const petRank = require('../pet-rank');
      const R = petRank.rank(require('./fixtures/pets.json'), {});
      R.eggHunt = petRank.eggHunt(R, require('../pet-data').allEggs(), require('./fixtures/pets.json'));
      await wait(4000);
      await run(`(() => { showTab('pets'); const h = document.querySelector('h2[data-fold="pets/pet-rankings"]'); if (h && h.classList.contains('folded')) h.click(); window.__petRankOverride = ${JSON.stringify(R)}; PR_SIG = ''; renderPetRank(); const d = document.getElementById('prEgg'); d.open = true; d.scrollIntoView({ block: 'start' }); return true; })()`);
      await wait(500);
      out.eggpp = await run("(() => ({ rows: [...document.querySelectorAll('#prEgg .egg-row')].slice(0, 4).map((r) => r.innerText.replace(/\\n+/g, ' | ')), tip: (document.querySelector('#prEgg .egg-sp .tip') || {}).dataset.tip }))()");
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('#prEgg', 'eggpp', 6);
    }
    if (MODE === 'look') {
      // The panel's look, tab by tab, on the owner's sample (for the makeover).
      const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      st.petRank = require('../pet-rank').rank(st.allPets || [], {});
      await wait(4500);
      st.at = Date.now();
      await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(st)}; renderGarden(); return true; })()`);
      fs.mkdirSync(SHOTS, { recursive: true });
      out.hello = await run("document.getElementById('hello').innerText");
      for (const tab of (process.env.MG_TABS || 'alerts,garden,pets,money').split(',')) {
        await run(`(() => { showTab('${tab}'); document.querySelector('main').scrollTop = 0; return true; })()`);
        await wait(900);
        fs.writeFileSync(path.join(SHOTS, `look-${tab}.png`), (await panel().capturePage()).toPNG());
      }
    }
    if (MODE === 'suggest') {
      // v0.61.2: the team suggestion in the middle of the game.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      await wait(4500);
      await grun("window.__mgLoaderObserver.showTeamSuggest({ teamId: 't', name: 'Rain', why: 'for Rain', emoji: '🌧️' })");
      await wait(900);
      out.suggest = await grun("(() => { const el = document.getElementById('mg-team-suggest'); const r = el.getBoundingClientRect(); return { centreX: Math.round(r.left + r.width / 2), centreY: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), winW: innerWidth, winH: innerHeight, text: el.innerText.replace(/\\n+/g, ' | ') }; })()");
      const b = await grun("(() => { const r = document.getElementById('mg-team-suggest').getBoundingClientRect(); return [Math.max(0, Math.round(r.left) - 40), Math.max(0, Math.round(r.top) - 40), Math.round(r.width) + 80, Math.round(r.height) + 80]; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, 'suggest.png'), (await gw.capturePage()).toPNG());
      out.suggestBox = b;
    }
    if (MODE === 'overlays') {
      // v0.61.3: everything over the game, together (for the glass look).
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      await wait(5000);
      await run("window.app.harvestSet({ mode: { on: true, color: 'any', hydro: [], lunar: [], size: false } })");
      await wait(800);
      await grun("window.__mgLoaderObserver.showTeamSuggest({ teamId: 't', name: 'Rain', why: 'for Rain', emoji: '🌧️' })");
      await grun("window.__mgLoaderObserver.setTroughChip && window.__mgLoaderObserver.setTroughChip({ on: true, text: '🍽️ Trough runs out in 2h 10m', urgent: false })");
      await wait(700);
      out.overlays = await grun("(() => { const ids = ['mg-team-suggest', '__mgHarvestLock', 'mg-team-btn', 'mg-action-bar', 'mg-money-box', 'mg-trough-chip']; const o = { glass: Boolean(document.getElementById('mg-glass-style')) }; for (const id of ids) { const el = document.getElementById(id); if (!el) { o[id] = null; continue; } const s = getComputedStyle(el); o[id] = { font: s.fontFamily.split(',')[0], radius: s.borderRadius, bg: s.backgroundColor, blur: s.backdropFilter }; } o.fontLoaded = document.fonts.check('14px \"MG Nunito\"'); return o; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, `overlays-${process.env.MG_TAG || 'x'}.png`), (await gw.capturePage()).toPNG());
      await grun("window.__mgLoaderObserver.showTeamSuggest(null); window.__mgLoaderObserver.showStepOut({ label: 'Rain', emoji: '🌧️', until: Date.now() + 45000 })");
      await wait(900);
      fs.writeFileSync(path.join(SHOTS, `overlays-step-${process.env.MG_TAG || 'x'}.png`), (await gw.capturePage()).toPNG());
      await run("window.app.harvestSet({ mode: { on: false } })");
    }
    if (MODE === 'mutgap') {
      // v0.61.4: a 3-hour stretch away holds flat (no gap).
      await wait(4500);
      const now = Date.now();
      const H = 3600000;
      const hist = [];
      const add = (t, w, d, g) => hist.push({ t, n: 200, w, ch: 0, f: 0, th: 0, d, a: 0, g, r: 0 });
      for (let i = 10; i >= 6; i -= 0.25) add(now - i * H, 40 + (10 - i) * 6, 20 + (10 - i) * 2, 10);
      for (let i = 3; i >= 0; i -= 0.25) add(now - i * H, 75 + (3 - i) * 4, 32 + (3 - i), 14);
      await run(`(() => { window.__holdStatus = true; GARDEN_STATS = Object.assign({}, GARDEN_STATS, { mutHistory: ${JSON.stringify(hist)} }); S.ui = Object.assign({}, S.ui, { mutRange: 12 }); showTab('garden'); const h = document.querySelector('#mutChart'); MUT_SIG = ''; renderMutChart(); return true; })()`);
      await wait(800);
      out.mutgap = await run("(() => { const svg = document.querySelector('#mutChart svg'); if (!svg) return null; const paths = [...svg.querySelectorAll('path, polyline')].filter((e) => (e.getAttribute('stroke') || '') !== 'none' && (e.getAttribute('d') || e.getAttribute('points') || '').length > 20); return { lines: paths.length, segments: paths.map((e) => ((e.getAttribute('d') || '').match(/M/g) || []).length) }; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('#mutChart', 'mutgap', 6);
    }
    if (MODE === 'comb') {
      // v0.61.5: every tab top to bottom, every fold open, on the owner's
      // sample (stitched afterwards), for a look-over.
      const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      const petRank = require('../pet-rank');
      st.petRank = petRank.rank(st.allPets || [], {});
      st.petRank.eggHunt = petRank.eggHunt(st.petRank, require('../pet-data').allEggs(), st.allPets || []);
      st.at = Date.now();
      await wait(4500);
      await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(st)}; renderGarden(); return true; })()`);
      fs.mkdirSync(SHOTS, { recursive: true });
      const tabs = (process.env.MG_TABS || 'alerts,weather,pity,garden,money,pets,rooms,scripts').split(',');
      out.comb = {};
      for (const tab of tabs) {
        await run(`(() => { showTab('${tab}'); for (const h of document.querySelectorAll('#tab-${tab} > h2.fold.folded')) applyFold(h, false); for (const d of document.querySelectorAll('#tab-${tab} details')) d.open = true; if ('${tab}' === 'scripts') openExtras(null); document.querySelector('main').scrollTop = 0; return true; })()`);
        await wait(900);
        const total = await run("document.querySelector('main').scrollHeight");
        const view = await run("document.querySelector('main').clientHeight");
        const top = await run("document.querySelector('main').getBoundingClientRect().top");
        let y = 0;
        let i = 0;
        while (i < 24) {
          await run(`(() => { const m = document.querySelector('main'); m.style.scrollBehavior = 'auto'; m.scrollTop = ${y}; return true; })()`);
          await wait(450);
          const at = await run("document.querySelector('main').scrollTop");
          const shot = await panel().capturePage();
          fs.writeFileSync(path.join(SHOTS, `comb-${tab}-${String(i).padStart(2, '0')}-y${Math.round(at)}.png`), shot.toPNG());
          i += 1;
          if (y + view >= total) break;
          y += view - 30;
        }
        out.comb[tab] = { total, view, top, shots: i, lastY: y };
      }
    }
    if (MODE === 'worthgap') {
      // v0.61.6: Garden worth with 3 hours away: a faint dashed bridge.
      await wait(4500);
      const now = Date.now();
      const pts = [];
      for (let t = now - 20 * 3600000; t <= now - 8 * 3600000; t += 1800000) pts.push({ t, v: 300e9 + (t - (now - 20 * 3600000)) / 3600000 * 4e9 });
      for (let t = now - 5 * 3600000; t <= now; t += 1800000) pts.push({ t, v: 360e9 + (t - (now - 5 * 3600000)) / 3600000 * 5e9 });
      await run(`(() => { showTab('garden'); WORTH = ${JSON.stringify(pts)}; worthFetchedAt = Date.now(); renderWorth(); return true; })()`);
      await wait(600);
      out.worthgap = await run("(() => { const svg = document.querySelector('.worth-svg'); const ps = [...svg.querySelectorAll('path')]; return ps.map((p) => ({ dash: p.getAttribute('stroke-dasharray'), m: ((p.getAttribute('d') || '').match(/M/g) || []).length, title: (p.querySelector('title') || {}).textContent || '' })); })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('.worth-svg', 'worthgap', 10);
    }
    if (MODE === 'pause') {
      // v0.62.0: 🔔 in the header pauses pings for an hour; 🔕 brings them back.
      await wait(4500);
      const read = () => run("(() => { const b = document.getElementById('pingBtn'); return { icon: b.dataset.icon, pressed: b.getAttribute('aria-pressed'), title: b.title, hello: document.getElementById('hello').innerText, until: S.alerts.snoozeUntil ? Math.round((S.alerts.snoozeUntil - Date.now()) / 60000) : 0 }; })()");
      const before = await read();
      const click = async () => {
        const r = await run("(() => { const b = document.getElementById('pingBtn').getBoundingClientRect(); const z = window.devicePixelRatio || 1; return [Math.round((b.left + b.width / 2) * z), Math.round((b.top + b.height / 2) * z)]; })()");
        panel().sendInputEvent({ type: 'mouseDown', x: r[0], y: r[1], button: 'left', clickCount: 1 });
        panel().sendInputEvent({ type: 'mouseUp', x: r[0], y: r[1], button: 'left', clickCount: 1 });
        await wait(600);
      };
      await click();
      const paused = await read();
      const saved = (await run('window.app.getSettings()')).alerts.snoozeUntil;
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('header', 'pause', 4);
      await click();
      out.pause = { before, paused, savedMinutes: Math.round((saved - Date.now()) / 60000), after: await read() };
    }
    if (MODE === 'planner') {
      // v0.62.2: the weather planner on the owner's garden.
      const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      st.at = Date.now();
      const iso = (ms) => new Date(Date.now() + ms).toISOString();
      const H = 3600000;
      const status = { lastCheck: Date.now(), current: { kind: 'rain', startsAt: iso(-5 * 60000), endsAt: iso(10 * 60000), announced: true }, upcoming: [
        { kind: 'amber', startsAt: iso(1.5 * H), endsAt: iso(1.5 * H + 40 * 60000), announced: true },
        { kind: 'dawn', startsAt: iso(3 * H), endsAt: iso(3 * H + 40 * 60000), announced: true },
        { kind: 'snow', startsAt: iso(4.2 * H), endsAt: iso(4.2 * H + 10 * 60000), announced: false },
      ] };
      const teamId = (st.teams && st.teams[0] && st.teams[0].id) || null;
      await wait(4500);
      await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(st)}; LAST_TEAMS = GARDEN_STATUS.teams || []; STATUS = ${JSON.stringify(status)}; S.logoff = Object.assign({}, S.logoff, { kinds: ['rain'], ping: true, enabled: false }); S.weatherTeams = Object.assign({}, S.weatherTeams, { enabled: true, amber: ${JSON.stringify(teamId)}, dawn: null }); showTab('weather'); document.querySelector('main').scrollTop = 0; renderWeatherSchedule(); return true; })()`);
      await wait(700);
      out.planner = await run("[...document.querySelectorAll('#wxSchedule .wp-row')].map((r) => r.innerText.replace(/\\n+/g, ' | '))");
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('#tab-weather > .card', 'planner', 8);
    }
    if (MODE === 'pots') {
      // v0.63.0: the pet-food pots card: plant one (a real PlantGardenPlant),
      // pot one (a real PotPlant with a fresh id; the stand-in doesn't make
      // the pot, so the card must say so and stop).
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const log = () => fs.readFileSync(path.join(process.env.MG_TEST_DIR || '/tmp/erun', 'server.log'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } });
      await wait(5000);
      const potted = await grun('window.__mgLoaderObserver.bagSummary().potted');
      const sp = Object.keys(potted || {})[0] || null;
      const pk = { potted, sp };
      if (sp) {
        await grun(`window.__mgLoaderObserver.potWeather({ mode: 'plant', species: ['${sp}'], kind: 'rain', label: 'Rain', emoji: '🌧️' })`);
        await wait(600);
        pk.plantCard = await grun("(() => { const c = document.getElementById('mg-pot-card'); return c && c.style.display !== 'none' ? c.innerText.replace(/\\n+/g, ' | ') : null; })()");
        fs.mkdirSync(SHOTS, { recursive: true });
        fs.writeFileSync(path.join(SHOTS, 'pots-plant.png'), (await gw.capturePage()).toPNG());
        const before = log().filter((l) => l.cmd === 'PlantGardenPlant').length;
        await grun("document.querySelector('#mg-pot-card [data-act=go]').click()");
        await wait(1500);
        pk.plantSent = log().filter((l) => l.cmd === 'PlantGardenPlant').length - before;
      }
      const garden = await grun("(() => { const o = window.__mgLoaderObserver; const t = o.mapCard ? o.mapCard('spots') : null; return t ? (t.species || null) : null; })()");
      pk.gardenSpecies = garden;
      const tries = ['Carrot', 'Strawberry', 'Tomato', 'Corn', 'Blueberry', 'Lychee', 'Sunflower', 'Aloe'];
      for (const s of tries) {
        await grun(`window.__mgLoaderObserver.potWeather({ mode: 'pick', species: ['${s}'], kind: 'rain', label: 'Rain', emoji: '🌧️' })`);
        await wait(300);
        const shown = await grun("(() => { const c = document.getElementById('mg-pot-card'); return Boolean(c && c.style.display !== 'none'); })()");
        if (shown) { pk.pickSpecies = s; break; }
      }
      if (pk.pickSpecies) {
        pk.pickCard = await grun("document.getElementById('mg-pot-card').innerText.replace(/\\n+/g, ' | ')");
        const before = log().filter((l) => l.cmd === 'PotPlant').length;
        await grun("document.querySelector('#mg-pot-card [data-act=go]').click()");
        await wait(800);
        const sent = log().filter((l) => l.cmd === 'PotPlant');
        pk.potSent = sent.length - before;
        pk.potCmd = sent.slice(-1)[0] || null;
        await wait(2600);
        pk.afterCheck = await grun("(() => { const c = document.getElementById('mg-pot-card'); return { shown: c.style.display !== 'none', text: c.innerText.replace(/\\n+/g, ' | ') }; })()");
        pk.goGone = await grun("!document.querySelector('#mg-pot-card [data-act=go]')");
        fs.writeFileSync(path.join(SHOTS, 'pots-pick.png'), (await gw.capturePage()).toPNG());
      }
      out.pots = pk;
    }
    if (MODE === 'recap') {
      // v0.63.1: Welcome back after 2 hours away.
      const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      st.at = Date.now();
      const b = (st.crops || []).find((x) => /garden/i.test(x.name));
      const now = Date.now();
      const snap = { at: now - 2 * 3600000 - 10 * 60000, ready: 7, worth: b.value - 12.4e9 };
      const hist = [
        { text: '🛒 Old thing in stock', at: now - 3 * 3600000 },
        { text: '🛒 Legendary Egg in stock', at: now - 90 * 60000 },
        { text: '🛒 Moonbinder in stock', at: now - 60 * 60000 },
        { text: '🛒 Legendary Egg in stock', at: now - 20 * 60000 },
      ];
      await wait(4500);
      await run(`(() => { window.__holdStatus = true; localStorage.setItem('gb.recapSnap', ${JSON.stringify(JSON.stringify(snap))}); HISTORY = ${JSON.stringify(hist)}; GARDEN_STATUS = ${JSON.stringify(st)}; renderGarden(); return true; })()`);
      await wait(500);
      const rc = {};
      rc.bar = await run("(() => { const b = document.getElementById('recapBar'); return { shown: !b.hidden, text: b.innerText }; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      await shotOf('header', 'recap', 4);
      await run("document.querySelector('#recapBar [data-recap]').click()");
      await wait(300);
      rc.closed = await run("document.getElementById('recapBar').hidden");
      await run('renderGarden()');
      await wait(300);
      rc.notAgain = await run("document.getElementById('recapBar').hidden");
      rc.snapFresh = await run("Math.round((Date.now() - JSON.parse(localStorage.getItem('gb.recapSnap')).at) / 1000)");
      out.recap = rc;
    }
    if (MODE === 'welcome' || MODE === 'setup') {
      // v0.71.0: the new user setup on a fresh install, every screen at
      // 372 wide (MG_SAMPLE for a connected garden), with real clicks.
      await wait(4500);
      if (process.env.MG_SAMPLE) {
        const sample = JSON.parse(fs.readFileSync(process.env.MG_SAMPLE, 'utf8'));
        const st = sample.lastStatus;
        st.at = Date.now();
        await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(st)}; renderGarden(); return true; })()`);
      }
      const realW = await run('innerWidth');
      panel().setZoomFactor(realW / 372);
      await wait(500);
      const click = async (sel) => {
        const r = await run(`(() => { const q = document.querySelector(${JSON.stringify(sel)}); if (!q) return null; q.scrollIntoView({ block: 'center' }); const b = q.getBoundingClientRect(); const z = ${realW / 372}; return [Math.round((b.left + b.width / 2) * z), Math.round((b.top + b.height / 2) * z)]; })()`);
        if (!r) return false;
        panel().sendInputEvent({ type: 'mouseDown', x: r[0], y: r[1], button: 'left', clickCount: 1 });
        panel().sendInputEvent({ type: 'mouseUp', x: r[0], y: r[1], button: 'left', clickCount: 1 });
        await wait(450);
        return true;
      };
      fs.mkdirSync(SHOTS, { recursive: true });
      const w = { steps: [] };
      const shot = async (name) => {
        await run("(() => { const b = document.querySelector('#setupSheet .su-body'); if (b) b.scrollTop = 0; return true; })()");
        await wait(250);
        fs.writeFileSync(path.join(SHOTS, `setup-${name}.png`), (await panel().capturePage()).toPNG());
        const more = await run("(() => { const b = document.querySelector('#setupSheet .su-body'); return b ? b.scrollHeight > b.clientHeight + 4 : false; })()");
        if (more) {
          await run("(() => { const b = document.querySelector('#setupSheet .su-body'); b.scrollTop = b.scrollHeight; return true; })()");
          await wait(250);
          fs.writeFileSync(path.join(SHOTS, `setup-${name}-b.png`), (await panel().capturePage()).toPNG());
        }
      };
      w.shown = await run("!document.getElementById('setupSheet').hidden");
      for (let i = 0; i < 9; i += 1) {
        const step = await run("document.getElementById('setupSheet').dataset.step");
        w.steps.push(step);
        await shot(`${i}-${step}`);
        if (step === 'weather') await click('#setupSheet [data-wkind="rain"]');
        if (step === 'done') break;
        await click('#setupSheet [data-wgo="next"]');
      }
      await click('#setupSheet [data-wgo="done"]');
      await wait(400);
      w.closed = await run("document.getElementById('setupSheet').hidden");
      w.saved = await run("window.app.getSettings().then((s) => ({ welcomed: s.ui.welcomed, kinds: s.logoff.kinds }))");
      // An existing install: choices already made -> no setup, marked quietly.
      await run("(() => { S.ui = Object.assign({}, S.ui, { welcomed: false }); S.alerts.custom = [{ name: 'Lychee', tier: 'named' }]; maybeWelcome(); return true; })()");
      w.existing = await run("({ hidden: document.getElementById('setupSheet').hidden, welcomed: S.ui.welcomed })");
      panel().setZoomFactor(1);
      out.welcome = w;
    }
    if (MODE === 'potsw') {
      // v0.63.4: off by default; on + ticked kinds -> the card offers only those.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const card = () => grun("(() => { const c = document.getElementById('mg-pot-card'); return c && c.style.display !== 'none' ? c.innerText.replace(/\\n+/g, ' | ') : null; })()");
      await wait(5000);
      const r = {};
      r.defaults = await run('window.app.potWeather(null)');
      await grun("window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
      await wait(3000);
      await grun("window.__gameSend({ type: '__TestWeather', weather: 'Rain' })");
      await wait(4000);
      r.offCard = await card();
      await run("(() => { showTab('weather'); return true; })()");
      await wait(400);
      await run("document.getElementById('potWeatherOn').click()");
      await wait(600);
      r.afterSwitch = await run('window.app.potWeather(null)');
      await run("window.app.potWeather({ species: ['Tulip'] })");
      await wait(400);
      await grun("window.__gameSend({ type: '__TestWeather', weather: 'Sunny' })");
      await wait(3500);
      await grun("window.__gameSend({ type: '__TestWeather', weather: 'Rain' })");
      await wait(4500);
      r.onCard = await card();
      r.saved = (await run('window.app.getSettings()')).ui;
      r.saved = { potWeather: r.saved.potWeather, potWeatherSpecies: r.saved.potWeatherSpecies };
      out.potsw = r;
    }
    if (MODE === 'mapresize') {
      // v0.63.5: the map's resize grip, with real mouse events.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      await wait(5000);
      await run("window.app.harvestSet({ mode: { on: true, color: 'any', hydro: [], lunar: [], size: false } })");
      await wait(1500);
      const info = () => grun("(() => { const m = document.getElementById('mg-map'); const g = m && m.querySelector('.mg-map-grip'); if (!m || !g) return null; const r = m.getBoundingClientRect(); const q = g.getBoundingClientRect(); return { w: Math.round(r.width), zoom: m.style.zoom, gx: Math.round(q.left + q.width / 2), gy: Math.round(q.top + q.height / 2) }; })()");
      const drag = async (dx, dy) => {
        const a = await info();
        gw.sendInputEvent({ type: 'mouseMove', x: a.gx, y: a.gy });
        gw.sendInputEvent({ type: 'mouseDown', x: a.gx, y: a.gy, button: 'left', clickCount: 1 });
        for (let i = 1; i <= 6; i += 1) {
          gw.sendInputEvent({ type: 'mouseMove', x: Math.round(a.gx + dx * i / 6), y: Math.round(a.gy + dy * i / 6), button: 'left', modifiers: ['leftButtonDown'] });
          await wait(40);
        }
        gw.sendInputEvent({ type: 'mouseUp', x: a.gx + dx, y: a.gy + dy, button: 'left', clickCount: 1 });
        await wait(500);
        return info();
      };
      const r = { before: await info() };
      r.under = await grun("(() => { const m = document.getElementById('mg-map'); const g = m.querySelector('.mg-map-grip'); const q = g.getBoundingClientRect(); const el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); const path = []; for (let e = el; e && path.length < 5; e = e.parentElement) path.push((e.id ? '#' + e.id : e.tagName.toLowerCase()) + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '')); return { path, gripPE: getComputedStyle(g).pointerEvents, boxPE: getComputedStyle(m).pointerEvents, parent: m.parentElement && m.parentElement.id, parentPE: m.parentElement && getComputedStyle(m.parentElement).pointerEvents, dpr: devicePixelRatio, zoom: m.style.zoom }; })()");
      await grun("(() => { window.__ev = { win: {}, grip: {} }; const g = document.querySelector('#mg-map .mg-map-grip'); for (const t of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup']) { window.addEventListener(t, (e) => { if (e.target === g) window.__ev.win[t] = (window.__ev.win[t] || 0) + 1; }, true); g.addEventListener(t, () => { window.__ev.grip[t] = (window.__ev.grip[t] || 0) + 1; }); } return true; })()");
      r.bigger = await drag(120, 120);
      r.events = await grun('window.__ev');
      r.saved = ((await run('window.app.getSettings()')).ui.mapPos || {})['mg-map-size'] || null;
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, 'mapresize-big.png'), (await gw.capturePage()).toPNG());
      r.smaller = await drag(-400, -400);
      const a = await info();
      gw.sendInputEvent({ type: 'mouseDown', x: a.gx, y: a.gy, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseUp', x: a.gx, y: a.gy, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseDown', x: a.gx, y: a.gy, button: 'left', clickCount: 2 });
      gw.sendInputEvent({ type: 'mouseUp', x: a.gx, y: a.gy, button: 'left', clickCount: 2 });
      await wait(500);
      r.reset = await info();
      await run("window.app.harvestSet({ mode: { on: false } })");
      out.mapresize = r;
    }
    if (MODE === 'moneycover') {
      // v0.63.6: the Money tab's cover while it gathers data.
      await wait(4500);
      fs.mkdirSync(SHOTS, { recursive: true });
      const mc = {};
      for (const [name, b] of Object.entries({ day: { unlocked: false, measuredHours: 10, unlockDays: 1, unlockMode: 'auto' }, big: { unlocked: false, measuredHours: 60, unlockDays: 14, unlockMode: 'auto' } })) {
        await run(`(() => { showTab('money'); document.querySelector('main').scrollTop = 0; applyMoneyUnlock(${JSON.stringify(b)}); return true; })()`);
        await wait(700);
        mc[name] = await run("(() => { const i = document.getElementById('moneyIntro'); const sec = document.getElementById('tab-money'); const other = [...sec.children].find((x) => x.id !== 'moneyIntro' && getComputedStyle(x).display !== 'none'); return { shown: !i.hidden, lead: (i.querySelector('.mi-lead') || {}).textContent, sub: (i.querySelector('.mi-sub') || {}).textContent, ring: (i.querySelector('.mi-ring span') || {}).textContent, behind: other ? { filter: getComputedStyle(other).filter, pe: getComputedStyle(other).pointerEvents } : null }; })()");
        fs.writeFileSync(path.join(SHOTS, `moneycover-${name}.png`), (await panel().capturePage()).toPNG());
      }
      out.moneycover = mc;
    }
    if (MODE === 'troughmove') {
      // v0.63.8: the trough timer, dragged with a real mouse.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      await wait(5000);
      await grun("window.__mgLoaderObserver.setTroughChip({ on: true, text: '🍽️ 2h 10m', emptyAt: Date.now() + 2 * 3600000 + 600000 })");
      await wait(600);
      const at = () => grun("(() => { const c = document.getElementById('mg-trough-chip'); const r = c.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), pe: getComputedStyle(c).pointerEvents }; })()");
      const t = { before: await at() };
      const a = t.before;
      gw.sendInputEvent({ type: 'mouseMove', x: a.cx, y: a.cy });
      gw.sendInputEvent({ type: 'mouseDown', x: a.cx, y: a.cy, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 8; i += 1) {
        gw.sendInputEvent({ type: 'mouseMove', x: a.cx + Math.round(300 * i / 8), y: a.cy + Math.round(150 * i / 8), button: 'left', modifiers: ['leftButtonDown'] });
        await wait(30);
      }
      gw.sendInputEvent({ type: 'mouseUp', x: a.cx + 300, y: a.cy + 150, button: 'left', clickCount: 1 });
      await wait(500);
      t.dragged = await at();
      t.saved = ((await run('window.app.getSettings()')).ui.mapPos || {})['mg-trough-chip'] || null;
      const b = t.dragged;
      gw.sendInputEvent({ type: 'mouseDown', x: b.cx, y: b.cy, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseUp', x: b.cx, y: b.cy, button: 'left', clickCount: 1 });
      await wait(300);
      t.afterClick = await at();
      gw.sendInputEvent({ type: 'mouseDown', x: b.cx, y: b.cy, button: 'left', clickCount: 2 });
      gw.sendInputEvent({ type: 'mouseUp', x: b.cx, y: b.cy, button: 'left', clickCount: 2 });
      await wait(500);
      t.reset = await at();
      t.savedAfterReset = ((await run('window.app.getSettings()')).ui.mapPos || {})['mg-trough-chip'] || null;
      out.troughmove = t;
    }
    if (MODE === 'luck') {
      // The Luck tab in two states, built with luck.js itself: a late-game
      // account with counters at every stage, and a fresh one where every
      // counter is still waiting for its first result (v0.72.0).
      const L = require('../luck');
      const late = L.migrate({});
      for (const [key, v] of [['egg:MythicalEgg:Capybara', 39], ['egg:AmberEgg:Phoenix', 96], ['egg:AmberEgg:FireHorse', 22], ['egg:ThunderEgg:ThunderWolf', 30],
        ['egg:DawnEgg:Ostrich', 12], ['egg:MythicalEgg:gold', 170], ['egg:CommonEgg:rainbow', 1100], ['capsule:DawnCapsule:Dawnbreaker', 380], ['capsule:DawnCapsule:Ube', 50],
        ['capsule:AmberCapsule:XPShard', 70], ['capsule:AmberCapsule:StrengthShard', 210], ['plant:Emberbloom:Embercrown', 470], ['plant:Sunflower:gold', 150], ['plant:Sunflower:rainbow', 400]]) L.set(late, key, v);
      const fresh = L.migrate({});
      for (let i = 0; i < 12; i += 1) L.onEgg(fresh, { eggId: 'ThunderEgg', species: 'Bee', mutations: [] });
      const lk = {};
      // A fresh install opens the new user setup (v0.71.0): close it first.
      await run("(() => { const b = document.querySelector('#setupSheet [data-wgo=\"skip\"]'); if (b && !document.getElementById('setupSheet').hidden) b.click(); return true; })()");
      await wait(300);
      // ...and the room-sharing question it hands off to.
      for (let i = 0; i < 12; i += 1) {
        if (await run("(() => { const b = document.getElementById('shareAskNo'); if (b) b.click(); return Boolean(b); })()")) break;
        await wait(300);
      }
      await wait(300);
      for (const [name, st] of [['late', late], ['fresh', fresh]]) {
        const view = L.view(st);
        await run(`(() => { LUCK = ${JSON.stringify(view)}; showTab('pity'); document.querySelector('main').scrollTop = 0; renderLuck(); })()`);
        await wait(500);
        lk[name] = {
          hero: await run("(() => { const h = document.querySelector('#luckPrimed .lk-hero'); return h ? ['.lk-icon', '.lk-kicker', '.lk-name', '.lk-line', '.lk-story'].map((s) => h.querySelector(s).innerText.replace(/\\s+/g, ' ')).join(' | ') : null; })()"),
          rows: await run("[...document.querySelectorAll('#luckPrimed .lk-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())"),
          gold: await run("[...document.querySelectorAll('#luckPrimed .lk-name, #luckPrimed .lk-row b')].some((e) => /^(gold|rainbow)$/i.test(e.innerText.trim()))"),
          notes: await run("[...document.querySelectorAll('#luckPrimed > .note')].map((n) => n.innerText)"),
          waiting: await run("[...document.querySelectorAll('#luckEggs .lk-wait')].length"),
          numbers: await run("[...document.querySelectorAll('#luckEggs .luck-row:not(.wait) .lk-miss')].length"),
          inputs: await run("document.querySelectorAll('#tab-pity input[type=number]').length"),
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
    if (MODE === 'quests') {
      // v0.65.0: the Quests tab on the owner's quests (12 Oct 2026).
      const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'quests-sample.json'), 'utf8'));
      const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      const T = global.__mgTest;
      const today = new Date().toISOString().slice(0, 10);
      const dq = JSON.parse(JSON.stringify(fx.dailyQuests));
      dq.dayUTC = today;
      const now = Date.now();
      // His garden: Divine and Celestial plants ripe; 42 Legendary Eggs, some ready.
      const plants = [];
      const eggs = [];
      let k = 0;
      for (const [tile, v] of Object.entries(fx.gardenTiles)) {
        if (v[0] === 'p') plants.push({ i: Number(tile), sp: v[1], s: [['gold', 100, 1, 1]] });
        if (v[0] === 'e') {
          k += 1;
          eggs.push({ egg: v[1], at: now + (k % 3 === 0 ? -60000 : 3600000 * (k % 5)) });
        }
      }
      const s0 = fx.stats;
      const payload = Object.assign({}, st, {
        dailyQuests: dq, gardenPlants: plants, gardenEggs: eggs,
        questStats: { completed: s0.numDailyQuestsCompleted, rerolled: s0.numDailyQuestsRefreshed, easy: s0.numEasyDailyQuestsCompleted, medium: s0.numMediumDailyQuestsCompleted, hard: s0.numHardDailyQuestsCompleted, coins: s0.totalCoinsFromDailyQuests, dust: s0.totalDustFromDailyQuests },
        journal: { crops: 412, pets: 64, cropKinds: 40, petKinds: 28 },
      });
      const shotQuests = async (name, quests) => {
        await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = Object.assign({}, GARDEN_STATUS || {}, ${JSON.stringify(st)}, { at: Date.now(), quests: ${JSON.stringify(quests)} }); showTab('quests'); QX_SIG = ''; renderQuests(); const m = document.querySelector('main'); m.style.scrollBehavior = 'auto'; m.scrollTop = 0; return true; })()`);
        await wait(700);
        fs.writeFileSync(path.join(SHOTS, `quests-${name}.png`), (await panel().capturePage()).toPNG());
        const total = await run("document.querySelector('main').scrollHeight");
        const view = await run("document.querySelector('main').clientHeight");
        if (total > view + 20) {
          await run(`document.querySelector('main').scrollTop = ${total}`);
          await wait(400);
          fs.writeFileSync(path.join(SHOTS, `quests-${name}-down.png`), (await panel().capturePage()).toPNG());
        }
        return run("(() => ({ head: document.getElementById('questHead').innerText.replace(/\\n+/g, ' | '), cards: [...document.querySelectorAll('#questList .qx-card')].map((c) => c.innerText.replace(/\\n+/g, ' | ')), stats: document.getElementById('questStats').innerText.replace(/\\n+/g, ' | ').slice(0, 400), dot: !document.getElementById('questNavDot').hidden }))()");
      };
      await wait(4500);
      await run("(() => { const sk = document.querySelector('[data-wgo=\"skip\"]'); if (sk) sk.click(); return true; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      const v1 = T.questsView(payload);
      out.today = await shotQuests('today', v1);
      // Both left done: ready to claim, the bonus too.
      const dq2 = JSON.parse(JSON.stringify(dq));
      dq2.quests[1].progress = 15; dq2.quests[1].completedAt = now;
      dq2.quests[2].progress = 10; dq2.quests[2].completedAt = now;
      out.ready = await shotQuests('ready', T.questsView(Object.assign({}, payload, { dailyQuests: dq2 })));
      // All claimed.
      const dq3 = JSON.parse(JSON.stringify(dq2));
      dq3.quests.forEach((x) => { x.claimedAt = now; });
      dq3.bonusClaimedAt = now;
      out.done = await shotQuests('done', T.questsView(Object.assign({}, payload, { dailyQuests: dq3 })));
      // Before the game has quests.
      out.none = await shotQuests('none', T.questsView(Object.assign({}, payload, { dailyQuests: null })));
      // The reminder: an hour before the reset (main's own check).
      out.remindSwitch = await run("document.getElementById('questRemindOn').getAttribute('aria-checked')");
      // Narrow panel.
      await shotQuests('today2', v1);
      const realW = await run('innerWidth');
      panel().setZoomFactor(realW / 320);
      await wait(600);
      await run("(() => { QX_SIG = ''; renderQuests(); document.querySelector('main').scrollTop = 0; return true; })()");
      await wait(400);
      fs.writeFileSync(path.join(SHOTS, 'quests-narrow.png'), (await panel().capturePage()).toPNG());
      out.narrowSpill = await run("[...document.querySelectorAll('#tab-quests *')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'visible' && e.children.length < 30).map((e) => (e.className || e.tagName) + ' ' + (e.scrollWidth - e.clientWidth)).slice(0, 10)");
      out.navSpill = await run("(() => { const n = document.querySelector('nav'); return { over: n.scrollWidth - n.clientWidth }; })()");
      panel().setZoomFactor(1);
    }
    if (MODE === 'haunt') {
      // v0.66.0: the Haunt Quest card, night on the Weather tab, and time to
      // max strength on the owner's pets (16 Oct 2026).
      const T = global.__mgTest;
      const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pets-1016.json'), 'utf8'));
      const today = new Date().toISOString().slice(0, 10);
      const now = Date.now();
      await wait(4500);
      await run("(() => { const sk = document.querySelector('[data-wgo=\"skip\"]'); if (sk) sk.click(); return true; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      const snap = async (name, ms = 600) => {
        await wait(ms);
        fs.writeFileSync(path.join(SHOTS, `haunt-${name}.png`), (await panel().capturePage()).toPNG());
      };
      const sq = (progress, extra) => Object.assign({ dayUTC: today, target: 8, progress, reward: { kind: 'avatarCosmetic', cosmeticFilename: 'Mid_BlackCat.png', alternate: { kind: 'decor', decorId: 'HauntLamp', quantity: 1 } }, completedAt: null, claimedAt: null }, extra || {});
      const fq = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'quests-sample.json'), 'utf8'));
      const dq = JSON.parse(JSON.stringify(fq.dailyQuests));
      dq.dayUTC = today;
      const showQ = async (name, payload) => {
        const v = T.questsView(Object.assign({ pets: [], crops: [] }, payload));
        await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = Object.assign({}, GARDEN_STATUS || {}, ${JSON.stringify(st)}, { at: Date.now(), quests: ${JSON.stringify(v)} }); showTab('quests'); QX_SIG = ''; renderQuests(); const m = document.querySelector('main'); m.style.scrollBehavior = 'auto'; m.scrollTop = 0; const c = document.querySelector('.qx-haunt'); if (c) c.scrollIntoView({ block: 'center' }); return true; })()`);
        await snap(name);
        return run("(() => { const c = document.querySelector('.qx-haunt'); return { card: c ? c.innerText.replace(/\\n+/g, ' | ') : null, dot: !document.getElementById('questNavDot').hidden, stats: document.getElementById('questStats').innerText.replace(/\\n+/g, ' | ').slice(0, 300) }; })()");
      };
      T.resetNight();
      out.questsOpen = await showQ('quest', { dailyQuests: dq, spookyQuest: sq(3), questStats: { completed: 40, rerolled: 3, easy: 14, medium: 14, hard: 12, coins: 9e9, dust: 12000, haunts: 2 } });
      T.noteNight({ shops: { spooky: { open: true } } }, now - 4 * 60000);
      out.questsNight = await showQ('quest-night', { dailyQuests: dq, spookyQuest: sq(6) });
      out.questsReady = await showQ('quest-ready', { dailyQuests: dq, spookyQuest: sq(8, { completedAt: now }) });
      out.questsOnly = await showQ('quest-only', { dailyQuests: null, spookyQuest: sq(1) });
      // Weather tab: night now, then the next one.
      const showW = async (name, night) => {
        // Straight after drawing: the stand-in's feed sends its own status
        // every few seconds (with its Spooky Shop open).
        const got = await run(`(() => { STATUS = Object.assign({}, STATUS || {}, { night: ${JSON.stringify(night)}, hauntEnds: ${Date.parse('2026-11-10T00:00:00Z')} }); showTab('weather'); renderWeatherSchedule(); renderStatus(); document.querySelector('main').scrollTop = 0; const n = document.querySelector('.wx-night'); return { line: n ? n.innerText.replace(/\\s+/g, ' ') : null, tiles: document.getElementById('statusWeather').innerText.replace(/\\s+/g, ' ') }; })()`);
        await snap(name, 120);
        return got;
      };
      out.weatherOn = await showW('weather-on', T.nightInfo(now));
      // (The stand-in's shop feed keeps the Spooky Shop open, so the next
      // night is given here as main works it out after a night ends.)
      out.weatherNext = await showW('weather-next', { on: false, known: true, predicted: true, next: now + 3 * 3600000 + 20 * 60000, endsAt: now + 3 * 3600000 + 50 * 60000 });
      out.weatherUnknown = await showW('weather-unknown', { on: false, known: false });
      T.resetNight();
      // Pets tab: time to max strength on his 55 pets.
      const growth = require('../pet-growth').view(fx.allPets, fx.allPets.filter((p) => fx.active.includes(p.id)), 'clear');
      await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = Object.assign({}, GARDEN_STATUS || {}, ${JSON.stringify(st)}, { at: Date.now(), growth: ${JSON.stringify(growth)}, allPets: ${JSON.stringify(fx.allPets)} }); showTab('pets'); PG_SIG = ''; renderPetGrowth(GARDEN_STATUS); const h = document.querySelector('h2[data-fold="pets/pet-growth"]'); if (h) h.scrollIntoView({ block: 'start' }); return true; })()`);
      await snap('growth');
      out.growth = await run("(() => { const b = document.getElementById('petGrowth'); return { intro: b.querySelector('.pg-intro').innerText, rows: [...b.querySelectorAll('.pg-row')].slice(0, 4).map((r) => r.innerText.replace(/\\s+/g, ' ')), foot: b.querySelector('.pg-foot').innerText, fold: document.querySelector('h2[data-fold=\"pets/pet-growth\"]').innerText }; })()");
      const realW = await run('innerWidth');
      panel().setZoomFactor(realW / 320);
      await wait(600);
      await run("(() => { PG_SIG = ''; renderPetGrowth(GARDEN_STATUS); const h = document.querySelector('h2[data-fold=\"pets/pet-growth\"]'); if (h) h.scrollIntoView({ block: 'start' }); return true; })()");
      await snap('growth-narrow');
      out.narrowSpill = await run("[...document.querySelectorAll('#petGrowth *')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'visible' && e.children.length < 30).map((e) => (e.className || e.tagName) + ' ' + (e.scrollWidth - e.clientWidth)).slice(0, 10)");
      panel().setZoomFactor(1);
    }
    if (MODE === 'wrapsweep') {
      // v0.67.1: text caught between lines. At five panel widths, every tab
      // and view with every fold open: (1) short labels (a name, a button, a
      // tile's caption) broken onto two lines; (2) live numbers (times,
      // percentages, counts) that would push their line onto a new one as
      // they change (each number is tried one digit longer and one shorter).
      const sample = JSON.parse(fs.readFileSync(process.env.MG_SAMPLE || path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      st.petRank = require('../pet-rank').rank(st.allPets || [], {});
      st.at = Date.now();
      st.connected = true;
      await wait(4500);
      await run("(() => { const sk = document.querySelector('[data-wgo=\"skip\"]'); if (sk) sk.click(); const b = document.getElementById('shareAskNo'); if (b) b.click(); return true; })()");
      await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(st)}; renderGarden(); return true; })()`);
      await wait(800);
      const tabs = await run("[...document.querySelectorAll('section[id^=tab-]')].map((s) => s.id.slice(4))");
      const pages = [];
      for (const tab of tabs) for (const v of tab === 'garden' ? ['now', 'mutations', 'map', 'harvest', 'progress'] : [null]) pages.push([tab, v]);
      const realW = await run('innerWidth');
      const found = {};
      for (const width of [320, 372, 420, 456, 520]) {
        panel().setZoomFactor(realW / width);
        await wait(700);
        for (const [tab, view] of pages) {
          await run(`(() => { showTab('${tab}'); ${view ? `showGardenView('${view}', false);` : ''} if ('${tab}' === 'scripts') openExtras(null); for (const h of document.querySelectorAll('#tab-${tab} h2.folded')) h.click(); for (const d of document.querySelectorAll('#tab-${tab} details')) d.open = true; return true; })()`);
          await wait(450);
          const f = await run(`(() => {
            const roots = [document.getElementById('tab-${tab}'), document.querySelector('header')];
            const out = [];
            // Lines of text as seen: boxes that overlap vertically are one line
            // (a badge sits a little higher or lower than the words around it).
            const lines = (el) => {
              const r = document.createRange();
              r.selectNodeContents(el);
              const rows = [];
              for (const q of r.getClientRects()) {
                if (q.width <= 1 || q.height <= 1) continue;
                const hit = rows.find((w) => Math.min(w.b, q.bottom) - Math.max(w.t, q.top) > Math.min(w.b - w.t, q.height) * 0.4);
                if (hit) { hit.t = Math.min(hit.t, q.top); hit.b = Math.max(hit.b, q.bottom); } else rows.push({ t: q.top, b: q.bottom });
              }
              // Text clamped to N lines shows N at most (the rest is "…").
              let e = el;
              while (e && e !== document.body) {
                const c = getComputedStyle(e).webkitLineClamp;
                if (c && c !== 'none') return Math.min(rows.length, Number(c) || rows.length);
                if (getComputedStyle(e).display !== 'inline') break;
                e = e.parentElement;
              }
              return rows.length;
            };
            const where = (el) => {
              const bits = [];
              for (let e = el; e && bits.length < 3 && !/^tab-/.test(e.id || ''); e = e.parentElement) {
                bits.unshift(e.id ? '#' + e.id : (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/)[0] : e.tagName.toLowerCase()));
              }
              return bits.join(' ');
            };
            const leaf = (el) => ![...el.children].some((c) => { const d = getComputedStyle(c).display; return d === 'block' || d === 'flex' || d === 'grid' || d === 'list-item' || d === 'table'; });
            const LIVE = /\\d+\\s?(min|hr|h|m|s|%|days?|hours?)\\b|\\d+:\\d\\d|\\d[\\d.,]*\\s?[KMBT]\\b/;
            for (const root of roots) {
              if (!root) continue;
              for (const el of root.querySelectorAll('*')) {
                if (!el.offsetParent || el.closest('svg, select, option, .spot-map, details:not([open]) > :not(summary)')) continue;
                if (!leaf(el)) continue;
                const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
                if (!t) continue;
                const n = lines(el);
                const words = t.split(' ').length;
                // (1) a short label broken across lines
                if (n >= 2 && words >= 2 && words <= 5 && t.length <= 34) out.push({ kind: 'label breaks', text: t, where: where(el) });
                // (2) a live number that would move the line
                if (t.length <= 140 && LIVE.test(t)) {
                  const block = (() => { let e = el; while (e && getComputedStyle(e).display === 'inline') e = e.parentElement; return e || el; })();
                  const before = lines(block);
                  const nodes = [];
                  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                  for (let x; (x = w.nextNode());) if (/\\d/.test(x.textContent)) nodes.push([x, x.textContent]);
                  let moved = '';
                  for (const variant of ['grow', 'shrink']) {
                    for (const [x, orig] of nodes) x.textContent = orig.replace(/\\d+/g, (d) => (variant === 'grow' ? d + '0' : d.length > 1 ? d.slice(1) : d));
                    const after = lines(block);
                    for (const [x, orig] of nodes) x.textContent = orig;
                    if (after !== before) moved = moved || variant;
                  }
                  // A one-line item that would wrap (or a wrapped one that would
                  // unwrap), or any change in a column next to others: that's
                  // the jumping you see. A long paragraph reflowing isn't.
                  const pd = block.parentElement ? getComputedStyle(block.parentElement).display : '';
                  const column = /flex|grid/.test(pd) && block.parentElement.children.length > 1;
                  if (moved && (before <= 2 || column)) out.push({ kind: moved === 'grow' ? 'jumps when the number grows' : 'jumps when the number shrinks', text: t, where: where(block), lines: before });
                }
              }
            }
            return out;
          })()`);
          for (const x of f) {
            const key = `${x.kind}|${x.where}|${x.text.replace(/\d+/g, '#')}`;
            const e = found[key] || (found[key] = { kind: x.kind, where: x.where, text: x.text, tab: view ? `${tab}/${view}` : tab, widths: [] });
            if (!e.widths.includes(width)) e.widths.push(width);
          }
        }
      }
      panel().setZoomFactor(1);
      out.wraps = Object.values(found).sort((a, b) => a.tab.localeCompare(b.tab) || a.kind.localeCompare(b.kind));
    }
    if (MODE === 'wrapshots') {
      // v0.67.1: the spots the line-break sweep fixed, at 372 wide (a usual
      // panel) on the owner's sample.
      const sample = JSON.parse(fs.readFileSync(process.env.MG_SAMPLE || path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      st.petRank = require('../pet-rank').rank(st.allPets || [], {});
      st.at = Date.now();
      st.connected = true;
      await wait(4500);
      await run("(() => { const sk = document.querySelector('[data-wgo=\"skip\"]'); if (sk) sk.click(); const b = document.getElementById('shareAskNo'); if (b) b.click(); return true; })()");
      await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(st)}; renderGarden(); return true; })()`);
      fs.mkdirSync(SHOTS, { recursive: true });
      const realW = await run('innerWidth');
      panel().setZoomFactor(realW / 372);
      await wait(800);
      const show = async (tab, view, sel, name) => {
        await run(`(() => { showTab('${tab}'); ${view ? `showGardenView('${view}', false);` : ''} for (const h of document.querySelectorAll('#tab-${tab} h2.folded')) h.click(); const e = document.querySelector('${sel}'); if (e) e.scrollIntoView({ block: 'center' }); return Boolean(e); })()`);
        await wait(500);
        fs.writeFileSync(path.join(SHOTS, `wrap-${name}.png`), (await panel().capturePage()).toPNG());
      };
      await show('pets', null, '#petFood', 'food');
      await show('pets', null, '#petGrowth', 'growth');
      await show('garden', 'now', '#cropStats', 'garden-now');
      await show('garden', 'harvest', '#harvestRule', 'harvest');
      await show('garden', 'mutations', '.mut-next', 'mutations');
      await show('garden', 'progress', '#lifeStats', 'progress');
      await show('quests', null, '#questStats', 'quests');
      await show('alerts', null, '.vcards', 'voices');
      await show('money', null, '#moneyGrowth', 'money');
      panel().setZoomFactor(1);
    }
    if (MODE === 'home') {
      // v0.68.0: the Home summary on the owner's sample, at a usual and a
      // narrow width, with and without the event theme; then the toggle:
      // the tab you're on tapped again goes Home, the title too.
      const sample = JSON.parse(fs.readFileSync(process.env.MG_SAMPLE || path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      st.at = Date.now();
      st.connected = true;
      st.foundSelf = true;
      // A pet with nothing it eats, so Needs you has a row to show.
      if (st.troughTimer) {
        st.troughTimer.emptyAt = Date.now() + 3.2 * 3600000;
        st.troughTimer.emptyIn = 3.2 * 3600;
        st.troughTimer.starving = process.env.MG_CALM ? [] : [{ name: 'Fire Horse', species: 'FireHorse', secondsLeft: 2700 }];
      }
      if (st.quests) st.quests.resetAt = Date.now() + 5.5 * 3600000;
      await wait(4500);
      await run("(() => { const sk = document.querySelector('[data-wgo=\"skip\"]'); if (sk) sk.click(); return true; })()");
      // The room-sharing question comes right after the setup closes.
      for (let i = 0; i < 12; i += 1) {
        if (await run("(() => { const b = document.getElementById('shareAskNo'); if (b) b.click(); return Boolean(b); })()")) break;
        await wait(300);
      }
      const gv = (st.crops || []).find((c) => /garden/i.test(c.name));
      const nw = (st.wallet ? st.wallet.coins : 0) + (gv ? gv.value || 0 : 0);
      await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(st)}; BUDGET = Object.assign({}, BUDGET, { netWorth: ${nw}, growth: { week: { change: ${nw * 0.042}, pct: 0.042 } } }); renderGarden(); return true; })()`);
      // v0.69.0: the owner's case: Thunder Wolf next, Rainbow 3 away, Thunder Eggs locked.
      if (!process.env.MG_CALM) {
        await run(`(async () => {
          const thr = (type, src, t) => (LUCK.groups[type].find((g) => g.source === src).rows.find((r) => r.target === t) || {}).threshold;
          await window.app.luckSet('egg:ThunderEgg:ThunderWolf', thr('egg', 'ThunderEgg', 'ThunderWolf') - 1);
          await window.app.luckSet('egg:ThunderEgg:rainbow', thr('egg', 'ThunderEgg', 'rainbow') - 3);
          LUCK = await window.app.eggLockSet('ThunderEgg', true);
          renderHome();
          return true;
        })()`);
        await wait(600);
        out.homeCountdown = await run("true");
      }
      fs.mkdirSync(SHOTS, { recursive: true });
      const realW = await run('innerWidth');
      out.home = {};
      for (const [tag, w, theme] of [['plain-372', 372, false], ['spooky-372', 372, true], ['plain-320', 320, false]]) {
        panel().setZoomFactor(realW / w);
        await run(`(() => { window.__holdTheme = true; applyTheme(${theme ? "{ id: 'spooky', event: 'Haunt Event', emoji: '🎃', ends: Date.parse('2026-11-10T00:00:00Z'), night: false }" : 'null'}); renderHello(); showTab('home'); document.querySelector('main').scrollTop = 0; return true; })()`);
        await wait(700);
        out.home[tag] = await run(`(() => { const m = document.querySelector('main'); const box = document.getElementById('homeBox'); const over = [...box.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'hidden' && !/ellipsis/.test(getComputedStyle(e).textOverflow)).map((e) => e.className).slice(0, 6); const cut = [...box.querySelectorAll('.s, .hh-hi')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()); return { sh: m.scrollHeight, ch: m.clientHeight, text: box.innerText.replace(/\\n+/g, ' | ').slice(0, 900), over, cut, chev: (() => { const c = document.querySelector('#homeBox .hm-chev'); return c ? getComputedStyle(c).display + ' ' + Math.round(c.getBoundingClientRect().width) : null; })(), iw: innerWidth, mq: matchMedia('(max-width: 360px)').matches, navSel: [...document.querySelectorAll('nav [aria-selected="true"]')].map((b) => b.dataset.tab) }; })()`);
        const screens = Math.min(3, Math.ceil(out.home[tag].sh / Math.max(1, out.home[tag].ch - 60)));
        for (let i = 0; i < screens; i += 1) {
          await run(`document.querySelector('main').scrollTop = ${i} * (document.querySelector('main').clientHeight - 60)`);
          await wait(300);
          fs.writeFileSync(path.join(SHOTS, `home-${tag}-${i}.png`), (await panel().capturePage()).toPNG());
        }
      }
      panel().setZoomFactor(1);
      // The toggle.
      out.home.toggle = await run(`(async () => {
        const tap = (t) => document.querySelector('nav [data-tab="' + t + '"]').click();
        const res = {};
        tap('pets'); res.pets = currentTab();
        tap('pets'); res.again = currentTab(); res.noneSelected = !document.querySelector('nav [aria-selected="true"]');
        tap('garden'); res.garden = currentTab();
        document.getElementById('homeLink').click(); res.title = currentTab();
        // A Coming up row opens its tab.
        const row = document.querySelector('#homeBox [data-home-go="quests"]'); if (row) row.click(); res.row = currentTab();
        showTab('home');
        const ph = document.querySelector('#homeBox [data-home-go="pets/pet-growth"]'); if (ph) ph.click(); res.pets = currentTab() + '/' + document.getElementById('tab-pets').dataset.view;
        showTab('home');
        return res;
      })()`);
      // The egg locks on the Luck tab (v0.69.0), pointed at like the game's card does.
      panel().setZoomFactor(realW / 372);
      await run("focusEggLock('ThunderEgg')");
      await wait(900);
      fs.writeFileSync(path.join(SHOTS, 'home-egglocks.png'), (await panel().capturePage()).toPNG());
      panel().setZoomFactor(1);
    }
    if (MODE === 'salefold') {
      // v0.67.3: the Growth card's one line about full-room prices and best
      // sell pets, folded and open, on the owner's sample.
      const sample = JSON.parse(fs.readFileSync(process.env.MG_SAMPLE || path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      st.at = Date.now();
      st.connected = true;
      await wait(4500);
      await run("(() => { const sk = document.querySelector('[data-wgo=\"skip\"]'); if (sk) sk.click(); const b = document.getElementById('shareAskNo'); if (b) b.click(); return true; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      const realW = await run('innerWidth');
      panel().setZoomFactor(realW / 372);
      out.salefold = {};
      for (const [tag, notOut] of [['out', false], ['missing', true]]) {
        const s2 = JSON.parse(JSON.stringify(st));
        if (s2.idealSell && notOut) Object.assign(s2.idealSell, { allOut: false, notOut: [s2.idealSell.pets[0].species] });
        await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(s2)}; BUDGET = Object.assign({}, BUDGET, { unlocked: true, saleMult: 1.78 }); SALE_OPEN = false; renderBudget(); showTab('money'); const h = document.querySelector('h2[data-fold="money/growth"]'); if (h && h.classList.contains('folded')) h.click(); document.getElementById('moneyGrowth').scrollIntoView({ block: 'start' }); return true; })()`);
        await wait(600);
        out.salefold[tag] = { line: await run("(document.querySelector('#moneyGrowth .gs-sale summary') || {}).innerText || null") };
        await run("(() => { const s = document.querySelector('#moneyGrowth .gs-sale'); if (s) s.scrollIntoView({ block: 'start' }); document.querySelector('main').scrollTop -= 120; return true; })()");
        await wait(300);
        fs.writeFileSync(path.join(SHOTS, `salefold-${tag}-closed.png`), (await panel().capturePage()).toPNG());
        await run("(() => { const s = document.querySelector('#moneyGrowth .gs-sale summary'); if (s) s.click(); return true; })()");
        await wait(500);
        out.salefold[tag].body = await run("(document.querySelector('#moneyGrowth .gs-body') || {}).innerText || null");
        await run("(() => { const s = document.querySelector('#moneyGrowth .gs-sale'); if (s) s.scrollIntoView({ block: 'start' }); document.querySelector('main').scrollTop -= 120; return true; })()");
        await wait(300);
        fs.writeFileSync(path.join(SHOTS, `salefold-${tag}-open.png`), (await panel().capturePage()).toPNG());
      }
      panel().setZoomFactor(1);
    }
    if (MODE === 'petviews') {
      // v0.67.3: the Pets tab's five views at 372 wide on the owner's sample,
      // every screen of each (folds open).
      const sample = JSON.parse(fs.readFileSync(process.env.MG_SAMPLE || path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      st.petRank = require('../pet-rank').rank(st.allPets || [], {}, { stage: st.stage && st.stage.id });
      st.at = Date.now();
      st.connected = true;
      await wait(4500);
      await run("(() => { const sk = document.querySelector('[data-wgo=\"skip\"]'); if (sk) sk.click(); const b = document.getElementById('shareAskNo'); if (b) b.click(); return true; })()");
      await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(st)}; renderGarden(); showTab('pets'); for (const h of document.querySelectorAll('#tab-pets h2.folded')) h.click(); return true; })()`);
      fs.mkdirSync(SHOTS, { recursive: true });
      if (process.env.MG_WHAT) {
        panel().setZoomFactor((await run('innerWidth')) / 372);
        await run("(() => { showPetsView('rank', false); renderPets(); const d = document.getElementById('prWhat'); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } return !!d; })()");
        await wait(700);
        fs.writeFileSync(path.join(SHOTS, 'pr-what-late.png'), (await panel().capturePage()).toPNG());
        out.prStage = await run("(document.querySelector('#prWhat .pr-stage') || {}).innerText || null");
        panel().setZoomFactor(1);
      }
      const realW = await run('innerWidth');
      panel().setZoomFactor(realW / Number(process.env.MG_W || 372));
      await wait(800);
      out.petviews = {};
      for (const v of ['now', 'food', 'teams', 'rank', 'made']) {
        await run(`(() => { showPetsView('${v}', false); renderPets(); document.querySelector('main').scrollTop = 0; return true; })()`);
        await wait(600);
        const info = await run(`(() => { const m = document.querySelector('main'); const sec = document.getElementById('tab-pets'); const shown = [...sec.children].filter((c) => getComputedStyle(c).display !== 'none' && !c.hidden); return { sh: m.scrollHeight, ch: m.clientHeight, heads: shown.filter((c) => c.tagName === 'H2').map((h) => h.innerText.replace(/\\s+/g, ' ')), bar: [...document.querySelectorAll('#petViews [data-pv]')].map((b) => b.getAttribute('aria-selected') + ':' + b.innerText.trim()) }; })()`);
        out.petviews[v] = info;
        const screens = Math.min(4, Math.ceil(info.sh / Math.max(1, info.ch - 60)));
        for (let i = 0; i < screens; i += 1) {
          await run(`document.querySelector('main').scrollTop = ${i} * (document.querySelector('main').clientHeight - 60)`);
          await wait(350);
          fs.writeFileSync(path.join(SHOTS, `petviews-${v}-${i}.png`), (await panel().capturePage()).toPNG());
        }
      }
      panel().setZoomFactor(1);
    }
    if (MODE === 'foodbounce') {
      // v0.67.3: does anything in the Food section change height as its
      // numbers tick? The trough countdown (every second under an hour),
      // each pet's minutes and percent, the "nothing it eats" warnings.
      // Every width a panel can be; any height change is a bounce.
      const sample = JSON.parse(fs.readFileSync(process.env.MG_SAMPLE || path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      st.at = Date.now();
      st.connected = true;
      await wait(4500);
      await run("(() => { const sk = document.querySelector('[data-wgo=\"skip\"]'); if (sk) sk.click(); const b = document.getElementById('shareAskNo'); if (b) b.click(); return true; })()");
      await run(`(() => { window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(st)}; renderGarden(); showTab('pets'); for (const h of document.querySelectorAll('#tab-pets h2.folded')) h.click(); return true; })()`);
      const realW = await run('innerWidth');
      out.foodbounce = {};
      for (const w of [320, 340, 372, 400, 430, 456, 480, 520]) {
        panel().setZoomFactor(realW / w);
        await wait(400);
        out.foodbounce[w] = await run(`(async () => {
          const base = JSON.parse(JSON.stringify(GARDEN_STATUS));
          const secs = [5, 9, 41, 59, 61, 119, 600, 611, 1199, 1800, 3540, 3599, 3601, 3661, 4271, 7199, 11442, 36000];
          const pcts = [0.01, 0.09, 0.1, 0.5, 0.99, 1];
          const res = { trough: {}, food: {}, warn: {} };
          const area = (id) => { const e = document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().height) : null; };
          const lines = (id) => { const e = document.getElementById(id); return e ? e.innerText.replace(/\\n+/g, ' | ').slice(0, 220) : ''; };
          // 1. The trough countdown.
          for (const sec of secs) {
            GARDEN_STATUS.troughTimer = Object.assign({}, base.troughTimer, { items: 8, emptyIn: sec, emptyAt: Date.now() + sec * 1000, starving: [] });
            TROUGH_SIG = ''; renderTrough(GARDEN_STATUS);
            const el = document.getElementById('ttLeft'); if (el) el.textContent = troughLeft(GARDEN_STATUS.troughTimer);
            await new Promise((r) => requestAnimationFrame(r));
            const h = area('troughTimer');
            (res.trough[h] = res.trough[h] || []).push(sec + ': ' + lines('troughTimer').slice(0, 90));
          }
          // 2. A pet with nothing it eats, its minutes ticking.
          for (const sec of secs) {
            GARDEN_STATUS.troughTimer = Object.assign({}, base.troughTimer, { items: 8, emptyIn: 11442, emptyAt: Date.now() + 11442000, starving: [{ name: 'Fire Horse', species: 'FireHorse', secondsLeft: sec }, { name: 'Peacock', species: 'Peacock', secondsLeft: sec * 1.3 }] });
            TROUGH_SIG = ''; renderTrough(GARDEN_STATUS);
            await new Promise((r) => requestAnimationFrame(r));
            const h = area('troughTimer');
            (res.warn[h] = res.warn[h] || []).push(sec + ': ' + lines('troughTimer').slice(0, 160));
          }
          GARDEN_STATUS.troughTimer = base.troughTimer; TROUGH_SIG = ''; renderTrough(GARDEN_STATUS);
          // 3. The food list: each pet's percent and minutes.
          for (const sec of secs) for (const pct of pcts) {
            GARDEN_STATUS.pets = base.pets.map((p, i) => Object.assign({}, p, { pct, secondsLeft: sec + i * 37, needsFood: pct <= 0.1 }));
            renderPetFood(GARDEN_STATUS, false);
            await new Promise((r) => requestAnimationFrame(r));
            const h = area('petFood');
            (res.food[h] = res.food[h] || []).push(sec + 's ' + pct);
          }
          const detail = {};
          for (const pct of [0.5, 0.01]) {
            GARDEN_STATUS.pets = base.pets.map((p, i) => Object.assign({}, p, { pct, secondsLeft: 600 + i * 37, needsFood: pct <= 0.1 }));
            renderPetFood(GARDEN_STATUS, false);
            await new Promise((r) => requestAnimationFrame(r));
            detail[pct] = [...document.querySelectorAll('#petFood .food-row')].map((r) => ({ h: Math.round(r.getBoundingClientRect().height), parts: [...r.querySelectorAll('.food-top, .food-name, .food-state, .food-sub')].map((x) => x.className + ':' + Math.round(x.getBoundingClientRect().height) + ':' + Math.round(x.getBoundingClientRect().width)), text: r.innerText.replace(/\\n/g, ' | ') }));
          }
          res.detail = detail;
          GARDEN_STATUS = base; renderPetFood(GARDEN_STATUS, false);
          const sum = (o) => Object.fromEntries(Object.entries(o).map(([h, v]) => [h, v.length > 3 ? v.slice(0, 3).concat('… +' + (v.length - 3)) : v]));
          return { trough: sum(res.trough), warn: sum(res.warn), food: sum(res.food), detail: res.detail };
        })()`);
        if (w === 372) {
          await run("document.getElementById('troughTimer').scrollIntoView({ block: 'start' })");
          await wait(300);
          fs.mkdirSync(SHOTS, { recursive: true });
          fs.writeFileSync(path.join(SHOTS, 'foodbounce-372.png'), (await panel().capturePage()).toPNG());
        }
      }
      panel().setZoomFactor(1);
    }
    if (MODE === 'burn') {
      // v0.67.3: the expected burn rate line on the money forecast (two
      // weeks of spending), one that keeps growing and one that runs out,
      // and the note while it's still collecting. Built from the live
      // forecast: the buy-everything line is what comes in less its cost a
      // day, so the burn line is that line with a different cost a day.
      await wait(2500);
      const base = await run('JSON.parse(JSON.stringify(BUDGET.foresight))');
      const E = base.everything;
      // The stand-in grows next to nothing: give it a usual 4B a day coming
      // in (every line rises by it), so the picture reads like a real garden.
      const inPerDay = 4e9;
      const lift = (line) => (line || []).map(([t, v]) => [t, v + inPerDay * t]);
      base.line = lift(base.line);
      E.line = lift(E.line);
      E.runsOut = null;
      const burnOf = (per) => {
        const line = E.line.map(([t, v]) => [t, v + (E.perDay - per) * t]);
        let out = null;
        for (let i = 1; i < line.length; i += 1) if (line[i][1] < 0 && line[i - 1][1] >= 0) { out = line[i - 1][0] + (line[i][0] - line[i - 1][0]) * (line[i - 1][1] / (line[i - 1][1] - line[i][1])); break; }
        return { ok: true, days: 16.2, need: 14, perDay: per, line, runsOut: out != null ? { t: out, at: Date.now() + out * 86400000 } : null };
      };
      out.burn = { inPerDay };
      out.burn.slow = await moneyScenario('burn-slow', Object.assign({}, base, { burn: burnOf(inPerDay * 0.7) }));
      out.burn.slow.key = await run("document.querySelector('#moneyForesight .mc-key').innerText.replace(/\\s+/g, ' ')");
      out.burn.slow.hover = await hoverAt('#moneyForesight svg.money-chart', 0.7, 0.3, 'burn');
      const avail = base.available || 1e9;
      out.burn.fast = await moneyScenario('burn-fast', Object.assign({}, base, { burn: burnOf(inPerDay + avail / Math.max(1, (base.end || 5) * 0.6)) }));
      out.burn.fast.note = await run("[...document.querySelectorAll('#moneyForesight .mc-note')].map((n) => n.innerText)");
      out.burn.waiting = await moneyScenario('burn-waiting', Object.assign({}, base, { burn: { ok: false, days: 6.4, need: 14 } }), 'MC_HOW_OPEN = true;');
      out.burn.waiting.how = await run("(document.querySelector('#moneyForesight .mc-how') || {}).innerText || ''");
      out.burn.noBar = await run("!document.querySelector('.ev-box') && !/of the way to affording/.test(document.getElementById('moneyForesight').innerText)");
    }
    if (MODE === 'gmpick') {
      // v0.67.2: the garden map's view picker stays inside its card at every
      // panel width, and the keep-it-on-the-game switch below it.
      await wait(4500);
      await run("(() => { const sk = document.querySelector('[data-wgo=\"skip\"]'); if (sk) sk.click(); const b = document.getElementById('shareAskNo'); if (b) b.click(); return true; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      const realW = await run('innerWidth');
      out.gmpick = {};
      for (const w of [320, 372, 440, 520]) {
        for (const v of ['spots', 'value']) {
          panel().setZoomFactor(realW / w);
          await wait(500);
          out.gmpick[`${w}-${v}`] = await run(`(() => { showTab('garden'); showGardenView('map', false); const h = document.querySelector('h2[data-gview="map"]'); if (h && h.classList.contains('folded')) h.click(); const b = document.querySelector('#gmView [data-val="${v}"]'); if (b) b.click(); const g = document.getElementById('gmView'); g.scrollIntoView({ block: 'center' }); const card = g.closest('.card').getBoundingClientRect(); const r = g.getBoundingClientRect(); const btns = [...g.children].map((x) => { const q = x.getBoundingClientRect(); return { v: x.dataset.val, w: Math.round(q.width), cut: x.scrollWidth > x.clientWidth + 1, label: getComputedStyle(x.querySelector('.gm-l')).position !== 'absolute' }; }); return { inside: r.left >= card.left - 0.5 && r.right <= card.right + 0.5, pickerW: Math.round(r.width), cardW: Math.round(card.width), btns, keep: !!document.getElementById('alwaysMapOn') }; })()`);
          await wait(400);
          fs.writeFileSync(path.join(SHOTS, `gmpick-${w}-${v}.png`), (await panel().capturePage()).toPNG());
        }
      }
      panel().setZoomFactor(1);
    }
    if (MODE === 'look067') {
      // v0.67.0: the clean look and the event theme, wide and narrow.
      await wait(4500);
      await run("(() => { const sk = document.querySelector('[data-wgo=\"skip\"]'); if (sk) sk.click(); const b = document.getElementById('shareAskNo'); if (b) b.click(); return true; })()");
      fs.mkdirSync(SHOTS, { recursive: true });
      const snap = async (name, ms = 500) => {
        await wait(ms);
        fs.writeFileSync(path.join(SHOTS, `look067-${name}.png`), (await panel().capturePage()).toPNG());
      };
      const theme = async (t, night) => run(`(() => { STATUS = Object.assign({}, STATUS || {}, { theme: ${JSON.stringify(t)}, night: ${JSON.stringify(night)} }); window.__holdTheme = true; applyTheme(STATUS.theme); renderHello(); renderStatus(); return document.documentElement.dataset.theme || ''; })()`);
      const dayNight = { on: false, known: true, next: Date.now() + 3 * 3600000, endsAt: Date.now() + 3.5 * 3600000, phase: 'day', darkness: 0, bonus: 0 };
      const nightNow = { on: true, known: true, since: Date.now() - 12 * 60000, endsAt: Date.now() + 18 * 60000, next: Date.now() + 10 * 3600000, phase: 'midnight', darkness: 1, bonus: 20 };
      const spooky = { id: 'spooky', event: 'Haunt Event', emoji: '🎃', ends: Date.parse('2026-11-10T00:00:00Z'), night: false };
      const shoot = async (tag) => {
        await run("(() => { showTab('alerts'); document.querySelector('main').scrollTop = 0; return true; })()");
        await snap(`${tag}-alerts`);
        await run("(() => { showTab('scripts'); openExtras('scripts/panel'); return true; })()");
        await snap(`${tag}-panel`);
        await run("(() => { openExtras(null); showTab('weather'); document.querySelector('main').scrollTop = 0; return true; })()");
        await snap(`${tag}-weather`);
        await run("(() => { showTab('garden'); showGardenView('now', false); document.querySelector('main').scrollTop = 0; return true; })()");
        await snap(`${tag}-garden`);
      };
      out.plain = await theme(null, dayNight);
      await shoot('plain');
      out.day = await theme(spooky, dayNight);
      await shoot('spooky');
      out.night = await theme(Object.assign({}, spooky, { night: true, darkness: 1 }), nightNow);
      await shoot('night');
      out.pill = await run("document.getElementById('hello').innerText");
      // The bats, caught mid-flight.
      await run("(() => { showTab('alerts'); document.querySelectorAll('.fx-bat').forEach((b, i) => { b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; b.style.animationDelay = (i ? '-3.1s' : '-2.4s'); b.style.animationPlayState = 'paused'; }); return true; })()");
      await snap('bats', 300);
      out.bats = await run("(() => ({ reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, bats: [...document.querySelectorAll('.fx-bat')].map((e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return { display: c.display, opacity: c.opacity, transform: c.transform, x: Math.round(r.x), y: Math.round(r.y) }; }) }))()");
      await run("(() => { document.querySelectorAll('.fx-bat').forEach((b) => { b.style.animationDelay = ''; b.style.animationPlayState = ''; }); return true; })()");
      // A toast and a modal, in the clean look.
      await theme(null, dayNight);
      await run("(() => { showTab('alerts'); toast('🎃 Event themes on'); return true; })()");
      await snap('toast', 300);
      await run("(() => { askShareOnLaunch(); return true; })()");
      await snap('modal', 400);
      await run("(() => { const b = document.getElementById('shareAskNo'); if (b) b.click(); return true; })()");
      // Narrow (320 wide).
      const realW = await run('innerWidth');
      panel().setZoomFactor(realW / 320);
      await wait(600);
      await shoot('narrow');
      await theme(Object.assign({}, spooky, { night: true, darkness: 1 }), nightNow);
      await shoot('narrow-night');
      out.navSpill = await run("(() => { const n = document.querySelector('nav'); return n.scrollWidth - n.clientWidth; })()");
      out.headSpill = await run("(() => { const h = document.querySelector('.head-row'); return h.scrollWidth - h.clientWidth; })()");
      panel().setZoomFactor(1);
      out.switchThemes = await run("(() => { const e = document.getElementById('eventThemesOn'); return e ? e.getAttribute('aria-checked') : null; })()");
    }
    if (MODE === 'gviews' || MODE === 'mutplants') {
      // v0.64.0: the Garden tab's views, and leaving plants out of
      // Mutations over time, on the owner's sample.
      const pmods = require('../plant-muts');
      const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'status-sample.json'), 'utf8'));
      const st = sample.lastStatus;
      st.petRank = require('../pet-rank').rank(st.allPets || [], {});
      // Plants as the game page sends them, made from the sample's tiles:
      // Thunder Celestials always Thunderstruck (never harvested), the rest a mix.
      const MIX = ['', 'wet', 'frozen,gold', 'thunderstruck', 'amberbound,rainbow', 'dawnlit', 'chilled,gold', 'thundercharged,amberlit'];
      const plants = [];
      let k = 0;
      for (const [tile, v] of Object.entries(st.gardenTiles || {})) {
        if (!Array.isArray(v) || v[0] !== 'p') continue;
        const sp = v[1];
        const many = /Celestial|Ube|Sunflower/.test(sp) ? 3 : 1;
        const s = [];
        for (let j = 0; j < many; j += 1) {
          k += 1;
          s.push([/ThunderCelestial/.test(sp) ? 'thunderstruck,amberbound' : MIX[k % MIX.length], 1, 1, 1]);
        }
        plants.push({ i: Number(tile), sp, s });
      }
      const rows = pmods.plantMutRows(plants);
      const names = {};
      for (const sp of Object.keys(rows)) names[sp] = sp.replace(/([a-z])([A-Z])/g, '$1 $2');
      // Two days of readings: the first day from before plant-by-plant
      // tracking (no rows), then a day with them; Thunder Celestials grow in.
      const EVERY = 600000;
      const now = Date.now();
      const hist = [];
      const sum = (r) => {
        const o = { n: 0, h: 0, l: 0, c: 0, w: 0, ch: 0, f: 0, th: 0, d: 0, a: 0, g: 0, r: 0 };
        const K = Object.keys(o);
        for (const row of Object.values(r)) K.forEach((key, i) => { o[key] += row[i] || 0; });
        return o;
      };
      for (let i = 48 * 6; i >= 1; i -= 1) {
        const t = now - i * EVERY;
        const r = JSON.parse(JSON.stringify(rows));
        const f = 1 - i / (48 * 6);
        for (const sp of Object.keys(r)) if (!/ThunderCelestial/.test(sp)) r[sp] = r[sp].map((x, j) => (j === 0 ? x : Math.round(x * (0.4 + 0.6 * f))));
        const p = Object.assign({ t }, sum(r));
        pmods.pushReading(hist, p, i > 24 * 6 ? null : r, EVERY, 1008);
      }
      st.plantMuts = rows;
      st.plantNames = names;
      st.at = Date.now();
      await wait(4500);
      await run(`(() => { const sk = document.querySelector('[data-wgo="skip"]'); if (sk) sk.click(); window.__holdStatus = true; GARDEN_STATUS = ${JSON.stringify(st)}; GARDEN_STATS = Object.assign({}, GARDEN_STATS, { mutHistory: ${JSON.stringify(hist)} }); renderGarden(); showTab('garden'); return true; })()`);
      fs.mkdirSync(SHOTS, { recursive: true });
      if (MODE === 'gviews') {
        out.gviews = {};
        for (const v of ['now', 'mutations', 'map', 'harvest', 'progress']) {
          await run(`(() => { showGardenView('${v}', false); for (const h of document.querySelectorAll('#tab-garden > h2.fold.folded')) applyFold(h, false); const m = document.querySelector('main'); m.style.scrollBehavior = 'auto'; m.scrollTop = 0; return true; })()`);
          await wait(900);
          fs.writeFileSync(path.join(SHOTS, `gview-${v}.png`), (await panel().capturePage()).toPNG());
          out.gviews[v] = await run(`(() => {
            const sec = document.getElementById('tab-garden');
            const shown = [...sec.children].filter((e) => getComputedStyle(e).display !== 'none' && e.offsetHeight > 0);
            const heads = shown.filter((e) => e.tagName === 'H2').map((e) => e.textContent.trim().slice(0, 40));
            const m = document.querySelector('main');
            const sel = sec.querySelector('[data-gv][aria-selected="true"]');
            return { heads, height: m.scrollHeight, view: m.clientHeight, selected: sel && sel.dataset.gv };
          })()`);
          // Scrolled down: the switcher stays at the top.
          const sticky = await run(`(() => { const m = document.querySelector('main'); m.scrollTop = 600; const bar = document.getElementById('gardenViews').getBoundingClientRect(); return { barTop: Math.round(bar.top - m.getBoundingClientRect().top), scrolled: m.scrollTop }; })()`);
          out.gviews[v].sticky = sticky;
          if (sticky.scrolled > 0) {
            await wait(400);
            fs.writeFileSync(path.join(SHOTS, `gview-${v}-down.png`), (await panel().capturePage()).toPNG());
          }
        }
        // Jumps into the tab open the right view.
        out.jumps = await run(`(() => {
          const o = {};
          showTab('money'); showGardenView('now', false);
          const strip = document.getElementById('stageStrip');
          const keep = strip.innerHTML;
          strip.innerHTML = '<button class="ss-item" data-go="garden/weather-mutations"><b>x</b></button><button class="ss-item" data-go="garden/garden-map"><b>y</b></button>';
          strip.querySelector('[data-go="garden/weather-mutations"]').click();
          o.stageColor = document.getElementById('tab-garden').dataset.view;
          strip.querySelector('[data-go="garden/garden-map"]').click();
          o.stageMap = document.getElementById('tab-garden').dataset.view;
          strip.innerHTML = keep;
          showGardenView('now', false);
          const h = document.querySelector('h2[data-fold="garden/harvest-lock"]');
          revealSection(h);
          o.readyLink = document.getElementById('tab-garden').dataset.view;
          o.saved = S.ui.gardenView;
          return o;
        })()`);
        // A narrow panel (320 px): nothing spills out of the switcher.
        const realW = await run('innerWidth');
        panel().setZoomFactor(realW / 320);
        await wait(600);
        out.narrow = { width: await run('innerWidth') };
        for (const v of ['now', 'mutations', 'progress']) {
          await run(`(() => { showGardenView('${v}', false); document.querySelector('main').scrollTop = 0; return true; })()`);
          await wait(300);
          out.narrow[v] = await run(`(() => { const bar = document.getElementById('gardenViews'); const bs = [...bar.querySelectorAll('[data-gv]')]; return { barOver: bar.scrollWidth - bar.clientWidth, spill: bs.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.dataset.gv), widths: bs.map((b) => Math.round(b.getBoundingClientRect().width)) }; })()`);
          const r = await run("(() => { const b = document.getElementById('gardenViews').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()");
          const z = realW / 320;
          const img = await panel().capturePage({ x: 0, y: Math.floor(r.y * z), width: Math.ceil(realW), height: Math.ceil((r.h + 10) * z) });
          fs.writeFileSync(path.join(SHOTS, `gview-narrow-${v}.png`), img.toPNG());
        }
        panel().setZoomFactor(1);
        await wait(400);
        // Arrow keys move between views.
        await run("(() => { showGardenView('now', false); document.querySelector('#gardenViews [data-gv=\"now\"]').focus(); return true; })()");
        panel().sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
        await wait(200);
        out.jumps.arrowRight = await run("document.getElementById('tab-garden').dataset.view");
        out.jumps.focus = await run("document.activeElement && document.activeElement.dataset.gv");
      } else {
        await run("(() => { showGardenView('mutations', false); MUT_UI = null; S.ui = Object.assign({}, S.ui, { mutChart: { hydro: true, lunar: true, color: true, hours: 72 } }); MUT_SIG = ''; renderMutChart(); return true; })()");
        await wait(700);
        const shares = "(() => [...document.querySelectorAll('#mutChart .mut-check')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim()).join(' | '))()";
        out.before = await run(shares);
        out.btnBefore = await run("(document.querySelector('#mutChart [data-mutplants]') || {}).innerText");
        await run("document.querySelector('#mutChart [data-mutplants]').click()");
        await wait(300);
        out.chips = await run("[...document.querySelectorAll('#mutChart [data-mutplant]')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim() + ':' + b.getAttribute('aria-pressed'))");
        await shotOf('#mutChart', 'mutplants-open', 6);
        await run("document.querySelector('#mutChart [data-mutplant=\"ThunderCelestial\"]').click()");
        await wait(500);
        out.after = await run(shares);
        out.btnAfter = await run("(document.querySelector('#mutChart [data-mutplants]') || {}).innerText");
        out.notes = await run("[...document.querySelectorAll('#mutChart .note')].map((n) => n.innerText)");
        out.pressed = await run("(document.querySelector('#mutChart [data-mutplant=\"ThunderCelestial\"]') || {}).ariaPressed");
        await shotOf('#mutChart', 'mutplants-out', 6);
        await wait(1500);
        out.savedExclude = await run("window.app.getSettings().then((s) => s.ui && s.ui.mutChart && s.ui.mutChart.exclude)");
        // Closed, then everything back.
        await run("document.querySelector('#mutChart [data-mutplants]').click()");
        await wait(300);
        await shotOf('#mutChart', 'mutplants-closed', 6);
        await run("(() => { document.querySelector('#mutChart [data-mutplants]').click(); return true; })()");
        await wait(300);
        await run("document.querySelector('#mutChart [data-mutplants-all]').click()");
        await wait(500);
        out.back = await run(shares);
        out.btnBack = await run("(document.querySelector('#mutChart [data-mutplants]') || {}).innerText");
        // Everything left out: the empty state keeps the picker.
        await run(`(() => { MUT_UI.exclude = ${JSON.stringify(Object.keys(rows))}; MUT_SIG = ''; renderMutChart(); return true; })()`);
        await wait(300);
        out.allOut = await run("(() => ({ empty: (document.querySelector('#mutChart .empty') || {}).innerText, picker: Boolean(document.querySelector('#mutChart [data-mutplants]')) }))()");
        await run("(() => { MUT_UI.exclude = []; saveMutUi(); MUT_SIG = ''; renderMutChart(); return true; })()");
      }
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
