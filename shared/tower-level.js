// Tower Rush level builder. The server and the browser both call
// buildTower(seed) so they agree on every platform, saw and spike.
import { mulberry32 } from './random.js';

export const TOWER_W = 900;
export const FLOORS = 8;
export const STEPS_PER_FLOOR = 6;
export const STEP_H = 100;
export const PLAYER_W = 28;
export const PLAYER_H = 36;
export const PLATFORM_H = 16;

const lerp = (a, b, t) => a + (b - a) * t;

export function buildTower(seed) {
  const rnd = mulberry32(seed);
  const height = FLOORS * (STEPS_PER_FLOOR + 1) * STEP_H + 400;
  const platforms = [];
  const hazards = [];
  const checkpoints = [];
  const groundY = height - 40;
  platforms.push({ x: 0, y: groundY, w: TOWER_W, h: 40, kind: 'ground' });
  checkpoints.push({ x: TOWER_W / 2, y: groundY, floor: 0, platform: 0 });

  let curX = TOWER_W / 2;
  let y = groundY;
  for (let f = 0; f < FLOORS; f++) {
    const d = f / (FLOORS - 1);
    for (let s = 0; s < STEPS_PER_FLOOR; s++) {
      y -= STEP_H;
      const w = Math.round(lerp(190, 78, d) + rnd() * 30);
      let dir = rnd() < 0.5 ? -1 : 1;
      const dx = lerp(90, 165, d) + rnd() * 25;
      let nx = curX + dir * dx;
      const min = w / 2 + 20;
      const max = TOWER_W - w / 2 - 20;
      if (nx < min || nx > max) {
        dir = -dir;
        nx = curX + dir * dx;
      }
      nx = Math.max(min, Math.min(max, nx));
      const p = { x: Math.round(nx - w / 2), y, w, h: PLATFORM_H, kind: 'normal' };
      if (f >= 1 && rnd() < lerp(0.15, 0.55, d)) {
        p.move = { ax: Math.round(lerp(50, 120, d)), ay: 0, period: 3 + rnd() * 1.5, phase: rnd() * Math.PI * 2 };
        // keep the moving platform inside the tower walls
        p.x = Math.max(p.move.ax + 10, Math.min(TOWER_W - w - p.move.ax - 10, p.x));
      } else if (f >= 4 && rnd() < 0.2) {
        p.move = { ax: 0, ay: 35, period: 2.5 + rnd(), phase: rnd() * Math.PI * 2 };
      }
      platforms.push(p);

      // decoy platform covered in spikes on the other side
      if (f >= 2 && rnd() < lerp(0.25, 0.5, d)) {
        const sx = curX - dir * dx * 0.9;
        const sw = 90;
        if (sx - sw / 2 > 10 && sx + sw / 2 < TOWER_W - 10) {
          platforms.push({ x: Math.round(sx - sw / 2), y, w: sw, h: PLATFORM_H, kind: 'spiky' });
          hazards.push({ type: 'spikes', x: Math.round(sx - sw / 2), y: y - 12, w: sw, h: 12 });
        }
      }
      // sweeping saw between this step and the one below it
      if (f >= 3 && rnd() < lerp(0.3, 0.6, d)) {
        hazards.push({
          type: 'saw',
          x: TOWER_W / 2,
          y: y + 40, // between the steps: clears players standing below, so jumps must be timed
          r: 16,
          ax: TOWER_W / 2 - 60,
          period: lerp(6, 3.6, d) + rnd(),
          phase: rnd() * Math.PI * 2,
        });
      }
      curX = p.x + w / 2;
    }
    // checkpoint ledge at the end of each floor (the top one is the goal)
    y -= STEP_H;
    const last = f === FLOORS - 1;
    const cw = last ? 320 : 240;
    let cx = Math.max(cw / 2 + 10, Math.min(TOWER_W - cw / 2 - 10, curX));
    const ledge = { x: Math.round(cx - cw / 2), y, w: cw, h: PLATFORM_H + 6, kind: last ? 'goal' : 'checkpoint', floor: f + 1 };
    platforms.push(ledge);
    if (!last) checkpoints.push({ x: cx, y, floor: f + 1, platform: platforms.length - 1 });
    curX = cx;
  }
  const goal = platforms[platforms.length - 1];
  return { width: TOWER_W, height, groundY, platforms, hazards, checkpoints, goal, startY: groundY, goalY: goal.y };
}

/** Position of a (possibly moving) platform at time t seconds. */
export function platformAt(p, t) {
  if (!p.move) return { x: p.x, y: p.y };
  const s = Math.sin((t / p.move.period) * Math.PI * 2 + p.move.phase);
  return { x: p.x + s * p.move.ax, y: p.y + s * p.move.ay };
}

export function sawAt(h, t) {
  return { x: h.x + Math.sin((t / h.period) * Math.PI * 2 + h.phase) * h.ax, y: h.y };
}
