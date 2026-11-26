// Thin adapter over YouTube's OFFICIAL IFrame Player API. The player must stay visible (YouTube policy), so it lives
// in a floating card that docks over the artwork when the full player is open. No stream access, no DSP.
export const events = new EventTarget();
const emit = (n, d) => events.dispatchEvent(new CustomEvent(n, { detail: d }));
let player = null, loading = null, box = null, host = null, poll = null, curId = null, wantRate = 1, wantVol = 100;

function ensureBox() {
  if (box) return box;
  box = document.createElement('div'); box.id = 'ytbox'; box.hidden = true; box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'YouTube player');
  host = document.createElement('div'); host.id = 'ytplayer'; const cap = document.createElement('div'); cap.className = 'ytcap'; cap.textContent = 'Playing via YouTube';
  box.append(host, cap); document.body.append(box); return box;
}
function loadApi() {
  if (window.YT?.Player) return Promise.resolve();
  return loading ||= new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady; window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.async = true; s.onerror = () => { loading = null; rej(new Error('YouTube’s player script could not be loaded (blocked or offline).')); }; document.head.append(s);
    setTimeout(() => { if (!window.YT?.Player) { loading = null; rej(new Error('YouTube’s player timed out.')); } }, 15000);
  });
}
async function ensurePlayer() {
  ensureBox(); await loadApi(); if (player) return player;
  await new Promise(res => { player = new window.YT.Player(host, { width: '100%', height: '100%', host: 'https://www.youtube-nocookie.com', playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1, origin: location.origin, enablejsapi: 1 }, events: {
    onReady: () => res(),
    onStateChange: e => { const S = window.YT.PlayerState; emit('state', { playing: e.data === S.PLAYING, buffering: e.data === S.BUFFERING, ended: e.data === S.ENDED, paused: e.data === S.PAUSED }); },
    onError: e => emit('error', { code: e.data, message: { 2: 'YouTube rejected this video id.', 5: 'YouTube’s player hit an error with this video.', 100: 'This video was removed or is private.', 101: 'The owner doesn’t allow this video to be played outside YouTube.', 150: 'The owner doesn’t allow this video to be played outside YouTube.' }[e.data] || 'YouTube couldn’t play this video.' }),
    onPlaybackRateChange: () => {} } }); });
  clearInterval(poll); poll = setInterval(() => { if (player && curId) emit('time', { t: player.getCurrentTime?.() || 0, d: player.getDuration?.() || 0 }); }, 250);
  return player;
}
export async function load(videoId, { startAt = 0, autoplay = true } = {}) {
  try { const p = await ensurePlayer(); curId = videoId; box.hidden = false; (autoplay ? p.loadVideoById : p.cueVideoById).call(p, { videoId, startSeconds: startAt || 0 }); p.setVolume?.(wantVol); p.setPlaybackRate?.(wantRate); place(); }
  catch (e) { emit('error', { code: 'load', message: e.message }); }
}
export const play = () => player?.playVideo?.();
export const pause = () => player?.pauseVideo?.();
export const seek = s => player?.seekTo?.(s, true);
export const setVolume = v => { wantVol = Math.round(v * 100); player?.setVolume?.(wantVol); };
export const setRate = r => { wantRate = r; player?.setPlaybackRate?.(r); };
export const time = () => player?.getCurrentTime?.() || 0;
export function stop() { curId = null; try { player?.stopVideo?.(); } catch {} if (box) box.hidden = true; }
export const active = () => !!curId;

// Dock the player over the full-player artwork when it is open; otherwise float above the bar.
let dockEl = null;
export function dock(el) { dockEl = el; place(); }
export function place() {
  if (!box || box.hidden) return; const fp = document.querySelector('.fp:not([hidden])'), art = fp && dockEl?.isConnected ? dockEl : null;
  if (art) { const r = art.getBoundingClientRect(); Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: Math.max(r.height, 200) + 'px', right: 'auto', bottom: 'auto' }); box.classList.add('docked'); }
  else { ['left', 'top', 'width', 'height', 'right', 'bottom'].forEach(k => box.style[k] = ''); box.classList.remove('docked'); }
}
addEventListener('resize', place); new MutationObserver(place).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['hidden', 'data-tab'] });
