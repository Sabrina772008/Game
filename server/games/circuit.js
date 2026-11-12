// Circuit Sprint: top-down car race with checkpoints, laps and a time limit.
// Ranked by finish time, then by laps + checkpoints + distance when time runs out.
// Team mode adds up teammates' placements; the winning team earns a bonus.
import { BaseGame, placementCoins, mulberry32 } from './base.js';
import { buildTrack, nearestOnTrack, gridSlot, LAPS, CHECKPOINTS } from '../../shared/circuit-track.js';

const TIME_LIMIT = 150;
const COUNTDOWN = 3;
const AFTER_FIRST = 30;
const MAX_SPEED = 520;
const GRASS_SPEED = 190;
const ACCEL = 620;
const BRAKE = 950;
const REVERSE = 170;
const DRAG = 260;
const TURN = 2.9;
const TEAM_BONUS = 30;

const track = buildTrack();
const N = track.points.length;
const CP_SPACING = N / CHECKPOINTS;

export class CircuitGame extends BaseGame {
  static id = 'circuit';
  static title = 'Circuit Sprint';
  static minPlayers = 1;

  constructor(opts) {
    super(opts);
    this.teams = !!this.options.teams;
    this.endTime = COUNTDOWN + TIME_LIMIT;
    const rnd = mulberry32(this.seed);
    const order = [...this.players.values()].sort(() => rnd() - 0.5);
    order.forEach((p, i) => {
      const g = gridSlot(track, i);
      p.x = g.x;
      p.y = g.y;
      p.angle = g.angle;
      p.speed = 0;
      p.passed = 0; // checkpoints passed in total
      p.next = 1; // next checkpoint index to hit
      p.seg = g.seg;
      p.offTrack = false;
      p.finishedAt = null;
      p.lapTimes = [];
      p.lapStart = 0;
    });
  }

  init() {
    return { roster: this.roster(), teams: this.teams, laps: LAPS, timeLimit: TIME_LIMIT, countdown: COUNTDOWN };
  }

  update(dt) {
    if (this.result) return;
    this.time += dt;
    if (this.time >= COUNTDOWN) {
      for (const p of this.players.values()) if (!p.left && p.finishedAt === null) this.drive(p, dt);
    }
    const active = [...this.players.values()].filter((p) => !p.left);
    if (active.length === 0 || active.every((p) => p.finishedAt !== null) || this.time >= this.endTime) this.finish();
  }

  drive(p, dt) {
    const k = p.keys;
    const max = p.offTrack ? GRASS_SPEED : MAX_SPEED;
    if (k.up) p.speed += ACCEL * dt;
    else if (k.down) p.speed -= (p.speed > 0 ? BRAKE : ACCEL * 0.6) * dt;
    else p.speed -= Math.sign(p.speed) * Math.min(Math.abs(p.speed), DRAG * dt);
    if (p.speed > max) p.speed = Math.max(max, p.speed - BRAKE * 1.5 * dt);
    p.speed = Math.max(-REVERSE, p.speed);
    const steer = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const grip = Math.min(1, Math.abs(p.speed) / 160) * Math.sign(p.speed || 1);
    p.angle += steer * TURN * grip * dt;
    p.x += Math.cos(p.angle) * p.speed * dt;
    p.y += Math.sin(p.angle) * p.speed * dt;

    const near = nearestOnTrack(track, p.x, p.y);
    p.seg = near.i;
    p.offTrack = near.d > track.width / 2;
    const limit = track.width / 2 + 110;
    if (near.d > limit) {
      // invisible barrier: nudge back toward the track
      const k2 = limit / near.d;
      p.x = near.px + (p.x - near.px) * k2;
      p.y = near.py + (p.y - near.py) * k2;
      p.speed *= 0.6;
    }

    const cpSeg = track.checkpoints[p.next];
    const ahead = (near.i - cpSeg + N) % N;
    if (ahead < CP_SPACING / 2 && near.d < track.width / 2 + 60) {
      p.passed++;
      const raceTime = this.time - COUNTDOWN;
      if (p.next === 0) {
        p.lapTimes.push(raceTime - p.lapStart);
        p.lapStart = raceTime;
        const lapsDone = Math.floor(p.passed / CHECKPOINTS);
        if (lapsDone >= LAPS) {
          p.finishedAt = raceTime;
          const first = [...this.players.values()].filter((o) => o.finishedAt !== null).length === 1;
          this.emit({ kind: 'toast', text: `${p.name} finished in ${raceTime.toFixed(2)}s!` });
          if (first) this.endTime = Math.min(this.endTime, this.time + AFTER_FIRST);
        } else {
          this.emit({ kind: 'toast', to: [p.id], text: `Lap ${lapsDone + 1} of ${LAPS}!` });
        }
      }
      p.next = (p.next + 1) % CHECKPOINTS;
    }
  }

