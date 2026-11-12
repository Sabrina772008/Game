// Shared plumbing for the three game simulations.
export class BaseGame {
  constructor({ players, options, seed }) {
    this.options = options || {};
    this.seed = seed;
    this.time = 0; // seconds since match start
    this.events = [];
    this.result = null;
    this.players = new Map();
    for (const p of players) {
      this.players.set(p.userId, {
        id: p.userId,
        name: p.username,
        avatar: p.avatar,
        team: p.team || null,
        keys: { up: false, down: false, left: false, right: false, action: false, jump: false },
        connected: true,
        left: false,
      });
    }
  }

  hasPlayer(id) {
    const p = this.players.get(id);
    return !!p && !p.left;
  }

  setConnected(id, on) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = on;
    if (!on) p.keys = { up: false, down: false, left: false, right: false, action: false, jump: false };
  }

  playerLeft(id) {
    const p = this.players.get(id);
    if (p) {
      p.left = true;
      p.connected = false;
    }
  }

  input(id, keys) {
    const p = this.players.get(id);
    if (p) p.keys = keys;
  }

  action() {}

  emit(ev) {
    this.events.push(ev);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, team: p.team }));
  }
}

/** Coins for finishing position in a race (rank starts at 1). */
export function placementCoins(rank) {
  return [0, 50, 35, 25][rank] ?? 15;
}

export { mulberry32 } from '../../shared/random.js';
