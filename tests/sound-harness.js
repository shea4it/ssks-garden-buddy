// Sound and alerts harness (v0.50): runs the real main.js against the
// stand-in game, starting from a v0.49 settings file, and checks the Alerts
// tab end to end. Writes tests/sound-result.json and screenshots into
// tests/shots/. See tests/README.md for how to run it.
//
// MG_PIPER_DIR: a folder with Piper's Linux engine (piper/piper) and
// MG_PIPER_MODEL: any Piper .onnx voice (with its .json). The model is put in
// place as Leah's download, so real speech is synthesised and measured.
const { app, webContents } = require('electron');
const fs = require('fs');
const path = require('path');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP magicgarden.gg 127.0.0.1:8443');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const out = { errors: [], console: [] };
process.on('uncaughtException', (e) => out.errors.push('uncaught: ' + (e.stack || e)));
process.on('unhandledRejection', (e) => out.errors.push('unhandled: ' + ((e && e.stack) || e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (pred) => webContents.getAllWebContents().find((w) => !w.isDestroyed() && pred(w.getURL()));
const game = () => find((u) => u.startsWith('https://magicgarden.gg'));
const panel = () => find((u) => u.endsWith('control.html'));
const run = (js) => panel().executeJavaScript(js, true);
const dir = () => app.getPath('userData');
const live = () => run('window.app.getSettings()');
const readSettings = () => JSON.parse(fs.readFileSync(path.join(dir(), 'settings.json'), 'utf8'));
const shots = path.join(__dirname, 'shots');

// MG_SOUND_CASE: '' (the full run below), 'fresh' (a new install: nothing
// seeded) or 'spike' (v0.49 on the retired Spike voice with nothing
// downloaded and the voice slider at 0). The two short cases only check
// the start-up and the Alerts tab, then exit.
const CASE = process.env.MG_SOUND_CASE || '';
if (CASE === 'peaks') {
  fs.mkdirSync(path.join(dir(), 'voices', 'models'), { recursive: true });
  fs.writeFileSync(path.join(dir(), 'settings.json'), JSON.stringify({ rooms: { askShare: false }, alerts: { volume: 100, voiceEngine: 'natural', naturalVoice: 'en_US-lessac-high', disabled: [], always: [], custom: [], quietHours: {} } }));
  fs.cpSync(process.env.MG_PIPER_DIR, path.join(dir(), 'voices', 'engine'), { recursive: true });
  for (const f of fs.readdirSync(process.env.MG_PIPER_VOICES)) fs.copyFileSync(path.join(process.env.MG_PIPER_VOICES, f), path.join(dir(), 'voices', 'models', f));
}
if (CASE === 'spike') {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), 'settings.json'), JSON.stringify({ rooms: { askShare: false },
    alerts: { volume: 90, voiceVolume: 0, voiceEngine: 'natural', naturalVoice: 'char-spike', disabled: [], always: [], custom: [], quietHours: {} } }));
}
if (!CASE) (() => {
  fs.mkdirSync(dir(), { recursive: true });
  const item = (name, type, price) => ({ name, type, shop: 'seed', price, restocks: 20, seen: 5, stockSum: 5, firstAt: Date.now() - 864e5, lastSeenAt: Date.now() });
  fs.writeFileSync(path.join(dir(), 'settings.json'), JSON.stringify({
    ui: { panelWidth: 480, width480: true, tab: 'alerts', folds: { 'alerts/sound-and-voice': true, 'alerts/shop-items': true, 'alerts/weather': true } },
    rooms: { askShare: false },
    alerts: {
      volume: 80, voiceVolume: 35, voiceEngine: 'natural', naturalVoice: 'fun-radio', voiceEffect: 'none',
      voiceSpeakers: { 'scottish-male': 'p252' }, muted: false, popups: false,
      quietHours: { enabled: false, from: '23:00', to: '08:00' },
      disabled: ['ube'], always: [], custom: [{ name: 'Lychee', tier: 'alarm' }],
    },
    shopStats: { shops: {}, items: {
      LycheeSeed: item('Lychee Seed', 'Seed', 5e6), KiwiSeed: item('Kiwi Seed', 'Seed', 2e6), KiwiPod: item('Kiwi Pod', 'Seed', 9e6),
      MoonCelestial: item('Moonbinder Pod', 'Seed', 50e9), UbeSeed: item('Ube Seed', 'Seed', 1e6), Carrot: item('Carrot Seed', 'Seed', 10),
    } },
  }));
  const vdir = path.join(dir(), 'voices');
  fs.mkdirSync(path.join(vdir, 'models'), { recursive: true });
  if (process.env.MG_PIPER_DIR) fs.cpSync(process.env.MG_PIPER_DIR, path.join(vdir, 'engine'), { recursive: true });
  // MG_PIPER_VOICES: a folder of real Piper voices named by their ids
  // (en_US-lessac-high.onnx and .onnx.json, ...): all installed as-is.
  if (process.env.MG_PIPER_VOICES) {
    for (const f of fs.readdirSync(process.env.MG_PIPER_VOICES)) {
      fs.copyFileSync(path.join(process.env.MG_PIPER_VOICES, f), path.join(vdir, 'models', f));
    }
  } else if (process.env.MG_PIPER_MODEL) {
    fs.copyFileSync(process.env.MG_PIPER_MODEL, path.join(vdir, 'models', 'en_US-lessac-high.onnx'));
    fs.copyFileSync(process.env.MG_PIPER_MODEL + '.json', path.join(vdir, 'models', 'en_US-lessac-high.onnx.json'));
  }
  // A retired download, which should be cleared away.
  fs.writeFileSync(path.join(vdir, 'models', 'en_GB-semaine-medium.onnx'), 'x');
  fs.writeFileSync(path.join(vdir, 'models', 'en_GB-semaine-medium.onnx.json'), '{}');
})();

