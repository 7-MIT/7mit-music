// Captures real screenshots of the running app (desktop 1440x900, mobile 390x844) into docs/screenshots/.
const { chromium } = require('playwright'); const { startServer, signup } = require('./helpers.cjs'); const path = require('node:path'); const fs = require('node:fs');
const OUT = path.join(__dirname, '..', '..', 'docs', 'screenshots'); fs.mkdirSync(OUT, { recursive: true });
const api = (p, path, o = {}) => p.evaluate(async ([path, o]) => { const r = await fetch(path, { method: o.method || 'GET', headers: { 'X-Auralys': '1', 'Content-Type': 'application/json' }, body: o.json ? JSON.stringify(o.json) : undefined }); return r.json().catch(() => ({})); }, [path, o]);
(async () => {
  const srv = await startServer(); const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const email = `shots${Date.now()}@demo.dev`;
  const sizes = { desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } };
  // seed realistic data for the demo account
  const sc = await b.newContext(sizes.desktop); const sp = await sc.newPage(); await signup(sp, srv.url, email, 'Maya Lindqvist');
  for (const id of ['tr_th1', 'tr_th3', 'tr_sl1', 'tr_ns2', 'tr_sw1']) await api(sp, '/api/favorites/' + id, { method: 'PUT' });
  const pl = await api(sp, '/api/playlists', { method: 'POST', json: { name: 'Golden hour', description: 'Warm, slow and unhurried', trackIds: ['tr_th1', 'tr_th2', 'tr_th3', 'tr_sl2', 'tr_sw2'] } }); await api(sp, '/api/playlists', { method: 'POST', json: { name: 'Night drive', trackIds: ['tr_ns1', 'tr_ns2', 'tr_ns3', 'tr_th4'] } });
  const now = Date.now(); let n = 0; for (const [id, plays] of [['tr_th1', 6], ['tr_sl1', 4], ['tr_ns2', 3], ['tr_sw1', 3], ['tr_th3', 2], ['tr_sl3', 2], ['tr_ns1', 1]]) for (let i = 0; i < plays; i++) await api(sp, '/api/events', { method: 'POST', json: { sid: `seed${n++}`, trackId: id, startedAt: now - (n * 3.1 * 3600e3 % (14 * 864e5)), listenedMs: 40000, completed: true } });
  await api(sp, '/api/prefs', { method: 'PUT', json: { region: 'ID' } }); await sc.storageState({ path: path.join(OUT, '.state.json') });
  const shots = {};
  for (const [name, opts] of Object.entries(sizes)) {
    const ctx = await b.newContext({ ...opts, storageState: path.join(OUT, '.state.json') }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    const snap = async (file, wait = 700) => { await p.waitForTimeout(wait); await p.screenshot({ path: path.join(OUT, `${name}-${file}.jpg`), type: 'jpeg', quality: 82 }); console.log('  📸', `${name}-${file}`); };
    const visit = async (url, sel) => { await p.goto(srv.url + url); if (sel) await p.waitForSelector(sel, { timeout: 10000 }); };
    await visit('/', '.qcard'); await snap('01-home', 1200);
    await visit('/explore', '.mixcard'); await snap('02-explore'); await visit('/charts'); await snap('03-charts'); await visit('/moods?m=Night', '.row'); await snap('04-moods');
    await visit('/search?q=low', '.row'); await snap('05-search'); await visit('/search', '.chip'); await snap('05b-search-empty');
    await visit('/library/songs', '.row'); await snap('06-library-songs'); await visit('/library/playlists', '.card'); await snap('07-library-playlists'); await visit('/library/albums'); await snap('07b-library-albums');
    await visit('/album/al_th', '.row'); await snap('08-album'); await visit('/artist/ar_kiln', '.row'); await snap('09-artist'); await visit('/playlist/' + pl.id, '.row'); await snap('10-playlist'); await visit('/podcast/pc_notes', '.row'); await snap('11-podcast');
    // start playback so the persistent player is populated
    await p.evaluate(async () => { const r = await (await fetch('/api/albums/al_th')).json(); __auralys.E.setQueue(r.tracks, 0); }); await p.waitForFunction(() => __auralys.E.S.playing && __auralys.E.S.position > 7, null, { timeout: 15000 });
    await visit('/', '.qcard'); await p.evaluate(async () => { const r = await (await fetch('/api/albums/al_th')).json(); __auralys.E.setQueue(r.tracks, 0, { startAt: 9 }); }); await p.waitForFunction(() => __auralys.E.S.position > 10); await snap('12-home-playing', 300);
    await p.click(name === 'mobile' ? '.mini .m' : '.playerbar .pb-now'); await p.waitForSelector('.fp:not([hidden])'); await snap('13-player', 1200);
    await p.evaluate(() => __auralys.E.seek(12)); await p.click(name === 'mobile' ? '.fp-tools button:has-text("Lyrics")' : '.fp-top button[aria-label="Open queue"]').catch(() => {});
    await p.goto(srv.url + '/lyrics'); await p.waitForSelector('.lyr-line'); await p.evaluate(() => __auralys.E.seek(11)); await snap('14-lyrics', 1200);
    await p.goto(srv.url + '/queue'); await p.waitForSelector('#fp-queue .row'); await snap('15-queue');
    await visit('/stats', '.statgrid'); await snap('16-stats'); await visit('/history', '.row'); await snap('17-history');
    await visit('/settings/appearance', '.setrow'); await snap('18-settings-appearance'); await visit('/settings/audio', 'canvas.eqgraph'); await p.waitForTimeout(400); await snap('19-settings-audio-eq'); await visit('/settings/lyrics', '.setrow'); await snap('20-settings-lyrics'); await visit('/settings/integrations', '.panel'); await snap('21-settings-integrations');
    await visit('/recognition', '.pbtn'); await snap('22-recognition'); await visit('/account', '.panel'); await snap('23-account');
    await visit('/listen-together', 'button:has-text("Create room")'); await snap('24-listen-together-lobby');
    if (name === 'desktop') { await p.fill('input[aria-label="Room name"]', 'Sunday listening'); await p.click('button:has-text("Create room")'); await p.waitForSelector('.badge:has-text("Live")'); await p.waitForSelector('.btn:has-text("Add")'); await p.click('.row:has-text("Harbour Lamps") .btn:has-text("Add")'); await p.waitForFunction(() => __auralys.E.S.source === 'room' && __auralys.E.S.playing); await snap('25-listen-together-room', 1500); }
    else { const rid = (await sc.pages()[0].evaluate(async () => (await (await fetch('/api/rooms')).json()).rooms[0]?.id)); if (rid) { await visit('/listen-together/' + rid, '.badge:has-text("Live")'); await snap('25-listen-together-room', 1200); } }
    await visit('/login', '.auth'); const ctx2 = await b.newContext(opts); const p2 = await ctx2.newPage(); await p2.goto(srv.url + '/login'); await p2.waitForSelector('.auth'); await p2.waitForTimeout(500); await p2.screenshot({ path: path.join(OUT, `${name}-26-login.jpg`), type: 'jpeg', quality: 82 }); console.log('  📸', `${name}-26-login`); await ctx2.close();
    await visit('/settings', '.setrow'); await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); await snap('27-theme-light', 300); await p.evaluate(() => { document.documentElement.dataset.theme = 'glass'; }); await snap('28-theme-glass', 300); await p.evaluate(() => { document.documentElement.dataset.theme = 'black'; }); await snap('29-theme-black', 300);
    if (errs.length) console.log('  page errors:', errs); await ctx.close();
  }
  fs.rmSync(path.join(OUT, '.state.json'), { force: true }); await b.close(); await srv.stop(); console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
