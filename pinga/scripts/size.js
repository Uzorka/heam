// Reports the app's download size (gzipped) and fails if JavaScript is over budget.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BUDGET_JS_KB = 100;
const root = fileURLToPath(new URL('../web/', import.meta.url));

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const rows = walk(root).filter((f) => ['.js', '.css', '.html', '.webmanifest', '.woff2'].includes(extname(f)))
  .map((f) => ({ file: relative(root, f), kb: gzipSync(readFileSync(f), { level: 9 }).length / 1024 }));

const total = (ext) => rows.filter((r) => extname(r.file) === ext).reduce((s, r) => s + r.kb, 0);
for (const r of rows) console.log(`${r.kb.toFixed(1).padStart(6)} KB  ${r.file}`);
// Managers' screens are only downloaded by managers, so they don't count towards the staff budget.
const MANAGER_ONLY = ['js/admin.js', 'js/today.js', 'js/overview.js', 'js/export.js', 'js/xlsx.js', 'js/billing.js', 'js/getstarted.js', 'js/stock.js', 'js/sheet.js'];
const managerOnly = (f) => MANAGER_ONLY.includes(f) || f.startsWith('vendor/');
const js = rows.filter((r) => extname(r.file) === '.js' && !managerOnly(r.file)).reduce((s, r) => s + r.kb, 0);
console.log(`\nStaff app JavaScript: ${js.toFixed(1)} KB of ${BUDGET_JS_KB} KB budget (gzipped)`);
console.log(`All JavaScript incl. managers' screens: ${total('.js').toFixed(1)} KB`);
console.log(`Fonts (Nunito 400/700/800, slimmed): ${total('.woff2').toFixed(1)} KB`);
console.log(`Everything: ${rows.reduce((s, r) => s + r.kb, 0).toFixed(1)} KB`);
if (js > BUDGET_JS_KB) { console.error('Over budget!'); process.exit(1); }
