// Writes the list of app files and a version (a fingerprint of their contents) into web/sw.js.
// Run after changing anything in web/:  npm run stamp
// `--check` only verifies it is up to date (used by the tests).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(root).map((f) => relative(root, f).split('\\').join('/')).filter((f) => f !== 'sw.js').sort();

const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
const version = hash.digest('hex').slice(0, 12);

const swPath = join(root, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
const next = sw
  .replace(/^const VERSION = .*$/m, `const VERSION = '${version}';`)
  .replace(/^const FILES = .*$/m, `const FILES = ${JSON.stringify(files)};`);

if (process.argv.includes('--check')) {
  if (next !== sw) { console.error('web/sw.js is out of date. Run: npm run stamp'); process.exit(1); }
  console.log(`sw.js up to date (version ${version}, ${files.length} files)`);
} else {
  writeFileSync(swPath, next);
  console.log(`Stamped version ${version} (${files.length} files)`);
}
