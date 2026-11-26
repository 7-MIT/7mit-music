# music.7mit

Pemutar musik web (PWA) yang bisa di-install di Android/desktop. Tanpa backend, tanpa dependensi.

Fitur: tambah file audio lokal, cari, play/pause, next/prev, acak, ulangi (off/semua/satu), seek bar, kontrol di notifikasi/layar kunci (Media Session), offline via service worker.

## Jalankan
```bash
python3 -m http.server 8000
```
Buka `http://localhost:8000`, lalu "Install app / Add to Home screen" di Chrome.
Untuk jadi APK: bungkus dengan Bubblewrap/TWA atau Capacitor setelah di-host via HTTPS.
