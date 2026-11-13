// Friend Arcade browser app: screens, lobby, games, results and the call dock.
import { HostServer, LocalSocket, PeerSocket } from './net.js';
import { makeCode } from './host.js';
import * as local from './local.js';
import { drawAvatar, avatarCanvas } from './avatar.js';
import { Input, buildTouchControls } from './input.js';
import { Call } from './call.js';
import { el } from './games/common.js';
import { CATEGORIES, ITEMS, ITEM_BY_ID } from '/shared/cosmetics.js';
import { TowerView, TOWER_HELP } from './games/tower.js';
import { CircuitView, CIRCUIT_HELP } from './games/circuit.js';
import { SabotageView, SABOTAGE_HELP } from './games/sabotage.js';
import { startPlaytime } from './playtime.js';

const $ = (id) => document.getElementById(id);

const GAME_INFO = {
  sabotage: { emoji: '🚀', title: 'Spaceship Sabotage', players: '3-10 players (best with 4+)', blurb: 'Crew do tasks; a secret saboteur zaps and sabotages. Meet, talk, vote!', View: SabotageView, help: SABOTAGE_HELP },
  tower: { emoji: '🗼', title: 'Tower Rush', players: '1-10 players', blurb: 'Race up a timed obstacle tower full of moving platforms, saws and spikes.', View: TowerView, help: TOWER_HELP },
  circuit: { emoji: '🏎️', title: 'Circuit Sprint', players: '1-10 players, solo or teams', blurb: '3 laps, 10 checkpoints, one clock. Race solo or Red vs Blue.', View: CircuitView, help: CIRCUIT_HELP },
};

const state = {
  profile: null,
  socket: null,
  host: null, // HostServer when this tab runs the room
  roomCode: null,
  room: null,
  view: null,
  game: null, // { type, matchId, renderer }
  results: null,
  call: null,
  input: null,
  pendingRoom: new URLSearchParams(location.search).get('room'),
  editor: { avatar: null, cat: 'color' },
};

// ---------------------------------------------------------------- utilities
function toast(text, kind = 'info', ms = 3500) {
  const t = el('div', { class: `toast ${kind}` }, text);
  $('toasts').append(t);
  setTimeout(() => t.remove(), ms);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

function show(screen) {
  state.view = screen;
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== `screen-${screen}`);
  $('topbar').classList.toggle('hidden', screen === 'auth' || screen === 'game');
  document.body.classList.toggle('in-game', screen === 'game');
  if (state.input) {
    state.input.enabled = screen === 'game';
    if (screen !== 'game') state.input.releaseAll();
  }
}

function send(msg) {
  state.socket?.send(msg);
}

