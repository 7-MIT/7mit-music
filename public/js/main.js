import { $ } from './core/dom.js';
import { boot, app } from './core/app.js';
import { route, init } from './core/router.js';
import { buildShell } from './ui/shell.js';
import * as E from './player/engine.js';
import { startAlarm } from './alarm.js';

const lazy = (file) => (ctx) => import(file).then(m => m.default(ctx));
const R = (p, file, meta = {}) => route(p, lazy(file), meta);
R('/', './views/home.js', { title: 'Home' });
R('/explore', './views/explore.js', { title: 'Explore' }); R('/charts', './views/explore.js', { title: 'Charts' }); R('/moods', './views/explore.js', { title: 'Moods & genres' }); R('/new-releases', './views/explore.js', { title: 'New releases' });
R('/search', './views/search.js', { title: 'Search' });
R('/library', './views/library.js', { title: 'Library' }); R('/library/:tab', './views/library.js', { title: 'Library' });
R('/album/:id', './views/detail.js', { title: 'Album' }); R('/artist/:id', './views/detail.js', { title: 'Artist' }); R('/playlist/:id', './views/detail.js', { title: 'Playlist' }); R('/podcast/:id', './views/detail.js', { title: 'Podcast' });
R('/listen-together', './views/room.js', { title: 'Listen Together' }); R('/listen-together/:id', './views/room.js', { title: 'Listen Together' });
R('/recognition', './views/recognition.js', { title: 'Recognition' });
R('/history', './views/history.js', { title: 'History' }); R('/stats', './views/stats.js', { title: 'Statistics' });
R('/settings', './views/settings.js', { title: 'Settings' }); R('/settings/:section', './views/settings.js', { title: 'Settings' });
R('/account', './views/account.js', { title: 'Account' }); R('/login', './views/account.js', { title: 'Sign in' });
R('/privacy', './views/legal.js', { title: 'Privacy' }); R('/terms', './views/legal.js', { title: 'Terms' });
route('/player', () => {}, { overlay: 'player' }); route('/lyrics', () => {}, { overlay: 'lyrics' }); route('/queue', () => {}, { overlay: 'queue' });
R('/(.*)', './views/notfound.js', { title: 'Not found', notFound: true });

(async () => {
  await boot();
  const shell = buildShell($('#root'));
  await E.restore();
  app.addEventListener('user', () => E.restore && 0);
  await init(shell.view, shell.onRoute);
  startAlarm();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.__auralys = { E, app }; // handy for debugging & e2e
})();
