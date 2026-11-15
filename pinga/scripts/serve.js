// Serves web/ on http://localhost:8080 for local testing. No dependencies.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// WEB_ROOT / CACHE_HEADER: used by the update test to serve a copy with old-style caching.
const root = process.env.WEB_ROOT || fileURLToPath(new URL('../web/', import.meta.url));
const siteRoot = fileURLToPath(new URL('../site/', import.meta.url));   // the landing page, served at /home/ (as on staging)
const types = { '.woff2': 'font/woff2', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT) || 8080;

export const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let base = root;
  if (/^[/\\]home([/\\]|$)/.test(path)) { base = siteRoot; path = path.replace(/^[/\\]home/, '') || '/'; }
  const file = join(base, path.endsWith('/') || path.endsWith('\\') ? path + 'index.html' : path);
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': process.env.CACHE_HEADER || 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, () => console.log(`Pinga running at http://localhost:${port}`));
}
