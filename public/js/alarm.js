// In-page alarm: only fires while a tab with Auralys is open (browsers can't run background alarms for web apps).
import { app } from './core/app.js';
import { get } from './core/api.js';
import { modal, h } from './core/dom.js';
import * as E from './player/engine.js';
let last = '';
export function startAlarm() {
  setInterval(async () => {
    const a = app.prefs.alarm; if (!a?.on) return; const d = new Date(), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, key = d.toDateString() + hm;
    if (hm !== a.time || key === last) return; last = key;
    let tracks = []; try { tracks = a.playlist ? (await get('/api/playlists/' + a.playlist)).tracks : (await get('/api/moods/Energy')).tracks; } catch {}
    if (!tracks.length) tracks = (await get('/api/home')).quickPicks;
    E.setQueue(tracks, 0); setTimeout(() => { if (!E.S.playing) modal('Alarm', h('p', 'Your alarm is ringing. Your browser needs a tap before it will play sound.'), [{ label: 'Start music', primary: true, onclick: () => E.play() }]); }, 1200);
  }, 15000);
}
