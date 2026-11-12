// Spaceship Sabotage renderer: top-down ship, limited vision, meetings & voting.
import { ROOMS, CORRIDORS, TASK_STATIONS, REACTOR_PANELS, EMERGENCY_BUTTON } from '/shared/sabotage-map.js';
import { drawAvatar, avatarCanvas } from '../avatar.js';
import { SnapBuffer, el, fmtTime, bigText } from './common.js';

export const SABOTAGE_HELP = {
  title: 'Spaceship Sabotage',
  goal: 'Crew: finish every task or vote out the saboteur. Saboteur: secretly zap the crew, or set off a reactor meltdown and keep the crew away from the panels until the clock runs out.',
  keys: [
    ['Arrows or W A S D', 'Move'],
    ['Hold E', 'Do a task / fix a reactor panel'],
    ['E or F at the red button', 'Call an emergency meeting (once each)'],
    ['R', 'Report a frozen crewmate nearby'],
    ['Q', 'Saboteur: zap a nearby crewmate'],
    ['X', 'Saboteur: start a reactor meltdown'],
    ['H', 'Show / hide this help'],
  ],
  tips: [
    'Your tasks glow yellow on the map and are listed on the left.',
    'In meetings, talk it over (voice chat or the text box), then vote or skip.',
    'If you are zapped you become a ghost: you can still finish your tasks to help the crew.',
  ],
};

const STATION_BY_ID = Object.fromEntries(TASK_STATIONS.map((s) => [s.id, s]));
const stars = Array.from({ length: 160 }, (_, i) => ({ x: (i * 977) % 2400 - 300, y: (i * 571) % 1600 - 240, r: (i % 3) + 1 }));

export class SabotageView {
  constructor({ me, init, roster, hud, toast, send, input }) {
    this.me = me;
    this.init = init;
    this.roster = roster;
    this.toast = toast;
    this.send = send;
    this.buf = new SnapBuffer('time');
    this.hud = hud;
    this.cam = null;
    this.meetingKey = null;

    this.roleEl = el('div', { class: 'sab-role' });
    this.taskBar = el('div', { class: 'sab-taskbar' }, el('i'));
    this.taskList = el('div', { class: 'sab-tasks' });
    this.timer = el('div', { class: 'hud-timer' });
    this.alarm = el('div', { class: 'sab-alarm hidden' });
    this.buttons = el('div', { class: 'sab-buttons' });
    this.overlay = el('div', { class: 'sab-overlay hidden' });
    hud.append(
      el('div', { class: 'hud-top' }, this.timer),
      el('div', { class: 'sab-left' }, this.roleEl, el('div', { class: 'sab-tb-label' }, 'Crew tasks'), this.taskBar, this.taskList),
      this.alarm,
      this.buttons,
      this.overlay,
    );

    this.btn = {
      use: this.#button('Use (E)', null, 'use'),
      emergency: this.#button('Meeting (F)', () => this.act('emergency'), 'emergency'),
      report: this.#button('Report (R)', () => this.act('report'), 'report'),
      zap: this.#button('Zap (Q)', () => this.act('zap'), 'zap'),
      sabotage: this.#button('Meltdown (X)', () => this.act('sabotage'), 'sabotage'),
    };
    // "Use" is a hold button
    const use = this.btn.use;
    use.addEventListener('pointerdown', () => input.set('action', true));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) use.addEventListener(ev, () => input.set('action', false));

