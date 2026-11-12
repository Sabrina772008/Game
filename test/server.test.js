// End-to-end server tests: accounts, rooms, a full match over WebSockets,
// reconnecting mid-match, one-time prize awards, shop and call signaling.
// Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';

let app;
let base;

before(async () => {
  app = createServer({ dbPath: ':memory:' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(() => app.close());

async function post(path, body, token) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

/** A test client that records every message and can wait for a specific one. */
function client(token) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const msgs = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    msgs.push(m);
    for (const w of [...waiters]) {
      if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  };
  const c = {
    ws,
    msgs,
    send: (m) => ws.send(JSON.stringify(m)),
    wait(pred, ms = 4000) {
      const found = msgs.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      });
    },
    next(pred, ms) {
      msgs.length = 0;
      return c.wait(pred, ms);
    },
  };
  return new Promise((resolve) => {
    ws.onopen = () => {
      c.send({ t: 'auth', token });
      resolve(c);
    };
  });
}

test('sign up, sign in and bad passwords', async () => {
  const a = await post('/api/signup', { username: 'alice', password: 'secret1' });
  assert.equal(a.status, 200);
  assert.equal(a.data.profile.coins, 0);
  assert.ok(a.data.profile.unlocked.includes('c_sky'));
  const dup = await post('/api/signup', { username: 'ALICE', password: 'secret1' });
  assert.equal(dup.status, 400);
  const bad = await post('/api/login', { username: 'alice', password: 'nope!!' });
  assert.equal(bad.status, 400);
  const ok = await post('/api/login', { username: 'alice', password: 'secret1' });
  assert.equal(ok.status, 200);
  const me = await fetch(base + '/api/me', { headers: { authorization: `Bearer ${ok.data.token}` } }).then((r) => r.json());
  assert.equal(me.profile.username, 'alice');
});

test('full match: room, ready, start, reconnect, results and one-time coins', async () => {
  const p1 = (await post('/api/signup', { username: 'racer1', password: 'pass123' })).data;
  const p2 = (await post('/api/signup', { username: 'racer2', password: 'pass123' })).data;
  const c1 = await client(p1.token);
  const c2 = await client(p2.token);
  await c1.wait((m) => m.t === 'hello');
  await c2.wait((m) => m.t === 'hello');

  c1.send({ t: 'room:create' });
  const r1 = await c1.wait((m) => m.t === 'room' && m.room);
  const code = r1.room.code;
  assert.match(code, /^[A-Z0-9]{5}$/);

  c2.send({ t: 'room:join', code });
  await c2.wait((m) => m.t === 'room' && m.room && m.room.members.length === 2);

  c1.send({ t: 'room:select', game: 'circuit', options: { teams: true } });
  await c1.next((m) => m.t === 'room' && m.room.selected.game === 'circuit' && m.room.selected.options.teams);

  // can't start until everyone is ready
  c1.send({ t: 'room:start' });
  const err = await c1.wait((m) => m.t === 'error');
  assert.match(err.text, /Waiting for/);

  c1.send({ t: 'room:ready', ready: true });
  c2.send({ t: 'room:ready', ready: true });
  await c1.next((m) => m.t === 'room' && m.room.members.every((x) => x.ready));
  c1.send({ t: 'room:start' });
  const start = await c1.wait((m) => m.t === 'game:start');
  assert.equal(start.game, 'circuit');
  await c2.wait((m) => m.t === 'game:start' && m.matchId === start.matchId);
  await c1.wait((m) => m.t === 'game:state');

  // player 2 refreshes the page mid-match: they get the same match back
  c2.ws.close();
  await new Promise((r) => setTimeout(r, 150));
  const c2b = await client(p2.token);
  const again = await c2b.wait((m) => m.t === 'game:start');
  assert.equal(again.matchId, start.matchId);
  c1.send({ t: 'input', keys: { up: true } });

  // fast-forward: end the race now
  const room = app.rooms.rooms.get(code);
  room.game.endTime = room.game.time;
  const end1 = await c1.wait((m) => m.t === 'game:end', 3000);
  const end2 = await c2b.wait((m) => m.t === 'game:end', 3000);
  assert.equal(end1.results.matchId, start.matchId);
  assert.equal(end1.results.recorded, true);
  assert.equal(end2.results.placements.length, 2);
  assert.ok(end1.results.teams, 'team results present');

  const coins1 = app.store.profile(p1.profile.id).coins;
  const coins2 = app.store.profile(p2.profile.id).coins;
  const expected1 = end1.results.awards.find((a) => a.userId === p1.profile.id).coins;
  assert.equal(coins1, expected1);
  assert.ok(coins1 > 0 && coins2 > 0);

  // Recording the same match again (retry, bug, duplicate message) awards nothing.
  assert.equal(app.store.recordMatch(start.matchId, code, end1.results), false);
  assert.equal(app.store.profile(p1.profile.id).coins, coins1);
  assert.equal(app.store.profile(p2.profile.id).coins, coins2);

  // reconnecting after the match shows results but doesn't award again
  c2b.ws.close();
  await new Promise((r) => setTimeout(r, 150));
  const c2c = await client(p2.token);
  const end3 = await c2c.wait((m) => m.t === 'game:end');
  assert.equal(end3.results.matchId, start.matchId);
  assert.equal(app.store.profile(p2.profile.id).coins, coins2);

  // host returns the group to the lobby
  c1.send({ t: 'room:toLobby' });
  await c2c.wait((m) => m.t === 'room' && m.room.phase === 'lobby');
  assert.equal(app.store.profile(p1.profile.id).stats.circuit.plays, 1);

  // shop: buy something affordable, refuse something too expensive
  const buy = await post('/api/shop/buy', { itemId: 'c_grape' }, p1.token);
  assert.equal(buy.status, 200, JSON.stringify(buy.data));
  assert.equal(buy.data.profile.coins, coins1 - 40);
  const pricey = await post('/api/shop/buy', { itemId: 'a_crown' }, p1.token);
  assert.equal(pricey.status, 400);
  const setBad = await fetch(base + '/api/avatar', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p1.token}` },
    body: JSON.stringify({ avatar: { color: 'c_gold' } }),
  });
  assert.equal(setBad.status, 400);
  const setOk = await fetch(base + '/api/avatar', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p1.token}` },
    body: JSON.stringify({ avatar: { color: 'c_grape', face: 'f_happy' } }),
  });
  assert.equal(setOk.status, 200);

  // call signaling relays offers between players in the call
  c1.send({ t: 'call:join' });
  await c1.wait((m) => m.t === 'call:peers');
  c2c.send({ t: 'call:join' });
  const peers = await c2c.wait((m) => m.t === 'call:peers');
  assert.deepEqual(peers.peers, [p1.profile.id]);
  await c1.wait((m) => m.t === 'call:joined' && m.userId === p2.profile.id);
  c1.send({ t: 'call:signal', to: p2.profile.id, data: { sdp: { type: 'offer', sdp: 'x' } } });
  const sig = await c2c.wait((m) => m.t === 'call:signal');
  assert.equal(sig.from, p1.profile.id);

  for (const c of [c1, c2c]) c.ws.close();
});

test('rejects bad tokens on the socket', async () => {
  const c = await client('not-a-token');
  const m = await c.wait((x) => x.t === 'auth:fail');
  assert.equal(m.t, 'auth:fail');
});
