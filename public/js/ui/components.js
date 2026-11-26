import { h, icon, fmtTime, sheet, modal, promptBox, confirmBox, toast, $$ } from '../core/dom.js';
import { app, toggleFav, needAuth, refreshLibraryFlags } from '../core/app.js';
import { api, get, post, del } from '../core/api.js';
import { engine, S, setQueue, playNext, enqueue, startRadio, cur } from '../player/engine.js';
import { go } from '../core/router.js';
import { ensureImported } from '../core/yt.js';

export const img = (src, alt = '', cls = '') => h('img', { src, alt, class: cls, loading: 'lazy', decoding: 'async', draggable: false, onerror: e => { e.target.onerror = null; e.target.src = '/media/covers/default.svg'; } });
export const link = (href, ...kids) => h('a', { href }, ...kids);
export const empty = (ic, title, body, action) => h('div', { class: 'empty' }, icon(ic), h('h3', title), body && h('p', body), action);
export const signInPrompt = (what = 'this page') => empty('user', 'Sign in to continue', `Your library, playlists, statistics and listening rooms live in your account. Sign in to see ${what}.`, h('a', { class: 'btn primary', href: '/login?next=' + encodeURIComponent(location.pathname + location.search) }, 'Sign in or create an account'));
export const errorBox = (e, retry) => empty('info', e.status === 0 ? 'You’re offline' : 'Couldn’t load this', e.message, retry && h('button', { class: 'btn', onclick: retry }, 'Try again'));
export const badge = demo => demo ? h('span', { class: 'badge', title: 'Generated demo content, not a real catalogue release' }, 'Demo') : null;

export function section(title, content, more) {
  return h('section', {}, h('h2', { class: 'sec' }, title, more && h('a', { class: 'more', href: more }, 'See all')), content);
}
export const shelf = items => h('div', { class: 'shelf' }, items);
export function card({ title, sub, cover, href, onplay, round, demo }) {
  const el = h('div', { class: 'card' + (round ? ' round' : '') },
    h(href ? 'a' : 'div', { href, class: 'art', style: { display: 'block' }, 'aria-label': title }, img(cover, ''), onplay && h('button', { class: 'go', 'aria-label': `Play ${title}`, onclick: e => { e.preventDefault(); e.stopPropagation(); onplay(); } }, icon('play'))),
    h('div', { class: 'ct' }, href ? h('a', { href }, title) : title, ' ', demo ? badge(true) : null), sub && h('div', { class: 'cs' }, sub));
  return el;
}
export const albumCard = a => card({ title: a.title, sub: `${a.artist}${a.year ? ' · ' + a.year : ''}`, cover: a.cover, href: '/album/' + a.id, demo: a.demo, onplay: async () => { const r = await get('/api/albums/' + a.id); setQueue(r.tracks, 0); } });
export const artistCard = a => card({ title: a.name, sub: 'Artist', cover: a.cover, href: '/artist/' + a.id, round: true });
export const playlistCard = p => card({ title: p.name, sub: `${p.trackCount ?? 0} songs`, cover: p.cover || '/media/covers/default.svg', href: '/playlist/' + p.id, onplay: async () => { const r = await get('/api/playlists/' + p.id); r.tracks.length && setQueue(r.tracks, 0); } });
export const podcastCard = p => card({ title: p.title, sub: p.host, cover: p.cover, href: '/podcast/' + p.id, demo: p.demo });
export function mixCard(m) {
  const pal = { Calm: ['#4d6a73', '#2c3e45'], Warm: ['#BE603F', '#6b2f1c'], Focus: ['#6f8f72', '#33473a'], Night: ['#5a4a8a', '#241b33'], Energy: ['#d1893a', '#8c3a2a'] }[m.mood] || ['#7a5444', '#3a2a22'];
  const el = h('div', { class: 'card mixcard' }, h('div', { class: 'art', style: { '--c1': pal[0], '--c2': pal[1] } }, h('b', m.title), h('button', { class: 'go', 'aria-label': `Play ${m.title}`, onclick: () => setQueue(m.tracks, 0) }, icon('play'))), h('div', { class: 'ct' }, m.title), h('div', { class: 'cs' }, `${m.tracks.length} songs`));
  return el;
}
export function quickCard(t, list) { return h('button', { class: 'qcard', onclick: () => setQueue(list, list.indexOf(t)) }, img(t.cover), h('div', h('div', { class: 't' }, t.title), h('div', { class: 's' }, t.artist))); }

