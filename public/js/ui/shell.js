// App shell: sidebar / bottom nav, top bar, persistent player bar + mini player, full player overlay, shortcuts, dynamic palette.
import { h, icon, fmtTime, $, $$, modal, reducedMotion, initials, toast } from '../core/dom.js';
import { app, setPrefs, toggleFav } from '../core/app.js';
import * as E from '../player/engine.js';
import { go, here } from '../core/router.js';
import { img, syncRows } from './components.js';
import { seekSlider } from './slider.js';
import { buildPlayer } from './player.js';

const { S, engine } = E;
const NAV = [['/', 'home', 'Home'], ['/explore', 'explore', 'Explore'], ['/search', 'search', 'Search'], ['/library', 'library', 'Library'], ['/listen-together', 'together', 'Listen Together'], ['/stats', 'stats', 'Statistics'], ['/settings', 'settings', 'Settings']];
const TOOLS = [['/recognition', 'mic', 'Recognition'], ['/history', 'history', 'History'], ['/queue', 'queue', 'Queue']];
const MOBILE = [['/', 'home', 'Home'], ['/explore', 'explore', 'Explore'], ['/search', 'search', 'Search'], ['/library', 'library', 'Library'], ['/settings', 'user', 'You']];
const isOn = (href, path) => href === '/' ? path === '/' : path === href || path.startsWith(href + '/') || (href === '/library' && false);

// ---- dynamic palette from artwork ----
const palCache = new Map();
export async function paletteFrom(url) {
  if (palCache.has(url)) return palCache.get(url);
  const c = await new Promise(res => { const i = new Image(); i.onload = () => { try { const k = document.createElement('canvas'); k.width = k.height = 24; const g = k.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0, 24, 24); const d = g.getImageData(0, 0, 24, 24).data; let r = 0, gg = 0, b = 0, w = 0; for (let p = 0; p < d.length; p += 4) { const mx = Math.max(d[p], d[p + 1], d[p + 2]), mn = Math.min(d[p], d[p + 1], d[p + 2]), sat = mx ? (mx - mn) / mx : 0, wt = .05 + sat * sat * 3 + (mx > 40 && mx < 230 ? .3 : 0); r += d[p] * wt; gg += d[p + 1] * wt; b += d[p + 2] * wt; w += wt; } res([r / w, gg / w, b / w].map(Math.round)); } catch { res(null); } }; i.onerror = () => res(null); i.src = url; });
  palCache.set(url, c); return c;
}
async function applyPalette() {
  const t = E.cur(), root = document.documentElement; if (!t || !app.prefs.dynamic) { root.style.removeProperty('--dyn'); if (app.prefs.accent === 'dynamic') root.style.removeProperty('--accent'); return; }
  const c = await paletteFrom(t.cover); if (!c || E.cur()?.id !== t.id) return; const [r, g, b] = c;
  // lift very dark colours so the player background keeps hue without going muddy
  const lum = (r * .3 + g * .59 + b * .11); const k = lum < 70 ? 1.6 : 1; root.style.setProperty('--dyn', `rgb(${Math.min(255, r * k) | 0} ${Math.min(255, g * k) | 0} ${Math.min(255, b * k) | 0})`);
  if (app.prefs.accent === 'dynamic') root.style.setProperty('--accent', `rgb(${r} ${g} ${b})`);
}

