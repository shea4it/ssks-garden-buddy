'use strict';

// Appearance rates for rare shop items, from the Magic Circle Discord's
// #pingspam channel (a DiscordChatExporter JSON export).
//
//   node tests/pingspam-rates.js "path/to/export.json"
//
// People type !omg-<item> when they see it in stock and the "King Mod" bot
// answers "@<Role> PINGSPAM omg!!!". Many people ping the same stock, so the
// bot's pings are clustered into appearances: a new appearance starts when
// the gap since the previous ping is longer than the shop's window (4 min for
// the 5-minute seed shop, 12 min for a 10-minute weather shop, 20 min for
// the lunar shops). The rate per day is appearances / days in the window.
//
// Windows: items that moved to the Dawn/Amber shops on 28 Aug 2026 use the
// window since then when it holds at least MIN_EVENTS appearances, otherwise
// the window since 1 Jun (the rate per day looks similar either side of the
// move); Thunder-shop items since 27 Jun 2026 (shop introduced); Dawn-shop
// items since 10 May 2026; seed-shop items since 1 Jun.
//
// Prints a table and a JSON block to paste into budget.js BASELINE.

const fs = require('fs');

const MIN_EVENTS = 8;
const D = 86400000;
const U = (s) => Date.parse(`${s}T00:00:00Z`);
const MOVE = U('2026-08-28');

// role name in the ping -> { rule id in the app, gap after/before the move (min), windows to try }
const ITEMS = {
  Moonbinder: { id: 'moonbinder', gap: [20, 4], windows: [MOVE, U('2026-06-01')] },
  Dawnbinder: { id: 'dawnbinder', gap: [20, 4], windows: [MOVE, U('2026-06-01')] },
  Dawnbreaker: { id: 'dawnbreaker', gap: [20, 4], windows: [MOVE, U('2026-06-01')] },
  Emberbloom: { id: 'emberbloom', gap: [20, 20], windows: [MOVE] },
  Ube: { id: 'ube', gap: [20, 20], windows: [U('2026-05-10')] },
  Thunderspire: { id: 'thunderspire', gap: [12, 12], windows: [U('2026-06-27')] },
  Milkcap: { id: 'milkcap', gap: [12, 12], windows: [U('2026-06-27')] },
  'Wind Turner': { id: 'windturner', gap: [12, 12], windows: [U('2026-06-27')] },
  // Decor (the "buy everything" line): Thunder shop since 27 Jun; the
  // hourly Decor shop from each one's first ping.
  'Wind Spinner': { id: 'windspinner', gap: [12, 12], windows: [U('2026-06-27')] },
  Cauldron: { id: 'cauldron', gap: [12, 12], windows: [U('2026-06-27')] },
  'Mini Wizard Tower': { id: 'miniwizardtower', gap: [20, 20], windows: [U('2026-06-01'), U('2025-12-16')] },
  'Mini Fairy Castle': { id: 'minifairycastle', gap: [20, 20], windows: [U('2026-06-01'), U('2026-04-28')] },
  'Mythic egg': { id: 'mythicalegg', gap: [4, 4], windows: [U('2026-06-01')] },
  Starweaver: { id: 'starweaver', gap: [4, 4], windows: [U('2026-06-01')] },
  // Patchy pings (the crowd doesn't bother): shown for interest, not shipped.
  'Legendary Egg': { id: null, gap: [4, 4], windows: [U('2026-06-01')] },
  Sunflower: { id: null, gap: [4, 4], windows: [U('2026-06-01')] },
  'Amber egg': { id: 'amberegg', gap: [20, 20], windows: [MOVE] },
  'Amber Moon': { id: null, gap: [20, 20], windows: [MOVE] },
};

function cluster(times, gapMin) {
  const out = [];
  let last = -Infinity;
  for (const t of times) {
    if (t - last > gapMin * 60000) out.push({ t, pings: 0 });
    out[out.length - 1].pings += 1;
    last = t;
  }
  return out;
}

// The export is far too big to parse in one go (hundreds of MB), but it is
// pretty-printed: each message starts with "    {" and its own fields sit at
// six spaces, the author's at eight. So it's read line by line.
async function readPings(file) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  const pat = /^@(.+?) PINGSPAM/i;
  const by = {};
  let cur = null;
  const finish = () => {
    if (cur && cur.bot && cur.content && cur.timestamp) {
      const mm = pat.exec(cur.content);
      if (mm) (by[mm[1].trim()] = by[mm[1].trim()] || []).push(Date.parse(cur.timestamp));
    }
    cur = null;
  };
  for await (const raw of rl) {
    const line = raw.replace(/\r$/, '');
    if (line === '    {') {
      finish();
      cur = { bot: false, content: '', timestamp: '' };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('      "timestamp": "')) cur.timestamp = line.slice(20, line.lastIndexOf('"'));
    else if (line.startsWith('      "content": "')) cur.content = JSON.parse(line.slice(17).replace(/,$/, ''));
    else if (line === '        "isBot": true,') cur.bot = true;
  }
  finish();
  return by;
}

async function main(file) {
  const by = await readPings(file);
  const end = Math.max(...Object.values(by).flat());
  const out = {};
  console.log(`export ends ${new Date(end).toISOString().slice(0, 10)}\n`);
  console.log('item              window       days  appearances  per day   one every   pings/appearance');
  for (const [role, spec] of Object.entries(ITEMS)) {
    const times = (by[role] || []).sort((a, b) => a - b);
    let chosen = null;
    for (const since of spec.windows) {
      const before = cluster(times.filter((t) => t >= since && t < MOVE), spec.gap[1]);
      const after = cluster(times.filter((t) => t >= Math.max(since, MOVE)), spec.gap[0]);
      const ev = since >= MOVE ? after : before.concat(after);
      const days = (end - since) / D;
      chosen = { since, ev, days };
      if (ev.length >= MIN_EVENTS) break;
    }
    const n = chosen.ev.length;
    const perDay = n / chosen.days;
    const pingsPer = n ? chosen.ev.reduce((a, e) => a + e.pings, 0) / n : 0;
    console.log(`${role.padEnd(17)} ${new Date(chosen.since).toISOString().slice(0, 10)}  ${chosen.days.toFixed(1).padStart(6)}  ${String(n).padStart(11)}  ${perDay.toFixed(3).padStart(7)}   ${(perDay ? (1 / perDay).toFixed(1) + ' d' : '-').padStart(9)}   ${pingsPer.toFixed(1).padStart(6)}`);
    if (spec.id) out[spec.id] = { perDay: Number(perDay.toFixed(4)), events: n, days: Number(chosen.days.toFixed(1)), since: new Date(chosen.since).toISOString().slice(0, 10) };
  }
  console.log('\nBASELINE (paste into budget.js):');
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  if (!process.argv[2]) {
    console.error('usage: node tests/pingspam-rates.js export.json');
    process.exit(1);
  }
  main(process.argv[2]).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { cluster, ITEMS };
