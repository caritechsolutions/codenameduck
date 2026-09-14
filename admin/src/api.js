// Thin fetch wrapper for /api/admin. Same-origin; the session cookie rides along.
export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || `HTTP ${status}`);
    this.status = status;
    this.body = body;
    this.errors = body && body.errors;
  }
}

export async function api(method, path, body, opts = {}) {
  const init = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch('/api/admin' + path, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { error: text }; }
  if (!res.ok) {
    if (res.status === 401 && !opts.noRedirect && typeof window !== 'undefined' && !location.pathname.endsWith('/login')) {
      window.dispatchEvent(new CustomEvent('cc:unauthorized'));
    }
    throw new ApiError(res.status, json);
  }
  return json;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);