require('../main.js');

async function shot(name) {
  fs.mkdirSync(shots, { recursive: true });
  const img = await panel().capturePage();
  fs.writeFileSync(path.join(shots, name + '.png'), img.toPNG());
}
const text = (sel) => run(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const click = (sel) => run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);

app.whenReady().then(async () => {
  if (CASE === 'peaks') {
    // Where the voice's peak ends up: after processVoice (before the volume
    // and the limiter), then through a limiter set like the app's alone.
    try {
      await wait(6000);
      // The stand-in's shop feed fires real alerts; keep them out of the
      // offline renders (they'd play into whatever audio context is current).
      await run('enqueue = async () => {}; queue.length = 0; true');
      await wait(8000);
      out.peaks = await run(`(async () => {
        const res = {};
        for (const v of VOICES.voices.filter((x) => x.installed)) {
          const bytes = await window.app.voiceSynthesize(v.id, 'Emberbloom. Emberbloom is in the shop.', 'clear');
          const oc = new OfflineAudioContext(1, 48000 * 6, 48000);
          const clip = await oc.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
          const gain = processVoice(clip, v.tone);
          const d = clip.getChannelData(0);
          let peak = 0; let sum = 0; let n = 0;
          for (const x of d) { const a = Math.abs(x); peak = Math.max(peak, a); if (a > 0.01) { sum += a * a; n += 1; } }
          const src = oc.createBufferSource(); src.buffer = clip;
          const lim = oc.createDynamicsCompressor();
          lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
          src.connect(lim); lim.connect(oc.destination); src.start(0);
          const outBuf = await oc.startRendering();
          let op = 0; for (const x of outBuf.getChannelData(0)) op = Math.max(op, Math.abs(x));
          const db = (x) => Math.round(200 * Math.log10(x)) / 10;
          res[v.name] = { gain: Math.round(gain * 100) / 100, processedPeak: db(peak), speechRms: db(Math.sqrt(sum / n)), afterLimiter: db(op) };
        }
        return res;
      })()`);
    } catch (e) {
      out.errors.push('harness: ' + (e.stack || e));
    }
      // The whole app path: speak() -> processVoice -> voice bus -> limiter.
      out.appPath = await run(`(async () => {
        const res = {};
        const Real = window.AudioContext;
        for (const volume of [100, 80]) {
          S.alerts.volume = volume;
          for (const v of VOICES.voices.filter((x) => x.installed)) {
            let off = null;
            window.AudioContext = function () { off = new OfflineAudioContext(1, 48000 * 7, 48000); return off; };
            ctx = null; master = null; voiceBus = null;
            try { await speak('Emberbloom! Emberbloom is in the shop.', { natural: v }); } finally { window.AudioContext = Real; }
            const b = await off.startRendering();
            ctx = null; master = null; voiceBus = null;
            let p = 0; for (const x of b.getChannelData(0)) p = Math.max(p, Math.abs(x));
            res[v.name + ' @' + volume + '%'] = Math.round(200 * Math.log10(p)) / 10;
          }
        }
        return res;
      })()`);
    fs.writeFileSync(path.join(__dirname, 'sound-result-peaks.json'), JSON.stringify(out, null, 2));
    return app.exit(0);
  }
  if (CASE) {
    try {
      await wait(6000);
      panel().on('console-message', (e, lvl, msg) => { if (lvl >= 2) out.console.push(msg.slice(0, 300)); });
      await run("showTab('alerts')");
      await wait(800);
      const s = await live();
      out.settings = { voiceEngine: s.alerts.voiceEngine, naturalVoice: s.alerts.naturalVoice, retiredVoice: s.alerts.retiredVoice, retiredTo: s.alerts.retiredTo, sfx: s.alerts.sfx, pace: s.alerts.pace, duckGame: s.alerts.duckGame, levels: s.alerts.levels };
      out.voiceCards = await run("[...document.querySelectorAll('.vcard')].map((c) => (c.classList.contains('on') ? '● ' : '○ ') + c.querySelector('.vname').textContent.trim().replace(/\\s+/g, ' '))");
      out.retiredNote = await run("document.getElementById('voiceRetiredNote').hidden ? null : document.getElementById('voiceRetiredNote').textContent.trim()");
      out.rows = await run("document.querySelectorAll('#itemRules .rule').length");
      out.summary = await run("[...document.querySelectorAll('#tab-alerts h2.fold')].map((h) => h.textContent.replace(/\\s+/g, ' ').trim())");
      out.audible = await run('[audible(), level() > 0, speechLevel() > 0]');
    } catch (e) {
      out.errors.push('harness: ' + (e.stack || e));
    }
    fs.writeFileSync(path.join(__dirname, `sound-result-${CASE}.json`), JSON.stringify(out, null, 2));
    return app.exit(0);
  }
  try {
    await wait(6000);
    panel().on('console-message', (e, lvl, msg) => { if (lvl >= 2 && !/OfflineAudioContext/.test(msg)) out.console.push(msg.slice(0, 300)); });

    // ---- Migration ----
    const s0 = readSettings();
    out.migration = {
      voiceEngine: s0.alerts.voiceEngine, naturalVoice: s0.alerts.naturalVoice, retiredVoice: s0.alerts.retiredVoice, retiredTo: s0.alerts.retiredTo,
      voiceVolumeGone: !('voiceVolume' in s0.alerts), speakersGone: !('voiceSpeakers' in s0.alerts), sfx: s0.alerts.sfx, pace: s0.alerts.pace,
      lycheeTier: s0.alerts.custom[0].tier, soundVersion: s0.alerts.soundVersion,
      semainePruned: !fs.existsSync(path.join(dir(), 'voices', 'models', 'en_GB-semaine-medium.onnx')),
    };

    await run("showTab('alerts'); document.querySelectorAll('main > section > h2.fold').forEach((h) => { if (h.getAttribute('aria-expanded') === 'false' && /Sound|Shop|Weather/.test(h.textContent)) h.click(); })");
    await wait(600);
    out.voiceCards = await run("[...document.querySelectorAll('.vcard')].map((c) => (c.classList.contains('on') ? '● ' : '○ ') + c.querySelector('.vname').textContent.trim().replace(/\\s+/g, ' '))");
    out.retiredNote = (await text('#voiceRetiredNote')).trim();
    out.shopRows = await run("[...document.querySelectorAll('#itemRules .rule .rule-name')].map((n) => n.textContent.replace(/[▸▾]/g, '').trim())");
    out.addBack = await run("[...document.querySelectorAll('#addBack [data-addback]')].map((b) => b.textContent)");
    out.foldSummaries = await run("[...document.querySelectorAll('#tab-alerts h2.fold')].map((h) => h.textContent.replace(/\\s+/g, ' ').trim())");
    await shot('alerts-top');
    await run("(() => { const i = $('customName'); i.value = 'kiw'; i.dispatchEvent(new Event('input')); i.scrollIntoView({ block: 'start' }); })()");
    await wait(500);
    await shot('alerts-add');
    await run("$('customName').value = ''; renderAddPreview()");

    // ---- What every alert says (sounds and voice stubbed: text only) ----
    out.lines = await run(`(async () => {
      const said = []; const played = [];
      const realSpeak = speak; const realPlay = play;
      speak = async (t) => { said.push(sayable(t)); };
      play = async (s) => { played.push(s); };
      const res = {};
      for (const r of RULES) {
        said.length = 0; played.length = 0;
        if (r.id === 'weatherother') r.label = 'Meteor Shower';
        await perform(sampleAlert(r));
        res[r.id] = { tier: r.tier, sounds: played.length, said: said.slice() };
      }
      speak = realSpeak; play = realPlay;
      return res;
    })()`);

    // ---- Adding, removing and levels ----
    const ui = {};
    await run("(() => { const i = $('customName'); i.value = 'kiw'; i.dispatchEvent(new Event('input')); })()");
    ui.previewKiwi = (await text('#customPreview')).trim();
    await run("(() => { const i = $('customName'); i.value = 'lychee'; i.dispatchEvent(new Event('input')); })()");
    ui.previewLychee = (await text('#customPreview')).trim();
    await run("(() => { const i = $('customName'); i.value = 'ube'; i.dispatchEvent(new Event('input')); })()");
    ui.previewUbe = (await text('#customPreview')).trim();
    ui.suggestions = await run("[...document.querySelectorAll('#itemSuggest option')].map((o) => o.value)");
    await click('#customAdd');
    await wait(900);
    ui.ubeBack = !(await live()).alerts.disabled.includes('ube');
    await run("(() => { const i = $('customName'); i.value = 'kiwi'; i.dispatchEvent(new Event('input')); })()");
    await click('#customAdd');
    await wait(900);
    ui.kiwiSaved = (await live()).alerts.custom.map((c) => `${c.name}:${c.tier}`);
    ui.kiwiEditorOpen = await run("!!document.querySelector('[data-editor=\"custom:kiwi\"]')");
    ui.kiwiEditorText = (await text('[data-editor="custom:kiwi"]')).replace(/\s+/g, ' ').trim();
    await run("OPEN_RULE = 'starweaver'; renderRules(); document.querySelector('[data-editor=\"starweaver\"]').scrollIntoView({ block: 'center' })");
    await wait(500);
    await shot('alerts-editor');
    await run("OPEN_RULE = 'custom:kiwi'; renderRules()");
    await click('[data-for="custom:kiwi"][data-level="big"]');
    await wait(900);
    ui.kiwiBig = (await live()).alerts.custom.find((c) => c.name === 'Kiwi').tier;
    // A built-in's level, then back to its usual one.
    await click('[data-open="dawnbinder"]');
    await click('[data-for="dawnbinder"][data-level="basic"]');
    await wait(900);
    ui.dawnbinderLevel = (await live()).alerts.levels.dawnbinder;
    ui.dawnbinderRuleTier = await run("RULES.find((r) => r.id === 'dawnbinder').tier");
    ui.dawnbinderPill = (await text('[data-open="dawnbinder"] .lvl-pill')).trim();
    await click('[data-reset="dawnbinder"]');
    await wait(900);
    ui.dawnbinderReset = (await live()).alerts.levels.dawnbinder === undefined;
    // Ring through quiet hours.
    await click('[data-always="dawnbinder"]');
    await wait(900);
    ui.always = (await live()).alerts.always;
    // Remove a built-in, add it back from its chip.
    await click('[data-remove="moonbinder"]');
    await wait(900);
    ui.moonRemoved = (await live()).alerts.disabled.includes('moonbinder');
    ui.moonChip = await run("!!document.querySelector('[data-addback=\"moonbinder\"]')");
    await click('[data-addback="moonbinder"]');
    await wait(900);
    ui.moonBack = !(await live()).alerts.disabled.includes('moonbinder');
    // Remove a custom one.
    await click('[data-remove="custom:lychee"]');
    await wait(900);
    ui.lycheeGone = !(await live()).alerts.custom.some((c) => c.name === 'Lychee');
    // The watcher uses the new levels: the main process's rules.
    ui.mainRules = (await run('window.app.getRules()')).filter((r) => ['custom:kiwi', 'starweaver', 'dawnbinder'].includes(r.id)).map((r) => `${r.id}:${r.tier}`);
    // Weather switch still works.
    await click('[data-rule="rain"]');
    await wait(900);
    ui.rainOff = (await live()).alerts.disabled.includes('rain');
    await click('[data-rule="rain"]');
    out.ui = ui;

    // ---- The "pick from the shops" dropdown ----
    const dd = {};
    const pickNamed = (name) => run(`(() => { const sel = $('addPick'); const o = [...sel.options].find((x) => x.textContent.startsWith(${JSON.stringify(name)})); if (!o) return 'missing'; if (o.disabled) return 'disabled'; sel.value = o.value; sel.dispatchEvent(new Event('change')); return 'picked'; })()`);
    dd.first = await run("$('addPick').options[0].textContent");
    dd.groups = await run("[...document.querySelectorAll('#addPick optgroup')].map((g) => g.label + ': ' + [...g.children].map((o) => o.textContent + (o.disabled ? ' [off]' : '')).join(' | '))");
    dd.kiwiSeed = await pickNamed('Kiwi Seed');
    dd.dawnEgg = await pickNamed('Dawn Egg');
    await click('[data-remove="ube"]');
    await wait(900);
    dd.ubeSeed = await pickNamed('Ube Seed');
    dd.pedestal = await pickNamed('Marble Pedestal');
    dd.moonPod = await pickNamed('Moonbinder Pod');
    await wait(900);
    const sd = await live();
    dd.custom = sd.alerts.custom.map((c) => `${c.name}:${c.tier}${c.itemId ? ':' + c.itemId : ''}`);
    dd.ubeBack = !sd.alerts.disabled.includes('ube');
    dd.open = await run('OPEN_RULE');
    dd.resetValue = await run("$('addPick').value");
    dd.nowCovered = await run("[...$('addPick').options].filter((o) => /Dawn Egg|Kiwi Seed/.test(o.textContent)).map((o) => o.textContent + (o.disabled ? ' [off]' : ''))");
    await run("$('customName').scrollIntoView({ block: 'start' })");
    await wait(400);
    await shot('alerts-dropdown');
    out.dropdown = dd;

    // ---- Sound settings ----
    const snd = {};
    await click('#sfxSeg [data-val="soft"]');
    await wait(900);
    snd.sfxSoft = (await live()).alerts.sfx;
    snd.levelSoft = await run('level() / vol()');
    await click('#sfxSeg [data-val="full"]');
    await click('#paceSeg [data-val="normal"]');
    await wait(900);
    snd.paceNormal = (await live()).alerts.pace;
    await click('#paceSeg [data-val="clear"]');
    await click('.vcard[data-voice="off"]');
    await wait(900);
    snd.voiceOff = (await live()).alerts.voiceEngine;
    snd.speechLevelOff = await run('speechLevel()');
    await click('.vcard[data-voice="nat:en_US-lessac-high"]');
    await wait(4000);
    snd.voiceBack = `${(await live()).alerts.voiceEngine}:${(await live()).alerts.naturalVoice}`;
    snd.noteGone = await run("document.getElementById('voiceRetiredNote').hidden");
    await run("document.querySelector('details.more').open = true; document.querySelector('#voiceCards').scrollIntoView()");
    await wait(300);
    await shot('sound-card');
    out.sound = snd;

    // ---- Real speech: synthesis, pace, levelling ----
    const sp = {};
    const t0 = Date.now();
    sp.speakError = await run("speak('Moonbinder! Moonbinder is in the shop.').then(() => null, (e) => String(e))");
    sp.speakMs = Date.now() - t0;
    sp.naturalFailures = await run('naturalFailures');
    try {
      sp.piperArgs = require('child_process').execSync("ps -eo args | grep '[p]iper/piper'").toString().trim().split('\n').map((l) => l.replace(/.*--json-input/, '--json-input'));
    } catch (e) { sp.piperArgs = String(e); }
    // Loudness: render the same things offline and compare short-term levels.
    // (The stand-in's shop alerts are kept out: they'd play into the offline
    // context.)
    await run('window.__realEnqueue = window.__realEnqueue || enqueue; enqueue = async () => {}; queue.length = 0; true');
    for (let i = 0; i < 30 && (await run('playing')); i += 1) await wait(500);
    sp.levels = await run(`(async () => {
      const measure = (buf) => {
        const d = buf.getChannelData(0); const w = Math.floor(buf.sampleRate * 0.4); let best = 0; let peak = 0;
        for (let i = 0; i + w <= d.length; i += Math.floor(w / 2)) { let s = 0; for (let j = i; j < i + w; j += 1) s += d[j] * d[j]; best = Math.max(best, Math.sqrt(s / w)); }
        for (let i = 0; i < d.length; i += 1) peak = Math.max(peak, Math.abs(d[i]));
        const db = (x) => Math.round(200 * Math.log10(Math.max(x, 1e-9))) / 10;
        return { loudest400ms: db(best), peak: db(peak) };
      };
      const Real = window.AudioContext; const res = {};
      const renderWith = async (name, fn) => {
        let off = null;
        window.AudioContext = function () { off = new OfflineAudioContext(1, 48000 * 9, 48000); return off; };
        ctx = null; master = null; voiceBus = null;
        try { await fn(); } finally { window.AudioContext = Real; }
        const buf = await off.startRendering();
        ctx = null; master = null; voiceBus = null;
        res[name] = measure(buf);
      };
      await renderWith('ding', () => SFX.ding());
      await renderWith('chime', () => SFX.chime());
      await renderWith('fanfare', () => SFX.fanfare(false));
      await renderWith('fanfareBig', () => SFX.fanfare(true));
      await renderWith('siren', () => SFX.siren(1.4));
      await renderWith('klaxon', () => SFX.klaxon(3));
      await renderWith('voice', () => speak('Moonbinder! Moonbinder is in the shop.'));
      await renderWith('voiceRaw', async () => {
        const bytes = await window.app.voiceSynthesize('en_US-lessac-high', 'Moon binder! Moon binder is in the shop.', 'clear');
        const c = audio(); const clip = await c.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const s = c.createBufferSource(); s.buffer = clip; s.connect(c.destination); s.start(0.05);
      });
      S.alerts.sfx = 'soft';
      await renderWith('fanfareSoft', () => SFX.fanfare(false));
      S.alerts.sfx = 'full';
      return res;
    })()`);
    // Keep the stand-in's own alerts out of the offline renders below.
    await run('enqueue = async () => {}; queue.length = 0; true');
    for (let i = 0; i < 30 && (await run('playing')); i += 1) await wait(500);
    // Every installed voice through the real processVoice, rendered offline:
    // the first sample (the fade), the peak (under the -3 dB limiter), the
    // loudness, and Piper's flags (each voice's own noise settings).
    sp.perVoice = await run(`(async () => {
      const res = {};
      const Real = window.AudioContext;
      for (const v of VOICES.voices.filter((x) => x.installed)) {
        let off = null;
        window.AudioContext = function () { off = new OfflineAudioContext(1, 48000 * 9, 48000); return off; };
        ctx = null; master = null; voiceBus = null;
        try { await speak('Emberbloom! Emberbloom is in the shop.', { natural: v }); } finally { window.AudioContext = Real; }
        const buf = await off.startRendering();
        ctx = null; master = null; voiceBus = null;
        const d = buf.getChannelData(0);
        let start = 0; while (start < d.length && Math.abs(d[start]) < 1e-4) start += 1;
        let peak = 0; for (let i = 0; i < d.length; i += 1) peak = Math.max(peak, Math.abs(d[i]));
        res[v.name] = { tone: v.tone, noise: v.noise || null, firstLoud: Math.round(Math.abs(d[start + 1]) * 1e4) / 1e4,
          peakDb: Math.round(200 * Math.log10(peak)) / 10 };
      }
      return res;
    })()`);
    try {
      for (const id of ['en_US-lessac-high', 'en_GB-cori-high', 'en_GB-alan-medium']) {
        await run(`window.app.voiceWarm('${id}', 'clear')`);
        await wait(1500);
        const args = require('child_process').execSync("ps -eo args | grep '[p]iper/piper'").toString().trim();
        sp['args:' + id] = (args.includes(id) ? '' : '(another voice was running) ') + (args.includes('--noise_scale') ? args.slice(args.indexOf('--noise_scale')) : 'Piper defaults');
      }
    } catch (e) { sp.argsError = String(e); }
    out.speech = sp;

    await run('if (window.__realEnqueue) enqueue = window.__realEnqueue; true');
    // ---- The game goes quiet while an alert plays, and comes back ----
    const dk = {};
    const g = () => (game() ? game().isAudioMuted() : 'no game');
    dk.ipc = [await run('window.app.duckGame(true)'), g()];
    dk.ipc.push(await run('window.app.duckGame(false)'), g());
    // Keep the stand-in's own shop alerts out of the way for this part.
    await run('queue.length = 0; window.app.onAlerts = () => {}; enqueue = ((real) => async (list) => (list && list.__test ? real(list) : null))(enqueue); true');
    for (let i = 0; i < 60 && (await run('playing')); i += 1) await wait(500);
    await run('window.app.duckGame(false)');
    dk.idleBefore = g();
    await run('window.__q = [sampleAlert(RULES.find((r) => r.id === \'dawn\'))]; window.__q.__test = true; enqueue(window.__q); true');
    await wait(1200);
    dk.during = g();
    let n = 0;
    for (; n < 40 && (await run('playing')); n += 1) await wait(500);
    dk.waitedMs = n * 500;
    await wait(300);
    dk.after = g();
    await run('S.alerts.duckGame = false');
    await run('window.__q = [sampleAlert(RULES.find((r) => r.id === \'ube\'))]; window.__q.__test = true; enqueue(window.__q); true');
    await wait(800);
    dk.whenOff = g();
    await run('S.alerts.duckGame = true');
    out.duck = dk;

    // ---- A real shop alert from the watcher reaches the panel ----
    out.errorsInPanel = await run('window.__errs || []');
  } catch (e) {
    out.errors.push('harness: ' + (e.stack || e));
  }
  fs.writeFileSync(path.join(__dirname, 'sound-result.json'), JSON.stringify(out, null, 2));
  app.exit(0);
});