// ---------- track rows ----------
export function trackRow(t, list, i, o = {}) {
  const lead = h('div', { class: 'lead', onclick: () => setQueue(list, i), role: 'button', tabindex: 0, 'aria-label': `Play ${t.title}`, onkeydown: e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setQueue(list, i)) },
    o.numbered ? h('span', { class: 'num' }, t.trackNo ?? i + 1) : img(t.cover), h('div', { class: 'eq-anim' }, h('i'), h('i'), h('i')), h('div', { class: 'hov' }, icon('play')));
  const like = h('button', { class: 'ib' + (app.favs.has(t.id) ? ' liked' : ''), 'aria-label': app.favs.has(t.id) ? `Unlike ${t.title}` : `Like ${t.title}`, 'aria-pressed': app.favs.has(t.id), onclick: e => { e.stopPropagation(); toggleFav(t); } }, icon('heart'));
  const row = h('div', { class: 'row' + (o.select || o.drag ? ' x' : ''), dataset: { id: t.id }, draggable: !!o.drag, role: 'listitem' },
    o.select ? h('input', { type: 'checkbox', 'aria-label': `Select ${t.title}`, checked: o.isSel?.(t), onchange: e => { o.select(t, e.target.checked); row.classList.toggle('sel', e.target.checked); } }) : (o.drag ? h('span', { class: 'grip', title: 'Drag to reorder' }, icon('grip')) : null), lead,
    h('div', { class: 'rm', onclick: () => o.numbered || setQueue(list, i) }, h('div', { class: 'rt' }, t.title, ' ', badge(t.demo && o.badge), t.provider === 'youtube' ? h('span', { class: 'badge yt', title: 'Plays in YouTube’s embedded player' }, 'YouTube') : null), h('div', { class: 'rs' }, o.numbered && !o.showArtist ? (t.artist) : [t.artist, t.album && !o.hideAlbum ? ' · ' + t.album : ''])),
    h('div', { class: 'rd' }, t.durationMs ? fmtTime(t.durationMs / 1000) : ''), like, h('button', { class: 'ib', 'aria-label': `More options for ${t.title}`, onclick: e => { e.stopPropagation(); trackMenu(t, o); } }, icon('dots')));
  if (o.drag) {
    row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); $$('.dragover').forEach(x => x.classList.remove('dragover')); });
    row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('dragover'); }); row.addEventListener('dragleave', () => row.classList.remove('dragover'));
    row.addEventListener('drop', e => { e.preventDefault(); row.classList.remove('dragover'); const from = +e.dataTransfer.getData('text/plain'); if (!isNaN(from) && from !== i) o.drag(from, i); });
    row.addEventListener('keydown', e => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); o.drag(i, i + (e.key === 'ArrowUp' ? -1 : 1)); } });
  }
  const syncLike = () => { if (!row.isConnected) return app.removeEventListener('library', syncLike); const on = app.favs.has(t.id); like.classList.toggle('liked', on); like.setAttribute('aria-pressed', on); like.setAttribute('aria-label', on ? `Unlike ${t.title}` : `Like ${t.title}`); };
  app.addEventListener('library', syncLike); syncRow(row); return row;
}
export function syncRow(row) { const c = cur(), on = c && row.dataset.id === c.id; row.classList.toggle('current', !!on); row.classList.toggle('playing', !!on && S.playing); }
export const syncRows = () => $$('.row[data-id]').forEach(syncRow);
export function trackList(list, o = {}) { if (!list.length) return empty('music', o.emptyTitle || 'Nothing here yet', o.emptyBody); return h('div', { class: 'tracks', role: 'list' }, list.map((t, i) => trackRow(t, list, i, o))); }

