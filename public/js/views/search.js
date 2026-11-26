import { h, icon, debounce, skeletonRows } from '../core/dom.js';
import { ls, app } from '../core/app.js';
import { get } from '../core/api.js';
import { section, shelf, albumCard, artistCard, playlistCard, podcastCard, trackList, empty, errorBox } from '../ui/components.js';

const TYPES = [['all', 'All'], ['youtube', 'YouTube'], ['tracks', 'Songs'], ['albums', 'Albums'], ['artists', 'Artists'], ['playlists', 'Playlists'], ['podcasts', 'Podcasts']];
export default async function search({ el, query }) {
  let q = query.get('q') || '', type = query.get('type') || 'all', ctl; const results = h('div'), sugg = h('div', { class: 'panel', role: 'listbox', 'aria-label': 'Suggestions', hidden: true, style: { padding: '6px' } });
  const input = h('input', { id: 'search-input', type: 'search', placeholder: 'Search songs, albums, artists, podcasts…', value: q, autocomplete: 'off', 'aria-label': 'Search', 'aria-autocomplete': 'list', style: { height: '54px', borderRadius: '999px', paddingLeft: '20px' } });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter results' });
  const recent = () => ls.get('auralys.recent', []); const addRecent = s => ls.set('auralys.recent', [s, ...recent().filter(x => x !== s)].slice(0, 8));
  const renderChips = () => chips.replaceChildren(...TYPES.map(([k, l]) => h('button', { class: 'chip' + (k === type ? ' on' : ''), 'aria-pressed': k === type, onclick: () => { type = k; sync(); renderChips(); run(); } }, l)));
  const sync = () => history.replaceState({}, '', '/search' + (q ? `?q=${encodeURIComponent(q)}${type !== 'all' ? '&type=' + type : ''}` : ''));
  el.append(h('div', { class: 'pagehead' }, h('div', h('h1', 'Search'), h('p', 'Songs, albums, artists and podcasts from the catalogue and your own uploads. Press / anywhere to jump here.'))), h('div', { class: 'searchpill', style: { maxWidth: 'none', height: '54px', padding: 0, background: 'none' } }, input), sugg, chips, results);
  renderChips();
  function home() {
    const r = recent(); results.replaceChildren(r.length ? section('Recent searches', h('div', { class: 'chips' }, r.map(s => h('button', { class: 'chip', onclick: () => { input.value = q = s; sync(); run(); } }, icon('history'), s)), h('button', { class: 'chip', onclick: () => { ls.set('auralys.recent', []); home(); } }, 'Clear'))) : null, section('Try browsing', h('div', { class: 'chips' }, ['Calm', 'Warm', 'Focus', 'Night', 'Energy'].map(m => h('a', { class: 'chip', href: '/moods?m=' + m }, m)))));
  }
  async function run() {
    sugg.hidden = true; ctl?.abort(); if (!q.trim()) return home(); ctl = new AbortController(); results.replaceChildren(skeletonRows(5));
    try {
      const yf = app.config.features.youtube, wantYt = type === 'all' || type === 'youtube'; const ytP = wantYt && yf.available ? get(`/api/yt/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).catch(e => ({ error: e })) : null;
      const r = type === 'youtube' ? { tracks: [], albums: [], artists: [], playlists: [], podcasts: [], episodes: [] } : await get(`/api/search?q=${encodeURIComponent(q)}&type=${type}`, { signal: ctl.signal }); addRecent(q.trim()); const yr = ytP ? await ytP : null;
      const ytSection = !wantYt ? null : !yf.available ? h('p', { class: 'note', style: { marginTop: '18px' } }, 'YouTube search is off. ' + yf.note) : yr?.error ? h('p', { class: 'note warn', style: { marginTop: '18px' } }, yr.error.message) : yr?.tracks.length ? section('From YouTube', trackList(yr.tracks)) : null;
      const total = r.tracks.length + r.albums.length + r.artists.length + r.playlists.length + r.podcasts.length + r.episodes.length;
      if (!total && !(yr?.tracks?.length)) return results.replaceChildren(ytSection && !yr?.tracks ? ytSection : null, empty('search', `No results for “${q}”`, 'Check the spelling, try a shorter phrase, or switch the filter to All.'));
      results.replaceChildren(r.tracks.length && section('Songs', trackList(r.tracks, { badge: true })), r.albums.length && section('Albums', shelf(r.albums.map(albumCard))), r.artists.length && section('Artists', shelf(r.artists.map(artistCard))), r.playlists.length && section('Your playlists', shelf(r.playlists.map(playlistCard))), r.podcasts.length && section('Podcasts', shelf(r.podcasts.map(podcastCard))), r.episodes.length && section('Episodes', trackList(r.episodes)), ytSection);
    } catch (e) { if (e.name !== 'AbortError') results.replaceChildren(errorBox(e, run)); }
  }
  const suggest = debounce(async () => { if (!q.trim()) return sugg.hidden = true; try { const r = await get('/api/suggest?q=' + encodeURIComponent(q)); if (!r.suggestions.length || input.value !== q) return sugg.hidden = true; sugg.replaceChildren(...r.suggestions.map((s, i) => h('button', { role: 'option', class: 'opt', style: { display: 'flex', width: '100%', padding: '10px 14px', borderRadius: '10px', textAlign: 'left', gap: '10px' }, onmousedown: e => e.preventDefault(), onclick: () => { input.value = q = s; sync(); run(); } }, icon('search'), s))); sugg.hidden = false; } catch {} }, 180);
  const go = debounce(() => { sync(); run(); }, 280);
  input.addEventListener('input', () => { q = input.value; suggest(); go(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { go.cancel(); sync(); run(); } else if (e.key === 'ArrowDown' && !sugg.hidden) { e.preventDefault(); sugg.firstChild?.focus(); } else if (e.key === 'Escape') sugg.hidden = true; });
  sugg.addEventListener('keydown', e => { const items = [...sugg.children], i = items.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 ? input : items[i - 1]).focus(); } });
  input.addEventListener('blur', () => setTimeout(() => sugg.hidden = true, 150));
  await run(); if (matchMedia('(min-width:761px)').matches || !q) input.focus({ preventScroll: true });
}
