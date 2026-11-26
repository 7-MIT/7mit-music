// Tiny DOM toolkit: element builder, icons, formatters, toasts, sheets and modals. All text is set via DOM APIs (no innerHTML with data).
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const k in attrs || {}) {
    const v = attrs[k]; if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') { for (const sk in v) sk.startsWith('--') ? e.style.setProperty(sk, v[sk]) : (e.style[sk] = v[sk]); }
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v); else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k in e && k !== 'list' && k !== 'form') { try { e[k] = v; } catch { e.setAttribute(k, v); } } else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const P = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>', explore: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', library: '<path d="M4 4v16M9 4v16"/><path d="m14 5.5 5 1.4-3.6 13.2-5-1.4z"/>',
  together: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.8 0 4.5 2 4.5 5"/>',
  stats: '<path d="M5 20V10M12 20V4M19 20v-7"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>', pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
  prev: '<path d="M19 5v14L8.5 12z" fill="currentColor"/><path d="M5.5 5v14"/>', next: '<path d="M5 5v14l10.5-7z" fill="currentColor"/><path d="M18.5 5v14"/>',
  shuffle: '<path d="M3 7h3c4 0 5.5 10 9.5 10H21M3 17h3c1.6 0 2.7-1.2 3.6-2.7M14.5 8.2C15 7.5 15.6 7 16.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3"/>', repeat1: '<path d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3"/><path d="M11 10.5l1.5-1v5"/>',
  heart: '<path d="M12 20s-7.5-4.6-9-9.3C2 7.5 4 5 6.8 5c1.9 0 3.4 1 5.2 3 1.8-2 3.3-3 5.2-3C20 5 22 7.5 21 10.7c-1.5 4.7-9 9.3-9 9.3z"/>',
  queue: '<path d="M4 6h12M4 11h12M4 16h6"/><path d="M15 14v6l5-3z" fill="currentColor"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  lyrics: '<path d="M4 5h16M4 10h10M4 15h16M4 20h8"/>', music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', dots: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>', down: '<path d="m6 9 6 6 6-6"/>', back: '<path d="m15 5-7 7 7 7"/>', chev: '<path d="m9 5 7 7-7 7"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>', mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', grip: '<circle cx="9" cy="7" r="1.3" fill="currentColor"/><circle cx="15" cy="7" r="1.3" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="17" r="1.3" fill="currentColor"/><circle cx="15" cy="17" r="1.3" fill="currentColor"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>', list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>', sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  share: '<path d="M4 12v7h16v-7M12 3v12M8 7l4-4 4 4"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>', history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', up: '<path d="M12 19V5M6 11l6-6 6 6"/>', arrowdown: '<path d="M12 5v14M6 13l6 6 6-6"/>', undo: '<path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>',
  chart: '<path d="M4 20h16M7 16l3-4 3 2 4-6"/>', tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2" fill="currentColor"/>', eq: '<path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="14" r="2" fill="var(--panel)"/><circle cx="12" cy="8" r="2" fill="var(--panel)"/><circle cx="19" cy="15" r="2" fill="var(--panel)"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>', download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  speed: '<path d="M12 14l4-5"/><path d="M4.5 18a9 9 0 1 1 15 0"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  podcast: '<circle cx="12" cy="11" r="2.5"/><path d="M7.5 15.5a6 6 0 1 1 9 0M5 18a9.5 9.5 0 1 1 14 0M12 14v7"/>'
};
export const icon = (n, cls = '') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i ' + cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = P[n] || ''; return s; };

export const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
export const fmtSpoken = s => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60), r = s % 60; return `${m} minute${m === 1 ? '' : 's'} ${r} second${r === 1 ? '' : 's'}`; };
export const fmtDur = ms => { const m = Math.round(ms / 60000); if (m < 1) return `${Math.round(ms / 1000)} sec`; return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
export const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const initials = n => (n || '?').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();

// ---- LRC ----
export function parseLrc(text) {
  const out = [], plain = []; let synced = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]; const line = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (tags.length) { synced = true; if (line) for (const t of tags) out.push({ t: +t[1] * 60 + parseFloat(t[2]), text: line }); }
    else if (raw.trim() && !/^\[[a-z]+:/i.test(raw.trim())) plain.push({ t: null, text: raw.trim() });
  }
  return synced ? { synced: true, lines: out.sort((a, b) => a.t - b.t) } : { synced: false, lines: plain };
}
export function activeLine(lines, pos) { let lo = 0, hi = lines.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].t <= pos) { r = m; lo = m + 1; } else hi = m - 1; } return r; }

