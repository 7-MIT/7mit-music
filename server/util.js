import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(_scrypt);

export class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
export const bad = (m, code) => new HttpError(400, m, code);

export function send(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
export async function readBody(req, limit = 1_000_000) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, 'Payload too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
export async function readJson(req, limit = 1_000_000) {
  const b = await readBody(req, limit);
  if (!b.length) return {};
  try { const v = JSON.parse(b.toString('utf8')); if (v === null || typeof v !== 'object') throw 0; return v; } catch { throw bad('Invalid JSON'); }
}
export function parseCookies(h = '') {
  const o = {}; for (const p of h.split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } return o;
}
export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');

export async function hashPassword(pw) {
  const salt = randomBytes(16); const key = await scrypt(pw, salt, 64);
  return `s1:${salt.toString('base64')}:${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [v, s, k] = String(stored).split(':'); if (v !== 's1') return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'), 64); const kb = Buffer.from(k, 'base64');
  return kb.length === key.length && timingSafeEqual(key, kb);
}

const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  if (++b.n > max) throw new HttpError(429, 'Too many requests — slow down and try again shortly.', 'rate_limited');
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}
export const resetRateLimits = () => buckets.clear();

// strip control chars / angle brackets from externally supplied metadata
export const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const esc = s => String(s).replace(/[\\%_]/g, m => '\\' + m);

export function sniffAudio(b) {
  if (b.length < 12) return null;
  if (b.slice(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WAVE') return 'audio/wav';
  if (b.slice(0, 4).toString() === 'fLaC') return 'audio/flac';
  if (b.slice(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (b.slice(4, 8).toString() === 'ftyp') return 'audio/mp4';
  return null;
}
export function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG') return ['image/png', 'png'];
  if (b[0] === 0xff && b[1] === 0xd8) return ['image/jpeg', 'jpg'];
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return ['image/webp', 'webp'];
  return null;
}
