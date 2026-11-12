// Room voice/video call: a WebRTC "mesh" (everyone connects to everyone).
// The server only relays signaling messages; audio/video go peer-to-peer
// (or through your TURN server when a direct path isn't possible).
// Mic and camera start OFF. Each peer connection is created with one audio
// and one video slot up front, so turning devices on/off later just swaps the
// track - no renegotiation needed, and the call survives screen changes.

export class Call {
  constructor({ send, myId, onChange }) {
    this.send = send;
    this.myId = myId;
    this.onChange = onChange;
    this.inCall = false;
    this.peers = new Map(); // id -> { pc, stream, pendingIce, state }
    this.mic = null; // MediaStreamTrack
    this.cam = null;
    this.deafened = false;
    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  }

  async join() {
    if (this.inCall) return;
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      if (Array.isArray(cfg.iceServers) && cfg.iceServers.length) this.iceServers = cfg.iceServers;
    } catch {
      /* keep defaults */
    }
    this.inCall = true;
    this.send({ t: 'call:join' });
    this.onChange();
  }

  leave() {
    if (!this.inCall) return;
    this.send({ t: 'call:leave' });
    this.#teardown();
    this.#stopTrack('mic');
    this.#stopTrack('cam');
    this.onChange();
  }

  /** WebSocket dropped and came back: the server forgot our call, so rejoin. */
  rejoinAfterReconnect() {
    if (!this.inCall) return;
    this.#teardown();
    this.inCall = true;
    this.send({ t: 'call:join' });
    this.#announce();
    this.onChange();
  }

  #teardown() {
    for (const p of this.peers.values()) p.pc.close();
    this.peers.clear();
    this.inCall = false;
  }

  async toggleMic() {
    if (this.mic) {
      this.#stopTrack('mic');
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        this.mic = s.getAudioTracks()[0];
      } catch (e) {
        throw new Error(mediaError(e, 'microphone'));
      }
    }
    await this.#applyTracks();
    this.#announce();
    this.onChange();
  }

  async toggleCam() {
    if (this.cam) {
      this.#stopTrack('cam');
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, frameRate: 20 } });
        this.cam = s.getVideoTracks()[0];
      } catch (e) {
        throw new Error(mediaError(e, 'camera'));
      }
    }
    await this.#applyTracks();
    this.#announce();
    this.onChange();
  }

  toggleDeafen() {
    this.deafened = !this.deafened;
    this.onChange();
  }

  #stopTrack(which) {
    if (this[which]) this[which].stop();
    this[which] = null;
    this.#applyTracks();
    if (this.inCall) this.#announce();
  }

  #announce() {
    this.send({ t: 'call:media', mic: !!this.mic, cam: !!this.cam });
  }

  async #applyTracks() {
    for (const p of this.peers.values()) await this.#applyTracksTo(p);
  }

  async #applyTracksTo(p) {
    for (const tr of p.pc.getTransceivers()) {
      const kind = tr.receiver.track?.kind;
      if (!kind || tr.stopped) continue;
      const track = kind === 'audio' ? this.mic : this.cam;
      try {
        if (tr.sender.track !== track) await tr.sender.replaceTrack(track);
      } catch (e) {
        console.warn('replaceTrack failed', e);
      }
    }
  }

  #peer(id) {
    let p = this.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    p = { pc, stream: new MediaStream(), pendingIce: [], state: 'connecting' };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ t: 'call:signal', to: id, data: { ice: e.candidate } });
    };
    pc.ontrack = (e) => {
      if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
      this.onChange();
    };
    pc.onconnectionstatechange = () => {
      p.state = pc.connectionState;
      this.onChange();
    };
    return p;
  }

  async #offer(id) {
    const p = this.#peer(id);
    p.pc.addTransceiver('audio', { direction: 'sendrecv' });
    p.pc.addTransceiver('video', { direction: 'sendrecv' });
    await this.#applyTracksTo(p);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.send({ t: 'call:signal', to: id, data: { sdp: p.pc.localDescription } });
  }

  // ----- messages from the server -----
  async handle(msg) {
    if (!this.inCall) return;
    switch (msg.t) {
      case 'call:peers':
        // The lower user id makes the offer, so every pair has exactly one offerer.
        for (const id of msg.peers) {
          this.#peer(id);
          if (this.myId < id) await this.#offer(id);
        }
        this.#announce();
        break;
      case 'call:joined':
        this.#peer(msg.userId);
        if (this.myId < msg.userId) await this.#offer(msg.userId);
        break;
      case 'call:left': {
        const p = this.peers.get(msg.userId);
        if (p) p.pc.close();
        this.peers.delete(msg.userId);
        break;
      }
      case 'call:signal': {
        const p = this.#peer(msg.from);
        const { sdp, ice } = msg.data || {};
        try {
          if (sdp) {
            await p.pc.setRemoteDescription(sdp);
            if (sdp.type === 'offer') {
              for (const tr of p.pc.getTransceivers()) tr.direction = 'sendrecv';
              await this.#applyTracksTo(p);
              const answer = await p.pc.createAnswer();
              await p.pc.setLocalDescription(answer);
              this.send({ t: 'call:signal', to: msg.from, data: { sdp: p.pc.localDescription } });
            }
            for (const c of p.pendingIce.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
          } else if (ice) {
            if (p.pc.remoteDescription) await p.pc.addIceCandidate(ice).catch(() => {});
            else p.pendingIce.push(ice);
          }
        } catch (e) {
          console.warn('signal error', e);
        }
        break;
      }
    }
    this.onChange();
  }

  streamFor(id) {
    return this.peers.get(id)?.stream || null;
  }
}

function mediaError(e, what) {
  if (!window.isSecureContext) return `Your browser only allows the ${what} on https:// pages or localhost.`;
  if (e && e.name === 'NotAllowedError') return `Permission to use the ${what} was blocked. Allow it in your browser's site settings.`;
  if (e && e.name === 'NotFoundError') return `No ${what} was found on this device.`;
  return `Couldn't start the ${what}: ${e && e.message ? e.message : e}`;
}
