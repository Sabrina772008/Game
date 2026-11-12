// Peer-to-peer networking for the GitHub Pages version.
// The room creator's browser runs the room (host.js). Everyone else connects
// to it through PeerJS (free public matchmaking server + WebRTC data channel).
import { RoomManager } from './host.js';

const PREFIX = 'friendarcade-sabrina772008-';
export const peerIdFor = (code) => PREFIX + String(code).toUpperCase();

// Free relay servers that come with PeerJS, plus Google STUN. Used for both the
// game connection and the voice/video call.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];
const PEER_OPTS = { debug: 1, config: { iceServers: ICE_SERVERS } };

function PeerCtor() {
  if (!window.Peer) throw new Error('Could not load the connection library. Check your internet and refresh.');
  return window.Peer;
}

const clone = (m) => JSON.parse(JSON.stringify(m));

/** Runs the room in this browser tab and accepts players. */
export class HostServer {
  constructor() {
    this.manager = null;
    this.peer = null;
    this.code = null;
    this.stopped = false;
  }

  /** Claim the PeerJS id for this room code. Rejects with err.type === 'unavailable-id' if taken. */
  start(code, hostId) {
    this.code = code;
    return new Promise((resolve, reject) => {
      const Peer = PeerCtor();
      const peer = new Peer(peerIdFor(code), PEER_OPTS);
      let opened = false;
      peer.on('open', () => {
        opened = true;
        this.peer = peer;
        this.manager = new RoomManager();
        this.manager.createRoom(code, hostId);
        resolve(code);
      });
      peer.on('connection', (conn) => this.#accept(conn));
      peer.on('disconnected', () => {
        // lost the matchmaking server; existing players keep playing
        if (!this.stopped && !peer.destroyed) setTimeout(() => !this.stopped && !peer.destroyed && peer.reconnect(), 2000);
      });
      peer.on('error', (err) => {
        if (!opened) {
          peer.destroy();
          reject(err);
        } else console.warn('host peer error', err.type, err);
      });
    });
  }

  #accept(conn) {
    const listeners = { message: [], close: [] };
    let closed = false;
    let lastSeen = Date.now();
    const fireClose = () => {
      if (closed) return;
      closed = true;
      clearInterval(watchdog);
      for (const f of listeners.close) f();
    };
    const ws = {
      send: (m) => {
        if (!closed && conn.open) {
          try {
            conn.send(m);
          } catch {
            /* channel closing */
          }
        }
      },
      close: () => {
        try {
          conn.close();
        } catch {
          /* ignore */
        }
        fireClose();
      },
      on: (ev, f) => listeners[ev]?.push(f),
    };
    // Drop players whose connection silently died (no ping for 20 s).
    const watchdog = setInterval(() => Date.now() - lastSeen > 20000 && ws.close(), 5000);
    // Messages can arrive a moment before this side sees 'open': hold them.
    let ready = false;
    const early = [];
    const deliver = (m) => {
      for (const f of listeners.message) f(m);
    };
    conn.on('open', () => {
      if (ready) return;
      ready = true;
      this.manager.handleConnection(ws);
      early.splice(0).forEach(deliver);
    });
    conn.on('data', (m) => {
      lastSeen = Date.now();
      if (!m || typeof m !== 'object') return;
      if (ready) deliver(m);
      else if (early.length < 50) early.push(m);
    });
    if (conn.open) conn.emit?.('open');
    conn.on('close', fireClose);
    conn.on('error', fireClose);
  }

  /** A socket for the host's own player, wired straight into the room. */
  localLink() {
    const listeners = { message: [], close: [] };
    let client = null;
    const ws = {
      send: (m) => {
        const c = clone(m);
        queueMicrotask(() => client?.deliver(c));
      },
      close: () => {
        for (const f of listeners.close) f();
        listeners.close = [];
      },
      on: (ev, f) => listeners[ev]?.push(f),
    };
    return {
      attach: (c) => {
        client = c;
        this.manager.handleConnection(ws);
      },
      toHost: (m) => {
        const c = clone(m);
        queueMicrotask(() => listeners.message.forEach((f) => f(c)));
      },
      close: () => ws.close(),
    };
  }

  /** Close the room. With notify, tell everyone it closed (instead of them waiting for a reconnect). */
  stop(notify = false) {
    if (this.stopped) return;
    this.stopped = true;
    if (notify && this.manager) for (const ws of this.manager.sockets.values()) ws.send({ t: 'room:closed' });
    const peer = this.peer;
    const manager = this.manager;
    setTimeout(() => {
      manager?.shutdown();
      peer?.destroy();
    }, notify ? 400 : 0);
  }
}

