// Playback engine: two <audio> elements (gapless + crossfade) → Web Audio graph (10-band EQ, normaliser, master gain, analyser).
// One engine instance owns playback for the whole app so it survives route changes.
import { app, ls, setPrefs } from '../core/app.js';
import { api } from '../core/api.js';
import * as YT from './youtube.js';
import { ensureImported } from '../core/yt.js';

export const engine = new EventTarget();
export const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], 'Treble boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6], Vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  Classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4], Jazz: [3, 2, 1, 2, -2, -2, 0, 1, 2, 3], Rock: [5, 4, 2, -1, -2, -1, 1, 3, 4, 5], Pop: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2], 'Hip-Hop': [6, 5, 2, 3, -1, -1, 1, 0, 2, 3], 'Late night': [3, 2, 1, 0, 0, -1, -2, -3, -3, -4]
};
export const S = engine.state = { queue: [], index: -1, playing: false, buffering: false, position: 0, duration: 0, volume: 0.8, muted: false, shuffle: false, repeat: 'off', speed: 1, error: null, locked: false, lockReason: '', sleep: null, graph: false, ctxState: 'none', source: 'catalog' };
const emit = (n, d) => engine.dispatchEvent(new CustomEvent(n, { detail: d }));
export const cur = () => S.queue[S.index] || null;

const els = [new Audio(), new Audio()]; els.forEach(e => { e.preload = 'auto'; });
let ai = 0; const A = () => els[ai], B = () => els[1 - ai];
let ytActive = false, ytPending = null; const isYT = () => cur()?.provider === 'youtube';
let ctx, gains = [], filters = [], comp, preamp, master, analyser; let history = [], played = new Set(), preloaded = null, fading = false, pendingSeek = 0, undoStash = null;
export const analyserNode = () => analyser;

function ensureGraph() {
  if (ctx || !(window.AudioContext || window.webkitAudioContext)) return !!ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const mix = ctx.createGain(); gains = els.map(e => { const src = ctx.createMediaElementSource(e), g = ctx.createGain(); src.connect(g); g.connect(mix); return g; });
    gains[1 - ai].gain.value = 0;
    filters = BANDS.map((f, i) => { const b = ctx.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = 1.1; return b; });
    preamp = ctx.createGain(); comp = ctx.createDynamicsCompressor(); master = ctx.createGain(); analyser = ctx.createAnalyser(); analyser.fftSize = 256;
    let n = mix; [preamp, ...filters, comp, master, analyser].forEach(x => { n.connect(x); n = x; }); n.connect(ctx.destination);
    els.forEach(e => e.volume = 1); S.graph = true; applyAudio(); ctx.onstatechange = () => { S.ctxState = ctx.state; }; S.ctxState = ctx.state; return true;
  } catch (e) { console.warn('Web Audio unavailable', e); ctx = null; S.graph = false; return false; }
}
export function applyAudio() {
  const a = app.prefs.audio; S.speed = a.speed || 1;
  YT.setRate(Math.max(0.25, Math.min(2, S.speed))); YT.setVolume(S.muted ? 0 : S.volume);
  els.forEach(e => { e.playbackRate = S.speed; e.preservesPitch = a.pitch !== false; e.mozPreservesPitch = a.pitch !== false; e.webkitPreservesPitch = a.pitch !== false; });
  if (!ctx) { A().volume = S.muted ? 0 : S.volume; return; }
  const on = a.eq.on, g = a.eq.gains; filters.forEach((f, i) => f.gain.value = on ? g[i] : 0);
  preamp.gain.value = on ? Math.pow(10, -Math.max(0, ...g) / 40) : 1; // headroom for boosts
  if (a.normalize) { comp.threshold.value = -26; comp.knee.value = 24; comp.ratio.value = 4; comp.attack.value = .01; comp.release.value = .25; } else { comp.threshold.value = 0; comp.ratio.value = 1; comp.knee.value = 0; }
  if (!fading && !sleepFading) master.gain.value = S.muted ? 0 : S.volume;
}
export function eqResponse(points = 120) { // dB magnitude over log-spaced frequencies (null until Web Audio is available)
  ensureGraph(); if (!ctx) return null; const f = new Float32Array(points).map((_, i) => 20 * Math.pow(1000, i / (points - 1))), tot = new Float32Array(points), m = new Float32Array(points), p = new Float32Array(points);
  filters.forEach(x => { x.getFrequencyResponse(f, m, p); for (let i = 0; i < points; i++) tot[i] += 20 * Math.log10(m[i] || 1e-6); }); return { freqs: f, db: tot };
}
export const graphReady = () => ensureGraph();

