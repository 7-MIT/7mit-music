// Full-screen player overlay: artwork (swipe), wavy slider, controls, synchronised lyrics, queue.
import { h, icon, fmtTime, toast, sheet, $$, reducedMotion } from '../core/dom.js';
import { app, setPrefs, toggleFav } from '../core/app.js';
import { get } from '../core/api.js';
import * as E from '../player/engine.js';
import { img, editLyrics, pickPlaylist } from './components.js';
import { seekSlider } from './slider.js';
import { parseLrc, activeLine } from '../core/dom.js';
import { go } from '../core/router.js';

const { S, engine } = E;
const lyricCache = new Map();
export async function loadLyrics(t) {
  if (!t || t.local) return { available: false, reason: 'local' }; if (t.provider === 'youtube') return { available: false, reason: 'youtube' }; if (lyricCache.has(t.id)) return lyricCache.get(t.id);
  let r; try { const d = await get(`/api/tracks/${t.id}/lyrics`); const order = app.prefs.lyrics.providers; const rows = d.lyrics.slice().sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider)); const row = rows.find(x => order.includes(x.provider)); r = row ? { available: true, provider: row.provider, ...(row.format === 'lrc' ? parseLrc(row.content) : { synced: false, lines: row.content.split(/\r?\n/).filter(x => x.trim()).map(text => ({ t: null, text })) }) } : { available: false, reason: 'none' }; }
  catch (e) { return { available: false, reason: 'error', message: e.message }; }
  lyricCache.set(t.id, r); return r;
}
engine.addEventListener('lyrics-changed', () => lyricCache.clear());