export function buildShell(root) {
  const view = h('div', { id: 'view' });
  const navLink = ([href, ic, label]) => h('a', { href, 'data-nav': href, title: label }, icon(ic), h('span', label));
  const sidebar = h('nav', { class: 'sidebar nav', 'aria-label': 'Primary' }, h('a', { class: 'brand', href: '/', 'aria-label': 'Auralys home' }, h('img', { src: '/assets/UC.png', alt: '' }), h('b', 'Auralys')), NAV.map(navLink), h('small', 'Tools'), TOOLS.map(navLink));
  const searchIn = h('input', { type: 'search', placeholder: 'Search songs, albums, artists…', 'aria-label': 'Search', autocomplete: 'off', onfocus: () => { if (!location.pathname.startsWith('/search')) { go('/search'); setTimeout(() => $('#search-input')?.focus(), 60); } else $('#search-input')?.focus(); } });
  const avatar = h('a', { class: 'avatar', href: '/account', 'aria-label': 'Account' }, icon('user'));
  const topbar = h('div', { class: 'topbar' }, h('label', { class: 'searchpill' }, icon('search'), searchIn, h('kbd', '/')), avatar);
  const mhead = h('div', { class: 'mhead' }, h('b', 'Auralys'), h('a', { class: 'searchpill', href: '/search', 'aria-label': 'Search music' }, icon('search'), h('span', 'Search music')));
  const main = h('main', { class: 'main', id: 'main', tabindex: -1 }, topbar, mhead, view);

  // desktop player bar
  const pArt = img('/media/covers/default.svg', ''), pTitle = h('div', { class: 't' }, 'Nothing playing'), pSub = h('div', { class: 's' }, 'Choose something to play');
  const btn = (ic, label, fn, cls = 'ib') => h('button', { class: cls, 'aria-label': label, title: label, onclick: fn }, icon(ic));
  const shuf = btn('shuffle', 'Shuffle', () => E.setShuffle()), prev = btn('prev', 'Previous', () => E.prev()), next = btn('next', 'Next', () => E.next()), rep = btn('repeat', 'Repeat', () => E.cycleRepeat());
  const play = h('button', { class: 'pbtn sm', 'aria-label': 'Play', onclick: () => E.toggle() }, icon('play'));
  const tCur = h('span', '0:00'), tDur = h('span', '0:00'), slider = seekSlider({ getPos: () => S.position, getDur: () => S.duration, onSeek: s => E.seek(s), label: 'Seek' });
  const like = btn('heart', 'Like', () => E.cur() && toggleFav(E.cur())), vol = h('input', { class: 'vol', type: 'range', min: 0, max: 1, step: .01, value: S.volume, 'aria-label': 'Volume', oninput: e => E.setVolume(+e.target.value) });
  const muteB = btn('volume', 'Mute', () => E.toggleMute());
  const bar = h('div', { class: 'playerbar', role: 'region', 'aria-label': 'Player' },
    h('div', { class: 'pb-now', onclick: () => E.cur() && openPlayer(), role: 'button', tabindex: 0, onkeydown: e => e.key === 'Enter' && E.cur() && openPlayer(), 'aria-label': 'Open full player' }, pArt, h('div', { style: { minWidth: 0 } }, pTitle, pSub)),
    h('div', { class: 'pb-mid' }, h('div', { class: 'ctrls' }, shuf, prev, play, next, rep), h('div', { class: 'pb-prog' }, tCur, h('div', { style: { flex: 1 } }, slider), tDur)),
    h('div', { class: 'pb-right' }, like, btn('lyrics', 'Lyrics', () => go('/lyrics')), btn('queue', 'Queue', () => go('/queue')), muteB, vol));

  // mobile mini player
  const mArt = img('/media/covers/default.svg', ''), mTitle = h('div', { class: 't' }), mSub = h('div', { class: 's' }), mBar = h('i'), mPlay = h('button', { class: 'pbtn sm', 'aria-label': 'Play', onclick: () => E.toggle() }, icon('play'));
  const mini = h('div', { class: 'mini', hidden: true, role: 'region', 'aria-label': 'Mini player' }, h('div', { class: 'row1' }, mArt, h('div', { class: 'm', role: 'button', tabindex: 0, onclick: () => openPlayer(), onkeydown: e => e.key === 'Enter' && openPlayer() }, mTitle, mSub), btn('prev', 'Previous', () => E.prev()), mPlay, btn('next', 'Next', () => E.next())), h('div', { class: 'bar' }, mBar));
  const bottom = h('nav', { class: 'bottomnav', 'aria-label': 'Primary' }, MOBILE.map(([href, ic, label]) => h('a', { href, 'data-nav': href }, icon(ic), h('span', label))));

  const player = buildPlayer({ close: () => closePlayer() });
  root.append(h('div', { id: 'app' }, sidebar, main, bar), mini, bottom, player.el, h('div', { class: 'sr', 'aria-live': 'polite', id: 'live' }));
  let lastMain = '/';

  function openPlayer(tab = 'player') { const path = '/' + tab; if (location.pathname !== path) go(path); }
  function closePlayer() { go(lastMain || '/'); }
  function showOverlay(tab) {
    if (player.el.hidden && document.startViewTransition && !reducedMotion() && tab === 'player') {
      const src = matchMedia('(max-width:760px)').matches ? mArt : pArt; src.style.viewTransitionName = 'art';
      const t = document.startViewTransition(() => { src.style.viewTransitionName = ''; player.show(tab); player.art.style.viewTransitionName = 'art'; }); t.finished.finally(() => player.art.style.viewTransitionName = '');
    } else player.show(tab);
  }
  function onRoute(path, meta) {
    $$('[data-nav]').forEach(a => a.classList.toggle('on', isOn(a.dataset.nav, path))); $$('[data-nav]').forEach(a => a.toggleAttribute('aria-current', isOn(a.dataset.nav, path)));
    if (meta.overlay) showOverlay(meta.overlay); else { if (!player.el.hidden) player.hide(); lastMain = path + location.search; document.title = (meta.title ? meta.title + ' · ' : '') + 'Auralys'; $('#main')?.focus({ preventScroll: true }); }
  }

  function update() {
    const t = E.cur(); pTitle.textContent = mTitle.textContent = t ? t.title : 'Nothing playing'; pSub.textContent = mSub.textContent = t ? `${t.artist}${t.album ? ' · ' + t.album : ''}` : 'Choose something to play';
    if (t) { pArt.src = mArt.src = t.cover; } mini.hidden = !t; mini.classList.toggle('pill', app.prefs.miniStyle === 'pill');
    const ic = icon(S.playing ? 'pause' : 'play'); play.replaceChildren(ic); mPlay.replaceChildren(icon(S.playing ? 'pause' : 'play')); play.setAttribute('aria-label', S.playing ? 'Pause' : 'Play'); mPlay.setAttribute('aria-label', S.playing ? 'Pause' : 'Play'); slider.setPlaying(S.playing);
    const liked = !!t && app.favs.has(t.id); like.classList.toggle('liked', liked); like.setAttribute('aria-pressed', liked);
    shuf.classList.toggle('on', S.shuffle); rep.classList.toggle('on', S.repeat !== 'off'); rep.replaceChildren(icon(S.repeat === 'one' ? 'repeat1' : 'repeat')); [prev, next, shuf, rep].forEach(b => b.toggleAttribute('disabled', S.locked));
    muteB.replaceChildren(icon(S.muted || S.volume === 0 ? 'mute' : 'volume')); vol.value = S.volume; document.body.classList.toggle('has-player', !!t); syncRows();
  }
  engine.addEventListener('time', () => { tCur.textContent = fmtTime(S.position); tDur.textContent = fmtTime(S.duration); mBar.style.width = (S.duration ? S.position / S.duration * 100 : 0) + '%'; });
  ['change', 'state', 'queue'].forEach(n => engine.addEventListener(n, update)); engine.addEventListener('change', applyPalette); app.addEventListener('library', () => { update(); });
  app.addEventListener('prefs', () => { update(); applyPalette(); });
  engine.addEventListener('locked', e => toast(e.detail)); engine.addEventListener('error', e => { toast(e.detail.message); const l = $('#live'); if (l) l.textContent = e.detail.message; });
  engine.addEventListener('need-consent', e => modal('Play with YouTube?', h('div', h('p', { class: 'muted' }, 'This track plays in YouTube’s official embedded player. Loading it connects your browser to YouTube (Google), which sets its own cookies and applies its own Terms and Privacy Policy, and may show ads.'), h('p', { class: 'muted' }, 'Auralys’s equalizer, normalisation and crossfade can’t be applied to YouTube playback, and it won’t keep playing in the background.')), [{ label: 'Cancel' }, { label: 'Agree and play', primary: true, onclick: () => { setPrefs({ ytConsent: true }); e.detail.resume(); } }]));
  engine.addEventListener('sleepend', () => toast('Sleep timer finished — playback stopped'));
  app.addEventListener('user', () => { avatar.replaceChildren(app.user ? initials(app.user.name) : icon('user')); avatar.setAttribute('aria-label', app.user ? `Account: ${app.user.name}` : 'Sign in'); avatar.href = app.user ? '/account' : '/login'; });
  slider.start(); update();

  // keyboard shortcuts
  addEventListener('keydown', e => {
    const tg = e.target, typing = tg.matches?.('input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable]'); if (e.defaultPrevented || e.metaKey || e.altKey) return;
    if ((e.key === '/' && !typing) || ((e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); searchIn.focus(); return; }
    if (typing) return; const onCtl = tg.matches?.('button,a,[role=slider],[role=button],input[type=range],select');
    if (e.key === ' ' && !onCtl) { e.preventDefault(); E.toggle(); }
    else if (e.key === 'ArrowRight' && !onCtl) { e.shiftKey ? E.next() : E.skipBy(5); } else if (e.key === 'ArrowLeft' && !onCtl) { e.shiftKey ? E.prev() : E.skipBy(-5); }
    else if (e.key === 'ArrowUp' && e.shiftKey) { E.setVolume(S.volume + .05); } else if (e.key === 'ArrowDown' && e.shiftKey) { E.setVolume(S.volume - .05); }
    else if (e.key.toLowerCase() === 'm') E.toggleMute(); else if (e.key.toLowerCase() === 's' && !e.ctrlKey) E.setShuffle(); else if (e.key.toLowerCase() === 'r' && !e.ctrlKey) E.cycleRepeat();
    else if (e.key.toLowerCase() === 'l' && E.cur() && !e.ctrlKey) toggleFav(E.cur()); else if (e.key.toLowerCase() === 'f' && E.cur()) { here()?.path === '/player' ? closePlayer() : openPlayer(); }
    else if (e.key === 'Escape' && !player.el.hidden && !$('.scrim')) closePlayer();
    else if (e.key === '?') shortcutsHelp();
  });
  return { view, onRoute, openPlayer };
}
export function shortcutsHelp() {
  const rows = [['Space', 'Play / pause'], ['← / →', 'Seek 5 seconds'], ['Shift + ← / →', 'Previous / next track'], ['Shift + ↑ / ↓', 'Volume'], ['M', 'Mute'], ['S', 'Shuffle'], ['R', 'Repeat'], ['L', 'Like'], ['F', 'Open / close full player'], ['/ or Ctrl+K', 'Search'], ['?', 'This help']];
  modal('Keyboard shortcuts', h('div', rows.map(([k, d]) => h('div', { class: 'setrow', style: { padding: '8px 0' } }, h('span', { class: 'kbd' }, k), h('span', { class: 'lab' }, d)))), [{ label: 'Close', primary: true }]);
}
