// Circuit Sprint renderer: top-down track, camera follows your car.
import { buildTrack, LAPS, CHECKPOINTS } from '/shared/circuit-track.js';
import { ITEM_BY_ID } from '/shared/cosmetics.js';
import { drawAvatar } from '../avatar.js';
import { SnapBuffer, el, fmtTime, bigText } from './common.js';

export const CIRCUIT_HELP = {
  title: 'Circuit Sprint',
  goal: `Drive ${LAPS} laps through every checkpoint. Fastest finish wins. If time runs out, players are ranked by lap, then checkpoint, then distance.`,
  keys: [
    ['↑ or W', 'Accelerate'],
    ['↓ or S', 'Brake / reverse'],
    ['← → or A D', 'Steer'],
    ['H', 'Show / hide this help'],
  ],
  tips: [
    'Stay on the grey track - grass slows you right down.',
    'The glowing gate is your next checkpoint. Missed one? Turn back and drive through it.',
    'Team race: your team scores by everyone\'s placings, so every racer counts!',
  ],
};

const TEAM_COLORS = { red: '#ef233c', blue: '#4361ee' };

export class CircuitView {
  constructor({ me, init, roster, hud, toast }) {
    this.me = me;
    this.init = init;
    this.track = buildTrack();
    this.roster = roster;
    this.toast = toast;
    this.buf = new SnapBuffer('t');
    this.cam = null;
    this.timer = el('div', { class: 'hud-timer' });
    this.lap = el('div', { class: 'hud-big' });
    this.board = el('div', { class: 'hud-board' });
    hud.append(el('div', { class: 'hud-top' }, this.lap, this.timer), this.board);
    this.trackPath = new Path2D();
    const pts = this.track.points;
    this.trackPath.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) this.trackPath.lineTo(p.x, p.y);
    this.trackPath.closePath();
  }

  touchButtons() {
    return [];
  }

  onState(s) {
    this.buf.push(s);
  }

  onEvent(ev) {
    if (ev.text) this.toast(ev.text, 'info');
  }

  draw(ctx, w, h) {
    const s = this.buf.latest;
    const rt = this.buf.renderTime(0.1);
    const players = this.buf.players(rt, ['x', 'y'], ['a']);
    const meP = players.get(this.me);
    const T = this.track;
    const zoom = Math.min(1, Math.max(0.55, Math.min(w, h) / 800));
    if (meP) {
      const lookX = meP.x + Math.cos(meP.a) * (meP.v || 0) * 0.25;
      const lookY = meP.y + Math.sin(meP.a) * (meP.v || 0) * 0.25;
      if (!this.cam) this.cam = { x: lookX, y: lookY };
      this.cam.x += (lookX - this.cam.x) * 0.12;
      this.cam.y += (lookY - this.cam.y) * 0.12;
    }
    const cam = this.cam || { x: 1300, y: 900 };

    ctx.fillStyle = '#52b788';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x, -cam.y);

    // grass pattern
    ctx.fillStyle = '#40916c';
    for (let x = -200; x < T.worldW + 200; x += 200) {
      for (let y = -200; y < T.worldH + 200; y += 200) if (((x + y) / 200) % 2 === 0) ctx.fillRect(x, y, 200, 200);
    }
    // curbs, asphalt, centre line
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = T.width + 18;
    ctx.stroke(this.trackPath);
    ctx.strokeStyle = '#e63946';
    ctx.setLineDash([30, 30]);
    ctx.stroke(this.trackPath);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#495057';
    ctx.lineWidth = T.width;
    ctx.stroke(this.trackPath);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 4;
    ctx.setLineDash([24, 24]);
    ctx.stroke(this.trackPath);
    ctx.setLineDash([]);

    // checkpoints (my next one glows)
    const meS = s && s.players.find((p) => p.id === this.me);
    T.checkpoints.forEach((seg, i) => {
      const a = T.points[seg];
      const b = T.points[(seg + 1) % T.points.length];
      const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      const hw = T.width / 2 + 6;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(ang);
      if (i === 0) {
        for (let k = -hw; k < hw; k += 12) {
          ctx.fillStyle = Math.floor(k / 12) % 2 ? '#fff' : '#111';
          ctx.fillRect(k, -10, 12, 10);
          ctx.fillStyle = Math.floor(k / 12) % 2 ? '#111' : '#fff';
          ctx.fillRect(k, 0, 12, 10);
        }
      }
      const isNext = meS && meS.next === i && meS.done === null;
      ctx.fillStyle = isNext ? `rgba(255,214,10,${0.55 + 0.35 * Math.sin(performance.now() / 150)})` : 'rgba(255,255,255,0.25)';
      ctx.fillRect(-hw, -3, hw * 2, 6);
      ctx.fillStyle = isNext ? '#ffd60a' : '#adb5bd';
      ctx.beginPath();
      ctx.arc(-hw, 0, 9, 0, Math.PI * 2);
      ctx.arc(hw, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // cars
    const order = [...players.values()].sort((a, b) => (a.id === this.me) - (b.id === this.me));
    for (const p of order) this.#car(ctx, p);
    ctx.restore();

    this.#minimap(ctx, w, h, players);

    if (s) {
      if (s.countdown > 0) bigText(ctx, String(s.countdown), w / 2, h / 2, 120);
      else if (s.raceTime < 0.8) bigText(ctx, 'GO!', w / 2, h / 2, 120, '#ffd60a');
      if (meS && meS.off) bigText(ctx, 'Off track!', w / 2, h - 70, 32, '#ffd60a');
      if (meS && meS.done !== null) bigText(ctx, `Finished! ${meS.done.toFixed(2)}s`, w / 2, 90, 40, '#06d6a0');
      this.#hud(s);
    }
  }

  #car(ctx, p) {
    const r = this.roster.get(p.id);
    if (!r) return;
    const body = ITEM_BY_ID[r.avatar?.color]?.value || '#4cc9f0';
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.save();
    ctx.rotate(p.a);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-24, -12, 52, 30);
    if (p.team) {
      ctx.fillStyle = TEAM_COLORS[p.team];
      ctx.beginPath();
      ctx.roundRect(-30, -19, 60, 38, 10);
      ctx.fill();
    }
    ctx.fillStyle = '#212529';
    ctx.fillRect(-18, -18, 12, 6);
    ctx.fillRect(8, -18, 12, 6);
    ctx.fillRect(-18, 12, 12, 6);
    ctx.fillRect(8, 12, 12, 6);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(-26, -14, 52, 28, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(10, -10, 8, 20);
    ctx.fillStyle = '#ffd60a';
    ctx.fillRect(22, -12, 4, 6);
    ctx.fillRect(22, 6, 4, 6);
    ctx.restore();
    drawAvatar(ctx, r.avatar, 0, -6, 28);
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    const name = p.id === this.me ? 'You' : r.name;
    ctx.strokeText(name, 0, -30);
    ctx.fillStyle = p.id === this.me ? '#ffd60a' : '#fff';
    ctx.fillText(name, 0, -30);
    ctx.restore();
  }

  #minimap(ctx, w, h, players) {
    const T = this.track;
    const mw = Math.min(200, w * 0.28);
    const sc = mw / T.worldW;
    const mh = T.worldH * sc;
    const x0 = 12;
    const y0 = h - mh - 12;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(x0 - 6, y0 - 6, mw + 12, mh + 12, 10);
    ctx.fill();
    ctx.translate(x0, y0);
    ctx.scale(sc, sc);
    ctx.strokeStyle = '#adb5bd';
    ctx.lineWidth = T.width * 0.6;
    ctx.stroke(this.trackPath);
    for (const p of players.values()) {
      const r = this.roster.get(p.id);
      ctx.fillStyle = p.id === this.me ? '#ffd60a' : p.team ? TEAM_COLORS[p.team] : ITEM_BY_ID[r?.avatar?.color]?.value || '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.id === this.me ? 60 : 45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  #hud(s) {
    if (s === this.lastHud) return;
    this.lastHud = s;
    const meS = s.players.find((p) => p.id === this.me);
    const rows = [...s.players].sort((a, b) => (a.done ?? 1e9) - (b.done ?? 1e9) || b.prog - a.prog);
    const pos = rows.findIndex((p) => p.id === this.me) + 1;
    this.timer.textContent = `⏱ ${fmtTime(s.timeLeft)}`;
    this.timer.classList.toggle('urgent', s.timeLeft <= 15);
    this.lap.textContent = meS ? `Lap ${meS.lap}/${LAPS} · CP ${meS.cp}/${CHECKPOINTS} · ${ordinal(pos)}` : '';
    this.board.replaceChildren(
      el('div', { class: 'hud-board-title' }, this.init.teams ? 'Team race' : 'Positions'),
      ...rows.map((p, i) =>
        el(
          'div',
          { class: `hud-row${p.id === this.me ? ' me' : ''}` },
          el('span', { class: 'rank' }, `${i + 1}`),
          p.team ? el('span', { class: `team-dot ${p.team}` }) : null,
          el('span', { class: 'name' }, this.roster.get(p.id)?.name || '?'),
          el('span', { class: 'val' }, p.done !== null ? `${p.done.toFixed(1)}s` : `L${p.lap}`),
        ),
      ),
    );
  }

  destroy() {}
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
