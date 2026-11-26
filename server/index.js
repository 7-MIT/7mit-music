import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { openDb, ROOT, DATA_DIR } from './db.js';
import { createApi } from './api.js';
import { createRooms } from './rooms.js';
import { seedDemo } from './seed.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const CSP = "default-src 'self'; img-src 'self' data: blob: https://i.ytimg.com https://*.ytimg.com; media-src 'self' blob:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; script-src 'self' https://www.youtube.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export function startServer({ port = Number(process.env.PORT || 3000), dbFile, seed = true, quiet = false } = {}) {
  const config = { anthropicKey: process.env.ANTHROPIC_API_KEY, aiModel: process.env.AI_MODEL || 'claude-haiku-5-5', lastfmKey: process.env.LASTFM_API_KEY, lastfmSecret: process.env.LASTFM_SHARED_SECRET, auddToken: process.env.AUDD_API_TOKEN, youtubeKey: process.env.YOUTUBE_API_KEY, ytApiBase: process.env.YT_API_BASE, publicUrl: process.env.PUBLIC_URL || `http://localhost:${port}` };
  const db = openDb(dbFile);
  const defCover = join(DATA_DIR, 'media', 'covers', 'default.svg');
  writeFileSync(defCover, `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#2a2522"/><path d="M120 340a180 180 0 0 1 360 0z" fill="#8a4a33"/><rect x="160" y="408" width="280" height="8" rx="4" fill="#f3efe6" opacity=".7"/></svg>`);
  if (seed) { const made = seedDemo(db); if (made && !quiet) console.log('Seeded demo catalogue'); }
  const rooms = createRooms({ db });
  const api = createApi({ db, config, rooms });
  const pub = join(ROOT, 'public'), media = join(DATA_DIR, 'media');

  function serveFile(req, res, file) {
    let st; try { st = statSync(file); if (!st.isFile()) return false; } catch { return false; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': file.startsWith(media) ? 'public, max-age=3600' : 'no-cache' });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res); return true;
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Content-Security-Policy', CSP); res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), autoplay=(self "https://www.youtube.com" "https://www.youtube-nocookie.com")');
    let url; try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
    let p; try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    if (p.startsWith('/api/')) return api(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    const root = p.startsWith('/media/') ? media : pub, rel = normalize(p.startsWith('/media/') ? p.slice(7) : p).replace(/^([/\\])+/, '');
    const file = join(root, rel); if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
    if (serveFile(req, res, file)) return;
    if (p.startsWith('/media/') || /\.\w{2,5}$/.test(p)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    serveFile(req, res, join(pub, 'index.html')); // SPA fallback
  });
  server.on('upgrade', (req, socket, head) => rooms.upgrade(req, socket, head));
  return new Promise(resolve => server.listen(port, () => { const a = server.address().port; if (!quiet) console.log(`Auralys Web on http://localhost:${a}`); resolve({ server, db, port: a, close: () => new Promise(r => { rooms.shutdown(); server.closeAllConnections?.(); server.close(() => { db.close(); r(); }); }) }); }));
}
if (import.meta.url === `file://${process.argv[1]}`) startServer();