    this.offPress = input.onPress((code) => {
      const s = this.buf.latest;
      if (!s || s.phase !== 'play') return;
      if (code === 'KeyQ') this.act('zap');
      else if (code === 'KeyR') this.act('report');
      else if (code === 'KeyX') this.act('sabotage');
      else if (code === 'KeyF' || (code === 'KeyE' && this.nearButton)) this.act('emergency');
    });
  }

  #button(label, onClick, cls) {
    const b = el('button', { class: `sab-btn ${cls}` }, label);
    if (onClick) b.addEventListener('click', onClick);
    this.buttons.append(b);
    return b;
  }

  touchButtons() {
    return [];
  }

  act(a, extra = {}) {
    this.send({ t: 'act', a, ...extra });
  }

  onState(s) {
    this.buf.push(s);
  }

  onEvent(ev) {
    if (!ev.text) return;
    const kind = ev.kind === 'alarm' || ev.kind === 'zapped' ? 'bad' : ev.kind === 'meeting' ? 'warn' : 'info';
    this.toast(ev.text, kind);
  }

  draw(ctx, w, h) {
    const s = this.buf.latest;
    if (!s) {
      ctx.fillStyle = '#0b0c2a';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const rt = this.buf.renderTime(0.1);
    const players = this.buf.players(rt);
    const meP = players.get(this.me);
    const zoom = Math.min(1.1, Math.max(0.6, Math.min(w, h) / 760));
    if (meP) {
      if (!this.cam) this.cam = { x: meP.x, y: meP.y };
      this.cam.x += (meP.x - this.cam.x) * 0.2;
      this.cam.y += (meP.y - this.cam.y) * 0.2;
    }
    const cam = this.cam || { x: 900, y: 600 };

    ctx.fillStyle = '#0b0c2a';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x, -cam.y);

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const st of stars) ctx.fillRect(st.x, st.y, st.r, st.r);

    // hull outline
    ctx.fillStyle = '#1b263b';
    for (const a of [...CORRIDORS, ...ROOMS]) {
      ctx.beginPath();
      ctx.roundRect(a.x - 14, a.y - 14, a.w + 28, a.h + 28, 26);
      ctx.fill();
    }
    ctx.fillStyle = '#5c677d';
    for (const c of CORRIDORS) ctx.fillRect(c.x, c.y, c.w, c.h);
    for (const r of ROOMS) {
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 2;
      for (let x = r.x + 40; x < r.x + r.w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, r.y + 4);
        ctx.lineTo(x, r.y + r.h - 4);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '800 22px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(r.name.toUpperCase(), r.x + r.w / 2, r.y + 34);
    }

    // emergency button
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
    ctx.fillStyle = '#6c757d';
    ctx.beginPath();
    ctx.arc(EMERGENCY_BUTTON.x, EMERGENCY_BUTTON.y, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.sabotage ? '#555' : `rgb(${200 + 55 * pulse},30,40)`;
    ctx.beginPath();
    ctx.arc(EMERGENCY_BUTTON.x, EMERGENCY_BUTTON.y, 24, 0, Math.PI * 2);
    ctx.fill();

    // task stations
    const myTasks = new Map(s.me.tasks.map((t) => [t.id, t]));
    const showMine = s.me.role === 'crew';
    for (const st of TASK_STATIONS) {
      const t = myTasks.get(st.id);
      const mine = showMine && t && !t.done;
      ctx.fillStyle = mine ? `rgba(255,214,10,${0.6 + 0.4 * pulse})` : '#adb5bd';
      ctx.beginPath();
      ctx.roundRect(st.x - 16, st.y - 16, 32, 32, 6);
      ctx.fill();
      ctx.fillStyle = '#1b263b';
      ctx.font = 'bold 18px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(mine ? '!' : t && t.done && showMine ? '✓' : '·', st.x, st.y + 6);
      if (mine && t.p > 0) ring(ctx, st.x, st.y, 24, t.p, '#06d6a0');
    }
    for (const r of REACTOR_PANELS) {
      const st = s.sabotage?.panels[r.id];
      ctx.fillStyle = s.sabotage ? (st?.fixed ? '#06d6a0' : `rgba(255,0,0,${0.5 + 0.5 * pulse})`) : '#495057';
      ctx.beginPath();
      ctx.roundRect(r.x - 20, r.y - 20, 40, 40, 6);
      ctx.fill();
      if (st && !st.fixed && st.p > 0) ring(ctx, r.x, r.y, 28, st.p, '#ffd60a');
    }

    // frozen bodies
    for (const b of s.bodies) {
      const r = this.roster.get(b.id);
      ctx.save();
      ctx.translate(b.x, b.y + 10);
      ctx.rotate(Math.PI / 2);
      ctx.globalAlpha = 0.8;
      drawAvatar(ctx, r?.avatar, 0, 0, 44);
      ctx.restore();
      ctx.fillStyle = '#a2d2ff';
      ctx.font = 'bold 20px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('❄', b.x, b.y - 18);
    }

    // players
    const order = [...players.values()].sort((a, b) => (a.id === this.me) - (b.id === this.me));
    for (const p of order) {
      const r = this.roster.get(p.id);
      if (!r) continue;
      const sab = p.role === 'saboteur';
      drawAvatar(ctx, r.avatar, p.x, p.y - 8, 52, {
        facing: p.f,
        ghost: !p.alive,
        bob: Math.sin(performance.now() / 160 + p.id) * (p.alive ? 0 : 4),
        label: p.id === this.me ? 'You' : r.name,
        labelColor: sab && (s.me.role === 'saboteur' || !s.me.alive) ? '#ff4d6d' : p.id === this.me ? '#ffd60a' : '#fff',
      });
    }
    ctx.restore();

    // limited vision for the living
    if (s.me.alive && meP) {
      const vr = (s.me.role === 'saboteur' ? 430 : 340) * zoom * (s.sabotage ? 0.8 : 1);
      const cx = w / 2 + (meP.x - cam.x) * zoom;
      const cy = h / 2 + (meP.y - cam.y) * zoom;
      const g = ctx.createRadialGradient(cx, cy, vr * 0.6, cx, cy, vr);
      g.addColorStop(0, 'rgba(5,5,20,0)');
      g.addColorStop(1, 'rgba(5,5,20,0.92)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (s.sabotage) {
      ctx.fillStyle = `rgba(255,0,0,${0.08 + 0.1 * pulse})`;
      ctx.fillRect(0, 0, w, h);
    }

    this.nearButton = meP && Math.hypot(meP.x - EMERGENCY_BUTTON.x, meP.y - EMERGENCY_BUTTON.y) < 80;
    this.nearBody = meP && s.bodies.some((b) => Math.hypot(meP.x - b.x, meP.y - b.y) < 100);

    if (s.phase === 'intro') {
      const sab = s.me.role === 'saboteur';
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, 0, w, h);
      bigText(ctx, sab ? 'You are the SABOTEUR' : 'You are CREW', w / 2, h / 2 - 30, Math.min(64, w / 12), sab ? '#ff4d6d' : '#4cc9f0');
      bigText(ctx, sab ? 'Zap the crew without getting caught.' : 'Do your tasks and find the saboteur!', w / 2, h / 2 + 40, Math.min(28, w / 28));
      if (sab && this.init.partners.length > 1) {
        const others = this.init.partners.filter((id) => id !== this.me).map((id) => this.roster.get(id)?.name);
        bigText(ctx, `Your partner: ${others.join(', ')}`, w / 2, h / 2 + 90, 24, '#ff4d6d');
      }
    }
    this.#hud(s);
  }

  #hud(s) {
    if (s === this.lastHud) return;
    this.lastHud = s;
    const me = s.me;
    this.timer.textContent = `⏱ ${fmtTime(s.timeLeft)}`;
    this.roleEl.textContent = `${me.role === 'saboteur' ? '🟥 Saboteur' : '🟦 Crew'}${me.alive ? '' : ' · 👻 Ghost'}`;
    this.roleEl.className = `sab-role ${me.role}`;
    this.taskBar.firstChild.style.width = `${s.tasks.total ? (100 * s.tasks.done) / s.tasks.total : 0}%`;
    this.taskList.replaceChildren(
      ...me.tasks.map((t) =>
        el('div', { class: `sab-task${t.done ? ' done' : ''}` }, me.role === 'saboteur' ? '(fake) ' : t.done ? '✓ ' : '• ', STATION_BY_ID[t.id].name),
      ),
    );

    if (s.sabotage) {
      this.alarm.classList.remove('hidden');
      const fixed = Object.values(s.sabotage.panels).filter((p) => p.fixed).length;
      this.alarm.textContent = `⚠ REACTOR MELTDOWN in ${s.sabotage.left}s - hold E at both Reactor panels (${fixed}/2)`;
    } else this.alarm.classList.add('hidden');

    const play = s.phase === 'play';
    const show = (b, on) => b.classList.toggle('hidden', !on);
    show(this.btn.use, play);
    show(this.btn.emergency, play && me.alive && this.nearButton && me.meetingsLeft > 0 && !s.sabotage);
    show(this.btn.report, play && me.alive && this.nearBody && !s.sabotage);
    show(this.btn.zap, play && me.alive && me.role === 'saboteur');
    show(this.btn.sabotage, play && me.alive && me.role === 'saboteur');
    if (me.role === 'saboteur') {
      this.btn.zap.textContent = me.zapIn > 0 ? `Zap in ${me.zapIn}s` : 'Zap (Q)';
      this.btn.zap.disabled = me.zapIn > 0;
      this.btn.sabotage.textContent = s.sabotage ? 'Meltdown active' : me.sabotageIn > 0 ? `Meltdown in ${me.sabotageIn}s` : 'Meltdown (X)';
      this.btn.sabotage.disabled = !!s.sabotage || me.sabotageIn > 0;
    }

    if (s.phase === 'meeting') this.#meeting(s);
    else if (s.phase === 'reveal') this.#reveal(s);
    else {
      this.overlay.classList.add('hidden');
      this.meetingKey = null;
    }
  }

  #meeting(s) {
    const m = s.meeting;
    const key = `m${m.reason}`;
    if (this.meetingKey !== key) {
      // build once per meeting, then update in place
      this.meetingKey = key;
      this.chatLen = -1;
      this.gridKey = null;
      this.overlay.classList.remove('hidden');
      this.mTimer = el('div', { class: 'meet-timer' });
      this.mGrid = el('div', { class: 'meet-grid' });
      this.mChat = el('div', { class: 'meet-chat-log' });
      const input = el('input', { type: 'text', maxlength: '140', placeholder: s.me.alive ? 'Type a message…' : 'Ghost chat (only ghosts see this)…' });
      const form = el(
        'form',
        {
          class: 'meet-chat-form',
          onsubmit: (e) => {
            e.preventDefault();
            if (input.value.trim()) this.act('chat', { text: input.value });
            input.value = '';
          },
        },
        input,
        el('button', { type: 'submit' }, 'Send'),
      );
      this.mSkip = el('button', { class: 'meet-skip', onclick: () => this.act('vote', { target: 'skip' }) }, 'Skip vote');
      this.overlay.replaceChildren(
        el(
          'div',
          { class: 'meet-panel' },
          el('h2', {}, '🚨 Emergency Meeting'),
          el('p', { class: 'meet-reason' }, m.reason),
          this.mTimer,
          this.mGrid,
          this.mSkip,
          el('div', { class: 'meet-chat' }, this.mChat, form),
        ),
      );
    }
    this.mTimer.textContent = `Voting ends in ${m.left}s`;
    const canVote = s.me.alive && m.myVote === null;
    this.mSkip.disabled = !canVote;
    this.mSkip.textContent = m.myVote === 'skip' ? 'You skipped' : 'Skip vote';
    const voted = new Set(m.voted);
    const alive = new Set(m.alive);
    const gridKey = `${m.voted.join()}|${m.alive.join()}|${m.myVote}`;
    if (gridKey !== this.gridKey) this.gridKey = gridKey;
    else return this.#chat(m);
    this.mGrid.replaceChildren(
      ...[...this.roster.values()].map((r) => {
        const isAlive = alive.has(r.id);
        const card = el(
          'button',
          {
            class: `meet-card${isAlive ? '' : ' out'}${m.myVote === r.id ? ' chosen' : ''}`,
            disabled: !canVote || !isAlive ? 'disabled' : null,
            onclick: () => this.act('vote', { target: r.id }),
          },
          avatarCanvas(r.avatar, 48, { ghost: !isAlive }),
          el('span', { class: 'meet-name' }, r.id === this.me ? `${r.name} (you)` : r.name),
          voted.has(r.id) ? el('span', { class: 'meet-voted' }, 'VOTED') : null,
          !isAlive ? el('span', { class: 'meet-voted out' }, 'OUT') : null,
        );
        return card;
      }),
    );
    this.#chat(m);
  }

  #chat(m) {
    const last = m.chat[m.chat.length - 1];
    const chatKey = `${m.chat.length}:${last ? last.text : ''}`;
    if (chatKey !== this.chatLen) {
      this.chatLen = chatKey;
      this.mChat.replaceChildren(...m.chat.map((c) => el('div', { class: `chat-line${c.ghost ? ' ghost' : ''}` }, el('b', {}, `${c.name}: `), c.text)));
      this.mChat.scrollTop = this.mChat.scrollHeight;
    }
  }

  #reveal(s) {
    const key = `r${s.reveal.text}`;
    if (this.meetingKey === key) return;
    this.meetingKey = key;
    this.overlay.classList.remove('hidden');
    const votes = s.reveal.votes.map((v) => {
      const from = this.roster.get(v.from)?.name;
      const to = v.to === 'skip' ? 'skip' : this.roster.get(v.to)?.name;
      return el('li', {}, `${from} → ${to}`);
    });
    this.overlay.replaceChildren(
      el(
        'div',
        { class: 'meet-panel reveal' },
        s.reveal.ejected ? avatarCanvas(this.roster.get(s.reveal.ejected)?.avatar, 96, { ghost: true }) : null,
        el('h2', {}, s.reveal.text),
        el('ul', { class: 'vote-list' }, votes),
      ),
    );
  }

  destroy() {
    this.offPress();
  }
}

function ring(ctx, x, y, r, p, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
  ctx.stroke();
}
