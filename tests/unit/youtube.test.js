import test from 'node:test'; import assert from 'node:assert/strict'; import http from 'node:http';
import { normalize, createYoutube, isVideoId, ytId } from '../../server/youtube.js';
test('normalize: ISO-8601 durations, "- Topic" suffix, sanitised text, embeddable flag', () => {
  const n = normalize({ id: 'abcdefghijk', snippet: { title: '<b>Song</b>\u0000 name', channelTitle: 'Artist - Topic', thumbnails: { high: { url: 'https://i.ytimg.com/x.jpg' } } }, contentDetails: { duration: 'PT1H2M3S' }, status: { embeddable: false } });
  assert.equal(n.durationMs, 3723000); assert.equal(n.artist, 'Artist'); assert.equal(n.title, 'b Song /b name'); assert.equal(n.embeddable, false); assert.equal(n.cover, 'https://i.ytimg.com/x.jpg');
  assert.equal(normalize({ id: 'abcdefghijk', snippet: {}, contentDetails: { duration: 'PT45S' } }).durationMs, 45000);
});
test('video id validation and track id prefix', () => { assert.ok(isVideoId('dQw4w9WgXcQ')); assert.ok(!isVideoId('short')); assert.ok(!isVideoId('has spaces!')); assert.equal(ytId('x'), 'yt_x'); });
test('provider filters non-embeddable and very short items, maps quota errors, caches', async () => {
  let hits = 0; const srv = http.createServer((req, res) => { hits++; const u = new URL(req.url, 'http://x'); res.setHeader('content-type', 'application/json');
    if (u.pathname.endsWith('/search')) return res.end(JSON.stringify({ items: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map(id => ({ id: { videoId: id } })) }));
    if (u.searchParams.get('chart')) { res.statusCode = 403; return res.end(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } })); }
    res.end(JSON.stringify({ items: [{ id: 'aaaaaaaaaaa', snippet: { title: 'ok', channelTitle: 'A' }, contentDetails: { duration: 'PT3M' }, status: { embeddable: true } }, { id: 'bbbbbbbbbbb', snippet: { title: 'no embed', channelTitle: 'A' }, contentDetails: { duration: 'PT3M' }, status: { embeddable: false } }, { id: 'ccccccccccc', snippet: { title: 'short', channelTitle: 'A' }, contentDetails: { duration: 'PT5S' }, status: { embeddable: true } }] })); });
  await new Promise(r => srv.listen(0, r)); const yt = createYoutube({ youtubeKey: 'k', ytApiBase: `http://localhost:${srv.address().port}/v3` });
  assert.deepEqual((await yt.search('hello')).map(t => t.title), ['ok']); const before = hits; await yt.search('hello'); assert.equal(hits, before, 'cached');
  await assert.rejects(() => yt.trending('US'), e => e.status === 429 && e.code === 'quota'); srv.close();
  assert.equal(createYoutube({}).available, false);
});
