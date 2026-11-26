export class ApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
export async function api(path, { method = 'GET', body, raw, headers = {}, signal } = {}) {
  const opts = { method, headers: { 'X-Auralys': '1', ...headers }, credentials: 'same-origin', signal };
  if (raw !== undefined) opts.body = raw; else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  let res; try { res = await fetch(path, opts); } catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError(0, 'You appear to be offline or the server is unreachable.', 'offline'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText, data?.code);
  return data;
}
export const get = (p, o) => api(p, o);
export const post = (p, body, o) => api(p, { method: 'POST', body, ...o });
export const put = (p, body, o) => api(p, { method: 'PUT', body, ...o });
export const del = (p, o) => api(p, { method: 'DELETE', ...o });
