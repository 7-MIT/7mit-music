// History-API router with param routes. Links with data-link or same-origin hrefs are intercepted.
const routes = []; let current = null, outlet, onChange = () => {}, token = 0;
export const route = (pattern, loader, meta = {}) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$'); routes.push({ re, keys, loader, meta }); };
export function init(el, cb) {
  outlet = el; onChange = cb;
  addEventListener('popstate', () => render());
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href]'); if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.target || a.hasAttribute('download')) return;
    const u = new URL(a.href, location.href); if (u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/media/') || u.pathname.startsWith('/legacy')) return;
    e.preventDefault(); go(u.pathname + u.search);
  });
  return render();
}
export const go = (path, { replace = false } = {}) => { if (path === location.pathname + location.search) return; history[replace ? 'replaceState' : 'pushState']({}, '', path); return render(); };
export const query = () => new URLSearchParams(location.search);
export const here = () => current;
async function render() {
  const path = location.pathname, my = ++token; let m = null;
  for (const r of routes) { const x = r.re.exec(path); if (x) { m = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(x[i + 1])])) }; break; } }
  m ||= { r: routes.find(r => r.meta.notFound), params: {} };
  if (m.r.meta.overlay) { onChange(path, m.r.meta); return; } // overlay routes (player/lyrics/queue) keep the page underneath
  if (current?.cleanup) { try { current.cleanup(); } catch {} }
  current = { path, meta: m.r.meta, cleanup: null };
  onChange(path, m.r.meta);
  const page = document.createElement('div'); page.className = 'page'; outlet.replaceChildren(page);
  try { const res = await m.r.loader({ params: m.params, query: query(), el: page, isStale: () => my !== token }); if (my !== token) return; if (typeof res === 'function') current.cleanup = res; } catch (e) { console.error(e); if (my === token) page.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Something went wrong loading this page.' })); }
  const sc = outlet.closest('.main'); if (my === token && sc) sc.scrollTop = 0;
}
export const refresh = () => render();