// ---------- listening events / scrobbling ----------
let sess = null;
function startSession(t) { if (sess) flush(true); if (t.provider === 'youtube') ensureImported([t]).catch(() => {}); sess = { sid: crypto.randomUUID?.() || String(Math.random()).slice(2), trackId: t.id, startedAt: Date.now(), ms: 0, last: null, sent: 0, scrobbled: false, source: S.source }; }
function flush(final, completed = false) {
  const s = sess; if (!s) return; if (final) sess = null; const t = S.queue.find(x => x.id === s.trackId) || { durationMs: 0, kind: 'song' };
  if (!app.user || s.ms < 1500 || app.prefs.privacy?.history === false || s.source === 'local') return;
  if (!final && s.ms - s.sent < 4000) return; s.sent = s.ms;
  api('/api/events', { method: 'POST', body: { sid: s.sid, trackId: s.trackId, startedAt: s.startedAt, listenedMs: Math.round(s.ms), completed, source: s.source }, headers: { }, }).catch(() => {});
  if (!s.scrobbled && app.prefs.privacy?.scrobble !== false && t.kind === 'song' && s.ms >= Math.min(t.durationMs * .5, 240000) && s.ms >= 30000) { s.scrobbled = true; api('/api/integrations/lastfm/scrobble', { method: 'POST', body: { trackId: s.trackId, startedAt: s.startedAt } }).catch(() => {}); }
}
setInterval(() => flush(false), 15000); addEventListener('pagehide', () => flush(false));

// ---------- core ----------
function load(el, t, startAt = 0) { el.src = t.url; el.load(); if (startAt) el.addEventListener('loadedmetadata', () => { try { el.currentTime = startAt; } catch {} }, { once: true }); }
function setTrackMeta() {
  const t = cur(); emit('change'); persist(); if (!t) return;
  if ('mediaSession' in navigator) { try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '', artwork: [{ src: new URL(t.cover, location.href).href, sizes: '512x512', type: 'image/svg+xml' }] }); } catch {} }
}
export function setQueue(tracks, index = 0, { autoplay = true, startAt = 0, source = 'catalog', keepHistory = false } = {}) {
  if (S.locked) return lockedMsg(); if (!tracks.length) return;
  if (tracks[index]?.provider === 'youtube' && !app.prefs.ytConsent) return emit('need-consent', { resume: () => setQueue(tracks, index, { autoplay, startAt, source, keepHistory }) });
  S.queue = tracks.slice(); S.source = source; if (!keepHistory) { history = []; played = new Set(); } goTo(index, { autoplay, startAt, fade: 0 });
}
function goTo(i, { autoplay = true, startAt = 0, fade = 0 } = {}) {
  const t = S.queue[i]; if (!t) return; S.error = null; played.add(t.id);
  if (t.provider === 'youtube') return goToYT(i, t, { autoplay, startAt });
  if (ytActive) { YT.stop(); ytActive = false; ytPending = null; }
  if (autoplay) ensureGraph(); else if (!ctx) ensureGraph();
  if (fade > 0 && ctx && A().src && !A().paused && !A().ended) {
    const next = B(), old = A(), g = ctx.currentTime; fading = true;
    if (preloaded?.id === t.id) { /* already loaded */ } else load(next, t, startAt);
    gains[1 - ai].gain.cancelScheduledValues(g); gains[1 - ai].gain.setValueAtTime(0, g); gains[1 - ai].gain.linearRampToValueAtTime(1, g + fade);
    gains[ai].gain.cancelScheduledValues(g); gains[ai].gain.setValueAtTime(gains[ai].gain.value, g); gains[ai].gain.linearRampToValueAtTime(0, g + fade);
    next.play().catch(onPlayErr); const oldEl = old; setTimeout(() => { oldEl.pause(); fading = false; }, fade * 1000 + 100); ai = 1 - ai;
  } else {
    const el = A(); B().pause(); if (preloaded?.id === t.id && B().src && !startAt) { const old = el; old.pause(); ai = 1 - ai; if (ctx) { gains[ai].gain.cancelScheduledValues(0); gains[ai].gain.value = 1; gains[1 - ai].gain.value = 0; } }
    else { if (ctx) { gains[ai].gain.cancelScheduledValues(0); gains[ai].gain.value = 1; gains[1 - ai].gain.value = 0; } load(el, t, startAt); }
    if (autoplay) { ctx?.resume?.(); A().play().catch(onPlayErr); }
  }
  preloaded = null; S.index = i; S.position = startAt; S.duration = (t.durationMs || 0) / 1000; startSession(t); setTrackMeta(); applyAudio(); emit('time');
}
function goToYT(i, t, { autoplay = true, startAt = 0 }) {
  if (!app.prefs.ytConsent) { emit('need-consent', { resume: () => goToYT(i, t, { autoplay, startAt }) }); return; }
  A().pause(); B().pause(); preloaded = null; ytActive = true; ytPending = null; S.index = i; S.position = startAt; S.duration = (t.durationMs || 0) / 1000; S.playing = false; S.buffering = autoplay; startSession(t); setTrackMeta(); applyAudio();
  YT.load(t.videoId, { startAt, autoplay }); emit('state'); emit('time');
}
function onPlayErr(e) { if (e?.name === 'NotAllowedError') { S.error = { code: 'autoplay', message: 'Your browser blocked autoplay — press play to start.' }; S.playing = false; emit('state'); emit('error', S.error); } else if (e?.name !== 'AbortError') { onMediaError(); } }
function onMediaError() {
  const t = cur(); S.error = { code: 'unavailable', message: `“${t?.title ?? 'This track'}” is unavailable.` }; S.buffering = false; S.playing = false; emit('state'); emit('error', S.error);
  if (S.queue.length > 1 && S.index < S.queue.length - 1) setTimeout(() => next(true), 900);
}
const lockedMsg = () => emit('locked', S.lockReason || 'Playback is controlled by the room host.');

