import { createReadStream, statSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DATA_DIR, uid } from './db.js';
import { HttpError, bad, send, readBody, readJson, parseCookies, sha256, token, hashPassword, verifyPassword, rateLimit, clean, esc, sniffAudio, sniffImage } from './util.js';

export const REGIONS = [['global', 'Global'], ['ID', 'Indonesia'], ['US', 'United States'], ['GB', 'United Kingdom'], ['JP', 'Japan'], ['BR', 'Brazil'], ['DE', 'Germany'], ['IN', 'India']];
export const MOODS = [['Calm', 'Slow, soft and spacious'], ['Warm', 'Golden-hour comfort'], ['Focus', 'Steady, unobtrusive'], ['Night', 'After-hours drive'], ['Energy', 'Up and moving']];
const COOKIE = 'auralys_sid', SESSION_MS = 30 * 864e5;
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 60) * 1048576;

export function createApi({ db, config, rooms }) {
  const routes = [];
  const add = (method, path, opts, fn) => {
    if (typeof opts === 'function') { fn = opts; opts = {}; }
    const keys = []; const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, re, keys, opts, fn });
  };
  const secure = req => process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';

  // ---------- helpers ----------
  const getUser = req => {
    const sid = parseCookies(req.headers.cookie)[COOKIE]; if (!sid) return null;
    const s = db.get('SELECT s.id sid, s.expires_at, u.id, u.email, u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?', sha256(sid));
    if (!s || s.expires_at < Date.now()) return null;
    return { id: s.id, email: s.email, name: s.name, sid: s.sid };
  };
  const startSession = (req, res, userId) => {
    const t = token(), now = Date.now();
    db.run('INSERT INTO sessions (id,user_id,created_at,expires_at,user_agent) VALUES (?,?,?,?,?)', sha256(t), userId, now, now + SESSION_MS, clean(req.headers['user-agent'], 160));
    return `${COOKIE}=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure(req) ? '; Secure' : ''}`;
  };
  const ip = req => req.socket.remoteAddress || 'x';
  const getPrefs = uidv => { const r = db.get('SELECT data FROM preferences WHERE user_id=?', uidv); try { return r ? JSON.parse(r.data) : {}; } catch { return {}; } };

  const TRACK_SQL = `SELECT t.id,t.title,t.kind,t.genre,t.mood,t.duration_ms,t.demo,t.owner_id,t.track_no,t.description,t.podcast_id,t.artist_id,
    ar.name artist, t.album_id, al.title album, COALESCE(al.cover, pc.cover, ar.cover) cover, pc.title podcast,
    EXISTS(SELECT 1 FROM lyrics l WHERE l.track_id=t.id) has_lyrics,
    EXISTS(SELECT 1 FROM favorites f WHERE f.track_id=t.id AND f.user_id=:u) fav
    FROM tracks t LEFT JOIN artists ar ON ar.id=t.artist_id LEFT JOIN albums al ON al.id=t.album_id LEFT JOIN podcasts pc ON pc.id=t.podcast_id`;
  const VIS = `(t.owner_id IS NULL OR t.owner_id = :u)`;
  const shape = t => ({ id: t.id, title: t.title, kind: t.kind, genre: t.genre, mood: t.mood, durationMs: t.duration_ms, demo: !!t.demo, mine: !!t.owner_id,
    trackNo: t.track_no, description: t.description, artist: t.artist || t.podcast || 'Unknown artist', artistId: t.artist_id, album: t.album || t.podcast || null, albumId: t.album_id,
    podcastId: t.podcast_id, cover: t.cover || '/media/covers/default.svg', hasLyrics: !!t.has_lyrics, fav: !!t.fav, url: `/api/tracks/${t.id}/stream` });
  const tracksWhere = (u, where = '1=1', extra = '', params = {}) =>
    db.raw.prepare(`${TRACK_SQL} WHERE ${VIS} AND (${where}) ${extra}`).all({ u: u?.id ?? '', ...params }).map(shape);
  const albumRow = a => ({ id: a.id, title: a.title, artist: a.artist, artistId: a.artist_id, year: a.year, cover: a.cover || '/media/covers/default.svg', demo: !!a.demo, releasedAt: a.released_at });
  const ALBUM_SQL = 'SELECT al.*, ar.name artist FROM albums al JOIN artists ar ON ar.id=al.artist_id';
  const albumVis = u => (u ? '(al.owner_id IS NULL OR al.owner_id=?)' : 'al.owner_id IS NULL');
  const albums = (u, where = '1=1', extra = '', ...p) => db.all(`${ALBUM_SQL} WHERE ${albumVis(u)} AND (${where}) ${extra}`, ...(u ? [u.id] : []), ...p).map(albumRow);
  const needTrack = (u, id) => { const t = tracksWhere(u, 't.id = :id', '', { id })[0]; if (!t) throw new HttpError(404, 'Track not found'); return t; };
  const playlistRow = p => ({ id: p.id, name: p.name, description: p.description, cover: p.cover_path, trackCount: p.n ?? undefined, updatedAt: p.updated_at, createdAt: p.created_at });
  const ownPlaylist = (u, id) => { const p = db.get('SELECT * FROM playlists WHERE id=? AND owner_id=?', id, u.id); if (!p) throw new HttpError(404, 'Playlist not found'); return p; };

  const playsSql = `(e.listened_ms >= 30000 OR e.completed = 1 OR e.listened_ms >= 0.5 * (SELECT duration_ms FROM tracks WHERE id = e.track_id))`;

  // ---------- config ----------
  add('GET', '/api/health', (c) => ({ ok: true, time: Date.now() }));
  add('GET', '/api/config', (c) => ({
    regions: REGIONS, moods: MOODS.map(([name, blurb]) => ({ name, blurb })),
    features: {
      catalog: { available: true, note: 'Demo catalogue (generated original audio) + audio you upload. No third-party streaming catalogue is connected.' },
      ai: { available: !!config.anthropicKey, note: config.anthropicKey ? 'Configured (server-side key).' : 'Set ANTHROPIC_API_KEY on the server to enable.' },
      lastfm: { available: !!(config.lastfmKey && config.lastfmSecret), note: config.lastfmKey ? 'Configured (not verified in CI).' : 'Set LASTFM_API_KEY and LASTFM_SHARED_SECRET to enable.' },
      recognition: { available: !!config.auddToken, note: config.auddToken ? 'Configured: AudD (not verified in CI).' : 'Set AUDD_API_TOKEN to enable a recognition provider.' },
      discord: { available: false, note: 'Discord Rich Presence needs a local desktop client; it cannot be done from a browser. Not implemented.' },
      youtube: { available: false, note: 'No YouTube provider shipped. Embedded playback would be limited by the provider (no DSP, no background playback).' }
    }
  }));

  // ---------- auth ----------
  const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
  add('POST', '/api/auth/signup', async (c) => {
    rateLimit('signup:' + ip(c.req), 20, 3600e3);
    const b = await readJson(c.req), email = clean(b.email, 254).toLowerCase(), name = clean(b.name, 60), pw = String(b.password || '');
    if (!EMAIL.test(email)) throw bad('Enter a valid email address.');
    if (!name) throw bad('Enter a display name.');
    if (pw.length < 8 || pw.length > 200) throw bad('Password must be at least 8 characters.');
    if (db.get('SELECT 1 x FROM users WHERE email=?', email)) throw new HttpError(409, 'An account with this email already exists.');
    const id = uid(); db.run('INSERT INTO users (id,email,name,pw_hash) VALUES (?,?,?,?)', id, email, name, await hashPassword(pw));
    c.cookie = startSession(c.req, c.res, id);
    return { user: { id, email, name } };
  });
  add('POST', '/api/auth/login', async (c) => {
    const b = await readJson(c.req), email = clean(b.email, 254).toLowerCase();
    rateLimit(`login:${ip(c.req)}:${email}`, 10, 600e3);
    const u = db.get('SELECT * FROM users WHERE email=?', email);
    if (!u || !(await verifyPassword(String(b.password || ''), u.pw_hash))) throw new HttpError(401, 'Incorrect email or password.');
    c.cookie = startSession(c.req, c.res, u.id);
    return { user: { id: u.id, email: u.email, name: u.name } };
  });
  add('POST', '/api/auth/logout', (c) => {
    const sid = parseCookies(c.req.headers.cookie)[COOKIE]; if (sid) db.run('DELETE FROM sessions WHERE id=?', sha256(sid));
    c.cookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`; return { ok: true };
  });
  add('GET', '/api/auth/me', (c) => ({ user: c.user ? { id: c.user.id, email: c.user.email, name: c.user.name } : null, prefs: c.user ? getPrefs(c.user.id) : null }));
  add('GET', '/api/auth/sessions', { auth: 1 }, (c) => ({ sessions: db.all('SELECT id,created_at,expires_at,user_agent FROM sessions WHERE user_id=? ORDER BY created_at DESC', c.user.id).map(s => ({ id: s.id.slice(0, 12), createdAt: s.created_at, expiresAt: s.expires_at, userAgent: s.user_agent, current: s.id === c.user.sid })) }));
  add('DELETE', '/api/auth/sessions/:id', { auth: 1 }, (c) => {
    const r = db.run("DELETE FROM sessions WHERE user_id=? AND substr(id,1,12)=? AND id != ?", c.user.id, c.params.id, c.user.sid); return { removed: Number(r.changes) };
  });
  add('PUT', '/api/account', { auth: 1 }, async (c) => {
    const b = await readJson(c.req);
    if (b.name !== undefined) { const n = clean(b.name, 60); if (!n) throw bad('Enter a display name.'); db.run('UPDATE users SET name=? WHERE id=?', n, c.user.id); }
    if (b.newPassword !== undefined) {
      const u = db.get('SELECT pw_hash FROM users WHERE id=?', c.user.id);
      if (!(await verifyPassword(String(b.password || ''), u.pw_hash))) throw new HttpError(401, 'Current password is incorrect.');
      if (String(b.newPassword).length < 8) throw bad('Password must be at least 8 characters.');
      db.run('UPDATE users SET pw_hash=? WHERE id=?', await hashPassword(String(b.newPassword)), c.user.id);
      db.run('DELETE FROM sessions WHERE user_id=? AND id != ?', c.user.id, c.user.sid);
    }
    return { ok: true };
  });
  add('GET', '/api/account/export', { auth: 1 }, (c) => {
    const u = c.user.id;
    c.headers = { 'Content-Disposition': 'attachment; filename="auralys-export.json"' };
    return {
      exportedAt: new Date().toISOString(), user: { id: u, email: c.user.email, name: c.user.name }, preferences: getPrefs(u),
      playlists: db.all('SELECT * FROM playlists WHERE owner_id=?', u).map(p => ({ ...p, tracks: db.all('SELECT track_id, position FROM playlist_tracks WHERE playlist_id=? ORDER BY position', p.id) })),
      favorites: db.all('SELECT track_id, created_at FROM favorites WHERE user_id=?', u), saved: db.all('SELECT kind, ref_id FROM saved_items WHERE user_id=?', u),
      listeningEvents: db.all('SELECT track_id, session_id, started_at, listened_ms, completed, source, region FROM listening_events WHERE user_id=?', u),
      playbackState: db.get('SELECT data FROM playback_state WHERE user_id=?', u)?.data ?? null,
      recognitionHistory: db.all('SELECT provider, matched, result, created_at FROM recognition_history WHERE user_id=?', u),
      uploads: db.all('SELECT id,title,duration_ms FROM tracks WHERE owner_id=?', u), rooms: db.all('SELECT id,name,created_at FROM rooms WHERE host_id=?', u)
    };
  });
  add('DELETE', '/api/account', { auth: 1 }, async (c) => {
    const b = await readJson(c.req); const u = db.get('SELECT pw_hash FROM users WHERE id=?', c.user.id);
    if (!(await verifyPassword(String(b.password || ''), u.pw_hash))) throw new HttpError(401, 'Password is incorrect.');
    for (const t of db.all('SELECT audio_path FROM tracks WHERE owner_id=?', c.user.id)) { try { unlinkSync(join(DATA_DIR, 'media', 'audio', t.audio_path)); } catch {} }
    for (const p of db.all('SELECT cover_path FROM playlists WHERE owner_id=? AND cover_path IS NOT NULL', c.user.id)) { try { unlinkSync(join(DATA_DIR, p.cover_path.replace(/^\//, ''))); } catch {} }
    db.run('DELETE FROM users WHERE id=?', c.user.id);
    c.cookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`; return { ok: true };
  });

  // ---------- preferences & state ----------
  add('GET', '/api/prefs', { auth: 1 }, (c) => getPrefs(c.user.id));
  add('PUT', '/api/prefs', { auth: 1 }, async (c) => {
    const b = await readJson(c.req, 20000); const merged = { ...getPrefs(c.user.id), ...b };
    db.run('INSERT INTO preferences (user_id,data,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at', c.user.id, JSON.stringify(merged), Date.now());
    return merged;
  });
  add('GET', '/api/state', { auth: 1 }, (c) => { const r = db.get('SELECT data,updated_at FROM playback_state WHERE user_id=?', c.user.id); return r ? { ...JSON.parse(r.data), updatedAt: r.updated_at } : {}; });
  add('PUT', '/api/state', { auth: 1 }, async (c) => {
    const b = await readJson(c.req, 65536);
    db.run('INSERT INTO playback_state (user_id,data,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at', c.user.id, JSON.stringify(b), Date.now()); return { ok: true };
  });

  // ---------- catalogue ----------
  add('GET', '/api/tracks/:id/stream', (c) => { streamTrack(c); c.handled = true; });
  function streamTrack(c) {
    const t = db.get('SELECT * FROM tracks WHERE id=? AND (owner_id IS NULL OR owner_id=?)', c.params.id, c.user?.id ?? '');
    if (!t) throw new HttpError(404, 'Track not found');
    const file = join(DATA_DIR, 'media', 'audio', t.audio_path); let st;
    try { st = statSync(file); } catch { throw new HttpError(404, 'Audio file is unavailable', 'unavailable'); }
    const range = /bytes=(\d*)-(\d*)/.exec(c.req.headers.range || ''); let start = 0, end = st.size - 1, status = 200;
    const h = { 'Content-Type': t.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
    if (range) { if (range[1]) start = +range[1]; if (range[2]) end = Math.min(+range[2], end); if (!range[1] && range[2]) { start = Math.max(0, st.size - +range[2]); end = st.size - 1; } if (start > end || start >= st.size) { c.res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return c.res.end(); } status = 206; h['Content-Range'] = `bytes ${start}-${end}/${st.size}`; }
    h['Content-Length'] = end - start + 1; c.res.writeHead(status, h);
    if (c.req.method === 'HEAD') return c.res.end();
    createReadStream(file, { start, end }).pipe(c.res);
  }
  add('GET', '/api/tracks/:id', (c) => needTrack(c.user, c.params.id));
  add('GET', '/api/tracks/:id/lyrics', (c) => {
    needTrack(c.user, c.params.id);
    const rows = db.all('SELECT provider,format,content FROM lyrics WHERE track_id=?', c.params.id);
    const order = { user: 0, embedded: 1, demo: 2 }; rows.sort((a, b) => (order[a.provider] ?? 9) - (order[b.provider] ?? 9));
    return { lyrics: rows, available: rows.length > 0 };
  });
  add('PUT', '/api/tracks/:id/lyrics', { auth: 1 }, async (c) => {
    const t = db.get('SELECT 1 x FROM tracks WHERE id=? AND owner_id=?', c.params.id, c.user.id); if (!t) throw new HttpError(403, 'You can only add lyrics to your own uploads.');
    const text = (await readBody(c.req, 100_000)).toString('utf8').replace(/\u0000/g, '').slice(0, 60000);
    if (!text.trim()) { db.run("DELETE FROM lyrics WHERE track_id=? AND provider='user'", c.params.id); return { ok: true }; }
    db.run("INSERT OR REPLACE INTO lyrics (track_id,provider,format,content) VALUES (?,?,?,?)", c.params.id, 'user', /\[\d+:\d+(\.\d+)?\]/.test(text) ? 'lrc' : 'plain', text);
    return { ok: true };
  });
  add('POST', '/api/tracks/upload', { auth: 1 }, async (c) => {
    rateLimit('upload:' + c.user.id, 30, 3600e3);
    const q = c.url.searchParams, body = await readBody(c.req, MAX_UPLOAD), mime = sniffAudio(body);
    if (!mime) throw bad('Unsupported or unrecognised audio file (MP3, WAV, FLAC, OGG, M4A).');
    const id = 'up_' + uid(8), title = clean(q.get('title'), 120) || 'Untitled', artistName = clean(q.get('artist'), 80) || 'Unknown artist', albumTitle = clean(q.get('album'), 80) || 'Singles';
    const dur = Math.max(0, Math.min(Math.round(+q.get('duration') || 0), 6 * 3600e3));
    const ext = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' }[mime];
    const file = `${id}.${ext}`; writeFileSync(join(DATA_DIR, 'media', 'audio', file), body);
    db.tx(() => {
      let ar = db.get('SELECT id FROM artists WHERE name=? AND owner_id=?', artistName, c.user.id);
      if (!ar) { ar = { id: 'ar_' + uid(6) }; db.run('INSERT INTO artists (id,name,owner_id) VALUES (?,?,?)', ar.id, artistName, c.user.id); }
      let al = db.get('SELECT id FROM albums WHERE title=? AND artist_id=? AND owner_id=?', albumTitle, ar.id, c.user.id);
      if (!al) { al = { id: 'al_' + uid(6) }; db.run('INSERT INTO albums (id,title,artist_id,year,owner_id) VALUES (?,?,?,?,?)', al.id, albumTitle, ar.id, new Date().getFullYear(), c.user.id); }
      db.run("INSERT INTO tracks (id,title,artist_id,album_id,kind,genre,mood,duration_ms,audio_path,mime,owner_id) VALUES (?,?,?,?,'song',?,?,?,?,?,?)", id, title, ar.id, al.id, clean(q.get('genre'), 40) || null, null, dur, file, mime, c.user.id);
    });
    return needTrack(c.user, id);
  });
  add('DELETE', '/api/tracks/:id', { auth: 1 }, (c) => {
    const t = db.get('SELECT audio_path FROM tracks WHERE id=? AND owner_id=?', c.params.id, c.user.id); if (!t) throw new HttpError(404, 'Upload not found');
    db.run('DELETE FROM tracks WHERE id=?', c.params.id); try { unlinkSync(join(DATA_DIR, 'media', 'audio', t.audio_path)); } catch {}
    return { ok: true };
  });

  add('GET', '/api/albums/:id', (c) => {
    const [al] = albums(c.user, 'al.id = ?', '', c.params.id); if (!al) throw new HttpError(404, 'Album not found');
    const saved = c.user ? !!db.get("SELECT 1 x FROM saved_items WHERE user_id=? AND kind='album' AND ref_id=?", c.user.id, al.id) : false;
    return { ...al, saved, tracks: tracksWhere(c.user, 't.album_id = :id', 'ORDER BY t.track_no, t.title', { id: al.id }) };
  });
  add('GET', '/api/artists/:id', (c) => {
    const a = db.get('SELECT * FROM artists WHERE id=? AND (owner_id IS NULL OR owner_id=?)', c.params.id, c.user?.id ?? ''); if (!a) throw new HttpError(404, 'Artist not found');
    const top = db.raw.prepare(`SELECT t.id, COUNT(e.id) n FROM tracks t LEFT JOIN listening_events e ON e.track_id=t.id AND ${playsSql} WHERE t.artist_id=? GROUP BY t.id ORDER BY n DESC, t.title LIMIT 8`).all(a.id).map(r => r.id);
    const ts = tracksWhere(c.user, 't.artist_id = :id', '', { id: a.id }); const byId = new Map(ts.map(t => [t.id, t]));
    return { id: a.id, name: a.name, bio: a.bio, cover: a.cover || '/media/covers/default.svg', demo: !!a.demo, saved: c.user ? !!db.get("SELECT 1 x FROM saved_items WHERE user_id=? AND kind='artist' AND ref_id=?", c.user.id, a.id) : false,
      topTracks: top.map(i => byId.get(i)).filter(Boolean), albums: albums(c.user, 'al.artist_id = ?', 'ORDER BY al.released_at DESC', a.id) };
  });
  const podcastRow = p => ({ id: p.id, title: p.title, host: p.host, description: p.description, cover: p.cover || '/media/covers/default.svg', demo: !!p.demo });
  add('GET', '/api/podcasts', (c) => ({ podcasts: db.all('SELECT * FROM podcasts ORDER BY title').map(podcastRow) }));
  add('GET', '/api/podcasts/:id', (c) => {
    const p = db.get('SELECT * FROM podcasts WHERE id=?', c.params.id); if (!p) throw new HttpError(404, 'Podcast not found');
    return { ...podcastRow(p), saved: c.user ? !!db.get("SELECT 1 x FROM saved_items WHERE user_id=? AND kind='podcast' AND ref_id=?", c.user.id, p.id) : false, episodes: tracksWhere(c.user, 't.podcast_id = :id', 'ORDER BY t.track_no', { id: p.id }) };
  });
  add('GET', '/api/new-releases', (c) => ({ albums: albums(c.user, '1=1', 'ORDER BY al.released_at DESC LIMIT 30') }));
  add('GET', '/api/moods', (c) => ({ moods: MOODS.map(([name, blurb]) => ({ name, blurb, count: db.get('SELECT COUNT(*) n FROM tracks t WHERE mood=? AND t.owner_id IS NULL', name).n })) }));
  add('GET', '/api/moods/:name', (c) => ({ name: c.params.name, tracks: tracksWhere(c.user, 't.mood = :m AND t.kind = \'song\'', 'ORDER BY t.title', { m: decodeURIComponent(c.params.name) }) }));
  add('GET', '/api/genres', (c) => ({ genres: db.all("SELECT genre name, COUNT(*) count FROM tracks WHERE genre IS NOT NULL AND kind='song' AND owner_id IS NULL GROUP BY genre ORDER BY count DESC") }));
  add('GET', '/api/genres/:name', (c) => ({ name: c.params.name, tracks: tracksWhere(c.user, 't.genre = :g AND t.kind = \'song\'', 'ORDER BY t.title', { g: decodeURIComponent(c.params.name) }) }));
  add('GET', '/api/charts', (c) => {
    const region = REGIONS.find(r => r[0] === (c.url.searchParams.get('region') || 'global'))?.[0] || 'global', since = Date.now() - 30 * 864e5;
    const rows = db.raw.prepare(`SELECT e.track_id id, COUNT(*) plays, COUNT(DISTINCT e.user_id) listeners FROM listening_events e JOIN tracks t ON t.id=e.track_id
      WHERE t.owner_id IS NULL AND t.kind='song' AND e.started_at >= ? AND ${playsSql} ${region === 'global' ? '' : 'AND e.region = ?'} GROUP BY e.track_id ORDER BY plays DESC, listeners DESC LIMIT 25`).all(since, ...(region === 'global' ? [] : [region]));
    const ts = tracksWhere(c.user, 't.owner_id IS NULL', '', {}); const by = new Map(ts.map(t => [t.id, t]));
    return { region, windowDays: 30, empty: rows.length === 0, note: 'Charts are computed from listening on this server only, not from a global service.',
      entries: rows.map((r, i) => ({ rank: i + 1, plays: r.plays, listeners: r.listeners, track: by.get(r.id) })).filter(e => e.track) };
  });
  add('GET', '/api/radio', (c) => {
    const seed = c.url.searchParams.get('seed'); const ex = new Set((c.url.searchParams.get('exclude') || '').split(',').filter(Boolean));
    const s = seed ? tracksWhere(c.user, 't.id = :id', '', { id: seed })[0] : null;
    const pool = tracksWhere(c.user, "t.kind='song' AND t.owner_id IS NULL").filter(t => !ex.has(t.id) && t.id !== seed);
    const score = t => (s && t.mood === s.mood ? 2 : 0) + (s && t.genre === s.genre ? 2 : 0) + (s && t.artistId === s.artistId ? 1 : 0) + Math.random() * 1.5;
    return { seed: s, tracks: pool.map(t => [score(t), t]).sort((a, b) => b[0] - a[0]).slice(0, 15).map(x => x[1]) };
  });
  add('GET', '/api/home', (c) => {
    const u = c.user, all = tracksWhere(u, "t.kind='song' AND t.owner_id IS NULL", 'ORDER BY t.id');
    let recent = [], quick = all.slice(0, 8), top = [];
    if (u) {
      const ids = db.all('SELECT track_id, MAX(started_at) m FROM listening_events WHERE user_id=? GROUP BY track_id ORDER BY m DESC LIMIT 12', u.id).map(r => r.track_id);
      recent = ids.map(id => tracksWhere(u, 't.id=:id', '', { id })[0]).filter(Boolean);
      top = db.all(`SELECT e.track_id, COUNT(*) n FROM listening_events e WHERE e.user_id=? AND ${playsSql} GROUP BY e.track_id ORDER BY n DESC LIMIT 8`, u.id).map(r => r.track_id);
      if (top.length) { const seen = new Set(top); quick = [...top.map(id => tracksWhere(u, 't.id=:id', '', { id })[0]).filter(Boolean), ...all.filter(t => !seen.has(t.id))].slice(0, 8); }
    }
    const mixes = MOODS.map(([name]) => ({ id: name, title: `${name} Mix`, mood: name, tracks: all.filter(t => t.mood === name) })).filter(m => m.tracks.length);
    const genres = [...new Set(all.map(t => t.genre))].map(g => ({ name: g, seed: all.find(t => t.genre === g).id }));
    return { personalized: !!(u && top.length), quickPicks: quick, recent, mixes, newReleases: albums(u, '1=1', 'ORDER BY al.released_at DESC LIMIT 10'), stations: genres,
      editorial: all.length ? [{ title: 'Slow listening', kicker: 'Editor’s note', body: 'Four demo albums, built to be left running while the light changes. Start with Terracotta Hours.', albumId: 'al_th' }, { title: 'Rain on the window', kicker: 'Focus', body: 'Slow Weather is for the hours when nothing needs to be loud.', albumId: 'al_sw' }] : [] };
  });

  // ---------- search ----------
  add('GET', '/api/search', (c) => {
    const q = clean(c.url.searchParams.get('q'), 80), type = c.url.searchParams.get('type') || 'all'; if (!q) return { q, tracks: [], albums: [], artists: [], playlists: [], podcasts: [] };
    const like = `%${esc(q)}%`, want = k => type === 'all' || type === k;
    return {
      q,
      tracks: want('tracks') ? tracksWhere(c.user, `t.kind='song' AND (t.title LIKE :l ESCAPE '\\' OR ar.name LIKE :l ESCAPE '\\' OR al.title LIKE :l ESCAPE '\\' OR t.genre LIKE :l ESCAPE '\\' OR t.mood LIKE :l ESCAPE '\\')`, 'ORDER BY (t.title LIKE :s) DESC, t.title LIMIT 30', { l: like, s: `${esc(q)}%` }) : [],
      albums: want('albums') ? albums(c.user, `al.title LIKE ? ESCAPE '\\' OR ar.name LIKE ? ESCAPE '\\'`, 'LIMIT 20', like, like) : [],
      artists: want('artists') ? db.all(`SELECT id,name,cover FROM artists WHERE name LIKE ? ESCAPE '\\' AND (owner_id IS NULL OR owner_id=?) LIMIT 20`, like, c.user?.id ?? '').map(a => ({ id: a.id, name: a.name, cover: a.cover || '/media/covers/default.svg' })) : [],
      playlists: want('playlists') && c.user ? db.all(`SELECT * FROM playlists WHERE owner_id=? AND name LIKE ? ESCAPE '\\' LIMIT 20`, c.user.id, like).map(playlistRow) : [],
      podcasts: want('podcasts') ? [...db.all(`SELECT * FROM podcasts WHERE title LIKE ? ESCAPE '\\' OR host LIKE ? ESCAPE '\\'`, like, like).map(podcastRow)] : [],
      episodes: want('podcasts') ? tracksWhere(c.user, `t.kind='episode' AND t.title LIKE :l ESCAPE '\\'`, 'LIMIT 20', { l: like }) : []
    };
  });
  add('GET', '/api/suggest', (c) => {
    const q = clean(c.url.searchParams.get('q'), 60); if (!q) return { suggestions: [] }; const like = `%${esc(q)}%`, u = c.user?.id ?? '';
    const out = [...db.all(`SELECT title s FROM tracks WHERE title LIKE ? ESCAPE '\\' AND (owner_id IS NULL OR owner_id=?) LIMIT 5`, like, u), ...db.all(`SELECT name s FROM artists WHERE name LIKE ? ESCAPE '\\' AND (owner_id IS NULL OR owner_id=?) LIMIT 3`, like, u), ...db.all(`SELECT title s FROM albums WHERE title LIKE ? ESCAPE '\\' AND (owner_id IS NULL OR owner_id=?) LIMIT 3`, like, u)].map(r => r.s);
    return { suggestions: [...new Set(out)].slice(0, 8) };
  });

  // ---------- library ----------
  const LIB_SONGS = `t.kind='song' AND (t.owner_id = :u OR t.id IN (SELECT track_id FROM favorites WHERE user_id=:u)
    OR t.album_id IN (SELECT ref_id FROM saved_items WHERE user_id=:u AND kind='album') OR t.artist_id IN (SELECT ref_id FROM saved_items WHERE user_id=:u AND kind='artist')
    OR t.id IN (SELECT pt.track_id FROM playlist_tracks pt JOIN playlists p ON p.id=pt.playlist_id WHERE p.owner_id=:u))`;
  add('GET', '/api/library/songs', { auth: 1 }, (c) => ({ tracks: tracksWhere(c.user, LIB_SONGS, 'ORDER BY t.title') }));
  add('GET', '/api/library/favorites', { auth: 1 }, (c) => ({ tracks: tracksWhere(c.user, 't.id IN (SELECT track_id FROM favorites WHERE user_id=:u)', 'ORDER BY (SELECT created_at FROM favorites WHERE track_id=t.id AND user_id=:u) DESC') }));
  add('GET', '/api/library/albums', { auth: 1 }, (c) => ({ albums: albums(c.user, `al.owner_id = ? OR al.id IN (SELECT ref_id FROM saved_items WHERE user_id=? AND kind='album') OR al.id IN (SELECT album_id FROM tracks WHERE id IN (SELECT track_id FROM favorites WHERE user_id=?))`, 'ORDER BY al.title', c.user.id, c.user.id) }));
  add('GET', '/api/library/artists', { auth: 1 }, (c) => ({ artists: db.all(`SELECT id,name,cover FROM artists WHERE owner_id=? OR id IN (SELECT ref_id FROM saved_items WHERE user_id=? AND kind='artist') ORDER BY name`, c.user.id, c.user.id).map(a => ({ id: a.id, name: a.name, cover: a.cover || '/media/covers/default.svg' })) }));
  add('GET', '/api/library/podcasts', { auth: 1 }, (c) => ({ podcasts: db.all(`SELECT * FROM podcasts WHERE id IN (SELECT ref_id FROM saved_items WHERE user_id=? AND kind='podcast') ORDER BY title`, c.user.id).map(podcastRow) }));
  add('GET', '/api/library/playlists', { auth: 1 }, (c) => ({ playlists: db.all('SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id=p.id) n FROM playlists p WHERE owner_id=? ORDER BY updated_at DESC', c.user.id).map(playlistRow) }));
  add('GET', '/api/library/top', { auth: 1 }, (c) => {
    const rows = db.all(`SELECT e.track_id id, COUNT(*) n FROM listening_events e WHERE e.user_id=? AND ${playsSql} GROUP BY e.track_id ORDER BY n DESC LIMIT 10`, c.user.id);
    return { tracks: rows.map(r => ({ ...tracksWhere(c.user, 't.id=:id', '', { id: r.id })[0], plays: r.n })).filter(t => t.id) };
  });
  add('GET', '/api/library/ids', { auth: 1 }, (c) => ({ favorites: db.all('SELECT track_id id FROM favorites WHERE user_id=?', c.user.id).map(r => r.id), saved: db.all('SELECT kind, ref_id FROM saved_items WHERE user_id=?', c.user.id) }));
  add('PUT', '/api/favorites/:id', { auth: 1 }, (c) => { needTrack(c.user, c.params.id); db.run('INSERT OR IGNORE INTO favorites (user_id,track_id,created_at) VALUES (?,?,?)', c.user.id, c.params.id, Date.now()); return { fav: true }; });
  add('DELETE', '/api/favorites/:id', { auth: 1 }, (c) => { db.run('DELETE FROM favorites WHERE user_id=? AND track_id=?', c.user.id, c.params.id); return { fav: false }; });
  add('PUT', '/api/saved/:kind/:id', { auth: 1 }, (c) => {
    const { kind, id } = c.params; if (!['album', 'artist', 'podcast'].includes(kind)) throw bad('Bad kind');
    const tbl = { album: 'albums', artist: 'artists', podcast: 'podcasts' }[kind]; if (!db.get(`SELECT 1 x FROM ${tbl} WHERE id=?`, id)) throw new HttpError(404, 'Not found');
    db.run('INSERT OR IGNORE INTO saved_items (user_id,kind,ref_id,created_at) VALUES (?,?,?,?)', c.user.id, kind, id, Date.now()); return { saved: true };
  });
  add('DELETE', '/api/saved/:kind/:id', { auth: 1 }, (c) => { db.run('DELETE FROM saved_items WHERE user_id=? AND kind=? AND ref_id=?', c.user.id, c.params.kind, c.params.id); return { saved: false }; });

  // ---------- playlists ----------
  const playlistFull = (u, p) => ({ ...playlistRow(p), tracks: tracksWhere(u, 't.id IN (SELECT track_id FROM playlist_tracks WHERE playlist_id = :p)', 'ORDER BY (SELECT position FROM playlist_tracks WHERE playlist_id=:p AND track_id=t.id)', { p: p.id }) });
  const touch = id => db.run('UPDATE playlists SET updated_at=? WHERE id=?', Date.now(), id);
  const addTracks = (u, pid, ids) => {
    let pos = (db.get('SELECT COALESCE(MAX(position),-1) m FROM playlist_tracks WHERE playlist_id=?', pid).m) + 1, n = 0;
    for (const id of ids) { if (!tracksWhere(u, 't.id=:id', '', { id }).length) continue; const r = db.run('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)', pid, id, pos, Date.now()); if (r.changes) { pos++; n++; } }
    touch(pid); return n;
  };
  add('POST', '/api/playlists', { auth: 1 }, async (c) => {
    const b = await readJson(c.req), name = clean(b.name, 80); if (!name) throw bad('Give the playlist a name.');
    if (db.get('SELECT COUNT(*) n FROM playlists WHERE owner_id=?', c.user.id).n >= 200) throw bad('Playlist limit reached.');
    const id = 'pl_' + uid(7), now = Date.now(); db.run('INSERT INTO playlists (id,owner_id,name,description,created_at,updated_at) VALUES (?,?,?,?,?,?)', id, c.user.id, name, clean(b.description, 300) || null, now, now);
    if (Array.isArray(b.trackIds)) addTracks(c.user, id, b.trackIds.slice(0, 500).map(String));
    return playlistFull(c.user, ownPlaylist(c.user, id));
  });
  add('GET', '/api/playlists/:id', { auth: 1 }, (c) => playlistFull(c.user, ownPlaylist(c.user, c.params.id)));
  add('PUT', '/api/playlists/:id', { auth: 1 }, async (c) => {
    const p = ownPlaylist(c.user, c.params.id), b = await readJson(c.req);
    const name = b.name !== undefined ? clean(b.name, 80) : p.name; if (!name) throw bad('Give the playlist a name.');
    db.run('UPDATE playlists SET name=?, description=?, updated_at=? WHERE id=?', name, b.description !== undefined ? clean(b.description, 300) || null : p.description, Date.now(), p.id);
    return playlistFull(c.user, ownPlaylist(c.user, p.id));
  });
  add('DELETE', '/api/playlists/:id', { auth: 1 }, (c) => { const p = ownPlaylist(c.user, c.params.id); if (p.cover_path) try { unlinkSync(join(DATA_DIR, p.cover_path.replace(/^\//, ''))); } catch {} db.run('DELETE FROM playlists WHERE id=?', p.id); return { ok: true }; });
  add('POST', '/api/playlists/:id/tracks', { auth: 1 }, async (c) => {
    const p = ownPlaylist(c.user, c.params.id), b = await readJson(c.req);
    if (!Array.isArray(b.trackIds)) throw bad('trackIds required'); return { added: addTracks(c.user, p.id, b.trackIds.slice(0, 500).map(String)) };
  });
  add('DELETE', '/api/playlists/:id/tracks/:trackId', { auth: 1 }, (c) => {
    const p = ownPlaylist(c.user, c.params.id); db.run('DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?', p.id, c.params.trackId);
    db.all('SELECT track_id FROM playlist_tracks WHERE playlist_id=? ORDER BY position', p.id).forEach((r, i) => db.run('UPDATE playlist_tracks SET position=? WHERE playlist_id=? AND track_id=?', i, p.id, r.track_id)); touch(p.id); return { ok: true };
  });
  add('PUT', '/api/playlists/:id/order', { auth: 1 }, async (c) => {
    const p = ownPlaylist(c.user, c.params.id), b = await readJson(c.req); const cur = db.all('SELECT track_id FROM playlist_tracks WHERE playlist_id=?', p.id).map(r => r.track_id);
    if (!Array.isArray(b.trackIds) || b.trackIds.length !== cur.length || !b.trackIds.every(id => cur.includes(id)) || new Set(b.trackIds).size !== cur.length) throw bad('Order must contain exactly the playlist tracks.');
    db.tx(() => b.trackIds.forEach((id, i) => db.run('UPDATE playlist_tracks SET position=? WHERE playlist_id=? AND track_id=?', i, p.id, id))); touch(p.id); return { ok: true };
  });
  add('PUT', '/api/playlists/:id/cover', { auth: 1 }, async (c) => {
    const p = ownPlaylist(c.user, c.params.id), body = await readBody(c.req, 2_000_000), kind = sniffImage(body); if (!kind) throw bad('Cover must be a PNG, JPEG or WebP image under 2 MB.');
    const name = `pl_${p.id}_${uid(4)}.${kind[1]}`; writeFileSync(join(DATA_DIR, 'media', 'covers', name), body);
    if (p.cover_path) try { unlinkSync(join(DATA_DIR, p.cover_path.replace(/^\//, ''))); } catch {}
    db.run('UPDATE playlists SET cover_path=?, updated_at=? WHERE id=?', `/media/covers/${name}`, Date.now(), p.id); return { cover: `/media/covers/${name}` };
  });
  add('DELETE', '/api/playlists/:id/cover', { auth: 1 }, (c) => { const p = ownPlaylist(c.user, c.params.id); if (p.cover_path) try { unlinkSync(join(DATA_DIR, p.cover_path.replace(/^\//, ''))); } catch {} db.run('UPDATE playlists SET cover_path=NULL WHERE id=?', p.id); return { ok: true }; });
  const csvCell = s => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  add('GET', '/api/playlists/:id/export', { auth: 1 }, (c) => {
    const p = playlistFull(c.user, ownPlaylist(c.user, c.params.id));
    c.raw = ['title,artist,album,duration_seconds', ...p.tracks.map(t => [t.title, t.artist, t.album || '', Math.round(t.durationMs / 1000)].map(x => csvCell(String(x))).join(','))].join('\n');
    c.rawType = 'text/csv; charset=utf-8'; c.headers = { 'Content-Disposition': `attachment; filename="${p.name.replace(/[^\w.-]+/g, '_')}.csv"` };
  });
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) { const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
    if (cell || row.length) { row.push(cell); rows.push(row); } return rows.filter(r => r.some(x => x.trim()));
  }
  add('POST', '/api/playlists/:id/import', { auth: 1 }, async (c) => {
    const p = ownPlaylist(c.user, c.params.id), rows = parseCsv((await readBody(c.req, 500_000)).toString('utf8')).slice(0, 1001);
    const head = rows[0]?.map(x => x.trim().toLowerCase()) || []; const hasHead = head.includes('title'); const ti = hasHead ? head.indexOf('title') : 0, ai = hasHead ? head.indexOf('artist') : 1;
    const matched = [], missing = [];
    for (const r of rows.slice(hasHead ? 1 : 0)) {
      const title = clean(r[ti], 120), artist = clean(r[ai] ?? '', 80); if (!title) continue;
      const t = tracksWhere(c.user, `t.kind='song' AND t.title = :t COLLATE NOCASE AND (:a = '' OR ar.name = :a COLLATE NOCASE)`, 'LIMIT 1', { t: title, a: artist })[0];
      t ? matched.push(t.id) : missing.push(`${title}${artist ? ' — ' + artist : ''}`);
    }
    return { added: addTracks(c.user, p.id, matched), matched: matched.length, missing: missing.slice(0, 50), missingCount: missing.length };
  });

  // ---------- history & stats ----------
  add('POST', '/api/events', { auth: 1 }, async (c) => {
    const b = await readJson(c.req, 4000), sid = clean(b.sid, 64), tid = String(b.trackId || '');
    if (!sid) throw bad('sid required'); const prefs = getPrefs(c.user.id); if (prefs.privacy?.history === false) return { recorded: false };
    const t = db.get('SELECT duration_ms FROM tracks WHERE id=? AND (owner_id IS NULL OR owner_id=?)', tid, c.user.id); if (!t) throw new HttpError(404, 'Track not found');
    const ms = Math.max(0, Math.min(Math.round(+b.listenedMs || 0), Math.max(t.duration_ms * 3, 60000)));
    const region = REGIONS.some(r => r[0] === prefs.region && r[0] !== 'global') ? prefs.region : null;
    db.run(`INSERT INTO listening_events (user_id,track_id,session_id,started_at,listened_ms,completed,source,region) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,session_id) DO UPDATE SET listened_ms=MAX(listened_ms,excluded.listened_ms), completed=MAX(completed,excluded.completed)`,
      c.user.id, tid, sid, Math.min(Number(b.startedAt) || Date.now(), Date.now()), ms, b.completed ? 1 : 0, clean(b.source, 20) || 'catalog', region);
    return { recorded: true };
  });
  add('GET', '/api/history', { auth: 1 }, (c) => {
    const rows = db.all('SELECT track_id, started_at, listened_ms, completed FROM listening_events WHERE user_id=? ORDER BY started_at DESC LIMIT 200', c.user.id);
    return { items: rows.map(r => ({ track: tracksWhere(c.user, 't.id=:id', '', { id: r.track_id })[0], startedAt: r.started_at, listenedMs: r.listened_ms, completed: !!r.completed })).filter(x => x.track) };
  });
  add('DELETE', '/api/history', { auth: 1 }, (c) => ({ removed: Number(db.run('DELETE FROM listening_events WHERE user_id=?', c.user.id).changes) }));
  add('GET', '/api/stats', { auth: 1 }, (c) => {
    const range = c.url.searchParams.get('range') || '30d', days = { '7d': 7, '30d': 30, '365d': 365, all: 36500 }[range] ?? 30, since = Date.now() - days * 864e5, u = c.user.id;
    const base = `FROM listening_events e JOIN tracks t ON t.id=e.track_id LEFT JOIN artists ar ON ar.id=t.artist_id LEFT JOIN albums al ON al.id=t.album_id WHERE e.user_id=? AND e.started_at>=?`;
    const tot = db.get(`SELECT COALESCE(SUM(e.listened_ms),0) ms, COUNT(*) sessions, COALESCE(SUM(CASE WHEN ${playsSql} THEN 1 ELSE 0 END),0) plays ${base}`, u, since);
    const topT = db.all(`SELECT t.id, COUNT(*) plays, SUM(e.listened_ms) ms ${base} AND ${playsSql} GROUP BY t.id ORDER BY plays DESC, ms DESC LIMIT 10`, u, since);
    const topAr = db.all(`SELECT ar.id, ar.name, ar.cover, COUNT(*) plays, SUM(e.listened_ms) ms ${base} AND ${playsSql} AND ar.id IS NOT NULL GROUP BY ar.id ORDER BY plays DESC, ms DESC LIMIT 8`, u, since);
    const topAl = db.all(`SELECT al.id, al.title, al.cover, ar.name artist, COUNT(*) plays, SUM(e.listened_ms) ms ${base} AND ${playsSql} AND al.id IS NOT NULL GROUP BY al.id ORDER BY plays DESC, ms DESC LIMIT 8`, u, since);
    const daily = db.all(`SELECT strftime('%Y-%m-%d', e.started_at/1000, 'unixepoch') day, SUM(e.listened_ms) ms ${base} GROUP BY day ORDER BY day`, u, since);
    const moods = db.all(`SELECT COALESCE(t.mood,'Other') name, SUM(e.listened_ms) ms ${base} GROUP BY name ORDER BY ms DESC`, u, since);
    return { range, totalMs: tot.ms, sessions: tot.sessions, plays: tot.plays,
      topTracks: topT.map(r => ({ track: tracksWhere(c.user, 't.id=:id', '', { id: r.id })[0], plays: r.plays, ms: r.ms })).filter(x => x.track),
      topArtists: topAr.map(r => ({ id: r.id, name: r.name, cover: r.cover || '/media/covers/default.svg', plays: r.plays, ms: r.ms })),
      topAlbums: topAl.map(r => ({ id: r.id, title: r.title, artist: r.artist, cover: r.cover || '/media/covers/default.svg', plays: r.plays, ms: r.ms })),
      daily, moods };
  });

  // ---------- rooms ----------
  add('POST', '/api/rooms', { auth: 1 }, async (c) => {
    const b = await readJson(c.req), name = clean(b.name, 60) || `${c.user.name}'s room`; rateLimit('room:' + c.user.id, 20, 3600e3);
    const id = uid(6), code = uid(6), now = Date.now();
    db.tx(() => { db.run('INSERT INTO rooms (id,host_id,name,invite_code,state,created_at) VALUES (?,?,?,?,?,?)', id, c.user.id, name, code, JSON.stringify({ queue: [], index: -1, playing: false, pos: 0, at: now, v: 0 }), now); db.run("INSERT INTO room_members VALUES (?,?,'host',?)", id, c.user.id, now); });
    return { id, name, inviteCode: code, role: 'host' };
  });
  add('GET', '/api/rooms', { auth: 1 }, (c) => ({ rooms: db.all('SELECT r.id,r.name,r.closed_at,m.role,r.host_id FROM room_members m JOIN rooms r ON r.id=m.room_id WHERE m.user_id=? AND r.closed_at IS NULL ORDER BY r.created_at DESC LIMIT 20', c.user.id) }));
  add('GET', '/api/rooms/:id', { auth: 1 }, (c) => {
    const r = db.get('SELECT * FROM rooms WHERE id=?', c.params.id); if (!r) throw new HttpError(404, 'Room not found'); const m = db.get('SELECT role FROM room_members WHERE room_id=? AND user_id=?', r.id, c.user.id);
    return { id: r.id, name: r.name, closed: !!r.closed_at, member: !!m, role: m?.role ?? null, inviteCode: m?.role === 'host' ? r.invite_code : undefined, membersCanQueue: !!r.members_can_queue };
  });
  add('POST', '/api/rooms/:id/join', { auth: 1 }, async (c) => {
    rateLimit('join:' + c.user.id, 30, 600e3); const b = await readJson(c.req), r = db.get('SELECT * FROM rooms WHERE id=?', c.params.id);
    if (!r || r.closed_at) throw new HttpError(404, 'This room is closed or does not exist.');
    const m = db.get('SELECT role FROM room_members WHERE room_id=? AND user_id=?', r.id, c.user.id);
    if (!m) { if (String(b.code || '') !== r.invite_code) throw new HttpError(403, 'Invite code is invalid.'); db.run("INSERT INTO room_members VALUES (?,?,'member',?)", r.id, c.user.id, Date.now()); }
    return { id: r.id, name: r.name, role: m?.role ?? 'member' };
  });
  add('PUT', '/api/rooms/:id', { auth: 1 }, async (c) => {
    const r = db.get('SELECT * FROM rooms WHERE id=? AND host_id=?', c.params.id, c.user.id); if (!r) throw new HttpError(403, 'Only the host can change room settings.');
    const b = await readJson(c.req); if (b.membersCanQueue !== undefined) db.run('UPDATE rooms SET members_can_queue=? WHERE id=?', b.membersCanQueue ? 1 : 0, r.id); rooms?.refresh(r.id); return { ok: true };
  });
  add('POST', '/api/rooms/:id/close', { auth: 1 }, (c) => {
    const r = db.get('SELECT * FROM rooms WHERE id=? AND host_id=?', c.params.id, c.user.id); if (!r) throw new HttpError(403, 'Only the host can close the room.');
    db.run('UPDATE rooms SET closed_at=? WHERE id=?', Date.now(), r.id); rooms?.close(r.id); return { ok: true };
  });

  // ---------- recognition ----------
  add('GET', '/api/recognize/history', { auth: 1 }, (c) => ({ items: db.all('SELECT id,provider,matched,result,created_at FROM recognition_history WHERE user_id=? ORDER BY created_at DESC LIMIT 50', c.user.id).map(r => ({ ...r, result: r.result ? JSON.parse(r.result) : null })) }));
  add('DELETE', '/api/recognize/history', { auth: 1 }, (c) => { db.run('DELETE FROM recognition_history WHERE user_id=?', c.user.id); return { ok: true }; });
  add('POST', '/api/recognize', { auth: 1 }, async (c) => {
    rateLimit('recog:' + c.user.id, 20, 3600e3);
    if (!config.auddToken) throw new HttpError(501, 'No recognition provider is configured on this server. Set AUDD_API_TOKEN to enable one.', 'not_configured');
    const body = await readBody(c.req, 3_000_000); if (body.length < 2000) throw bad('Sample too short.');
    const fd = new FormData(); fd.append('api_token', config.auddToken); fd.append('file', new Blob([body], { type: c.req.headers['content-type'] || 'audio/webm' }), 'sample.webm');
    let j; try { j = await (await fetch('https://api.audd.io/', { method: 'POST', body: fd, signal: AbortSignal.timeout(20000) })).json(); } catch { throw new HttpError(502, 'The recognition service could not be reached.', 'provider_error'); }
    const r = j?.result ? { title: clean(j.result.title, 120), artist: clean(j.result.artist, 120), album: clean(j.result.album, 120) } : null;
    db.run('INSERT INTO recognition_history (user_id,provider,matched,result,created_at) VALUES (?,?,?,?,?)', c.user.id, 'audd', r ? 1 : 0, r ? JSON.stringify(r) : null, Date.now());
    return { matched: !!r, result: r };
  });

  // ---------- integrations ----------
  add('GET', '/api/integrations', { auth: 1 }, (c) => ({ lastfm: { configured: !!(config.lastfmKey && config.lastfmSecret), connected: !!db.get("SELECT 1 x FROM integrations WHERE user_id=? AND provider='lastfm'", c.user.id), username: (() => { const r = db.get("SELECT data FROM integrations WHERE user_id=? AND provider='lastfm'", c.user.id); return r ? JSON.parse(r.data).name : null; })() }, discord: { configured: false, connected: false } }));
  const lfSig = (p) => createHash('md5').update(Object.keys(p).sort().map(k => k + p[k]).join('') + config.lastfmSecret).digest('hex');
  const lfCall = async (params) => { const p = { ...params, api_key: config.lastfmKey }; p.api_sig = lfSig(p); p.format = 'json'; return (await fetch('https://ws.audioscrobbler.com/2.0/', { method: 'POST', body: new URLSearchParams(p), signal: AbortSignal.timeout(15000) })).json(); };
  add('POST', '/api/integrations/lastfm/connect', { auth: 1 }, (c) => {
    if (!config.lastfmKey) throw new HttpError(501, 'Last.fm is not configured on this server.', 'not_configured');
    const state = uid(16); db.run('DELETE FROM oauth_states WHERE expires_at < ?', Date.now()); db.run('INSERT INTO oauth_states VALUES (?,?,?,?)', state, c.user.id, 'lastfm', Date.now() + 600e3);
    return { url: `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(config.lastfmKey)}&cb=${encodeURIComponent(`${config.publicUrl}/api/integrations/lastfm/callback?state=${state}`)}` };
  });
  add('GET', '/api/integrations/lastfm/callback', { auth: 1 }, async (c) => {
    const st = db.get("SELECT * FROM oauth_states WHERE state=? AND provider='lastfm'", c.url.searchParams.get('state') || '');
    if (!st || st.expires_at < Date.now() || st.user_id !== c.user.id) throw new HttpError(400, 'Invalid or expired OAuth state.'); db.run('DELETE FROM oauth_states WHERE state=?', st.state);
    const j = await lfCall({ method: 'auth.getSession', token: c.url.searchParams.get('token') || '' }); if (!j.session) throw new HttpError(502, 'Last.fm did not return a session.');
    db.run("INSERT OR REPLACE INTO integrations VALUES (?,?,?,?)", c.user.id, 'lastfm', JSON.stringify({ key: j.session.key, name: j.session.name }), Date.now());
    c.redirect = '/settings/integrations?lastfm=connected';
  });
  add('DELETE', '/api/integrations/lastfm', { auth: 1 }, (c) => { db.run("DELETE FROM integrations WHERE user_id=? AND provider='lastfm'", c.user.id); return { ok: true }; });
  add('POST', '/api/integrations/lastfm/scrobble', { auth: 1 }, async (c) => {
    const b = await readJson(c.req), i = db.get("SELECT data FROM integrations WHERE user_id=? AND provider='lastfm'", c.user.id); if (!i || !config.lastfmKey) return { scrobbled: false };
    const t = needTrack(c.user, String(b.trackId)); if (t.kind !== 'song') return { scrobbled: false };
    const j = await lfCall({ method: 'track.scrobble', artist: t.artist, track: t.title, timestamp: String(Math.floor((+b.startedAt || Date.now()) / 1000)), sk: JSON.parse(i.data).key }); return { scrobbled: !j.error };
  });

  // ---------- AI ----------
  add('POST', '/api/ai/suggest', { auth: 1 }, async (c) => {
    if (!config.anthropicKey) throw new HttpError(501, 'No AI provider is configured on this server. Set ANTHROPIC_API_KEY.', 'not_configured');
    rateLimit('ai:' + c.user.id, 10, 3600e3);
    const b = await readJson(c.req, 4000); if (b.consent !== true) throw bad('Consent is required before sending a request to the AI provider.', 'consent_required');
    const prompt = clean(b.prompt, 300); if (!prompt) throw bad('Describe what you want to hear.');
    const cat = tracksWhere(c.user, "t.kind='song'", 'LIMIT 150'), allowed = new Set(cat.map(t => t.id));
    const sys = 'You build playlists. Reply with ONLY compact JSON: {"name": string (max 50 chars), "description": string (max 140 chars), "trackIds": string[]}. Use ONLY ids from the provided catalogue, 5 to 15 tracks. Never invent ids.';
    let j; try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ model: config.aiModel, max_tokens: 700, system: sys, messages: [{ role: 'user', content: `Catalogue:\n${cat.map(t => `${t.id}|${t.title}|${t.artist}|${t.genre || ''}|${t.mood || ''}`).join('\n')}\n\nRequest: ${prompt}` }] }) });
      if (!r.ok) throw new Error('status ' + r.status); const d = await r.json(); const txt = d.content?.[0]?.text || ''; j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    } catch { throw new HttpError(502, 'The AI provider did not return a usable answer.', 'provider_error'); }
    const ids = (Array.isArray(j.trackIds) ? j.trackIds : []).map(String).filter(id => allowed.has(id)); const uniq = [...new Set(ids)].slice(0, 15);
    if (!uniq.length) throw new HttpError(502, 'The AI answer contained no valid catalogue tracks.', 'provider_error');
    return { name: clean(j.name, 50) || 'AI mix', description: clean(j.description, 140), tracks: uniq.map(id => cat.find(t => t.id === id)) };
  });

  // ---------- dispatcher ----------
  return async function handle(req, res, url) {
    const path = url.pathname; let match = null;
    for (const r of routes) { if (r.method !== req.method && !(req.method === 'HEAD' && r.method === 'GET')) continue; const m = r.re.exec(path); if (m) { match = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; } }
    if (!match) return send(res, 404, { error: 'Not found' });
    const c = { req, res, url, params: match.params, user: getUser(req) };
    try {
      if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-auralys'] !== '1') throw new HttpError(403, 'Missing X-Auralys header.');
      if (match.r.opts.auth && !c.user) throw new HttpError(401, 'Sign in to continue.', 'auth_required');
      const out = await match.r.fn(c);
      if (c.handled) return;
      const h = { ...(c.headers || {}), ...(c.cookie ? { 'Set-Cookie': c.cookie } : {}) };
      if (c.redirect) { res.writeHead(302, { Location: c.redirect, ...h }); return res.end(); }
      if (c.raw !== undefined) { res.writeHead(200, { 'Content-Type': c.rawType, 'Cache-Control': 'no-store', ...h }); return res.end(c.raw); }
      return send(res, 200, out ?? { ok: true }, h);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, code: e.code });
      console.error('API error', req.method, path, e.message); return send(res, 500, { error: 'Something went wrong on the server.' });
    }
  };
}
