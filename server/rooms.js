import { WebSocketServer } from 'ws';
import { parseCookies, sha256, clean } from './util.js';

// Listen Together: one authoritative playback state per room, owned by the host.
// Every listener streams from the licensed/demo catalogue themselves — the server never relays audio.
export function createRooms({ db }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
  const live = new Map(); // roomId -> { sockets:Map<ws,{id,name}>, state }
  const userFrom = req => {
    const sid = parseCookies(req.headers.cookie).auralys_sid; if (!sid) return null;
    const s = db.get('SELECT u.id,u.name,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?', sha256(sid));
    return s && s.expires_at > Date.now() ? { id: s.id, name: s.name } : null;
  };
  const room = id => { let r = live.get(id); if (!r) { const row = db.get('SELECT state FROM rooms WHERE id=?', id); r = { sockets: new Map(), state: row ? JSON.parse(row.state) : {} }; live.set(id, r); } return r; };
  const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const bcast = (id, m) => { const r = live.get(id); if (r) for (const ws of r.sockets.keys()) send(ws, m); };
  const log = (rid, uid, type, payload) => db.run('INSERT INTO room_events (room_id,user_id,type,payload,created_at) VALUES (?,?,?,?,?)', rid, uid, type, payload ? JSON.stringify(payload) : null, Date.now());
  const members = id => {
    const r = live.get(id), online = new Set(r ? [...r.sockets.values()].map(x => x.id) : []);
    return db.all('SELECT m.user_id id, m.role, u.name FROM room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=? ORDER BY m.joined_at', id).map(m => ({ ...m, online: online.has(m.id) }));
  };
  const trackOk = id => !!db.get('SELECT 1 x FROM tracks WHERE id=? AND owner_id IS NULL', id);
  const persist = (id, state) => db.run('UPDATE rooms SET state=? WHERE id=?', JSON.stringify(state), id);

  function onMessage(ws, ctx, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const { roomId, user } = ctx, row = db.get('SELECT * FROM rooms WHERE id=?', roomId), r = room(roomId);
    if (!row || row.closed_at) return;
    const isHost = row.host_id === user.id;
    if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c, s: Date.now() });
    if (m.t === 'sync') return send(ws, { t: 'state', state: r.state, serverNow: Date.now() });
    if (m.t === 'state') {
      if (!isHost) return send(ws, { t: 'error', code: 'host_only', message: 'Only the host can control playback.' });
      const q = Array.isArray(m.state?.queue) ? m.state.queue.map(String).slice(0, 200) : null;
      if (!q || !q.every(trackOk)) return send(ws, { t: 'error', code: 'track_not_shared', message: 'Rooms can only play shared catalogue tracks, not private uploads.' });
      const index = Number.isInteger(m.state.index) ? Math.max(-1, Math.min(m.state.index, q.length - 1)) : -1;
      r.state = { queue: q, index, playing: !!m.state.playing && index >= 0, pos: Math.max(0, Math.min(+m.state.pos || 0, 36e6)), at: Date.now(), v: (r.state.v || 0) + 1 };
      persist(roomId, r.state); log(roomId, user.id, 'state', { index, playing: r.state.playing, pos: r.state.pos });
      return bcast(roomId, { t: 'state', state: r.state, serverNow: Date.now(), by: user.id });
    }
    if (m.t === 'queue_add') {
      if (!isHost && !row.members_can_queue) return send(ws, { t: 'error', code: 'queue_locked', message: 'The host has locked the queue.' });
      const id = String(m.trackId || ''); if (!trackOk(id)) return send(ws, { t: 'error', code: 'track_not_shared', message: 'That track cannot be shared in a room.' });
      if (r.state.queue.length >= 200) return;
      const s = r.state; const cur = s.playing ? s.pos + (Date.now() - s.at) : s.pos;
      r.state = { ...s, queue: [...s.queue, id], pos: cur, at: Date.now(), v: (s.v || 0) + 1 }; if (r.state.index < 0) r.state.index = 0;
      persist(roomId, r.state); log(roomId, user.id, 'queue_add', { trackId: id });
      return bcast(roomId, { t: 'state', state: r.state, serverNow: Date.now(), by: user.id });
    }
    if (m.t === 'chat') { const text = clean(m.text, 200); if (text) bcast(roomId, { t: 'chat', from: user.name, text, at: Date.now() }); }
  }

  function upgrade(req, socket, head) {
    const url = new URL(req.url, 'http://x'); if (url.pathname !== '/ws') return socket.destroy();
    const user = userFrom(req), roomId = url.searchParams.get('room') || '';
    wss.handleUpgrade(req, socket, head, ws => {
      const row = db.get('SELECT * FROM rooms WHERE id=?', roomId), mem = user && row && db.get('SELECT role FROM room_members WHERE room_id=? AND user_id=?', roomId, user.id);
      if (!user) return ws.close(4401, 'auth'); if (!row || row.closed_at) return ws.close(4404, 'closed'); if (!mem) return ws.close(4403, 'not a member');
      const r = room(roomId), ctx = { roomId, user }; r.sockets.set(ws, user); ws.isAlive = true;
      ws.on('pong', () => ws.isAlive = true); ws.on('message', d => { try { onMessage(ws, ctx, d.toString()); } catch (e) { console.error('ws', e.message); } });
      ws.on('close', () => { r.sockets.delete(ws); log(roomId, user.id, 'leave'); bcast(roomId, { t: 'members', members: members(roomId) }); });
      log(roomId, user.id, 'join');
      send(ws, { t: 'welcome', serverNow: Date.now(), you: { id: user.id, name: user.name, role: mem.role }, room: { id: roomId, name: row.name, hostId: row.host_id, membersCanQueue: !!row.members_can_queue }, state: r.state, members: members(roomId) });
      bcast(roomId, { t: 'members', members: members(roomId) });
    });
  }
  const beat = setInterval(() => { for (const r of live.values()) for (const ws of r.sockets.keys()) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 25000); beat.unref();
  return {
    upgrade,
    refresh(id) { const row = db.get('SELECT * FROM rooms WHERE id=?', id); if (row) bcast(id, { t: 'room', room: { id, name: row.name, hostId: row.host_id, membersCanQueue: !!row.members_can_queue } }); },
    close(id) { bcast(id, { t: 'closed' }); const r = live.get(id); if (r) { for (const ws of r.sockets.keys()) ws.close(4404, 'closed'); live.delete(id); } },
    shutdown() { clearInterval(beat); wss.close(); }
  };
}
