// Listen Together client: WebSocket sync with server-clock offset estimation, drift correction and automatic reconnect.
import { app } from './core/app.js';
import { get } from './core/api.js';
import * as E from './player/engine.js';

export class Room extends EventTarget {
  constructor(id) { super(); this.id = id; this.ws = null; this.offset = 0; this.rtt = null; this.members = []; this.you = null; this.room = null; this.state = null; this.status = 'connecting'; this.tracks = new Map(); this.closedByUs = false; this.retry = 0; this.samples = []; this.sendQ = null; this.applied = { v: -1 }; this.onEng = e => this.hostSend(); }
  now() { return Date.now() + this.offset; }
  emit(n, d) { this.dispatchEvent(new CustomEvent(n, { detail: d })); }
  setStatus(s) { this.status = s; this.emit('status', s); }
  connect() {
    this.setStatus(this.retry ? 'reconnecting' : 'connecting'); const proto = location.protocol === 'https:' ? 'wss' : 'ws'; const ws = this.ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(this.id)}`);
    ws.onopen = () => { this.retry = 0; this.samples = []; for (let i = 0; i < 5; i++) setTimeout(() => this.ping(), i * 150); clearInterval(this.pi); this.pi = setInterval(() => this.ping(), 5000); clearInterval(this.drift); this.drift = setInterval(() => this.correct(), 1500); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.onMsg(m); };
    ws.onclose = ev => { clearInterval(this.pi); clearInterval(this.drift); if (this.closedByUs) return; if ([4401, 4403, 4404].includes(ev.code)) { this.setStatus(ev.code === 4404 ? 'closed' : 'denied'); return; } this.setStatus('reconnecting'); const d = Math.min(15000, 1000 * 2 ** this.retry++); this.rt = setTimeout(() => this.connect(), d); };
  }
  ping() { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'ping', c: Date.now() })); }
  send(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }
  async onMsg(m) {
    if (m.t === 'pong') { const rtt = Date.now() - m.c; this.samples.push({ rtt, off: m.s + rtt / 2 - Date.now() }); this.samples = this.samples.slice(-8); const best = [...this.samples].sort((a, b) => a.rtt - b.rtt)[0]; this.offset = best.off; this.rtt = best.rtt; this.emit('latency', this.rtt); }
    else if (m.t === 'welcome') { this.you = m.you; this.room = m.room; this.members = m.members; this.offset = m.serverNow - Date.now(); this.setStatus('live'); this.attach(); this.emit('meta'); await this.apply(m.state, true); }
    else if (m.t === 'state') { this.offset = m.serverNow - Date.now() + (this.rtt || 0) / 2; if (m.by === this.you?.id) { this.state = m.state; this.emit('state'); return; } await this.apply(m.state, false); }
    else if (m.t === 'members') { this.members = m.members; this.emit('meta'); }
    else if (m.t === 'room') { this.room = m.room; this.emit('meta'); }
    else if (m.t === 'chat') this.emit('chat', m);
    else if (m.t === 'error') this.emit('error', m);
    else if (m.t === 'closed') { this.setStatus('closed'); this.detach(); }
  }
  get isHost() { return this.you?.role === 'host'; }
  expected(s = this.state) { return s ? (s.playing ? s.pos / 1000 + (this.now() - s.at) / 1000 : s.pos / 1000) : 0; }
  async fetchTracks(ids) { await Promise.all(ids.filter(i => !this.tracks.has(i)).map(async i => { try { this.tracks.set(i, await get('/api/tracks/' + i)); } catch { this.tracks.set(i, null); } })); }
  async apply(state, first) {
    this.state = state; this.emit('state'); if (!state?.queue) return; await this.fetchTracks(state.queue); const q = state.queue.map(i => this.tracks.get(i)).filter(Boolean);
    if (this.isHost) { if (first && q.length) { E.setQueue(q, Math.max(0, state.index), { autoplay: false, source: 'room', startAt: this.expected(state) }); } return; }
    E.lock(true, 'The host controls playback. You can still change your own volume.');
    const cur = E.cur(), want = q[state.index], sameQueue = E.S.queue.length === q.length && q.every((t, i) => E.S.queue[i]?.id === t.id);
    E.S.source === 'room' || (E.S.source = 'room');
    if (!sameQueue || cur?.id !== want?.id) { E.S.locked = false; if (q.length && want) E.setQueue(q, state.index, { autoplay: state.playing, source: 'room', startAt: Math.max(0, this.expected(state)), keepHistory: true }); E.lock(true, 'The host controls playback. You can still change your own volume.'); }
    else { if (state.playing && E.isPaused()) { E.S.locked = false; E.play(); E.lock(true, 'The host controls playback. You can still change your own volume.'); } if (!state.playing && !E.isPaused()) { E.S.locked = false; E.pause(); E.lock(true, 'The host controls playback. You can still change your own volume.'); } E.S.locked = false; E.seek(this.expected(state), { silent: true }); E.lock(true, 'The host controls playback. You can still change your own volume.'); }
  }
  correct() { // latency / drift correction for listeners
    if (this.isHost || !this.state?.playing || E.S.source !== 'room') return; const exp = this.expected(), diff = E.S.position - exp; this.drift_ms = Math.round(diff * 1000); this.emit('latency', this.rtt);
    if (Math.abs(diff) > 0.4 && isFinite(E.S.duration) && E.S.duration) { E.S.locked = false; E.seek(Math.max(0, exp), { silent: true }); E.lock(true, 'The host controls playback. You can still change your own volume.'); }
    if (E.isPaused() && !E.S.error) { E.S.locked = false; E.play(); E.lock(true, 'The host controls playback. You can still change your own volume.'); }
  }
  attach() { if (this.isHost) { ['user', 'queue', 'change'].forEach(n => E.engine.addEventListener(n, this.onEng)); } }
  detach() { ['user', 'queue', 'change'].forEach(n => E.engine.removeEventListener(n, this.onEng)); }
  hostSend() { if (!this.isHost || E.S.source !== 'room') return; clearTimeout(this.sendQ); this.sendQ = setTimeout(() => { const s = E.S; this.send({ t: 'state', state: { queue: s.queue.map(t => t.id).filter(id => !id.startsWith('local_')), index: s.index, playing: s.playing, pos: Math.round(s.position * 1000) } }); }, 60); }
  hostPush() { this.hostSend(); }
  addToQueue(trackId) { this.send({ t: 'queue_add', trackId }); }
  leave() { this.closedByUs = true; clearTimeout(this.rt); clearInterval(this.pi); clearInterval(this.drift); this.detach(); this.ws?.close(); E.lock(false); if (E.S.source === 'room') E.S.source = 'catalog'; }
  forceDisconnect() { this.ws?.close(); } // used by tests to exercise reconnect
}
