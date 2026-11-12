// Room voice/video call, powered by Daily.co (https://daily.co).
//
// Everyone in a game room joins the same Daily room automatically, with
// camera and mic on, and stays in it the whole game (always-on call).
// Daily carries all the audio and video; our own room only keeps track of who
// is in the call so the lobby can show 🎤/📷 badges.
//
// No API key is used or needed here (GitHub Pages code is public, so a key
// must never go in it). The room below was made in the Daily dashboard.

// ---- SETTINGS --------------------------------------------------------------
export const DAILY_ROOM_URL = 'https://sabrina-family.daily.co/starbeans-wg6miwgwvedifm';
// ---------------------------------------------------------------------------

export class Call {
  constructor({ send, myId, userName, onChange, onError }) {
    this.send = send;
    this.myId = myId;
    this.userName = userName || 'Player';
    this.onChange = onChange;
    this.onError = onError || ((m) => console.warn(m));
    this.inCall = false;
    this.deafened = false;
    this.peers = new Map(); // kept for app.js; Daily handles connections itself
    this.co = null; // Daily call object
    this.streams = new Map(); // game user id -> { stream, a, v }
    this.lastMedia = '';
  }

  // ----- local tracks (app.js reads these) -----
  #local() {
    return this.co?.participants()?.local || null;
  }
  get mic() {
    const t = this.#local()?.tracks?.audio;
    return t && t.state === 'playable' ? t.persistentTrack : null;
  }
  get cam() {
    const t = this.#local()?.tracks?.video;
    return t && t.state === 'playable' ? t.persistentTrack : null;
  }

  async join() {
    if (this.inCall) return;
    if (!window.DailyIframe) {
      this.onError('The video call could not load. Check your internet and refresh the page.');
      return;
    }
    this.inCall = true;
    this.send({ t: 'call:join' });
    this.onChange();

    const co = window.DailyIframe.createCallObject({ subscribeToTracksAutomatically: true });
    this.co = co;
    const update = () => {
      this.#announce();
      this.onChange();
    };
    for (const ev of ['joined-meeting', 'participant-joined', 'participant-updated', 'participant-left', 'track-started', 'track-stopped']) {
      co.on(ev, update);
    }
    co.on('camera-error', (e) => this.onError(cameraError(e)));
    co.on('error', (e) => {
      this.onError(`Video call problem: ${e?.errorMsg || 'unknown error'}`);
      this.leave();
    });
    co.on('left-meeting', () => {
      if (this.co === co && this.inCall) this.leave();
    });

    try {
      await co.join({
        url: DAILY_ROOM_URL,
        userName: this.userName,
        userData: { gid: this.myId },
        startAudioOff: false,
        startVideoOff: false,
      });
    } catch (e) {
      this.onError(`Couldn't join the video call: ${e?.errorMsg || e?.message || e}`);
      this.leave();
    }
  }

  leave() {
    if (!this.inCall && !this.co) return;
    const co = this.co;
    this.co = null;
    this.inCall = false;
    this.streams.clear();
    this.lastMedia = '';
    this.send({ t: 'call:leave' });
    if (co) co.leave().catch(() => {}).finally(() => co.destroy().catch(() => {}));
    this.onChange();
  }

  /** WebSocket dropped and came back: the room forgot we're in the call. */
  rejoinAfterReconnect() {
    if (!this.inCall) return;
    this.send({ t: 'call:join' });
    this.lastMedia = '';
    this.#announce();
    this.onChange();
  }

  async toggleMic() {
    if (!this.co) return;
    this.co.setLocalAudio(!this.co.localAudio());
  }

  async toggleCam() {
    if (!this.co) return;
    this.co.setLocalVideo(!this.co.localVideo());
  }

  toggleDeafen() {
    this.deafened = !this.deafened;
    this.onChange();
  }

  #announce() {
    if (!this.inCall) return;
    const media = { mic: !!this.mic, cam: !!this.cam };
    const key = JSON.stringify(media);
    if (key === this.lastMedia) return;
    this.lastMedia = key;
    this.send({ t: 'call:media', ...media });
  }

  // Our room still sends call:peers / call:signal messages; Daily doesn't need them.
  async handle() {
    this.onChange();
  }

  /** Audio + video of another player, matched by their game user id. */
  streamFor(gid) {
    if (!this.co) return null;
    const p = Object.values(this.co.participants()).find((x) => !x.local && x.userData?.gid === gid);
    if (!p) return null;
    const pick = (t) => (t && t.state === 'playable' ? t.persistentTrack : null);
    const a = pick(p.tracks?.audio);
    const v = pick(p.tracks?.video);
    let s = this.streams.get(gid);
    // Keep the same MediaStream object unless the tracks changed, so videos don't flicker.
    if (!s || s.a !== a || s.v !== v) {
      s = { stream: new MediaStream([a, v].filter(Boolean)), a, v };
      this.streams.set(gid, s);
    }
    return s.stream;
  }
}

function cameraError(e) {
  if (!window.isSecureContext) return 'Your browser only allows the camera and mic on https:// pages.';
  const type = e?.error?.type || '';
  if (type === 'permissions') return "Camera or mic permission was blocked. Allow it in your browser's site settings.";
  if (type === 'not-found') return 'No camera or mic was found on this device.';
  if (type === 'cam-in-use' || type === 'mic-in-use') return 'Another app is using the camera or mic.';
  return `Camera/mic problem: ${e?.errorMsg || type || 'unknown'}`;
}
