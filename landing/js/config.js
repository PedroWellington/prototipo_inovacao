// O app fica no mesmo endereço da landing, em /app/ (rotas por hash: #/register, #/login, #/home).
export const APP_URL = '/app/';
// Sessão do app (cookie httpOnly): 200 = logado, 401 = visitante. Consultada só depois do primeiro desenho.
export const SESSION_URL = '/api/auth/me';
