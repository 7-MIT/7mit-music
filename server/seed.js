import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, uid } from './db.js';
import { synthTrack, lrcTime, coverSvg } from './synth.js';

const A = {
  solene: { name: 'Solene Marrow', bio: 'Warm synth-pop built from slow chords and late-afternoon light. (Demo artist — fictional.)', bg: '#F3EFE6', sun: '#BE603F' },
  kiln: { name: 'Kiln & Tide', bio: 'Folk-leaning electronica recorded, in spirit, by the sea. (Demo artist — fictional.)', bg: '#1E2A2F', sun: '#E9B872', ink: '#F3EFE6' },
  paper: { name: 'Paper Lanterns Club', bio: 'Rainy-day lo-fi for focus. (Demo artist — fictional.)', bg: '#D9DDD0', sun: '#6F8F72' },
  nocturne: { name: 'Nocturne Avenue', bio: 'Neon, static and after-hours drives. (Demo artist — fictional.)', bg: '#241B33', sun: '#E26A8D', ink: '#F3EFE6' }
};
const ALBUMS = [
  { key: 'th', title: 'Terracotta Hours', artist: 'solene', year: 2026, age: 6, tracks: [
    { title: 'Low Sun on the Window', genre: 'Synth-pop', mood: 'Warm', bpm: 104, root: 57, mode: 'major', prog: [0, 4, 5, 3], style: 'pop', lyrics: ['The low sun leans against the glass', 'and paints the floor in amber lines', 'I count the hours as they pass', 'like cups of tea that cool in time', 'Stay a little, stay a while', 'the day is slow and so are we', 'every shadow wears a smile', 'warm as clay and just as free'] },
    { title: 'Clay and Light', genre: 'Ambient', mood: 'Calm', bpm: 76, root: 50, mode: 'dorian', prog: [0, 3, 0, 4], style: 'ambient', lyrics: ['Breathe in the colour of the room', 'let the edges soften and fall', 'nothing here needs to be soon', 'nothing here is small'] },
    { title: 'Kitchen Radio', genre: 'Lo-fi', mood: 'Warm', bpm: 86, root: 60, mode: 'major', prog: [1, 4, 0, 5], style: 'lofi', lyrics: ['Static hums between the songs', 'someone hums along', 'the kettle sings its steady note', 'and I forget what went wrong', 'dishes stacked in golden light', 'Sunday never ends tonight'] },
    { title: 'Last Train Home', genre: 'Synth-pop', mood: 'Night', bpm: 112, root: 52, mode: 'minor', prog: [0, 5, 2, 6], style: 'pop', lyrics: ['Platform lights are blurring by', 'a thousand windows, one goodnight', 'I am carried, I am light', 'on the last train home tonight', 'every station says a name', 'I will not be late again'] }] },
  { key: 'sl', title: 'Salt Light', artist: 'kiln', year: 2025, age: 20, tracks: [
    { title: 'Harbour Lamps', genre: 'Folk', mood: 'Calm', bpm: 92, root: 55, mode: 'major', prog: [0, 3, 4, 0], style: 'folk', lyrics: ['One by one the harbour lamps', 'learn the water’s name', 'boats lean in against the dark', 'every rope the same', 'I will wait where the pier runs out', 'and watch the evening turn'] },
    { title: 'Low Tide Letters', genre: 'Folk', mood: 'Warm', bpm: 84, root: 50, mode: 'major', prog: [0, 5, 3, 4], style: 'folk', lyrics: ['Letters in the wet sand lines', 'written by the sea', 'half of them are yours to read', 'half belong to me', 'when the tide comes back for them', 'we will let them be'] },
    { title: 'Salt on the Strings', genre: 'Folk', mood: 'Focus', bpm: 100, root: 57, mode: 'minor', prog: [0, 3, 4, 0], style: 'folk', lyrics: ['Salt on the strings and sand in the shoes', 'nothing to win and nothing to lose', 'tune it again by the light of the stove', 'play me the one that I already know'] },
    { title: 'Morning Nets', genre: 'Folk', mood: 'Energy', bpm: 118, root: 52, mode: 'major', prog: [0, 4, 5, 3], style: 'folk', lyrics: ['Up before the gulls are loud', 'hauling silver from the grey', 'every hand a river now', 'every wave a bright new day', 'throw the lines and sing it out', 'morning nets and morning shout'] }] },
  { key: 'sw', title: 'Slow Weather', artist: 'paper', year: 2026, age: 3, tracks: [
    { title: 'Rain Check', genre: 'Lo-fi', mood: 'Focus', bpm: 78, root: 53, mode: 'major', prog: [1, 4, 0, 0], style: 'lofi', lyrics: ['Rain check on the world outside', 'I will stay and read the sky', 'pages turn like passing clouds', 'quiet makes the loudest sound', 'nothing calls and no one waits', 'rain check on the rest'] },
    { title: 'Umbrella Season', genre: 'Lo-fi', mood: 'Calm', bpm: 72, root: 48, mode: 'minor', prog: [0, 5, 2, 6], style: 'lofi', lyrics: ['Puddles keep the city’s lights', 'umbrellas bloom in rows', 'we walk the long way round tonight', 'wherever the water goes'] },
    { title: 'Interlude (No Words)', genre: 'Ambient', mood: 'Calm', bpm: 64, root: 55, mode: 'dorian', prog: [0, 4], style: 'ambient', lyrics: null }] },
  { key: 'ns', title: 'Night Signals EP', artist: 'nocturne', year: 2026, age: 1, tracks: [
    { title: 'Neon Corridor', genre: 'Synth-pop', mood: 'Energy', bpm: 124, root: 57, mode: 'minor', prog: [0, 5, 3, 4], style: 'pop', lyrics: ['Down the neon corridor', 'every door a heartbeat more', 'I can feel the signal rise', 'electric in your eyes', 'run the lights and let them blur', 'I am yours and you are her'] },
    { title: 'Static Bloom', genre: 'Synth-pop', mood: 'Night', bpm: 108, root: 50, mode: 'minor', prog: [0, 2, 5, 6], style: 'pop', lyrics: ['Flowers made of static grow', 'on the screens of sleeping towns', 'we are tuning, we are low', 'listen to the sound come down', 'bloom in blue and bloom in gold', 'never let the signal go'] },
    { title: 'Afterglow Drive', genre: 'Synth-pop', mood: 'Night', bpm: 116, root: 55, mode: 'minor', prog: [0, 3, 6, 4], style: 'pop', lyrics: ['Afterglow on the dashboard line', 'empty road and borrowed time', 'windows down and the city fades', 'in the mirror, what remains', 'drive until the dawn arrives', 'we are what the night survives'] }] }
];
const PODCAST = { title: 'Field Notes from Auralys', host: 'Auralys Studio (demo)', description: 'A demo show. Episodes here are generated ambient sound beds that exist to exercise the podcast UI — there is no speech and no real show.', bg: '#171615', sun: '#BE603F', ink: '#F3EFE6',
  eps: [{ title: 'Ep. 1 — Listening Slowly', description: 'A drifting ambient bed (demo). Shownotes would go here.', bpm: 60, root: 48, mode: 'dorian', prog: [0, 3], bars: 20 }, { title: 'Ep. 2 — The Sound of Rooms', description: 'A second ambient bed (demo). Try the playback-speed control on it.', bpm: 56, root: 53, mode: 'minor', prog: [0, 4, 5], bars: 20 }] };

