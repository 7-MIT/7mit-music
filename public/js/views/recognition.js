import { h, icon, toast, confirmBox } from '../core/dom.js';
import { app } from '../core/app.js';
import { get, api, del } from '../core/api.js';
import { empty, signInPrompt } from '../ui/components.js';

export default async function recognition({ el }) {
  el.append(h('div', { class: 'pagehead' }, h('div', h('h1', 'Recognition'), h('p', 'Identify a song that’s playing nearby.'))));
  if (!app.user) return el.append(signInPrompt('music recognition'));
  const feat = app.config.features.recognition, status = h('div', { 'aria-live': 'polite', style: { minHeight: '60px' } }), hist = h('div');
  const btn = h('button', { class: 'pbtn', style: { width: '104px', height: '104px' }, 'aria-label': feat.available ? 'Listen and identify' : 'Test microphone' }, icon('mic'));
  el.append(h('div', { class: 'panel', style: { textAlign: 'center' } }, btn, h('p', { style: { fontWeight: 600, margin: '14px 0 4px' } }, feat.available ? 'Tap to listen for 8 seconds' : 'Tap to test your microphone'), status,
    h('p', { class: feat.available ? 'muted' : 'note warn', style: { fontSize: '13.5px', maxWidth: '60ch', margin: '12px auto 0', textAlign: 'left' } }, feat.available ? 'Privacy: the microphone is only used after you tap, for 8 seconds. That short sample is sent to the recognition service configured on this server (AudD) and is not stored here. Results are saved to your history.' : `No recognition provider is configured on this server, so no match can be made. ${feat.note} You can still test that your microphone works; nothing is recorded or sent.`)),
    h('h2', { class: 'sec' }, 'History', h('button', { class: 'btn sm ghost more', style: { marginLeft: 'auto' }, onclick: async () => { if (await confirmBox('Clear recognition history?', '', 'Clear', true)) { await del('/api/recognize/history'); load(); } } }, 'Clear')), hist);
  let busy = false;
  btn.onclick = async () => {
    if (busy) return; if (!navigator.mediaDevices?.getUserMedia) return status.replaceChildren(h('p', { class: 'err' }, 'This browser can’t access a microphone (HTTPS or localhost is required).'));
    busy = true; status.replaceChildren(h('p', 'Waiting for microphone permission…'));
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { busy = false; return status.replaceChildren(h('p', { class: 'err' }, e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'Microphone access was denied. Allow it in your browser’s site settings and try again — nothing was recorded.' : e.name === 'NotFoundError' ? 'No microphone was found on this device.' : 'Couldn’t start the microphone: ' + e.message)); }
    if (!feat.available) { stream.getTracks().forEach(t => t.stop()); busy = false; return status.replaceChildren(h('p', { style: { color: '#6fcf8f' } }, '✓ Microphone works. Nothing was recorded.')); }
    btn.classList.add('on'); status.replaceChildren(h('p', 'Listening…'));
    const chunks = []; const mr = new MediaRecorder(stream); mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    mr.onstop = async () => { stream.getTracks().forEach(t => t.stop()); btn.classList.remove('on'); status.replaceChildren(h('p', 'Matching…')); try { const blob = new Blob(chunks, { type: mr.mimeType }); const r = await api('/api/recognize', { method: 'POST', raw: blob, headers: { 'Content-Type': mr.mimeType || 'audio/webm' } }); status.replaceChildren(r.matched ? h('div', h('h3', { style: { font: '600 24px var(--serif)' } }, r.result.title), h('p', { class: 'muted' }, `${r.result.artist}${r.result.album ? ' · ' + r.result.album : ''}`)) : h('p', 'No match found. Try again closer to the source.')); load(); } catch (e) { status.replaceChildren(h('p', { class: 'err' }, e.message)); } busy = false; };
    mr.start(); setTimeout(() => mr.state === 'recording' && mr.stop(), 8000);
  };
  async function load() { try { const r = await get('/api/recognize/history'); hist.replaceChildren(r.items.length ? h('div', { class: 'tracks' }, r.items.map(i => h('div', { class: 'row', style: { gridTemplateColumns: '1fr auto' } }, h('div', { class: 'rm' }, h('div', { class: 'rt' }, i.matched ? i.result.title : 'No match'), h('div', { class: 'rs' }, i.matched ? i.result.artist : 'Nothing identified')), h('span', { class: 'rd' }, new Date(i.created_at).toLocaleString())))) : empty('mic', 'No recognitions yet')); } catch (e) { hist.textContent = e.message; } }
  load();
}