function setUrlRoom(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

// ---------------------------------------------------------------- auth
// Family logins:
//   1. Type a PARENT's email. A code is emailed to the parent.
//   2. Type the code (a grown-up reads it out).
//   3. "Who's playing?" - pick a child player.
// The Parents area adds, renames and removes child players. Opening it later
// needs a fresh code from the parent's email, so kids can't change it.
let authMode = 'email'; // 'email' | 'code' | 'pick' | 'parent' | 'parentcode'
let pendingEmail = '';
let familyEmail = '';
document.querySelector('#screen-auth .tabs')?.classList.add('hidden');
const authForm = $('auth-form');
authForm.username.closest('label').remove();
authForm.password.closest('label').remove();

const info = el('p', { class: 'muted', id: 'code-info', style: 'margin:0 0 8px' });
const emailLabel = el('label', {});
emailLabel.innerHTML = "Parent's email <input name=\"email\" type=\"email\" inputmode=\"email\" autocomplete=\"email\" maxlength=\"120\" />";
const codeBox = el('div', {});
codeBox.innerHTML =
  '<label>Code from the parent\'s email <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" /></label>' +
  '<div style="display:flex;gap:8px;margin:6px 0 10px;justify-content:center;flex-wrap:wrap"><button type="button" class="ghost small" id="code-resend">Send a new code</button>' +
  '<button type="button" class="ghost small" id="code-back">Back</button></div>';
const pickBox = el('div', { class: 'family-pick' });
const parentBox = el('div', { class: 'family-parent' });
const note = el('p', { class: 'muted', style: 'margin-top:10px;font-size:.9em' });
authForm.prepend(info, emailLabel, codeBox);
authForm.insertBefore(pickBox, $('auth-submit'));
authForm.insertBefore(parentBox, $('auth-submit'));
authForm.append(note);

function setAuthView() {
  const m = authMode;
  emailLabel.style.display = m === 'email' ? '' : 'none';
  codeBox.style.display = m === 'code' || m === 'parentcode' ? '' : 'none';
  pickBox.style.display = m === 'pick' ? '' : 'none';
  parentBox.style.display = m === 'parent' ? '' : 'none';
  $('auth-submit').style.display = m === 'pick' || m === 'parent' ? 'none' : '';
  authForm.email.required = m === 'email';
  authForm.code.required = m === 'code' || m === 'parentcode';
  $('code-back').textContent = m === 'parentcode' ? 'Back' : 'Use a different email';
  info.textContent =
    m === 'email' ? "Ask a grown-up to type their email. We'll send them a code to let you in."
    : m === 'code' ? `We sent a code to ${pendingEmail}. Ask a grown-up to check that inbox (and spam), then type the code below.`
    : m === 'parentcode' ? `Grown-ups only: we sent a code to ${familyEmail}. Type it to open the Parents area.`
    : m === 'pick' ? "Who's playing?"
    : '';
  $('auth-submit').textContent = m === 'email' ? 'Send code to parent' : m === 'parentcode' ? 'Open Parents area' : 'Log in';
  note.textContent = m === 'email' || m === 'code' ? 'Coins, avatar and play time are saved online for each child. Log in on any phone or tablet.' : '';
}

function goTo(mode) {
  authMode = mode;
  $('auth-error').textContent = '';
  setAuthView();
  show('auth');
  const f = { email: authForm.email, code: authForm.code, parentcode: authForm.code }[mode];
  if (f) setTimeout(() => f.focus(), 50);
}

const authError = (err) => ($('auth-error').textContent = err.message || String(err));

$('code-back').addEventListener('click', () => (authMode === 'parentcode' ? openPick() : goTo('email')));
$('code-resend').addEventListener('click', async () => {
  $('auth-error').textContent = '';
  try {
    if (authMode === 'parentcode') await local.sendParentCode();
    else await local.sendCode(pendingEmail);
    info.textContent = `New code sent to ${authMode === 'parentcode' ? familyEmail : pendingEmail}. Check the inbox (and spam).`;
  } catch (err) {
    authError(err);
  }
});

// ---- Who's playing?
async function openPick() {
  goTo('pick');
  pickBox.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
  let kids = [];
  try {
    kids = await local.listKids();
  } catch (err) {
    authError(err);
  }
  const list = el('div', { class: 'kid-list' });
  for (const k of kids) {
    const b = el('button', { type: 'button', class: 'kid-btn' }, avatarCanvas(k.avatar, 56), el('span', {}, k.username));
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        signedIn(await local.choosePlayer(k.rowId));
      } catch (err) {
        authError(err);
        b.disabled = false;
      }
    });
    list.append(b);
  }
  const parentsBtn = el('button', { type: 'button', class: 'secondary' }, '👪 Parents area');
  parentsBtn.addEventListener('click', openParentArea);
  const out = el('button', { type: 'button', class: 'ghost small' }, 'Log out');
  out.addEventListener('click', logOut);
  pickBox.replaceChildren(
    kids.length ? list : el('p', {}, 'No players yet. A grown-up needs to add one in the Parents area.'),
    el('div', { style: 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px' }, parentsBtn, out),
    el('p', { class: 'muted', style: 'font-size:.85em;margin-top:8px' }, `Family: ${familyEmail}`),
  );
}

// ---- Parents area
async function openParentArea() {
  $('auth-error').textContent = '';
  if (!local.parentAreaOpen()) {
    try {
      await local.sendParentCode();
      authForm.code.value = '';
      goTo('parentcode');
    } catch (err) {
      authError(err);
    }
    return;
  }
  goTo('parent');
  parentBox.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
  let kids = [];
  try {
    kids = await local.listKids();
  } catch (err) {
    authError(err);
  }
  const rows = kids.map((k) => {
    const rename = el('button', { type: 'button', class: 'ghost small' }, 'Rename');
    const remove = el('button', { type: 'button', class: 'ghost small danger-text' }, 'Remove');
    rename.addEventListener('click', async () => {
      const name = prompt(`New player name for ${k.username}:`, k.username);
      if (!name || name.trim() === k.username) return;
      try {
        await local.renameKid(k.rowId, name);
        openParentArea();
      } catch (err) {
        authError(err);
      }
    });
    remove.addEventListener('click', async () => {
      if (!confirm(`Remove ${k.username}? Their coins, items and stats will be deleted for good.`)) return;
      try {
        await local.removeKid(k.rowId);
        openParentArea();
      } catch (err) {
        authError(err);
      }
    });
    return el(
      'div',
      { class: 'kid-row' },
      avatarCanvas(k.avatar, 40),
      el('div', { class: 'kid-info' }, el('b', {}, k.username), el('span', { class: 'muted' }, `● ${k.coins} coins · ${local.minutesToday(k)} min played today`)),
      el('div', { class: 'kid-actions' }, rename, remove),
    );
  });
  const addForm = el('div', { class: 'row', style: 'margin-top:10px' });
  const nameIn = el('input', { placeholder: 'New player name', maxlength: '16', autocomplete: 'off' });
  const addBtn = el('button', { type: 'button', class: 'primary' }, 'Add child');
  const add = async () => {
    $('auth-error').textContent = '';
    addBtn.disabled = true;
    try {
      await local.addKid(nameIn.value);
      openParentArea();
    } catch (err) {
      authError(err);
      addBtn.disabled = false;
    }
  };
  addBtn.addEventListener('click', add);
  nameIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });
  addForm.append(nameIn, addBtn);
  const done = el('button', { type: 'button', class: 'secondary', style: 'margin-top:14px' }, "Done - who's playing?");
  done.addEventListener('click', openPick);
  parentBox.replaceChildren(
    el('h2', { style: 'margin:0 0 4px' }, '👪 Parents area'),
    el('p', { class: 'muted', style: 'margin:0 0 10px;font-size:.9em' }, `Codes to log in are sent to ${familyEmail}.`),
    kids.length ? el('div', { class: 'kid-rows' }, ...rows) : el('p', {}, 'Add a player for each child.'),
    addForm,
    el('p', { class: 'hint' }, '3-16 letters, numbers or _. Each child gets their own coins, avatar and daily play time.'),
    done,
  );
  setTimeout(() => nameIn.focus(), 50);
}