export function play() { if (S.locked) return lockedMsg(); if (!cur()) return;
  if (isYT()) { S.error = null; if (ytPending || !ytActive) return goTo(S.index, { autoplay: true, startAt: ytPending?.startAt ?? S.position }); YT.play(); emit('user', 'play'); return; } ensureGraph(); ctx?.resume?.(); S.error = null; A().play().catch(onPlayErr); emit('user', 'play'); }
export function pause() { if (S.locked) return lockedMsg(); if (isYT()) { YT.pause(); emit('user', 'pause'); return; } A().pause(); B().pause(); emit('user', 'pause'); }
export const isPaused = () => isYT() ? !S.playing : A().paused;
export const toggle = () => isPaused() ? play() : pause();
export function seek(sec, { silent = false } = {}) { if (S.locked && !silent) return lockedMsg();
  if (isYT()) { if (!ytActive) { ytPending = { startAt: sec }; S.position = sec; emit('time'); return; } YT.seek(sec); S.position = sec; emit('time'); if (!silent) emit('user', 'seek'); return; }
  const el = A(); if (!isFinite(el.duration) && !silent) { pendingSeek = sec; return; } try { el.currentTime = Math.max(0, Math.min(sec, el.duration || sec)); } catch {} S.position = el.currentTime; emit('time'); if (!silent) emit('user', 'seek'); }
