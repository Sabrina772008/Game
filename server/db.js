// SQLite storage using Node's built-in node:sqlite module (Node 22.13+).
// Holds accounts, sessions, unlocked items, stats and the match/award ledger.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_AVATAR, freeItemIds, sanitizeAvatar, ITEM_BY_ID } from '../shared/cosmetics.js';

export class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
        avatar TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS unlocks (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        PRIMARY KEY (user_id, item_id)
      );
      CREATE TABLE IF NOT EXISTS stats (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game TEXT NOT NULL,
        plays INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        best_time_ms INTEGER,
        PRIMARY KEY (user_id, game)
      );
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        game TEXT NOT NULL,
        results TEXT NOT NULL,
        finished_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS awards (
        match_id TEXT NOT NULL REFERENCES matches(id),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        coins INTEGER NOT NULL,
        PRIMARY KEY (match_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS coin_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        ref TEXT,
        at INTEGER NOT NULL
      );
    `);
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- accounts ----------
  createUser(username, password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    return this.tx(() => {
      const r = this.db
        .prepare('INSERT INTO users (username, pass_hash, salt, coins, avatar, created_at) VALUES (?, ?, ?, 0, ?, ?)')
        .run(username, hash, salt, JSON.stringify(DEFAULT_AVATAR), Date.now());
      const id = Number(r.lastInsertRowid);
      const ins = this.db.prepare('INSERT OR IGNORE INTO unlocks (user_id, item_id) VALUES (?, ?)');
      for (const item of freeItemIds()) ins.run(id, item);
      return id;
    });
  }

  findUserByName(username) {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  }

  verifyPassword(user, password) {
    const hash = hashPassword(password, user.salt);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.pass_hash, 'hex'));
  }

  createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = Date.now() + 30 * 24 * 3600 * 1000;
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    return token;
  }

  userIdForToken(token) {
    if (typeof token !== 'string' || token.length > 200) return null;
    const row = this.db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token));
    if (!row || row.expires_at < Date.now()) return null;
    return row.user_id;
  }

  deleteSession(token) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(String(token)));
  }

  /** Public profile for the signed-in player (what the client shows). */
  profile(userId) {
    const u = this.db.prepare('SELECT id, username, coins, avatar FROM users WHERE id = ?').get(userId);
    if (!u) return null;
    const unlocked = this.db.prepare('SELECT item_id FROM unlocks WHERE user_id = ?').all(userId).map((r) => r.item_id);
    const stats = {};
    for (const s of this.db.prepare('SELECT game, plays, wins, best_time_ms FROM stats WHERE user_id = ?').all(userId)) {
      stats[s.game] = { plays: s.plays, wins: s.wins, bestTimeMs: s.best_time_ms };
    }
    return {
      id: u.id,
      username: u.username,
      coins: u.coins,
      avatar: sanitizeAvatar(JSON.parse(u.avatar)),
      unlocked,
      stats,
    };
  }

  setAvatar(userId, avatar) {
    const clean = sanitizeAvatar(avatar);
    const owned = new Set(this.db.prepare('SELECT item_id FROM unlocks WHERE user_id = ?').all(userId).map((r) => r.item_id));
    for (const id of Object.values(clean)) {
      if (!owned.has(id)) throw new UserError(`You haven't unlocked ${ITEM_BY_ID[id].name} yet.`);
    }
    this.db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(JSON.stringify(clean), userId);
    return clean;
  }

  buyItem(userId, itemId) {
    const item = ITEM_BY_ID[itemId];
    if (!item) throw new UserError('Unknown item.');
    return this.tx(() => {
      const has = this.db.prepare('SELECT 1 FROM unlocks WHERE user_id = ? AND item_id = ?').get(userId, itemId);
      if (has) throw new UserError('You already own that.');
      const r = this.db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').run(item.price, userId, item.price);
      if (r.changes !== 1) throw new UserError('Not enough coins yet - play a match to earn more!');
      this.db.prepare('INSERT INTO unlocks (user_id, item_id) VALUES (?, ?)').run(userId, itemId);
      this.db
        .prepare('INSERT INTO coin_ledger (user_id, delta, reason, ref, at) VALUES (?, ?, ?, ?, ?)')
        .run(userId, -item.price, 'purchase', itemId, Date.now());
    });
  }

  // ---------- matches & awards ----------
  /**
   * Records a finished match exactly once. Calling it again with the same
   * matchId (after a reconnect, refresh, retry or bug) changes nothing.
   * result = { game, awards: [{userId, coins, won, timeMs?}], ... }
   * Returns true if this call recorded the match, false if it already existed.
   */
  recordMatch(matchId, roomCode, result) {
    return this.tx(() => {
      const ins = this.db
        .prepare('INSERT OR IGNORE INTO matches (id, room_code, game, results, finished_at) VALUES (?, ?, ?, ?, ?)')
        .run(matchId, roomCode, result.game, JSON.stringify(result), Date.now());
      if (ins.changes === 0) return false;
      const award = this.db.prepare('INSERT OR IGNORE INTO awards (match_id, user_id, coins) VALUES (?, ?, ?)');
      const addCoins = this.db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?');
      const ledger = this.db.prepare('INSERT INTO coin_ledger (user_id, delta, reason, ref, at) VALUES (?, ?, ?, ?, ?)');
      const stat = this.db.prepare(`
        INSERT INTO stats (user_id, game, plays, wins, best_time_ms) VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id, game) DO UPDATE SET
          plays = plays + 1,
          wins = wins + excluded.wins,
          best_time_ms = CASE
            WHEN excluded.best_time_ms IS NULL THEN best_time_ms
            WHEN best_time_ms IS NULL OR excluded.best_time_ms < best_time_ms THEN excluded.best_time_ms
            ELSE best_time_ms END`);
      const exists = this.db.prepare('SELECT 1 FROM users WHERE id = ?');
      for (const a of result.awards) {
        if (!exists.get(a.userId)) continue;
        const coins = Math.max(0, Math.floor(a.coins || 0));
        const r = award.run(matchId, a.userId, coins);
        if (r.changes !== 1) continue;
        if (coins > 0) {
          addCoins.run(coins, a.userId);
          ledger.run(a.userId, coins, 'match', matchId, Date.now());
        }
        stat.run(a.userId, result.game, a.won ? 1 : 0, Number.isFinite(a.timeMs) ? Math.round(a.timeMs) : null);
      }
      return true;
    });
  }

  close() {
    this.db.close();
  }
}

export class UserError extends Error {}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
