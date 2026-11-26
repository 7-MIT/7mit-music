import { h, icon, skeletonRows, toast, promptBox, confirmBox, fmtDur, modal } from '../core/dom.js';
import { app, toggleSaved, needAuth, refreshLibraryFlags } from '../core/app.js';
import { get, put, del, api, post } from '../core/api.js';
import { setQueue, enqueue, startRadio } from '../player/engine.js';
import { section, shelf, albumCard, trackList, empty, errorBox, img, badge, trackMenu } from '../ui/components.js';
import { go } from '../core/router.js';

const savedBtn = (kind, id) => { const b = h('button', { class: 'btn ghost', onclick: async () => { await toggleSaved(kind, id); sync(); } }); const sync = () => { const on = app.saved.has(kind + ':' + id); b.replaceChildren(icon(on ? 'check' : 'plus'), on ? 'Saved' : 'Save to library'); b.setAttribute('aria-pressed', on); }; sync(); app.addEventListener('library', sync); return b; };
const playBtns = list => [h('button', { class: 'btn primary', onclick: () => list.length && setQueue(list, 0) }, icon('play'), 'Play'), h('button', { class: 'btn', onclick: () => list.length && setQueue([...list].sort(() => Math.random() - .5), 0) }, icon('shuffle'), 'Shuffle')];
const hero = (cover, kicker, title, meta, actions, round) => h('div', { class: 'detailhead' }, h('img', { class: 'cover-lg', src: cover, alt: '', style: round ? { borderRadius: '50%' } : {} }), h('div', { style: { flex: 1, minWidth: '240px' } }, h('span', { class: 'eyebrow' }, kicker), h('h1', title), h('p', { class: 'muted', style: { margin: '8px 0 0' } }, meta), h('div', { class: 'actions' }, actions)));

export default async function detail({ el, params, isStale }) {
  const kind = location.pathname.split('/')[1], id = params.id; el.append(skeletonRows(8));
  try {
    if (kind === 'album') {
      const a = await get('/api/albums/' + id); if (isStale()) return; el.replaceChildren(hero(a.cover, a.demo ? 'Album · Demo' : 'Album', a.title, h('span', h('a', { href: '/artist/' + a.artistId, style: { textDecoration: 'underline' } }, a.artist), ` · ${a.year ?? ''} · ${a.tracks.length} songs · ${fmtDur(a.tracks.reduce((s, t) => s + t.durationMs, 0))}`), [...playBtns(a.tracks), savedBtn('album', a.id)]), trackList(a.tracks, { numbered: true }));
    } else if (kind === 'artist') {
      const a = await get('/api/artists/' + id); if (isStale()) return; const all = a.albums.flatMap(x => []).length ? [] : a.topTracks;
      el.replaceChildren(hero(a.cover, a.demo ? 'Artist · Demo' : 'Artist', a.name, a.bio || '', [h('button', { class: 'btn primary', onclick: () => a.topTracks.length && setQueue(a.topTracks, 0) }, icon('play'), 'Play'), h('button', { class: 'btn', onclick: async () => { if (a.topTracks[0]) { const n = await startRadio(a.topTracks[0]); toast(n ? 'Radio started' : 'No similar tracks'); } } }, icon('radio'), 'Radio'), savedBtn('artist', a.id)], true), section('Popular', trackList(a.topTracks, { badge: false })), section('Albums', shelf(a.albums.map(albumCard))));
    } else if (kind === 'podcast') {
      const p = await get('/api/podcasts/' + id); if (isStale()) return; el.replaceChildren(hero(p.cover, p.demo ? 'Podcast · Demo' : 'Podcast', p.title, p.host, [...playBtns(p.episodes).slice(0, 1), savedBtn('podcast', p.id)]), h('p', { class: 'muted', style: { maxWidth: '70ch' } }, p.description), section('Episodes', trackList(p.episodes, { numbered: true, hideAlbum: true })));
    } else await playlist(el, id, isStale);
  } catch (e) { if (!isStale()) el.replaceChildren(e.status === 401 ? empty('user', 'Sign in to view this playlist', 'Playlists are private to their owner.', h('a', { class: 'btn primary', href: '/login?next=' + encodeURIComponent(location.pathname) }, 'Sign in')) : e.status === 404 ? empty('info', 'Not found', 'This item doesn’t exist or isn’t visible to you.', h('a', { class: 'btn', href: '/' }, 'Back to Home')) : errorBox(e, () => location.reload())); }
}

