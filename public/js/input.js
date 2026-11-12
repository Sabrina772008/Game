// Keyboard (and optional touch) controls. Sends held keys to the server.

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'jump',
  KeyE: 'action',
};

export class Input {
  constructor(send) {
    this.send = send;
    this.keys = { up: false, down: false, left: false, right: false, jump: false, action: false };
    this.enabled = false;
    this.pressHandlers = new Set();
    window.addEventListener('keydown', (e) => this.#onKey(e, true));
    window.addEventListener('keyup', (e) => this.#onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    setInterval(() => this.enabled && this.flush(), 400);
  }

  #typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  #onKey(e, down) {
    if (!this.enabled || this.#typing(e)) return;
    const k = KEYMAP[e.code];
    if (down && !e.repeat) for (const h of this.pressHandlers) h(e.code);
    if (!k) return;
    e.preventDefault();
    if (this.keys[k] !== down) {
      this.keys[k] = down;
      this.flush();
    }
  }

  set(k, down) {
    if (this.keys[k] === down) return;
    this.keys[k] = down;
    this.flush();
  }

  flush() {
    this.send({ t: 'input', keys: this.keys });
  }

  releaseAll() {
    for (const k of Object.keys(this.keys)) this.keys[k] = false;
    if (this.enabled) this.flush();
  }

  onPress(fn) {
    this.pressHandlers.add(fn);
    return () => this.pressHandlers.delete(fn);
  }
}

/** On-screen buttons for phones/tablets. buttons: [{label, key?, onPress?}] */
export function buildTouchControls(container, input, extraButtons = []) {
  container.innerHTML = '';
  const pad = document.createElement('div');
  pad.className = 'touch-pad';
  for (const [k, label] of [['up', '▲'], ['left', '◀'], ['right', '▶'], ['down', '▼']]) {
    const b = document.createElement('button');
    b.className = `touch-btn t-${k}`;
    b.textContent = label;
    hold(b, (on) => input.set(k, on));
    pad.appendChild(b);
  }
  container.appendChild(pad);
  const right = document.createElement('div');
  right.className = 'touch-actions';
  for (const btn of extraButtons) {
    const b = document.createElement('button');
    b.className = 'touch-btn action';
    b.textContent = btn.label;
    if (btn.key) hold(b, (on) => input.set(btn.key, on));
    else b.addEventListener('pointerdown', (e) => (e.preventDefault(), btn.onPress()));
    right.appendChild(b);
  }
  container.appendChild(right);
}

function hold(el, fn) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    fn(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => fn(false));
}
