// A small, dependency-free WebSocket server (RFC 6455) that is enough for
// JSON game messages: text frames, fragmentation, ping/pong and close.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 256 * 1024;

export class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.open = true;
    this.alive = true;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('close', () => this.#closed());
    socket.on('error', () => this.#closed());
  }

  send(obj) {
    if (!this.open) return;
    const data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
    this.#writeFrame(0x1, data);
  }

  ping() {
    if (this.open) this.#writeFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(reason);
    const payload = Buffer.alloc(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    this.#writeFrame(0x8, payload);
    this.socket.end();
    this.#closed();
  }

  terminate() {
    this.socket.destroy();
    this.#closed();
  }

  #closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  #writeFrame(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.#closed();
    }
  }

  #onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.open) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return this.close(1009, 'too big');
        len = Number(big);
        offset = 10;
      }
      if (len > MAX_MESSAGE) return this.close(1009, 'too big');
      if (!masked) return this.close(1002, 'client frames must be masked');
      if (buf.length < offset + 4 + len) return;
      const mask = buf.subarray(offset, offset + 4);
      const payload = Buffer.from(buf.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = buf.subarray(offset + 4 + len);
      this.#onFrame(fin, opcode, payload);
    }
  }

  #onFrame(fin, opcode, payload) {
    this.alive = true;
    switch (opcode) {
      case 0x0: // continuation
        this.fragments.push(payload);
        if (fin) {
          const all = Buffer.concat(this.fragments);
          this.fragments = [];
          if (this.fragmentOpcode === 0x1) this.#message(all);
        }
        break;
      case 0x1: // text
      case 0x2: // binary (ignored but tolerated)
        if (fin) {
          if (opcode === 0x1) this.#message(payload);
        } else {
          this.fragmentOpcode = opcode;
          this.fragments = [payload];
        }
        break;
      case 0x8:
        this.close(1000);
        break;
      case 0x9:
        this.#writeFrame(0xa, payload);
        break;
      case 0xa:
        break;
      default:
        this.close(1003, 'unsupported');
    }
  }

  #message(buf) {
    let msg;
    try {
      msg = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    if (msg && typeof msg === 'object') this.emit('message', msg);
  }
}

/** Attach to an http.Server. onConnection(ws) is called for /ws upgrades. */
export function attachWebSocketServer(server, onConnection) {
  const connections = new Set();
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== '/ws' || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const ws = new WsConnection(socket, req);
    connections.add(ws);
    ws.on('close', () => connections.delete(ws));
    onConnection(ws, req);
  });

  // Heartbeat: drop dead connections, keep proxies from idling us out.
  const timer = setInterval(() => {
    for (const ws of connections) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 25000);
  timer.unref();
  return { connections, close: () => clearInterval(timer) };
}
