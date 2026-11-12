// Circuit Sprint track, shared by the server (physics, checkpoints) and the
// browser (drawing). The centerline is a smoothed closed loop.

export const TRACK_WIDTH = 160;
export const LAPS = 3;
export const CHECKPOINTS = 10;

const CONTROL = [
  [500, 300], [1100, 220], [1700, 300], [2200, 420], [2350, 800], [2100, 1050],
  [1650, 900], [1300, 1050], [1450, 1350], [2050, 1450], [1900, 1650], [1100, 1650],
  [600, 1550], [350, 1200], [600, 900], [380, 600],
];

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

export function buildTrack() {
  const pts = [];
  const n = CONTROL.length;
  const per = 16;
  for (let i = 0; i < n; i++) {
    const p0 = CONTROL[(i - 1 + n) % n];
    const p1 = CONTROL[i];
    const p2 = CONTROL[(i + 1) % n];
    const p3 = CONTROL[(i + 2) % n];
    for (let s = 0; s < per; s++) {
      const [x, y] = catmullRom(p0, p1, p2, p3, s / per);
      pts.push({ x, y });
    }
  }
  const N = pts.length;
  const checkpoints = [];
  for (let c = 0; c < CHECKPOINTS; c++) checkpoints.push(Math.floor((c * N) / CHECKPOINTS));
  return { points: pts, width: TRACK_WIDTH, checkpoints, worldW: 2700, worldH: 1900 };
}

/** Nearest centerline segment to (x, y): index, distance, and the closest point. */
export function nearestOnTrack(track, x, y) {
  const pts = track.points;
  let best = { i: 0, d: Infinity, px: 0, py: 0 };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby || 1;
    let t = ((x - a.x) * abx + (y - a.y) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { i, d, px, py, t };
  }
  return best;
}

/** Starting grid: two columns behind each other just after the start line. */
export function gridSlot(track, index) {
  const pts = track.points;
  const row = Math.floor(index / 2);
  const col = index % 2;
  const seg = 2 + row * 3;
  const a = pts[seg];
  const b = pts[seg + 1];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const side = (col ? 1 : -1) * 35;
  return {
    x: a.x - Math.sin(ang) * side,
    y: a.y + Math.cos(ang) * side,
    angle: ang,
    seg,
  };
}
