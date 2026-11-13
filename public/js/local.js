// Player accounts, saved online with Supabase (free plan).
// Each player signs in with their email and a code we email them. Their coins, avatar,
// unlocked items, stats and today's play time follow them to any device.
//
// The key below is Supabase's *publishable* key: it is meant to be public.
// The database only lets a signed-in player read and change their own row.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { DEFAULT_AVATAR, freeItemIds, sanitizeAvatar, ITEM_BY_ID } from '/shared/cosmetics.js';

// ---- SETTINGS --------------------------------------------------------------
const SUPABASE_URL = 'https://qivxncxpbrjxspicgbls.supabase.co';
const SUPABASE_KEY = 'sb_publishable_poHAKWFmGFrkonSkv3-XCA_cmzfkdri';
// Players only type a username. Supabase needs an email, so we make one up.
const EMAIL_DOMAIN = 'players.friendarcade.app';
// ---------------------------------------------------------------------------

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fa_auth' },
});

const OLD_KEY = 'fa_profiles'; // progress saved on this device before logins existed
const PLAYTIME_KEY = 'fa_playtime'; // same key playtime.js uses

let userId = null;
let current = null;

const toEmail = (name) => `${name.toLowerCase()}@${EMAIL_DOMAIN}`;

function fromRow(r) {
  return {
    id: r.game_id,
    username: r.username,
    coins: r.coins,
    avatar: { ...DEFAULT_AVATAR, ...(r.avatar || {}) },
    unlocked: Array.isArray(r.unlocked) && r.unlocked.length ? r.unlocked : freeItemIds(),
    stats: r.stats || {},
    awarded: r.awarded || [],
  };
}

function toRow(p) {
  return {
    coins: p.coins,
    avatar: p.avatar,
    unlocked: p.unlocked,
    stats: p.stats,
    awarded: p.awarded || [],
    updated_at: new Date().toISOString(),
  };
}

function oldDeviceProfile(username) {
  try {
    return (JSON.parse(localStorage.getItem(OLD_KEY)) || {})[username.toLowerCase()] || null;
  } catch {
    return null;
  }
}

function newGameId() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return 1 + (a[0] % 2147483646);
}

let pendingUser = null;

/** Load this player's saved row. Returns null if they still need to pick a player name. */
async function loadPlayer(user) {
  userId = user.id;
  const { data, error } = await sb.from('players').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(`Couldn't load your player: ${error.message}`);
  if (!data) {
    pendingUser = user;
    return null;
  }
  current = fromRow(data);
  await syncPlaytime();
  return current;
}

/** First sign-in: make the player with the name they picked. */
export async function createPlayer(nameIn) {
  const username = String(nameIn || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('Use 3-16 letters, numbers or _ for your player name.');
  if (!pendingUser) throw new Error('Please sign in again.');
  // Bring over coins/avatar this player already had on this device.
  const old = oldDeviceProfile(username);
  const p = {
    id: old?.id || newGameId(),
    username,
    coins: old?.coins || 0,
    avatar: old?.avatar || { ...DEFAULT_AVATAR },
    unlocked: old?.unlocked || freeItemIds(),
    stats: old?.stats || {},
    awarded: old?.awarded || [],
  };
  const { error } = await sb.from('players').insert({ id: pendingUser.id, username, game_id: p.id, ...toRow(p) });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('That player name is taken. Try another one.');
    throw new Error(`Couldn't create your player: ${error.message}`);
  }
  pendingUser = null;
  current = p;
  await syncPlaytime();
  return current;
}