async function logOut() {
  closeRoom();
  await local.signOut();
  location.href = location.pathname;
}

setAuthView();

function signedIn(profile) {
  authForm.reset();
  startSession(profile);
  enterPendingRoom();
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('auth-error').textContent = '';
  const btn = $('auth-submit');
  btn.disabled = true;
  btn.textContent = 'Please wait…';
  try {
    if (authMode === 'email') {
      pendingEmail = await local.sendCode(authForm.email.value);
      authForm.code.value = '';
      goTo('code');
    } else if (authMode === 'code') {
      familyEmail = (await local.verifyCode(pendingEmail, authForm.code.value)).email;
      const kids = await local.listKids().catch(() => []);
      if (kids.length) openPick();
      else openParentArea();
    } else if (authMode === 'parentcode') {
      await local.unlockParentArea(authForm.code.value);
      openParentArea();
    }
  } catch (err) {
    authError(err);
  } finally {
    btn.disabled = false;
    setAuthView();
  }
});

// Top bar: switch to another child, or log the family out.
$('btn-signout').textContent = 'Switch player';
$('btn-signout').addEventListener('click', async () => {
  closeRoom();
  await local.switchPlayer();
  setUrlRoom(null);
  location.href = location.pathname;
});

function startSession(profile) {
  state.profile = profile;
  renderProfile();
  state.input = new Input(send);
  state.call = new Call({ send, myId: profile.id, userName: profile.username, onChange: renderCall, onError: (m) => toast(m, 'bad', 6000) });
  show('home');
}

// ---------------------------------------------------------------- connecting to a room
const publicProfile = () => ({ id: state.profile.id, username: state.profile.username, avatar: state.profile.avatar });

function socketHandlers() {
  return {
    authProfile: publicProfile,
    onMessage,
    onOpen: () => $('conn').classList.add('hidden'),
    onClose: () => $('conn').classList.remove('hidden'),
    onGone: (reason) => {
      $('conn').classList.add('hidden');
      toast(reason, 'bad', 7000);
      state.socket = null;
      closeRoom();
      onRoom(null);
    },
  };
}

function joinRoom(code) {
  closeRoom();
  state.roomCode = code;
  $('conn').textContent = 'Connecting…';
  $('conn').classList.remove('hidden');
  state.socket = new PeerSocket(code, socketHandlers());
}

