'use strict';

// First-run walkthrough (v0.78.0): the real app, from a fresh install,
// against the stand-in game as a brand-new player (MG_FIXTURE=newplayer) or
// an existing one new to the app (MG_FIXTURE=veteran). It goes through the
// setup the way a new user would (Continue, Continue…), then every tab and
// view, the Money tab's lock and unlocks, and the harvest lock / Harvesting
// unlocked buttons, and screenshots each step into
// tests/shots/firstrun/<persona>/ with a report (first-run.json) of what each
// screen said, console errors, and what each lock did.
// Run: tests/README.md (like chart-shots), with MG_PERSONA set too.
const { app, webContents } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('host-resolver-rules', 'MAP magicgarden.gg 127.0.0.1:8443');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('no-sandbox');

const PERSONA = process.env.MG_PERSONA || 'newplayer';
const DIR = path.join(__dirname, 'shots', 'firstrun', PERSONA);
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const report = { persona: PERSONA, steps: [], errors: [], console: [], checks: {} };
process.on('uncaughtException', (e) => report.errors.push('uncaught: ' + (e.stack || e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (pred) => webContents.getAllWebContents().find((w) => !w.isDestroyed() && pred(w.getURL()));
const panel = () => find((u) => u.endsWith('control.html'));
const game = () => find((u) => u.startsWith('https://magicgarden.gg'));
const run = (js) => panel().executeJavaScript(js, true);
const grun = (js) => game().executeJavaScript(js, true);

require('../main.js');
const store = require('../store');

let n = 0;
const TEXT = `(() => {
  const vis = (el) => el && !el.hidden && getComputedStyle(el).display !== 'none';
  const sheet = document.getElementById('setupSheet');
  if (vis(sheet)) return sheet.innerText;
  const modal = document.querySelector('.modal-back');
  if (modal) return 'MODAL: ' + modal.innerText;
  const sec = [...document.querySelectorAll('main > section')].find((s) => !s.hidden);
  return sec ? sec.innerText : document.body.innerText;
})()`;
async function shot(name, which, note) {
  n += 1;
  const wc = which === 'game' ? game() : panel();
  const file = `${String(n).padStart(3, '0')}-${name}.png`;
  try {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(DIR, file), img.toPNG());
  } catch (err) {
    report.errors.push(`shot ${name}: ${err.message}`);
  }
  let text = null;
  if (which !== 'game') {
    try {
      text = String(await run(TEXT)).replace(/\n{3,}/g, '\n\n').slice(0, 4000);
    } catch (err) {
      text = null;
    }
  }
  report.steps.push({ n, name, which: which || 'panel', file, note: note || null, text });
}
// Every screen of the panel's scrolling area, top to bottom (at most `max`).
async function screens(name, max = 5) {
  await run("document.querySelector('main').scrollTop = 0");
  await wait(350);
  const info = await run("(() => { const m = document.querySelector('main'); return { sh: m.scrollHeight, ch: m.clientHeight }; })()");
  const count = Math.min(max, Math.max(1, Math.ceil((info.sh - 40) / Math.max(1, info.ch - 80))));
  for (let i = 0; i < count; i += 1) {
    await run(`document.querySelector('main').scrollTop = ${i} * (document.querySelector('main').clientHeight - 80)`);
    await wait(350);
    await shot(count > 1 ? `${name}-${i + 1}` : name);
  }
  if (Math.ceil((info.sh - 40) / Math.max(1, info.ch - 80)) > max) report.steps[report.steps.length - 1].note = `(${Math.ceil(info.sh / info.ch)} screens; first ${max} shot)`;
  await run("document.querySelector('main').scrollTop = 0");
}
async function waitFor(fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return true;
    } catch (err) {
      /* not yet */
    }
    await wait(300);
  }
  return false;
}
const dismissShare = () => run("(() => { const b = document.getElementById('shareAskNo'); if (b) { b.click(); return true; } return false; })()");

