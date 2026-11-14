// Real browser on the HOSTED staging site, against the real staging database.
// Invite → PIN → reference photo → clock in → record arrives. Then everything is deleted.
//   NODE_USE_ENV_PROXY=1 node tests/staging/browser.js
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CONFIG_FOR } from '../../scripts/projects.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const SITE = 'https://staging.elvisuzorka.com/';
const { ref } = CONFIG_FOR.staging;
const out = new URL('./output/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected'}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d;
};
const step = (s) => console.log('ok -', s);

const phone = '+234700' + String(Date.now()).slice(-7);
const local = '0' + phone.slice(4);
const login = phone.slice(1) + '@phone.usepinga.com';
const [{ company, token }] = await sql(`
  with c as (insert into public.companies (name) values ('Browser check (auto-deleted)') returning id),
       b as (insert into public.branches (company_id, name, lat, lng) select id, 'Yaba office', 6.5095, 3.3711 from c),
       m as (insert into public.members (company_id, full_name, phone, role) select id, 'Browser Check', '${phone}', 'staff' from c returning invite_token)
  select (select id from c) as company, m.invite_token as token from m;`);

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ proxy, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    ignoreHTTPSErrors: !!proxy, permissions: ['geolocation', 'camera'], geolocation: { latitude: 6.5096, longitude: 3.3712, accuracy: 12 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await page.goto(SITE);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  step('hosted site opens on the sign-in screen');

  await page.goto(SITE + '#/join/' + token);
  await page.getByRole('heading', { name: 'Welcome, Browser' }).waitFor();
  await page.getByLabel('New PIN').fill('482913');
  await page.getByLabel('Type it again').fill('482913');
  await page.getByRole('button', { name: 'Save PIN' }).click();
  await page.getByRole('heading', { name: 'Your photo' }).waitFor();
  step('invite link → PIN saved → signed in (real login service)');

  await page.getByRole('button', { name: 'Take photo' }).click();
  await page.getByText("You haven't clocked in today.").waitFor();
  step('reference photo uploaded to real storage');

  await page.getByRole('link', { name: 'Clock in' }).click();
  await page.getByText('At Yaba office ✓').waitFor();
  await page.getByRole('button', { name: 'Take photo and clock in' }).click();
  await page.getByText(/Clocked in at/).first().waitFor();
  let rows = [];
  for (let i = 0; i < 30 && !rows.length; i++) {
    rows = await sql(`select a.flags, a.distance_m, a.photo_path is not null as has_photo from public.attendance a
      join public.members m on m.id = a.member_id where m.company_id = '${company}'`);
    if (!rows.length) await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(rows.length, 1, 'clock-in reached the database');
  assert.ok(rows[0].has_photo, 'with its photo');
  step(`clock-in reached the staging database with photo, ${rows[0].distance_m} m from the office, flags: ${JSON.stringify(rows[0].flags)}`);
  await page.screenshot({ path: out + 'staging-clocked-in.png' });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Phone number').fill(local);
  await page.getByLabel('PIN').fill('482913');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText(/Clocked in at/).first().waitFor();
  step('signs back in with phone number + PIN');
  assert.deepEqual(errors, [], 'no errors in the page');
} finally {
  await browser.close();
  await sql(`
    set local storage.allow_delete_query = 'true';
    delete from storage.objects where bucket_id = 'photos' and name like '${company}/%';
    delete from public.companies where id = '${company}';
    delete from auth.users where email = '${login}';`);
  step('test company, login and photos deleted');
}
