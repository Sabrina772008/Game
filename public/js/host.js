// Browser-hosted version of server/rooms.js.
// The person who creates a room runs this in their own browser tab; everyone
// else connects to it peer-to-peer (PeerJS). Same rules as the Node server.
import { SabotageGame } from '../../server/games/sabotage.js';
import { TowerGame } from '../../server/games/tower.js';
import { CircuitGame } from '../../server/games/circuit.js';

const crypto = {
  randomInt(max) {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0] % max;
  },
  randomUUID() {
    if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
    return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  },
};
const randomSeed = () => 1 + crypto.randomInt(2 ** 31 - 1);

// Game loop timer. Browsers slow down normal timers in background tabs, which
// would freeze the game for everyone if the host switched tabs. Timers inside
// a Worker keep running, so the Worker just "ticks" the page.
let workerUrl = null;
function startTicker(fn, ms) {
  try {
    if (!workerUrl) {
      workerUrl = URL.createObjectURL(
        new Blob(['let t;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}'], { type: 'text/javascript' }),
      );
    }
    const w = new Worker(workerUrl);
    w.onmessage = fn;
    w.postMessage(ms);
    return { stop: () => w.terminate() };
  } catch {
    const id = setInterval(fn, ms);
    return { stop: () => clearInterval(id) };
  }
}
const stopTicker = (t) => t && t.stop();

export const GAMES = { sabotage: SabotageGame, tower: TowerGame, circuit: CircuitGame };

const TICK_HZ = 30;
const MAX_PLAYERS = 10;
const LOBBY_DROP_MS = 2 * 60 * 1000; // remove a disconnected player from a room after this
const ABANDON_MS = 45 * 1000; // end a match with no awards if nobody is connected

export function makeCode(existing = new Set()) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i++) code += letters[crypto.randomInt(letters.length)];
    if (!existing.has(code)) return code;
  }
}

class Room {
  constructor(manager, code, host) {
    this.manager = manager;
    this.code = code;
    this.hostId = host;
    this.members = new Map();
    this.phase = 'lobby'; // lobby | playing | results
    this.selected = { game: 'tower', options: { teams: false } };
    this.game = null;
    this.matchId = null;
    this.timer = null;
    this.lastResults = null;
    this.noOneSince = 0;
  }

  get store() {
    return this.manager.store;
  }

  addMember(userId) {
    const p = this.store.profile(userId);
    let m = this.members.get(userId);
    if (!m) {
      m = { userId, username: p.username, avatar: p.avatar, ready: false, team: null, connected: true, leftAt: 0, inCall: false, mic: false, cam: false };
      this.members.set(userId, m);
      if (this.selected.options.teams) m.team = this.#smallerTeam();
    }
    m.connected = true;
    m.leftAt = 0;
    return m;
  }

