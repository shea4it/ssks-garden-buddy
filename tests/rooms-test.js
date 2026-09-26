'use strict';
const assert = require('assert');
const rooms = require('../rooms');
let n = 0; const ok = (c, m) => { assert(c, m); n += 1; };
(async () => {
  const answers = { '/api/rooms/LIVE/info': { status: 200, body: '{"numPlayers":4}' }, '/api/rooms/GONE/info': { status: 404, body: 'Not found' }, '/api/rooms/ODD/info': { status: 200, body: '{"hello":1}' } };
  const r = rooms.createRooms({ fetchInfo: async (p) => answers[p] || { status: 500, body: 'boom' } });
  const res = await r.refresh(['LIVE', 'GONE', 'ODD', 'DOWN']);
  const by = Object.fromEntries(res.map((x) => [x.id, x]));
  ok(by.LIVE.players === 4 && by.LIVE.status === 200 && !by.LIVE.sample, 'a live room: count, status, no sample');
  ok(by.GONE.players === 0 && by.GONE.closed && by.GONE.status === 404 && by.GONE.sample === 'Not found', '404: closed, and what it said is kept');
  ok(by.ODD.players === null && /no player count/.test(by.ODD.error) && by.ODD.sample === '{"hello":1}', 'no count in the answer: error with the body');
  ok(by.DOWN.players === null && by.DOWN.error === 'HTTP 500' && by.DOWN.status === 500, 'server error');
  console.log(`rooms: ${n} checks passed`);
})();
(async () => {
  // The endpoint is gone (router 404): unknown, not empty; the next path is tried and remembered.
  let n2 = 0; const ok2 = (c, m) => { assert(c, m); n2 += 1; };
  const calls = [];
  const answers = (p) => {
    calls.push(p);
    if (p.startsWith('/api/rooms/')) return { status: 404, body: 'Not found (router)' };
    if (p === '/platform/v1/rooms/LIVE/info') return { status: 200, body: '{"numPlayers":5}' };
    if (p === '/platform/v1/rooms/DEAD/info') return { status: 404, body: 'Not found (router)' };
    if (p === '/platform/v1/rooms/DEAD') return { status: 404, body: 'Not found (router)' };
    return { status: 500, body: 'x' };
  };
  const r = rooms.createRooms({ fetchInfo: async (p) => answers(p) });
  const res = await r.refresh(['LIVE']);
  ok2(res[0].players === 5 && res[0].path === '/platform/v1/rooms/LIVE/info', 'old path dead, the platform path answers: ' + JSON.stringify(res[0]));
  const before = calls.length;
  await r.refresh(['LIVE']);
  ok2(calls.length - before === 1 && calls[calls.length - 1] === '/platform/v1/rooms/LIVE/info', 'the working path is remembered (one call, no retry of the dead one)');
  const dead = await r.refresh(['DEAD']);
  ok2(dead[0].players === null && /no longer answers/.test(dead[0].error) && dead[0].closed === false, 'every path dead: unknown, never "empty"');
  ok2(rooms.readInfo(404, 'Not found (router)').gone === true && rooms.readInfo(404, 'no such room').closed === true, 'router 404 vs room 404');
  console.log(`rooms (fallback): ${n2} checks passed`);
})();
(async () => {
  // Your sample's case: the old path is a router 404, the guessed platform
  // path answers a plain "404 Not Found" for a live room. That must read as
  // "the lookup is gone" (unknown), never "closed, 0 players"; once every
  // path is dead, nothing more is fetched.
  const fresh = require.resolve('../rooms');
  delete require.cache[fresh];
  const roomsFresh = require('../rooms');
  let n3 = 0; const ok3 = (c, m) => { assert(c, m); n3 += 1; };
  const calls = [];
  const r = roomsFresh.createRooms({ fetchInfo: async (p) => {
    calls.push(p);
    if (p.startsWith('/api/rooms/')) return { status: 404, body: 'Not found (router)' };
    return { status: 404, body: '404 Not Found' };
  } });
  const res = await r.refresh(['AAAA', 'BBBB']);
  ok3(res.every((x) => x.players === null && !x.closed), 'plain 404 on a guessed path: unknown, not closed: ' + JSON.stringify(res.map((x) => [x.id, x.players, x.closed])));
  ok3(r.lookupDead() === true, 'every path dead: remembered');
  const before = calls.length;
  const again = await r.refresh(['CCCC']);
  ok3(calls.length === before && again[0].players === null, 'after that, no more requests');
  // The original path's own 404 still means a closed room.
  delete require.cache[fresh];
  const r2 = require('../rooms').createRooms({ fetchInfo: async () => ({ status: 404, body: 'no such room' }) });
  const c = await r2.refresh(['GONE']);
  ok3(c[0].closed === true && c[0].players === 0, 'original path 404 (not the router): closed');
  console.log(`rooms (dead lookup): ${n3} checks passed`);
})();
