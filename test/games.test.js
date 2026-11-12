// Game rule tests that run the simulations directly (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SabotageGame } from '../server/games/sabotage.js';
import { TowerGame } from '../server/games/tower.js';
import { CircuitGame } from '../server/games/circuit.js';
import { buildTower, platformAt } from '../shared/tower-level.js';
import { buildTrack } from '../shared/circuit-track.js';
import { TASK_STATIONS } from '../shared/sabotage-map.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({ userId: i + 1, username: `p${i + 1}`, avatar: {} }));
const run = (g, seconds, each) => {
  for (let i = 0; i < seconds * 30 && !g.result; i++) {
    each?.(g);
    g.update(1 / 30);
    g.drainEvents();
  }
};

test('sabotage: crew wins by voting out the saboteur', () => {
  const g = new SabotageGame({ players: players(4), options: {}, seed: 7 });
  run(g, 5);
  const sab = [...g.players.values()].find((p) => p.role === 'saboteur');
  const crew = [...g.players.values()].filter((p) => p.role === 'crew');
  // walk a crewmate to the emergency button (it's right next to spawn)
  crew[0].x = 900;
  crew[0].y = 640;
  g.action(crew[0].id, { a: 'emergency' });
  assert.equal(g.phase, 'meeting');
  for (const p of g.players.values()) g.action(p.id, { a: 'vote', target: sab.id });
  run(g, 1);
  assert.equal(g.phase, 'reveal');
  run(g, 6);
  assert.equal(g.result.winnerSide, 'crew');
  assert.ok(g.result.awards.filter((a) => a.won).every((a) => g.players.get(a.userId).role === 'crew'));
  assert.equal(g.result.awards.find((a) => a.userId === sab.id).coins, 10);
});

test('sabotage: crew wins by finishing every task', () => {
  const g = new SabotageGame({ players: players(3), options: {}, seed: 11 });
  run(g, 5);
  for (const p of g.players.values()) {
    if (p.role !== 'crew') continue;
    for (const t of p.tasks) {
      const st = TASK_STATIONS.find((s) => s.id === t.id);
      p.x = st.x;
      p.y = st.y + 30;
      p.keys = { ...p.keys, action: true };
      run(g, 3.2);
    }
    p.keys = { ...p.keys, action: false };
  }
  assert.equal(g.result?.winnerSide, 'crew');
});

test('sabotage: saboteur wins when the meltdown clock runs out', () => {
  const g = new SabotageGame({ players: players(4), options: {}, seed: 3 });
  run(g, 25);
  const sab = [...g.players.values()].find((p) => p.role === 'saboteur');
  g.action(sab.id, { a: 'sabotage' });
  assert.ok(g.sabotage.active);
  run(g, 45);
  assert.equal(g.result.winnerSide, 'saboteur');
});

test('sabotage: saboteur wins by zapping crew; roles stay hidden from crew', () => {
  const g = new SabotageGame({ players: players(3), options: {}, seed: 5 });
  const sab = [...g.players.values()].find((p) => p.role === 'saboteur');
  const crew = [...g.players.values()].find((p) => p.role === 'crew');
  const v = g.view(crew.id);
  assert.equal(v.players.find((p) => p.id === sab.id).role, undefined);
  run(g, 16);
  crew.x = sab.x + 20;
  crew.y = sab.y;
  g.action(sab.id, { a: 'zap' });
  assert.equal(crew.alive, false);
  assert.equal(g.result.winnerSide, 'saboteur');
});

test('tower: time-out ranks by highest point, then the level is always buildable', () => {
  const g = new TowerGame({ players: players(2), options: {}, seed: 42 });
  g.players.get(2).best = g.level.groundY - 500;
  g.endTime = 3.5;
  run(g, 5);
  assert.equal(g.result.placements[0].userId, 2);
  for (let seed = 1; seed < 50; seed++) {
    const L = buildTower(seed);
    assert.equal(L.platforms.at(-1).kind, 'goal');
    assert.ok(L.checkpoints.length === 8);
    platformAt(L.platforms[5], 1.3);
  }
});

test('tower: first to reach the top wins with a time', () => {
  const g = new TowerGame({ players: players(2), options: {}, seed: 9 });
  run(g, 3.1);
  const goalIndex = g.level.platforms.length - 1;
  const goal = g.level.platforms[goalIndex];
  const p = g.players.get(1);
  p.x = goal.x + goal.w / 2;
  p.y = goal.y - 40;
  p.ground = -1;
  p.vy = 0;
  run(g, 1);
  assert.notEqual(p.finishedAt, null);
  g.endTime = g.time;
  run(g, 0.1);
  assert.equal(g.result.placements[0].userId, 1);
  assert.ok(g.result.awards.find((a) => a.userId === 1).timeMs > 0);
});

test('circuit: an autopilot car completes 3 laps through every checkpoint', () => {
  const track = buildTrack();
  const g = new CircuitGame({ players: players(1), options: {}, seed: 5 });
  run(g, 140, () => {
    const p = g.players.get(1);
    const tgt = track.points[(p.seg + 6) % track.points.length];
    let d = Math.atan2(tgt.y - p.y, tgt.x - p.x) - p.angle;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    p.keys = { up: Math.abs(d) < 0.6 || p.speed < 250, down: Math.abs(d) > 0.9 && p.speed > 300, left: d < -0.05, right: d > 0.05 };
  });
  assert.ok(g.result);
  assert.match(g.result.placements[0].label, /Finished in/);
});

test('circuit: time-out ranks by lap and checkpoint progress; teams combine placings', () => {
  const ps = players(4).map((p, i) => ({ ...p, team: i % 2 ? 'blue' : 'red' }));
  const g = new CircuitGame({ players: ps, options: { teams: true }, seed: 1 });
  run(g, 3.1);
  g.players.get(2).passed = 12; // blue, furthest
  g.players.get(4).passed = 8; // blue
  g.players.get(1).passed = 5; // red
  g.players.get(3).passed = 1; // red
  g.endTime = g.time;
  run(g, 0.1);
  assert.deepEqual(g.result.placements.map((p) => p.userId), [2, 4, 1, 3]);
  assert.equal(g.result.teams.find((t) => t.won).team, 'blue');
  const blueAward = g.result.awards.find((a) => a.userId === 4);
  assert.equal(blueAward.coins, 35 + 30); // 2nd place + team bonus
});
