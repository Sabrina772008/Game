// Spaceship Sabotage: an original social-deduction game.
// Crew win by finishing every task or voting out every saboteur.
// Saboteurs win by zapping enough crew, or when a reactor meltdown runs out.
import { BaseGame, mulberry32 } from './base.js';
import { TASK_STATIONS, REACTOR_PANELS, EMERGENCY_BUTTON, SPAWN, isWalkable } from '../../shared/sabotage-map.js';

const SPEED = 230;
const TASKS_PER_CREW = 4;
const TASK_SECONDS = 3;
const PANEL_SECONDS = 2;
const USE_RANGE = 70;
const ZAP_RANGE = 80;
const REPORT_RANGE = 100;
const ZAP_COOLDOWN = 25;
const FIRST_ZAP = 15;
const SABOTAGE_COOLDOWN = 45;
const MELTDOWN_SECONDS = 40;
const MEETING_SECONDS = 60;
const REVEAL_SECONDS = 5;
const INTRO_SECONDS = 4;
const MATCH_LIMIT = 10 * 60;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class SabotageGame extends BaseGame {
  static id = 'sabotage';
  static title = 'Spaceship Sabotage';
  static minPlayers = 2; // works with 2 for testing; most fun with 4-10

  constructor(opts) {
    super(opts);
    const rnd = mulberry32(this.seed);
    const ids = [...this.players.keys()];
    // shuffle
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const sabCount = ids.length >= 7 ? 2 : 1;
    const sabs = new Set(ids.slice(0, sabCount));
    let i = 0;
    for (const p of this.players.values()) {
      const angle = (i++ / this.players.size) * Math.PI * 2;
      p.x = SPAWN.x + Math.cos(angle) * 70;
      p.y = SPAWN.y + Math.sin(angle) * 50;
      p.alive = true;
      p.role = sabs.has(p.id) ? 'saboteur' : 'crew';
      p.meetingsLeft = 1;
      p.zapReadyAt = FIRST_ZAP;
      p.vote = null;
      p.facing = 1;
      const stations = [...TASK_STATIONS].sort(() => rnd() - 0.5).slice(0, TASKS_PER_CREW);
      p.tasks = stations.map((s) => ({ id: s.id, progress: 0, done: false }));
      p.prevAction = false;
    }
    this.phase = 'intro';
    this.phaseEnds = INTRO_SECONDS;
    this.bodies = [];
    this.sabotage = { active: false, endsAt: 0, readyAt: 20, panels: {} };
    this.meeting = null;
    this.reveal = null;
    this.chat = [];
  }

  init(userId) {
    const me = this.players.get(userId);
    return {
      roster: this.roster(),
      role: me.role,
      partners: me.role === 'saboteur' ? [...this.players.values()].filter((p) => p.role === 'saboteur').map((p) => p.id) : [],
    };
  }

  crewTaskTotals() {
    let done = 0;
    let total = 0;
    for (const p of this.players.values()) {
      if (p.role !== 'crew' || p.left) continue;
      total += p.tasks.length;
      done += p.tasks.filter((t) => t.done).length;
    }
    return { done, total };
  }

  update(dt) {
    if (this.result) return;
    this.time += dt;
    if (this.phase === 'intro') {
      if (this.time >= this.phaseEnds) this.phase = 'play';
      return;
    }
    if (this.phase === 'meeting') {
      if (this.time >= this.meeting.endsAt || this.allVoted()) this.closeMeeting();
      return;
    }
    if (this.phase === 'reveal') {
      if (this.time >= this.phaseEnds) {
        this.phase = 'play';
        this.reveal = null;
        this.checkWin();
      }
      return;
    }

    // --- play phase ---
    for (const p of this.players.values()) {
      if (p.left) continue;
      const k = p.keys;
      let dx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      let dy = (k.down ? 1 : 0) - (k.up ? 1 : 0);
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        dx = (dx / len) * SPEED * dt;
        dy = (dy / len) * SPEED * dt;
        if (dx) p.facing = dx > 0 ? 1 : -1;
        if (!p.alive) {
          // ghosts float anywhere on the map
          p.x = Math.max(20, Math.min(1780, p.x + dx));
          p.y = Math.max(20, Math.min(1100, p.y + dy));
        } else {
          if (isWalkable(p.x + dx, p.y + dy)) {
            p.x += dx;
            p.y += dy;
          } else if (isWalkable(p.x + dx, p.y)) p.x += dx;
          else if (isWalkable(p.x, p.y + dy)) p.y += dy;
        }
      }
      // hold the use key at a station to work on a task / fix the reactor
      if (k.action) {
        if (this.sabotage.active && p.alive) {
          for (const panel of REACTOR_PANELS) {
            if (dist(p, panel) < USE_RANGE && !this.sabotage.panels[panel.id]?.fixed) {
              const st = (this.sabotage.panels[panel.id] ||= { progress: 0, fixed: false });
              st.progress += dt;
              if (st.progress >= PANEL_SECONDS) {
                st.fixed = true;
                this.emit({ kind: 'toast', text: `${p.name} stabilised a reactor panel!` });
              }
            }
          }
        }
        if (p.role === 'crew') {
          for (const t of p.tasks) {
            if (t.done) continue;
            const s = TASK_STATIONS.find((x) => x.id === t.id);
            if (dist(p, s) < USE_RANGE) {
              t.progress += dt;
              if (t.progress >= TASK_SECONDS) {
                t.done = true;
                this.emit({ kind: 'task', to: [p.id], text: `Task done: ${s.name}` });
              }
            }
          }
        }
      }
    }

    if (this.sabotage.active) {
      const fixed = REACTOR_PANELS.every((r) => this.sabotage.panels[r.id]?.fixed);
      if (fixed) {
        this.sabotage.active = false;
        this.sabotage.readyAt = this.time + SABOTAGE_COOLDOWN;
        this.emit({ kind: 'toast', text: 'Reactor stabilised. Phew!' });
      } else if (this.time >= this.sabotage.endsAt) {
        return this.finishGame('saboteur', 'The reactor melted down! Saboteurs win.');
      }
    }
    if (this.time >= MATCH_LIMIT) return this.finishGame('crew', 'The ship made it home safely. Crew wins!');
    this.checkWin();
  }

  allVoted() {
    for (const p of this.players.values()) if (p.alive && !p.left && p.vote === null) return false;
    return true;
  }

  checkWin() {
    if (this.result || this.phase === 'meeting') return;
    const alive = [...this.players.values()].filter((p) => p.alive && !p.left);
    const sabs = alive.filter((p) => p.role === 'saboteur').length;
    const crew = alive.length - sabs;
    const { done, total } = this.crewTaskTotals();
    if (sabs === 0) return this.finishGame('crew', 'Every saboteur is gone. Crew wins!');
    if (total > 0 && done >= total) return this.finishGame('crew', 'All tasks finished. Crew wins!');
    // With only 2 players the saboteur must actually zap the last crewmate.
    if (crew === 0 || (sabs >= crew && this.players.size > 2)) {
      return this.finishGame('saboteur', 'The saboteurs took over the ship!');
    }
  }

  action(userId, msg) {
    const p = this.players.get(userId);
    if (!p || this.result) return;
    switch (msg.a) {
      case 'zap': {
        if (this.phase !== 'play' || p.role !== 'saboteur' || !p.alive || this.time < p.zapReadyAt) return;
        let target = null;
        for (const o of this.players.values()) {
          if (o.alive && !o.left && o.role === 'crew' && dist(p, o) < ZAP_RANGE && (!target || dist(p, o) < dist(p, target))) target = o;
        }
        if (!target) return;
        target.alive = false;
        this.bodies.push({ id: target.id, x: target.x, y: target.y });
        p.zapReadyAt = this.time + ZAP_COOLDOWN;
        this.emit({ kind: 'zapped', to: [target.id], text: 'You were zapped! You are now a ghost - you can still finish your tasks.' });
        this.checkWin();
        return;
      }
      case 'report': {
        if (this.phase !== 'play' || !p.alive || this.sabotage.active) return;
        const body = this.bodies.find((b) => dist(p, b) < REPORT_RANGE);
        if (body) this.openMeeting(p, `${p.name} found ${this.players.get(body.id).name}'s frozen body!`);
        return;
      }
      case 'emergency': {
        if (this.phase !== 'play' || !p.alive || p.meetingsLeft <= 0 || this.sabotage.active) return;
        if (dist(p, EMERGENCY_BUTTON) > USE_RANGE + 20) return;
        p.meetingsLeft--;
        this.openMeeting(p, `${p.name} pressed the emergency button!`);
        return;
      }
      case 'sabotage': {
        if (this.phase !== 'play' || p.role !== 'saboteur' || !p.alive) return;
        if (this.sabotage.active || this.time < this.sabotage.readyAt) return;
        this.sabotage = { active: true, endsAt: this.time + MELTDOWN_SECONDS, readyAt: 0, panels: {} };
        this.emit({ kind: 'alarm', text: 'REACTOR MELTDOWN! Hold E at both reactor panels to stop it!' });
        return;
      }
      case 'vote': {
        if (this.phase !== 'meeting' || !p.alive || p.vote !== null) return;
        const target = msg.target === 'skip' ? 'skip' : Number(msg.target);
        if (target !== 'skip') {
          const t = this.players.get(target);
          if (!t || !t.alive || t.left) return;
        }
        p.vote = target;
        return;
      }
      case 'chat': {
        if (this.phase !== 'meeting') return;
        const text = String(msg.text || '').slice(0, 140).trim();
        if (!text) return;
        this.chat.push({ from: p.id, name: p.name, ghost: !p.alive, text });
        if (this.chat.length > 50) this.chat.shift();
        return;
      }
    }
  }

  openMeeting(caller, reason) {
    this.phase = 'meeting';
    this.meeting = { caller: caller.id, reason, endsAt: this.time + MEETING_SECONDS };
    this.chat = [];
    for (const p of this.players.values()) p.vote = null;
    this.emit({ kind: 'meeting', text: reason });
  }

  closeMeeting() {
    const tally = new Map();
    let skip = 0;
    for (const p of this.players.values()) {
      if (!p.alive || p.left) continue;
      if (p.vote === 'skip' || p.vote === null) skip++;
      else tally.set(p.vote, (tally.get(p.vote) || 0) + 1);
    }
    let top = null;
    let topCount = 0;
    let tie = false;
    for (const [id, c] of tally) {
      if (c > topCount) {
        top = id;
        topCount = c;
        tie = false;
      } else if (c === topCount) tie = true;
    }
    const votes = [...this.players.values()].filter((p) => p.alive && !p.left).map((p) => ({ from: p.id, to: p.vote ?? 'skip' }));
    let text;
    let ejected = null;
    if (top !== null && !tie && topCount > skip) {
      ejected = this.players.get(top);
      ejected.alive = false;
      text = ejected.role === 'saboteur' ? `${ejected.name} was a saboteur!` : `${ejected.name} was not a saboteur.`;
    } else {
      text = tie ? 'It was a tie - nobody was ejected.' : 'Nobody was ejected.';
    }
    this.reveal = { text, ejected: ejected ? ejected.id : null, votes };
    this.phase = 'reveal';
    this.phaseEnds = this.time + REVEAL_SECONDS;
    this.meeting = null;
    this.bodies = [];
    // regroup everybody in the hub
    let i = 0;
    for (const p of this.players.values()) {
      const angle = (i++ / this.players.size) * Math.PI * 2;
      p.x = 900 + Math.cos(angle) * 90;
      p.y = 600 + Math.sin(angle) * 60;
      p.vote = null;
      if (p.role === 'saboteur') p.zapReadyAt = Math.max(p.zapReadyAt, this.time + REVEAL_SECONDS + FIRST_ZAP);
    }
  }

  playerLeft(id) {
    super.playerLeft(id);
    const p = this.players.get(id);
    if (p) p.alive = false;
    if (this.phase === 'play') this.checkWin();
  }

  finishGame(side, text) {
    if (this.result) return;
    const placements = [];
    const awards = [];
    for (const p of this.players.values()) {
      const won = p.role === side;
      placements.push({ userId: p.id, name: p.name, avatar: p.avatar, rank: won ? 1 : 2, label: `${p.role === 'saboteur' ? 'Saboteur' : 'Crew'}${p.alive ? '' : ' (out)'}${p.left ? ' - left' : ''}`, won });
      if (!p.left) awards.push({ userId: p.id, coins: won ? 50 : 10, won });
    }
    placements.sort((a, b) => a.rank - b.rank);
    this.result = {
      game: 'sabotage',
      title: 'Spaceship Sabotage',
      headline: text,
      winnerSide: side,
      placements,
      awards,
    };
  }

  view(userId) {
    const me = this.players.get(userId);
    const seeAll = !me.alive;
    const players = [];
    for (const p of this.players.values()) {
      if (p.left) continue;
      if (!p.alive && me.alive && p.id !== me.id) continue; // living players can't see ghosts
      players.push({
        id: p.id,
        x: Math.round(p.x),
        y: Math.round(p.y),
        alive: p.alive,
        f: p.facing,
        role: p.id === me.id || seeAll || (me.role === 'saboteur' && p.role === 'saboteur') ? p.role : undefined,
      });
    }
    const totals = this.crewTaskTotals();
    const s = {
      phase: this.phase,
      time: Math.round(this.time * 10) / 10,
      timeLeft: Math.max(0, Math.ceil(MATCH_LIMIT - this.time)),
      me: {
        role: me.role,
        alive: me.alive,
        meetingsLeft: me.meetingsLeft,
        zapIn: me.role === 'saboteur' ? Math.max(0, Math.ceil(me.zapReadyAt - this.time)) : null,
        sabotageIn: me.role === 'saboteur' ? (this.sabotage.active ? null : Math.max(0, Math.ceil(this.sabotage.readyAt - this.time))) : null,
        tasks: me.tasks.map((t) => ({ id: t.id, done: t.done, p: Math.min(1, t.progress / TASK_SECONDS) })),
      },
      players,
      bodies: this.bodies,
      tasks: totals,
      sabotage: this.sabotage.active
        ? {
            left: Math.max(0, Math.ceil(this.sabotage.endsAt - this.time)),
            panels: Object.fromEntries(REACTOR_PANELS.map((r) => [r.id, { fixed: !!this.sabotage.panels[r.id]?.fixed, p: Math.min(1, (this.sabotage.panels[r.id]?.progress || 0) / PANEL_SECONDS) }])),
          }
        : null,
      introLeft: this.phase === 'intro' ? Math.ceil(this.phaseEnds - this.time) : 0,
    };
    if (this.phase === 'meeting') {
      s.meeting = {
        reason: this.meeting.reason,
        left: Math.max(0, Math.ceil(this.meeting.endsAt - this.time)),
        voted: [...this.players.values()].filter((p) => p.alive && p.vote !== null).map((p) => p.id),
        myVote: me.vote,
        alive: [...this.players.values()].filter((p) => p.alive && !p.left).map((p) => p.id),
        chat: this.chat.filter((c) => !c.ghost || !me.alive), // ghost chat only visible to ghosts
      };
    }
    if (this.phase === 'reveal') s.reveal = this.reveal;
    return s;
  }
}
