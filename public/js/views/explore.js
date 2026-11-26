import { h, icon, skeletonCards, skeletonRows } from '../core/dom.js';
import { app, setPrefs } from '../core/app.js';
import { get } from '../core/api.js';
import { setQueue } from '../player/engine.js';
import { section, shelf, albumCard, podcastCard, trackList, empty, errorBox, card, trackRow } from '../ui/components.js';
import { query, go } from '../core/router.js';

const TABS = [['/explore', 'Browse'], ['/charts', 'Charts'], ['/moods', 'Moods & genres'], ['/new-releases', 'New releases']];
const tabs = () => h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([p, l]) => h('a', { href: p, class: location.pathname === p ? 'on' : '', role: 'tab' }, l)));
const head = (t, sub) => h('div', { class: 'pagehead' }, h('div', h('h1', t), sub && h('p', sub)));
const MOODCOL = { Calm: ['#4d6a73', '#2c3e45'], Warm: ['#BE603F', '#6b2f1c'], Focus: ['#6f8f72', '#33473a'], Night: ['#5a4a8a', '#241b33'], Energy: ['#d1893a', '#8c3a2a'] };
const moodTile = m => h('a', { href: '/moods?m=' + encodeURIComponent(m.name), class: 'card mixcard' }, h('div', { class: 'art', style: { '--c1': (MOODCOL[m.name] || ['#7a5444', '#3a2a22'])[0], '--c2': (MOODCOL[m.name] || ['#7a5444', '#3a2a22'])[1] } }, h('b', m.name)), h('div', { class: 'cs' }, m.blurb));

export default async function explore({ el, isStale }) {
  const p = location.pathname; el.append(head('Explore', 'Browse the catalogue by mood, genre, chart and release date.'), tabs()); const body = h('div'); el.append(body);
  try {
    if (p === '/explore') {
      body.append(skeletonCards()); const [m, g, n, pc, ch] = await Promise.all([get('/api/moods'), get('/api/genres'), get('/api/new-releases'), get('/api/podcasts'), get('/api/charts?region=' + app.prefs.region)]); if (isStale()) return;
      body.replaceChildren(section('Moods', h('div', { class: 'grid' }, m.moods.map(moodTile)), '/moods'), section('Genres', h('div', { class: 'chips' }, g.genres.map(x => h('a', { class: 'chip', href: '/moods?g=' + encodeURIComponent(x.name) }, `${x.name} · ${x.count}`)))),
        section('New releases', shelf(n.albums.map(albumCard)), '/new-releases'), section('Charts on this server', ch.empty ? h('p', { class: 'muted' }, 'No chart data yet — charts are built from what people actually play here. Play a few songs while signed in.') : h('div', { class: 'tracks' }, ch.entries.slice(0, 5).map((e, i) => trackRow(e.track, ch.entries.map(x => x.track), i, { numbered: true, showArtist: true }))), '/charts'),
        section('Podcasts', shelf(pc.podcasts.map(podcastCard))));
    } else if (p === '/charts') {
      const yf = app.config.features.youtube; let src = yf.available ? 'youtube' : 'server';
      const srcSel = h('select', { 'aria-label': 'Chart source', onchange: e => { src = e.target.value; load(); } }, [['youtube', 'YouTube trending (music)'], ['server', 'Listening on this server']].map(([v, l]) => h('option', { value: v, selected: v === src }, l)));
      const sel = h('select', { 'aria-label': 'Region', onchange: e => { setPrefs({ region: e.target.value }); load(); } }, app.config.regions.map(([c, n]) => h('option', { value: c, selected: c === app.prefs.region }, n)));
      body.append(h('div', { class: 'toolbar' }, h('div', { style: { width: '260px' } }, srcSel), h('label', { class: 'muted' }, 'Region '), h('div', { style: { width: '220px' } }, sel))); const out = h('div'); body.append(out);
      async function load() { out.replaceChildren(skeletonRows()); if (src === 'youtube') { try { const r = await get('/api/yt/trending?region=' + app.prefs.region); if (isStale()) return; out.replaceChildren(h('p', { class: 'muted' }, `Most popular music videos on YouTube${r.region === 'global' ? ' (United States used for “Global”)' : ' in ' + r.region}, via the official YouTube Data API. Plays in YouTube’s embedded player.`), h('div', { class: 'tracks', role: 'list' }, r.tracks.map((t, i) => trackRow(t, r.tracks, i, { numbered: true, showArtist: true })))); } catch (e) { out.replaceChildren(errorBox(e, load)); } return; } try { const r = await get('/api/charts?region=' + app.prefs.region); if (isStale()) return; out.replaceChildren(h('p', { class: 'muted' }, r.note + ` Last ${r.windowDays} days.`), r.empty ? empty('chart', 'No chart yet', 'Nobody has listened enough in this region yet. Set your region in Settings → Content and play some songs.') : h('div', { class: 'tracks', role: 'list' }, r.entries.map((e, i) => trackRow(e.track, r.entries.map(x => x.track), i, { numbered: true, showArtist: true, badge: true })))); } catch (e) { out.replaceChildren(errorBox(e, load)); } }
      await load();
    } else if (p === '/moods') {
      const q = query(), m = q.get('m'), g = q.get('g');
      if (m || g) { body.append(skeletonRows()); const r = await get(m ? '/api/moods/' + encodeURIComponent(m) : '/api/genres/' + encodeURIComponent(g)); if (isStale()) return; body.replaceChildren(h('div', { class: 'toolbar' }, h('h2', { class: 'sec', style: { margin: 0 } }, r.name), h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: () => r.tracks.length && setQueue(r.tracks, 0) }, icon('play'), 'Play all')), trackList(r.tracks, { badge: true })); }
      else { const [mo, ge] = await Promise.all([get('/api/moods'), get('/api/genres')]); if (isStale()) return; body.replaceChildren(section('Moods', h('div', { class: 'grid' }, mo.moods.map(moodTile))), section('Genres', h('div', { class: 'chips' }, ge.genres.map(x => h('a', { class: 'chip', href: '/moods?g=' + encodeURIComponent(x.name) }, `${x.name} · ${x.count}`))))); }
    } else {
      body.append(skeletonCards()); const r = await get('/api/new-releases'); if (isStale()) return; body.replaceChildren(r.albums.length ? h('div', { class: 'grid' }, r.albums.map(albumCard)) : empty('music', 'No releases yet'));
    }
  } catch (e) { body.replaceChildren(errorBox(e, () => location.reload())); }
}
