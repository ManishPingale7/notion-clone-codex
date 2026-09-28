import { io } from 'socket.io-client';
import { api } from './api';
export function createLiveClient() {
  if (import.meta.env.VITE_COLLABORATION !== 'polling') return io();
  return new CloudLiveClient();
}
class CloudLiveClient {
  constructor() {
    this.listeners = new Map();
    this.connection = crypto.randomUUID();
    this.page = 'home';
    this.versions = null;
    this.stopped = false;
    this.connected = false;
    this.inflight = false;
    this.timer = setTimeout(() => this.tick(), 0);
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return this;
  }
  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
    return this;
  }
  dispatch(event, data) {
    for (const fn of this.listeners.get(event) || []) fn(data);
  }
  emit(event, value) {
    if (event === 'page') {
      this.page = value;
      this.tick();
    }
    return this;
  }
  async tick() {
    if (this.stopped || this.inflight) return;
    clearTimeout(this.timer);
    this.inflight = true;
    try {
      const data = await api('/sync', 'POST', { connection: this.connection, page: this.page });
      if (this.stopped) return;
      if (!this.connected) {
        this.connected = true;
        this.dispatch('connect');
      }
      const next = new Map(data.versions.map((v) => [v.workspace, v.version || '0']));
      if (this.versions) {
        for (const workspace of new Set([...this.versions.keys(), ...next.keys()])) {
          if (this.versions.get(workspace) !== next.get(workspace))
            this.dispatch('invalidate', { workspace, page: this.page });
        }
      }
      this.versions = next;
      const presence = JSON.stringify(data.presence);
      if (presence !== this.lastPresence) {
        this.lastPresence = presence;
        this.dispatch('presence', data.presence);
      }
    } catch {
      if (this.connected) {
        this.connected = false;
        this.dispatch('disconnect');
      }
    } finally {
      this.inflight = false;
      if (!this.stopped) this.timer = setTimeout(() => this.tick(), document.hidden ? 10000 : 2500);
    }
  }
  disconnect() {
    this.stopped = true;
    clearTimeout(this.timer);
    fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection: this.connection, page: null }),
      keepalive: true,
    }).catch(() => {});
    this.listeners.clear();
  }
}
