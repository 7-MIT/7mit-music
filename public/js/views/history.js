import { h, icon, fmtTime, toast, confirmBox } from '../core/dom.js';
import { app, setPrefs } from '../core/app.js';
import { get, del } from '../core/api.js';
import { setQueue } from '../player/engine.js';
import { empty, errorBox, signInPrompt, img, trackMenu } from '../ui/components.js';
import { skeletonRows } from '../core/dom.js';

export default async function history({ el, isStale }) {
  el.append(h('div', { class: 'pagehead' }, h('div', h('h1', 'History'), h('p', 'Every listening session, newest first. Only you can see this.'))));
  if (!app.user) return el.append(signInPrompt('your history'));
  const body = h('div'), paused = () => app.prefs.privacy.history === false;
  const toolbar = h('div', { class: 'toolbar' }, h('label', { class: 'setrow', style: { border: 0, padding: 0, gap: '10px' } }, h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !paused(), onchange: e => { setPrefs({ privacy: { history: e.target.checked } }); toast(e.target.checked ? 'History recording on' : 'History recording paused'); } }), h('i')), h('span', 'Record my listening history')), h('span', { class: 'grow' }), h('button', { class: 'btn ghost danger sm', onclick: async () => { if (await confirmBox('Clear all history?', 'This permanently deletes your listening history and statistics.', 'Clear history', true)) { await del('/api/history'); toast('History cleared'); load(); } } }, icon('trash'), 'Clear history'));
  el.append(toolbar, body);
  async function load() {
    body.replaceChildren(skeletonRows());
    try { const r = await get('/api/history'); if (isStale()) return; if (!r.items.length) return body.replaceChildren(empty('history', 'Nothing here yet', 'Songs you play will show up here.'));
      let day = ''; const out = []; const list = r.items.map(i => i.track);
      r.items.forEach((it, i) => { const d = new Date(it.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); if (d !== day) { day = d; out.push(h('h2', { class: 'sec', style: { fontSize: '16px', margin: '22px 0 8px' } }, d)); }
        out.push(h('div', { class: 'row', onclick: () => setQueue([it.track], 0) }, h('div', { class: 'lead' }, img(it.track.cover)), h('div', { class: 'rm' }, h('div', { class: 'rt' }, it.track.title), h('div', { class: 'rs' }, `${it.track.artist} · ${new Date(it.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · listened ${fmtTime(it.listenedMs / 1000)}${it.completed ? ' · finished' : ''}`)), h('span'), h('span'), h('button', { class: 'ib', 'aria-label': 'More options', onclick: e => { e.stopPropagation(); trackMenu(it.track); } }, icon('dots')))); });
      body.replaceChildren(...out); } catch (e) { body.replaceChildren(errorBox(e, load)); }
  }
  await load();
}
