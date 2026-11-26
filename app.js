(() => {
  const $ = id => document.getElementById(id);
  const audio = $('audio'), list = $('list');
  let tracks = [], idx = -1, shuffle = false, repeat = 0; // repeat: 0 off, 1 all, 2 one

  const fmt = s => isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00';
  const clean = n => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');

  function render() {
    const q = $('search').value.toLowerCase();
    list.innerHTML = '';
    tracks.forEach((t, i) => {
      if (!t.name.toLowerCase().includes(q)) return;
      const li = document.createElement('li');
      if (i === idx) li.className = 'on';
      li.innerHTML = '<span></span><button title="Hapus">✕</button>';
      li.firstChild.textContent = t.name;
      li.onclick = () => play(i);
      li.lastChild.onclick = e => { e.stopPropagation(); remove(i); };
      list.appendChild(li);
    });
    $('empty').style.display = tracks.length ? 'none' : 'block';
  }

  function play(i) {
    if (!tracks[i]) return;
    idx = i;
    audio.src = tracks[i].url;
    audio.play().catch(() => {});
    $('title').textContent = tracks[i].name;
    if ('mediaSession' in navigator)
      navigator.mediaSession.metadata = new MediaMetadata({ title: tracks[i].name, artist: 'music.7mit' });
    render();
  }

  function remove(i) {
    URL.revokeObjectURL(tracks[i].url);
    tracks.splice(i, 1);
    if (i === idx) { audio.pause(); audio.removeAttribute('src'); idx = -1; $('title').textContent = '—'; }
    else if (i < idx) idx--;
    render();
  }

  function step(dir) {
    if (!tracks.length) return;
    let n;
    if (shuffle && tracks.length > 1) { do n = Math.floor(Math.random() * tracks.length); while (n === idx); }
    else n = (idx + dir + tracks.length) % tracks.length;
    play(n);
  }

  $('files').onchange = e => {
    for (const f of e.target.files) tracks.push({ name: clean(f.name), url: URL.createObjectURL(f) });
    e.target.value = '';
    render();
    if (idx < 0 && tracks.length) play(0);
  };
  $('search').oninput = render;
  $('play').onclick = () => { if (idx < 0) play(0); else audio.paused ? audio.play() : audio.pause(); };
  $('next').onclick = () => step(1);
  $('prev').onclick = () => audio.currentTime > 3 ? (audio.currentTime = 0) : step(-1);
  $('shuffle').onclick = e => { shuffle = !shuffle; e.target.classList.toggle('active', shuffle); };
  $('repeat').onclick = e => {
    repeat = (repeat + 1) % 3;
    e.target.classList.toggle('active', repeat > 0);
    e.target.textContent = repeat === 2 ? '🔂' : '🔁';
  };
  $('seek').oninput = e => { if (audio.duration) audio.currentTime = e.target.value / 1000 * audio.duration; };

  audio.onplay = () => $('play').textContent = '⏸';
  audio.onpause = () => $('play').textContent = '▶';
  audio.ontimeupdate = () => {
    $('cur').textContent = fmt(audio.currentTime);
    $('dur').textContent = fmt(audio.duration);
    if (audio.duration) $('seek').value = audio.currentTime / audio.duration * 1000;
  };
  audio.onended = () => {
    if (repeat === 2) play(idx);
    else if (repeat === 1 || idx < tracks.length - 1 || shuffle) step(1);
  };

  if ('mediaSession' in navigator) {
    const m = navigator.mediaSession;
    m.setActionHandler('play', () => audio.play());
    m.setActionHandler('pause', () => audio.pause());
    m.setActionHandler('nexttrack', () => step(1));
    m.setActionHandler('previoustrack', () => step(-1));
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
})();
