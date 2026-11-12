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
let authMode = 'login';
for (const tab of document.querySelectorAll('#screen-auth .tab')) {
  tab.addEventListener('click', () => {
    authMode = tab.dataset.mode;
    for (const t of document.querySelectorAll('#screen-auth .tab')) t.classList.toggle('active', t === tab);
    $('auth-submit').textContent = authMode === 'login' ? 'Sign in' : 'Create account';
    $('auth-form').password.autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    $('auth-error').textContent = '';
  });
}

// GitHub Pages version: no password server, so your player lives on this device.
(function simplifyAuth() {
  document.querySelector('#screen-auth .tabs')?.classList.add('hidden');
  const pw = $('auth-form').password;
  pw.required = false;
  pw.closest('label').classList.add('hidden');
  $('auth-form').username.closest('label').firstChild.textContent = 'Your player name ';
  $('auth-form').username.minLength = 2;
  $('auth-submit').textContent = "Let's play!";
  const note = el('p', { class: 'muted', style: 'margin-top:10px;font-size:.9em' }, 'Your coins and avatar are saved on this device. Use the same name next time to get them back.');
  $('auth-form').append(note);
})();

$('auth-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('auth-error').textContent = '';
  try {
    startSession(local.signIn(e.target.username.value));
    enterPendingRoom();
  } catch (err) {
    $('auth-error').textContent = err.message;
  }
});

$('btn-signout').textContent = 'Switch player';
$('btn-signout').addEventListener('click', () => {
  closeRoom();
  local.signOut();
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
  const profile = local.currentProfile();
  if (!profile) return show('auth');
  startSession(profile);
  enterPendingRoom();
})();
