import { h, icon, fmtDur, skeletonCards, toast } from '../core/dom.js';
import { app } from '../core/app.js';
import { get } from '../core/api.js';
import { section, shelf, trackList, empty, errorBox, signInPrompt, card } from '../ui/components.js';
import { setQueue } from '../player/engine.js';

const RANGES = [['7d', '7 days'], ['30d', '30 days'], ['365d', 'Year'], ['all', 'All time']];
export default async function stats({ el, isStale }) {
  el.append(h('div', { class: 'pagehead' }, h('div', h('h1', 'Statistics'), h('p', 'Calculated from what you actually played — a play counts after 30 seconds or half the track, and each listen is counted once.'))));
  if (!app.user) return el.append(signInPrompt('your listening statistics'));
  let range = '30d'; const body = h('div'), chips = h('div', { class: 'chips' });
  el.append(chips, body);
  const paint = () => chips.replaceChildren(...RANGES.map(([k, l]) => h('button', { class: 'chip' + (k === range ? ' on' : ''), 'aria-pressed': k === range, onclick: () => { range = k; paint(); load(); } }, l)));
  async function load() {
    body.replaceChildren(skeletonCards(4));
    try {
      const s = await get('/api/stats?range=' + range); if (isStale()) return;
      if (app.prefs.privacy.history === false) body.append(h('p', { class: 'note' }, 'History recording is paused in Settings → Privacy, so new listening isn’t being counted.'));
      if (!s.sessions) return body.replaceChildren(empty('stats', 'No listening yet', 'Play some music while signed in and your top tracks, artists and listening time will appear here.', h('a', { class: 'btn primary', href: '/' }, 'Start listening')));
      const max = Math.max(1, ...s.daily.map(d => d.ms));
      body.replaceChildren(h('div', { class: 'statgrid' }, [[fmtDur(s.totalMs), 'Time listened'], [s.plays, 'Plays'], [s.sessions, 'Listening sessions'], [s.topArtists[0]?.name ?? '—', 'Top artist']].map(([b, l]) => h('div', { class: 'stat' }, h('b', String(b)), h('span', l)))),
        section('Listening by day', h('div', { class: 'panel' }, h('div', { class: 'bars', role: 'img', 'aria-label': 'Minutes listened per day' }, s.daily.map(d => h('i', { style: { height: Math.max(2, d.ms / max * 100) + '%' }, title: `${d.day}: ${fmtDur(d.ms)}` }))), h('div', { class: 'bars-x' }, h('span', s.daily[0]?.day ?? ''), h('span', s.daily.at(-1)?.day ?? '')))),
        s.topTracks.length ? section('Top tracks', trackList(s.topTracks.map(x => x.track))) : null,
        s.topArtists.length ? section('Top artists', shelf(s.topArtists.map(a => card({ title: a.name, sub: `${a.plays} plays · ${fmtDur(a.ms)}`, cover: a.cover, href: '/artist/' + a.id, round: true })))) : null,
        s.topAlbums.length ? section('Top albums', shelf(s.topAlbums.map(a => card({ title: a.title, sub: `${a.artist} · ${a.plays} plays`, cover: a.cover, href: '/album/' + a.id })))) : null,
        section('By mood', h('div', { class: 'panel' }, s.moods.map(m => h('div', { class: 'setrow', style: { padding: '10px 0' } }, h('span', { class: 'lab' }, m.name), h('div', { style: { flex: 2, height: '8px', borderRadius: '4px', background: 'var(--surface2)', overflow: 'hidden' } }, h('i', { style: { display: 'block', height: '100%', width: m.ms / s.moods[0].ms * 100 + '%', background: 'var(--accent)' } })), h('span', { class: 'muted' }, fmtDur(m.ms)))))));
    } catch (e) { body.replaceChildren(errorBox(e, load)); }
  }
  paint(); await load();
}
