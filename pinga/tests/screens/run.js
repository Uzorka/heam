// Walks through every Step 1 screen in a real browser on a small phone screen,
// against a pretend Supabase, and saves screenshots to tests/screens/output/.
// Also measures the first load with a 4x slower CPU and slow 3G.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { server } from '../../scripts/serve.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = new URL('./output/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

// ── Pretend Supabase ────────────────────────────────────────
const company = { id: 'c1', name: 'CHF Heron' };
const owner = { id: 'm0', user: 'u-owner', full_name: 'Elvis Uzorka', role: 'owner', phone: null, joined_at: '2026-11-14', invite_token: null };
const people = [
  owner,
  { id: 'm1', user: 'u-sade', full_name: 'Sade Bello', role: 'staff', phone: '+2348031234567', joined_at: '2026-11-14', invite_token: null },
  { id: 'm2', user: null, full_name: 'Remi Okafor', role: 'rep', phone: '+2348059876543', joined_at: null, invite_token: 'f'.repeat(32) },
];
const ok = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postDataJSON?.() ?? null;
  const p = url.pathname;
  const q = url.search;

  if (p === '/auth/v1/token') {
    const who = body.email === 'elvis@chfheron.com' && body.password === 'password1' ? 'u-owner'
      : body.email === '2348031234567@phone.usepinga.com' && body.password === '482913' ? 'u-sade'
      : body.email === '2348059876543@phone.usepinga.com' && body.password === '482913' ? 'u-remi' : null;
    if (!who) return ok(route, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
    return ok(route, { access_token: 'at-' + who, refresh_token: 'rt', expires_in: 3600, user: { id: who, email: body.email } });
  }
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (p === '/rest/v1/members' && req.method() === 'GET') {
    const uid = /user_id=eq\.([^&]+)/.exec(q)?.[1];
    if (uid) {
      const m = people.find((x) => x.user === uid);
      return ok(route, m ? [{ ...m, company_id: company.id, companies: { name: company.name } }] : []);
    }
    const id = /[?&]id=eq\.([^&]+)/.exec(q)?.[1];
    if (id) return ok(route, people.filter((x) => x.id === id));
    return ok(route, [...people].sort((a, b) => a.full_name.localeCompare(b.full_name)));
  }
  if (p === '/rest/v1/members' && req.method() === 'POST') {
    if (people.some((x) => x.phone === body.phone)) return ok(route, { code: '23505', message: 'duplicate' }, 409);
    const row = { id: 'm' + people.length, user: null, joined_at: null, invite_token: 'a1b2'.repeat(8), ...body };
    people.push(row);
    return ok(route, [row]);
  }
  if (p === '/rest/v1/rpc/invite_preview') {
    const m = people.find((x) => x.invite_token === body.p_token);
    return ok(route, m ? [{ first_name: m.full_name.split(' ')[0], company_name: company.name }] : []);
  }
  if (p === '/functions/v1/accept-invite') {
    const m = people.find((x) => x.invite_token === body.token);
    m.user = 'u-remi'; m.joined_at = '2026-11-14'; m.invite_token = null;
    return ok(route, { login_email: m.phone.slice(1) + '@phone.usepinga.com' });
  }
  return ok(route, { message: 'not faked: ' + p }, 404);
}

