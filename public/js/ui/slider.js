// Seek slider: Auralys "wavy" progress (animated sine for the played part) or a straight bar. Accessible slider semantics + keyboard.
import { fmtSpoken, reducedMotion } from '../core/dom.js';
import { h } from '../core/dom.js';
import { app } from '../core/app.js';
export function seekSlider({ getPos, getDur, onSeek, label = 'Seek' }) {
  const cv = h('canvas', { class: 'wave', role: 'slider', tabindex: 0, 'aria-label': label, 'aria-valuemin': 0 });
  let amp = 0, phase = 0, dragging = false, dragP = 0, color = '', colorAt = 0, raf = 0, hover = false;
  const ratio = () => { const d = getDur(); return d > 0 ? Math.max(0, Math.min(1, (dragging ? dragP : getPos() / d))) : 0; };
  function draw(playing) {
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (performance.now() - colorAt > 600) { color = getComputedStyle(cv).getPropertyValue('--wave') || ''; colorAt = performance.now(); if (!color.trim()) color = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft'); }
    const target = app.prefs.slider === 'wavy' && playing && !reducedMotion() ? 4 : 0; amp += (target - amp) * 0.12; phase += 0.07;
    const x1 = 4 + (W - 8) * ratio(), y = H / 2; g.lineCap = 'round'; g.lineWidth = 3.2; g.strokeStyle = color.trim() || '#e1b29c';
    g.globalAlpha = .38; g.beginPath(); g.moveTo(x1, y); g.lineTo(W - 4, y); g.stroke(); g.globalAlpha = 1;
    g.beginPath(); for (let x = 4; x <= x1; x += 2) { const f = Math.min(1, (x - 4) / 14); const yy = y + Math.sin(x / 7 - phase) * amp * f; x === 4 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke();
    g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(x1, y, dragging || hover ? 7 : 5, 0, 7); g.fill();
    const d = getDur(), p = d * ratio(); cv.setAttribute('aria-valuemax', Math.round(d)); cv.setAttribute('aria-valuenow', Math.round(p)); cv.setAttribute('aria-valuetext', `${fmtSpoken(p)} of ${fmtSpoken(d)}`);
  }
  const loop = () => { if (!cv.isConnected) { raf = 0; return; } draw(cv._playing); raf = requestAnimationFrame(loop); };
  cv.start = () => { if (!raf) raf = requestAnimationFrame(loop); }; cv.setPlaying = v => { cv._playing = v; };
  const at = e => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left - 4) / (r.width - 8))); };
  cv.addEventListener('pointerdown', e => { if (!getDur()) return; dragging = true; dragP = at(e); cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { hover = true; if (dragging) dragP = at(e); });
  cv.addEventListener('pointerleave', () => hover = false);
  cv.addEventListener('pointerup', e => { if (!dragging) return; dragging = false; onSeek(at(e) * getDur()); });
  cv.addEventListener('keydown', e => { const d = getDur(), p = getPos(), k = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30 }[e.key]; if (k) { e.preventDefault(); e.stopPropagation(); onSeek(Math.max(0, Math.min(d, p + k))); } else if (e.key === 'Home') { e.preventDefault(); onSeek(0); } else if (e.key === 'End') { e.preventDefault(); onSeek(Math.max(0, d - 1)); } });
  const mo = new MutationObserver(() => { if (cv.isConnected) { cv.start(); } }); mo.observe(document.body, { childList: true, subtree: true });
  return cv;
}
