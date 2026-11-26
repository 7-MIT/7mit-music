// Application-level state: account, preferences, library flags, theming. Preferences work for guests (localStorage) and sync for signed-in users.
import { get, put, post, del } from './api.js';
import { toast } from './dom.js';
import { ensureImported } from './yt.js';

export const DEFAULTS = {
  theme: 'dark', accent: 'terracotta', dynamic: true, slider: 'wavy', miniStyle: 'bar', language: 'en', region: 'global',
  home: { order: ['youtube', 'quick', 'recent', 'mixes', 'new', 'editorial', 'stations'], hidden: [] },
  lyrics: { size: 30, spacing: 1.4, align: 'left', glow: true, offsetMs: 0, providers: ['user', 'embedded', 'demo'], autoscroll: true },
  audio: { crossfade: 0, normalize: false, speed: 1, pitch: true, volume: 0.8, eq: { on: false, preset: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], wizard: false } },
  privacy: { history: true, scrobble: true }, ytConsent: false, lockQueue: false, autoRadio: true, aiConsent: false, alarm: { on: false, time: '07:30', playlist: '' }
};
const merge = (a, b) => { const o = { ...a }; for (const k in b || {}) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') ? merge(a[k], b[k]) : b[k]; return o; };
const L = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
export const ls = L;

export const app = new EventTarget();
app.user = null; app.config = null; app.prefs = merge(DEFAULTS, L.get('auralys.prefs', {})); app.favs = new Set(); app.saved = new Set(); app.ready = false;
const emit = n => app.dispatchEvent(new Event(n));

export function applyTheme() {
  const p = app.prefs, r = document.documentElement;
  let t = p.theme; if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  r.dataset.theme = t; r.dataset.accent = p.accent;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', { light: '#F3EFE6', black: '#000000' }[t] || '#0f0e0d');
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => app.prefs.theme === 'system' && applyTheme());

let pushT;
export function setPrefs(patch) {
  app.prefs = merge(app.prefs, patch); L.set('auralys.prefs', app.prefs); applyTheme(); emit('prefs');
  if (app.user) { L.set('auralys.dirty', true); clearTimeout(pushT); pushT = setTimeout(pushPrefs, patch.privacy ? 0 : 600); } // privacy changes sync immediately
}
// Pushes are serialised: at most one PUT in flight, and a follow-up always carries the latest prefs, so requests can never land out of order.
let pushing = false, pushAgain = false;
function pushPrefs() {
  if (pushing) { pushAgain = true; return; } pushing = true;
  put('/api/prefs', app.prefs).then(() => { if (!pushAgain) L.set('auralys.dirty', false); }).catch(() => {}).finally(() => { pushing = false; if (pushAgain) { pushAgain = false; pushPrefs(); } });
}
export async function boot() {
  applyTheme();
  try { app.config = await get('/api/config'); } catch { app.config = { regions: [['global', 'Global']], moods: [], features: {} }; }
  await refreshMe(); app.ready = true; emit('ready');
}
export async function refreshMe() {
  try {
    const r = await get('/api/auth/me'); app.user = r.user;
    if (r.user) { if (L.get('auralys.dirty', false) || !(r.prefs && Object.keys(r.prefs).length)) pushPrefs(); /* unsynced local changes win */ else { app.prefs = merge(DEFAULTS, r.prefs); L.set('auralys.prefs', app.prefs); } applyTheme(); await refreshLibraryFlags(); }
    else { app.favs = new Set(); app.saved = new Set(); }
  } catch { app.user = null; }
  emit('user');
}
export async function refreshLibraryFlags() { try { const r = await get('/api/library/ids'); app.favs = new Set(r.favorites); app.saved = new Set(r.saved.map(s => s.kind + ':' + s.ref_id)); } catch {} emit('library'); }
export function needAuth(msg = 'Sign in to use this.') { toast(msg, { label: 'Sign in', fn: () => import('./router.js').then(m => m.go('/login?next=' + encodeURIComponent(location.pathname + location.search))) }); }
export async function toggleFav(t) {
  if (!app.user) return needAuth('Sign in to like songs.');
  try { await ensureImported([t]); } catch (e) { return toast(e.message); }
  const on = !app.favs.has(t.id); on ? app.favs.add(t.id) : app.favs.delete(t.id); t.fav = on; emit('library');
  try { on ? await put('/api/favorites/' + t.id) : await del('/api/favorites/' + t.id); } catch (e) { on ? app.favs.delete(t.id) : app.favs.add(t.id); t.fav = !on; emit('library'); toast(e.message); }
}
export async function toggleSaved(kind, id) {
  if (!app.user) return needAuth('Sign in to save to your library.'); const k = kind + ':' + id, on = !app.saved.has(k); on ? app.saved.add(k) : app.saved.delete(k); emit('library');
  try { on ? await put(`/api/saved/${kind}/${id}`) : await del(`/api/saved/${kind}/${id}`); toast(on ? 'Saved to your library' : 'Removed from your library'); } catch (e) { on ? app.saved.delete(k) : app.saved.add(k); emit('library'); toast(e.message); }
  return on;
}
export const isFav = id => app.favs.has(id);
export const region = () => app.prefs.region;