  #smallerTeam() {
    let red = 0;
    let blue = 0;
    for (const m of this.members.values()) {
      if (m.team === 'red') red++;
      if (m.team === 'blue') blue++;
    }
    return red <= blue ? 'red' : 'blue';
  }

  publicState() {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      selected: this.selected,
      matchId: this.matchId,
      members: [...this.members.values()].map((m) => ({
        userId: m.userId,
        username: m.username,
        avatar: m.avatar,
        ready: m.ready,
        team: m.team,
        connected: m.connected,
        inCall: m.inCall,
        mic: m.mic,
        cam: m.cam,
        playing: !!(this.game && this.game.hasPlayer(m.userId)),
      })),
    };
  }

  broadcast(msg, exceptId) {
    for (const m of this.members.values()) {
      if (m.userId !== exceptId) this.manager.sendTo(m.userId, msg);
    }
  }

  sync() {
    this.broadcast({ t: 'room', room: this.publicState() });
  }

  ensureHost() {
    const host = this.members.get(this.hostId);
    if (host && host.connected) return;
    const next = [...this.members.values()].find((m) => m.connected);
    if (next) this.hostId = next.userId;
  }

  select(userId, game, options) {
    if (userId !== this.hostId || this.phase !== 'lobby') return;
    if (!GAMES[game]) return;
    const teams = game === 'circuit' && !!(options && options.teams);
    this.selected = { game, options: { teams } };
    for (const m of this.members.values()) {
      m.ready = false;
      m.team = teams ? m.team || null : null;
    }
    if (teams) {
      // auto-balance anyone without a team
      for (const m of this.members.values()) if (!m.team) m.team = this.#smallerTeam();
    }
    this.sync();
  }

  setReady(userId, ready) {
    const m = this.members.get(userId);
    if (!m || this.phase !== 'lobby') return;
    m.ready = !!ready;
    this.sync();
  }

  setTeam(userId, team) {
    const m = this.members.get(userId);
    if (!m || this.phase !== 'lobby' || !this.selected.options.teams) return;
    if (team !== 'red' && team !== 'blue') return;
    m.team = team;
    m.ready = false;
    this.sync();
  }

  start(userId) {
    if (userId !== this.hostId || this.phase !== 'lobby') return 'Only the host can start.';
    const Game = GAMES[this.selected.game];
    const players = [...this.members.values()].filter((m) => m.connected);
    const notReady = players.filter((m) => !m.ready);
    if (notReady.length) return `Waiting for ${notReady.map((m) => m.username).join(', ')} to be ready.`;
    if (players.length < Game.minPlayers) return `${Game.title} needs at least ${Game.minPlayers} players.`;
    if (this.selected.options.teams) {
      const red = players.filter((m) => m.team === 'red').length;
      const blue = players.filter((m) => m.team === 'blue').length;
      if (!red || !blue) {
        // put players on alternating teams so both teams have someone
        players.forEach((m, i) => (m.team = i % 2 ? 'blue' : 'red'));
      }
    }
    this.matchId = crypto.randomUUID();
    const seed = randomSeed();
    this.game = new Game({
      players: players.map((m) => ({ userId: m.userId, username: m.username, avatar: m.avatar, team: m.team })),
      options: this.selected.options,
      seed,
    });
    this.phase = 'playing';
    this.lastResults = null;
    this.noOneSince = 0;
    for (const m of players) this.manager.sendTo(m.userId, this.gameStartMsg(m.userId));
    this.sync();
    let last = performance.now();
    this.timer = startTicker(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.tick(dt);
    }, 1000 / TICK_HZ);
    return null;
  }

  gameStartMsg(userId) {
    return {
      t: 'game:start',
      game: this.selected.game,
      matchId: this.matchId,
      init: this.game.init(userId),
    };
  }

  tick(dt) {
    const game = this.game;
    if (!game) return;
    game.update(dt);
    for (const ev of game.drainEvents()) {
      const msg = { t: 'game:event', matchId: this.matchId, ev };
      if (ev.to) for (const id of ev.to) this.manager.sendTo(id, msg);
      else this.broadcast(msg);
    }
    if (game.result) return this.finish(game.result);

    for (const m of this.members.values()) {
      if (m.connected && game.hasPlayer(m.userId)) {
        this.manager.sendTo(m.userId, { t: 'game:state', matchId: this.matchId, s: game.view(m.userId) });
      }
    }
    const anyone = [...this.members.values()].some((m) => m.connected && game.hasPlayer(m.userId));
    if (anyone) this.noOneSince = 0;
    else if (!this.noOneSince) this.noOneSince = Date.now();
    else if (Date.now() - this.noOneSince > ABANDON_MS) this.abandon();
  }

  finish(result) {
    stopTicker(this.timer);
    this.timer = null;
    const matchId = this.matchId;
    // Coins and stats are written once per matchId; repeats are ignored.
    const recorded = this.store.recordMatch(matchId, this.code, result);
    this.lastResults = { ...result, matchId, recorded };
    this.game = null;
    this.phase = 'results';
    for (const m of this.members.values()) m.ready = false;
    this.broadcast({ t: 'game:end', results: this.lastResults });
    if (recorded) {
      for (const a of result.awards) {
        this.manager.sendTo(a.userId, { t: 'award', matchId, game: result.game, coins: a.coins, won: !!a.won, timeMs: a.timeMs });
      }
    }
    this.sync();
  }

  abandon() {
    stopTicker(this.timer);
    this.timer = null;
    this.game = null;
    this.phase = 'lobby';
    this.broadcast({ t: 'toast', text: 'Match ended because everyone left. No coins were awarded.' });
    this.sync();
  }

  toLobby(userId) {
    if (userId !== this.hostId || this.phase !== 'results') return;
    this.phase = 'lobby';
    this.sync();
  }

  input(userId, keys) {
    if (this.game && this.game.hasPlayer(userId)) this.game.input(userId, sanitizeKeys(keys));
  }

  action(userId, msg) {
    if (this.game && this.game.hasPlayer(userId)) this.game.action(userId, msg);
  }

  leave(userId) {
    const m = this.members.get(userId);
    if (!m) return;
    if (m.inCall) this.callLeave(userId);
    this.members.delete(userId);
    if (this.game && this.game.hasPlayer(userId)) this.game.playerLeft(userId);
    this.ensureHost();
    this.sync();
  }

  // ----- calls (WebRTC signaling only; media goes peer-to-peer) -----
  callJoin(userId) {
    const m = this.members.get(userId);
    if (!m) return;
    m.inCall = true;
    m.mic = false;
    m.cam = false;
    const peers = [...this.members.values()].filter((o) => o.inCall && o.userId !== userId && o.connected).map((o) => o.userId);
    this.manager.sendTo(userId, { t: 'call:peers', peers });
    this.broadcast({ t: 'call:joined', userId }, userId);
    this.sync();
  }

  callLeave(userId) {
    const m = this.members.get(userId);
    if (!m || !m.inCall) return;
    m.inCall = false;
    m.mic = false;
    m.cam = false;
    this.broadcast({ t: 'call:left', userId }, userId);
    this.sync();
  }

  callSignal(userId, to, data) {
    const a = this.members.get(userId);
    const b = this.members.get(to);
    if (!a || !b || !a.inCall || !b.inCall) return;
    this.manager.sendTo(to, { t: 'call:signal', from: userId, data });
  }

  callMedia(userId, mic, cam) {
    const m = this.members.get(userId);
    if (!m || !m.inCall) return;
    m.mic = !!mic;
    m.cam = !!cam;
    this.sync();
  }
}

