// Cliente da API: JSON, cookie de sessão, header CSRF, deduplicação de GETs em voo e cancelamento.
let csrfToken = null;
const inFlight = new Map();

export function setCsrf(token) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(status, body) {
    const err = body?.error || {};
    super(err.message || 'Algo deu errado. Tente de novo.');
    this.status = status;
    this.code = err.code || (status === 0 ? 'network' : 'error');
    this.details = err.details;
  }
}

async function request(method, path, { body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  const binary = body instanceof Blob; // upload de imagem: corpo bruto, o servidor valida o conteúdo
  if (body !== undefined) headers['Content-Type'] = binary ? body.type || 'application/octet-stream' : 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, { error: { code: 'network', message: 'Sem conexão com o servidor. Verifique sua internet.' } });
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// GETs iguais e simultâneos compartilham a mesma promessa (sem signal: quem cancela é o chamador).
export function get(path, opts = {}) {
  if (opts.signal) return request('GET', path, opts);
  if (!inFlight.has(path)) {
    inFlight.set(path, request('GET', path).finally(() => inFlight.delete(path)));
  }
  return inFlight.get(path);
}

export const post = (path, body, opts) => request('POST', path, { ...opts, body: body ?? {} });
export const put = (path, body, opts) => request('PUT', path, { ...opts, body });
export const del = (path, opts) => request('DELETE', path, opts);

// Cache em memória para recursos que mudam raramente (geometrias, catálogo).
const memo = new Map();
export function getCached(path) {
  if (!memo.has(path)) {
    const p = get(path).catch((e) => {
      memo.delete(path);
      throw e;
    });
    memo.set(path, p);
  }
  return memo.get(path);
}
