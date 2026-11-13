// Daily play-time limit, based on where the device is.
//   * At the Glenwood spot (within RADIUS_M): 3 hours a day.
//   * Anywhere else, or if location is turned off: 2 hours a day.
// Time counts while the game is open on screen. When it runs out the game
// is blocked until midnight. Each player has their own time, saved on this
// device (and online by local.js). Nothing counts until a player is chosen.

// ---- SETTINGS: change these to set the Glenwood spot -----------------------
export const SPOT = { lat: -33.73894, lng: 150.94276 }; // 51 Angara Circuit, Glenwood NSW 2768
export const RADIUS_M = 150;
export const LIMIT_AT_SPOT_MIN = 180; // 3 hours
export const LIMIT_ELSEWHERE_MIN = 120; // 2 hours
// ---------------------------------------------------------------------------

const BASE_KEY = 'fa_playtime';
let KEY = null; // set per player by setPlaytimePlayer()
const TICK_MS = 5000;
const LOCATION_EVERY_MS = 5 * 60 * 1000;

let atSpot = false;
let locationKnown = false;
let blocked = false;
let warned = {};
let lastTick = Date.now();
let opts = { onBlock: () => {}, toast: () => {} };

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function load() {
  if (!KEY) return { date: today(), ms: 0 };
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && v.date === today()) return v;
  } catch {
    /* ignore */
  }
  return { date: today(), ms: 0 };
}

function save(v) {
  if (!KEY) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

function distanceM(a, b) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function limitMs() {
  return (atSpot ? LIMIT_AT_SPOT_MIN : LIMIT_ELSEWHERE_MIN) * 60000;
}

export function remainingMs() {
  return Math.max(0, limitMs() - load().ms);
}

let locationAllowed = false;

function checkLocation(done = () => {}) {
  if (!navigator.geolocation) {
    atSpot = false;
    locationKnown = true;
    render();
    return done(false);
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locationAllowed = true;
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      // Allow for GPS inaccuracy, but never more than an extra 100 m.
      const slack = Math.min(pos.coords.accuracy || 0, 100);
      const was = atSpot;
      atSpot = distanceM(here, SPOT) <= RADIUS_M + slack;
      if (!locationKnown || was !== atSpot) {
        opts.toast(atSpot ? 'You have 3 hours of play today here.' : 'You have 2 hours of play today here.', 'info', 5000);
      }
      locationKnown = true;
      render();
      done(true);
    },
    () => {
      atSpot = false;
      locationKnown = true;
      render();
      done(false);
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
  );
}

// A screen that asks to share location before playing. The browser's own
// "Allow location?" pop-up appears when the button is pressed.
function askForLocation() {
  const g = document.createElement('div');
  g.id = 'location-gate';
  const card = document.createElement('div');
  card.className = 'card';
  g.append(card);
  const ask = () => {
    card.innerHTML =
      '<div style="font-size:3rem">📍</div><h2>Share your location to play</h2>' +
      '<p>Friend Arcade uses your location to set today\'s play time: 3 hours at home in Glenwood, 2 hours everywhere else. ' +
      'Your location stays on this device and is never sent to anyone.</p>' +
      '<button class="primary big" id="btn-share-loc">Share my location</button>';
    card.querySelector('#btn-share-loc').addEventListener('click', (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Checking…';
      checkLocation((ok) => (ok ? g.remove() : denied()));
    });
  };
  const denied = () => {
    card.innerHTML =
      '<div style="font-size:3rem">🚫</div><h2>Location is turned off</h2>' +
      '<p>Without location, you get <b>2 hours</b> of play today.</p>' +
      '<p class="muted" style="font-size:.9em">To turn it on, ask a grown-up to allow Location for this website in the browser or device settings, then tap Try again.</p>' +
      '<button class="primary big" id="btn-loc-retry">Try again</button> ' +
      '<button class="ghost big" id="btn-loc-skip">Play with 2 hours</button>';
    card.querySelector('#btn-loc-retry').addEventListener('click', () => location.reload());
    card.querySelector('#btn-loc-skip').addEventListener('click', () => g.remove());
  };
  ask();
  document.body.append(g);
}

async function startLocation() {
  let st = 'prompt';
  try {
    st = (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    /* Safari on older devices: just ask */
  }
  if (st === 'granted') checkLocation();
  else askForLocation();
  // Re-check every few minutes, but only once location has been allowed.
  setInterval(() => locationAllowed && checkLocation(), LOCATION_EVERY_MS);
}

function fmt(ms) {
  const m = Math.ceil(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

function render() {
  const chip = document.getElementById('time-left');
  if (chip) chip.textContent = `⏱ ${fmt(remainingMs())}`;
}

function showBlock() {
  let b = document.getElementById('time-block');
  if (!b) {
    b = document.createElement('div');
    b.id = 'time-block';
    b.innerHTML =
      '<div class="card"><div style="font-size:3rem">⏰</div><h2>Time\'s up for today!</h2>' +
      '<p>You\'ve used all your play time. Come back tomorrow to play again.</p></div>';
    document.body.append(b);
  }
  b.classList.remove('hidden');
}

function tick() {
  const now = Date.now();
  // Only count time while the page is on screen; cap each step so a sleeping
  // device doesn't add a big jump.
  const step = document.visibilityState === 'visible' ? Math.min(now - lastTick, TICK_MS * 3) : 0;
  lastTick = now;

  if (!KEY) return; // nobody is playing yet
  const v = load();
  if (v.date !== today()) warned = {};
  if (!blocked) {
    v.ms += step;
    save(v);
  }
  const left = Math.max(0, limitMs() - v.ms);

  if (left <= 0 && !blocked) {
    blocked = true;
    showBlock();
    opts.onBlock();
  } else if (left > 0 && blocked) {
    // New day (or moved to the 3-hour spot): unlock.
    blocked = false;
    document.getElementById('time-block')?.classList.add('hidden');
  }
  for (const min of [10, 1]) {
    if (!blocked && left <= min * 60000 && !warned[min]) {
      warned[min] = true;
      opts.toast(`${min} minute${min > 1 ? 's' : ''} of play time left today!`, 'warn', 6000);
    }
  }
  render();
}

/** Today's time for the current player: { date, ms }. */
export function readToday() {
  return load();
}

/** Replace today's time for the current player (used when the online copy is higher). */
export function writeToday(ms) {
  save({ date: today(), ms });
  render();
}

/** Switch whose time is being counted. Pass null when nobody is playing. */
export function setPlaytimePlayer(id) {
  KEY = id ? `${BASE_KEY}_${id}` : null;
  warned = {};
  blocked = false;
  document.getElementById('time-block')?.classList.add('hidden');
  lastTick = Date.now();
  if (KEY) tick();
}

export function isBlocked() {
  return blocked;
}

/** Start counting. onBlock runs once when time runs out (leave room, stop game). */
export function startPlaytime(o) {
  opts = { ...opts, ...o };
  startLocation();
  lastTick = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lastTick = Date.now();
  });
  tick();
  setInterval(tick, TICK_MS);
}
