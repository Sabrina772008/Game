// Helpers shared by the game renderers.

/** Buffers server snapshots and returns smoothly interpolated player positions. */
export class SnapBuffer {
  constructor(timeKey) {
    this.timeKey = timeKey; // which field in the snapshot is server time (seconds)
    this.snaps = [];
    this.offset = null; // localSeconds - serverSeconds
  }

  push(s) {
    const local = performance.now() / 1000;
    const st = s[this.timeKey];
    const off = local - st;
    // track the smallest offset seen recently (least delayed packet)
    this.offset = this.offset === null ? off : Math.min(off, this.offset + 0.002);
    this.snaps.push(s);
    if (this.snaps.length > 30) this.snaps.shift();
  }

  get latest() {
    return this.snaps[this.snaps.length - 1] || null;
  }

  /** Server time we should render now (slightly in the past for smoothness). */
  renderTime(delay = 0.1) {
    if (this.offset === null) return 0;
    return performance.now() / 1000 - this.offset - delay;
  }

  /** Map id -> interpolated player object. angleKeys get shortest-path lerp. */
  players(rt, keys = ['x', 'y'], angleKeys = []) {
    const snaps = this.snaps;
    const out = new Map();
    if (!snaps.length) return out;
    let a = snaps[0];
    let b = snaps[0];
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i][this.timeKey] <= rt) {
        a = snaps[i];
        b = snaps[i + 1] || snaps[i];
        break;
      }
    }
    const ta = a[this.timeKey];
    const tb = b[this.timeKey];
    const alpha = tb > ta ? Math.max(0, Math.min(1, (rt - ta) / (tb - ta))) : 1;
    const prev = new Map(a.players.map((p) => [p.id, p]));
    for (const pb of b.players) {
      const pa = prev.get(pb.id) || pb;
      const o = { ...pb };
      for (const k of keys) o[k] = pa[k] + (pb[k] - pa[k]) * alpha;
      for (const k of angleKeys) {
        let d = pb[k] - pa[k];
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        o[k] = pa[k] + d * alpha;
      }
      out.set(pb.id, o);
    }
    return out;
  }
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function bigText(ctx, text, x, y, size = 64, color = '#fff') {
  ctx.save();
  ctx.font = `900 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size / 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