function sanitizeKeys(k) {
  k = k && typeof k === 'object' ? k : {};
  return { up: !!k.up, down: !!k.down, left: !!k.left, right: !!k.right, action: !!k.action, jump: !!k.jump };
}

class MemoryStore {
  constructor() {
    this.profiles = new Map();
    this.matches = new Set();
  }
  setProfile(p) {
    this.profiles.set(p.id, { id: p.id, username: p.username, avatar: p.avatar });
  }
  profile(userId) {
    return this.profiles.get(userId) || null;
  }
  recordMatch(matchId) {
    if (this.matches.has(matchId)) return false;
    this.matches.add(matchId);
    return true;
  }
}

function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const id = Number(p.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const username = String(p.username || '').replace(/[^A-Za-z0-9_ ]/g, '').trim().slice(0, 16);
  if (!username) return null;
  return { id, username, avatar: p.avatar && typeof p.avatar === 'object' ? p.avatar : {} };
}

export class RoomManager {
  constructor() {
    this.store = new MemoryStore();
    this.rooms = new Map();
    this.userRoom = new Map();
    this.sockets = new Map();
    this.sweeper = setInterval(() => this.sweep(), 10000);
  }

  /** The host's browser owns exactly one room, with a fixed code. */
  createRoom(code, hostId) {
    const r = new Room(this, code, hostId);
    this.rooms.set(code, r);
    return r;
  }

  sendTo(userId, msg) {
    const ws = this.sockets.get(userId);
    if (ws) ws.send(msg);
  }

  roomOf(userId) {
    const code = this.userRoom.get(userId);
    return code ? this.rooms.get(code) : null;
  }

  handleConnection(ws) {
    let userId = null;
    let budget = 120;
    const refill = setInterval(() => (budget = 120), 1000);
    const authTimeout = setTimeout(() => !userId && ws.close(4001, 'auth timeout'), 10000);

    ws.on('message', (msg) => {
      if (--budget < 0) return; // flood protection
      if (!userId) {
        if (msg.t !== 'auth') return;
        const prof = cleanProfile(msg.profile);
        if (!prof) {
          ws.send({ t: 'auth:fail' });
          return ws.close(4001, 'bad profile');
        }
        const id = prof.id;
        this.store.setProfile(prof);
        userId = id;
        clearTimeout(authTimeout);
        const old = this.sockets.get(id);
        if (old && old !== ws) {
          old.send({ t: 'replaced' });
          old.close(4000, 'replaced');
        }
        this.sockets.set(id, ws);
        ws.send({ t: 'hello' });
        this.reconnect(id);
        return;
      }
      try {
        this.onMessage(userId, msg);
      } catch (e) {
        console.error('message error', e);
      }
    });

    ws.on('close', () => {
      clearInterval(refill);
      clearTimeout(authTimeout);
      if (!userId || this.sockets.get(userId) !== ws) return;
      this.sockets.delete(userId);
      const room = this.roomOf(userId);
      if (room) {
        const m = room.members.get(userId);
        if (m) {
          m.connected = false;
          m.leftAt = Date.now();
          if (m.inCall) room.callLeave(userId);
        }
        if (room.game && room.game.hasPlayer(userId)) room.game.setConnected(userId, false);
        room.ensureHost();
        room.sync();
      }
    });
  }