export async function trackMenu(t, o = {}) {
  const mine = t.mine;
  sheet(t.title, [
    { icon: 'play', label: 'Play next', onclick: () => { playNext(t); toast('Will play next'); } },
    { icon: 'queue', label: 'Add to queue', onclick: () => { enqueue(t); toast('Added to queue'); } },
    { icon: 'heart', label: app.favs.has(t.id) ? 'Remove from liked songs' : 'Add to liked songs', onclick: () => toggleFav(t) },
    { icon: 'plus', label: 'Add to playlist…', onclick: () => pickPlaylist([t]) },
    t.kind === 'song' && { icon: 'radio', label: 'Start radio', onclick: async () => { const n = await startRadio(t); toast(n ? 'Radio started' : 'No similar tracks yet'); } },
    t.albumId && { icon: 'music', label: 'Go to album', onclick: () => go('/album/' + t.albumId) },
    t.artistId && { icon: 'user', label: 'Go to artist', onclick: () => go('/artist/' + t.artistId) },
    t.podcastId && { icon: 'podcast', label: 'Go to podcast', onclick: () => go('/podcast/' + t.podcastId) },
    o.removeFromPlaylist && { icon: 'close', label: 'Remove from this playlist', onclick: () => o.removeFromPlaylist(t) },
    mine && { icon: 'lyrics', label: 'Add or edit lyrics', onclick: () => editLyrics(t) },
    mine && { icon: 'trash', label: 'Delete upload', danger: true, onclick: async () => { if (await confirmBox('Delete this upload?', `“${t.title}” will be permanently removed from your account.`, 'Delete', true)) { try { await del('/api/tracks/' + t.id); toast('Upload deleted'); o.onChange?.(); } catch (e) { toast(e.message); } } } }
  ]);
}
export async function editLyrics(t) {
  const ta = h('textarea', { rows: 10, placeholder: '[00:12.00] First line\n[00:16.50] Second line\n\nPlain text also works.', 'aria-label': 'Lyrics (LRC or plain text)' });
  try { const r = await get(`/api/tracks/${t.id}/lyrics`); const u = r.lyrics.find(l => l.provider === 'user'); if (u) ta.value = u.content; } catch {}
  modal('Lyrics for ' + t.title, h('div', h('p', { class: 'muted' }, 'Only add lyrics you have the right to use. Timed LRC lines enable synchronised highlighting.'), ta), [{ label: 'Cancel' }, { label: 'Save', primary: true, onclick: async () => { try { await api(`/api/tracks/${t.id}/lyrics`, { method: 'PUT', raw: ta.value }); toast('Lyrics saved'); engine.dispatchEvent(new Event('lyrics-changed')); } catch (e) { toast(e.message); return false; } } }]);
}
export async function pickPlaylist(items) {
  if (!app.user) return needAuth('Sign in to build playlists.');
  const trackIds = items.map(x => typeof x === 'string' ? x : x.id);
  try { await ensureImported(items.filter(x => typeof x !== 'string')); } catch (e) { return toast(e.message); }
  let pls = []; try { pls = (await get('/api/library/playlists')).playlists; } catch (e) { return toast(e.message); }
  const add = async p => { try { const r = await post(`/api/playlists/${p.id}/tracks`, { trackIds }); toast(r.added ? `Added to ${p.name}` : `Already in ${p.name}`); } catch (e) { toast(e.message); } };
  sheet('Add to playlist', [{ icon: 'plus', label: 'New playlist…', onclick: async () => { const name = await promptBox('New playlist', 'Name', '', 'Create'); if (!name) return; try { const p = await post('/api/playlists', { name, trackIds }); toast(`Created “${p.name}”`); refreshLibraryFlags(); } catch (e) { toast(e.message); } } }, ...pls.map(p => ({ icon: 'list', label: p.name, onclick: () => add(p) }))]);
}
