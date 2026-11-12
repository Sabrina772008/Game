// Tower Rush: race up a timed obstacle tower. First to the top wins; when time
// runs out, everyone else is ranked by the highest point they reached.
import { BaseGame, placementCoins } from './base.js';
import { buildTower, platformAt, sawAt, PLAYER_W, PLAYER_H } from '../../shared/tower-level.js';

const GRAVITY = 1800;
const JUMP_V = 720;
const RUN = 260;
const MAX_FALL = 1000;
const TIME_LIMIT = 180;
const AFTER_FIRST = 30; // seconds left for others once someone finishes
const COUNTDOWN = 3;

export class TowerGame extends BaseGame {
  static id = 'tower';
  static title = 'Tower Rush';
  static minPlayers = 1;

  constructor(opts) {
    super(opts);
    this.level = buildTower(this.seed);
    this.endTime = COUNTDOWN + TIME_LIMIT;
    let i = 0;
    const n = this.players.size;
    for (const p of this.players.values()) {
      p.x = this.level.width / 2 + (i++ - (n - 1) / 2) * 40;
      p.y = this.level.groundY;
      p.vx = 0;
      p.vy = 0;
      p.ground = 0; // index of platform we stand on, or -1
      p.coyote = 0;
      p.jumpBuffer = 0;
      p.prevJump = false;
      p.cp = 0;
      p.best = p.y;
      p.finishedAt = null;
      p.invuln = 0;
      p.facing = 1;
    }
    this.prevPos = this.level.platforms.map((pl) => platformAt(pl, 0));
  }

  init() {
    return { roster: this.roster(), seed: this.seed, timeLimit: TIME_LIMIT, countdown: COUNTDOWN };
  }

  update(dt) {
    if (this.result) return;
    const steps = 2;
    for (let i = 0; i < steps; i++) this.step(dt / steps);
    const active = [...this.players.values()].filter((p) => !p.left);
    if (active.length === 0 || active.every((p) => p.finishedAt !== null) || this.time >= this.endTime) this.finish();
  }

  step(dt) {
    const prevT = this.time;
    this.time += dt;
    if (this.time < COUNTDOWN) return;
    const t = this.time - COUNTDOWN;
    const plats = this.level.platforms;
    const now = plats.map((pl) => platformAt(pl, t));
    const before = plats.map((pl) => platformAt(pl, Math.max(0, prevT - COUNTDOWN)));

    for (const p of this.players.values()) {
      if (p.left || p.finishedAt !== null) continue;
      const k = p.keys;
      // ride the platform we're standing on
      if (p.ground >= 0) {
        p.x += now[p.ground].x - before[p.ground].x;
        p.y = now[p.ground].y;
      }
      const dir = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      if (dir) p.facing = dir;
      p.vx += (dir * RUN - p.vx) * Math.min(1, dt * 14);
      p.x = Math.max(PLAYER_W / 2, Math.min(this.level.width - PLAYER_W / 2, p.x + p.vx * dt));

      const jumpHeld = k.jump || k.up;
      if (jumpHeld && !p.prevJump) p.jumpBuffer = 0.12;
      p.prevJump = jumpHeld;
      p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
      p.coyote = Math.max(0, p.coyote - dt);
      if (p.jumpBuffer > 0 && (p.ground >= 0 || p.coyote > 0)) {
        p.vy = -JUMP_V;
        p.ground = -1;
        p.coyote = 0;
        p.jumpBuffer = 0;
      }

      // walked off the edge?
      if (p.ground >= 0) {
        const pl = plats[p.ground];
        const pos = now[p.ground];
        if (p.x + PLAYER_W / 2 < pos.x || p.x - PLAYER_W / 2 > pos.x + pl.w) {
          p.ground = -1;
          p.coyote = 0.08;
        }
      }

      if (p.ground < 0) {
        p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
        const prevBottom = p.y;
        p.y += p.vy * dt;
        if (p.vy >= 0) {
          let landed = -1;
          let landY = Infinity;
          for (let i = 0; i < plats.length; i++) {
            const pl = plats[i];
            const pos = now[i];
            if (p.x + PLAYER_W / 2 <= pos.x || p.x - PLAYER_W / 2 >= pos.x + pl.w) continue;
            if (prevBottom <= before[i].y + 1 && p.y >= pos.y && pos.y < landY) {
              landed = i;
              landY = pos.y;
            }
          }
          if (landed >= 0) {
            p.y = landY;
            p.vy = 0;
            p.ground = landed;
            this.onLand(p, landed);
          }
        }
      }
      if (p.y < p.best) p.best = p.y;

      // hazards
      p.invuln = Math.max(0, p.invuln - dt);
      if (p.invuln === 0 && this.hitHazard(p, t)) this.respawn(p);
    }
  }

