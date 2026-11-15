// Servidor estático mínimo da landing (sem dependências), com gzip como num servidor de produção.
//   cd landing; npm run serve            -> http://localhost:4173   (PORT=xxxx para trocar)
// Nunca abra o index.html por file://: o navegador bloqueia a leitura de data/.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const PORT = Number(process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8',
};
const COMPRESS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.md']);

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
  // Nada fora da pasta landing/ nem arquivos de build/dependências.
  if (!file.startsWith(ROOT + sep) || /[\\/](node_modules|\.build)[\\/]/.test(file)) return res.writeHead(403).end();
  try {
    let body = await readFile(file);
    const ext = extname(file);
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (COMPRESS.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = gzipSync(body);
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
}).listen(PORT, () => console.log(`landing em http://localhost:${PORT}/`));
