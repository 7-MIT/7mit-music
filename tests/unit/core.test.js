globalThis.document = { createElementNS() { return {}; }, createElement() { return {}; }, createTextNode: t => t };
import test from 'node:test'; import assert from 'node:assert/strict';
import { parseLrc, activeLine } from '../../public/js/core/dom.js';
import { hashPassword, verifyPassword, sniffAudio, sniffImage, clean, rateLimit, resetRateLimits, HttpError } from '../../server/util.js';
import { synthTrack, lrcTime } from '../../server/synth.js';

// dom.js touches `document` only inside functions; stub what it needs at import time.
test('LRC parser reads timestamps, multiple tags and ignores metadata', () => {
  const r = parseLrc('[ti:Song]\n[ar:Me]\n[00:12.50]Hello\n[00:05.00][00:30.00]Chorus\n\n[01:02.25]End');
  assert.equal(r.synced, true); assert.deepEqual(r.lines.map(l => l.text), ['Chorus', 'Hello', 'Chorus', 'End']); assert.equal(r.lines[1].t, 12.5); assert.equal(r.lines[3].t, 62.25);
});
test('plain lyrics are not treated as synchronised', () => { const r = parseLrc('line one\nline two'); assert.equal(r.synced, false); assert.equal(r.lines.length, 2); });
test('activeLine finds the current line by binary search', () => { const l = [{ t: 1 }, { t: 5 }, { t: 9 }]; assert.equal(activeLine(l, 0), -1); assert.equal(activeLine(l, 5), 1); assert.equal(activeLine(l, 100), 2); });
test('lrcTime formats mm:ss.xx', () => assert.equal(lrcTime(62.254), '[01:02.25]'));
test('password hashing verifies and rejects', async () => { const h = await hashPassword('s3cret-pass'); assert.ok(await verifyPassword('s3cret-pass', h)); assert.ok(!(await verifyPassword('nope', h))); assert.ok(!(await verifyPassword('x', 'garbage'))); });
test('file sniffing', () => {
  assert.equal(sniffAudio(Buffer.from('RIFF\0\0\0\0WAVEfmt ')), 'audio/wav'); assert.equal(sniffAudio(Buffer.from('ID3\x03\0\0\0\0\0\0\0\0')), 'audio/mpeg'); assert.equal(sniffAudio(Buffer.from('<html>not audio at all</html>')), null);
  assert.deepEqual(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), ['image/png', 'png']); assert.equal(sniffImage(Buffer.from('GIF89a000000000')), null);
});
test('clean() strips control characters and angle brackets', () => assert.equal(clean('<b>Hi</b>\u0000\n there'), 'b Hi /b there'));
test('rate limiter throws after the limit', () => { resetRateLimits(); for (let i = 0; i < 3; i++) rateLimit('k', 3, 1000); assert.throws(() => rateLimit('k', 3, 1000), e => e instanceof HttpError && e.status === 429); });
test('synth produces a valid, non-silent WAV with the expected length', () => {
  const { wav, durationMs, barSec } = synthTrack({ bpm: 120, root: 57, mode: 'major', prog: [0, 4], style: 'lofi', bars: 2, seed: 3 });
  assert.equal(wav.slice(0, 4).toString(), 'RIFF'); assert.ok(Math.abs(durationMs - barSec * 2000) < 5); let peak = 0; for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i))); assert.ok(peak > 3000, 'audible');
});