/** Signed in already on this device? Returns the player, or null. */
export async function restore() {
  const { data } = await sb.auth.getSession();
  const user = data?.session?.user;
  if (!user) return null;
  try {
    const p = await loadPlayer(user);
    return p || { needsName: true };
  } catch (e) {
    console.warn(e);
    return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const cleanEmail = (v) => String(v || '').trim().toLowerCase();
function needsCode(email, message) {
  const e = new Error(message);
  e.needsCode = true;
  e.email = email;
  return e;
}

/** Email a login code. Makes the account the first time this email is used. */
export async function sendCode(emailIn) {
  const email = cleanEmail(emailIn);
  if (!EMAIL_RE.test(email)) throw new Error('Please type a real email address.');
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    if (/rate|seconds|security purposes/i.test(error.message)) throw new Error('Please wait a minute before asking for another code.');
    throw new Error(error.message);
  }
  return email;
}

/** Check the code from the email and sign in. Returns the player, or null if they need to pick a name. */
export async function verifyCode(email, code) {
  const token = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(token)) throw new Error('Type the number code from your email.');
  let res = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (res.error) res = await sb.auth.verifyOtp({ email, token, type: 'signup' });
  if (res.error || !res.data.user) throw new Error('That code didn\'t work. Check it, or tap "Send a new code".');
  return loadPlayer(res.data.user);
}

export async function signOut() {
  await flush();
  await pushPlaytime();
  await sb.auth.signOut().catch(() => {});
  userId = null;
  current = null;
}

// ---- saving ----------------------------------------------------------------
let pushTimer = null;
let pushChain = Promise.resolve();

function push() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(flush, 400);
}

function flush() {
  clearTimeout(pushTimer);
  if (!userId || !current) return pushChain;
  const row = toRow(current);
  const id = userId;
  pushChain = pushChain.then(async () => {
    const { error } = await sb.from('players').update(row).eq('id', id);
    if (error) console.warn('save failed', error.message);
  });
  return pushChain;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flush();
    pushPlaytime();
  }
});

function update(profile, fn) {
  const p = current || profile;
  fn(p);
  current = p;
  push();
  return { ...p };
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
    p.unlocked = [...p.unlocked, itemId];
  });
}

/** Save a match prize once per match id. Returns the updated profile, or null if already saved. */
export function applyAward(profile, a) {
  if ((current?.awarded || profile.awarded || []).includes(a.matchId)) return null;
  return update(profile, (p) => {
    p.awarded = [...(p.awarded || []), a.matchId].slice(-200);
    p.coins += Math.max(0, Math.floor(a.coins || 0));
    const s = (p.stats[a.game] = p.stats[a.game] || { plays: 0, wins: 0, bestTimeMs: null });
    s.plays++;
    if (a.won) s.wins++;
    if (Number.isFinite(a.timeMs) && (s.bestTimeMs == null || a.timeMs < s.bestTimeMs)) s.bestTimeMs = Math.round(a.timeMs);
  });
}

// ---- play time online ------------------------------------------------------
// playtime.js counts time on this device. We also keep each player's time for
// today online, so clearing the browser or switching devices doesn't reset it.
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function readLocalTime() {
  try {
    const v = JSON.parse(localStorage.getItem(PLAYTIME_KEY));
    if (v && v.date === today()) return v;
  } catch {
    /* ignore */
  }
  return { date: today(), ms: 0 };
}

let lastPushedMs = -1;
async function pushPlaytime() {
  if (!userId) return;
  const v = readLocalTime();
  if (v.ms === lastPushedMs) return;
  lastPushedMs = v.ms;
  const { error } = await sb.from('players').update({ playtime: v }).eq('id', userId);
  if (error) console.warn('play time save failed', error.message);
}

async function syncPlaytime() {
  const { data } = await sb.from('players').select('playtime').eq('id', userId).maybeSingle();
  const cloud = data?.playtime;
  const here = readLocalTime();
  if (cloud && cloud.date === today() && cloud.ms > here.ms) {
    try {
      localStorage.setItem(PLAYTIME_KEY, JSON.stringify({ date: today(), ms: cloud.ms }));
    } catch {
      /* ignore */
    }
  }
  await pushPlaytime();
}

setInterval(pushPlaytime, 60 * 1000);
