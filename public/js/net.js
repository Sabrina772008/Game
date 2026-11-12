// HTTP API helper and an auto-reconnecting WebSocket client.

export async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export class Socket {
  constructor(token, handlers) {
    this.token = token;
    this.handlers = handlers; // { onMessage, onOpen, onClose }
    this.ws = null;
    this.closedByUs = false;
    this.retry = 0;
    this.queue = [];
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'auth', token: this.token }));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      this.handlers.onOpen?.();
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'replaced') this.closedByUs = true;
      this.handlers.onMessage(msg);
    };
    ws.onclose = () => {
      this.handlers.onClose?.();
      if (this.closedByUs) return;
      const delay = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  get connected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  send(msg) {
    if (this.connected) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'input') this.queue.push(msg);
  }

  close() {
    this.closedByUs = true;
    this.ws?.close();
  }
}