async function hostRoom(code) {
  closeRoom();
  $('conn').textContent = 'Opening your room…';
  $('conn').classList.remove('hidden');
  const fixed = !!code;
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    const tryCode = code || makeCode();
    const host = new HostServer();
    try {
      await host.start(tryCode, state.profile.id);
      state.host = host;
      state.roomCode = tryCode;
      try {
        sessionStorage.setItem('fa_host', tryCode);
      } catch {
        /* ignore */
      }
      state.socket = new LocalSocket(host, socketHandlers());
      $('conn').classList.add('hidden');
      $('conn').textContent = 'Reconnecting…';
      return;
    } catch (err) {
      const taken = err && err.type === 'unavailable-id';
      // After a refresh the old room name can stay reserved for a little while.
      if (taken && fixed && Date.now() - started < 60000) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (taken && !fixed && attempt < 5) continue;
      $('conn').classList.add('hidden');
      toast(
        taken ? 'That room is still open somewhere else. Create a new room instead.' : `Couldn't open a room: ${err?.message || err?.type || err}. Check your internet and try again.`,
        'bad',
        7000,
      );
      try {
        sessionStorage.removeItem('fa_host');
      } catch {
        /* ignore */
      }
      setUrlRoom(null);
      return;
    }
  }
}

function closeRoom() {
  state.socket?.close();
  state.socket = null;
  state.host?.stop(true);
  state.host = null;
  state.roomCode = null;
  try {
    sessionStorage.removeItem('fa_host');
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- socket messages
function onMessage(msg) {
  switch (msg.t) {
    case 'hello':
      if (state.roomCode) send({ t: 'room:join', code: state.roomCode });
      state.call.rejoinAfterReconnect();
      break;
    case 'auth:fail':
      toast('Could not join with that player name.', 'bad');
      closeRoom();
      break;
    case 'replaced':
      toast('You opened Friend Arcade in another tab or device. This tab is now disconnected.', 'warn', 8000);
      $('conn').textContent = 'Disconnected (open in another tab). Refresh to use this tab.';
      $('conn').classList.remove('hidden');
      break;
    case 'award': {
      const p = local.applyAward(state.profile, msg);
      if (p) {
        state.profile = p;
        renderProfile();
      }
      break;
    }
    case 'room':
      onRoom(msg.room);
      break;
    case 'game:start':
      startGame(msg);
      break;
    case 'game:state':
      if (state.game && state.game.matchId === msg.matchId) state.game.renderer.onState(msg.s);
      break;
    case 'game:event':
      if (state.game && state.game.matchId === msg.matchId) state.game.renderer.onEvent(msg.ev);
      break;
    case 'game:end':
      endGame(msg.results);
      break;
    case 'toast':
      toast(msg.text, 'warn');
      break;
    case 'error':
      toast(msg.text, 'bad');
      break;
    case 'call:peers':
    case 'call:joined':
    case 'call:left':
    case 'call:signal':
      state.call.handle(msg);
      break;
  }
}

// ---------------------------------------------------------------- profile & home
function renderProfile() {
  const p = state.profile;
  if (!p) return;
  $('me-name').textContent = p.username;
  $('me-coins').textContent = p.coins;
  $('me-avatar').replaceChildren(avatarCanvas(p.avatar, 34));
  $('home-avatar').replaceChildren(avatarCanvas(p.avatar, 140));
  const names = { sabotage: 'Spaceship Sabotage', tower: 'Tower Rush', circuit: 'Circuit Sprint' };
  $('stats').replaceChildren(
    el(
      'div',
      { class: 'stat-grid' },
      el('div', { class: 'stat' }, el('b', {}, '● Coins'), `${p.coins}`),
      ...Object.entries(names).map(([id, name]) => {
        const s = p.stats[id] || { plays: 0, wins: 0, bestTimeMs: null };
        return el(
          'div',
          { class: 'stat' },
          el('b', {}, name),
          `Wins ${s.wins} / ${s.plays} played`,
          id !== 'sabotage' ? el('div', {}, `Best time: ${s.bestTimeMs ? (s.bestTimeMs / 1000).toFixed(2) + 's' : '-'}`) : null,
        );
      }),
    ),
  );
  if (state.room) renderLobby();
}

$('btn-create').addEventListener('click', () => hostRoom());
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length === 5) joinRoom(code);
  else toast('Room codes have 5 letters/numbers.', 'warn');
});

// ---------------------------------------------------------------- avatar editor
$('btn-avatar').addEventListener('click', () => {
  state.editor.avatar = { ...state.profile.avatar };
  renderEditor();
  show('avatar');
});
$('btn-avatar-back').addEventListener('click', () => show(state.room ? 'lobby' : 'home'));
$('btn-avatar-save').addEventListener('click', async () => {
  try {
    state.profile = local.setAvatar(state.profile, state.editor.avatar);
    send({ t: 'profile:update', profile: publicProfile() });
    renderProfile();
    toast('Looking good! Saved.', 'good');
    show(state.room ? 'lobby' : 'home');
  } catch (e) {
    toast(e.message, 'bad');
  }
});

