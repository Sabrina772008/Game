// Friend Arcade server: static files, account API, WebSocket rooms & games.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ROOT } from './config.js';
import { Store, UserError } from './db.js';
import { attachWebSocketServer } from './ws.js';
import { RoomManager } from './rooms.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const STATIC_DIRS = { '/shared/': path.join(ROOT, 'shared'), '/': path.join(ROOT, 'public') };

export function createServer({ dbPath = config.dbPath } = {}) {
  const store = new Store(dbPath);
  const rooms = new RoomManager(store);
  const attempts = new Map(); // ip -> {count, reset}

  function clientIp(req) {
    if (config.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return req.socket.remoteAddress || '?';
  }

  function rateLimited(req) {
    const ip = clientIp(req);
    const now = Date.now();
    let a = attempts.get(ip);
    if (!a || a.reset < now) a = { count: 0, reset: now + 10 * 60 * 1000 };
    a.count++;
    attempts.set(ip, a);
    return a.count > 30;
  }

  function send(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(data);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 16 * 1024) {
          reject(new UserError('Request too large.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(new UserError('Invalid JSON.'));
        }
      });
      req.on('error', reject);
    });
  }

  function authUserId(req) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    return token ? store.userIdForToken(token) : null;
  }

  function iceServers() {
    const servers = [];
    if (config.stunUrls.length) servers.push({ urls: config.stunUrls });
    if (config.turnUrls.length) {
      if (config.turnSecret) {
        const username = `${Math.floor(Date.now() / 1000) + config.turnTtl}:arcade`;
        const credential = crypto.createHmac('sha1', config.turnSecret).update(username).digest('base64');
        servers.push({ urls: config.turnUrls, username, credential });
      } else {
        servers.push({ urls: config.turnUrls, username: config.turnUsername, credential: config.turnCredential });
      }
    }
    return servers;
  }

  async function api(req, res, pathname) {
    const method = req.method;
    if (pathname === '/api/signup' && method === 'POST') {
      if (rateLimited(req)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      const { username, password } = await readJson(req);
      const name = String(username || '').trim();
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new UserError('Username must be 3-16 letters, numbers or _.');
      if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
        throw new UserError('Password must be at least 6 characters.');
      }
      if (store.findUserByName(name)) throw new UserError('That username is taken.');
      const id = store.createUser(name, password);
      return send(res, 200, { token: store.createSession(id), profile: store.profile(id) });
    }
    if (pathname === '/api/login' && method === 'POST') {
      if (rateLimited(req)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      const { username, password } = await readJson(req);
      const user = store.findUserByName(String(username || '').trim());
      if (!user || typeof password !== 'string' || !store.verifyPassword(user, password)) {
        throw new UserError('Wrong username or password.');
      }
      return send(res, 200, { token: store.createSession(user.id), profile: store.profile(user.id) });
    }
    if (pathname === '/api/config' && method === 'GET') {
      return send(res, 200, { iceServers: iceServers() });
    }

    const userId = authUserId(req);
    if (!userId) return send(res, 401, { error: 'Please sign in.' });

    if (pathname === '/api/logout' && method === 'POST') {
      store.deleteSession((req.headers.authorization || '').slice(7));
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/me' && method === 'GET') {
      return send(res, 200, { profile: store.profile(userId) });
    }
    if (pathname === '/api/avatar' && method === 'PUT') {
      const { avatar } = await readJson(req);
      store.setAvatar(userId, avatar);
      rooms.profileChanged(userId);
      return send(res, 200, { profile: store.profile(userId) });
    }
    if (pathname === '/api/shop/buy' && method === 'POST') {
      const { itemId } = await readJson(req);
      store.buyItem(userId, String(itemId || ''));
      return send(res, 200, { profile: store.profile(userId) });
    }
    return send(res, 404, { error: 'Not found' });
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    let base = STATIC_DIRS['/'];
    let rel = pathname;
    if (pathname.startsWith('/shared/')) {
      base = STATIC_DIRS['/shared/'];
      rel = pathname.slice('/shared'.length);
    }
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(base, decodeURIComponent(rel)));
    if (!file.startsWith(base + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        // Single-page app: unknown paths (like /room/ABCDE) get index.html.
        if (!path.extname(rel)) return serveStatic(req, res, '/');
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    try {
      if (pathname === '/healthz') return send(res, 200, { ok: true });
      if (pathname.startsWith('/api/')) return await api(req, res, pathname);
      return serveStatic(req, res, pathname);
    } catch (e) {
      if (e instanceof UserError) return send(res, 400, { error: e.message });
      console.error(e);
      return send(res, 500, { error: 'Server error' });
    }
  });

  const wss = attachWebSocketServer(server, (ws) => rooms.handleConnection(ws));

  return {
    server,
    store,
    rooms,
    close() {
      wss.close();
      rooms.shutdown();
      for (const ws of wss.connections) ws.terminate();
      server.close();
      store.close();
    },
  };
}

// Start when run directly (npm start), not when imported by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'server', 'index.js')) {
  const app = createServer();
  app.server.listen(config.port, config.host, () => {
    console.log(`Friend Arcade running on http://localhost:${config.port}`);
    console.log(`Database: ${config.dbPath}`);
  });
  const stop = () => {
    app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
