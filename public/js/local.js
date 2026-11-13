// Family accounts, saved online with Supabase (free plan).
// A parent logs in with THEIR email and a code we email to them. One parent
// account holds the children's players. Each child's coins, avatar, unlocked
// items, stats and today's play time follow them to any device.
//
// The key below is Supabase's *publishable* key: it is meant to be public.
// The database only lets a signed-in parent read and change their own family.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { DEFAULT_AVATAR, freeItemIds, sanitizeAvatar, ITEM_BY_ID } from '/shared/cosmetics.js';
import { readToday, writeToday, setPlaytimePlayer } from './playtime.js';

// ---- SETTINGS --------------------------------------------------------------
const SUPABASE_URL = 'https://qivxncxpbrjxspicgbls.supabase.co';
const SUPABASE_KEY = 'sb_publishable_poHAKWFmGFrkonSkv3-XCA_cmzfkdri';
// How long after typing a code the Parents area stays open without a new code.
const PARENT_OPEN_MS = 10 * 60 * 1000;
// ---------------------------------------------------------------------------

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fa_auth' },
});

const PICK_KEY = 'fa_player'; // which child last played on this device

let parent = null; // the signed-in parent (Supabase user)
let userId = null; // players.id of the child who is playing
let current = null;
let parentOkUntil = 0;

function fromRow(r) {
  return {
    id: r.game_id,
    rowId: r.id,
    username: r.username,
    coins: r.coins,
    avatar: { ...DEFAULT_AVATAR, ...(r.avatar || {}) },
    unlocked: Array.isArray(r.unlocked) && r.unlocked.length ? r.unlocked : freeItemIds(),
    stats: r.stats || {},
    awarded: r.awarded || [],
    playtime: r.playtime || null,
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

function newGameId() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return 1 + (a[0] % 2147483646);
}

function remember(id) {
  try {
    if (id) localStorage.setItem(PICK_KEY, id);
    else localStorage.removeItem(PICK_KEY);
  } catch {
    /* ignore */
  }
}
function remembered() {
  try {
    return localStorage.getItem(PICK_KEY);
  } catch {
    return null;
  }
}

/** Who's signed in: { email, kids }. */
export function family() {
  return parent ? { email: parent.email } : null;
}

/** The children's players on this parent account. */
export async function listKids() {
  if (!parent) throw new Error('Please log in again.');
  const { data, error } = await sb.from('players').select('*').eq('parent_id', parent.id).order('created_at');
  if (error) throw new Error(`Couldn't load your players: ${error.message}`);
  return data.map(fromRow);
}

/** Parents area: add a child player. */
export async function addKid(nameIn) {
  const username = String(nameIn || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('Use 3-16 letters, numbers or _ for the player name.');
  if (!parent) throw new Error('Please log in again.');
  const p = { id: newGameId(), username, coins: 0, avatar: { ...DEFAULT_AVATAR }, unlocked: freeItemIds(), stats: {}, awarded: [] };
  const { error } = await sb.from('players').insert({ parent_id: parent.id, username, game_id: p.id, ...toRow(p) });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('That player name is taken. Try another one.');
    throw new Error(`Couldn't add the player: ${error.message}`);
  }
}

/** Parents area: rename a child player. */
export async function renameKid(rowId, nameIn) {
  const username = String(nameIn || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('Use 3-16 letters, numbers or _ for the player name.');
  const { error } = await sb.from('players').update({ username }).eq('id', rowId);
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('That player name is taken. Try another one.');
    throw new Error(error.message);
  }
}

/** Parents area: delete a child player and all their coins and items. */
export async function removeKid(rowId) {
  const { error } = await sb.from('players').delete().eq('id', rowId);
  if (error) throw new Error(error.message);
  if (remembered() === rowId) remember(null);
}

/** Pick which child is playing on this device. */
export async function choosePlayer(rowId) {
  const { data, error } = await sb.from('players').select('*').eq('id', rowId).maybeSingle();
  if (error || !data) throw new Error("Couldn't load that player. Try again.");
  userId = data.id;
  current = fromRow(data);
  remember(userId);
  setPlaytimePlayer(userId);
  lastPushedMs = -1;
  await syncPlaytime(data.playtime);
  return current;
}

/** Back to "Who's playing?" (stays logged in). */
export async function switchPlayer() {
  await flush();
  await pushPlaytime();
  userId = null;
  current = null;
  remember(null);
  setPlaytimePlayer(null);
}

/**
 * Logged in already on this device?
 * Returns null (log in), { email, profile } (keep playing) or { email } (pick a player).
 */
export async function restore() {
  const { data } = await sb.auth.getSession();
  const user = data?.session?.user;
  if (!user) return null;
  parent = user;
  const last = remembered();
  if (last) {
    try {
      return { email: user.email, profile: await choosePlayer(last) };
    } catch {
      remember(null);
    }
  }
  return { email: user.email };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const cleanEmail = (v) => String(v || '').trim().toLowerCase();

/** Email a login code to the parent. Makes the family account the first time. */
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

/** Check the code from the parent's email and log in. Returns { email }. */
export async function verifyCode(email, code) {
  const token = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(token)) throw new Error('Type the number code from the email.');
  let res = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (res.error) res = await sb.auth.verifyOtp({ email, token, type: 'signup' });
  if (res.error || !res.data.user) throw new Error('That code didn\'t work. Check it, or tap "Send a new code".');
  parent = res.data.user;
  parentOkUntil = Date.now() + PARENT_OPEN_MS;
  return { email: parent.email };
}

/** Is the Parents area open, or does it need a fresh code from the parent's email? */
export function parentAreaOpen() {
  return !!parent && Date.now() < parentOkUntil;
}

/** Send a code to the parent's email to open the Parents area. */
export async function sendParentCode() {
  if (!parent) throw new Error('Please log in again.');
  return sendCode(parent.email);
}

/** Open the Parents area with the code from the parent's email. */
export async function unlockParentArea(code) {
  if (!parent) throw new Error('Please log in again.');
  await verifyCode(parent.email, code);
}

export async function signOut() {
  await flush();
  await pushPlaytime();
  await sb.auth.signOut().catch(() => {});
  remember(null);
  setPlaytimePlayer(null);
  parent = null;
  userId = null;
  current = null;
  parentOkUntil = 0;
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
// playtime.js counts each player's time on this device. We also keep it online,
// so clearing the browser or switching devices doesn't reset it.
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

let lastPushedMs = -1;
async function pushPlaytime() {
  if (!userId) return;
  const v = readToday();
  if (v.ms === lastPushedMs) return;
  lastPushedMs = v.ms;
  const { error } = await sb.from('players').update({ playtime: v }).eq('id', userId);
  if (error) console.warn('play time save failed', error.message);
}

async function syncPlaytime(cloud) {
  const here = readToday();
  if (cloud && cloud.date === today() && cloud.ms > here.ms) writeToday(cloud.ms);
  await pushPlaytime();
}

/** Minutes a player has used today, from their saved row (for the Parents area). */
export function minutesToday(p) {
  const v = p.playtime;
  return v && v.date === today() ? Math.round(v.ms / 60000) : 0;
}

setInterval(pushPlaytime, 60 * 1000);