export const skipBy = d => seek((S.position || 0) + d);
function pickNext(auto) {
  const n = S.queue.length; if (!n) return -1;
  if (S.repeat === 'one' && auto) return S.index;
  if (S.shuffle && n > 1) { let pool = S.queue.map((t, i) => i).filter(i => i !== S.index && !played.has(S.queue[i].id)); if (!pool.length) { if (S.repeat === 'off' && auto) return -1; played = new Set([cur().id]); pool = S.queue.map((t, i) => i).filter(i => i !== S.index); } return pool[Math.floor(Math.random() * pool.length)]; }
  if (S.index + 1 < n) return S.index + 1; return S.repeat === 'all' || !auto ? 0 : -1;
}
export async function next(auto = false) {
  if (S.locked && auto) { hardPause(); S.playing = false; emit('state'); return; } // room listeners follow the host
  if (S.locked && !auto) return lockedMsg(); const i = pickNext(auto);
  if (i < 0) { if (auto && app.prefs.autoRadio && cur()?.kind === 'song' && S.source === 'catalog') { if (await continueRadio()) return; } hardPause(); S.playing = false; emit('state'); flush(true, true); seek(0, { silent: true }); return; }
  history.push(S.index); if (history.length > 100) history.shift(); flush(true, !!auto);
  goTo(i, { fade: auto && cfSec() > 0 && S.repeat !== 'one' ? cfSec() : 0 }); if (!auto) emit('user', 'next');
}
export function prev() { if (S.locked) return lockedMsg(); if (S.position > 3 || !history.length) return seek(0); flush(true); goTo(history.pop()); emit('user', 'prev'); }
export function jumpTo(i) { if (S.locked) return lockedMsg(); history.push(S.index); flush(true); goTo(i); emit('user', 'jump'); }
const cfSec = () => ctx ? (app.prefs.audio.crossfade || 0) : 0;
async function continueRadio() {
  const t = cur(); try { const r = await api(`/api/radio?seed=${t.id}&exclude=${S.queue.map(x => x.id).join(',')}`); if (!r.tracks.length) return false; const at = S.queue.length; S.queue.push(...r.tracks); emit('queue'); goTo(at, { fade: 0 }); return true; } catch { return false; }
}
export async function startRadio(seed) { const r = await api(`/api/radio?seed=${seed.id}`); setQueue([seed, ...r.tracks], 0, { keepHistory: false }); return r.tracks.length; }

function hardPause() { A().pause(); B().pause(); if (ytActive) YT.pause(); }
export function setShuffle(v) { S.shuffle = v ?? !S.shuffle; played = new Set(cur() ? [cur().id] : []); emit('state'); persist(); }
export function cycleRepeat() { S.repeat = { off: 'all', all: 'one', one: 'off' }[S.repeat]; emit('state'); persist(); }
export function setVolume(v, { silent } = {}) { S.volume = Math.max(0, Math.min(1, v)); S.muted = false; YT.setVolume(S.volume); if (ctx) master.gain.value = S.volume; else A().volume = S.volume; if (!silent) setPrefs({ audio: { volume: S.volume } }); emit('state'); }
export function toggleMute() { S.muted = !S.muted; YT.setVolume(S.muted ? 0 : S.volume); if (ctx) master.gain.value = S.muted ? 0 : S.volume; else A().volume = S.muted ? 0 : S.volume; emit('state'); }
export function setSpeed(v) { setPrefs({ audio: { speed: v } }); applyAudio(); emit('state'); }

// queue ops
export function playNext(t) { if (S.locked && S.source !== 'room') return lockedMsg(); S.queue.splice(S.index + 1, 0, t); emit('queue'); persist(); }
export function enqueue(t) { if (app.prefs.lockQueue) return emit('locked', 'Queue editing is locked in settings.'); S.queue.push(t); emit('queue'); persist(); }
export function removeAt(i) { if (app.prefs.lockQueue) return emit('locked', 'Queue editing is locked in settings.'); const [t] = S.queue.splice(i, 1); undoStash = { t, i }; if (i < S.index) S.index--; else if (i === S.index) { S.index = Math.min(S.index, S.queue.length - 1); if (S.queue.length) goTo(S.index); else { A().pause(); A().removeAttribute('src'); S.index = -1; } } emit('queue'); emit('change'); persist(); return undoStash; }
export function moveItem(from, to) { if (app.prefs.lockQueue) return emit('locked', 'Queue editing is locked in settings.'); if (from === to || to < 0 || to >= S.queue.length) return; const [t] = S.queue.splice(from, 1); S.queue.splice(to, 0, t); if (S.index === from) S.index = to; else if (from < S.index && to >= S.index) S.index--; else if (from > S.index && to <= S.index) S.index++; emit('queue'); persist(); }
export function clearQueue({ keepCurrent = true } = {}) { if (app.prefs.lockQueue) return emit('locked', 'Queue editing is locked in settings.'); const saved = { queue: S.queue.slice(), index: S.index }; if (keepCurrent && cur()) { S.queue = [cur()]; S.index = 0; } else { S.queue = []; S.index = -1; A().pause(); } emit('queue'); emit('change'); persist(); return saved; }
export function restoreQueue(saved) { if (!saved) return; const c = cur(); S.queue = saved.queue; S.index = c ? Math.max(0, S.queue.findIndex(t => t.id === c.id)) : saved.index; emit('queue'); emit('change'); persist(); }
export function undoRemove() { if (!undoStash) return; const { t, i } = undoStash; S.queue.splice(i, 0, t); if (i <= S.index) S.index++; undoStash = null; emit('queue'); persist(); }