/** Client connection for the host's own player (no network). Same API as PeerSocket. */
export class LocalSocket {
  constructor(host, handlers) {
    this.handlers = handlers;
    this.link = host.localLink();
    this.open = true;
    this.link.attach({ deliver: (m) => this.open && this.handlers.onMessage(m) });
    queueMicrotask(() => {
      this.link.toHost({ t: 'auth', profile: handlers.authProfile() });
      handlers.onOpen?.();
    });
  }
  get connected() {
    return this.open;
  }
  send(msg) {
    if (this.open) this.link.toHost(msg);
  }
  close() {
    this.open = false;
    this.link.close();
  }
}

/**
 * Client connection to someone else's room. Reconnects by itself.
 * handlers: { onMessage, onOpen, onClose, onGone(reason), authProfile() }
 */
export class PeerSocket {
  constructor(code, handlers) {
    this.code = code;
    this.handlers = handlers;
    this.peer = null;
    this.conn = null;
    this.closedByUs = false;
    this.everOpened = false;
    this.retry = 0;
    this.unavailableSince = 0;
    this.queue = [];
    this.lastHeard = Date.now();
    this.pinger = setInterval(() => this.#heartbeat(), 4000);
    this.#ensurePeer();
  }

  #ensurePeer() {
    if (this.closedByUs) return;
    if (this.peer && !this.peer.destroyed) {
      if (this.peer.disconnected) this.peer.reconnect();
      else if (this.peer.open) this.#connect();
      return;
    }
    const Peer = PeerCtor();
    const peer = new Peer(PEER_OPTS);
    this.peer = peer;
    peer.on('open', () => this.#connect());
    peer.on('disconnected', () => {
      if (!this.closedByUs && !peer.destroyed) setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (this.closedByUs) return;
      if (err.type === 'peer-unavailable') {
        // Nobody is hosting this code (yet / any more).
        if (!this.everOpened) return this.#gone(`No room with code ${this.code}. Check the code, or ask the host to keep the game open.`);
        if (!this.unavailableSince) this.unavailableSince = Date.now();
        if (Date.now() - this.unavailableSince > 60000) return this.#gone('The room has closed (the host left).');
        return this.#scheduleRetry();
      }
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type)) {
        return this.#scheduleRetry();
      }
      if (err.type === 'browser-incompatible') return this.#gone('This browser cannot connect. Try Chrome, Edge, Safari or Firefox.');
      console.warn('peer error', err.type, err);
      this.#scheduleRetry();
    });
  }

  #connect() {
    if (this.closedByUs) return;
    if (this.conn) {
      try {
        this.conn.close();
      } catch {
        /* ignore */
      }
    }
    const conn = this.peer.connect(peerIdFor(this.code), { reliable: true, serialization: 'json' });
    this.conn = conn;
    let opened = false;
    const openTimer = setTimeout(() => {
      if (!opened && this.conn === conn) {
        try {
          conn.close();
        } catch {
          /* ignore */
        }
        this.#scheduleRetry();
      }
    }, 15000);
    conn.on('open', () => {
      opened = true;
      clearTimeout(openTimer);
      if (this.conn !== conn) return;
      this.everOpened = true;
      this.unavailableSince = 0;
      this.retry = 0;
      this.lastHeard = Date.now();
      conn.send({ t: 'auth', profile: this.handlers.authProfile() });
      for (const m of this.queue.splice(0)) conn.send(m);
      this.handlers.onOpen?.();
    });
    conn.on('data', (msg) => {
      if (this.conn !== conn || !msg || typeof msg !== 'object') return;
      this.lastHeard = Date.now();
      if (msg.t === 'pong') return;
      if (msg.t === 'replaced') this.closedByUs = true;
      if (msg.t === 'room:closed') return this.#gone('The host closed the room.');
      this.handlers.onMessage(msg);
    });
    const onDrop = () => {
      clearTimeout(openTimer);
      if (this.conn !== conn) return;
      this.conn = null;
      if (opened) this.handlers.onClose?.();
      this.#scheduleRetry();
    };
    conn.on('close', onDrop);
    conn.on('error', onDrop);
  }

  #heartbeat() {
    if (!this.connected) return;
    this.conn.send({ t: 'ping' });
    if (Date.now() - this.lastHeard > 10000) {
      // host went quiet: reconnect
      const c = this.conn;
      this.conn = null;
      try {
        c.close();
      } catch {
        /* ignore */
      }
      this.handlers.onClose?.();
      this.#scheduleRetry();
    }
  }

  #scheduleRetry() {
    if (this.closedByUs || this.retryTimer) return;
    const delay = Math.min(5000, 500 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.#ensurePeer();
    }, delay);
  }

  #gone(reason) {
    this.close();
    this.handlers.onGone?.(reason);
  }

  get connected() {
    return !!(this.conn && this.conn.open);
  }

  send(msg) {
    if (this.connected) {
      try {
        this.conn.send(msg);
      } catch {
        /* closing */
      }
    } else if (msg.t !== 'input' && msg.t !== 'ping') this.queue.push(msg);
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.pinger);
    clearTimeout(this.retryTimer);
    try {
      this.conn?.close();
    } catch {
      /* ignore */
    }
    this.peer?.destroy();
  }
}
