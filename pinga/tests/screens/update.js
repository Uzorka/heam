// Updating the app on a phone that already has an older version.
// Recreates the bug seen on a real phone: the server allowed files to be kept for a day, a new
// version was published, and the offline copy was rebuilt from the phone's OLD saved files
// (new code + old stylesheet: no brand colours, black logo).
//   node tests/screens/update.js
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const web = new URL('../../web/', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'pinga-update-')) + '/';
cpSync(web, root, { recursive: true });

// Same as scripts/stamp.js, for this copy.
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
function stamp() {
  const files = walk(root).map((f) => relative(root, f)).filter((f) => f !== 'sw.js' && !f.startsWith('vendor/')).sort();
  const h = createHash('sha256');
  for (const f of files) h.update(f).update(readFileSync(join(root, f)));
  const sw = readFileSync(root + 'sw.js', 'utf8')
    .replace(/^const VERSION = .*$/m, `const VERSION = '${h.digest('hex').slice(0, 12)}';`)
    .replace(/^const FILES = .*$/m, `const FILES = ${JSON.stringify(files)};`);
  writeFileSync(root + 'sw.js', sw);
}
const css = readFileSync(web + 'css/app.css', 'utf8');
const OLD = 'rgb(245, 245, 247)', NEW = 'rgb(255, 248, 238)';     // old grey vs. brand cream

// Version 1: the old grey look.
writeFileSync(root + 'css/app.css', css.replace('--cream: #FFF8EE;', '--cream: #F5F5F7;'));
stamp();

process.env.WEB_ROOT = root;
process.env.CACHE_HEADER = 'public, max-age=86400';    // how files were served before the fix
const { server } = await import('../../scripts/serve.js');
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
const page = await ctx.newPage();
const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const step = (s) => console.log('ok -', s);
try {
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  assert.equal(await bg(), OLD);
  step('phone has version 1 (old look) saved for offline use');

  // Publish version 2: the brand look.
  writeFileSync(root + 'css/app.css', css);
  stamp();
  const v2 = /const VERSION = '([^']+)'/.exec(readFileSync(root + 'sw.js', 'utf8'))[1];

  // The person opens the app again. It should switch to version 2 by itself.
  await page.reload();
  await page.waitForFunction(async (v) => (await caches.keys()).includes('pinga-' + v), v2, { timeout: 20000 });
  await page.waitForFunction((want) => getComputedStyle(document.body).backgroundColor === want, NEW, { timeout: 20000 });
  step('after an update, the app switches itself to the new version');
  const cached = await page.evaluate(async (v) => {
    const c = await caches.open('pinga-' + v);
    return (await (await c.match('css/app.css')).text()).includes('--cream: #FFF8EE');
  }, v2);
  assert.ok(cached, 'the offline copy holds the NEW stylesheet, not the old one kept by the phone');
  step('the offline copy is rebuilt from fresh files, never from old ones the phone kept');
  const logo = await page.evaluate(() => getComputedStyle(document.querySelector('.logo > path')).fill);
  assert.equal(logo, 'rgb(255, 138, 31)', 'logo is mango orange');
  step('logo is mango orange');
} finally {
  await browser.close();
  server.close();
  rmSync(root, { recursive: true, force: true });
}
