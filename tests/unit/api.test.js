import test from 'node:test'; import assert from 'node:assert/strict'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'auralys-unit-'));
const { startServer } = await import('../../server/index.js'); const { resetRateLimits } = await import('../../server/util.js');
const s = await startServer({ port: 0, quiet: true, seed: false }); const base = `http://localhost:${s.port}`;
test.after(() => s.close());
const call = async (p, o = {}, cookie) => { const r = await fetch(base + p, { method: o.method || 'GET', headers: { 'X-Auralys': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: o.json ? JSON.stringify(o.json) : o.body }); return { status: r.status, body: await r.json().catch(() => null), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
const signup = async n => (await call('/api/auth/signup', { method: 'POST', json: { email: `${n}@x.io`, name: n, password: 'password123' } }));
// minimal catalogue row so FK constraints are satisfied without generating audio
s.db.run("INSERT INTO artists (id,name,demo) VALUES ('ar1','A',1)"); s.db.run("INSERT INTO tracks (id,title,artist_id,duration_ms,audio_path,demo) VALUES ('t1','T','ar1',60000,'x.wav',1)");

test('auth: validation, duplicate email, login, bad password', async () => {
  assert.equal((await call('/api/auth/signup', { method: 'POST', json: { email: 'bad', name: 'x', password: 'password123' } })).status, 400);
  assert.equal((await call('/api/auth/signup', { method: 'POST', json: { email: 'a@x.io', name: 'x', password: 'short' } })).status, 400);
  const a = await signup('alice'); assert.equal(a.status, 200); assert.equal((await signup('alice')).status, 409);
  assert.equal((await call('/api/auth/login', { method: 'POST', json: { email: 'alice@x.io', password: 'nope' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', json: { email: 'alice@x.io', password: 'password123' } })).status, 200);
  assert.equal((await call('/api/auth/me', {}, a.cookie)).body.user.email, 'alice@x.io'); assert.equal((await call('/api/auth/me')).body.user, null);
});
test('isolation: users only see their own playlists, favourites, events and state', async () => {
  resetRateLimits(); const a = await signup('iso-a'), b = await signup('iso-b');
  const pl = (await call('/api/playlists', { method: 'POST', json: { name: 'Mine' } }, a.cookie)).body; assert.ok(pl.id);
  assert.equal((await call('/api/playlists/' + pl.id, {}, b.cookie)).status, 404); assert.equal((await call('/api/playlists/' + pl.id, { method: 'PUT', json: { name: 'hax' } }, b.cookie)).status, 404);
  assert.equal((await call('/api/playlists/' + pl.id + '/tracks', { method: 'POST', json: { trackIds: ['t1'] } }, b.cookie)).status, 404); assert.equal((await call('/api/playlists/' + pl.id, { method: 'DELETE' }, b.cookie)).status, 404);
  await call('/api/favorites/t1', { method: 'PUT' }, a.cookie); assert.equal((await call('/api/library/favorites', {}, b.cookie)).body.tracks.length, 0); assert.equal((await call('/api/library/favorites', {}, a.cookie)).body.tracks.length, 1);
  await call('/api/state', { method: 'PUT', json: { queue: ['t1'] } }, a.cookie); assert.deepEqual((await call('/api/state', {}, b.cookie)).body, {});
  assert.equal((await call('/api/library/songs')).status, 401);
});
test('listening events: dedupe by session id, ratchet listened time, privacy toggle', async () => {
  resetRateLimits(); const a = await signup('ev'); for (const ms of [1000, 20000, 15000, 60000]) await call('/api/events', { method: 'POST', json: { sid: 's1', trackId: 't1', listenedMs: ms, completed: ms > 50000 } }, a.cookie);
  const st = (await call('/api/stats?range=all', {}, a.cookie)).body; assert.equal(st.sessions, 1); assert.equal(st.plays, 1); assert.equal(st.totalMs, 60000);
  await call('/api/prefs', { method: 'PUT', json: { privacy: { history: false } } }, a.cookie); const r = await call('/api/events', { method: 'POST', json: { sid: 's2', trackId: 't1', listenedMs: 60000 } }, a.cookie); assert.equal(r.body.recorded, false); assert.equal((await call('/api/stats?range=all', {}, a.cookie)).body.sessions, 1);
  assert.equal((await call('/api/events', { method: 'POST', json: { sid: 's3', trackId: 'missing', listenedMs: 1 } }, (await signup('ev2')).cookie)).status, 404);
});
test('room permissions: wrong code rejected, host-only close', async () => {
  resetRateLimits(); const h = await signup('host'), m = await signup('mem'); const r = (await call('/api/rooms', { method: 'POST', json: { name: 'R' } }, h.cookie)).body;
  assert.equal((await call(`/api/rooms/${r.id}/join`, { method: 'POST', json: { code: 'bad' } }, m.cookie)).status, 403); assert.equal((await call(`/api/rooms/${r.id}/join`, { method: 'POST', json: { code: r.inviteCode } }, m.cookie)).status, 200);
  assert.equal((await call(`/api/rooms/${r.id}/close`, { method: 'POST' }, m.cookie)).status, 403); assert.equal((await call(`/api/rooms/${r.id}`, {}, m.cookie)).body.inviteCode, undefined); assert.equal((await call(`/api/rooms/${r.id}/close`, { method: 'POST' }, h.cookie)).status, 200);
});
test('account deletion cascades', async () => { resetRateLimits(); const a = await signup('gone'); await call('/api/favorites/t1', { method: 'PUT' }, a.cookie); await call('/api/playlists', { method: 'POST', json: { name: 'x' } }, a.cookie); assert.equal((await call('/api/account', { method: 'DELETE', json: { password: 'password123' } }, a.cookie)).status, 200); assert.equal(s.db.get("SELECT COUNT(*) n FROM users WHERE email='gone@x.io'").n, 0); assert.equal(s.db.get('SELECT COUNT(*) n FROM favorites f LEFT JOIN users u ON u.id=f.user_id WHERE u.id IS NULL').n, 0); });
