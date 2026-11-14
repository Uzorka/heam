// Uploads web/ to a Hostinger website (static files, nothing to build).
// Needs a short-lived upload pass from Hostinger (generated per publish, never stored):
//   UPLOAD_URL=... X_AUTH=... X_AUTH_REST=... node scripts/publish.js
// Run `npm run stamp` and `npm test` first.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const { UPLOAD_URL, X_AUTH, X_AUTH_REST } = process.env;
if (!UPLOAD_URL || !X_AUTH || !X_AUTH_REST) { console.error('Missing UPLOAD_URL / X_AUTH / X_AUTH_REST'); process.exit(1); }
const root = fileURLToPath(new URL('../web/', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = [
  ...walk(root).map((f) => [relative(root, f).split('\\').join('/'), readFileSync(f)]),
  ['.htaccess', readFileSync(new URL('../hosting/htaccess', import.meta.url))],
];
// sw.js last, so phones only see the new version once every file is in place.
files.sort((a, b) => (a[0] === 'sw.js') - (b[0] === 'sw.js'));

const auth = { 'X-Auth': X_AUTH, 'X-Auth-Rest': X_AUTH_REST, 'Tus-Resumable': '1.0.0' };
for (const [path, body] of files) {
  const url = `${UPLOAD_URL}/${path}?override=true`;
  const a = await fetch(url, { method: 'POST', headers: { ...auth, 'Upload-Length': String(body.length), 'Upload-Offset': '0' } });
  if (a.status !== 201) throw new Error(`${path}: create failed ${a.status} ${await a.text()}`);
  const b = await fetch(url, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' }, body });
  if (b.status !== 204) throw new Error(`${path}: upload failed ${b.status} ${await b.text()}`);
  console.log(`  uploaded ${path} (${(body.length / 1024).toFixed(1)} KB)`);
}
console.log(`Published ${files.length} files. Now clear Hostinger's cache for this site (see README → Deploy).`);
