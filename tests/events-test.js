'use strict';
// Night from the game's clock, and event themes (v0.67.0).
const ev = require('../events');

let n = 0;
const ok = (cond, what) => {
  if (!cond) throw new Error(`FAIL: ${what}`);
  n += 1;
};
const at = (iso) => Date.parse(iso);
const M = 60000;

// The owner's night alert fired at 17:40:03 UTC on 17 Oct 2026, three
// seconds after the Spooky Shop opened: sunset began 17:40:00.
const sunset = at('2026-10-17T17:40:00Z');
const a = ev.nightInfo(sunset + 3000);
ok(a.on && a.phase === 'sunset' && a.since === sunset && a.endsAt === sunset + 30 * M, 'night at 17:40:03 (sunset)');
ok(a.bonus === 0 && a.darkness < 0.01, 'just after sunset: hardly dark yet');
const mid = ev.nightInfo(sunset + 15 * M);
ok(mid.phase === 'midnight' && mid.darkness === 1 && mid.bonus === 20, 'midnight: full dark, +20 STR');
const half = ev.nightInfo(sunset + 5 * M);
ok(half.bonus === 10, 'halfway through sunset: +10 STR');
const rise = ev.nightInfo(sunset + 25 * M);
ok(rise.phase === 'sunrise' && rise.bonus === 10 && rise.next === sunset + 10 * 3600000, 'sunrise (18:05): fading, +10 STR, next night 10 h on');
const day = ev.nightInfo(sunset + 30 * M);
ok(!day.on && day.next === sunset + 10 * 3600000 && day.endsAt === day.next + 30 * M, 'day at 18:10: the next night is 03:40');
const before = ev.nightInfo(sunset - 1000);
ok(!before.on && before.next === sunset, 'a second before sunset: night is next');
// Every night, every 10 hours, back to 1970: sunset is 9 h 40 m in.
ok(ev.nightInfo(at('2026-10-18T03:40:00Z')).on && !ev.nightInfo(at('2026-10-18T04:10:00Z')).on, 'next night 03:40 to 04:10 UTC');
ok(ev.nightInfo(at('2026-10-18T04:05:00Z')).on, 'the sunrise part crosses the 10-hour mark');
// The Spooky Shop open out of hours still counts (if the game ever moves night).
const shop = ev.nightInfo(at('2026-10-18T00:00:00Z'), at('2026-10-17T23:55:00Z'));
ok(shop.on && shop.fromShop, 'the shop open counts as night');

// Event themes.
const haunt = ev.current(at('2026-10-20T12:00:00Z'), {});
ok(haunt && haunt.id === 'haunt' && haunt.theme === 'spooky' && haunt.source === 'dates', 'the Haunt Event in its dates');
ok(ev.current(at('2026-11-10T00:00:01Z'), {}) === null, 'after it ends: no event');
ok(ev.current(at('2026-11-12T00:00:00Z'), { haunt: at('2026-11-11T12:00:00Z') }).source === 'game', 'still showing in the game (extended): still on');
ok(ev.current(at('2027-10-12T00:00:00Z'), { haunt: at('2027-10-11T19:40:00Z') }).id === 'haunt', 'next year, from the game alone');
ok(ev.current(at('2027-10-14T00:00:00Z'), { haunt: at('2027-10-11T19:40:00Z') }) === null, 'not seen for two days: off');
ok(ev.theme(at('2026-10-20T12:00:00Z'), {}, false) === null, 'event themes switched off: none');
const th = ev.theme(sunset + 15 * M, {}, true);
ok(th && th.id === 'spooky' && th.night && th.darkness === 1, 'the spooky theme, at night');
ok(ev.theme(at('2026-10-20T12:00:00Z'), {}, true).night === false, 'and by day');

console.log(`events: ${n} checks passed`);
