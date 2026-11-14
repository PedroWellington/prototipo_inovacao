import { ApiError, get, setCsrf } from './api.js';

// Usuário logado (ou null). Carregado uma vez e atualizado após login/logout/onboarding.
let user;

export async function loadUser(force = false) {
  if (user !== undefined && !force) return user;
  try {
    user = await get('/api/auth/me');
    setCsrf(user.csrf_token);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    user = null;
    setCsrf(null);
  }
  return user;
}

export function clearUser() {
  user = null;
  setCsrf(null);
}