function renderEditor() {
  const ed = state.editor;
  const owned = new Set(state.profile.unlocked);
  const c = $('editor-canvas');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  drawAvatar(ctx, ed.avatar, 130, 140, 170);
  $('cat-tabs').replaceChildren(
    ...CATEGORIES.map((cat) =>
      el('button', { class: `tab${cat.id === ed.cat ? ' active' : ''}`, onclick: () => ((ed.cat = cat.id), renderEditor()) }, cat.label),
    ),
  );
  $('item-grid').replaceChildren(
    ...ITEMS.filter((i) => i.cat === ed.cat).map((item) => {
      const has = owned.has(item.id);
      const preview = { ...ed.avatar, [item.cat]: item.id };
      const equipped = ed.avatar[item.cat] === item.id;
      return el(
        'button',
        {
          class: `item${equipped ? ' equipped' : ''}${has ? '' : ' locked'}`,
          onclick: async () => {
            if (!has) {
              if (state.profile.coins < item.price) {
                toast(`You need ${item.price - state.profile.coins} more coins. Play a match to earn some!`, 'warn');
                return;
              }
              if (!confirm(`Unlock ${item.name} for ${item.price} coins?`)) return;
              try {
                state.profile = local.buyItem(state.profile, item.id);
                renderProfile();
                toast(`Unlocked ${item.name}!`, 'good');
              } catch (e) {
                toast(e.message, 'bad');
                return;
              }
            }
            ed.avatar[item.cat] = item.id;
            renderEditor();
          },
        },
        avatarCanvas(preview, 70),
        el('span', {}, item.name),
        has ? el('span', { class: 'owned' }, equipped ? 'Wearing' : 'Owned') : el('span', { class: 'price' }, `● ${item.price}`),
      );
    }),
  );
}

// ---------------------------------------------------------------- lobby
function onRoom(room) {
  const wasIn = !!state.room;
  state.room = room;
  if (!room) {
    closeRoom();
    setUrlRoom(null);
    sessionStorage.removeItem('fa_leftCall');
    state.call.leave();
    $('call').classList.add('hidden');
    if (state.game) stopGame();
    show('home');
    return;
  }
  setUrlRoom(room.code);
  $('call').classList.remove('hidden');
  if (!wasIn) {
    toast(`You're in room ${room.code}`, 'good');
    // Always-on video call: join the Daily call as soon as you enter a room,
    // unless you pressed "Leave call" in this room earlier.
    if (sessionStorage.getItem('fa_leftCall') !== room.code) joinCallWithMedia();
  }
  if (room.phase === 'lobby' && (state.view === 'results' || state.view === 'game' || state.view === 'home' || !wasIn)) {
    if (state.game) stopGame();
    show('lobby');
  }
  if (room.phase === 'results' && state.view === 'home') show('results');
  renderLobby();
  renderCall();
}