// ── Walk-through ────────────────────────────────────────────
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e));
await page.route(/\/(auth|rest|functions)\/v1\//, fakeSupabase);

let n = 0;
const shot = async (name) => page.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-${name}.png` });
const step = (name) => console.log('ok -', name);

// Slow phone + slow 3G: how long until the sign-in screen is usable?
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 50000 });
const t0 = Date.now();
await page.goto(base);
await page.getByRole('heading', { name: 'Sign in' }).waitFor();
const loadMs = Date.now() - t0;
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
step(`sign-in screen ready in ${(loadMs / 1000).toFixed(1)}s on a 4x slower phone over slow 3G`);
await shot('staff-sign-in');

// Staff: wrong PIN, then right PIN.
await page.getByLabel('Phone number').fill('0803 123 4567');
await page.getByLabel('PIN').fill('999999');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByText('Wrong phone number or PIN.').waitFor();
step('wrong PIN shows a plain message');
await shot('staff-wrong-pin');
await page.getByLabel('PIN').fill('482913');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByText("You're all set up as office staff at CHF Heron.").waitFor();
step('staff signs in with phone + PIN and sees their home screen');
await shot('staff-home');
await page.getByRole('button', { name: 'Sign out' }).click();

// Owner: sign in with email, see team, invite someone, share the link.
await page.getByRole('link', { name: 'Business owner? Sign in with email' }).click();
await page.getByLabel('Email').fill('elvis@chfheron.com');
await page.getByLabel('Password').fill('password1');
await shot('owner-sign-in');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('heading', { name: 'Team' }).waitFor();
assert.equal(await page.locator('.list li').count(), 3);
step('owner signs in and sees the team');
await shot('owner-team');
await page.getByRole('link', { name: 'Invite someone' }).click();
await page.getByLabel('Full name').fill('Tunde Ade');
await page.getByLabel('Phone number').fill('0803 123 4567');
await page.getByText('Sales rep', { exact: true }).click();
await shot('owner-invite');
await page.getByRole('button', { name: 'Create invite' }).click();
await page.getByText('Someone with this phone number is already in your team.').waitFor();
step('inviting a phone number twice is caught');
await page.getByLabel('Phone number').fill('0812 555 0101');
await page.getByRole('button', { name: 'Create invite' }).click();
await page.getByRole('link', { name: 'Send on WhatsApp' }).waitFor();
const wa = await page.getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href');
assert.ok(wa.startsWith('https://wa.me/2348125550101?text='), wa);
step('invite created; WhatsApp link goes to the right number');
await shot('owner-share-invite');
await page.getByRole('link', { name: '‹ Team' }).click();
await page.getByRole('button', { name: 'Sign out' }).click();

// New sales rep opens their link and chooses a PIN.
await page.goto(base + '#/join/' + 'f'.repeat(32));
await page.getByRole('heading', { name: 'Welcome, Remi' }).waitFor();
await shot('rep-join');
await page.getByLabel('New PIN').fill('111111');
await page.getByLabel('Type it again').fill('111111');
await page.getByRole('button', { name: 'Save PIN' }).click();
await page.getByText('Use 6 digits that are hard to guess').waitFor();
step('easy PINs are refused');
await page.getByLabel('New PIN').fill('482913');
await page.getByLabel('Type it again').fill('482913');
await page.getByRole('button', { name: 'Save PIN' }).click();
await page.getByText("You're all set up as sales rep at CHF Heron.").waitFor();
step('new rep sets a PIN from the invite link and is signed in');
await shot('rep-home');

// A used link no longer works.
await page.getByRole('button', { name: 'Sign out' }).click();
await page.goto(base + '#/join/' + 'f'.repeat(32));
await page.getByRole('heading', { name: 'This link has expired' }).waitFor();
step('a used invite link cannot be used again');

// No signal.
await ctx.setOffline(true);
await page.unroute(/\/(auth|rest|functions)\/v1\//);
await page.reload().catch(() => {});
await ctx.setOffline(false);
await page.route(/\/(auth|rest|functions)\/v1\//, (r) => r.abort('internetdisconnected'));
await page.goto(base + '#/join/' + 'e'.repeat(32));
await page.getByRole('heading', { name: "Can't load right now" }).waitFor();
await page.getByText('No connection. Check your internet and try again.').waitFor();
step('no signal shows a calm message with "Try again", not a crash');
await shot('no-signal');

assert.deepEqual(errors, [], 'no uncaught errors in the page');
step('no uncaught errors');
await browser.close();
server.close();
console.log(`\nScreenshots saved in ${out}`);
