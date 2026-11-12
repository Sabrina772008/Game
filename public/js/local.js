// Player profiles saved in this browser (GitHub Pages has no server/database).
// Coins, unlocked items and stats live on the device you play on.
import { DEFAULT_AVATAR, freeItemIds, sanitizeAvatar, ITEM_BY_ID } from '/shared/cosmetics.js';

const KEY = 'fa_profiles';
const CUR = 'fa_current';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function saveAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked */
  }
}

export function currentProfile() {
  let name = null;
  try {
    name = localStorage.getItem(CUR);
  } catch {
    return null;
  }
  return name ? load()[name] || null : null;
}

/** Sign in as `username` on this device (creates the profile the first time). */
export function signIn(username) {
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) throw new Error('Use 2-16 letters, numbers or _ for your name.');
  const key = name.toLowerCase();
  const all = load();
  let p = all[key];
  if (!p) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    p = { id: 1 + (a[0] % 2147483646), username: name, coins: 0, avatar: { ...DEFAULT_AVATAR }, unlocked: freeItemIds(), stats: {}, awarded: [] };
    all[key] = p;
    saveAll(all);
  }
  try {
    localStorage.setItem(CUR, key);
  } catch {
    /* ignore */
  }
  return p;
}

export function signOut() {
  try {
    localStorage.removeItem(CUR);
  } catch {
    /* ignore */
  }
}

function update(profile, fn) {
  const all = load();
  const key = profile.username.toLowerCase();
  const p = all[key] || profile;
  fn(p);
  all[key] = p;
  saveAll(all);
  return p;
}

export function setAvatar(profile, avatar) {
  const clean = sanitizeAvatar(avatar);
  const owned = new Set(profile.unlocked);
  for (const id of Object.values(clean)) if (!owned.has(id)) throw new Error(`You haven't unlocked ${ITEM_BY_ID[id].name} yet.`);
  return update(profile, (p) => (p.avatar = clean));
}

export function buyItem(profile, itemId) {
  const item = ITEM_BY_ID[itemId];
  if (!item) throw new Error('Unknown item.');
  if (profile.unlocked.includes(itemId)) throw new Error('You already own that.');
  if (profile.coins < item.price) throw new Error('Not enough coins yet - play a match to earn more!');
  return update(profile, (p) => {
    p.coins -= item.price;
    p.unlocked.push(itemId);
  });
}

/** Save a match prize once per match id. Returns the updated profile, or null if already saved. */
export function applyAward(profile, a) {
  if ((profile.awarded || []).includes(a.matchId)) return null;
  return update(profile, (p) => {
    p.awarded = [...(p.awarded || []), a.matchId].slice(-200);
    p.coins += Math.max(0, Math.floor(a.coins || 0));
    const s = (p.stats[a.game] = p.stats[a.game] || { plays: 0, wins: 0, bestTimeMs: null });
    s.plays++;
    if (a.won) s.wins++;
    if (Number.isFinite(a.timeMs) && (s.bestTimeMs == null || a.timeMs < s.bestTimeMs)) s.bestTimeMs = Math.round(a.timeMs);
  });
}
