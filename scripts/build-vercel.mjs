// Monta a saída estática da Vercel (.vercel-out): landing em / e o build do Vite em /app/. Ver docs/DEPLOY.md.
//   node scripts/build-vercel.mjs        (PRODUCT_NAME vem do ambiente da Vercel ou do .env da raiz)
// O mesmo que o Dockerfile do frontend copia para o nginx: só o que a página publica.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.vercel-out');

if (!process.env.PRODUCT_NAME && existsSync(join(ROOT, '.env'))) {
  const m = readFileSync(join(ROOT, '.env'), 'utf8').match(/^PRODUCT_NAME=(.+)$/m);
  if (m) process.env.PRODUCT_NAME = m[1].trim();
}
if (!process.env.PRODUCT_NAME) throw new Error('PRODUCT_NAME não definido (variável de ambiente da Vercel ou .env).');

execSync('npx vite build', { cwd: join(ROOT, 'frontend'), stdio: 'inherit', env: process.env });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, 'landing/index.html'), join(OUT, 'index.html'));
for (const d of ['css', 'js', 'assets', 'data', 'video']) cpSync(join(ROOT, 'landing', d), join(OUT, d), { recursive: true });
mkdirSync(join(OUT, 'shared'));
cpSync(join(ROOT, 'shared/design-tokens.css'), join(OUT, 'shared/design-tokens.css'));
cpSync(join(ROOT, 'frontend/dist'), join(OUT, 'app'), { recursive: true });
console.log('ok: .vercel-out (landing em /, app em /app/)');
