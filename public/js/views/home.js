import { h, icon, skeletonCards } from '../core/dom.js';
import { app } from '../core/app.js';
import { get } from '../core/api.js';
import { setQueue, startRadio } from '../player/engine.js';
import { section, shelf, card, albumCard, mixCard, quickCard, errorBox, trackList } from '../ui/components.js';
import { toast } from '../core/dom.js';

export const rings = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 400 260'); s.setAttribute('class', 'rings'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = '<circle cx="150" cy="130" r="118"/><circle cx="195" cy="130" r="92"/><circle cx="232" cy="130" r="70"/><circle cx="262" cy="130" r="46"/><circle cx="282" cy="130" r="26"/>'; return s; };
const trackCard = (t, list) => card({ title: t.title, sub: t.artist, cover: t.cover, onplay: () => setQueue(list, list.indexOf(t)) });

const ytTrackCard = (t, list) => card({ title: t.title, sub: t.artist, cover: t.cover, onplay: () => setQueue(list, list.indexOf(t)) });
async function loadYt(box, isStale) {
  const f = app.config.features.youtube; if (!f.available) return box.replaceChildren(section('YouTube Music', h('p', { class: 'note' }, 'Connect YouTube to see trending music and search it here. ' + f.note)));
  try { const r = await get('/api/yt/trending?region=' + app.prefs.region); if (isStale()) return; box.replaceChildren(section('Trending music on YouTube' + (r.region !== 'global' ? ' · ' + r.region : ''), shelf(r.tracks.map(t => ytTrackCard(t, r.tracks))), '/charts')); } catch (e) { box.replaceChildren(section('Trending music on YouTube', h('p', { class: 'note warn' }, e.message))); }
}
export default async function home({ el, isStale }) {
  const greet = (() => { const hr = new Date().getHours(); return hr < 5 ? 'Late night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; })();
  el.append(h('div', { class: 'hero' }, rings(), h('span', { class: 'eyebrow' }, 'Discover your sound'), h('h1', 'Music, reimagined.'), h('p', app.user ? `${greet}, ${app.user.name.split(' ')[0]}.` : 'Local, licensed and demo audio with synced lyrics, an equalizer and rooms to listen together.'), h('div', {}, h('button', { class: 'btn primary', id: 'radio', onclick: async () => { const t = data?.quickPicks?.[0]; if (!t) return; const n = await startRadio(t); toast(n ? 'Radio started' : 'Not enough music to build a radio yet'); } }, icon('play'), 'Start radio'))));
  const body = h('div', {}, skeletonCards()); el.append(body); let data;
  try { data = await get('/api/home'); } catch (e) { if (!isStale()) body.replaceChildren(errorBox(e, () => location.reload())); return; }
  if (isStale()) return;
  const S = {
    quick: () => section('Quick picks', h('div', { class: 'quick' }, data.quickPicks.map(t => quickCard(t, data.quickPicks)))),
    recent: () => data.recent.length && section('Recently played', shelf(data.recent.map(t => trackCard(t, data.recent)))),
    mixes: () => section('Made for you', shelf(data.mixes.map(mixCard))),
    new: () => data.newReleases.length && section('New releases', shelf(data.newReleases.map(albumCard)), '/new-releases'),
    editorial: () => data.editorial.length && section('From the editors', h('div', { class: 'editorial' }, data.editorial.map(e => h('a', { class: 'edcard', href: '/album/' + e.albumId }, h('img', { src: data.newReleases.find(a => a.id === e.albumId)?.cover || '/media/covers/default.svg', alt: '' }), h('div', h('span', { class: 'eyebrow' }, e.kicker), h('h3', e.title), h('p', e.body)))))),
    youtube: () => ytBox,
    stations: () => section('Radio stations', shelf(data.stations.map(s => card({ title: s.name + ' radio', sub: 'Endless similar tracks', cover: data.quickPicks.find(t => t.genre === s.name)?.cover || '/media/covers/default.svg', onplay: async () => { const seed = (await get('/api/tracks/' + s.seed)); const n = await startRadio(seed); toast(n ? `${s.name} radio started` : 'No tracks'); } }))))
  };
  const ytBox = h('div'); loadYt(ytBox, isStale);
  const { order, hidden } = app.prefs.home; const hint = !data.personalized ? h('p', { class: 'muted', style: { marginTop: '20px' } }, app.user ? 'Listen to a few songs and Quick picks will start learning from your history.' : 'Sign in and listen to get picks that learn from you. Everything here is demo content until you add your own music.') : null;
  body.replaceChildren(...[...order, ...Object.keys(S).filter(k => !order.includes(k))].filter(k => !hidden.includes(k)).map(k => S[k]?.()).filter(Boolean), hint);
}
