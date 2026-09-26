'use strict';

// Times the panel's render functions with a real garden loaded. Run like the
// tour (see tests/README.md), with tests/bench-panel.js and MG_SAMPLE set.
// Writes $MG_TEST_DIR/bench-panel.json.
const { app, webContents } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('host-resolver-rules', 'MAP magicgarden.gg 127.0.0.1:8443');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('no-sandbox');

const find = (pred) => webContents.getAllWebContents().find((w) => !w.isDestroyed() && pred(w.getURL()));
const panel = () => find((u) => u.endsWith('control.html'));
const run = (w, js) => w.executeJavaScript(js, true);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

require('../main.js');

app.whenReady().then(async () => {
  const out = { errors: [] };
  try {
    await wait(14000);
    const p = panel();
    if (process.env.MG_SAMPLE) {
      const st = JSON.parse(fs.readFileSync(process.env.MG_SAMPLE, 'utf8')).lastStatus;
      await run(p, `(() => { window.__SAMPLE = ${JSON.stringify(st)}; const real = renderGarden; renderGarden = function () { GARDEN_STATUS = Object.assign({}, window.__SAMPLE, { at: Date.now() }); return real.apply(this, arguments); }; })()`);
    }
    await run(p, "window.app.budgetSet({ unlockMode: 'on' }).then((v) => { BUDGET = v; })");
    await wait(1500);
    const tabs = ['alerts', 'garden', 'money', 'pets'];
    out.byTab = {};
    for (const tab of tabs) {
      out.byTab[tab] = await run(p, `(async () => {
        showTab('${tab}');
        await new Promise((r) => setTimeout(r, 300));
        const time = (fn, n = 20) => { fn(); const t0 = performance.now(); for (let i = 0; i < n; i += 1) fn(); return +((performance.now() - t0) / n).toFixed(2); };
        return {
          renderGarden: time(() => renderGarden()),
          renderBudget: typeof renderBudget === 'function' ? time(() => renderBudget()) : null,
          renderPets: typeof renderPets === 'function' ? time(() => renderPets()) : null,
          clampLongText: time(() => clampLongText()),
          nodes: document.querySelectorAll('main *').length,
        };
      })()`);
    }
  } catch (err) {
    out.errors.push(String(err.stack || err));
  }
  fs.writeFileSync(path.join(process.env.MG_TEST_DIR || __dirname, 'bench-panel.json'), JSON.stringify(out, null, 1));
  app.exit(0);
});
