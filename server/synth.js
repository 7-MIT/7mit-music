// Procedural, original demo audio. Everything here is generated from math — no samples, no third‑party music.
const SR = 22050;
const MODES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10] };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const degNote = (root, mode, d) => { const s = MODES[mode]; return root + s[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7); };
const chord = (root, mode, d) => [degNote(root, mode, d), degNote(root, mode, d + 2), degNote(root, mode, d + 4)];

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function synthTrack({ bpm, root, mode, prog, style, bars, seed = 1 }) {
  const beat = 60 / bpm, bar = beat * 4, total = Math.ceil(bar * bars * SR);
  const L = new Float32Array(total + SR * 2), R = new Float32Array(total + SR * 2);
  const rand = rng(seed);
  const add = (t, dur, fn, pan = 0.5, gain = 1) => {
    const a = Math.floor(t * SR), n = Math.floor(dur * SR);
    for (let i = 0; i < n && a + i < L.length; i++) { const v = fn(i / SR, i / n) * gain; L[a + i] += v * (1 - pan); R[a + i] += v * pan; }
  };
  const env = (p, att, rel) => Math.min(1, p / att) * Math.min(1, (1 - p) / rel);
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar, ch = chord(root, mode, prog[b % prog.length]);
    // pad
    if (style !== 'folk' || b % 2 === 0) for (const [k, n] of ch.entries()) {
      const f = mtof(n + 12), ph = rand() * 6.28;
      add(t0, bar * 1.05, (t, p) => (Math.sin(6.283 * f * t + ph) + 0.6 * Math.sin(6.283 * f * 1.004 * t)) * env(p, 0.35, 0.4) * 0.05, 0.25 + 0.25 * k);
    }
    // bass
    if (style !== 'ambient') for (let q = 0; q < 4; q++) {
      if (style === 'folk' && q % 2) continue;
      const f = mtof(ch[0] - 12);
      add(t0 + q * beat, beat * 0.95, (t, p) => (Math.sin(6.283 * f * t) + 0.25 * Math.sin(12.566 * f * t)) * env(p, 0.02, 0.5) * 0.22, 0.5);
    }
    // arpeggio / pluck
    const steps = style === 'ambient' ? 2 : 8, stepDur = bar / steps;
    for (let s = 0; s < steps; s++) {
      if (style === 'lofi' && s % 4 === 3 && rand() < 0.5) continue;
      const n = ch[(s * (style === 'folk' ? 1 : 2) + (s >> 2)) % 3] + 12 * (style === 'ambient' ? 1 : 1 + ((s % 4) === 3 ? 1 : 0));
      const f = mtof(n + 12);
      add(t0 + s * stepDur, stepDur * (style === 'ambient' ? 2.2 : 1.8), (t, p) => {
        const sq = style === 'pop' ? Math.sign(Math.sin(6.283 * f * t)) * 0.35 : 0;
        return (Math.sin(6.283 * f * t) * 0.8 + sq * 0.3 + 0.2 * Math.sin(12.566 * f * t)) * Math.exp(-4 * p) * env(p, 0.005, 0.1) * 0.13;
      }, 0.3 + 0.4 * ((s * 37) % 10) / 10);
    }
    // drums
    const kick = q => add(t0 + q * beat, 0.25, (t, p) => Math.sin(6.283 * (45 + 90 * Math.exp(-30 * t)) * t) * Math.exp(-9 * t) * 0.5);
    const noise = (tt, dur, hp, g) => { let lp = 0; add(tt, dur, (t, p) => { const x = rand() * 2 - 1; lp += (x - lp) * hp; return (x - lp) * Math.exp(-8 * p) * g; }); };
    if (style === 'lofi') { kick(0); if (b % 2) kick(2.5); kick(2); noise(t0 + beat, 0.18, 0.35, 0.18); noise(t0 + 3 * beat, 0.18, 0.35, 0.18); for (let h = 0; h < 8; h++) noise(t0 + h * beat / 2 + 0.03, 0.05, 0.9, h % 2 ? 0.05 : 0.08); }
    if (style === 'pop') { for (let q = 0; q < 4; q++) { kick(q); noise(t0 + q * beat + beat / 2, 0.06, 0.95, 0.07); } noise(t0 + beat, 0.2, 0.4, 0.2); noise(t0 + 3 * beat, 0.2, 0.4, 0.2); }
    if (style === 'folk') { kick(0); kick(2); for (let h = 0; h < 8; h++) noise(t0 + h * beat / 2, 0.07, 0.8, 0.05); }
  }
  // feedback delay for space
  const d = Math.floor(beat * 0.75 * SR);
  for (let i = d; i < L.length; i++) { L[i] += R[i - d] * 0.32; R[i] += L[i - d] * 0.32; }
  // normalise, fades, 16‑bit mono-compatible stereo
  let peak = 0; for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.7 / (peak || 1), fi = SR * 0.8, fo = SR * 2.5;
  const out = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    const f = Math.min(1, i / fi) * Math.min(1, (total - i) / fo);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * g * f * 32767))), i * 4);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * g * f * 32767))), i * 4 + 2);
  }
  return { wav: wavFile(out, 2), durationMs: Math.round(total / SR * 1000), barSec: bar };
}

function wavFile(pcm, ch) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export const lrcTime = s => { const m = Math.floor(s / 60); return `[${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}]`; };

// Cover art in the Auralys sun‑and‑waves language (original vector art).
export function coverSvg({ bg, sun, ink = '#171615', seed = 0, title = '' }) {
  const stripes = [0, 1, 2, 3].map(i => `<rect x="120" y="${318 + i * 15}" width="360" height="${5 + i}" fill="${bg}"/>`).join('');
  const dx = (seed % 5) * 6 - 12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600" role="img" aria-label="${title.replace(/[<&"]/g, '')}"><rect width="600" height="600" fill="${bg}"/>
<g transform="translate(${dx} 0)"><path d="M120 340a180 180 0 0 1 360 0z" fill="${sun}"/>${stripes}</g>
<rect x="160" y="408" width="280" height="8" rx="4" fill="${ink}"/>
<path d="M200 460q15-24 30 0t30 0 30 0 30 0 30 0 30 0" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"/></svg>`;
}
