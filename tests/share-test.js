'use strict';
const assert = require('assert');
const share = require('../share');
let n = 0; const ok = (c, m) => { assert(c, m); n += 1; };

// 1. The body: minimal, real name and coins, no other players, guests never.
let b = share.body({ playerId: 'u_abc', playerName: 'Spread', coins: 1234.7, roomId: 'CJJB', playersCount: 4, isPrivate: false, version: '0.30.0' });
ok(b.playerId === 'u_abc' && b.playerName === 'Spread' && b.coins === 1234 && b.modVersion === 'garden-buddy 0.30.0', 'player fields');
ok(b.room.id === 'CJJB' && b.room.playersCount === 4 && b.room.isPrivate === false && !('userSlots' in b.room) && !('state' in b), 'room only: no other players, no state');
ok(share.body({ playerId: 'p_guest1', roomId: 'X' }) === null, 'guests are never sent');
ok(share.body({ playerId: null }) === null, 'no id: nothing');
ok(!share.body({ playerId: 'u_a', roomId: null }).room, 'not in a room: no room field');
ok(share.body({ playerId: 'u_a', roomId: 'A', playersCount: 9 }).room.playersCount === undefined, 'a count outside 0-6 is left out');

// 2. Cadence: start sends; unchanged checks don't; the fifth quiet check does; a change does.
(async () => {
  const posts = [];
  let snap = { playerId: 'u_a', playerName: 'A', coins: 5, roomId: 'ROOM', playersCount: 2 };
  const events = [];
  const s = share.createSharer({ getSnapshot: () => snap, fetchImpl: async (url, opts) => { posts.push(JSON.parse(opts.body)); return { ok: true, status: 204, text: async () => '' }; }, onEvent: (e) => events.push(e.kind), version: '1' });
  await s.start();
  ok(posts.length === 1 && posts[0].room.id === 'ROOM' && posts[0].room.playersCount === 2, 'start: one report');
  for (let i = 0; i < 4; i += 1) await s.tick('check');
  ok(posts.length === 1, 'four quiet checks: nothing sent');
  await s.tick('check');
  ok(posts.length === 2, 'fifth quiet check: heartbeat');
  snap = Object.assign({}, snap, { playersCount: 3 });
  await s.tick('check');
  ok(posts.length === 3 && posts[2].room.playersCount === 3, 'a change is sent at once');
  await s.nudge();
  ok(posts.length === 3, 'nudge with nothing new: nothing');
  snap = Object.assign({}, snap, { roomId: 'NEW' });
  await s.nudge();
  ok(posts.length === 4 && posts[3].room.id === 'NEW', 'nudge on a room change sends');
  ok(s.status().on && s.status().sent === 4 && s.status().room === 'NEW', 'status');
  // 3. Stop sends one last report without a room (closes it on the list).
  await s.stop('off');
  ok(posts.length === 5 && !('room' in posts[4]) && posts[4].playerId === 'u_a', 'stop: a closing report without a room');
  ok(!s.status().on && s.status().stoppedBy === 'off', 'off');
  await s.tick('check');
  ok(posts.length === 5, 'off: nothing more');

  // 4. Refusals: 403 stops sharing (no closing report); 429 backs off a minute; 500 keeps trying.
  const p2 = []; let code = 403;
  const ev2 = [];
  const s2 = share.createSharer({ getSnapshot: () => snap, fetchImpl: async () => { p2.push(code); return { ok: false, status: code, text: async () => 'API key required for this player' }; }, onEvent: (e) => ev2.push(e.kind), version: '1' });
  await s2.start();
  ok(!s2.status().on && s2.status().stoppedBy === 'refused' && /403/.test(s2.status().lastError) && ev2.includes('stopped') && p2.length === 1, '403: stopped, no closing report');
  code = 429;
  const s3 = share.createSharer({ getSnapshot: () => snap, fetchImpl: async () => { p2.push(code); return { ok: false, status: code, text: async () => '' }; }, version: '1' });
  await s3.start();
  const r = await s3.tick('check');
  ok(s3.status().on && r.skipped === 'backoff', '429: still on, waiting a minute');
  code = 500;
  const s4 = share.createSharer({ getSnapshot: () => snap, fetchImpl: async () => { p2.push(code); return { ok: false, status: code, text: async () => 'boom' }; }, version: '1' });
  await s4.start();
  ok(s4.status().on && /500/.test(s4.status().lastError), '500: still on, error kept');
  // 5. A network failure is an error, not a stop.
  const s5 = share.createSharer({ getSnapshot: () => snap, fetchImpl: async () => { throw new Error('offline'); }, version: '1' });
  await s5.start();
  ok(s5.status().on && s5.status().lastError === 'offline', 'offline: still on');
  // 6. Not signed in: nothing is sent, still on.
  snap = { playerId: null };
  const p6 = [];
  const s6 = share.createSharer({ getSnapshot: () => snap, fetchImpl: async (u, o) => { p6.push(o.body); return { ok: true, status: 204, text: async () => '' }; }, version: '1' });
  await s6.start();
  ok(p6.length === 0 && s6.status().on, 'no player yet: nothing sent, still on');
  for (const x of [s3, s4, s5, s6]) x._state.on = false, clearTimeout(x._state.timer);
  console.log(`share: ${n} checks passed`);
  process.exit(0);
})();