async function playlist(el, id, isStale) {
  const p = await get('/api/playlists/' + id); if (isStale()) return; let tracks = p.tracks;
  const draw = () => {
    const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async e => { const f = e.target.files[0]; if (!f) return; try { const r = await api(`/api/playlists/${id}/cover`, { method: 'PUT', raw: f, headers: { 'Content-Type': f.type } }); p.cover = r.cover; toast('Cover updated'); draw(); } catch (er) { toast(er.message); } } });
    const csvIn = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: async e => { const f = e.target.files[0]; if (!f) return; try { const r = await api(`/api/playlists/${id}/import`, { method: 'POST', raw: await f.text(), headers: { 'Content-Type': 'text/csv' } }); toast(`Imported ${r.matched} tracks${r.missingCount ? `, ${r.missingCount} not found` : ''}`); if (r.missingCount) modal('Not found in the catalogue', h('ul', r.missing.map(m => h('li', m)))); const n = await get('/api/playlists/' + id); tracks = n.tracks; draw(); } catch (er) { toast(er.message); } } });
    const reorder = async (from, to) => { if (to < 0 || to >= tracks.length) return; const [m] = tracks.splice(from, 1); tracks.splice(to, 0, m); draw(); try { await put(`/api/playlists/${id}/order`, { trackIds: tracks.map(t => t.id) }); } catch (er) { toast(er.message); } };
    const remove = async t => { try { await del(`/api/playlists/${id}/tracks/${t.id}`); tracks = tracks.filter(x => x.id !== t.id); draw(); toast('Removed from playlist'); } catch (er) { toast(er.message); } };
    const rows = trackList(tracks, { drag: reorder, removeFromPlaylist: remove, emptyTitle: 'This playlist is empty', emptyBody: 'Add songs from any ⋯ menu → “Add to playlist”.' });
    el.replaceChildren(hero(p.cover || tracks[0]?.cover || '/media/covers/default.svg', 'Playlist', p.name, `${tracks.length} songs · ${fmtDur(tracks.reduce((s, t) => s + t.durationMs, 0))}${p.description ? ' · ' + p.description : ''}`, [...playBtns(tracks),
      h('button', { class: 'ib', 'aria-label': 'Rename playlist', title: 'Rename', onclick: async () => { const n = await promptBox('Rename playlist', 'Name', p.name); if (n) { try { await put('/api/playlists/' + id, { name: n }); p.name = n; draw(); } catch (e) { toast(e.message); } } } }, icon('edit')),
      h('button', { class: 'ib', 'aria-label': 'Change cover', title: 'Custom cover', onclick: () => fileIn.click() }, icon('upload')),
      p.cover && h('button', { class: 'ib', 'aria-label': 'Remove custom cover', title: 'Remove custom cover', onclick: async () => { await del(`/api/playlists/${id}/cover`); p.cover = null; draw(); } }, icon('close')),
      h('a', { class: 'ib', href: `/api/playlists/${id}/export`, download: '', 'aria-label': 'Export CSV', title: 'Export CSV' }, icon('download')), h('button', { class: 'ib', 'aria-label': 'Import CSV', title: 'Import CSV', onclick: () => csvIn.click() }, icon('plus')),
      h('button', { class: 'ib', 'aria-label': 'Delete playlist', title: 'Delete', onclick: async () => { if (await confirmBox('Delete playlist?', `“${p.name}” will be removed. Your songs stay in the library.`, 'Delete', true)) { await del('/api/playlists/' + id); toast('Playlist deleted'); go('/library/playlists'); } } }, icon('trash')), fileIn, csvIn]),
      tracks.length > 1 ? h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Drag rows to reorder, or focus a row and press Alt + ↑/↓.') : null, rows);
    el.querySelectorAll('.row').forEach(r => r.tabIndex = 0);
  };
  draw();
}