// sleep timer
let sleepTimer = null, sleepFading = false;
export function setSleep(minutes, { endOfTrack = false } = {}) {
  clearInterval(sleepTimer); sleepFading = false; S.sleep = null; if (ctx && master) master.gain.value = S.muted ? 0 : S.volume;
  if (!minutes && !endOfTrack) return emit('sleep');
  S.sleep = { endsAt: endOfTrack ? null : Date.now() + minutes * 60000, endOfTrack }; emit('sleep');
  sleepTimer = setInterval(() => {
    const s = S.sleep; if (!s) return clearInterval(sleepTimer);
    const left = s.endOfTrack ? ((S.duration || 0) - S.position) : (s.endsAt - Date.now()) / 1000; if (s.endOfTrack) { s.left = left; } else s.left = left; emit('sleep');
    if (left <= 20 && left > 0 && !sleepFading) { sleepFading = true; if (isYT()) { let v = S.volume; const step = v / (left * 4); const iv = setInterval(() => { v = Math.max(0, v - step); YT.setVolume(v); if (v <= 0) clearInterval(iv); }, 250); } else if (ctx) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime); master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + left); } else { let v = A().volume; const step = v / (left * 4); const iv = setInterval(() => { v = Math.max(0, v - step); A().volume = v; if (v <= 0) clearInterval(iv); }, 250); } }
    if (left <= 0.3) { hardPause(); clearInterval(sleepTimer); S.sleep = null; sleepFading = false; setTimeout(() => { YT.setVolume(S.muted ? 0 : S.volume); if (ctx) master.gain.value = S.muted ? 0 : S.volume; else A().volume = S.volume; }, 400); emit('sleep'); emit('sleepend'); }
  }, 500);
}

// ---------- element events ----------
els.forEach(el => {
  const act = () => el === A();
  el.addEventListener('play', () => { if (act()) { S.playing = true; emit('state'); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; } });
  el.addEventListener('pause', () => { if (act() && !fading && !el.ended) { S.playing = false; emit('state'); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; flush(false); } });
  el.addEventListener('waiting', () => { if (act()) { S.buffering = true; emit('state'); } });
  el.addEventListener('playing', () => { if (act()) { S.buffering = false; S.playing = true; emit('state'); } });
  el.addEventListener('canplay', () => { if (act()) { S.buffering = false; emit('state'); } });
  el.addEventListener('loadedmetadata', () => { if (act()) { S.duration = el.duration || S.duration; if (pendingSeek) { el.currentTime = pendingSeek; pendingSeek = 0; } emit('time'); } });
  el.addEventListener('error', () => { if (act() && el.getAttribute('src')) onMediaError(); });
  el.addEventListener('ended', () => { if (act()) { S.playing = false; if (S.sleep?.endOfTrack) { setSleep(0); flush(true, true); emit('state'); return; } next(true); } });
  el.addEventListener('timeupdate', () => {
    if (!act()) return; const now = el.currentTime; S.position = now; S.duration = el.duration || S.duration;
    if (sess) { if (sess.last != null) { const d = now - sess.last; if (d > 0 && d < 1.5) sess.ms += d * 1000 / (S.speed || 1) * (S.speed || 1); } sess.last = now; }
    const left = (el.duration || 0) - now;
    if (left > 0 && left < 10 && !preloaded && !S.locked || (left > 0 && left < 10 && !preloaded)) { const i = pickNextPeek(); if (i >= 0 && i !== S.index) { const t = S.queue[i]; preloaded = { id: t.id, idx: i }; load(B(), t); } }
    if (cfSec() > 0 && left > 0 && left <= cfSec() && !fading && S.playing && S.repeat !== 'one' && !S.locked) { next(true); }
    emit('time');
  });
});
let peek = -1; function pickNextPeek() { if (S.shuffle) { return -1; } return S.index + 1 < S.queue.length ? S.index + 1 : (S.repeat === 'all' ? 0 : -1); }
els.forEach(el => el.addEventListener('seeked', () => { if (sess) sess.last = el.currentTime; }));

