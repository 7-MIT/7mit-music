// YouTube tracks are metadata-only until the user saves/likes/lists them; then the server re-fetches the metadata
// from the official API and stores it (so favourites, playlists and history work). The client never sends metadata.
import { api } from './api.js';
import { app } from './app.js';
const done = new Set();
export async function ensureImported(tracks) {
  const ids = [...new Set(tracks.filter(t => t.provider === 'youtube' && !done.has(t.id)).map(t => t.videoId))]; if (!ids.length || !app.user) return;
  try { await api('/api/yt/import', { method: 'POST', body: { videoIds: ids } }); ids.forEach(i => done.add('yt_' + i)); } catch (e) { throw e; }
}