function renderLobby() {
  const room = state.room;
  if (!room) return;
  const me = state.profile.id;
  const isHost = room.hostId === me;
  const meM = room.members.find((m) => m.userId === me);
  $('room-code').textContent = room.code;
  $('player-count').textContent = `(${room.members.length}/10)`;
  $('host-note').textContent = isHost ? '- you are the host, pick a game' : '- the host picks the game';

  $('member-list').replaceChildren(
    ...room.members.map((m) =>
      el(
        'div',
        { class: `member${m.ready ? ' ready' : ''}${m.connected ? '' : ' offline'}` },
        avatarCanvas(m.avatar, 84),
        el('div', { class: 'mname' }, m.username + (m.userId === me ? ' (you)' : '')),
        el(
          'div',
          { class: 'badges' },
          m.userId === room.hostId ? el('span', { class: 'badge host' }, 'Host') : null,
          m.ready ? el('span', { class: 'badge ready' }, 'Ready') : el('span', { class: 'badge' }, m.connected ? 'Not ready' : 'Offline'),
          m.team ? el('span', { class: `badge ${m.team}` }, m.team === 'red' ? 'Red' : 'Blue') : null,
          m.inCall ? el('span', { class: 'badge' }, `${m.mic ? '🎤' : '🔇'}${m.cam ? '📷' : ''}`) : null,
        ),
      ),
    ),
  );

  $('game-picker').replaceChildren(
    ...Object.entries(GAME_INFO).map(([id, g]) =>
      el(
        'button',
        {
          class: `game-card${room.selected.game === id ? ' selected' : ''}`,
          disabled: !isHost && room.selected.game !== id ? 'disabled' : null,
          onclick: () => isHost && send({ t: 'room:select', game: id, options: { teams: id === 'circuit' && room.selected.options.teams } }),
        },
        el('span', { class: 'emoji' }, g.emoji),
        el('span', { class: 'gt' }, g.title),
        el('span', { class: 'gp' }, g.players),
        el('span', {}, g.blurb),
      ),
    ),
  );

  const teams = room.selected.game === 'circuit';
  $('team-panel').classList.toggle('hidden', !teams);
  if (teams) {
    const toggle = el('input', {
      type: 'checkbox',
      ...(room.selected.options.teams ? { checked: 'checked' } : {}),
      ...(isHost ? {} : { disabled: 'disabled' }),
      onchange: (e) => send({ t: 'room:select', game: 'circuit', options: { teams: e.target.checked } }),
    });
    const children = [el('label', { class: 'toggle' }, toggle, 'Team race (Red vs Blue)')];
    if (room.selected.options.teams) {
      children.push(
        el('button', { class: 'small danger', onclick: () => send({ t: 'room:team', team: 'red' }) }, 'Join Red'),
        el('button', { class: 'small', style: 'background:#4361ee;color:#fff', onclick: () => send({ t: 'room:team', team: 'blue' }) }, 'Join Blue'),
      );
    }
    $('team-panel').replaceChildren(...children);
  }

  const ready = !!meM?.ready;
  $('btn-ready').textContent = ready ? 'Not ready' : "I'm ready!";
  $('btn-ready').className = `${ready ? 'ghost' : 'primary'} big`;
  $('btn-ready').disabled = room.phase !== 'lobby';
  const connected = room.members.filter((m) => m.connected);
  const allReady = connected.every((m) => m.ready);
  $('btn-start').classList.toggle('hidden', !isHost);
  $('btn-start').disabled = !allReady || room.phase !== 'lobby';
  const waiting = connected.filter((m) => !m.ready).map((m) => m.username);
  $('lobby-status').textContent =
    room.phase === 'playing'
      ? 'A match is in progress - you will join the next one.'
      : room.phase === 'results'
        ? 'Match finished - waiting for the host to return to the lobby.'
        : waiting.length
          ? `Waiting for: ${waiting.join(', ')}`
          : isHost
            ? 'Everyone is ready - press Start!'
            : 'Everyone is ready - waiting for the host to start.';
}

$('btn-ready').addEventListener('click', () => {
  const me = state.room?.members.find((m) => m.userId === state.profile.id);
  send({ t: 'room:ready', ready: !me?.ready });
});
$('btn-start').addEventListener('click', () => send({ t: 'room:start' }));
$('btn-leave-room').addEventListener('click', () => {
  if (state.host) {
    if (state.room && state.room.members.length > 1 && !confirm('You are hosting this room. If you leave, the room closes for everyone. Leave?')) return;
    onRoom(null);
    return;
  }
  send({ t: 'room:leave' });
  setTimeout(() => state.room && onRoom(null), 1500);
});
$('btn-copy-link').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?room=${state.room.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied! Send it to your friends.', 'good');
  } catch {
    prompt('Copy this invite link:', link);
  }
});

// ---------------------------------------------------------------- game
let raf = 0;