// ---- toast ----
let toasts; export function toast(msg, action) {
  if (!toasts) { toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toasts); }
  const t = h('div', { class: 'toast' }, h('span', msg), action && h('button', { onclick: () => { action.fn(); t.remove(); } }, action.label)); toasts.append(t); setTimeout(() => t.remove(), action ? 6000 : 2800); return t;
}
// ---- sheets & modals ----
function scrim(content, center) {
  const prevFocus = document.activeElement;
  const s = h('div', { class: 'scrim' + (center ? ' center' : ''), role: 'dialog', 'aria-modal': 'true' }, content);
  const close = () => { s.remove(); document.removeEventListener('keydown', onKey, true); prevFocus?.focus?.(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  s.addEventListener('mousedown', e => { if (e.target === s) close(); }); document.addEventListener('keydown', onKey, true);
  document.body.append(s); (content.querySelector('input,textarea,select,button') || content).focus?.(); return { close, el: s };
}
export function sheet(title, items) {
  let ctl; const body = h('div', { class: 'sheet', tabindex: -1 }, h('div', { class: 'grab' }), title && h('h3', title),
    items.filter(Boolean).map(it => h('button', { class: 'opt' + (it.danger ? ' danger' : ''), onclick: () => { ctl.close(); it.onclick?.(); } }, it.icon && icon(it.icon), it.label)));
  ctl = scrim(body); return ctl;
}
export function modal(title, content, actions = [{ label: 'Close' }]) {
  let ctl; const acts = h('div', { class: 'acts' }, actions.map(a => h('button', { class: 'btn ' + (a.primary ? 'primary' : 'ghost') + (a.danger ? ' danger' : ''), onclick: async () => { const r = await a.onclick?.(); if (r !== false) ctl.close(); } }, a.label)));
  ctl = scrim(h('div', { class: 'modal', tabindex: -1 }, h('h3', title), content, acts), true); return ctl;
}
export const confirmBox = (title, msg, ok = 'Confirm', danger = false) => new Promise(res => { let done = false; const fin = v => { if (!done) { done = true; res(v); } }; const m = modal(title, h('p', { class: 'muted' }, msg), [{ label: 'Cancel', onclick: () => fin(false) }, { label: ok, primary: !danger, danger, onclick: () => fin(true) }]); m.el.addEventListener('remove', () => fin(false)); const o = new MutationObserver(() => { if (!document.body.contains(m.el)) { fin(false); o.disconnect(); } }); o.observe(document.body, { childList: true }); });
export const promptBox = (title, label, value = '', ok = 'Save') => new Promise(res => {
  let done = false; const inp = h('input', { type: 'text', value, maxLength: 80, 'aria-label': label, onkeydown: e => { if (e.key === 'Enter') { done = true; res(inp.value.trim()); m.close(); } } });
  const m = modal(title, h('div', { class: 'field' }, h('label', label), inp), [{ label: 'Cancel', onclick: () => { done = true; res(null); } }, { label: ok, primary: true, onclick: () => { done = true; res(inp.value.trim()); } }]);
  const o = new MutationObserver(() => { if (!document.body.contains(m.el)) { if (!done) res(null); o.disconnect(); } }); o.observe(document.body, { childList: true }); inp.focus(); inp.select();
});
export function skeletonRows(n = 6) { return h('div', { class: 'tracks' }, Array.from({ length: n }, () => h('div', { class: 'row' }, h('div', { class: 'lead skel' }), h('div', h('div', { class: 'skel', style: { height: '14px', width: '55%', marginBottom: '6px' } }), h('div', { class: 'skel', style: { height: '11px', width: '35%' } }))))); }
export function skeletonCards(n = 6) { return h('div', { class: 'shelf' }, Array.from({ length: n }, () => h('div', { class: 'card' }, h('div', { class: 'art skel' }), h('div', { class: 'skel', style: { height: '14px', width: '70%', marginTop: '10px' } })))); }