app.whenReady().then(async () => {
  try {
    await waitFor(() => panel() && game() && !game().isLoading(), 30000);
    for (const [who, wc] of [['panel', panel()], ['game', game()]]) {
      wc.on('console-message', (e, level, message, line, source) => {
        if (level >= 2 && !/favicon|DevTools/.test(message)) report.console.push(`${who}: ${String(message).slice(0, 300)} (${String(source || '').split('/').pop()}:${line})`);
      });
    }
    await wait(2500);
    await shot('launch', 'panel', 'First thing on screen');
    await shot('launch-game', 'game');

    // 1. The setup, the way a new user clicks through it: Continue each time.
    const order = [];
    for (let i = 0; i < 14; i += 1) {
      const step = await run("(() => { const s = document.getElementById('setupSheet'); return s && !s.hidden ? s.dataset.step : null; })()");
      if (!step) break;
      order.push(step);
      await shot(`setup-${step}`);
      const over = await run("(() => { const b = document.querySelector('#setupSheet .su-body'); return b ? b.scrollHeight - b.clientHeight : 0; })()");
      if (over > 30) {
        await run("document.querySelector('#setupSheet .su-body').scrollTop = 99999");
        await wait(300);
        await shot(`setup-${step}-bottom`);
      }
      await run(`document.querySelector('#setupSheet [data-wgo="${step === 'done' ? 'done' : 'next'}"]').click()`);
      await wait(800);
    }
    report.checks.setupSteps = order;
    await wait(2000);
    report.checks.shareAskAfterSetup = await run("Boolean(document.getElementById('shareAsk'))");
    await shot('after-setup', 'panel', report.checks.shareAskAfterSetup ? 'The share question popped up right after setup' : null);
    await dismissShare();
    await wait(4000);
    await shot('game-after-setup', 'game');

    // 2. Every tab and view.
    const tabs = ['home', 'alerts', 'weather', 'garden', 'quests', 'money', 'pets', 'pity', 'rooms', 'scripts'];
    for (const t of tabs) {
      await dismissShare();
      if (t === 'garden') {
        for (const v of ['now', 'mutations', 'map', 'harvest', 'progress']) {
          await run(`(() => { showTab('garden'); showGardenView('${v}', false); return true; })()`);
          await wait(900);
          await screens(`garden-${v}`, 4);
        }
        continue;
      }
      if (t === 'pets') {
        for (const v of ['now', 'food', 'teams', 'rank', 'made']) {
          await run(`(() => { showTab('pets'); showPetsView('${v}', false); return true; })()`);
          await wait(900);
          await screens(`pets-${v}`, 4);
        }
        continue;
      }
      await run(`(() => { showTab('${t}'); return true; })()`);
      await wait(1000);
      await screens(t === 'scripts' ? 'extras' : t === 'pity' ? 'luck' : t, t === 'scripts' ? 1 : 5);
    }
    // Each Extras tile.
    const tiles = await run("[...document.querySelectorAll('#exGrid [data-ex]')].map((b) => ({ key: b.dataset.ex, label: b.innerText.replace(/\\s+/g, ' ').trim() }))");
    report.checks.extrasTiles = tiles.map((x) => x.label);
    for (const tl of tiles) {
      await run(`(() => { showTab('scripts'); openExtras(${JSON.stringify(tl.key)}); document.querySelector('main').scrollTop = 0; return true; })()`);
      await wait(700);
      await screens(`extras-${tl.key.split('/').pop()}`, 2);
    }
    await run("(() => { const b = document.getElementById('exBackBtn'); if (b && b.offsetParent) b.click(); return true; })()");

    // 3. The Money tab's lock: locked, opened anyway, back to automatic,
    //    then with a day of money history, then (big accounts) more.
    const money = async () => run("(async () => { const b = await window.app.budgetGet ? await window.app.budgetGet() : null; return b ? { unlocked: b.unlocked, mode: b.unlockMode, days: b.unlockDays, hours: Math.round(b.measuredHours * 10) / 10, netWorth: b.netWorth } : null; })()");
    report.checks.moneyAtStart = await money();
    await run("(() => { showTab('money'); return true; })()");
    await wait(800);
    await shot('money-locked');
    await run("document.getElementById('moneyOpenAnyway') && document.getElementById('moneyOpenAnyway').click()");
    await wait(1500);
    report.checks.moneyOpened = await money();
    await screens('money-opened-anyway', 6);
    // Back to automatic, then a believable first day of readings (every half hour).
    await run("window.app.budgetSet({ unlockMode: 'auto' })");
    await wait(500);
    const s = store.get();
    const now = Date.now();
    const coins = Number(((s.moneyHistory || []).slice(-1)[0] || {}).c) || (PERSONA === 'veteran' ? 36e9 : 1850);
    s.moneyHistory = Array.from({ length: 50 }, (x, i) => ({ t: now - (49 - i) * 1800000, c: Math.round(coins * (0.8 + i * 0.004)), s: Math.round(coins * i * 0.01), f: 0 }));
    store.save();
    await wait(3500); // past the app's few-second cache of the Money view
    await run('refreshBudget(true)');
    await wait(1500);
    report.checks.moneyAfterADay = await money();
    await run("(() => { showTab('money'); return true; })()");
    await wait(800);
    await screens('money-after-a-day', 3);

    // 4. Harvest lock and Harvesting unlocked, from the header buttons.
    const lockState = async () => run("(async () => { const l = await window.app.harvestGet(); return { lock: Boolean(l && l.on), mode: Boolean(l && l.mode && l.mode.on), lockBtn: document.getElementById('lockBtn').getAttribute('aria-pressed'), modeBtn: document.getElementById('modeBtn').getAttribute('aria-pressed') }; })()");
    const gameBadge = () => grun("(() => { const b = document.getElementById('__mgHarvestLock'); return b ? { shown: getComputedStyle(b).display !== 'none', text: b.innerText.slice(0, 120) } : null; })()");
    report.checks.locks = { start: await lockState() };
    await run("document.getElementById('lockBtn').click()");
    await wait(1200);
    report.checks.locks.lockOn = Object.assign(await lockState(), { game: await gameBadge() });
    await shot('harvest-lock-on');
    await shot('harvest-lock-on-game', 'game');
    await run("document.getElementById('lockBtn').click()");
    await wait(1000);
    report.checks.locks.lockOff = await lockState();
    await run("document.getElementById('modeBtn').click()");
    await wait(1500);
    report.checks.locks.modeOn = Object.assign(await lockState(), { game: await gameBadge() });
    await shot('harvesting-unlocked-on');
    await shot('harvesting-unlocked-on-game', 'game');
    await run("document.getElementById('modeBtn').click()");
    await wait(1200);
    report.checks.locks.modeOff = await lockState();
    await shot('harvesting-unlocked-off');

    // 5. Home again at the end.
    await run("(() => { showTab('home'); return true; })()");
    await wait(1000);
    await screens('home-at-end', 3);
  } catch (e) {
    report.errors.push('walkthrough: ' + (e.stack || e));
  }
  fs.writeFileSync(path.join(DIR, 'first-run.json'), JSON.stringify(report, null, 2));
  app.exit(0);
});
