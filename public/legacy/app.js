(() => {
  const $ = id => document.getElementById(id);
  const h = (t, a = {}, ...c) => {
    const e = document.createElement(t);
    for (const k in a) { if (k === 'class') e.className = a[k]; else if (k.startsWith('on')) e[k] = a[k]; else e.setAttribute(k, a[k]); }
    c.flat().forEach(x => { if (x != null && x !== false) e.append(x); });
    return e;
  };
  const fmt = s => isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00';
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const lsset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // ---------- IndexedDB ----------
  const dbp = new Promise((res, rej) => {
    const r = indexedDB.open('music7mit', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('tracks', { keyPath: 'id' }); r.result.createObjectStore('playlists', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const run = (n, m, f) => dbp.then(d => new Promise((res, rej) => { const q = f(d.transaction(n, m).objectStore(n)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
  const dbAll = n => run(n, 'readonly', s => s.getAll());
  const dbPut = (n, v) => run(n, 'readwrite', s => s.put(v));
  const dbDel = (n, k) => run(n, 'readwrite', s => s.delete(k));

  // ---------- State ----------
  let tracks = new Map(), playlists = [];
  let queue = [], qpos = -1, shuffle = false, repeat = 0, curUrl = null;
  let view = 'home', libTab = 'songs', detail = null; // detail: {type:'album'|'folder'|'playlist'|'liked'|..., key}
  const audio = $('audio');
  const all = () => [...tracks.values()];
  const cur = () => tracks.get(queue[qpos]);

  // ---------- Audio graph (equalizer) ----------
  const BANDS = [60, 230, 910, 3600, 14000];
  const PRESETS = {
    Normal: [0, 0, 0, 0, 0], Classical: [4, 2, -1, 3, 4], Jazz: [3, 2, -2, 2, 4], Rock: [5, 3, -2, 3, 5],
    Pop: [-1, 2, 4, 2, -1], 'Hip-Hop': [6, 4, 0, 1, 3], 'Heavy Metal': [5, 1, 3, 4, 2]
  };
  let eq = ls('eq', { on: true, preset: 'Normal', gains: [0, 0, 0, 0, 0], bass: 0, reverb: 0 });
  let ctx, filters = [], bassF, dry, wet, an, srcNode;
  function initAudio() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    srcNode = ctx.createMediaElementSource(audio);
    filters = BANDS.map((f, i) => { const b = ctx.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = 1; return b; });
    bassF = ctx.createBiquadFilter(); bassF.type = 'lowshelf'; bassF.frequency.value = 120;
    dry = ctx.createGain(); wet = ctx.createGain();
    const conv = ctx.createConvolver(), len = ctx.sampleRate * 2, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    conv.buffer = buf;
    an = ctx.createAnalyser(); an.fftSize = 256;
    let n = srcNode; [...filters, bassF].forEach(f => { n.connect(f); n = f; });
    n.connect(dry); n.connect(conv); conv.connect(wet);
    dry.connect(an); wet.connect(an); an.connect(ctx.destination);
    applyEq();
  }
  function applyEq() {
    if (!ctx) return;
    filters.forEach((f, i) => f.gain.value = eq.on ? eq.gains[i] : 0);
    bassF.gain.value = eq.on ? eq.bass : 0;
    wet.gain.value = eq.on ? eq.reverb : 0;
    dry.gain.value = 1 - (eq.on ? eq.reverb * 0.4 : 0);
  }

  // ---------- Import ----------
  function parse(f) {
    const base = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    let artist = 'Artis tidak diketahui', title = base;
    const m = base.split(' - '); if (m.length > 1) { artist = m[0].trim(); title = m.slice(1).join(' - ').trim(); }
    const parts = (f.webkitRelativePath || '').split('/');
    const folder = parts.length > 1 ? parts[parts.length - 2] : 'Tanpa folder';
    return { id: f.name + '|' + f.size + '|' + f.lastModified, title, artist, album: parts.length > 1 ? folder : 'Singles', folder, added: Date.now(), plays: 0, last: 0, fav: false, blob: f };
  }
  async function importFiles(list) {
    let n = 0;
    for (const f of list) {
      if (!(f.type.startsWith('audio/') || /\.(mp3|wav|flac|aac|m4a|ogg|opus|wma)$/i.test(f.name))) continue;
      const t = parse(f); if (tracks.has(t.id)) continue;
      tracks.set(t.id, t); await dbPut('tracks', t); n++;
    }
    render(); toast(n + ' lagu ditambahkan');
  }
  function toast(msg) { const t = h('div', { class: 'toast' }, msg); t.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:var(--acc);color:#fff;padding:8px 16px;border-radius:20px;z-index:99'; document.body.append(t); setTimeout(() => t.remove(), 1800); }

  // ---------- Playback ----------
  function setQueue(ids, pos) { queue = ids.slice(); play(pos); }
  function play(pos) {
    const t = tracks.get(queue[pos]); if (!t) return;
    initAudio(); if (ctx && ctx.state === 'suspended') ctx.resume();
    qpos = pos;
    if (curUrl) URL.revokeObjectURL(curUrl);
    curUrl = URL.createObjectURL(t.blob); audio.src = curUrl;
    audio.play().catch(() => {});
    t.plays++; t.last = Date.now(); dbPut('tracks', t);
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album });
    updateNow(); render();
  }
  function step(dir) {
    if (!queue.length) return;
    let n;
    if (shuffle && queue.length > 1) { do n = Math.floor(Math.random() * queue.length); while (n === qpos); }
    else n = (qpos + dir + queue.length) % queue.length;
    play(n);
  }
  function updateNow() {
    const t = cur(); $('mini').hidden = !t; if (!t) return;
    $('mtitle').textContent = $('ftitle').textContent = t.title;
    $('martist').textContent = $('fartist').textContent = t.artist;
    $('like').textContent = t.fav ? '♥' : '♡';
  }
  function toggleFav(t) { t.fav = !t.fav; dbPut('tracks', t); updateNow(); render(); }

  audio.onplay = () => $('play').textContent = $('mplay').textContent = '⏸';
  audio.onpause = () => $('play').textContent = $('mplay').textContent = '▶';
  audio.ontimeupdate = () => {
    const p = audio.duration ? audio.currentTime / audio.duration : 0;
    $('cur').textContent = fmt(audio.currentTime); $('dur').textContent = fmt(audio.duration);
    $('seek').value = p * 1000; $('miniprog').firstChild.style.width = p * 100 + '%';
  };
  audio.onended = () => { if (repeat === 2) play(qpos); else if (repeat === 1 || qpos < queue.length - 1 || shuffle) step(1); };
  const toggle = () => { if (qpos < 0) return; initAudio(); ctx && ctx.resume(); audio.paused ? audio.play() : audio.pause(); };
  $('play').onclick = $('mplay').onclick = toggle;
  $('next').onclick = $('mnext').onclick = () => step(1);
  $('prev').onclick = $('mprev').onclick = () => audio.currentTime > 3 ? (audio.currentTime = 0) : step(-1);
  $('seek').oninput = e => { if (audio.duration) audio.currentTime = e.target.value / 1000 * audio.duration; };
  $('shuffle').onclick = e => { shuffle = !shuffle; e.currentTarget.classList.toggle('active', shuffle); };
  $('repeat').onclick = e => { repeat = (repeat + 1) % 3; e.currentTarget.classList.toggle('active', repeat > 0); e.currentTarget.textContent = repeat === 2 ? '🔂' : '🔁'; };
  $('like').onclick = () => { const t = cur(); if (t) toggleFav(t); };
  $('more').onclick = () => { const t = cur(); if (t) trackMenu(t); };
  $('fqueue').onclick = showQueue;
  $('minimeta').onclick = () => { $('full').hidden = false; startViz(); };
  $('fclose').onclick = () => $('full').hidden = true;
  if ('mediaSession' in navigator) {
    const m = navigator.mediaSession;
    m.setActionHandler('play', () => audio.play()); m.setActionHandler('pause', () => audio.pause());
    m.setActionHandler('nexttrack', () => step(1)); m.setActionHandler('previoustrack', () => step(-1));
  }

  // ---------- Visualizer ----------
  let vmode = 0;
  $('vizmode').onclick = () => vmode = (vmode + 1) % 3;
  function startViz() {
    const cv = $('viz'), g = cv.getContext('2d');
    const loop = () => {
      if ($('full').hidden) return;
      requestAnimationFrame(loop);
      const W = cv.width, H = cv.height, css = getComputedStyle(document.body);
      g.clearRect(0, 0, W, H);
      if (!an) return;
      const d = new Uint8Array(an.frequencyBinCount);
      const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, css.getPropertyValue('--acc')); grad.addColorStop(1, css.getPropertyValue('--acc2'));
      g.fillStyle = g.strokeStyle = grad; g.lineWidth = 3;
      if (vmode === 0) { an.getByteFrequencyData(d); const n = 48, w = W / n; for (let i = 0; i < n; i++) { const v = d[i] / 255 * H * .9; g.fillRect(i * w + 2, H - v, w - 4, v); } }
      else if (vmode === 1) { an.getByteTimeDomainData(d); g.beginPath(); d.forEach((v, i) => { const x = i / d.length * W, y = v / 255 * H; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
      else { an.getByteFrequencyData(d); const n = 64; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, r = H * .22, l = d[i] / 255 * H * .25; g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r); g.lineTo(W / 2 + Math.cos(a) * (r + l), H / 2 + Math.sin(a) * (r + l)); g.stroke(); } }
    };
    loop();
  }

  // ---------- Sheets ----------
  function sheet(...c) { const s = $('sheet'); s.innerHTML = ''; s.append(...c); $('sheetbg').hidden = false; }
  const closeSheet = () => $('sheetbg').hidden = true;
  $('sheetbg').onclick = e => { if (e.target.id === 'sheetbg') closeSheet(); };
  const opt = (label, fn) => h('button', { class: 'opt', onclick: () => { closeSheet(); fn(); } }, label);

  function trackMenu(t, ctxList) {
    sheet(h('h3', {}, t.title),
      opt(t.fav ? '♥ Hapus dari Favorit' : '♡ Tambah ke Favorit', () => toggleFav(t)),
      opt('▶ Putar berikutnya', () => { queue.splice(qpos + 1, 0, t.id); toast('Diputar berikutnya'); }),
      opt('＋ Tambah ke antrean', () => { queue.push(t.id); toast('Masuk antrean'); }),
      opt('📂 Tambah ke playlist…', () => pickPlaylist(t)),
      detail && detail.type === 'playlist' ? opt('➖ Keluarkan dari playlist', () => { const p = playlists.find(x => x.id === detail.key); p.ids = p.ids.filter(i => i !== t.id); dbPut('playlists', p); render(); }) : null,
      opt('🗑 Hapus dari pustaka', () => removeTrack(t)));
  }
  function pickPlaylist(t) {
    sheet(h('h3', {}, 'Pilih playlist'),
      ...playlists.map(p => opt(p.name, () => { if (!p.ids.includes(t.id)) p.ids.push(t.id); dbPut('playlists', p); toast('Ditambahkan ke ' + p.name); })),
      opt('＋ Playlist baru…', () => newPlaylist(t)));
  }
  function newPlaylist(t) {
    const inp = h('input', { type: 'text', placeholder: 'Nama playlist' });
    sheet(h('h3', {}, 'Playlist baru'), inp, h('button', { class: 'btn', style: 'margin-top:10px', onclick: () => {
      const name = inp.value.trim(); if (!name) return;
      const p = { id: 'p' + Date.now(), name, ids: t ? [t.id] : [] }; playlists.push(p); dbPut('playlists', p); closeSheet(); render();
    } }, 'Buat'));
    inp.focus();
  }
  async function removeTrack(t) {
    tracks.delete(t.id); await dbDel('tracks', t.id);
    for (const p of playlists) if (p.ids.includes(t.id)) { p.ids = p.ids.filter(i => i !== t.id); dbPut('playlists', p); }
    if (cur() && cur().id === t.id) { audio.pause(); audio.removeAttribute('src'); }
    queue = queue.filter(i => i !== t.id); qpos = Math.min(qpos, queue.length - 1);
    if (qpos < 0) $('mini').hidden = true;
    render();
  }
  function showQueue() {
    sheet(h('h3', {}, 'Antrean (' + queue.length + ')'), ...queue.map((id, i) => { const t = tracks.get(id); return t && opt((i === qpos ? '▶ ' : '') + t.title, () => play(i)); }));
  }

  // ---------- Views ----------
  const sorted = (a, f) => a.slice().sort(f);
  function row(t, ids, i, opts = {}) {
    const on = cur() && cur().id === t.id;
    const r = h('div', { class: 'row' + (on ? ' on' : ''), onclick: () => setQueue(ids, i) },
      h('div', { class: 'm' }, h('div', { class: 't' }, t.title), h('div', { class: 's' }, t.artist + ' · ' + t.album)),
      h('button', { class: t.fav ? 'liked' : '', onclick: e => { e.stopPropagation(); toggleFav(t); } }, t.fav ? '♥' : '♡'),
      h('button', { onclick: e => { e.stopPropagation(); trackMenu(t); } }, '⋯'));
    if (opts.drag) {
      r.draggable = true;
      r.ondragstart = e => { e.dataTransfer.setData('text/plain', i); r.classList.add('drag'); };
      r.ondragend = () => r.classList.remove('drag');
      r.ondragover = e => e.preventDefault();
      r.ondrop = e => { e.preventDefault(); const from = +e.dataTransfer.getData('text/plain'); const p = playlists.find(x => x.id === detail.key); const [m] = p.ids.splice(from, 1); p.ids.splice(i, 0, m); dbPut('playlists', p); render(); };
    }
    return r;
  }
  const list = (ts, opts) => { const ids = ts.map(t => t.id); return h('div', {}, ts.length ? ts.map((t, i) => row(t, ids, i, opts)) : h('p', { class: 'empty' }, 'Kosong.')); };
  const back = () => h('button', { class: 'btn', onclick: () => { detail = null; render(); } }, '← Kembali');
  const card = (title, sub, fn, hl) => h('button', { class: 'card' + (hl ? ' hl' : ''), onclick: fn }, h('b', {}, title), h('small', {}, sub));

  function groups(key) { const m = new Map(); all().forEach(t => { const k = t[key] || '—'; (m.get(k) || m.set(k, []).get(k)).push(t); }); return m; }
  function special(type) {
    const a = all();
    if (type === 'liked') return ['Lagu Disukai', a.filter(t => t.fav)];
    if (type === 'recent') return ['Terakhir Diputar', sorted(a.filter(t => t.last), (x, y) => y.last - x.last)];
    if (type === 'added') return ['Baru Ditambahkan', sorted(a, (x, y) => y.added - x.added)];
    if (type === 'top') return ['Paling Sering Diputar', sorted(a.filter(t => t.plays), (x, y) => y.plays - x.plays)];
  }

  function detailView() {
    const d = detail;
    if (['liked', 'recent', 'added', 'top'].includes(d.type)) { const [n, ts] = special(d.type); return [back(), h('h2', {}, n), list(ts)]; }
    if (d.type === 'album' || d.type === 'folder') { const ts = (groups(d.type === 'album' ? 'album' : 'folder').get(d.key) || []); return [back(), h('h2', {}, d.key), list(ts)]; }
    if (d.type === 'playlist') {
      const p = playlists.find(x => x.id === d.key); if (!p) { detail = null; return home(); }
      const ts = p.ids.map(i => tracks.get(i)).filter(Boolean);
      return [back(), h('h2', {}, p.name), h('p', { class: 'hint' }, 'Seret baris untuk mengubah urutan.'),
        h('div', { class: 'tabs' }, h('button', { class: 'on', onclick: () => ts.length && setQueue(ts.map(t => t.id), 0) }, '▶ Putar'),
          h('button', { onclick: () => { if (confirm('Hapus playlist ini?')) { playlists = playlists.filter(x => x !== p); dbDel('playlists', p.id); detail = null; render(); } } }, '🗑 Hapus')),
        list(ts, { drag: true })];
    }
  }

  function home() {
    const a = all(); if (!a.length) return [h('p', { class: 'empty' }, 'Belum ada lagu. Tekan “+ Tambah” untuk memilih file musik atau seluruh folder dari perangkatmu. Semua tersimpan offline di browser.')];
    const sec = (type, max = 4) => { const [n, ts] = special(type); return [h('h2', {}, n), ts.length ? list(ts.slice(0, max)) : h('p', { class: 'hint' }, 'Belum ada.'), ts.length > max ? h('button', { class: 'tabs', style: 'border:0;background:none;color:var(--acc2)', onclick: () => { detail = { type }; render(); } }, 'Lihat semua →') : null]; };
    return [
      h('div', { class: 'cards', style: 'margin-top:12px' },
        card('♥ Lagu Disukai', special('liked')[1].length + ' lagu', () => { detail = { type: 'liked' }; render(); }, true),
        card('🎵 Semua Lagu', a.length + ' lagu', () => { setQueue(a.map(t => t.id), 0); }),
        card('🔀 Acak', 'Putar acak', () => { shuffle = true; $('shuffle').classList.add('active'); const ids = a.map(t => t.id); setQueue(ids, Math.floor(Math.random() * ids.length)); })),
      sec('recent'), sec('added'), sec('top'),
      h('h2', {}, 'Playlist Saya'),
      h('div', { class: 'cards' }, ...playlists.map(p => card(p.name, p.ids.length + ' lagu', () => { view = 'playlists'; detail = { type: 'playlist', key: p.id }; render(); }))),
      playlists.length ? null : h('p', { class: 'hint' }, 'Belum ada playlist.')
    ];
  }

  function library() {
    const q = $('search').value.trim().toLowerCase();
    const tabs = h('div', { class: 'tabs' }, ...[['songs', 'Lagu'], ['albums', 'Album'], ['folders', 'Folder']].map(([k, n]) => h('button', { class: libTab === k ? 'on' : '', onclick: () => { libTab = k; detail = null; render(); } }, n)));
    if (q) { const ts = sorted(all().filter(t => (t.title + ' ' + t.artist + ' ' + t.album).toLowerCase().includes(q)), (a, b) => a.title.localeCompare(b.title)); return [h('h2', {}, 'Hasil pencarian'), list(ts)]; }
    if (!all().length) return [h('p', { class: 'empty' }, 'Pustaka kosong. Tekan “+ Tambah”.')];
    if (libTab === 'songs') return [tabs, list(sorted(all(), (a, b) => a.title.localeCompare(b.title)))];
    const g = groups(libTab === 'albums' ? 'album' : 'folder'), type = libTab === 'albums' ? 'album' : 'folder';
    return [tabs, h('div', { class: 'cards' }, ...[...g.entries()].sort().map(([k, ts]) => card(k, ts.length + ' lagu', () => { detail = { type, key: k }; render(); })))];
  }

  function playlistsView() {
    return [h('h2', {}, 'Playlist'), h('button', { class: 'btn', onclick: () => newPlaylist() }, '＋ Playlist baru'),
      h('div', { class: 'cards', style: 'margin-top:12px' }, ...playlists.map(p => card(p.name, p.ids.length + ' lagu', () => { detail = { type: 'playlist', key: p.id }; render(); }))),
      playlists.length ? null : h('p', { class: 'empty' }, 'Belum ada playlist. Buat satu, lalu tambahkan lagu lewat menu ⋯.')];
  }

  function eqView() {
    const sl = (label, min, max, step, val, fmtv, onin) => { const out = h('span', {}, fmtv(val)); const i = h('input', { type: 'range', min, max, step, value: val, oninput: e => { onin(+e.target.value); out.textContent = fmtv(+e.target.value); applyEq(); lsset('eq', eq); } }); return h('label', {}, h('span', {}, label), i, out); };
    const rerender = () => { lsset('eq', eq); applyEq(); render(); };
    const sel = h('select', { onchange: e => { eq.preset = e.target.value; eq.gains = PRESETS[eq.preset].slice(); rerender(); } }, ...Object.keys(PRESETS).map(n => h('option', { value: n, ...(n === eq.preset ? { selected: '' } : {}) }, n)));
    return [h('h2', {}, 'Equalizer'), h('div', { class: 'eq' },
      h('label', {}, h('span', {}, 'Aktif'), h('input', { type: 'checkbox', ...(eq.on ? { checked: '' } : {}), onchange: e => { eq.on = e.target.checked; rerender(); } })),
      sel,
      ...BANDS.map((f, i) => sl(f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz', -12, 12, 1, eq.gains[i], v => v + ' dB', v => { eq.gains[i] = v; })),
      h('h2', {}, 'Efek'),
      sl('Bass boost', 0, 12, 1, eq.bass, v => v + ' dB', v => eq.bass = v),
      sl('Reverb', 0, 1, .05, eq.reverb, v => Math.round(v * 100) + '%', v => eq.reverb = v),
      h('p', { class: 'hint' }, 'Efek aktif saat lagu diputar.'))];
  }

  const THEMES = { violet: ['Violet', 'linear-gradient(135deg,#7c5cff,#ff5c9a)'], sunset: ['Sunset', 'linear-gradient(135deg,#d9693a,#f2a65a)'], ocean: ['Ocean', 'linear-gradient(135deg,#1e9bd7,#2ee6c5)'], light: ['Terang', 'linear-gradient(135deg,#6a4cff,#e8458a)'] };
  let theme = ls('theme', 'violet');
  function setTheme(t) { theme = t; lsset('theme', t); document.documentElement.dataset.theme = t === 'violet' ? '' : t; document.querySelector('meta[name=theme-color]').content = getComputedStyle(document.body).getPropertyValue('--bg').trim(); }
  const themeView = () => [h('h2', {}, 'Tema'), h('div', { class: 'themes' }, ...Object.entries(THEMES).map(([k, [n, bg]]) => h('button', { class: theme === k ? 'on' : '', style: 'background:' + bg, onclick: () => { setTheme(k); render(); } }, n))),
    h('h2', {}, 'Tentang'), h('p', { class: 'hint' }, 'music.7mit memutar file musik dari perangkatmu, tanpa upload ke server. Format: MP3, WAV, FLAC, AAC, M4A, OGG (tergantung browser).')];

  function render() {
    const v = $('view'); v.innerHTML = '';
    const q = $('search').value.trim();
    let c;
    if (q) c = library();
    else if (detail) c = detailView();
    else c = { home, library, playlists: playlistsView, eq: eqView, theme: themeView }[view]();
    v.append(...c.flat().filter(Boolean));
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  }

  document.querySelectorAll('#nav button').forEach(b => b.onclick = () => { view = b.dataset.v; detail = null; $('search').value = ''; render(); });
  $('search').oninput = render;
  $('add').onclick = () => sheet(h('h3', {}, 'Tambah musik'), opt('🎵 Pilih file lagu', () => $('files').click()), opt('📁 Pilih seluruh folder', () => $('folder').click()));
  $('files').onchange = $('folder').onchange = e => { importFiles([...e.target.files]); e.target.value = ''; };

  (async () => {
    setTheme(theme);
    try { (await dbAll('tracks')).forEach(t => tracks.set(t.id, t)); playlists = await dbAll('playlists'); } catch { toast('Penyimpanan browser tidak tersedia'); }
    render();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  })();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