// ---------- YouTube embed events ----------
YT.events.addEventListener('state', e => { if (!ytActive) return; const d = e.detail; S.buffering = d.buffering; if (d.ended) { S.playing = false; emit('state'); if (S.sleep?.endOfTrack) { setSleep(0); flush(true, true); return; } next(true); return; } S.playing = d.playing; emit('state'); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = d.playing ? 'playing' : 'paused'; if (!d.playing) flush(false); });
YT.events.addEventListener('time', e => { if (!ytActive) return; const { t, d } = e.detail; if (S.playing && sess) { if (sess.last != null) { const dt = t - sess.last; if (dt > 0 && dt < 1.5) sess.ms += dt * 1000; } sess.last = t; } else if (sess) sess.last = t; S.position = t; if (d) S.duration = d; emit('time'); });
YT.events.addEventListener('error', e => { if (!ytActive && !isYT()) return; S.error = { code: 'unavailable', message: e.detail.message }; S.buffering = false; S.playing = false; emit('state'); emit('error', S.error); if (S.queue.length > 1 && S.index < S.queue.length - 1) setTimeout(() => next(true), 1500); });

// ---------- media session ----------
if ('mediaSession' in navigator) {
  const m = navigator.mediaSession, set = (a, f) => { try { m.setActionHandler(a, f); } catch {} };
  set('play', play); set('pause', pause); set('nexttrack', () => next(false)); set('previoustrack', prev);
  set('seekto', d => seek(d.seekTime)); set('seekforward', d => skipBy(d.seekOffset || 10)); set('seekbackward', d => skipBy(-(d.seekOffset || 10)));
  engine.addEventListener('time', () => { try { if (isFinite(S.duration) && S.duration > 0) m.setPositionState({ duration: S.duration, position: Math.min(S.position, S.duration), playbackRate: S.speed }); } catch {} });
}

// ---------- persistence ----------
let pt, st;
function snapshot() { return { queue: S.queue.map(t => ({ ...t })), index: S.index, position: S.position, shuffle: S.shuffle, repeat: S.repeat, source: S.source }; }
function persist() { clearTimeout(pt); pt = setTimeout(save, 800); }
function save() { if (S.source === 'room' || S.source === 'local') return; const snap = snapshot(); ls.set('auralys.state', { ...snap, savedAt: Date.now() }); if (app.user) { clearTimeout(st); st = setTimeout(() => api('/api/state', { method: 'PUT', body: { ...snap, queue: snap.queue.slice(0, 200).map(t => t.id), q: undefined } }).catch(() => {}), 3000); } }
setInterval(() => { if (S.playing) save(); }, 5000); addEventListener('pagehide', save);
export async function restore() {
  S.volume = app.prefs.audio.volume ?? 0.8; applyAudio(); let snap = ls.get('auralys.state', null);
  if (app.user) { try { const sv = await api('/api/state'); if (sv.queue?.length && (!snap || sv.updatedAt > (snap.savedAt || 0)) && typeof sv.queue[0] === 'string') { const ts = await Promise.all(sv.queue.slice(0, 100).map(id => api('/api/tracks/' + id).catch(() => null))); snap = { ...sv, queue: ts.filter(Boolean) }; snap.index = Math.min(sv.index ?? 0, snap.queue.length - 1); } } catch {} }
  if (!snap?.queue?.length) return; S.shuffle = !!snap.shuffle; S.repeat = snap.repeat || 'off'; S.queue = snap.queue; S.index = Math.max(0, Math.min(snap.index, snap.queue.length - 1)); S.source = 'catalog';
  const t = cur(); if (t.provider === 'youtube') ytPending = { startAt: snap.position || 0 }; else load(A(), t, snap.position || 0); S.position = snap.position || 0; S.duration = (t.durationMs || 0) / 1000; setTrackMeta(); emit('time'); emit('state');
}
export function playLocalFile(file) { const url = URL.createObjectURL(file); const t = { id: 'local_' + Date.now(), title: file.name.replace(/\.[^.]+$/, ''), artist: 'This device', album: null, cover: '/media/covers/default.svg', durationMs: 0, kind: 'song', url, hasLyrics: false, local: true }; setQueue([t], 0, { source: 'local' }); }
export function destroyForTest() { els.forEach(e => e.pause()); }
export function lock(v, reason = '') { S.locked = !!v; S.lockReason = reason; emit('state'); }
export const media = () => A();
export const dockYouTube = el => YT.dock(el);
