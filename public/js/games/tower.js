// Tower Rush renderer: side view, camera follows you up the tower.
import { buildTower, platformAt, sawAt, PLAYER_H } from '/shared/tower-level.js';
import { drawAvatar } from '../avatar.js';
import { SnapBuffer, el, fmtTime, bigText } from './common.js';

export const TOWER_HELP = {
  title: 'Tower Rush',
  goal: 'Race to the top of the tower before the timer runs out. First to the top wins. If time runs out, the highest climber wins.',
  keys: [
    ['← → or A D', 'Run'],
    ['Space, ↑ or W', 'Jump'],
    ['H', 'Show / hide this help'],
  ],
  tips: [
    'Moving platforms carry you - wait for them to come close before jumping.',
    'Red spiky platforms and spinning saws send you back to your last checkpoint.',
    'Each wide ledge is a checkpoint for the next floor.',
  ],
};

export class TowerView {
  constructor({ me, init, roster, hud, toast }) {
    this.me = me;
    this.level = buildTower(init.seed);
    this.roster = roster;
    this.buf = new SnapBuffer('t');
    this.toast = toast;
    this.camY = this.level.groundY - 300;
    this.hud = hud;
    this.board = el('div', { class: 'hud-board' });
    this.timer = el('div', { class: 'hud-timer' });
    hud.append(el('div', { class: 'hud-top' }, this.timer), this.board);
  }

  touchButtons() {
    return [{ label: 'Jump', key: 'jump' }];
  }

  onState(s) {
    this.buf.push(s);
  }

  onEvent(ev) {
    if (ev.text) this.toast(ev.text, ev.kind === 'ouch' ? 'bad' : 'info');
  }

  draw(ctx, w, h) {
    const s = this.buf.latest;
    const L = this.level;
    const rt = this.buf.renderTime(0.1);
    const players = this.buf.players(rt);
    const meP = players.get(this.me);

    const scale = Math.min(1.4, w / (L.width + 40));
    const viewH = h / scale;
    if (meP) {
      const target = meP.y - viewH * 0.6;
      this.camY += (target - this.camY) * 0.15;
    }
    this.camY = Math.max(-200, Math.min(L.height - viewH + 40, this.camY));
    const ox = (w - L.width * scale) / 2;

    // sky gets darker and more starry as you climb
    const prog = 1 - Math.max(0, Math.min(1, this.camY / L.height));
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, mix('#8ecae6', '#240046', prog));
    g.addColorStop(1, mix('#ffd6a5', '#5a189a', prog));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(ox, 0);
    ctx.scale(scale, scale);
    ctx.translate(0, -this.camY);
    const top = this.camY - 50;
    const bottom = this.camY + viewH + 50;

