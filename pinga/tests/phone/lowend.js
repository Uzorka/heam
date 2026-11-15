// Low-end phone test on the HOSTED staging site with the real staging database.
// Chrome slowed to "slow 3G" (400 ms latency, 400 kbps) and a 4× slower CPU, 360 px screen.
// Times what a staff member actually waits for, and how much memory the app uses.
//   NODE_USE_ENV_PROXY=1 node tests/phone/lowend.js
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CONFIG_FOR } from '../../scripts/projects.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const SITE = CONFIG_FOR.staging.site + '/';
const { ref } = CONFIG_FOR.staging;
const out = new URL('./output/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST',
    headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected'}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d;
};

const phone = '+234700' + String(Date.now()).slice(-7);
const login = phone.slice(1) + '@phone.usepinga.com';
const [{ company, token }] = await sql(`
  with c as (insert into public.companies (name) values ('Phone check (auto-deleted)') returning id),
       b as (insert into public.branches (company_id, name, lat, lng) select id, 'Yaba office', 6.5095, 3.3711 from c),
       m as (insert into public.members (company_id, full_name, phone, role) select id, 'Ada Phone', '${phone}', 'staff' from c returning invite_token)
  select (select id from c) as company, m.invite_token as token from m;`);

const results = [];
const time = async (label, fn) => { const t0 = Date.now(); await fn(); const s = (Date.now() - t0) / 1000; results.push([label, s]); console.log(`  ${label}: ${s.toFixed(1)} s`); };

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ proxy, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: !!proxy,
    permissions: ['geolocation', 'camera'], geolocation: { latitude: 6.5096, longitude: 3.3712, accuracy: 12 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  const slow3g = { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 50000 };
  await cdp.send('Network.emulateNetworkConditions', slow3g);
  await cdp.send('Performance.enable');

  console.log('Slow 3G + 4× slower CPU, 360 px:');
  await time('first open, nothing cached (sign-in screen ready)', async () => {
    await page.goto(SITE);
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  });
  await time('invite link → PIN screen', async () => {
    await page.goto(SITE + '#/join/' + token);
    await page.getByLabel('New PIN').waitFor();
  });
  await page.getByLabel('New PIN').fill('482913');
  await page.getByLabel('Type it again').fill('482913');
  await time('save PIN → signed in (photo screen ready)', async () => {
    await page.getByRole('button', { name: 'Save PIN' }).click();
    await page.getByRole('button', { name: 'I agree, take photo' }).waitFor();
  });
  await time('take reference photo → home screen', async () => {
    await page.getByRole('button', { name: 'I agree, take photo' }).click();
    await page.getByRole('link', { name: 'Clock in' }).waitFor();
  });
  await time('tap Clock in → camera + GPS ready', async () => {
    await page.getByRole('link', { name: 'Clock in' }).click();
    await page.getByRole('button', { name: 'Take photo and clock in' }).waitFor();
  });
  await time('tap "Take photo and clock in" → saved on phone', async () => {
    await page.getByRole('button', { name: 'Take photo and clock in' }).click();
    await page.getByText(/Clocked in at/).first().waitFor();
  });
  await time('…and received by the server', async () => {
    for (let i = 0; i < 60; i++) {
      const [{ n }] = await sql(`select count(*)::int as n from public.attendance where company_id = '${company}'`);
      if (n) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('clock-in never reached the server');
  });
  await page.screenshot({ path: out + 'lowend-clocked-in.png' });
  await time('reopen the app (files already on the phone)', async () => {
    await page.reload();
    await page.getByRole('link', { name: 'Clock out' }).waitFor();
  });
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await time('reopen with NO signal', async () => {
    await page.reload();
    await page.getByRole('link', { name: 'Clock out' }).waitFor();
  });
  await cdp.send('Network.emulateNetworkConditions', slow3g);

  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const heapMb = m.JSHeapUsedSize / 1048576;
  console.log(`  memory used by the app's JavaScript: ${heapMb.toFixed(1)} MB; page elements: ${m.Nodes}`);
  results.push(['JavaScript memory (MB)', heapMb]);
  const bytes = await page.evaluate(() => performance.getEntriesByType('resource').reduce((s, e) => s + (e.transferSize || 0), 0));
  console.log(`  downloaded on this visit: ${(bytes / 1024).toFixed(0)} KB`);
  assert.ok(heapMb < 30, 'stays light on memory');
} finally {
  await browser.close();
  await sql(`
    set local storage.allow_delete_query = 'true';
    delete from storage.objects where bucket_id = 'photos' and name like '${company}/%';
    delete from public.companies where id = '${company}';
    delete from auth.users where email = '${login}';`);
  console.log('test company, login and photos deleted');
}