  /** Put a returning player back where they were (lobby, match or results). */
  reconnect(userId) {
    const room = this.roomOf(userId);
    if (!room) return;
    room.addMember(userId);
    this.sendTo(userId, { t: 'room', room: room.publicState() });
    if (room.game && room.game.hasPlayer(userId)) {
      room.game.setConnected(userId, true);
      this.sendTo(userId, room.gameStartMsg(userId));
    } else if (room.phase === 'results' && room.lastResults) {
      this.sendTo(userId, { t: 'game:end', results: room.lastResults });
    }
    room.ensureHost();
    room.sync();
  }

  onMessage(userId, msg) {
    const room = this.roomOf(userId);
    switch (msg.t) {
      case 'ping':
        return this.sendTo(userId, { t: 'pong' });
      case 'profile:update': {
        const prof = cleanProfile({ ...msg.profile, id: userId });
        if (prof) {
          this.store.setProfile(prof);
          this.profileChanged(userId);
        }
        return;
      }
      case 'room:join': {
        const code = String(msg.code || '').toUpperCase().trim();
        const r = this.rooms.get(code);
        if (!r) return this.sendTo(userId, { t: 'error', text: `No room with code ${code}. Check the code and try again.` });
        if (room === r) return this.reconnect(userId);
        if (r.members.size >= MAX_PLAYERS) return this.sendTo(userId, { t: 'error', text: 'That room is full.' });
        if (room) room.leave(userId);
        this.userRoom.set(userId, code);
        r.addMember(userId);
        r.ensureHost();
        r.sync();
        if (r.phase === 'results' && r.lastResults) this.sendTo(userId, { t: 'game:end', results: r.lastResults });
        return;
      }
      case 'room:leave':
        if (room) {
          room.leave(userId);
          this.userRoom.delete(userId);
          this.sendTo(userId, { t: 'room', room: null });
        }
        return;
    }
    if (!room) return;
    switch (msg.t) {
      case 'room:select':
        return room.select(userId, msg.game, msg.options);
      case 'room:ready':
        return room.setReady(userId, msg.ready);
      case 'room:team':
        return room.setTeam(userId, msg.team);
      case 'room:start': {
        const err = room.start(userId);
        if (err) this.sendTo(userId, { t: 'error', text: err });
        return;
      }
      case 'room:toLobby':
        return room.toLobby(userId);
      case 'input':
        return room.input(userId, msg.keys);
      case 'act':
        return room.action(userId, msg);
      case 'call:join':
        return room.callJoin(userId);
      case 'call:leave':
        return room.callLeave(userId);
      case 'call:signal':
        return room.callSignal(userId, Number(msg.to), msg.data);
      case 'call:media':
        return room.callMedia(userId, msg.mic, msg.cam);
    }
  }

  profileChanged(userId) {
    const room = this.roomOf(userId);
    const p = this.store.profile(userId);
    if (!room || !p) return;
    const m = room.members.get(userId);
    if (m) {
      m.avatar = p.avatar;
      m.username = p.username;
      room.sync();
    }
  }

  deleteRoom(room) {
    stopTicker(room.timer);
    this.rooms.delete(room.code);
  }

  sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      for (const m of [...room.members.values()]) {
        if (!m.connected && now - m.leftAt > LOBBY_DROP_MS && !(room.game && room.game.hasPlayer(m.userId))) {
          room.leave(m.userId);
          this.userRoom.delete(m.userId);
        }
      }
    }
  }

  shutdown() {
    clearInterval(this.sweeper);
    for (const r of this.rooms.values()) stopTicker(r.timer);
    for (const ws of this.sockets.values()) ws.close();
    this.sockets.clear();
  }
}