export function buildPlayer({ close }) {
  const art = img('/media/covers/default.svg', 'Album artwork', 'fp-art'); art.loading = 'eager'; art.setAttribute('aria-label', 'Artwork — swipe left or right to change track');
  const title = h('h2'), artist = h('p'), cur = h('span', '0:00'), dur = h('span', '0:00');
  const slider = seekSlider({ getPos: () => S.position, getDur: () => S.duration, onSeek: s => E.seek(s), label: 'Seek' });
  const btn = (ic, label, fn, cls = 'ib') => h('button', { class: cls, 'aria-label': label, title: label, onclick: fn }, icon(ic));
  const likeB = btn('heart', 'Like', () => E.cur() && toggleFav(E.cur())), shuf = btn('shuffle', 'Shuffle', () => E.setShuffle()), rep = btn('repeat', 'Repeat', () => E.cycleRepeat());
  const playB = h('button', { class: 'pbtn', 'aria-label': 'Play', onclick: () => E.toggle() }, icon('play')), prevB = btn('prev', 'Previous', () => E.prev()), nextB = btn('next', 'Next', () => E.next());
  const tool = (ic, label, fn) => h('button', { class: 'ib', onclick: fn }, icon(ic), h('span', label));
  const speedB = tool('speed', '1×', () => speedSheet()), sleepB = tool('moon', 'Sleep', () => sleepSheet());
  const lyricsTab = tool('lyrics', 'Lyrics', () => go('/lyrics')), queueTab = tool('queue', 'Queue', () => go('/queue')), shareB = tool('share', 'Share', () => share());
  const status = h('div', { class: 'muted', style: { minHeight: '20px', fontSize: '13px', textAlign: 'center' }, 'aria-live': 'polite' });
  const lyr = lyricsPanel(), que = queuePanel();
  const tabs = h('div', { class: 'fp-tabs', role: 'tablist' }, [['player', 'Player'], ['lyrics', 'Lyrics'], ['queue', 'Queue']].map(([k, l]) => h('button', { role: 'tab', dataset: { t: k }, onclick: () => go('/' + k) }, l)));
  const closeB = h('button', { class: 'ib', 'aria-label': 'Close player', onclick: close }, icon('down'));
  const el = h('section', { class: 'fp', hidden: true, 'aria-label': 'Now playing', dataset: { tab: 'player' } },
    h('div', { class: 'fp-top' }, closeB, h('span', { class: 'lab' }, 'Now playing'), btn('queue', 'Open queue', () => go('/queue'))), tabs,
    h('div', { class: 'fp-body' },
      h('div', { class: 'fp-main' }, art, h('div', { class: 'fp-meta' }, h('div', { class: 'tt' }, title, artist), likeB), slider, h('div', { class: 'fp-time' }, cur, dur),
        h('div', { class: 'fp-ctrls' }, shuf, prevB, playB, nextB, rep), status, h('div', { class: 'fp-tools' }, lyricsTab, queueTab, speedB, sleepB, shareB)), lyr.el, que.el));
  // artwork swipe
  let sx = null, dx = 0; art.addEventListener('pointerdown', e => { sx = e.clientX; dx = 0; art.setPointerCapture(e.pointerId); art.classList.add('swipe'); });
  art.addEventListener('pointermove', e => { if (sx == null) return; dx = e.clientX - sx; art.style.transform = `translateX(${dx * .6}px) rotate(${dx / 40}deg)`; });
  const end = () => { if (sx == null) return; art.classList.remove('swipe'); art.style.transform = ''; if (Math.abs(dx) > 70) (dx < 0 ? E.next() : E.prev()); sx = null; };
  art.addEventListener('pointerup', end); art.addEventListener('pointercancel', end);

  function update() {
    const t = E.cur(); title.textContent = t?.title ?? 'Nothing playing'; artist.textContent = t ? `${t.artist}${t.album ? ' · ' + t.album : ''}` : 'Pick something to listen to';
    if (t && art.getAttribute('src') !== t.cover) art.src = t.cover; if (!t) art.src = '/media/covers/default.svg';
    const liked = !!t && app.favs.has(t.id); likeB.classList.toggle('liked', liked); likeB.setAttribute('aria-pressed', liked); likeB.setAttribute('aria-label', liked ? 'Unlike' : 'Like');
    playB.replaceChildren(icon(S.playing ? 'pause' : 'play')); playB.setAttribute('aria-label', S.playing ? 'Pause' : 'Play'); slider.setPlaying(S.playing);
    shuf.classList.toggle('on', S.shuffle); shuf.setAttribute('aria-pressed', S.shuffle); rep.classList.toggle('on', S.repeat !== 'off'); rep.replaceChildren(icon(S.repeat === 'one' ? 'repeat1' : 'repeat')); rep.setAttribute('aria-label', `Repeat: ${S.repeat}`);
    speedB.lastChild.textContent = `${S.speed}×`; sleepB.classList.toggle('on', !!S.sleep); sleepB.lastChild.textContent = S.sleep ? (S.sleep.endOfTrack ? 'End of track' : `${Math.max(0, Math.ceil((S.sleep.left ?? (S.sleep.endsAt - Date.now()) / 1000) / 60))} min`) : 'Sleep';
    const dis = S.locked; [prevB, nextB, shuf, rep].forEach(b => b.toggleAttribute('disabled', dis));
    status.textContent = S.error?.message || (S.buffering ? 'Buffering…' : S.locked ? S.lockReason : (t?.provider === 'youtube' ? 'YouTube playback — equalizer, normalisation and crossfade don’t apply.' : ''));
  }
  function tick() { cur.textContent = fmtTime(S.position); dur.textContent = fmtTime(S.duration); lyr.tick(); }
  ['change', 'state', 'queue', 'sleep'].forEach(n => engine.addEventListener(n, () => { update(); if (n === 'change' || n === 'queue') que.render(); if (n === 'change') lyr.load(); })); engine.addEventListener('time', tick);
  app.addEventListener('library', update); app.addEventListener('prefs', () => { lyr.style(); update(); });
  update(); tick(); E.dockYouTube(art);
  return { el, slider, show(tab = 'player') { el.dataset.tab = tab; $$('.fp-tabs button', el).forEach(b => { b.classList.toggle('on', b.dataset.t === tab); b.setAttribute('aria-selected', b.dataset.t === tab); }); if (el.hidden) { el.hidden = false; lyr.load(); que.render(); closeB.focus({ preventScroll: true }); } slider.start(); }, hide() { el.hidden = true; }, art };
}