    // tower walls
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, top, L.width, bottom - top);
    ctx.fillStyle = '#3c096c';
    ctx.fillRect(-20, top, 20, bottom - top);
    ctx.fillRect(L.width, top, 20, bottom - top);

    // floor labels
    ctx.font = '900 48px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (const cp of L.checkpoints) {
      if (cp.y > top && cp.y < bottom + 100) ctx.fillText(cp.floor === 0 ? 'START' : `FLOOR ${cp.floor + 1}`, L.width / 2, cp.y - 120);
    }

    const t = rt;
    for (const p of L.platforms) {
      const pos = platformAt(p, Math.max(0, t));
      if (pos.y > bottom || pos.y + p.h < top) continue;
      ctx.fillStyle =
        p.kind === 'ground' ? '#2a9d8f' : p.kind === 'spiky' ? '#9d0208' : p.kind === 'checkpoint' ? '#ffb703' : p.kind === 'goal' ? '#06d6a0' : p.move ? '#4cc9f0' : '#f72585';
      roundRect(ctx, pos.x, pos.y, p.w, p.h, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(pos.x + 4, pos.y + 2, p.w - 8, 3);
      if (p.move) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let x = pos.x + 8; x < pos.x + p.w - 8; x += 16) ctx.fillRect(x, pos.y + 8, 8, 4);
      }
      if (p.kind === 'goal') {
        const fx = pos.x + p.w / 2;
        ctx.fillStyle = '#fff';
        ctx.fillRect(fx - 2, pos.y - 90, 4, 90);
        ctx.fillStyle = '#ffd60a';
        ctx.beginPath();
        ctx.moveTo(fx + 2, pos.y - 90);
        ctx.lineTo(fx + 50, pos.y - 75);
        ctx.lineTo(fx + 2, pos.y - 60);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '900 28px system-ui';
        ctx.fillText('TOP!', fx, pos.y - 100);
      }
    }
    for (const hz of L.hazards) {
      if (hz.type === 'spikes') {
        if (hz.y > bottom || hz.y < top) continue;
        ctx.fillStyle = '#e5e5e5';
        for (let x = hz.x; x < hz.x + hz.w - 1; x += 12) {
          ctx.beginPath();
          ctx.moveTo(x, hz.y + hz.h);
          ctx.lineTo(x + 6, hz.y);
          ctx.lineTo(x + 12, hz.y + hz.h);
          ctx.fill();
        }
      } else if (hz.type === 'saw') {
        const sp = sawAt(hz, Math.max(0, t));
        if (sp.y > bottom || sp.y < top) continue;
        ctx.save();
        ctx.translate(sp.x, sp.y);
        ctx.rotate(t * 10);
        ctx.fillStyle = '#adb5bd';
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const r = i % 2 ? hz.r * 0.7 : hz.r + 4;
          const a = (i / 16) * Math.PI * 2;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.fill();
        ctx.fillStyle = '#495057';
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // players (me last so I'm on top)
    const order = [...players.values()].sort((a, b) => (a.id === this.me) - (b.id === this.me));
    for (const p of order) {
      const r = this.roster.get(p.id);
      if (!r) continue;
      ctx.globalAlpha = p.inv && Math.floor(performance.now() / 100) % 2 ? 0.4 : p.id === this.me ? 1 : 0.85;
      drawAvatar(ctx, r.avatar, p.x, p.y - PLAYER_H * 0.6, 48, {
        facing: p.f,
        label: p.id === this.me ? 'You' : r.name,
        labelColor: p.id === this.me ? '#ffd60a' : '#fff',
      });
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (s) {
      if (s.countdown > 0) bigText(ctx, String(s.countdown), w / 2, h / 2, 120);
      else if (s.t < 0.8) bigText(ctx, 'GO!', w / 2, h / 2, 120, '#ffd60a');
      const meS = s.players.find((p) => p.id === this.me);
      if (meS && meS.done !== null) bigText(ctx, `You made it! ${meS.done.toFixed(2)}s`, w / 2, 80, 40, '#06d6a0');
      this.#hud(s);
    }
  }

  #hud(s) {
    if (s === this.lastHud) return;
    this.lastHud = s;
    this.timer.textContent = `⏱ ${fmtTime(s.timeLeft)}`;
    this.timer.classList.toggle('urgent', s.timeLeft <= 15);
    const rows = [...s.players].sort((a, b) => (a.done ?? 1e9) - (b.done ?? 1e9) || b.prog - a.prog);
    this.board.replaceChildren(
      el('div', { class: 'hud-board-title' }, 'Height'),
      ...rows.map((p, i) =>
        el(
          'div',
          { class: `hud-row${p.id === this.me ? ' me' : ''}` },
          el('span', { class: 'rank' }, `${i + 1}`),
          el('span', { class: 'name' }, this.roster.get(p.id)?.name || '?'),
          el('span', { class: 'bar' }, el('i', { style: `width:${Math.round(p.prog * 100)}%` })),
          el('span', { class: 'val' }, p.done !== null ? '🏁' : `F${p.floor + 1}`),
        ),
      ),
    );
  }

  destroy() {}
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const c = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
