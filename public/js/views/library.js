import { h, icon, skeletonRows, skeletonCards, toast, modal, promptBox, fmtTime } from '../core/dom.js';
import { app, ls, toggleFav, refreshLibraryFlags } from '../core/app.js';
import { get, api, post } from '../core/api.js';
import { setQueue, enqueue, playLocalFile } from '../player/engine.js';
import { section, shelf, albumCard, artistCard, playlistCard, podcastCard, trackList, empty, errorBox, signInPrompt, pickPlaylist, card } from '../ui/components.js';
import { go } from '../core/router.js';

const TABS = [['songs', 'Songs'], ['albums', 'Albums'], ['artists', 'Artists'], ['playlists', 'Playlists'], ['podcasts', 'Podcasts']];
async function audioDuration(file) { return new Promise(res => { const a = new Audio(), u = URL.createObjectURL(file); a.preload = 'metadata'; a.onloadedmetadata = () => { res(Math.round((a.duration || 0) * 1000)); URL.revokeObjectURL(u); }; a.onerror = () => { res(0); URL.revokeObjectURL(u); }; a.src = u; }); }
export async function uploadFiles(files, done) {
  let ok = 0; for (const f of files) {
    const base = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '), parts = base.split(' - '), artist = parts.length > 1 ? parts[0] : '', title = parts.length > 1 ? parts.slice(1).join(' - ') : base;
    const t = toast(`Uploading ${f.name}…`);
    try { const dur = await audioDuration(f); await api(`/api/tracks/upload?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&duration=${dur}`, { method: 'POST', raw: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } }); ok++; } catch (e) { toast(`${f.name}: ${e.message}`); } t.remove();
  }
  if (ok) { toast(`${ok} upload${ok > 1 ? 's' : ''} added to your library`); await refreshLibraryFlags(); done?.(); }
}
export default async function library({ el, params, isStale }) {
  if (!app.user) return el.append(h('div', { class: 'pagehead' }, h('div', h('h1', 'Library'))), signInPrompt('your library'));
  const tab = TABS.some(t => t[0] === params.tab) ? params.tab : 'songs'; let view = ls.get('auralys.libview', 'list'), sort = 'title', filter = '', favOnly = false, selecting = false; const sel = new Map();
  const body = h('div'), bulk = h('div', { class: 'toolbar', hidden: true, style: { position: 'sticky', top: '64px', zIndex: 4, background: 'var(--surface2)', padding: '8px 12px', borderRadius: '999px' } });
  const fileIn = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.flac,.ogg,.m4a', multiple: true, hidden: true, onchange: e => { uploadFiles([...e.target.files], load); e.target.value = ''; } });
  const localIn = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: e => { e.target.files[0] && playLocalFile(e.target.files[0]); e.target.value = ''; } });
  const viewB = h('button', { class: 'ib', 'aria-label': 'Toggle grid or list view', onclick: () => { view = view === 'list' ? 'grid' : 'list'; ls.set('auralys.libview', view); viewB.replaceChildren(icon(view === 'list' ? 'grid' : 'list')); draw(); } }, icon(view === 'list' ? 'grid' : 'list'));
  el.append(h('div', { class: 'pagehead' }, h('div', h('h1', 'Library'), h('p', 'Your songs, albums, artists, playlists and podcasts.')), h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, h('button', { class: 'btn soft', onclick: () => fileIn.click() }, icon('upload'), 'Upload audio'), h('button', { class: 'btn ghost', onclick: () => localIn.click(), title: 'Plays the file in this tab only — nothing is uploaded' }, icon('music'), 'Play a local file'), fileIn, localIn)),
    h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, l]) => h('a', { href: '/library/' + k, class: k === tab ? 'on' : '', role: 'tab' }, l))));
  const toolbar = h('div', { class: 'toolbar' });
  const filterIn = h('input', { type: 'search', placeholder: 'Filter this list…', 'aria-label': 'Filter', style: { maxWidth: '260px' }, oninput: e => { filter = e.target.value.toLowerCase(); draw(); } });
  const sortSel = h('select', { 'aria-label': 'Sort', style: { width: 'auto' }, onchange: e => { sort = e.target.value; draw(); } }, [['title', 'Title'], ['artist', 'Artist'], ['recent', 'Recently added'], ['duration', 'Duration']].map(([v, l]) => h('option', { value: v }, l)));
  const favChip = h('button', { class: 'chip', 'aria-pressed': false, onclick: () => { favOnly = !favOnly; favChip.classList.toggle('on', favOnly); favChip.setAttribute('aria-pressed', favOnly); draw(); } }, icon('heart'), 'Liked');
  const selB = h('button', { class: 'chip', onclick: () => { selecting = !selecting; sel.clear(); selB.classList.toggle('on', selecting); draw(); updBulk(); } }, icon('check'), 'Select');
  if (tab === 'songs') toolbar.append(filterIn, sortSel, favChip, selB, h('span', { class: 'grow' }), viewB); else if (tab === 'playlists') toolbar.append(h('button', { class: 'btn primary', onclick: newPl }, icon('plus'), 'New playlist'), h('button', { class: 'btn ghost', onclick: importPl }, icon('upload'), 'Import CSV')); else toolbar.append(filterIn, h('span', { class: 'grow' }), viewB);
  el.append(toolbar, bulk, body);
  let data; async function load() { body.replaceChildren(tab === 'songs' ? skeletonRows() : skeletonCards()); try { data = await get('/api/library/' + tab); if (tab === 'songs') data.top = (await get('/api/library/top')).tracks; if (!isStale()) draw(); } catch (e) { body.replaceChildren(errorBox(e, load)); } }
  function updBulk() {
    bulk.hidden = !selecting || !sel.size; if (bulk.hidden) return; const ids = [...sel.keys()], ts = [...sel.values()];
    bulk.replaceChildren(h('b', `${sel.size} selected`), h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: () => pickPlaylist(ids) }, 'Add to playlist'), h('button', { class: 'btn sm', onclick: () => { ts.forEach(t => !app.favs.has(t.id) && toggleFav(t)); } }, 'Like'), h('button', { class: 'btn sm', onclick: () => { ts.forEach(enqueue); toast('Added to queue'); } }, 'Queue'), h('button', { class: 'btn sm ghost', onclick: () => { sel.clear(); draw(); updBulk(); } }, 'Clear'));
  }
  function draw() {
    if (!data) return; const cmp = { title: (a, b) => (a.title || a.name || '').localeCompare(b.title || b.name || ''), artist: (a, b) => (a.artist || '').localeCompare(b.artist || ''), recent: (a, b) => 0, duration: (a, b) => a.durationMs - b.durationMs }[sort];
    if (tab === 'songs') {
      let ts = data.tracks.filter(t => (!filter || `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(filter)) && (!favOnly || app.favs.has(t.id))).sort(cmp); if (sort === 'recent') ts = ts.reverse();
      if (!data.tracks.length) return body.replaceChildren(empty('library', 'Your library is empty', 'Like songs, save albums, build playlists, or upload your own audio — it all shows up here.', h('a', { class: 'btn primary', href: '/explore' }, 'Explore music')));
      const topS = data.top?.length && !filter && !favOnly ? section('Your top listening', shelf(data.top.map(t => card({ title: t.title, sub: `${t.plays} plays · ${t.artist}`, cover: t.cover, onplay: () => setQueue(data.top, data.top.indexOf(t)) })))) : null;
      const list = view === 'grid' ? h('div', { class: 'grid' }, ts.map(t => card({ title: t.title, sub: t.artist, cover: t.cover, onplay: () => setQueue(ts, ts.indexOf(t)) }))) : trackList(ts, { badge: true, select: selecting ? (t, on) => { on ? sel.set(t.id, t) : sel.delete(t.id); updBulk(); } : null, isSel: t => sel.has(t.id), onChange: load, emptyTitle: 'No songs match' });
      body.replaceChildren(topS, h('div', { class: 'toolbar' }, h('button', { class: 'btn primary sm', onclick: () => ts.length && setQueue(ts, 0) }, icon('play'), 'Play'), h('button', { class: 'btn sm', onclick: () => { if (ts.length) { const a = [...ts].sort(() => Math.random() - .5); setQueue(a, 0); } } }, icon('shuffle'), 'Shuffle'), h('span', { class: 'muted' }, `${ts.length} songs`)), list); return;
    }
    const key = { albums: 'albums', artists: 'artists', playlists: 'playlists', podcasts: 'podcasts' }[tab], mk = { albums: albumCard, artists: artistCard, playlists: playlistCard, podcasts: podcastCard }[tab];
    const items = data[key].filter(x => !filter || (x.title || x.name).toLowerCase().includes(filter));
    if (!items.length) return body.replaceChildren(empty({ albums: 'music', artists: 'user', playlists: 'list', podcasts: 'podcast' }[tab], `No ${tab} yet`, { albums: 'Save an album with the + button on its page.', artists: 'Follow an artist from their page.', playlists: 'Create a playlist and add songs from any ⋯ menu.', podcasts: 'Save a podcast from its page.' }[tab], h('a', { class: 'btn primary', href: '/explore' }, 'Explore')));
    body.replaceChildren(view === 'list' && tab !== 'playlists' ? h('div', { class: 'tracks' }, items.map(x => h('a', { href: `/${tab.slice(0, -1)}/${x.id}`, class: 'row', style: { gridTemplateColumns: 'auto 1fr' } }, h('div', { class: 'lead' }, h('img', { src: x.cover, alt: '' })), h('div', { class: 'rm' }, h('div', { class: 'rt' }, x.title || x.name), h('div', { class: 'rs' }, x.artist || x.host || ''))))) : h('div', { class: 'grid' }, items.map(mk)));
  }
  async function newPl() { const name = await promptBox('New playlist', 'Name', '', 'Create'); if (!name) return; try { const p = await post('/api/playlists', { name }); go('/playlist/' + p.id); } catch (e) { toast(e.message); } }
  function importPl() {
    const nameIn = h('input', { type: 'text', placeholder: 'Playlist name' }), f = h('input', { type: 'file', accept: '.csv,text/csv' });
    modal('Import playlist from CSV', h('div', h('p', { class: 'muted' }, 'Columns: title, artist (header row optional). Rows are matched to tracks already in the catalogue or your uploads; unmatched rows are listed so nothing is silently lost.'), h('div', { class: 'field' }, h('label', 'Name'), nameIn), h('div', { class: 'field' }, h('label', 'CSV file'), f)), [{ label: 'Cancel' }, { label: 'Import', primary: true, onclick: async () => { if (!f.files[0] || !nameIn.value.trim()) { toast('Choose a file and name'); return false; } try { const p = await post('/api/playlists', { name: nameIn.value.trim() }); const r = await api(`/api/playlists/${p.id}/import`, { method: 'POST', raw: await f.files[0].text(), headers: { 'Content-Type': 'text/csv' } }); toast(`Imported ${r.matched} tracks${r.missingCount ? `, ${r.missingCount} not found` : ''}`); go('/playlist/' + p.id); } catch (e) { toast(e.message); return false; } } }]);
  }
  await load();
}