  hitHazard(p, t) {
    const left = p.x - PLAYER_W / 2 + 3;
    const right = p.x + PLAYER_W / 2 - 3;
    const top = p.y - PLAYER_H + 4;
    const bottom = p.y;
    for (const h of this.level.hazards) {
      if (h.type === 'spikes') {
        if (right > h.x && left < h.x + h.w && bottom > h.y && top < h.y + h.h + 2) return true;
      } else if (h.type === 'saw') {
        const s = sawAt(h, t);
        const cx = Math.max(left, Math.min(right, s.x));
        const cy = Math.max(top, Math.min(bottom, s.y));
        if (Math.hypot(cx - s.x, cy - s.y) < h.r) return true;
      }
    }
    return false;
  }

  onLand(p, index) {
    const pl = this.level.platforms[index];
    if (pl.kind === 'spiky') return this.respawn(p);
    if (pl.kind === 'checkpoint') {
      const cpIndex = this.level.checkpoints.findIndex((c) => c.platform === index);
      if (cpIndex > p.cp) {
        p.cp = cpIndex;
        this.emit({ kind: 'toast', to: [p.id], text: `Checkpoint! Floor ${pl.floor} reached.` });
      }
    }
    if (pl.kind === 'goal' && p.finishedAt === null) {
      p.finishedAt = this.time - COUNTDOWN;
      const first = [...this.players.values()].filter((o) => o.finishedAt !== null).length === 1;
      this.emit({ kind: 'toast', text: `${p.name} reached the top in ${p.finishedAt.toFixed(1)}s!` });
      if (first) this.endTime = Math.min(this.endTime, this.time + AFTER_FIRST);
    }
  }

  respawn(p) {
    const cp = this.level.checkpoints[p.cp];
    p.x = cp.x;
    p.y = cp.y;
    p.vx = 0;
    p.vy = 0;
    p.ground = cp.platform;
    p.invuln = 1;
    this.emit({ kind: 'ouch', to: [p.id], text: 'Ouch! Back to your checkpoint.' });
  }

  progress(p) {
    const { startY, goalY } = this.level;
    return Math.max(0, Math.min(1, (startY - p.best) / (startY - goalY)));
  }

  finish() {
    const list = [...this.players.values()];
    list.sort((a, b) => {
      if (a.left !== b.left) return a.left ? 1 : -1;
      if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
      if (a.finishedAt !== null) return -1;
      if (b.finishedAt !== null) return 1;
      return a.best - b.best; // smaller y = higher up
    });
    const placements = list.map((p, i) => ({
      userId: p.id,
      name: p.name,
      avatar: p.avatar,
      rank: i + 1,
      label: p.left ? 'Left the match' : p.finishedAt !== null ? `Reached the top in ${p.finishedAt.toFixed(2)}s` : `Climbed ${Math.round(this.progress(p) * 100)}% of the tower`,
      won: i === 0 && !p.left,
    }));
    const awards = placements
      .filter((pl) => !this.players.get(pl.userId).left)
      .map((pl) => {
        const p = this.players.get(pl.userId);
        return { userId: p.id, coins: placementCoins(pl.rank), won: pl.won, timeMs: p.finishedAt !== null ? p.finishedAt * 1000 : undefined };
      });
    const winner = placements[0];
    this.result = {
      game: 'tower',
      title: 'Tower Rush',
      headline: winner && list[0].finishedAt !== null ? `${winner.name} reached the top first!` : `Time's up! ${winner ? winner.name : 'Nobody'} climbed the highest.`,
      placements,
      awards,
    };
  }

  view() {
    return {
      t: Math.round((this.time - COUNTDOWN) * 1000) / 1000,
      countdown: Math.max(0, Math.ceil(COUNTDOWN - this.time)),
      timeLeft: Math.max(0, Math.ceil(this.endTime - this.time)),
      players: [...this.players.values()]
        .filter((p) => !p.left)
        .map((p) => ({
          id: p.id,
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          f: p.facing,
          g: p.ground >= 0,
          inv: p.invuln > 0,
          done: p.finishedAt !== null ? Math.round(p.finishedAt * 100) / 100 : null,
          prog: Math.round(this.progress(p) * 1000) / 1000,
          floor: this.level.checkpoints[p.cp].floor,
        })),
    };
  }
}
