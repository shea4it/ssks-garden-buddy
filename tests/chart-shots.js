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
    if (MODE === 'binder') {
      // The binder map over the game: a garden with a Moonbinder, lit crops
      // beside it and away from it, a Dawn crop on a binder spot, bound
      // ones, open binder spots; put into the observer's live state.
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const setTiles = `(() => {
        const obs = window.__mgLoaderObserver; const found = []; const seen = new Set();
        const walk = (o, d) => { if (!o || typeof o !== 'object' || seen.has(o) || d > 9) return; seen.add(o); if (o.tileObjects && typeof o.tileObjects === 'object' && !Array.isArray(o.tileObjects)) found.push(o); for (const k of Object.keys(o)) walk(o[k], d + 1); };
        walk(obs.state, 0);
        const crop = (m, ripe = true) => ({ species: 'Dawnbreaker', mutations: m, endTime: ripe ? Date.now() - 1000 : Date.now() + 1e7, size: 100 });
        const plant = (sp, m, ripe) => ({ objectType: 'plant', species: sp, slots: [crop(m, ripe)] });
        const T = {};
        for (let i = 0; i < 200; i += 1) if (i % 7 !== 3) T[i] = plant('Ube', i % 5 === 0 ? ['Rainbow', 'Frozen'] : ['Gold', 'Wet', i % 2 ? 'Dawnlit' : 'Amberbound']);
        T[44] = plant('MoonCelestial', []);
        T[43] = plant('Dawnbreaker', ['Rainbow', 'Frozen', 'Amberlit']);
        T[45] = plant('Dawnbreaker', ['Rainbow', 'Frozen', 'Dawnlit']);
        T[63] = plant('Dawnbreaker', ['Rainbow', 'Frozen', 'Amberbound']);
        T[24] = plant('Ube', ['Frozen']);
        delete T[25]; delete T[65];
        T[150] = plant('Dawnbreaker', ['Gold', 'Frozen', 'Amberlit']);
        T[151] = plant('Milkcap', ['Rainbow', 'Amberlit']);
        T[88] = plant('Milkcap', ['Rainbow', 'Amberlit']);
        T[152] = plant('Milkcap', ['Rainbow', 'Dawnlit']);
        for (const f of found) f.tileObjects = T;
        return found.length;
      })()`;
      const bd = {};
      bd.gardens = await grun(setTiles);
      const show = async (p) => {
        await grun(setTiles);
        await grun(`window.__mgLoaderObserver.setBinderMap(${JSON.stringify(p)})`);
        await wait(500);
        return grun("(() => { const b = document.getElementById('mg-binder-map'); return b && b.style.display !== 'none' ? { text: b.innerText.replace(/\\s+/g, ' ').trim(), pulses: b.querySelectorAll('i.pulse').length, rect: (() => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })() } : null; })()");
      };
      bd.amber = await show({ on: true, event: { kind: 'amber', endsAt: Date.now() + 7 * 60000 } });
      if (bd.amber) {
        const img = await gw.capturePage();
        const [x, y, w, hh] = bd.amber.rect;
        fs.mkdirSync(SHOTS, { recursive: true });
        fs.writeFileSync(path.join(SHOTS, 'binder-amber.png'), img.crop({ x: Math.max(0, x - 6), y: Math.max(0, y - 6), width: w + 12, height: hh + 12 }).toPNG());
        fs.writeFileSync(path.join(SHOTS, 'binder-game.png'), img.toPNG());
      }
      bd.dawnNoBinder = await show({ on: true, event: { kind: 'dawn', endsAt: Date.now() + 7 * 60000 } });
      // A Dawnbinder among Amber crops (as in the owner's garden, v0.53.5):
      // with no Dawnlit crops waiting, nothing around it pulses; with more
      // waiting than open spots, the Amber crops in its spots do.
      const dawnTiles = (waiting) => `(() => {
        const obs = window.__mgLoaderObserver; const found = []; const seen = new Set();
        const walk = (o, d) => { if (!o || typeof o !== 'object' || seen.has(o) || d > 9) return; seen.add(o); if (o.tileObjects && typeof o.tileObjects === 'object' && !Array.isArray(o.tileObjects)) found.push(o); for (const k of Object.keys(o)) walk(o[k], d + 1); };
        walk(obs.state, 0);
        const crop = (m) => ({ species: 'Dawnbreaker', mutations: m, endTime: Date.now() - 1000, size: 100 });
        const plant = (sp, m) => ({ objectType: 'plant', species: sp, slots: [crop(m)] });
        const T = {};
        for (let i = 0; i < 200; i += 1) T[i] = plant('Ube', ['Rainbow', 'Frozen', i % 3 ? 'Amberbound' : 'Amberlit']);
        T[44] = plant('DawnCelestial', []);
        T[43] = plant('Dawnbreaker', ['Rainbow', 'Frozen', 'Dawnlit']);
        delete T[65];
        ${waiting ? "for (const i of [150, 151, 170, 171]) T[i] = plant('Milkcap', ['Rainbow', 'Dawnlit']);" : ''}
        for (const f of found) f.tileObjects = T;
        return found.length;
      })()`;
      const showWith = async (tilesJs, p, shot) => {
        await grun(tilesJs);
        await grun(`window.__mgLoaderObserver.setBinderMap(${JSON.stringify(p)})`);
        await wait(500);
        const r = await grun("(() => { const b = document.getElementById('mg-binder-map'); if (!b || b.style.display === 'none') return null; const cells = [...b.querySelectorAll('i')]; return { text: b.innerText.replace(/\\s+/g, ' ').trim(), pulses: b.querySelectorAll('i.pulse').length, orangePulses: cells.filter((c) => c.classList.contains('pulse') && /251, 146, 60|255, 177, 59/.test(c.style.getPropertyValue('--g') + c.style.background)).length, purpleGlowPulses: cells.filter((c) => c.classList.contains('pulse') && /c084fc/i.test(c.style.getPropertyValue('--g'))).length, violet: cells.filter((c) => /216, 180, 254/.test(c.style.background)).length, rect: (() => { const q = b.getBoundingClientRect(); return [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)]; })() }; })()");
        if (r && shot) {
          const img = await gw.capturePage();
          const [x, y, w, hh] = r.rect;
          fs.writeFileSync(path.join(SHOTS, shot), img.crop({ x: Math.max(0, x - 6), y: Math.max(0, y - 6), width: w + 12, height: hh + 12 }).toPNG());
        }
        return r;
      };
      bd.dawnCalm = await showWith(dawnTiles(false), { on: true, event: { kind: 'dawn', endsAt: Date.now() + 7 * 60000 } }, 'binder-dawn-calm.png');
      bd.dawnSwap = await showWith(dawnTiles(true), { on: true, event: { kind: 'dawn', endsAt: Date.now() + 7 * 60000 } }, 'binder-dawn-swap.png');
      bd.switchedOff = await show({ on: false, event: { kind: 'amber', endsAt: Date.now() + 7 * 60000 } });
      bd.ended = await show({ on: true, event: { kind: 'amber', endsAt: Date.now() - 1000 } });
      // The panel's switch, through main to the game page.
      bd.settingOff = await run('window.app.binderMapSetting(false)');
      await wait(300);
      bd.observerOff = await grun('window.__mgLoaderObserver.binderOn');
      bd.settingOn = await run('window.app.binderMapSetting(true)');
      await wait(300);
      bd.observerOn = await grun('window.__mgLoaderObserver.binderOn');
      out.binder = bd;
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
        const r = await grun("(() => { const b = document.getElementById('mg-binder-map'); if (!b || b.style.display === 'none') return null; const q = b.getBoundingClientRect(); return { text: b.innerText.replace(/\\s+/g, ' ').trim(), pulses: b.querySelectorAll('i.pulse').length, rect: [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)] }; })()");
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
    if (MODE === 'thunder') {
      // The Thunderstruck finder (v0.53.8) on the owner's garden, with a
      // Thunder Wolf put among the active pets.
      const fx = require('./fixtures/garden-layout.json');
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const setup = (opts) => `(() => {
        const obs = window.__mgLoaderObserver; const gardens = []; const datas = []; const seen = new Set();
        const walk = (o, d) => { if (!o || typeof o !== 'object' || seen.has(o) || d > 9) return; seen.add(o); if (o.tileObjects && typeof o.tileObjects === 'object' && !Array.isArray(o.tileObjects)) gardens.push(o); if (Array.isArray(o.petSlots) && o.garden) datas.push(o); for (const k of Object.keys(o)) walk(o[k], d + 1); };
        walk(obs.state, 0);
        const fx = ${JSON.stringify(fx)};
        const o = ${JSON.stringify(opts)};
        const at = new Map(fx.plants.map((p) => [p.i, p]));
        const T = {};
        for (const i of fx.occupied) {
          const p = at.get(i);
          T[i] = p ? { objectType: 'plant', species: p.sp, slots: p.s.map(([m, size, ripe]) => ({ species: p.sp, mutations: (m ? m.split(',') : []).map((k) => (o.allCharged && k === 'thunderstruck' ? 'thundercharged' : k)), size, endTime: ripe ? Date.now() - 1000 : Date.now() + 1e7 })) } : { objectType: 'decor', decorId: 'WoodBench' };
        }
        for (const g of gardens) g.tileObjects = T;
        const wolf = { id: 'wolf', petSpecies: 'ThunderWolf', abilities: ['Thundercharger', 'ThunderstruckGranter'], mutations: [], xp: 1 };
        for (const d of datas) d.petSlots = o.wolf ? [wolf] : [{ id: 'pig', petSpecies: 'Pig', abilities: ['SellBoostII'], mutations: [], xp: 1 }];
        return [gardens.length, datas.length];
      })()`;
      const read = () => grun("(() => { const b = document.getElementById('mg-thunder-map'); if (!b || b.style.display === 'none') return null; const q = b.getBoundingClientRect(); return { text: b.innerText.replace(/\\s+/g, ' ').trim(), glowing: [...b.querySelectorAll('i')].filter((c) => c.style.boxShadow).length, rect: [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)] }; })()");
      const th = {};
      th.found = await grun(setup({ wolf: true }));
      await grun('window.__mgLoaderObserver.setThunderMap(true)');
      await wait(500);
      th.wolfOut = await read();
      if (th.wolfOut) {
        const img = await gw.capturePage();
        const [x, y, w, hh] = th.wolfOut.rect;
        fs.mkdirSync(SHOTS, { recursive: true });
        fs.writeFileSync(path.join(SHOTS, 'thunder-finder.png'), img.crop({ x: Math.max(0, x - 6), y: Math.max(0, y - 6), width: w + 12, height: hh + 12 }).toPNG());
      }
      await grun(setup({ wolf: false }));
      await grun('window.__mgLoaderObserver.setThunderMap(true)');
      await wait(300);
      th.noWolf = await read();
      await grun(setup({ wolf: true }));
      await grun(`window.__mgLoaderObserver.setBinderMap(${JSON.stringify({ on: true, event: { kind: 'amber', endsAt: Date.now() + 600000 } })})`);
      await grun('window.__mgLoaderObserver.setThunderMap(true)');
      await wait(300);
      th.duringAmber = await read();
      th.binderUp = await grun("(() => { const b = document.getElementById('mg-binder-map'); return Boolean(b && b.style.display !== 'none'); })()");
      await grun(`window.__mgLoaderObserver.setBinderMap(${JSON.stringify({ on: true, event: null })})`);
      await wait(300);
      th.afterAmber = await read();
      await grun('window.__mgLoaderObserver.setThunderMap(false)');
      await wait(300);
      th.switchedOff = await read();
      await grun(setup({ wolf: true, allCharged: true }));
      await grun('window.__mgLoaderObserver.setThunderMap(true)');
      await wait(300);
      th.allCharged = await read();
      th.settingOff = await run('window.app.thunderMapSetting(false)');
      await wait(300);
      th.observerOff = await grun('window.__mgLoaderObserver.thunderOn');
      th.settingOn = await run('window.app.thunderMapSetting(true)');
      await wait(300);
      th.observerOn = await grun('window.__mgLoaderObserver.thunderOn');
      out.thunder = th;
    }
    if (MODE === 'mount') {
      // The riding map and moving the corner maps (v0.53.9), on the owner's
      // garden: riding an Ostrich (Dawn Capture), then a Phoenix (Amber
      // Capture); dragging by the header with real mouse input.
      const fx = require('./fixtures/garden-layout.json');
      const gw = find((u) => u.startsWith('https://magicgarden.gg'));
      const grun = (js) => gw.executeJavaScript(js, true);
      const setup = (opts) => `(() => {
        const obs = window.__mgLoaderObserver; const gardens = []; const slots = []; const seen = new Set();
        const walk = (o, d) => { if (!o || typeof o !== 'object' || seen.has(o) || d > 9) return; seen.add(o); if (o.tileObjects && typeof o.tileObjects === 'object' && !Array.isArray(o.tileObjects)) gardens.push(o); if (o.data && typeof o.data === 'object' && o.data.garden && Array.isArray(o.data.petSlots)) slots.push(o); for (const k of Object.keys(o)) walk(o[k], d + 1); };
        walk(obs.state, 0);
        const fx = ${JSON.stringify(fx)};
        const o = ${JSON.stringify(opts)};
        const at = new Map(fx.plants.map((p) => [p.i, p]));
        const T = {};
        for (const i of fx.occupied) {
          const p = at.get(i);
          T[i] = p ? { objectType: 'plant', species: p.sp, slots: p.s.map(([m, size, ripe]) => ({ species: p.sp, mutations: m ? m.split(',') : [], size, endTime: ripe ? Date.now() - 1000 : Date.now() + 1e7 })) } : { objectType: 'decor', decorId: 'WoodBench' };
        }
        for (const g of gardens) g.tileObjects = T;
        const pets = [];
        if (o.mount === 'ostrich') pets.push({ id: 'mount', petSpecies: 'Ostrich', abilities: ['DawnCapture', 'ProduceScaleBoostII'], mutations: [], xp: 1 });
        if (o.mount === 'phoenix') pets.push({ id: 'mount', petSpecies: 'Phoenix', abilities: ['AmberCapture', 'AmberlitGranter'], mutations: [], xp: 1 });
        if (o.wolf) pets.push({ id: 'wolf', petSpecies: 'ThunderWolf', abilities: ['Thundercharger'], mutations: [], xp: 1 });
        for (const s of slots) { s.data.petSlots = pets; s.riddenPetId = o.mount ? 'mount' : null; }
        return [gardens.length, slots.length];
      })()`;
      const read = (id) => grun(`(() => { const b = document.getElementById('${id}'); if (!b || b.style.display === 'none') return null; const q = b.getBoundingClientRect(); return { text: b.innerText.replace(/\\s+/g, ' ').trim(), pulses: b.querySelectorAll('i.pulse').length, fixed: b.style.position === 'fixed', rect: [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)] }; })()`);
      const shot = async (r, name) => {
        if (!r) return;
        const img = await gw.capturePage();
        const [x, y, w, hh] = r.rect;
        fs.mkdirSync(SHOTS, { recursive: true });
        fs.writeFileSync(path.join(SHOTS, name), img.crop({ x: Math.max(0, x - 6), y: Math.max(0, y - 6), width: w + 12, height: hh + 12 }).toPNG());
      };
      const mt = {};
      mt.found = await grun(setup({ mount: 'ostrich', wolf: true }));
      await grun('window.__mgLoaderObserver.setMountMap(true)');
      await wait(500);
      mt.ostrich = await read('mg-mount-map');
      mt.thunderWhileRiding = await read('mg-thunder-map');
      await shot(mt.ostrich, 'mount-ostrich.png');
      await grun(setup({ mount: 'phoenix' }));
      await grun('window.__mgLoaderObserver.setMountMap(true)');
      await wait(500);
      mt.phoenix = await read('mg-mount-map');
      await shot(mt.phoenix, 'mount-phoenix.png');
      await grun(setup({ mount: null, wolf: true }));
      await grun('window.__mgLoaderObserver.setMountMap(true)');
      await wait(400);
      mt.notRiding = await read('mg-mount-map');
      mt.thunderBack = Boolean(await read('mg-thunder-map'));
      await grun(setup({ mount: 'ostrich' }));
      await grun('window.__mgLoaderObserver.setMountMap(false)');
      await wait(300);
      mt.switchedOff = await read('mg-mount-map');
      await grun('window.__mgLoaderObserver.setMountMap(true)');
      await wait(400);
      // Drag it by its header, for real.
      const before = await read('mg-mount-map');
      const hx = before.rect[0] + 40;
      const hy = before.rect[1] + 10;
      gw.sendInputEvent({ type: 'mouseMove', x: hx, y: hy });
      gw.sendInputEvent({ type: 'mouseDown', x: hx, y: hy, button: 'left', clickCount: 1 });
      for (let k = 1; k <= 6; k += 1) {
        gw.sendInputEvent({ type: 'mouseMove', x: hx - k * 50, y: hy - k * 40, button: 'left', modifiers: ['leftButtonDown'] });
        await wait(40);
      }
      gw.sendInputEvent({ type: 'mouseUp', x: hx - 300, y: hy - 240, button: 'left', clickCount: 1 });
      await wait(700);
      mt.dragged = await read('mg-mount-map');
      mt.before = before.rect;
      mt.saved = ((await run('window.app.getSettings()')).ui.mapPos || {})['mg-mount-map'] || null;
      // Forget it in the page, and let the app put it back from settings.
      await grun("(() => { const o = window.__mgLoaderObserver; o.setMapPositions({}); return true; })()");
      await wait(200);
      mt.forgot = (await read('mg-mount-map')).fixed;
      await run('window.app.mountMapSetting(true)');
      await wait(600);
      mt.restored = await read('mg-mount-map');
      // Double-click the header: back to the corner, and forgotten.
      const r2 = mt.restored.rect;
      gw.sendInputEvent({ type: 'mouseDown', x: r2[0] + 40, y: r2[1] + 10, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseUp', x: r2[0] + 40, y: r2[1] + 10, button: 'left', clickCount: 1 });
      gw.sendInputEvent({ type: 'mouseDown', x: r2[0] + 40, y: r2[1] + 10, button: 'left', clickCount: 2 });
      gw.sendInputEvent({ type: 'mouseUp', x: r2[0] + 40, y: r2[1] + 10, button: 'left', clickCount: 2 });
      await wait(700);
      mt.docked = await read('mg-mount-map');
      mt.savedAfter = ((await run('window.app.getSettings()')).ui.mapPos || {})['mg-mount-map'] || null;
      out.mount = mt;
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