function startGame(msg) {
  if (state.game && state.game.matchId === msg.matchId) return; // already running (reconnect)
  if (state.game) stopGame();
  const info = GAME_INFO[msg.game];
  const roster = new Map(msg.init.roster.map((r) => [r.id, r]));
  const hud = $('hud');
  hud.replaceChildren();
  const renderer = new info.View({ me: state.profile.id, init: msg.init, roster, hud, toast, send, input: state.input });
  state.game = { type: msg.game, matchId: msg.matchId, renderer };
  state.results = null;
  show('game');
  // Sabotage opens with a secret role screen, so show its help after that.
  clearTimeout(startGame.helpTimer);
  startGame.helpTimer = setTimeout(
    () => state.game && state.game.matchId === msg.matchId && showHelp(info.help, true),
    msg.game === 'sabotage' ? 4200 : 0,
  );
  const touch = $('touch');
  const isTouch = matchMedia('(pointer: coarse)').matches;
  touch.classList.toggle('hidden', !isTouch);
  if (isTouch) buildTouchControls(touch, state.input, renderer.touchButtons());
  cancelAnimationFrame(raf);
  const canvas = $('game-canvas');
  const ctx = canvas.getContext('2d');
  const frame = () => {
    if (!state.game) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try {
      state.game.renderer.draw(ctx, w, h);
    } catch (e) {
      console.error(e);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

function stopGame() {
  cancelAnimationFrame(raf);
  state.game?.renderer.destroy();
  state.game = null;
  $('hud').replaceChildren();
  $('help').classList.add('hidden');
}

function showHelp(help, autoHide) {
  const h = $('help');
  h.replaceChildren(
    el(
      'div',
      { class: 'card' },
      el('h2', {}, `How to play: ${help.title}`),
      el('p', {}, help.goal),
      el('table', {}, ...help.keys.map(([k, v]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, v)))),
      el('ul', {}, ...help.tips.map((t) => el('li', {}, t))),
      el('button', { class: 'primary', onclick: () => h.classList.add('hidden') }, 'Got it!'),
    ),
  );
  h.classList.remove('hidden');
  if (autoHide) {
    clearTimeout(showHelp.t);
    showHelp.t = setTimeout(() => h.classList.add('hidden'), 9000);
  }
}

$('btn-help').addEventListener('click', () => {
  if (!state.game) return;
  const h = $('help');
  if (h.classList.contains('hidden')) showHelp(GAME_INFO[state.game.type].help);
  else h.classList.add('hidden');
});
window.addEventListener('keydown', (e) => {
  if (state.view === 'game' && e.code === 'KeyH' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) $('btn-help').click();
});

function endGame(results) {
  stopGame();
  state.results = results;
  const me = state.profile.id;
  const awards = new Map(results.awards.map((a) => [a.userId, a.coins]));
  $('results-game').textContent = results.title;
  $('results-headline').textContent = results.headline;
  $('results-teams').replaceChildren(
    ...(results.teams || []).map((t) =>
      el('div', { class: `team-score ${t.team}${t.won ? ' won' : ''}` }, `${t.team === 'red' ? 'Red' : 'Blue'} team: ${t.score} pts${t.won ? ' 🏆' : ''}`),
    ),
  );
  $('results-list').replaceChildren(
    ...results.placements.map((p) =>
      el(
        'li',
        { class: p.won ? 'won' : '' },
        el('span', { class: 'pos' }, p.won && p.rank === 1 ? '🏆' : results.game === 'sabotage' ? (p.won ? '🏆' : '·') : p.rank),
        avatarCanvas(p.avatar, 52),
        el('span', { class: 'who' }, el('b', {}, p.name + (p.userId === me ? ' (you)' : '')), el('span', { class: 'muted' }, p.label)),
        el('span', { class: 'earned' }, awards.has(p.userId) ? `+${awards.get(p.userId)} ●` : ''),
      ),
    ),
  );
  const mine = awards.get(me);
  $('results-note').textContent = mine !== undefined ? `You earned ${mine} coins. Spend them in the avatar shop!` : '';
  updateResultsButton();
  show('results');
  if (mine && sessionStorage.getItem('fa_lastPrize') !== results.matchId) {
    sessionStorage.setItem('fa_lastPrize', results.matchId);
    toast(`+${mine} coins!`, 'good');
  }
}

function updateResultsButton() {
  const isHost = state.room && state.room.hostId === state.profile.id;
  $('btn-to-lobby').disabled = !isHost;
  $('btn-to-lobby').textContent = isHost ? 'Back to lobby (everyone)' : 'Waiting for the host…';
}
$('btn-to-lobby').addEventListener('click', () => send({ t: 'room:toLobby' }));

// ---------------------------------------------------------------- call dock
const tiles = new Map(); // userId -> {el, video, audio}

function renderCall() {
  const call = state.call;
  if (!call || !state.room) return;
  if (state.view === 'results') updateResultsButton();
  const inCall = call.inCall;
  $('btn-call-join').classList.toggle('hidden', inCall);
  for (const id of ['btn-mic', 'btn-cam', 'btn-deafen', 'btn-call-leave']) $(id).classList.toggle('hidden', !inCall);
  $('btn-mic').textContent = call.mic ? '🎤 Mic on' : '🎤 Mic off';
  $('btn-mic').classList.toggle('on', !!call.mic);
  $('btn-cam').textContent = call.cam ? '📷 Cam on' : '📷 Cam off';
  $('btn-cam').classList.toggle('on', !!call.cam);
  $('btn-deafen').textContent = call.deafened ? '🔇 Others muted' : '🔊 Sound on';

  const wanted = new Set();
  if (inCall) {
    for (const m of state.room.members) {
      if (!m.inCall && m.userId !== state.profile.id) continue;
      wanted.add(m.userId);
      let t = tiles.get(m.userId);
      if (!t) {
        const video = el('video', { autoplay: '', playsinline: '' });
        video.muted = true; // audio plays through a separate element
        const audio = el('audio', { autoplay: '' });
        const node = el('div', { class: 'tile' });
        t = { el: node, video, audio, avatar: null, name: el('span', { class: 'tname' }), icons: el('span', { class: 'ticons' }), st: el('span', { class: 'tstate hidden' }) };
        node.append(video, audio, t.name, t.icons, t.st);
        tiles.set(m.userId, t);
        $('call-tiles').append(node);
      }
      const isMe = m.userId === state.profile.id;
      t.name.textContent = isMe ? 'You' : m.username;
      const camOn = isMe ? !!call.cam : m.cam;
      const micOn = isMe ? !!call.mic : m.mic;
      t.icons.textContent = `${micOn ? '🎤' : '🔇'}`;
      let stream = null;
      if (isMe) {
        if (call.cam) {
          if (!t.localStream || t.localStream.getVideoTracks()[0] !== call.cam) t.localStream = new MediaStream([call.cam]);
          stream = t.localStream;
        }
      } else {
        stream = call.streamFor(m.userId);
        if (stream && t.audio.srcObject !== stream) {
          t.audio.srcObject = stream;
          t.audio.play().catch(() => {});
        }
        t.audio.muted = call.deafened;
        const st = call.peers.get(m.userId)?.state;
        t.st.classList.toggle('hidden', !(st === 'failed' || st === 'disconnected'));
        t.st.textContent = st === 'failed' ? 'no connection' : 'reconnecting';
      }
      if (camOn && stream) {
        if (t.video.srcObject !== stream) {
          t.video.srcObject = stream;
          t.video.play().catch(() => {});
        }
        t.video.classList.remove('hidden');
        t.avatar?.remove();
        t.avatar = null;
      } else {
        t.video.classList.add('hidden');
        const key = JSON.stringify(m.avatar);
        if (!t.avatar || t.avatarKey !== key) {
          t.avatar?.remove();
          t.avatar = avatarCanvas(m.avatar, 70);
          t.avatarKey = key;
          t.el.prepend(t.avatar);
        }
      }
    }
  }
  for (const [id, t] of tiles) {
    if (!wanted.has(id)) {
      t.el.remove();
      tiles.delete(id);
    }
  }
}

// Always-on call: join and switch on the mic and camera straight away.
async function joinCallWithMedia() {
  await state.call.join();
  try {
    if (!state.call.mic) await state.call.toggleMic();
  } catch (e) {
    toast(e.message, 'bad', 6000);
  }
  try {
    if (!state.call.cam) await state.call.toggleCam();
  } catch (e) {
    toast(e.message, 'bad', 6000);
  }
}

$('btn-call-join').addEventListener('click', () => {
  sessionStorage.removeItem('fa_leftCall');
  joinCallWithMedia();
});
$('btn-call-leave').addEventListener('click', () => {
  sessionStorage.setItem('fa_leftCall', state.room.code);
  state.call.leave();
});
$('btn-mic').addEventListener('click', () => state.call.toggleMic().catch((e) => toast(e.message, 'bad', 6000)));
$('btn-cam').addEventListener('click', () => state.call.toggleCam().catch((e) => toast(e.message, 'bad', 6000)));
$('btn-deafen').addEventListener('click', () => state.call.toggleDeafen());
$('btn-call-min').addEventListener('click', () => {
  $('call').classList.toggle('min');
  $('btn-call-min').textContent = $('call').classList.contains('min') ? '▴' : '▾';
});

// ---------------------------------------------------------------- boot
function enterPendingRoom() {
  const code = state.pendingRoom && state.pendingRoom.toUpperCase();
  state.pendingRoom = null;
  if (!code) return;
  let hosted = null;
  try {
    hosted = sessionStorage.getItem('fa_host');
  } catch {
    /* ignore */
  }
  // Refreshed the page while hosting? Re-open the same room so friends reconnect.
  if (hosted === code) hostRoom(code);
  else joinRoom(code);
}

// The host's tab runs the room, so warn before closing it.
window.addEventListener('beforeunload', (e) => {
  if (state.host && state.room && state.room.members.length > 1) {
    e.preventDefault();
    e.returnValue = '';
  }
});

(function boot() {
  startPlaytime({
    toast,
    onBlock: () => {
      // Time's up: leave the call, stop the game and close the room.
      try {
        state.call?.leave();
        stopGame();
        closeRoom();
        if (state.call) onRoom(null);
        setUrlRoom(null);
      } catch (e) {
        console.error(e);
      }
    },
  });
  if (state.pendingRoom) $('join-code').value = state.pendingRoom;
  local
    .restore()
    .catch(() => null)
    .then((fam) => {
      if (!fam) return goTo('email');
      familyEmail = fam.email;
      if (!fam.profile) return openPick();
      startSession(fam.profile);
      enterPendingRoom();
    });
})();