export function seedDemo(db, { force = false } = {}) {
  if (!force && db.get('SELECT 1 x FROM tracks WHERE demo=1 LIMIT 1')) return false;
  const cov = (key, spec, title, seed) => { const f = `${key}.svg`; writeFileSync(join(DATA_DIR, 'media', 'covers', f), coverSvg({ ...spec, title, seed })); return `/media/covers/${f}`; };
  const day = 86400000, now = Date.now();
  db.tx(() => {
    for (const [k, a] of Object.entries(A)) db.run('INSERT OR IGNORE INTO artists (id,name,bio,cover,demo) VALUES (?,?,?,?,1)', 'ar_' + k, a.name, a.bio, cov('artist_' + k, a, a.name, k.length));
    ALBUMS.forEach((al, ai) => {
      const art = A[al.artist], aid = 'al_' + al.key;
      db.run('INSERT OR IGNORE INTO albums (id,title,artist_id,year,cover,demo,released_at) VALUES (?,?,?,?,?,1,?)', aid, al.title, 'ar_' + al.artist, al.year, cov('album_' + al.key, art, al.title, ai), now - al.age * day);
      al.tracks.forEach((t, i) => {
        const id = `tr_${al.key}${i + 1}`;
        const bars = t.bars || 20;
        const { wav, durationMs, barSec } = synthTrack({ ...t, bars, seed: ai * 10 + i + 1 });
        writeFileSync(join(DATA_DIR, 'media', 'audio', id + '.wav'), wav);
        db.run('INSERT OR REPLACE INTO tracks (id,title,artist_id,album_id,kind,track_no,genre,mood,duration_ms,audio_path,mime,demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)', id, t.title, 'ar_' + al.artist, aid, 'song', i + 1, t.genre, t.mood, durationMs, id + '.wav', 'audio/wav');
        if (t.lyrics) {
          const lines = t.lyrics, start = 2, span = Math.max(1, Math.floor((bars - 3) / lines.length));
          const lrc = [`[ti:${t.title}]`, `[ar:${art.name}]`, '[by:Auralys demo (original lyrics)]', ...lines.map((l, n) => `${lrcTime(barSec * (start + n * span * (span > 1 ? 1 : 1)))}${l}`)];
          db.run('INSERT OR REPLACE INTO lyrics (track_id,provider,format,content) VALUES (?,?,?,?)', id, 'demo', 'lrc', lrc.join('\n'));
        }
      });
    });
    db.run('INSERT OR IGNORE INTO podcasts (id,title,host,description,cover,demo) VALUES (?,?,?,?,?,1)', 'pc_notes', PODCAST.title, PODCAST.host, PODCAST.description, cov('podcast_notes', PODCAST, PODCAST.title, 2));
    PODCAST.eps.forEach((e, i) => {
      const id = 'tr_pc' + (i + 1), { wav, durationMs } = synthTrack({ ...e, style: 'ambient', seed: 90 + i });
      writeFileSync(join(DATA_DIR, 'media', 'audio', id + '.wav'), wav);
      db.run("INSERT OR REPLACE INTO tracks (id,title,podcast_id,kind,track_no,genre,mood,duration_ms,audio_path,mime,description,demo) VALUES (?,?,?,'episode',?,?,?,?,?,?,?,1)", id, e.title, 'pc_notes', i + 1, 'Ambient', 'Calm', durationMs, id + '.wav', 'audio/wav', e.description);
    });
  });
  return true;
}