function speedSheet() { sheet('Playback speed', [0.5, 0.75, 1, 1.25, 1.5, 2].map(v => ({ icon: v === S.speed ? 'check' : 'speed', label: `${v}×${v === 1 ? ' (normal)' : ''}`, onclick: () => E.setSpeed(v) }))); }
export function sleepSheet() {
  sheet('Sleep timer', [S.sleep && { icon: 'close', label: 'Turn off timer', onclick: () => E.setSleep(0) }, ...[5, 15, 30, 45, 60].map(m => ({ icon: 'clock', label: `${m} minutes (fades out)`, onclick: () => { E.setSleep(m); toast(`Sleep timer: ${m} min`); } })), { icon: 'music', label: 'End of this track', onclick: () => { E.setSleep(0, { endOfTrack: true }); toast('Will stop after this track'); } }]);
}
async function share() {
  const t = E.cur(); if (!t) return; const url = location.origin + (t.albumId ? '/album/' + t.albumId : t.podcastId ? '/podcast/' + t.podcastId : '/');
  if (navigator.share) { try { await navigator.share({ title: t.title, text: `${t.title} — ${t.artist}`, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); }
}

function lyricsPanel() {
  const body = h('div', { class: 'lyrics-wrap' }), el = h('div', { class: 'fp-panel', id: 'fp-lyrics', 'aria-label': 'Lyrics' }); let L = null, idx = -2, hold = 0, token = 0;
  const l = () => app.prefs.lyrics, set = p => setPrefs({ lyrics: p });
  const b = (label, fn, aria) => h('button', { class: 'ib', 'aria-label': aria || label, title: aria || label, onclick: fn }, label);
  const ctl = h('div', { class: 'lyr-ctl' }, b('A−', () => set({ size: Math.max(16, l().size - 2) }), 'Smaller text'), b('A+', () => set({ size: Math.min(56, l().size + 2) }), 'Larger text'), b('↕−', () => set({ spacing: Math.max(1, +(l().spacing - .1).toFixed(1)) }), 'Tighter spacing'), b('↕+', () => set({ spacing: Math.min(2.4, +(l().spacing + .1).toFixed(1)) }), 'Looser spacing'),
    b('⟷', () => set({ align: l().align === 'left' ? 'center' : 'left' }), 'Toggle alignment'), b('✦', () => set({ glow: !l().glow }), 'Toggle glow'), b('−0.5s', () => set({ offsetMs: l().offsetMs - 500 }), 'Lyrics earlier'), b('+0.5s', () => set({ offsetMs: l().offsetMs + 500 }), 'Lyrics later'), b('Auto-scroll', () => set({ autoscroll: !l().autoscroll }), 'Toggle auto-scroll'));
  el.append(ctl, body);
  const style = () => { body.style.fontSize = l().size + 'px'; body.style.lineHeight = l().spacing; body.style.textAlign = l().align; body.classList.toggle('glow', !!l().glow); }; style();
  ['wheel', 'touchmove', 'pointerdown'].forEach(ev => el.addEventListener(ev, () => hold = Date.now() + 4000, { passive: true }));
  async function load() {
    const t = E.cur(), my = ++token; idx = -2; L = null; body.replaceChildren(h('p', { class: 'muted' }, 'Loading lyrics…')); if (!t) return body.replaceChildren(h('p', { class: 'muted' }, 'Play something to see lyrics.'));
    L = await loadLyrics(t); if (my !== token) return;
    if (!L.available) return body.replaceChildren(h('div', { class: 'empty', style: { fontFamily: 'var(--sans)' } }, icon('lyrics'), h('h3', 'Lyrics unavailable'), h('p', L.reason === 'local' ? 'Local files don’t have lyrics here.' : L.reason === 'youtube' ? 'Lyrics aren’t provided for YouTube tracks. (Auralys doesn’t scrape lyrics.)' : L.reason === 'error' ? L.message : 'No lyrics are stored for this track, and Auralys never makes lyrics up.'), t.mine && h('button', { class: 'btn', onclick: () => editLyrics(t) }, 'Add lyrics')));
    body.replaceChildren(...L.lines.map((ln, i) => h('div', { class: 'lyr-line', dataset: { i }, role: L.synced ? 'button' : null, tabindex: L.synced ? 0 : null, onclick: () => L.synced && E.seek(Math.max(0, ln.t - l().offsetMs / 1000)), onkeydown: e => e.key === 'Enter' && L.synced && E.seek(Math.max(0, ln.t - l().offsetMs / 1000)) }, ln.text)),
      h('p', { class: 'muted', style: { fontFamily: 'var(--sans)', fontSize: '13px', marginTop: '28px' } }, `${L.synced ? 'Synchronised' : 'Plain'} lyrics · source: ${L.provider}${L.provider === 'demo' ? ' (original demo lyrics)' : ''}. Romanisation and translation aren’t available in this build.`)); tick();
  }
  function tick() {
    if (!L?.available || !L.synced) return; const i = activeLine(L.lines, S.position + l().offsetMs / 1000 + .15); if (i === idx) return; idx = i;
    const nodes = body.querySelectorAll('.lyr-line'); nodes.forEach((n, k) => { n.classList.toggle('active', k === i); n.classList.toggle('past', k < i); n.toggleAttribute('aria-current', k === i); });
    if (l().autoscroll && Date.now() > hold && nodes[i] && !el.closest('[hidden]') && el.offsetParent) { const top = nodes[i].offsetTop - el.clientHeight / 3; el.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' }); }
  }
  return { el, load, tick, style };
}

function queuePanel() {
  const list = h('div', { class: 'tracks', role: 'list' }), head = h('div'), el = h('div', { class: 'fp-panel', id: 'fp-queue', 'aria-label': 'Queue' }, head, list); let saved = null;
  const mini = (ic, label, fn, dis) => h('button', { class: 'ib', 'aria-label': label, title: label, disabled: dis, onclick: e => { e.stopPropagation(); fn(); } }, icon(ic));
  function render() {
    const n = S.queue.length; head.replaceChildren(h('div', { class: 'toolbar' }, h('h2', { style: { font: '600 24px var(--serif)' } }, 'Queue'), h('span', { class: 'muted' }, `${n} track${n === 1 ? '' : 's'}`), h('span', { class: 'grow' }),
      h('label', { class: 'chip', style: { background: '#ffffff1c', color: 'inherit' } }, h('input', { type: 'checkbox', checked: app.prefs.lockQueue, onchange: e => setPrefs({ lockQueue: e.target.checked }), 'aria-label': 'Lock queue editing' }), ' Lock'), h('button', { class: 'btn sm ghost', onclick: () => { saved = E.clearQueue(); toast('Queue cleared', { label: 'Undo', fn: () => E.restoreQueue(saved) }); }, disabled: n < 2 }, 'Clear'),
      h('button', { class: 'btn sm ghost', onclick: () => pickPlaylist(S.queue.filter(t => t.kind === 'song' && !t.local)), disabled: !n }, 'Save as playlist')),
      app.prefs.autoRadio ? h('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 10px' } }, 'When the queue ends, similar catalogue tracks keep playing (radio). Change this in Settings → Player.') : null);
    list.replaceChildren(...S.queue.map((t, i) => {
      const cur = i === S.index; const row = h('div', { class: 'row x' + (cur ? ' current' + (S.playing ? ' playing' : '') : ''), dataset: { id: t.id }, draggable: true, role: 'listitem', onclick: () => E.jumpTo(i) },
        h('span', { class: 'grip' }, icon('grip')), h('div', { class: 'lead' }, img(t.cover), h('div', { class: 'eq-anim' }, h('i'), h('i'), h('i'))), h('div', { class: 'rm' }, h('div', { class: 'rt' }, t.title), h('div', { class: 'rs' }, t.artist)),
        mini('up', `Move ${t.title} up`, () => E.moveItem(i, i - 1), i === 0), mini('arrowdown', `Move ${t.title} down`, () => E.moveItem(i, i + 1), i === n - 1), mini('close', `Remove ${t.title}`, () => { const u = E.removeAt(i); u && toast('Removed from queue', { label: 'Undo', fn: E.undoRemove }); }));
      row.style.gridTemplateColumns = 'auto auto minmax(0,1fr) auto auto auto';
      row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(i)); row.classList.add('dragging'); }); row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('dragover'); }); row.addEventListener('dragleave', () => row.classList.remove('dragover'));
      row.addEventListener('drop', e => { e.preventDefault(); row.classList.remove('dragover'); const f = +e.dataTransfer.getData('text/plain'); if (!isNaN(f)) E.moveItem(f, i); });
      return row;
    }));
    if (!n) list.replaceChildren(h('div', { class: 'empty' }, icon('queue'), h('h3', 'Your queue is empty'), h('p', 'Play a song, album or playlist and it will appear here.')));
  }
  return { el, render };
}
