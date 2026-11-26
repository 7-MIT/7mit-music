// YouTube provider — OFFICIAL YouTube Data API v3 only (metadata: search, trending, durations, thumbnails).
// Playback happens in the browser through YouTube's official IFrame Player. This module never touches streams,
// never uses unofficial "innertube"/YouTube Music endpoints, and never downloads media.
import { HttpError, clean } from './util.js';

const iso = d => { const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || ''); return m ? (((+m[1] || 0) * 24 + (+m[2] || 0)) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) * 1000 : 0; };
const cleanArtist = s => clean(String(s || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, ''), 120) || 'Unknown artist';
export const ytId = id => `yt_${id}`;
export const isVideoId = s => /^[\w-]{11}$/.test(s);

export function normalize(v) {
  const sn = v.snippet || {}, th = sn.thumbnails || {};
  return { videoId: v.id, title: clean(sn.title, 200), artist: cleanArtist(sn.channelTitle), cover: (th.high || th.medium || th.default || {}).url || null, durationMs: iso(v.contentDetails?.duration), embeddable: v.status?.embeddable !== false };
}

export function createYoutube(config) {
  const key = config.youtubeKey, base = config.ytApiBase || 'https://www.googleapis.com/youtube/v3', cache = new Map(), TTL = 10 * 60e3;
  const call = async (path, params) => {
    const url = `${base}/${path}?${new URLSearchParams({ ...params, key })}`; let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(12000) }); } catch { throw new HttpError(502, 'YouTube could not be reached.', 'provider_error'); }
    if (!r.ok) { const j = await r.json().catch(() => ({})); const reason = j?.error?.errors?.[0]?.reason || ''; if (/quota/i.test(reason)) throw new HttpError(429, 'The YouTube API quota for this server is used up for today. Try again tomorrow.', 'quota'); if (r.status === 400 || r.status === 403) throw new HttpError(502, 'YouTube rejected the API key (check YOUTUBE_API_KEY and that YouTube Data API v3 is enabled).', 'provider_auth'); throw new HttpError(502, 'YouTube returned an error.', 'provider_error'); }
    return r.json();
  };
  const memo = async (k, fn) => { const hit = cache.get(k); if (hit && hit.exp > Date.now()) return hit.v; const v = await fn(); cache.set(k, { v, exp: Date.now() + TTL }); if (cache.size > 300) for (const [kk, x] of cache) if (x.exp < Date.now()) cache.delete(kk); return v; };
  const details = async ids => { if (!ids.length) return []; const j = await call('videos', { part: 'snippet,contentDetails,status', id: ids.slice(0, 50).join(','), maxResults: 50 }); return (j.items || []).map(normalize).filter(t => t.embeddable && t.durationMs >= 20000 && t.durationMs <= 3 * 3600e3); };
  return {
    available: !!key,
    search: q => memo('s:' + q.toLowerCase(), async () => { const s = await call('search', { part: 'snippet', type: 'video', videoCategoryId: '10', videoEmbeddable: 'true', maxResults: 20, q }); return details((s.items || []).map(i => i.id?.videoId).filter(isVideoId)); }),
    trending: region => memo('t:' + region, async () => { const j = await call('videos', { part: 'snippet,contentDetails,status', chart: 'mostPopular', videoCategoryId: '10', regionCode: region, maxResults: 25 }); return (j.items || []).map(normalize).filter(t => t.embeddable && t.durationMs >= 20000); }),
    details
  };
}