  /** Race progress as a single number: checkpoints passed plus fraction to the next one. */
  progress(p) {
    const prevSeg = track.checkpoints[(p.next - 1 + CHECKPOINTS) % CHECKPOINTS];
    const frac = Math.min(0.999, ((p.seg - prevSeg + N) % N) / CP_SPACING);
    return p.passed + frac;
  }

  finish() {
    const list = [...this.players.values()];
    list.sort((a, b) => {
      if (a.left !== b.left) return a.left ? 1 : -1;
      if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
      if (a.finishedAt !== null) return -1;
      if (b.finishedAt !== null) return 1;
      return this.progress(b) - this.progress(a);
    });
    const n = list.length;
    const placements = list.map((p, i) => {
      const lap = Math.min(LAPS, Math.floor(p.passed / CHECKPOINTS) + 1);
      const cp = p.passed % CHECKPOINTS;
      return {
        userId: p.id,
        name: p.name,
        avatar: p.avatar,
        team: p.team,
        rank: i + 1,
        label: p.left ? 'Left the race' : p.finishedAt !== null ? `Finished in ${p.finishedAt.toFixed(2)}s` : `Lap ${lap}/${LAPS}, checkpoint ${cp}/${CHECKPOINTS}`,
        won: false,
      };
    });

    let teamResults = null;
    let winningTeam = null;
    if (this.teams) {
      const totals = { red: { points: 0, members: 0, best: Infinity }, blue: { points: 0, members: 0, best: Infinity } };
      for (const pl of placements) {
        const t = totals[pl.team];
        if (!t) continue;
        t.points += n - pl.rank + 1;
        t.members++;
        t.best = Math.min(t.best, pl.rank);
      }
      const score = (t) => (t.members ? t.points / t.members : 0);
      const r = score(totals.red);
      const b = score(totals.blue);
      winningTeam = r > b ? 'red' : b > r ? 'blue' : totals.red.best < totals.blue.best ? 'red' : 'blue';
      teamResults = ['red', 'blue'].map((team) => ({
        team,
        score: Math.round(score(totals[team]) * 100) / 100,
        members: totals[team].members,
        won: team === winningTeam,
      }));
      for (const pl of placements) pl.won = pl.team === winningTeam;
    } else if (placements.length) {
      placements[0].won = true;
    }

    const awards = placements
      .filter((pl) => !this.players.get(pl.userId).left)
      .map((pl) => {
        const p = this.players.get(pl.userId);
        let coins = placementCoins(pl.rank);
        if (this.teams && pl.won) coins += TEAM_BONUS;
        return { userId: p.id, coins, won: pl.won, timeMs: p.finishedAt !== null ? p.finishedAt * 1000 : undefined };
      });

    const top = placements[0];
    let headline;
    if (this.teams) headline = `Team ${winningTeam === 'red' ? 'Red' : 'Blue'} wins the race!`;
    else headline = top && list[0].finishedAt !== null ? `${top.name} wins the race!` : `Time's up! ${top ? top.name : 'Nobody'} was furthest ahead.`;

    this.result = { game: 'circuit', title: 'Circuit Sprint', headline, placements, awards, teams: teamResults };
  }

  view() {
    return {
      t: Math.round(this.time * 1000) / 1000,
      countdown: Math.max(0, Math.ceil(COUNTDOWN - this.time)),
      timeLeft: Math.max(0, Math.ceil(this.endTime - this.time)),
      raceTime: Math.max(0, Math.round((this.time - COUNTDOWN) * 100) / 100),
      players: [...this.players.values()]
        .filter((p) => !p.left)
        .map((p) => ({
          id: p.id,
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          a: Math.round(p.angle * 1000) / 1000,
          v: Math.round(p.speed),
          off: p.offTrack,
          lap: Math.min(LAPS, Math.floor(p.passed / CHECKPOINTS) + 1),
          cp: p.passed % CHECKPOINTS,
          next: p.next,
          prog: Math.round(this.progress(p) * 100) / 100,
          done: p.finishedAt !== null ? Math.round(p.finishedAt * 100) / 100 : null,
          team: p.team,
        })),
    };
  }
}
